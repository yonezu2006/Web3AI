// 効果音・BGMをWeb Audio APIでその場で合成する(外部音声ファイル不要、オフラインでも動作)。
// ブラウザの自動再生制限のため、最初のユーザー操作の中でinitAudio()を呼ぶこと。

let audioCtx = null;
let musicTimer = null;
let musicPlaying = false;
let currentTrackId = 'pop';

export function initAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function now() {
  return audioCtx.currentTime;
}

// 単発の音(サイン波等)をアタック/ディケイ付きで鳴らす
function tone({ freq, start = 0, duration = 0.15, type = 'sine', volume = 0.25, glideTo = null }) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now() + start);
  if (glideTo) {
    osc.frequency.exponentialRampToValueAtTime(glideTo, now() + start + duration);
  }
  gain.gain.setValueAtTime(0, now() + start);
  gain.gain.linearRampToValueAtTime(volume, now() + start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now() + start + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now() + start);
  osc.stop(now() + start + duration + 0.05);
}

// ホワイトノイズのバースト(シャッター音のメカ音・余韻に使う)
function noiseBurst({ start = 0, duration = 0.06, volume = 0.3, filterFreq = null }) {
  if (!audioCtx) return;
  const bufferSize = Math.floor(audioCtx.sampleRate * duration);
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 1.5);
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(volume, now() + start);
  let node = src;
  if (filterFreq) {
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    node.connect(filter);
    node = filter;
  }
  node.connect(gain);
  gain.connect(audioCtx.destination);
  src.start(now() + start);
}

// ボタン押下時の「ぽよっ」という弾む音
export function playClick() {
  if (!audioCtx) return;
  tone({ freq: 880, glideTo: 440, duration: 0.12, type: 'sine', volume: 0.22 });
}

// カメラのシャッター音(メカ音のクリック+長めの余韻)
export function playShutter() {
  if (!audioCtx) return;
  noiseBurst({ start: 0, duration: 0.05, volume: 0.35 });
  tone({ freq: 1800, start: 0, duration: 0.04, type: 'square', volume: 0.15 });
  noiseBurst({ start: 0.08, duration: 0.07, volume: 0.28 });
  tone({ freq: 1200, start: 0.08, duration: 0.05, type: 'square', volume: 0.12 });
  noiseBurst({ start: 0.1, duration: 0.55, volume: 0.1, filterFreq: 2200 });
  tone({ freq: 600, start: 0.12, duration: 0.6, type: 'sine', volume: 0.05 });
}

// 旅行スポット表示時の「きらきら」という上昇アルペジオ
export function playSparkle() {
  if (!audioCtx) return;
  const notes = [1046.5, 1318.5, 1568, 2093, 2637]; // C6,E6,G6,C7,E7
  notes.forEach((freq, i) => {
    tone({ freq, start: i * 0.09, duration: 0.35, type: 'triangle', volume: 0.18 });
  });
}

