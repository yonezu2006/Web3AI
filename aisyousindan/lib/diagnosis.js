const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const questions = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'questions.json'), 'utf-8')
);
const categoriesData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'categories.json'), 'utf-8')
);
const categories = categoriesData.categories;
const categoryKeys = Object.keys(categories);

function questionLabel(qId, value) {
  const q = questions.find((x) => x.id === qId);
  if (!q) return value;
  const opt = q.options.find((o) => o.value === value);
  return opt ? opt.label : value;
}

function questionText(qId) {
  const q = questions.find((x) => x.id === qId);
  return q ? q.text : qId;
}

// 質問2〜8について「誰が何を選んだか」の一覧を作る(結果画面の下部一覧・PDF用)
function buildAnswerSummary(playerA, playerB) {
  return questions
    .filter((q) => !q.isGender)
    .map((q) => ({
      question: q.text,
      a: { nickname: playerA.nickname, choice: questionLabel(q.id, playerA.answers[q.id]) },
      b: { nickname: playerB.nickname, choice: questionLabel(q.id, playerB.answers[q.id]) }
    }));
}

// 4カテゴリ(宇宙/洋風の町並み/花園/南国ビーチ)それぞれとの相性を回答から素点化する。
// uchu:非日常・インドア・AI好き / youfu-machinami:都会的・アクティブ / hanazono:ロマンチック・上品・癒し / beach:南国・開放的
// 各質問は必ずどれか2カテゴリだけに+1点となるようにして、特定カテゴリだけが選ばれやすくならないようにしている。
function scoreCategoryFor(player) {
  const a = player.answers;
  const score = { uchu: 0, 'youfu-machinami': 0, hanazono: 0, beach: 0 };
  if (a.q2 === 'indoor') score.uchu += 1;
  else score.beach += 1;
  if (a.q3 === 'boke') score['youfu-machinami'] += 1;
  else score.hanazono += 1;
  if (a.q4 === 'friend') score.uchu += 1;
  else score['youfu-machinami'] += 1;
  if (a.q5 === 'ai') score.uchu += 1;
  else score.hanazono += 1;
  if (a.q6 === 'give') score.hanazono += 1;
  else score.beach += 1;
  if (a.q7 === 'perfect') score.hanazono += 1;
  else score.beach += 1;
  if (a.q8 === 'ai_pref') score.uchu += 1;
  else score['youfu-machinami'] += 1;
  return score;
}

function pickCategoryKey(playerA, playerB) {
  const sa = scoreCategoryFor(playerA);
  const sb = scoreCategoryFor(playerB);
  const keys = Object.keys(sa);
  const totals = {};
  keys.forEach((k) => {
    totals[k] = sa[k] + sb[k];
  });
  // 同点の場合に先頭のキーだけが常に選ばれてしまわないよう、最高得点のキーの中からランダムに選ぶ
  const maxScore = Math.max(...keys.map((k) => totals[k]));
  const topKeys = keys.filter((k) => totals[k] === maxScore);
  return topKeys[Math.floor(Math.random() * topKeys.length)];
}

function fallbackCompatibility(playerA, playerB) {
  let score = 45;
  const a = playerA.answers;
  const b = playerB.answers;
  // ボケ/ツッコミが噛み合っている(1人ずつ)ことを最重要視して大きく加点
  if ((a.q3 === 'boke' && b.q3 === 'tsukkomi') || (a.q3 === 'tsukkomi' && b.q3 === 'boke')) score += 25;
  else score -= 10;
  // 傘も同様に、あげたい人ともらいたい人の組み合わせを最重要視して大きく加点
  if ((a.q6 === 'give' && b.q6 === 'receive') || (a.q6 === 'receive' && b.q6 === 'give')) score += 25;
  else score -= 10;
  // ここから下は補助的な要素(小さめの加点)
  // インドア/アウトドアが一致していると加点
  if (a.q2 === b.q2) score += 6;
  else score -= 3;
  // AI観が一致
  if (a.q4 === b.q4) score += 5;
  if (a.q5 === b.q5) score += 4;
  // 準備タイプが噛み合っていると加点(完璧側が遅刻側をフォローできる)
  if ((a.q7 === 'perfect' && b.q7 === 'late') || (a.q7 === 'late' && b.q7 === 'perfect')) score += 6;
  // AI恋人観が一致
  if (a.q8 === b.q8) score += 5;
  score += Math.floor(Math.random() * 5) - 2;
  return Math.max(25, Math.min(99, score));
}

