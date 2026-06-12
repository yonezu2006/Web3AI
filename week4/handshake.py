import os
import sys
import requests
from dotenv import load_dotenv
from eth_account import Account
from x402 import x402ClientSync
from x402.mechanisms.evm.exact import ExactEvmScheme
from x402.mechanisms.evm.signers import EthAccountSigner
from x402.http.clients import wrapRequestsWithPayment

# .env から環境変数を読み込む
load_dotenv()

private_key = os.environ.get('WALLET_PRIVATE_KEY')
wallet_address = os.environ.get('WALLET_ADDRESS')

if not private_key or not wallet_address:
    print('WALLET_PRIVATE_KEY と WALLET_ADDRESS を .env ファイルに設定してください。')
    sys.exit(1)

# 秘密鍵の補正
private_key = private_key.strip()
if not private_key.startswith('0x'):
    private_key = '0x' + private_key

# 1. Signerの作成
account = Account.from_key(private_key)
signer = EthAccountSigner(account)

# 2. x402 クライアントの作成とスキーム登録
x402_client = x402ClientSync()
# Optimism (eip155:10) を登録
x402_client.register("eip155:10", ExactEvmScheme(signer=signer))

# 3. requests セッションを x402 でラップ
session = requests.Session()
wrapRequestsWithPayment(session, x402_client)

print('Jibot にハンドシェイクを送信中...')

try:
    response = session.post(
        'https://jibot.md/api/handshake',
        json={'wallet': wallet_address.strip()}
    )
    print('Response status code:', response.status_code)
    try:
        print('Response JSON:', response.json())
    except Exception:
        print('Response text:', response.text)
except Exception as e:
    print('エラーが発生しました:', e)
