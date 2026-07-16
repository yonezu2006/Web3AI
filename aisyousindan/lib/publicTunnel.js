// QRコードの読み込み先(結果ページ)を、ホストのWi-Fi/テザリングに繋がっていない
// 普通のスマホ(モバイルデータ)からでも開けるようにするためのngrokトンネル。
// NGROK_AUTHTOKENが未設定/接続失敗の場合はnullを返し、呼び出し側はLAN内URLにフォールバックする。
async function startPublicTunnel(port) {
  if (!process.env.NGROK_AUTHTOKEN) {
    console.warn('[tunnel] NGROK_AUTHTOKEN未設定のため、QRはLAN内からのみアクセス可能なURLになります。');
    return null;
  }
  try {
    const ngrok = require('@ngrok/ngrok');
    const listener = await ngrok.forward({ addr: port, authtoken_from_env: true });
    const url = listener.url();
    console.log(`[tunnel] 公開URLを発行しました: ${url}`);
    return url;
  } catch (err) {
    console.warn('[tunnel] ngrokトンネルの起動に失敗しました。QRはLAN内からのみアクセス可能なURLになります:', err.message);
    return null;
  }
}

module.exports = { startPublicTunnel };