// ---------- BGM候補(3種類。playBgmTrack(id)で選んで再生できる) ----------
const TRACKS = {
  // 案1: ポップなラブソング(C-G-Am-F、王道J-POP進行、軽快)
  pop: {
    label: 'ポップなラブソング(C-G-Am-F)',
    chords: [
      { bass: 130.81, notes: [261.63, 329.63, 392.0] }, // C
      { bass: 98.0, notes: [196.0, 246.94, 293.66] }, // G
      { bass: 110.0, notes: [220.0, 261.63, 329.63] }, // Am
      { bass: 87.31, notes: [174.61, 220.0, 261.63] } // F
    ],
    noteGap: 0.24,
    noteDur: 0.5,
    instrument: 'triangle',
    pattern: [0, 1, 2]
  },
  // 案2: カフェ風ボサノバ(Cmaj7-Am7-Dm7-G7、おしゃれで柔らかい)
  bossa: {
    label: 'カフェ風ボサノバ(Cmaj7-Am7-Dm7-G7)',
    chords: [
      { bass: 130.81, notes: [261.63, 329.63, 392.0, 493.88] }, // Cmaj7
      { bass: 110.0, notes: [220.0, 261.63, 329.63, 392.0] }, // Am7
      { bass: 146.83, notes: [293.66, 349.23, 440.0, 523.25] }, // Dm7
      { bass: 98.0, notes: [196.0, 246.94, 293.66, 349.23] } // G7
    ],
    noteGap: 0.27,
    noteDur: 0.6,
    instrument: 'sine',
    pattern: [0, 1, 2, 3]
  },
  // 案2b: カフェ風ボサノバ・アップテンポ版(同じ和音・音色でテンポアップ+キャッチーな跳ねるパターン)
  'bossa-fast': {
    label: 'カフェ風ボサノバ(アップテンポ・キャッチー)',
    chords: [
      { bass: 130.81, notes: [261.63, 329.63, 392.0, 493.88] }, // Cmaj7
      { bass: 110.0, notes: [220.0, 261.63, 329.63, 392.0] }, // Am7
      { bass: 146.83, notes: [293.66, 349.23, 440.0, 523.25] }, // Dm7
      { bass: 98.0, notes: [196.0, 246.94, 293.66, 349.23] } // G7
    ],
    noteGap: 0.15,
    noteDur: 0.22,
    instrument: 'triangle',
    pattern: [0, 2, 1, 3, 2, 1]
  },
  // 案2c: カフェ風ボサノバ・スキップ版(長→短の跳ねる「スキップ」リズム、8和音の長めのフレーズ)
  'bossa-skip': {
    label: 'カフェ風ボサノバ・スキップ(長めフレーズ)',
    chords: [
      { bass: 130.81, notes: [261.63, 329.63, 392.0, 493.88] }, // Cmaj7
      { bass: 110.0, notes: [220.0, 261.63, 329.63, 392.0] }, // Am7
      { bass: 146.83, notes: [293.66, 349.23, 440.0, 523.25] }, // Dm7
      { bass: 98.0, notes: [196.0, 246.94, 293.66, 349.23] }, // G7
      { bass: 87.31, notes: [174.61, 220.0, 261.63, 329.63] }, // Fmaj7
      { bass: 164.81, notes: [329.63, 392.0, 493.88, 587.33] }, // Em7
      { bass: 146.83, notes: [293.66, 349.23, 440.0, 523.25] }, // Dm7
      { bass: 98.0, notes: [196.0, 246.94, 293.66, 349.23] } // G7
    ],
    instrument: 'triangle',
    swing: true,
    beatDur: 0.34,
    pattern: [0, 2, 1, 3, 2, 1]
  },
  // 案3: アイドル風キュートラブ(C-Am-F-G、跳ねるように弾む)
  idol: {
    label: 'アイドル風キュートラブ(C-Am-F-G)',
    chords: [
      { bass: 130.81, notes: [261.63, 329.63, 392.0] }, // C
      { bass: 110.0, notes: [220.0, 261.63, 329.63] }, // Am
      { bass: 87.31, notes: [174.61, 220.0, 261.63] }, // F
      { bass: 98.0, notes: [196.0, 246.94, 293.66] } // G
    ],
    noteGap: 0.16,
    noteDur: 0.13,
    instrument: 'triangle',
    pattern: [0, 1, 2, 1]
  }
};

// 「長→短」の跳ねる(スキップする)リズムでの各音の開始タイミングと長さを計算する。
// 2音ひと組(長:0.62拍/短:0.38拍)で1拍になる、スキップやシャッフルのような弾む感じ。
function swingTimings(patternLen, beatDur) {
  const timings = [];
  let t = 0;
  for (let i = 0; i < patternLen; i += 2) {
    const isLastSingle = i === patternLen - 1;
    if (isLastSingle) {
      timings.push({ offset: t, dur: beatDur * 0.9 });
      t += beatDur;
    } else {
      timings.push({ offset: t, dur: beatDur * 0.55 });
      timings.push({ offset: t + beatDur * 0.62, dur: beatDur * 0.32 });
      t += beatDur;
    }
  }
  return { timings, total: t };
}

function scheduleTrackLoop(trackId) {
  if (!musicPlaying || !audioCtx || currentTrackId !== trackId) return;
  const track = TRACKS[trackId];
  let t = 0;
  track.chords.forEach((chord) => {
    const patternLen = track.pattern.length;

    if (track.swing) {
      const { timings, total } = swingTimings(patternLen, track.beatDur);
      tone({ freq: chord.bass, start: t, duration: total * 0.95, type: 'sine', volume: 0.05 });
      track.pattern.forEach((noteIndex, i) => {
        const freq = chord.notes[noteIndex];
        tone({ freq, start: t + timings[i].offset, duration: timings[i].dur, type: track.instrument, volume: 0.08 });
      });
      t += total;
      return;
    }

    const chordDuration = track.noteGap * patternLen + track.noteDur;
    tone({ freq: chord.bass, start: t, duration: chordDuration * 0.95, type: 'sine', volume: 0.05 });
    track.pattern.forEach((noteIndex, i) => {
      const freq = chord.notes[noteIndex];
      tone({ freq, start: t + i * track.noteGap, duration: track.noteDur, type: track.instrument, volume: 0.07 });
    });
    t += chordDuration;
  });
  musicTimer = setTimeout(() => scheduleTrackLoop(trackId), t * 1000);
}

// BGMを指定トラックで再生する(既に再生中なら切り替える)
export function playBgmTrack(trackId) {
  if (!audioCtx || !TRACKS[trackId]) return;
  currentTrackId = trackId;
  musicPlaying = true;
  if (musicTimer) clearTimeout(musicTimer);
  scheduleTrackLoop(trackId);
}

export function getTrackList() {
  return Object.keys(TRACKS).map((id) => ({ id, label: TRACKS[id].label }));
}

export function startBackgroundMusic(trackId = 'bossa-skip') {
  if (musicPlaying || !audioCtx) return;
  playBgmTrack(trackId);
}

export function stopBackgroundMusic() {
  musicPlaying = false;
  if (musicTimer) clearTimeout(musicTimer);
  musicTimer = null;
}
