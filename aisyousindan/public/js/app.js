import { startCamera, stopCamera, capturePhoto } from './camera.js';
import { loadQuestions, runQuiz } from './quiz.js';
import { loadCategories, drawTravelComposite, loadImage, buildResultPage1Canvas, buildResultPage2Canvas } from './compose.js';
import { buildPdfBase64 } from './pdfgen.js';
import { initAudio, startBackgroundMusic, playClick, playShutter, playSparkle } from './audio.js';

// 最初の操作でオーディオを初期化してBGMを始める(ブラウザの自動再生制限のため、
// クリックに限らずキー入力・タップも含めできるだけ早いタイミングで開始する)
let audioStarted = false;
function ensureAudioStarted() {
  if (audioStarted) return;
  audioStarted = true;
  initAudio();
  startBackgroundMusic();
}
['pointerdown', 'keydown'].forEach((type) => {
  document.addEventListener(type, ensureAudioStarted, { once: true });
});

// カメラのシャッターボタン以外は、押すと「ぽよっ」という効果音を鳴らす
document.addEventListener('click', (e) => {
  ensureAudioStarted();
  if (!e.target.closest('button')) return;
  if (e.target.closest('#capture-btn')) return; // シャッター音は別で鳴らす
  playClick();
});

// このページが生きている間だけ有効な識別子。Wi-Fiの瞬断でsocketが再接続しても
// 同じclientIdを送ることで、サーバー側は「同じプレイヤーの復帰」として扱える
const clientId = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const socket = io({ auth: { clientId } });

let mySlot = null;
let myNickname = '';
let myPhotoDataUrl = null;
let myAnswers = {};
let cameraStream = null;

let pendingResult = null;
let lastResultPayload = null;
let loadingStartedAt = null;

let categories = null;

const screens = {};
document.querySelectorAll('.screen').forEach((el) => {
  screens[el.id] = el;
});

function showScreen(id) {
  Object.values(screens).forEach((el) => el.classList.remove('active'));
  screens[id].classList.add('active');
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  setTimeout(() => {
    t.hidden = true;
  }, 4000);
}

// ---------- ニックネーム画面 ----------
const nicknameInput = document.getElementById('nickname-input');
const nicknameSubmit = document.getElementById('nickname-submit');

nicknameInput.addEventListener('input', () => {
  nicknameSubmit.disabled = nicknameInput.value.trim().length === 0;
});
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !nicknameSubmit.disabled) nicknameSubmit.click();
});
nicknameSubmit.addEventListener('click', () => {
  myNickname = nicknameInput.value.trim();
  if (!myNickname) return;
  socket.emit('submitNickname', myNickname);
  goToCameraScreen();
});

// ---------- カメラ画面 ----------
const videoEl = document.getElementById('camera-video');
const captureBtn = document.getElementById('capture-btn');
const retakeBtn = document.getElementById('retake-btn');
const usePhotoBtn = document.getElementById('use-photo-btn');
const previewImg = document.getElementById('captured-preview');
const guideFrame = document.getElementById('guide-frame');

async function goToCameraScreen() {
  showScreen('screen-camera');
  try {
    cameraStream = await startCamera(videoEl);
  } catch (err) {
    console.error(err);
    toast('カメラを起動できませんでした。カメラの利用を許可してください。');
  }
}

captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;
  playShutter();
  try {
    myPhotoDataUrl = await capturePhoto(videoEl);
    previewImg.src = myPhotoDataUrl;
    videoEl.hidden = true;
    previewImg.hidden = false;
    guideFrame.hidden = true;
    captureBtn.hidden = true;
    retakeBtn.hidden = false;
    usePhotoBtn.hidden = false;
  } catch (err) {
    console.error(err);
    toast('撮影に失敗しました。もう一度お試しください。');
  } finally {
    captureBtn.disabled = false;
  }
});

retakeBtn.addEventListener('click', () => {
  videoEl.hidden = false;
  previewImg.hidden = true;
  guideFrame.hidden = false;
  captureBtn.hidden = false;
  retakeBtn.hidden = true;
  usePhotoBtn.hidden = true;
});

usePhotoBtn.addEventListener('click', () => {
  socket.emit('submitPhoto', myPhotoDataUrl);
  stopCamera(cameraStream);
  goToQuizScreen();
});

// ---------- クイズ画面 ----------
async function goToQuizScreen() {
  showScreen('screen-quiz');
  const questions = await loadQuestions();
  runQuiz(
    questions,
    {
      progressEl: document.getElementById('quiz-progress'),
      questionEl: document.getElementById('quiz-question'),
      optionsEl: document.getElementById('quiz-options')
    },
    (answers) => {
      myAnswers = answers;
      socket.emit('submitAnswers', myAnswers);
      showScreen('screen-waiting');
    }
  );
}

// ---------- socket.io イベント ----------
socket.on('assigned', ({ slot }) => {
  mySlot = slot;
});

socket.on('sessionFull', () => {
  document.getElementById('app').innerHTML =
    '<div class="card"><h2>ただいま使用中です</h2><p class="lead">前のペアの診断が終わるまで少々お待ちください。</p></div>';
});

