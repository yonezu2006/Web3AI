const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI Elements
const screenTitle = document.getElementById('screen-title');
const screenIntro = document.getElementById('screen-intro');
const screenEnding = document.getElementById('screen-ending');
const screenGameover = document.getElementById('screen-gameover');
const uiDistance = document.getElementById('ui-distance');
const uiLives = document.getElementById('ui-lives');
const btnStart = document.getElementById('btn-start');

// Game States
const STATE = {
    TITLE: 0,
    INTRO: 1,
    PLAYING: 2,
    ENDING: 3,
    GAMEOVER: 4
};
let currentState = STATE.TITLE;

// --- Audio (Web Audio API) ---
let audioCtx;
let bgmOsc = null;
let bgmGain = null;
let bgmInterval = null;
const notes = [261.63, 329.63, 392.00, 523.25]; // C, E, G, C (明るいアルペジオ)
let noteIndex = 0;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function playClick() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

function playJump() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
}

function startBGM() {
    if (!audioCtx || bgmInterval) return;
    bgmInterval = setInterval(() => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(notes[noteIndex], audioCtx.currentTime);
        gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.2);
        noteIndex = (noteIndex + 1) % notes.length;
    }, 250);
}

function stopBGM() {
    if (bgmInterval) {
        clearInterval(bgmInterval);
        bgmInterval = null;
    }
}

// --- Pixel Art Sprites (16x16 strings) ---
const SPRITES = {
    goofy_run1: [
        "     ######     ",
        "    ########    ",
        "    ##    ##  ##",
        "    ##    ## ###",
        "    ##    ##    ",
        "    ##    ##    ",
        "    ##    ##    ",
        "      ####      ",
        "     ##  ##     ",
        "    ##    ##    ",
        "    ##    ##    ",
        "    ##     ##   ",
        "   ##      ##   ",
        "   ##       ##  ",
        "   ###      ### ",
        "   ###       ## "
    ],
    goofy_run2: [
        "     ######     ",
        "    ########    ",
        "    ##    ##  ##",
        "    ##    ## ###",
        "    ##    ##    ",
        "    ##    ##    ",
        "    ##    ##    ",
        "      ####      ",
        "      ####      ",
        "      ####      ",
        "      ## ##     ",
        "      ##  ##    ",
        "     ##   ##    ",
        "     ##   ##    ",
        "    ###    ###  ",
        "    ###    ###  "
    ],
    goofy_stand: [
        "     ######     ",
        "    ########    ",
        "    ##    ##  ##",
        "    ##    ## ###",
        "    ##    ##    ",
        "    ##    ##    ",
        "    ##    ##    ",
        "      ####      ",
        "      ####      ",
        "   ##        ##   ",
        "   ##        ##   ",
        "   ############## ",
        "   ############## ",
        "   ##  ####  ##   ",
        "   ##  ####  ##   ",
        "   ############## ",
        "    ##########    ",
        "     ########     ",
        "     ##    ##     ",
        "     ##    ##     ",
        "     ##    ##     ",
        "     ##    ##     ",
        "     ##    ##     ",
        "    ###    ###    ",
        "    ###    ###    "
    ],
    stone: [
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "      ####      ",
        "    ########    ",
        "   ##########   ",
        "  ############  ",
        " ############## ",
        "################"
    ],
    sandwich: [
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        "                ",
        " ###############",
        "  ############# ",
        "  ############# ",
        " ###############",
        "                ",
        "                ",
        "                ",
        "                ",
        "                "
    ],
    supermarket: [ // 32x32 size logically
        "             ######             ",
        "          ############          ",
        "         # SUPER MARKET #       ",
        "        #                #      ",
        "       ####################     ",
        "       #                  #     ",
        "       #                  #     ",
        "       #    ###    ###    #     ",
        "       #    ###    ###    #     ",
        "       #    ###    ###    #     ",
        "       #                  #     ",
        "       #   ###      ###   #     ",
        "       #   ###      ###   #     ",
        "       #   ###      ###   #     ",
        "       ####################     "
    ]
};

function drawSprite(spriteArr, x, y, scale, overrideColor = "#111") {
    ctx.fillStyle = overrideColor;
    for (let r = 0; r < spriteArr.length; r++) {
        for (let c = 0; c < spriteArr[r].length; c++) {
            if (spriteArr[r][c] !== ' ') {
                ctx.fillRect(Math.floor(x + c * scale), Math.floor(y + r * scale), scale, scale);
            }
        }
    }
}

// --- Game Logic & Variables ---
let frames = 0;
let distance = 0; // m
const groundY = 380;
let gameSpeed = 6; // px per frame
const distancePerFrame = 20 / 60; // 20m per second (倍の速さ)
let lives = 3;

