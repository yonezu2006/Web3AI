// canvas合成まわりの共通処理(顔ハメ合成・PDFページ用キャンバス生成)

const imageCache = new Map();

export function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

export async function loadCategories() {
  const res = await fetch('/data/categories.json');
  const data = await res.json();
  return data.categories;
}

// destの矩形いっぱいに、アスペクト比を保ったままcoverでトリミング描画する
function drawCover(ctx, img, destX, destY, destW, destH) {
  const srcRatio = img.width / img.height;
  const destRatio = destW / destH;
  let sx, sy, sw, sh;
  if (srcRatio > destRatio) {
    sh = img.height;
    sw = sh * destRatio;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / destRatio;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, destX, destY, destW, destH);
}

// 顔写真を楕円クリップでfaceHoleに描画する。rotation (度) が指定されていれば楕円ごと回転させ、
// feather (px) が指定されていれば縁をぼかして自然になじませる(未指定ならこれまで通りの硬い縁の楕円クリップ)。
function drawFaceIntoHole(ctx, faceImg, hole, rotationDeg, featherPx) {
  const cx = hole.x + hole.width / 2;
  const cy = hole.y + hole.height / 2;
  const rot = ((rotationDeg || 0) * Math.PI) / 180;

  if (!featherPx) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, hole.width / 2, hole.height / 2, rot, 0, Math.PI * 2);
    ctx.clip();
    drawCover(ctx, faceImg, hole.x, hole.y, hole.width, hole.height);
    ctx.restore();
    return;
  }

  // フェザーあり: オフスクリーンで顔画像とぼかした楕円マスクを合成してから、回転させて本描画する
  const pad = featherPx * 2;
  const layerW = hole.width + pad * 2;
  const layerH = hole.height + pad * 2;
  const layer = document.createElement('canvas');
  layer.width = layerW;
  layer.height = layerH;
  const lctx = layer.getContext('2d');
  drawCover(lctx, faceImg, pad, pad, hole.width, hole.height);

  const mask = document.createElement('canvas');
  mask.width = layerW;
  mask.height = layerH;
  const mctx = mask.getContext('2d');
  mctx.filter = `blur(${featherPx}px)`;
  mctx.fillStyle = '#fff';
  mctx.beginPath();
  mctx.ellipse(layerW / 2, layerH / 2, hole.width / 2 - featherPx / 2, hole.height / 2 - featherPx / 2, 0, 0, Math.PI * 2);
  mctx.fill();

  lctx.globalCompositeOperation = 'destination-in';
  lctx.drawImage(mask, 0, 0);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.drawImage(layer, -layerW / 2, -layerH / 2);
  ctx.restore();
}

// faceSlotsの性別指定と各プレイヤーの自己申告性別を突き合わせ、どのプレイヤーをどのスロットに描くか決める。
// スロットの性別指定が同じ(nullを含む)場合や、プレイヤー同士が同じ自己申告性別の場合は、
// 安定した既定の割り当て(playerA→先頭スロット、playerB→2番目のスロット)にフォールバックする。
function assignPlayersToSlots(faceSlots, playerA, playerB) {
  const aGender = playerA.gender === 'female' ? 'female' : 'male';
  const bGender = playerB.gender === 'female' ? 'female' : 'male';
  const slotGenders = faceSlots.map((slot) => slot.gender || null);

  if (slotGenders[0] && slotGenders[1] && slotGenders[0] !== slotGenders[1] && aGender !== bGender) {
    return faceSlots.map((slot) => (slot.gender === aGender ? playerA : playerB));
  }
  return [playerA, playerB];
}

// 顔ハメ合成画像(旅行スポット画面用)を描画する。
// 背景写真に実際に写っている人物の顔の位置(category.faceSlots)に、プレイヤーの顔写真を直接はめ込む。
export async function drawTravelComposite(canvas, { categoryKey, categories, playerA, playerB }) {
  const ctx = canvas.getContext('2d');
  const category = categories[categoryKey];
  canvas.width = category.canvas.width;
  canvas.height = category.canvas.height;

  const bgImg = await loadImage('/' + category.backgroundImage);
  drawCover(ctx, bgImg, 0, 0, canvas.width, canvas.height);

  const assigned = assignPlayersToSlots(category.faceSlots, playerA, playerB);

  for (let i = 0; i < category.faceSlots.length; i++) {
    const slot = category.faceSlots[i];
    const player = assigned[i];
    if (!player || !player.photo) continue;

    const faceImg = await loadImage(player.photo);
    drawFaceIntoHole(ctx, faceImg, slot.faceHole, slot.rotation, slot.feather);
  }
}

// キャンバスに折り返しつきでテキストを描画し、描画後のY座標を返す(日本語は文字単位で折り返す)
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  let line = '';
  let curY = y;
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      ctx.fillText(line, x, curY);
      line = ch;
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, curY);
    curY += lineHeight;
  }
  return curY;
}

