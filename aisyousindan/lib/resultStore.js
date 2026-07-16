const fs = require('fs');
const path = require('path');

const KEKKA_DIR = path.join(__dirname, '..', 'kekka');
const INDEX_PATH = path.join(KEKKA_DIR, 'index.json');

function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  } catch (e) {
    return {};
  }
}

function saveIndex(index) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

function sanitizeFolderName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').trim() || 'unknown';
}

function generatePairId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// ペアの結果一式(PDF, ページ画像, メタ情報)をkekka/配下の専用サブフォルダに保存する
function saveResult({ nickname1, nickname2, pdfBase64, page1Base64, page2Base64, meta }) {
  const pairId = generatePairId();
  let folderName = `${sanitizeFolderName(nickname1)}_${sanitizeFolderName(nickname2)}`;
  let folderPath = path.join(KEKKA_DIR, folderName);
  let suffix = 2;
  while (fs.existsSync(folderPath)) {
    folderPath = path.join(KEKKA_DIR, `${folderName}_${suffix}`);
    suffix += 1;
  }
  fs.mkdirSync(folderPath, { recursive: true });

  fs.writeFileSync(path.join(folderPath, 'result.pdf'), Buffer.from(pdfBase64, 'base64'));
  fs.writeFileSync(path.join(folderPath, 'page1.png'), Buffer.from(page1Base64, 'base64'));
  fs.writeFileSync(path.join(folderPath, 'page2.png'), Buffer.from(page2Base64, 'base64'));
  fs.writeFileSync(path.join(folderPath, 'meta.json'), JSON.stringify(meta || {}, null, 2));

  const index = loadIndex();
  index[pairId] = { folder: path.basename(folderPath), createdAt: new Date().toISOString() };
  saveIndex(index);

  return { pairId, folder: path.basename(folderPath) };
}

function getResultById(pairId) {
  const index = loadIndex();
  const entry = index[pairId];
  if (!entry) return null;
  const folderPath = path.join(KEKKA_DIR, entry.folder);
  if (!fs.existsSync(folderPath)) return null;
  const metaPath = path.join(folderPath, 'meta.json');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : {};
  return {
    folder: entry.folder,
    folderPath,
    meta,
    page1Url: `/kekka/${encodeURIComponent(pairId)}/page1.png`,
    page2Url: `/kekka/${encodeURIComponent(pairId)}/page2.png`,
    pdfUrl: `/kekka/${encodeURIComponent(pairId)}/result.pdf`
  };
}

module.exports = { saveResult, getResultById, KEKKA_DIR };