const player = {
    x: 100,
    y: groundY - 64,
    width: 64,
    height: 64,
    vy: 0,
    gravity: 0.8,
    jumpPower: -15,
    isJumping: false,
    update() {
        this.vy += this.gravity;
        this.y += this.vy;
        if (this.y >= groundY - this.height) {
            this.y = groundY - this.height;
            this.vy = 0;
            this.isJumping = false;
        }
    },
    jump() {
        if (!this.isJumping) {
            this.vy = this.jumpPower;
            this.isJumping = true;
            playJump();
        }
    },
    draw() {
        let sprite = this.isJumping ? SPRITES.goofy_run2 :
            (frames % 20 < 10 ? SPRITES.goofy_run1 : SPRITES.goofy_run2);

        // ゴール後は立ちポーズ
        if (distance >= 1000 && this.vx <= 0) sprite = SPRITES.goofy_stand;

        drawSprite(sprite, this.x, this.y, 4);
    }
};

let obstacles = [];
let nextObstacleDist = 0;
let nextItemDist = 300; // サンドイッチ出現距離
let consecutiveObstacles = 0;
let scene = 'grass'; // grass -> country -> super
let superMarketX = -1;
let gameOverSpaceCount = 0;

function spawnObstacle() {
    // 回復アイテム（サンドイッチ）の出現
    if (distance >= nextItemDist) {
        obstacles.push({ x: canvas.width, y: groundY - 64 - 20, width: 64, height: 64, type: 'sandwich', hit: false });
        nextItemDist += 300 + Math.random() * 50; // 次は約300m後
    }

    // 最初の3秒(距離30m)は出さない
    if (distance < 30) return;

    if (distance >= nextObstacleDist) {
        let width = 64;
        obstacles.push({ x: canvas.width, y: groundY - width, width: width, height: width, type: 'stone', hit: false });

        consecutiveObstacles++;

        // 連続配置するか離すか
        if (Math.random() < 0.5) {
            // 2つ連続で置く（隙間なし）
            obstacles.push({ x: canvas.width + width, y: groundY - width, width: width, height: width, type: 'stone', hit: false });
            consecutiveObstacles = 2;
        }

        // 次の石までは必ず石3つ分以上の隙間を空ける
        let gapMeters = 20 + Math.random() * 20;
        nextObstacleDist = distance + gapMeters;
        consecutiveObstacles = 0;
    }
}

// プロシージャル背景
let bgOffset = 0;
function drawBackground() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 地面線
    ctx.fillStyle = '#111';
    ctx.fillRect(0, groundY, canvas.width, 4);

    // スクロールオフセット
    bgOffset = (bgOffset + gameSpeed * 0.5) % 200;

    if (scene === 'grass') {
        // 草原：草や木
        ctx.fillStyle = '#111';
        for (let i = 0; i < 5; i++) {
            let x = (i * 200 - bgOffset + canvas.width) % (canvas.width + 200) - 200;
            // 木の描画（より細かく、上部を三角形に）
            ctx.fillRect(x + 100, groundY - 40, 10, 40); // 幹
            ctx.beginPath();
            ctx.moveTo(x + 105, groundY - 120); // 頂点
            ctx.lineTo(x + 75, groundY - 40);  // 左下
            ctx.lineTo(x + 135, groundY - 40); // 右下
            ctx.fill();
            // 草
            ctx.fillRect(x + 50, groundY - 10, 4, 10);
            ctx.fillRect(x + 160, groundY - 5, 4, 5);
        }
    }

    if (distance >= 500 && distance < 1000) {
        scene = 'country';
    }

    if (scene === 'country') {
        // 田舎：家
        ctx.fillStyle = '#111';
        for (let i = 0; i < 4; i++) {
            let x = (i * 250 - bgOffset + canvas.width) % (canvas.width + 250) - 250;
            // 家の描画
            ctx.fillRect(x + 50, groundY - 80, 100, 80); // 壁
            ctx.clearRect(x + 80, groundY - 40, 20, 20); // 窓
            // 屋根
            ctx.beginPath();
            ctx.moveTo(x + 40, groundY - 80);
            ctx.lineTo(x + 100, groundY - 130);
            ctx.lineTo(x + 160, groundY - 80);
            ctx.fill();
        }
    }

    if (distance >= 1000) {
        if (superMarketX === -1) {
            superMarketX = canvas.width; // 画面右端から出現
        }
        // スーパーマーケットの描画
        if (superMarketX > canvas.width - 400) {
            superMarketX -= gameSpeed;
        } else {
            // スーパーが定位置についたらキャラが減速して歩いて入る
            gameSpeed = 0;
            if (player.x < superMarketX + 100) {
                player.x += 2; // 歩く
            } else {
                // エンド画面へ
                if (currentState !== STATE.ENDING) {
                    setTimeout(() => {
                        changeState(STATE.ENDING);
                    }, 500);
                    currentState = STATE.ENDING; // 重複防止
                }
            }
        }

        drawSprite(SPRITES.supermarket, superMarketX, groundY - 15 * 10, 10);
    }
}

