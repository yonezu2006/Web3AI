import { createAxiosClient } from 'x402-axios';
import dotenv from 'dotenv';

// .env から環境変数を読み込む
dotenv.config();

const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
const WALLET = process.env.WALLET_ADDRESS;

if (!PRIVATE_KEY || !WALLET) {
  console.error('WALLET_PRIVATE_KEY と WALLET_ADDRESS を .env ファイルに設定してください。');
  console.error('.env.template をコピーして .env を作成し、値を設定してください。');
  process.exit(1);
}

// 秘密鍵のフォーマットチェック（0xプレフィックスの補正など）
let formattedPrivateKey = PRIVATE_KEY.trim();
if (!formattedPrivateKey.startsWith('0x')) {
  formattedPrivateKey = '0x' + formattedPrivateKey;
}

const client = createAxiosClient(formattedPrivateKey);

console.log('Jibot にハンドシェイクを送信中...');

try {
  const response = await client.post('https://jibot.md/api/handshake', {
    wallet: WALLET.trim()
  });

  console.log('Response:', response.data);
} catch (error) {
  console.error('エラーが発生しました:');
  if (error.response) {
    console.error('Status:', error.response.status);
    console.error('Data:', error.response.data);
  } else {
    console.error(error.message);
  }
}
