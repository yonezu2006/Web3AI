const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CERT_DIR = path.join(__dirname, '..', 'certs');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');
const META_PATH = path.join(CERT_DIR, 'meta.json');

// LAN内のカメラ利用(getUserMedia)にはHTTPSが必須なため、起動時に自己署名証明書を用意する。
// アクセス先IPが変わったら証明書を作り直す(IPをSubject Alternative Nameに含める必要があるため)。
function ensureCert(lanIp) {
  fs.mkdirSync(CERT_DIR, { recursive: true });

  const meta = fs.existsSync(META_PATH) ? JSON.parse(fs.readFileSync(META_PATH, 'utf-8')) : null;
  const upToDate =
    meta &&
    meta.lanIp === lanIp &&
    fs.existsSync(KEY_PATH) &&
    fs.existsSync(CERT_PATH);

  if (!upToDate) {
    console.log(`[cert] ${lanIp} 用の自己署名証明書を生成しています...`);
    const san = `subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${lanIp}`;
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        KEY_PATH,
        '-out',
        CERT_PATH,
        '-days',
        '825',
        '-subj',
        '/CN=aisyousindan',
        '-addext',
        san
      ],
      { stdio: 'pipe' }
    );
    fs.writeFileSync(META_PATH, JSON.stringify({ lanIp, createdAt: new Date().toISOString() }, null, 2));
  }

  return {
    key: fs.readFileSync(KEY_PATH),
    cert: fs.readFileSync(CERT_PATH)
  };
}

module.exports = { ensureCert };