// 各質問について、回答の組み合わせから「性格の癖」を茶化し気味に指摘するコメントを1つ作る。
// 単に回答を並べるのではなく、そこから連想できそうな一言(軽いジョーク込み)を返す。
function quirkFor(qId, playerA, playerB) {
  const a = playerA.answers[qId];
  const b = playerB.answers[qId];
  const nameA = playerA.nickname;
  const nameB = playerB.nickname;
  const pick = (value, nameIfA, nameIfB) => (a === value ? nameIfA : nameIfB);

  switch (qId) {
    case 'q2': {
      if (a === 'indoor' && b === 'indoor') {
        return `二人ともインドア派。休日は家でゲーム三昧になって、うっかり恋人をほったらかしにしないでくださいね(冗談)。`;
      }
      if (a === 'outdoor' && b === 'outdoor') {
        return `二人ともじっとしていられないアウトドア派。予定を詰め込みすぎて、たまにはお互い家でゴロゴロする日も作ってあげてください。`;
      }
      const indoorName = pick('indoor', nameA, nameB);
      const outdoorName = pick('outdoor', nameA, nameB);
      return `${indoorName}さんは家でまったり派、${outdoorName}さんは外に飛び出したい派。休日の予定はこまめにすり合わせたほうがよさそうです。`;
    }
    case 'q3': {
      if (a === b) {
        return a === 'boke'
          ? `二人ともボケ担当。ツッコむ人が誰もいないので、会話がどんどん斜め上に脱線していきそうです。たまには片方が冷静なツッコミ役に回ってみると新鮮かも。`
          : `二人ともツッコミ気質。息はぴったりですが、誰かがボケてくれないと会話が始まらない…なんてことになりがちかもしれません。`;
      }
      const bokeName = pick('boke', nameA, nameB);
      const tsukkomiName = pick('boke', nameB, nameA);
      return `${bokeName}さんのボケに${tsukkomiName}さんがすかさずツッコむ、王道の掛け合いコンビ。息ぴったりの好相性です。`;
    }
    case 'q4': {
      if (a === 'friend' && b === 'friend') {
        return `AIのことも「仲間」だと思う優しい二人。ただしAIに構いすぎて、目の前の相手をほったらかしにしないよう気をつけて(冗談)。`;
      }
      if (a === 'tool' && b === 'tool') {
        return `AIは「道具」と割り切る実用派同士。ドライに見えて、実は根っこはしっかり者な二人かもしれません。`;
      }
      const friendName = pick('friend', nameA, nameB);
      const toolName = pick('tool', nameA, nameB);
      return `${friendName}さんはAIも仲間だと思う派、${toolName}さんは道具として割り切る派。テクノロジーとの距離感の違いが、日常のちょっとしたすれ違いになるかもしれません。`;
    }
    case 'q5': {
      if (a === 'ai' && b === 'ai') {
        return `恋愛相談はまず二人ともAI派。本人に直接聞く前に、こっそりAIに聞いてしまうタイプかもしれません(たまには本人にも聞いてあげて)。`;
      }
      if (a === 'human' && b === 'human') {
        return `恋愛相談はしっかり人に頼る二人。友人付き合いを大事にする、頼れるタイプと言えそうです。`;
      }
      return `恋愛相談の相手はAI派と人間派で分かれました。困ったときの頼り先が違うので、たまにはお互いの相談内容も共有してみると発見がありそうです。`;
    }
    case 'q6': {
      if (a === 'give' && b === 'give') {
        return `二人とも傘をつい相手に譲ってしまう優しいタイプ。相合傘を譲り合った結果、二人ともずぶ濡れになる未来が見えます(笑)。`;
      }
      if (a === 'receive' && b === 'receive') {
        return `二人とも「差してもらう」派。傘を持ってくるのをどちらも忘れそうなので、天気予報だけは欠かさずチェックしてください。`;
      }
      const giveName = pick('give', nameA, nameB);
      const receiveName = pick('give', nameB, nameA);
      return `雨の日は${giveName}さんが傘を差してあげて、${receiveName}さんがちゃっかり甘える。この二人らしい、ちょうどいい距離感です。`;
    }
    case 'q7': {
      if (a === 'perfect' && b === 'perfect') {
        return `二人とも準備は完璧主義。待ち合わせに遅れることはなさそうですが、気合を入れすぎて前日から疲れてしまわないように。`;
      }
      if (a === 'late' && b === 'late') {
        return `二人とも支度はギリギリ派。待ち合わせ場所にはいつも二人そろって少し遅れて登場する、そんな未来が目に浮かびます(笑)。`;
      }
      const perfectName = pick('perfect', nameA, nameB);
      const lateName = pick('perfect', nameB, nameA);
      return `デート前、${perfectName}さんは支度完璧なのに${lateName}さんはギリギリ...そんな凸凹感が逆にいいアクセントになりそうです。`;
    }
    case 'q8': {
      if (a === 'ai_pref' && b === 'ai_pref') {
        return `二人ともAIを恋人にしてもいいと思うタイプ。将来はロボットとの同居生活も本気で検討していそうです(笑)。`;
      }
      if (a === 'human_pref' && b === 'human_pref') {
        return `二人とも「やっぱり人間がいい」と思う、地に足のついたタイプ。現実的な恋愛観を大事にする二人です。`;
      }
      return `AIを恋人にすることへの考え方は正反対。この先テクノロジーがどんどん身近になる中で、たまにこの話題で語り合ってみるのも面白いかもしれません。`;
    }
    default:
      return '';
  }
}

