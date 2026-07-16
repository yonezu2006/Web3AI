const fs = require('fs');
const os = require('os');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const { diagnose } = require('./lib/diagnosis');
const { saveResult } = require('./lib/resultStore');
const { createSessionManager } = require('./lib/sessionManager');
const { ensureCert } = require('./lib/certManager');
const { createKekkaRouter } = require('./lib/kekkaRouter');
const { startPublicTunnel } = require('./lib/publicTunnel');

const PORT = process.env.PORT || 3000;
const PUBLIC_PORT = process.env.PUBLIC_PORT || 3001;

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LAN_IP = getLanIp();
const kekkaRouter = createKekkaRouter();

const app = express();

// LAN経由のカメラ利用(getUserMedia)にはHTTPSが必須なため、自己署名証明書でHTTPS化する。
// 証明書生成に失敗した場合(opensslが無い環境など)はHTTPにフォールバックする(その場合LANからのカメラ利用は不可)。
let server;
let PROTOCOL;
try {
  const certs = ensureCert(LAN_IP);
  server = https.createServer(certs, app);
  PROTOCOL = 'https';
} catch (err) {
  console.warn('[server] HTTPS証明書の生成に失敗したためHTTPで起動します(LANからのカメラ利用不可):', err.message);
  server = http.createServer(app);
  PROTOCOL = 'http';
}
const io = new Server(server, { maxHttpBufferSize: 15e6 });

app.use(express.json({ limit: '25mb' }));
// 開発中に背景・座標データを頻繁に調整するため、ブラウザに古いデータがキャッシュされて
// 「直したのに反映されない」ことがないよう、JS/JSON/画像は明示的にキャッシュさせない
const noCache = (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
};
app.use(noCache);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/data', express.static(path.join(__dirname, 'data')));
app.use('/hukei', express.static(path.join(__dirname, 'hukei')));
app.use(kekkaRouter);

const session = createSessionManager();

// QRコードの中身になるURL。ngrokトンネルが使えればスマホのモバイルデータからも開ける公開URL、
// 使えなければLAN内(同じWi-Fi/テザリング)からのみ開けるURLにフォールバックする。
let publicBaseUrl = `${PROTOCOL}://${LAN_IP}:${PORT}`;

app.get('/api/server-info', (req, res) => {
  res.json({ ip: LAN_IP, port: PORT, protocol: PROTOCOL, publicBaseUrl });
});

app.get('/api/qrcode', async (req, res) => {
  const text = req.query.text;
  if (!text) return res.status(400).send('text query is required');
  try {
    const png = await QRCode.toBuffer(String(text), { width: 320, margin: 1 });
    res.set('Content-Type', 'image/png');
    res.send(png);
  } catch (err) {
    res.status(500).send('failed to generate QR code');
  }
});

// 診断結果一式(PDF・ページ画像)を保存し、プライバシー保護のため撮影した顔写真の一時ファイルを削除する。
// 2人がそれぞれ独立して旅行スポット画面に遷移しても二重保存しないよう、
// 同じセッションで既に保存済みなら保存済みの結果をそのまま返す(べき等)。
app.post('/api/save-result', (req, res) => {
  const existing = session.getSavedResult();
  if (existing) {
    return res.json(existing);
  }

  const { nickname1, nickname2, pdfBase64, page1Base64, page2Base64, meta } = req.body || {};
  if (!nickname1 || !nickname2 || !pdfBase64 || !page1Base64 || !page2Base64) {
    return res.status(400).json({ error: 'missing required fields' });
  }
  try {
    const { pairId } = saveResult({ nickname1, nickname2, pdfBase64, page1Base64, page2Base64, meta });
    session.clearPhotos(); // 顔写真の一時ファイルを削除(プライバシー保護)。セッション自体はendSessionまで維持する
    const url = `${publicBaseUrl}/kekka/${pairId}`;
    const result = { pairId, url };
    session.setSavedResult(result);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to save result' });
  }
});

// 現在の2人(セッション参加者)にのみ配信する。無関係な3人目以降の接続には届かせない。
function broadcastToSession(event, payload) {
  session.getSessionSocketIds().forEach((id) => io.to(id).emit(event, payload));
}

