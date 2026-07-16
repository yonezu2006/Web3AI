const fs = require('fs');
const path = require('path');
const express = require('express');
const { getResultById } = require('./resultStore');

// 結果ページ(/kekka/:pairId)まわりのルート。LAN用サーバーと公開用トンネルサーバーの両方から使い回す。
function createKekkaRouter() {
  const router = express.Router();

  router.get('/kekka/:pairId', (req, res) => {
    const result = getResultById(req.params.pairId);
    if (!result) {
      return res
        .status(404)
        .send(
          '<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding:3rem;">結果が見つかりませんでした。<br>URLが正しいか確認してください。</body>'
        );
    }
    const meta = result.meta || {};
    res.send(`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>相性診断の結果</title>
<style>
  body { margin:0; background:#fff0f5; color:#7a4a5a; font-family:"Hiragino Maru Gothic ProN","Hiragino Sans","Yu Gothic",sans-serif; }
  .page { width:100%; display:block; }
  .notice { text-align:center; padding: 14px 10px; background:#ffe0ec; font-size:14px; line-height:1.6; border-top: 1px solid #ffc2da; }
  .notice strong { color:#e8618c; }
</style>
</head>
<body>
  <div class="notice"><strong>長押しで保存できます</strong><br>画像を長押しして「写真に追加」を選ぶと保存できます</div>
  <img class="page" src="${result.page1Url}" alt="診断結果 1ページ目">
  <img class="page" src="${result.page2Url}" alt="診断結果 2ページ目(旅行スポット)">
  <div class="notice">${meta.nickname1 || ''} &amp; ${meta.nickname2 || ''} の相性診断結果</div>
</body>
</html>`);
  });

  router.get('/kekka/:pairId/:file', (req, res) => {
    const result = getResultById(req.params.pairId);
    if (!result) return res.status(404).send('not found');
    const allowed = { 'page1.png': 'page1.png', 'page2.png': 'page2.png', 'result.pdf': 'result.pdf' };
    const fileName = allowed[req.params.file];
    if (!fileName) return res.status(404).send('not found');
    const filePath = path.join(result.folderPath, fileName);
    if (!fs.existsSync(filePath)) return res.status(404).send('not found');
    res.sendFile(filePath);
  });

  return router;
}

module.exports = { createKekkaRouter };