function fallbackComment(playerA, playerB, compatibility) {
  const parts = [];
  parts.push(`${playerA.nickname}さんと${playerB.nickname}さんの相性は${compatibility}%!`);
  ['q3', 'q6', 'q7', 'q2', 'q4', 'q5', 'q8']
    .slice(0, 4)
    .forEach((qId) => {
      const quirk = quirkFor(qId, playerA, playerB);
      if (quirk) parts.push(quirk);
    });
  return parts.join('');
}

function fallbackDiagnose(playerA, playerB) {
  const compatibility = fallbackCompatibility(playerA, playerB);
  const comment = fallbackComment(playerA, playerB, compatibility);
  const categoryKey = pickCategoryKey(playerA, playerB);
  const category = categories[categoryKey];
  const spotName = category.spots[Math.floor(Math.random() * category.spots.length)];
  const reason = `${playerA.nickname}さんと${playerB.nickname}さんの回答からは「${category.keywords
    .slice(0, 3)
    .join('・')}」な雰囲気が感じられたので、「${spotName}」がおすすめです。`;
  return { compatibility, comment, categoryKey, spotName, reason };
}

function buildPrompt(playerA, playerB) {
  const describe = (p) =>
    `${p.nickname}(性別:${questionLabel('q1', p.answers.q1)}): ` +
    questions
      .filter((q) => !q.isGender)
      .map((q) => `${q.text}→${questionLabel(q.id, p.answers[q.id])}`)
      .join(' / ');

  const categoryList = categoryKeys
    .map((k) => `${k}: ${categories[k].label}(${categories[k].description})`)
    .join('\n');

  return `あなたは出店イベントの「相性診断ゲーム」の診断AIです。以下の2人の回答をもとに、JSON形式で診断結果を返してください。

【回答者A】${describe(playerA)}
【回答者B】${describe(playerB)}

【背景カテゴリ(この中から必ず1つ選ぶこと)】
${categoryList}

commentは、質問と回答をただ並べるのではなく、そこから連想できそうな性格の癖や日常のワンシーンを、軽いジョーク(「(冗談)」等)を交えつつ愛のこもった温かい言い方で書いてください。例:「二人ともインドア派。休日は家でゲーム三昧になって、恋人をほったらかしにしないでくださいね(冗談)」のように、具体的な回答の組み合わせから来る「あるある」を想像して書くこと。

以下のJSON形式のみで回答してください(説明文やコードブロックは不要):
{
  "compatibility": 0〜100の整数,
  "comment": "上記の方針に沿った、性格の癖やジョークを交えた相性コメント(日本語、150〜200文字程度)",
  "categoryKey": "上記カテゴリのキーのいずれか",
  "spotName": "旅行先の地名(具体的な地名)",
  "reason": "その旅行先を選んだ理由(2人の回答傾向や性別に触れて、日本語で80文字程度)"
}`;
}

async function callOpenAI(playerA, playerB) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith('sk-dummy')) {
    throw new Error('OPENAI_API_KEY is not configured (using dummy key) - skipping real API call');
  }
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: buildPrompt(playerA, playerB) }],
    response_format: { type: 'json_object' }
  });
  const text = completion.choices[0].message.content;
  const parsed = JSON.parse(text);
  if (!categoryKeys.includes(parsed.categoryKey)) {
    parsed.categoryKey = pickCategoryKey(playerA, playerB);
  }
  parsed.compatibility = Math.max(0, Math.min(100, Math.round(Number(parsed.compatibility) || 50)));
  return parsed;
}

async function diagnose(playerA, playerB) {
  let result;
  try {
    result = await callOpenAI(playerA, playerB);
  } catch (err) {
    console.warn('[diagnosis] OpenAI呼び出しをスキップしてフォールバック診断を使用します:', err.message);
    result = fallbackDiagnose(playerA, playerB);
  }
  const category = categories[result.categoryKey];
  return {
    compatibility: result.compatibility,
    comment: result.comment,
    categoryKey: result.categoryKey,
    categoryLabel: category.label,
    backgroundImage: category.backgroundImage,
    spotName: result.spotName,
    reason: result.reason,
    answerSummary: buildAnswerSummary(playerA, playerB)
  };
}

module.exports = { diagnose, questions, categories };
