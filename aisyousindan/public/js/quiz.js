// 8問クイズの進行管理

let questionsCache = null;

export async function loadQuestions() {
  if (!questionsCache) {
    const res = await fetch('/data/questions.json');
    questionsCache = await res.json();
  }
  return questionsCache;
}

// questions: [{id, text, options:[{value,label}]}]
// onComplete(answers) が全問回答後に呼ばれる
export function runQuiz(questions, elements, onComplete) {
  const { progressEl, questionEl, optionsEl } = elements;
  const answers = {};
  let index = 0;

  function renderQuestion() {
    const q = questions[index];
    progressEl.textContent = `質問 ${index + 1} / ${questions.length}`;
    questionEl.textContent = q.text;
    optionsEl.innerHTML = '';
    q.options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opt.label;
      btn.addEventListener('click', () => {
        answers[q.id] = opt.value;
        index += 1;
        if (index < questions.length) {
          renderQuestion();
        } else {
          onComplete(answers);
        }
      });
      optionsEl.appendChild(btn);
    });
  }

  index = 0;
  renderQuestion();
}