const PAGE_W = 1240;
const PAGE_H = 1754;

// PDF/スマホ用ページ 1枚目: 2人の写真+ニックネーム、相性%、コメント、回答一覧
export function buildResultPage1Canvas({ photoAImg, photoBImg, nicknameA, nicknameB, compatibility, comment, answerSummary }) {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#fff6f8';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  ctx.fillStyle = '#e8618c';
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('♥ 相性診断結果 ♥', PAGE_W / 2, 100);

  const photoSize = 320;
  const gap = 80;
  const totalW = photoSize * 2 + gap;
  const startX = (PAGE_W - totalW) / 2;
  const photoY = 150;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(startX, photoY, photoSize, photoSize, 24);
  ctx.clip();
  drawCover(ctx, photoAImg, startX, photoY, photoSize, photoSize);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(startX + photoSize + gap, photoY, photoSize, photoSize, 24);
  ctx.clip();
  drawCover(ctx, photoBImg, startX + photoSize + gap, photoY, photoSize, photoSize);
  ctx.restore();

  ctx.fillStyle = '#7a4a5a';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(nicknameA, startX + photoSize / 2, photoY + photoSize + 50);
  ctx.fillText(nicknameB, startX + photoSize + gap + photoSize / 2, photoY + photoSize + 50);

  ctx.fillStyle = '#e8618c';
  ctx.font = 'bold 110px sans-serif';
  ctx.fillText(`${compatibility}%`, PAGE_W / 2, photoY + photoSize + 210);

  ctx.fillStyle = '#7a4a5a';
  ctx.font = '32px sans-serif';
  ctx.textAlign = 'left';
  let y = photoY + photoSize + 290;
  y = wrapText(ctx, comment, 90, y, PAGE_W - 180, 46);

  y += 30;
  ctx.font = 'bold 34px sans-serif';
  ctx.fillStyle = '#e8618c';
  ctx.fillText('だれが何を選んだか', 90, y);
  y += 20;

  ctx.font = '28px sans-serif';
  ctx.fillStyle = '#7a4a5a';
  answerSummary.forEach((item) => {
    y += 46;
    if (y > PAGE_H - 60) return;
    ctx.fillText(`${item.question}`, 90, y);
    y += 38;
    ctx.fillStyle = '#f0895f';
    ctx.fillText(`${item.a.nickname}:${item.a.choice}  /  ${item.b.nickname}:${item.b.choice}`, 110, y);
    ctx.fillStyle = '#7a4a5a';
  });

  return canvas;
}

// wrapTextと同じ折り返しルールで行数だけを事前計算する(余白のないキャンバス高さを決めるため)
function countWrappedLines(ctx, text, maxWidth) {
  let line = '';
  let lines = 0;
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      lines += 1;
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines += 1;
  return lines;
}

// PDF/スマホ用ページ 2枚目: 旅行スポットの合成画像(白枠付き)+地名+理由
// 内容の分だけの高さにして、下の余白ができないようにする
export function buildResultPage2Canvas({ travelCanvas, spotName, reason }) {
  const frameMargin = 40;
  const imgW = PAGE_W - 200;
  const imgH = imgW * (travelCanvas.height / travelCanvas.width);
  const frameX = (PAGE_W - imgW) / 2 - frameMargin;
  const frameY = 150;
  const reasonFont = '32px sans-serif';

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  measureCtx.font = reasonFont;
  const reasonLines = countWrappedLines(measureCtx, reason, PAGE_W - 200);

  const spotNameY = frameY + imgH + frameMargin * 2 + 80;
  const reasonStartY = spotNameY + 70;
  const bottomPadding = 60;
  const canvasHeight = Math.round(reasonStartY + reasonLines * 46 - 46 + bottomPadding);

  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#fff6f8';
  ctx.fillRect(0, 0, PAGE_W, canvasHeight);

  ctx.fillStyle = '#e8618c';
  ctx.font = 'bold 52px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('♥ おすすめ旅行スポット ♥', PAGE_W / 2, 100);

  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(255, 150, 190, 0.4)';
  ctx.shadowBlur = 30;
  ctx.fillRect(frameX, frameY, imgW + frameMargin * 2, imgH + frameMargin * 2);
  ctx.shadowBlur = 0;

  ctx.drawImage(travelCanvas, frameX + frameMargin, frameY + frameMargin, imgW, imgH);

  ctx.fillStyle = '#e8618c';
  ctx.font = 'bold 60px sans-serif';
  ctx.fillText(spotName, PAGE_W / 2, spotNameY);

  ctx.fillStyle = '#7a4a5a';
  ctx.font = reasonFont;
  ctx.textAlign = 'left';
  wrapText(ctx, reason, 100, reasonStartY, PAGE_W - 200, 46);

  return canvas;
}
