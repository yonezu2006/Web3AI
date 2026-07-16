// カメラ制御 + 撮影ガイド枠(点線の楕円)に基づく切り抜き

// ガイド枠のCSS上の位置(style.cssの .guide-frame と一致させる)
const GUIDE_FRAME_RATIO = { left: 0.27, top: 0.12, width: 0.46, height: 0.66 };
const OUTPUT_SIZE = 480;

export async function startCamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false
  });
  videoEl.srcObject = stream;
  await new Promise((resolve) => {
    videoEl.onloadedmetadata = () => resolve();
  });
  return stream;
}

export function stopCamera(stream) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
}

function guideFrameRectPx(width, height) {
  return {
    x: width * GUIDE_FRAME_RATIO.left,
    y: height * GUIDE_FRAME_RATIO.top,
    width: width * GUIDE_FRAME_RATIO.width,
    height: height * GUIDE_FRAME_RATIO.height
  };
}

// ガイド枠は横幅より縦幅の方が長い縦長の楕円なので、カメラの実際のアスペクト比に関わらず
// 常に「縦のサイズ」を基準に正方形の切り抜きサイズを決める。
// verticalShiftRatioを指定すると、切り抜き位置を中心から下(サイズに対する割合)にずらせる。
function squareClamp(rect, maxWidth, maxHeight, paddingRatio, verticalShiftRatio = 0) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const size = rect.height * (1 + paddingRatio);
  let x = cx - size / 2;
  let y = cy - size / 2 + size * verticalShiftRatio;
  let s = size;
  x = Math.max(0, Math.min(x, maxWidth - s > 0 ? maxWidth - s : 0));
  y = Math.max(0, Math.min(y, maxHeight - s > 0 ? maxHeight - s : 0));
  s = Math.min(s, maxWidth, maxHeight);
  return { x, y, width: s, height: s };
}

// 撮影して、画面に表示しているガイド枠(点線の楕円)の範囲をそのまま正方形に切り抜いたdataURLを返す
export async function capturePhoto(videoEl) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;

  const mirrored = document.createElement('canvas');
  mirrored.width = w;
  mirrored.height = h;
  const mctx = mirrored.getContext('2d');
  // プレビューは鏡写し表示なので、見たままの見た目で保存されるよう左右反転して描画する
  mctx.translate(w, 0);
  mctx.scale(-1, 1);
  mctx.drawImage(videoEl, 0, 0, w, h);

  // 点線ガイドぴったりだと顔ハメ合成時に顔がやや小さく見えるため、少し内側(縦サイズの85%)を切り抜く。
  // また中心のままだと上に寄りすぎるため、切り抜き範囲を少し下にずらす
  const cropRect = guideFrameRectPx(w, h);
  const square = squareClamp(cropRect, w, h, -0.15, 0.12);

  const out = document.createElement('canvas');
  out.width = OUTPUT_SIZE;
  out.height = OUTPUT_SIZE;
  const octx = out.getContext('2d');
  octx.drawImage(mirrored, square.x, square.y, square.width, square.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

  return out.toDataURL('image/png');
}