io.on('connection', (socket) => {
  const clientId = socket.handshake.auth && socket.handshake.auth.clientId;
  const joinResult = clientId ? session.join(socket.id, clientId) : null;
  if (!joinResult) {
    socket.emit('sessionFull');
    socket.disconnect(true);
    return;
  }
  socket.emit('assigned', { slot: joinResult.slot });

  // 瞬断からの再接続の場合、取りこぼしたかもしれない診断結果を追いつかせる
  if (joinResult.resumed) {
    const lastDiagnosis = session.getLastDiagnosis();
    if (lastDiagnosis) socket.emit('diagnosisResult', lastDiagnosis);
  }

  socket.on('submitNickname', (nickname) => {
    session.setNickname(socket.id, String(nickname || '').slice(0, 20));
    const partner = session.partnerSocketId(socket.id);
    if (partner) io.to(partner).emit('partnerStatus', { stage: 'nickname' });
  });

  socket.on('submitPhoto', (dataUrl) => {
    try {
      session.savePhoto(socket.id, dataUrl);
      const partner = session.partnerSocketId(socket.id);
      if (partner) io.to(partner).emit('partnerStatus', { stage: 'photo' });
    } catch (err) {
      console.error('savePhoto failed:', err);
    }
  });

  socket.on('submitAnswers', async (answers) => {
    session.setAnswers(socket.id, answers);
    session.markReady(socket.id);
    const partner = session.partnerSocketId(socket.id);
    if (partner) io.to(partner).emit('partnerStatus', { stage: 'answers' });

    if (session.bothReady()) {
      const [playerA, playerB] = session.getPlayersInOrder();
      broadcastToSession('bothReady');
      try {
        const result = await diagnose(playerA, playerB);
        const payload = {
          players: {
            A: { nickname: playerA.nickname, gender: playerA.answers.q1, photo: playerA.photoDataUrl },
            B: { nickname: playerB.nickname, gender: playerB.answers.q1, photo: playerB.photoDataUrl }
          },
          result
        };
        session.setLastDiagnosis(payload);
        broadcastToSession('diagnosisResult', payload);
      } catch (err) {
        console.error('diagnose failed:', err);
        broadcastToSession('diagnosisError');
      }
    }
  });

  // スタッフ操作:結果画面から次のペアのためにセッションをリセットする
  socket.on('endSession', () => {
    broadcastToSession('sessionReset');
    session.reset();
  });

  // Wi-Fiの瞬断等ですぐに再接続してくる可能性があるため、猶予期間を置いてから
  // 本当に切断されたと判断する(その間は相手に何も知らせない)
  socket.on('disconnect', () => {
    session.scheduleDisconnect(socket.id, (partnerSocketIdAtThatTime) => {
      if (partnerSocketIdAtThatTime) io.to(partnerSocketIdAtThatTime).emit('partnerDisconnected');
    });
  });
});

server.listen(PORT, () => {
  console.log(`相性診断ゲーム サーバー起動: ${PROTOCOL}://localhost:${PORT}`);
  console.log(`同じWi-Fi内の別のMacからは ${PROTOCOL}://${LAN_IP}:${PORT} でアクセスしてください`);
  if (PROTOCOL === 'https') {
    console.log('※自己署名証明書のため「この接続ではプライバシーが保護されません」等の警告が出ます。「詳細設定」→「アクセスする」で進んでください(カメラ利用にHTTPSが必須のための仕様です)。');
  }
});

// QRの読み込み先(結果ページ)を、ホストのネットワークに繋がっていない普通のスマホからも
// 開けるようにするための公開用サーバー。ゲーム本体(Socket.io)はここには含めず、
// 保存済みの結果ページ(/kekka/:pairId)だけを公開する。
const publicApp = express();
publicApp.use(kekkaRouter);
const publicServer = http.createServer(publicApp);
publicServer.listen(PUBLIC_PORT, async () => {
  const tunnelUrl = await startPublicTunnel(PUBLIC_PORT);
  if (tunnelUrl) {
    publicBaseUrl = tunnelUrl;
  } else {
    console.log(`結果ページの公開URLはLAN内向けのままです: ${publicBaseUrl}`);
  }
});