socket.on('bothReady', () => {
  showScreen('screen-loading');
  loadingStartedAt = performance.now();
  tryShowResult();
});

socket.on('diagnosisResult', (payload) => {
  pendingResult = payload;
  tryShowResult();
});

socket.on('diagnosisError', () => {
  toast('診断に失敗しました。もう一度お試しください。');
});

socket.on('partnerDisconnected', () => {
  toast('相手が切断しました。最初からやり直します。');
  setTimeout(() => location.reload(), 2000);
});

socket.on('sessionReset', () => {
  location.reload();
});

function tryShowResult() {
  if (!pendingResult) return;
  const elapsed = loadingStartedAt ? performance.now() - loadingStartedAt : 5000;
  const remaining = Math.max(0, 5000 - elapsed);
  setTimeout(() => renderResultScreen(pendingResult), remaining);
}

// ---------- 結果画面 ----------
function renderResultScreen(payload) {
  lastResultPayload = payload;
  const { players, result } = payload;

  document.getElementById('result-photo-a').src = players.A.photo;
  document.getElementById('result-photo-b').src = players.B.photo;
  document.getElementById('result-name-a').textContent = players.A.nickname;
  document.getElementById('result-name-b').textContent = players.B.nickname;
  document.getElementById('result-compatibility').textContent = result.compatibility;
  document.getElementById('result-comment').textContent = result.comment;

  const list = document.getElementById('result-answers');
  list.innerHTML = '';
  result.answerSummary.forEach((item) => {
    const li = document.createElement('li');
    li.innerHTML = `${item.question}<br><b>${item.a.nickname}:${item.a.choice}</b> / <b>${item.b.nickname}:${item.b.choice}</b>`;
    list.appendChild(li);
  });

  showScreen('screen-result');
}

document.getElementById('goto-travel-btn').addEventListener('click', () => {
  showScreen('screen-travel');
  playSparkle();
  renderTravelScreen(lastResultPayload);
});

// ---------- 旅行スポット画面 ----------
// 2人それぞれが自分のタイミングで独立して遷移できる。保存(PDF生成)はサーバー側でべき等になっており、
// 先に遷移した側が保存し、後から遷移した側はサーバーから同じ保存済み結果(同じQR)を受け取る。
async function renderTravelScreen(payload) {
  const { players, result } = payload;
  const statusEl = document.getElementById('save-status');
  document.getElementById('qr-wrap').hidden = true;

  // キラキラ演出をリセットして、写真がまだ見えない状態から始める
  const travelCanvas = document.getElementById('travel-canvas');
  const sparkleOverlay = document.getElementById('sparkle-overlay');
  travelCanvas.classList.remove('revealed');
  sparkleOverlay.classList.remove('hide');

  if (!categories) categories = await loadCategories();

  await drawTravelComposite(travelCanvas, {
    categoryKey: result.categoryKey,
    categories,
    playerA: { photo: players.A.photo, gender: players.A.gender },
    playerB: { photo: players.B.photo, gender: players.B.gender }
  });

  document.getElementById('travel-spot-name').textContent = result.spotName;
  document.getElementById('travel-reason').textContent = result.reason;

  // 少しずつ写真が見えてくるワイプ演出 + キラキラのフェードアウト
  requestAnimationFrame(() => {
    travelCanvas.classList.add('revealed');
    sparkleOverlay.classList.add('hide');
  });

  statusEl.textContent = '保存中...';

  try {
    const [photoAImg, photoBImg] = await Promise.all([loadImage(players.A.photo), loadImage(players.B.photo)]);

    const page1 = buildResultPage1Canvas({
      photoAImg,
      photoBImg,
      nicknameA: players.A.nickname,
      nicknameB: players.B.nickname,
      compatibility: result.compatibility,
      comment: result.comment,
      answerSummary: result.answerSummary
    });
    const page2 = buildResultPage2Canvas({
      travelCanvas,
      spotName: result.spotName,
      reason: result.reason
    });

    const pdfBase64 = buildPdfBase64(page1, page2);

    const res = await fetch('/api/save-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname1: players.A.nickname,
        nickname2: players.B.nickname,
        pdfBase64,
        page1Base64: page1.toDataURL('image/png').split(',')[1],
        page2Base64: page2.toDataURL('image/png').split(',')[1],
        meta: {
          nickname1: players.A.nickname,
          nickname2: players.B.nickname,
          compatibility: result.compatibility,
          spotName: result.spotName
        }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'save failed');

    statusEl.textContent = '';
    const qrWrap = document.getElementById('qr-wrap');
    qrWrap.hidden = false;
    document.getElementById('qr-image').src = `/api/qrcode?text=${encodeURIComponent(data.url)}`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = '結果の保存に失敗しました。';
  }
}

document.getElementById('end-session-btn').addEventListener('click', () => {
  socket.emit('endSession');
  // 相手側の画面はsessionResetのブロードキャストで戻るが、
  // 自分側は再接続タイミング等に左右されず確実に戻れるよう即座にリロードする
  location.reload();
});