function updateGame() {
    if (currentState !== STATE.PLAYING && (currentState !== STATE.ENDING || distance < 1000)) return;

    if (gameSpeed > 0 && distance < 1000) {
        distance += distancePerFrame;
        uiDistance.innerText = Math.floor(distance) + 'm';
    }

    drawBackground();

    player.update();
    player.draw();

    // 障害物の更新と描画
    if (distance < 1000) {
        spawnObstacle();
    }

    for (let i = obstacles.length - 1; i >= 0; i--) {
        let obs = obstacles[i];
        obs.x -= gameSpeed;

        // 種類の描画
        if (obs.type === 'stone') {
            drawSprite(SPRITES.stone, obs.x, obs.y, 4);
        } else if (obs.type === 'sandwich') {
            // 浮遊アニメーション
            let hoverY = obs.y + Math.sin(frames * 0.1) * 10;
            drawSprite(SPRITES.sandwich, obs.x, hoverY, 4);
        }

        // 当たり判定 (AABB) プレイヤーのヒットボックスは少し小さめに
        let px = player.x + 16;
        let py = player.y + 16;
        let pw = player.width - 32;
        let ph = player.height - 16;

        if (px < obs.x + obs.width - 10 &&
            px + pw > obs.x + 10 &&
            py < obs.y + obs.height - 10 &&
            py + ph > obs.y + 10 && !obs.hit) {

            obs.hit = true;

            if (obs.type === 'stone') {
                // 衝突！（石）
                lives--;
                playClick(); // ダメージ音代わり

                let heartStr = '';
                for (let j = 0; j < lives; j++) heartStr += '♡';
                uiLives.innerText = heartStr;

                if (lives <= 0) {
                    changeState(STATE.GAMEOVER);
                    break;
                }
            } else if (obs.type === 'sandwich') {
                // 回復アイテム
                lives = Math.min(3, lives + 1);
                playJump(); // 回復音代わり

                let heartStr = '';
                for (let j = 0; j < lives; j++) heartStr += '♡';
                uiLives.innerText = heartStr;

                // アイテムを消す
                obstacles.splice(i, 1);
                continue;
            }
        }

        if (obs.x + obs.width < 0) {
            obstacles.splice(i, 1);
        }
    }

    frames++;
    if (currentState === STATE.PLAYING || gameSpeed === 0) {
        requestAnimationFrame(updateGame);
    }
}

// --- State Management ---
function changeState(newState) {
    currentState = newState;
    screenTitle.classList.add('hidden');
    screenIntro.classList.add('hidden');
    screenEnding.classList.add('hidden');
    screenGameover.classList.add('hidden');
    uiDistance.classList.add('hidden');
    uiLives.classList.add('hidden');

    if (newState === STATE.TITLE) {
        screenTitle.classList.remove('hidden');
        resetGame();
        stopBGM();
        // タイトル画面用の静止画描画（キャンバス上）
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else if (newState === STATE.INTRO) {
        screenIntro.classList.remove('hidden');
        playClick();
        // 背景を描画しておく
        drawBackground();
        player.draw();
    } else if (newState === STATE.PLAYING) {
        uiDistance.classList.remove('hidden');
        uiLives.classList.remove('hidden');
        playClick();
        startBGM();
        requestAnimationFrame(updateGame);
    } else if (newState === STATE.ENDING) {
        screenEnding.classList.remove('hidden');
        stopBGM();
        playClick();
    } else if (newState === STATE.GAMEOVER) {
        screenGameover.classList.remove('hidden');
        gameOverSpaceCount = 0; // スペースカウント初期化
        stopBGM();
        playClick();
    }
}

function resetGame() {
    distance = 0;
    frames = 0;
    gameSpeed = 6;
    lives = 3;
    obstacles = [];
    nextObstacleDist = 30;
    nextItemDist = 300;
    consecutiveObstacles = 0;
    scene = 'grass';
    superMarketX = -1;
    gameOverSpaceCount = 0;
    player.x = 100;
    player.y = groundY - player.height;
    player.vy = 0;
    uiDistance.innerText = '0m';
    uiLives.innerText = '♡♡♡';
}

// --- Input Handling ---
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        initAudio();
        e.preventDefault();

        if (currentState === STATE.INTRO) {
            changeState(STATE.PLAYING);
        } else if (currentState === STATE.PLAYING) {
            player.jump();
        } else if (currentState === STATE.ENDING) {
            changeState(STATE.TITLE);
        } else if (currentState === STATE.GAMEOVER) {
            gameOverSpaceCount++;
            if (gameOverSpaceCount >= 2) {
                changeState(STATE.TITLE);
            }
        }
    }
});

btnStart.addEventListener('click', () => {
    initAudio();
    if (currentState === STATE.TITLE) {
        changeState(STATE.INTRO);
    }
});

// 初期化
changeState(STATE.TITLE);
