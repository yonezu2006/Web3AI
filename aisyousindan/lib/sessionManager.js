const fs = require('fs');
const path = require('path');

const TMP_DIR = path.join(__dirname, '..', 'tmp_faces');

// Wi-Fiの一瞬の途切れ等でsocketが切断→再接続しても、これくらいの間は「切断した」と
// みなさずに待つ(この間に同じclientIdで再接続してくればそのまま続行できる)
const DISCONNECT_GRACE_MS = 10000;

function emptyPlayer(slot, clientId, socketId) {
  return {
    slot,
    clientId,
    socketId,
    nickname: null,
    photoPath: null,
    photoDataUrl: null,
    answers: null,
    ready: false,
    disconnectTimer: null
  };
}

// 1度に1組(2人)だけをサポートするシンプルなセッション管理。
// 出店イベントで1台のホストMacに2人が同時に対戦する用途を想定している。
// clientId(ブラウザのJSが生きている間だけ有効な識別子)を軸に管理することで、
// Wi-Fiの瞬断によるsocket再接続を「同じプレイヤーの復帰」として扱えるようにしている。
function createSessionManager() {
  let sessionId = null;
  let players = {}; // clientId -> player
  let socketIndex = {}; // socket.id -> clientId(現在生きているsocketのみ)
  let order = []; // clientId の参加順(A, B)
  let savedResult = null; // 保存済みの{pairId,url}(2人それぞれが独立して旅行スポット画面に遷移しても二重保存しないためのキャッシュ)
  let lastDiagnosis = null; // 再接続時に診断結果を取りこぼさないよう保持しておく

  function clearAllTimers() {
    Object.values(players).forEach((p) => {
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    });
  }

  function clearPhotos() {
    Object.values(players).forEach((p) => {
      if (p.photoPath && fs.existsSync(p.photoPath)) {
        try {
          fs.unlinkSync(p.photoPath);
        } catch (e) {
          /* noop */
        }
      }
      p.photoPath = null;
    });
  }

  function reset() {
    clearAllTimers();
    clearPhotos();
    sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    players = {};
    socketIndex = {};
    order = [];
    savedResult = null;
    lastDiagnosis = null;
  }
  reset();

  // 新規参加、または同じclientIdでの再接続を処理する。
  // 満員(無関係な3人目以降)ならnullを返す。
  function join(socketId, clientId) {
    const existing = players[clientId];
    if (existing) {
      if (existing.disconnectTimer) {
        clearTimeout(existing.disconnectTimer);
        existing.disconnectTimer = null;
      }
      existing.socketId = socketId;
      socketIndex[socketId] = clientId;
      return { slot: existing.slot, resumed: true };
    }

    if (order.length >= 2) return null;

    const slot = order.length === 0 ? 'A' : 'B';
    players[clientId] = emptyPlayer(slot, clientId, socketId);
    socketIndex[socketId] = clientId;
    order.push(clientId);
    return { slot, resumed: false };
  }

  function get(socketId) {
    const clientId = socketIndex[socketId];
    return clientId ? players[clientId] : undefined;
  }

  function partnerSocketId(socketId) {
    const clientId = socketIndex[socketId];
    const partnerClientId = order.find((id) => id !== clientId);
    const partner = partnerClientId ? players[partnerClientId] : null;
    return partner ? partner.socketId : undefined;
  }

  function setNickname(socketId, nickname) {
    const player = get(socketId);
    if (player) player.nickname = nickname;
  }

  function savePhoto(socketId, dataUrl) {
    const player = get(socketId);
    if (!player) return null;
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const filePath = path.join(TMP_DIR, `${sessionId}_${player.slot}.png`);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    player.photoPath = filePath;
    // 合成表示のため他方のブラウザにも渡せるようメモリ上にも保持しておく(ディスク上のファイルは保存後に削除される)
    player.photoDataUrl = dataUrl;
    return filePath;
  }

  function setAnswers(socketId, answers) {
    const player = get(socketId);
    if (!player) return;
    player.answers = answers;
  }

  function markReady(socketId) {
    const player = get(socketId);
    if (!player) return;
    player.ready = !!(player.nickname && player.photoPath && player.answers);
  }

  function bothReady() {
    return order.length === 2 && order.every((id) => players[id] && players[id].ready);
  }

  function getPlayersInOrder() {
    // Aが常にplayerA、Bがplayer Bになるよう固定順で返す
    return order.map((id) => players[id]);
  }

  // socketが切断されてもすぐには見捨てず、しばらく待ってから本当に切断とみなす。
  // 猶予時間内に同じclientIdで再接続(join)されればタイマーはそちらでキャンセルされる。
  // 本当に切断が確定した場合にonTrulyGone(partnerSocketIdAtThatTime)を呼ぶ。
  function scheduleDisconnect(socketId, onTrulyGone) {
    const clientId = socketIndex[socketId];
    if (!clientId) return;
    delete socketIndex[socketId];

    const player = players[clientId];
    if (!player || player.socketId !== socketId) return; // 既に新しいsocketに置き換わっている

    player.disconnectTimer = setTimeout(() => {
      const stillThere = players[clientId];
      if (!stillThere || stillThere.socketId !== socketId) return; // 猶予時間内に再接続済み
      const partnerId = partnerSocketId(socketId);
      if (stillThere.photoPath && fs.existsSync(stillThere.photoPath)) {
        try {
          fs.unlinkSync(stillThere.photoPath);
        } catch (e) {
          /* noop */
        }
      }
      delete players[clientId];
      order = order.filter((id) => id !== clientId);
      onTrulyGone(partnerId);
    }, DISCONNECT_GRACE_MS);
  }

  function getSessionId() {
    return sessionId;
  }

  function getSessionSocketIds() {
    // 再接続でsocket.idが変わっていても、常に「今生きている」socket.idを返す
    return order.map((clientId) => players[clientId] && players[clientId].socketId).filter(Boolean);
  }

  function getSavedResult() {
    return savedResult;
  }

  function setSavedResult(result) {
    savedResult = result;
  }

  function getLastDiagnosis() {
    return lastDiagnosis;
  }

  function setLastDiagnosis(payload) {
    lastDiagnosis = payload;
  }

  return {
    reset,
    join,
    get,
    partnerSocketId,
    setNickname,
    savePhoto,
    setAnswers,
    markReady,
    bothReady,
    getPlayersInOrder,
    scheduleDisconnect,
    getSessionId,
    getSessionSocketIds,
    clearPhotos,
    getSavedResult,
    setSavedResult,
    getLastDiagnosis,
    setLastDiagnosis
  };
}

module.exports = { createSessionManager };
