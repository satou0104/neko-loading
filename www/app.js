// Capacitor初期化
const { Capacitor } = window;

// 広告ID（本番用）
const INTERSTITIAL_AD_ID = 'ca-app-pub-8707369701475326/5045679829';

// ゲーム状態
let currentStage = 1;
let gameRunning = false;
let consecutiveClear = 0;

// Canvas
let canvas, ctx;
let canvasWidth, canvasHeight;
let animationFrameId = null;

// スピナー
const spinner = {
  x: 0,
  y: 0,
  radius: 75,
  dots: 12,
  rotation: 0,
  speed: 0.04,
  dotRadius: 14
};

// ローディング進行度
let loadingPercent = 0;
const loadingSpeed = 0.042; // 1フレームあたりの増加量（約40秒で100%）

// ミスカウント
let missCount = 0;
let invincible = false;

// 猫の手
let nekoHands = [];
let nekoSpawnTimer = 0;
let nekoSpawnInterval = 120;

// 猫の手の画像（1-2～3-2.png、4を除外）
const nekoImages = [];
const nekoImagePaths = [
  'neko1-2.png',
  'neko2-2.png',
  'neko3-2.png',
  'neko5-2.png'
];

// 乱数生成（固定シード）
function seededRandom(seed) {
  let state = seed;
  return function() {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

// ステージ生成
function generateStageConfig(stageId) {
  const seed = 10000 + stageId * 137;
  const rng = seededRandom(seed);
  
  let spawnInterval = 120;
  let nekoSpeed = 2.0;
  
  // 難易度調整（20ステージ、段階的に難しくなる）
  // ステージ1: 間隔120, 速度0.75 → ステージ20: 間隔40, 速度2.2
  spawnInterval = 120 - Math.floor((stageId - 1) * (80 / 19)); // 120→40
  nekoSpeed = 0.75 + (stageId - 1) * (1.45 / 19); // 0.75→2.2
  
  const speed = 0.015 + rng() * 0.02;
  
  return {
    speed,
    spawnInterval,
    nekoSpeed
  };
}

// LocalStorage管理
function loadProgress() {
  const saved = localStorage.getItem('nekoLoadingProgress');
  return saved ? JSON.parse(saved) : { clearedStages: [], totalStars: 0 };
}

function saveProgress(progress) {
  localStorage.setItem('nekoLoadingProgress', JSON.stringify(progress));
}

function loadBestScore(stageId) {
  const saved = localStorage.getItem('nekoLoadingBest_' + stageId);
  return saved ? JSON.parse(saved) : null;
}

function saveBestScore(stageId, data) {
  const best = loadBestScore(stageId);
  if (!best || data.stars > best.stars || (data.stars === best.stars && data.score > best.score)) {
    localStorage.setItem('nekoLoadingBest_' + stageId, JSON.stringify(data));
  }
}

// 画面遷移
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active', 'no-transition');
  });
  
  setTimeout(() => {
    document.getElementById(screenId).classList.add('active');
  }, 50);
}

// ホーム画面の更新
function updateHomeScreen() {
  const progress = loadProgress();
  document.getElementById('clear-count').textContent = progress.clearedStages.length;
}

// ステージ選択画面の更新
function updateStageSelect() {
  const grid = document.getElementById('stage-grid');
  grid.innerHTML = '';
  
  for (let i = 1; i <= 20; i++) {
    const item = document.createElement('div');
    item.className = 'stage-item';
    
    const best = loadBestScore(i);
    if (best) {
      item.classList.add('cleared');
    }
    
    const number = document.createElement('div');
    number.className = 'stage-number';
    number.textContent = i;
    item.appendChild(number);
    
    if (best && best.stars > 0) {
      const stars = document.createElement('div');
      stars.className = 'stage-stars';
      stars.textContent = '★'.repeat(best.stars);
      item.appendChild(stars);
    }
    
    item.addEventListener('click', () => {
      currentStage = i;
      startStage(i);
    });
    
    grid.appendChild(item);
  }
}

// Canvas初期化
function initCanvas() {
  canvas = document.getElementById('game-canvas');
  ctx = canvas.getContext('2d');
  
  const gameArea = document.getElementById('game-area');
  const size = Math.min(gameArea.clientWidth, gameArea.clientHeight) - 40;
  const dpr = window.devicePixelRatio || 1;
  
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.scale(dpr, dpr);
  
  canvasWidth = size;
  canvasHeight = size;
  
  spinner.x = canvasWidth / 2;
  spinner.y = canvasHeight / 2;

  // 棚の位置をスピナーのスポーン位置に合わせる
  setTimeout(() => {
    const canvasEl = document.getElementById('game-canvas');
    const canvasRect = canvasEl.getBoundingClientRect();
    const gameAreaRect = gameArea.getBoundingClientRect();
    const canvasOffsetTop = canvasRect.top - gameAreaRect.top;
    
    const spinnerCenterY = canvasOffsetTop + (canvasRect.height / 2);
    const spawnDistance = canvasRect.height / 2;

    // 下の棚: 90度（真下）のスポーン位置
    const shelfBottom = document.getElementById('shelf-bottom');
    if (shelfBottom) {
      shelfBottom.style.top = (spinnerCenterY + spawnDistance - shelfBottom.offsetHeight * 0.7) + 'px';
    }
  }, 50);
}

// 猫の手画像の読み込み
function loadNekoImages() {
  return Promise.all(
    nekoImagePaths.map((path, index) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { nekoImages[index] = img; resolve(); };
        img.onerror = () => { resolve(); };
        img.src = path;
      });
    })
  );
}

// ゲーム開始
async function startStage(stageId) {
  // 前のゲームループを停止
  gameRunning = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  
  // 猫の手画像を読み込み
  if (nekoImages.length === 0) {
    await loadNekoImages();
  }
  
  currentStage = stageId;
  const config = generateStageConfig(stageId);
  
  // スピナー設定
  spinner.speed = config.speed;
  spinner.rotation = 0;
  
  // ゲーム状態リセット
  loadingPercent = 0;
  missCount = 0;
  invincible = false;
  nekoHands = [];
  nekoSpawnTimer = 0;
  nekoSpawnInterval = config.spawnInterval;
  
  // UI更新
  document.getElementById('stage-title').textContent = 'ステージ ' + stageId;
  
  // Canvas初期化
  initCanvas();
  
  // ゲーム画面を表示
  showScreen('game-screen');
  
  // ゲーム開始
  gameRunning = true;
  gameLoop();
}

// スピナー描画
function drawSpinner() {
  const angleStep = (Math.PI * 2) / spinner.dots;
  
  for (let i = 0; i < spinner.dots; i++) {
    // ドットの位置は固定
    const angle = i * angleStep;
    const dotX = spinner.x + Math.cos(angle) * spinner.radius;
    const dotY = spinner.y + Math.sin(angle) * spinner.radius;
    
    // グラデーションだけが回転（逆方向・滑らか）
    const gradientOffset = (1 - (i / spinner.dots) + spinner.rotation / (Math.PI * 2)) % 1;
    const brightness = Math.floor(255 * (0.08 + 0.92 * gradientOffset));
    ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
    
    // 最も明るいドットに光彩
    if (gradientOffset > 0.88) {
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#ffffff';
    }
    
    ctx.beginPath();
    ctx.arc(dotX, dotY, spinner.dotRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  
  // 中心にパーセンテージを表示
  const percentage = Math.floor(loadingPercent);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowBlur = 10;
  ctx.shadowColor = '#ffffff';
  ctx.fillText(percentage + '%', spinner.x, spinner.y);
  ctx.shadowBlur = 0;

  // ミスをスピナー右上に表示
  const missX = spinner.x + spinner.radius + spinner.dotRadius + 24;
  const missY = spinner.y - spinner.radius - spinner.dotRadius - 16;
  ctx.font = 'bold 16px -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('ミス', missX, missY);
  ctx.font = 'bold 26px -apple-system, sans-serif';
  ctx.fillStyle = missCount >= 7 ? '#ff6b6b' : '#ffffff';
  ctx.fillText(missCount, missX, missY + 24);
}

// 猫の手を出現させる
function spawnNekoHand() {
  const config = generateStageConfig(currentStage);
  const rng = seededRandom(Date.now());
  
  // ランダムな角度（0～360度、30度刻み）
  const angleStep = 30;
  const angleIndex = Math.floor(rng() * 12);
  const angle = angleIndex * angleStep;
  const angleRad = (angle * Math.PI) / 180;
  
  // 画面外の距離（Canvas端のすぐ外から出現）
  const distance = Math.max(canvasWidth, canvasHeight) / 2 + 50;
  
  // 開始位置（画面外）
  const startX = spinner.x + Math.cos(angleRad) * distance;
  const startY = spinner.y + Math.sin(angleRad) * distance;
  
  // 目標位置（スピナーの中心）
  const targetX = spinner.x;
  const targetY = spinner.y;
  
  // 回転角度（肉球が進行方向を向くように）
  const rotation = angle - 90;
  
  // ランダムな猫の手の種類（1～4、4番はneko5に対応）
  const nekoType = Math.floor(rng() * 4) + 1;
  
  nekoHands.push({
    x: startX,
    y: startY,
    targetX: targetX,
    targetY: targetY,
    speed: config.nekoSpeed,
    type: nekoType,
    imageIndex: nekoType - 1,
    size: 300,
    rotation: rotation
  });
}

// 猫の手の更新
function updateNekoHands() {
  for (let index = nekoHands.length - 1; index >= 0; index--) {
    const neko = nekoHands[index];
    
    const dx = neko.targetX - neko.x;
    const dy = neko.targetY - neko.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    neko.x += (dx / distance) * neko.speed;
    neko.y += (dy / distance) * neko.speed;
    
    const distanceToCenter = Math.sqrt(
      (neko.x - spinner.x) ** 2 + 
      (neko.y - spinner.y) ** 2
    );
    
    // スピナーに到達したらダメージ（無敵時間中はスキップ）
    if (distanceToCenter <= spinner.radius + spinner.dotRadius + 20) {
      nekoHands.splice(index, 1);
      if (!invincible) {
        loadingPercent = Math.max(0, loadingPercent - 4);
        addMiss();
        invincible = true;
        setTimeout(() => { invincible = false; }, 1000);
      }
    }
  }
}

// 猫の手の描画
function drawNekoHands() {
  nekoHands.forEach(neko => {
    const img = nekoImages[neko.imageIndex];
    if (img && img.complete) {
      ctx.save();
      ctx.translate(neko.x, neko.y);
      ctx.rotate((neko.rotation * Math.PI) / 180);
      ctx.globalAlpha = 0.95;
      ctx.drawImage(img, -neko.size / 2, -neko.size / 2, neko.size, neko.size);
      ctx.restore();
    }
  });
}

// 猫の手ボタンをタップ
function onNekoButtonTap(nekoType) {
  if (!gameRunning) return;

  // 対応する猫の手を探す（最も近いものを優先）
  let foundIndex = -1;
  let minDistance = Infinity;

  for (let i = 0; i < nekoHands.length; i++) {
    const neko = nekoHands[i];
    if (neko.type === nekoType) {
      const dist = Math.sqrt(
        (neko.x - spinner.x) ** 2 + (neko.y - spinner.y) ** 2
      );
      if (dist < minDistance) {
        minDistance = dist;
        foundIndex = i;
      }
    }
  }

  if (foundIndex !== -1) {
    // 正解！最もスピナーに近い猫の手を消す
    nekoHands.splice(foundIndex, 1);
    flashButton(nekoType, true);
  } else {
    // 不正解（お手付き）
    addMiss();
    flashButton(nekoType, false);
  }
}

// ボタンのフラッシュエフェクト
function flashButton(nekoType, correct) {
  const button = document.querySelector(`.neko-button[data-neko-id="${nekoType}"]`);
  if (button) {
    button.classList.add(correct ? 'correct' : 'wrong');
    setTimeout(() => {
      button.classList.remove('correct', 'wrong');
    }, 300);
  }
}

// ミス追加
function addMiss() {
  missCount++;
  
  // 失敗判定（ミス10回以上）
  if (missCount >= 10) {
    setTimeout(() => failStage(), 500);
  }
}

// ゲームループ
function gameLoop() {
  if (!gameRunning) return;
  
  // クリア
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  
  // ローディング進行
  loadingPercent = Math.min(100, loadingPercent + loadingSpeed);
  
  // 100%でクリア
  if (loadingPercent >= 100) {
    setTimeout(() => clearStage(), 500);
    return;
  }
  
  // スピナー回転
  spinner.rotation += spinner.speed;
  if (spinner.rotation > Math.PI * 2) {
    spinner.rotation -= Math.PI * 2;
  }
  
  // 猫の手出現
  nekoSpawnTimer++;
  if (nekoSpawnTimer >= nekoSpawnInterval) {
    nekoSpawnTimer = 0;
    spawnNekoHand();
  }
  
  // 更新
  updateNekoHands();
  
  // 描画
  drawSpinner();
  drawNekoHands();
  
  animationFrameId = requestAnimationFrame(gameLoop);
}

// ステージクリア
function clearStage() {
  gameRunning = false;
  
  // 星評価（ミス数で判定）
  let stars = 1;
  if (missCount === 0) {
    stars = 3;
  } else if (missCount <= 3) {
    stars = 2;
  }
  
  // ベストスコア保存
  saveBestScore(currentStage, {
    miss: missCount,
    stars: stars
  });
  
  // 進行状況更新
  const progress = loadProgress();
  if (!progress.clearedStages.includes(currentStage)) {
    progress.clearedStages.push(currentStage);
  }
  saveProgress(progress);
  
  // 連続クリアカウント
  consecutiveClear++;
  
  // クリア画面表示
  showClearScreen(stars, missCount);
  
  // 4プレイごとにインタースティシャル広告
  if (consecutiveClear % 4 === 0) {
    setTimeout(() => showInterstitialAd(), 1000);
  }
}

// 失敗
function failStage() {
  gameRunning = false;
  consecutiveClear++;
  if (consecutiveClear % 4 === 0) {
    setTimeout(() => showInterstitialAd(), 1000);
  }
  // ランダムメッセージ
  const messages = ['にゃー', 'にゃーにゃー', 'ミスるとロード時間が長くなるよ', 'にゃーーー'];
  document.getElementById('fail-message').textContent = messages[Math.floor(Math.random() * messages.length)];
  showScreen('fail-screen');
}

// クリア画面表示
function showClearScreen(stars, finalMiss) {
  document.getElementById('clear-miss').textContent = finalMiss;
  
  // 星アニメーション
  const starsDisplay = document.getElementById('stars-display');
  const starElements = starsDisplay.querySelectorAll('.star');
  starElements.forEach((star, index) => {
    star.classList.remove('earned');
    if (index < stars) {
      setTimeout(() => {
        star.classList.add('earned');
      }, index * 200);
    }
  });
  
  showScreen('clear-screen');
}

// AdMob初期化
async function initAdMob() {
  if (!Capacitor || !Capacitor.Plugins || !Capacitor.Plugins.AdMob) return;
  
  try {
    const { AdMob } = Capacitor.Plugins;
    await AdMob.initialize({ requestTrackingAuthorization: false });
  } catch (e) {
    console.log('AdMob initialization failed:', e);
  }
}

// ホーム画面のスピナーアニメーション
function initHomeAnimation() {
  const canvas = document.getElementById('home-canvas');
  if (!canvas) return;
  
  const dpr = window.devicePixelRatio || 1;
  const displaySize = 160;
  
  canvas.width = displaySize * dpr;
  canvas.height = displaySize * dpr;
  canvas.style.width = displaySize + 'px';
  canvas.style.height = displaySize + 'px';
  
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  
  const centerX = displaySize / 2;
  const centerY = displaySize / 2;
  const radius = 55;
  const dots = 12;
  const dotRadius = 10;
  let rotation = 0;
  
  function drawHomeSpinner() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const angleStep = (Math.PI * 2) / dots;
    
    for (let i = 0; i < dots; i++) {
      // ドットの位置は固定
      const angle = i * angleStep;
      const dotX = centerX + Math.cos(angle) * radius;
      const dotY = centerY + Math.sin(angle) * radius;
      
      // グラデーションだけが回転（逆方向・滑らか）
      const gradientOffset = (1 - (i / dots) + rotation / (Math.PI * 2)) % 1;
      const brightness = Math.floor(255 * (0.08 + 0.92 * gradientOffset));
      ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
      
      if (gradientOffset > 0.88) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#ffffff';
      }
      
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    
    rotation += 0.04;
    if (rotation > Math.PI * 2) {
      rotation -= Math.PI * 2;
    }
    
    requestAnimationFrame(drawHomeSpinner);
  }
  
  drawHomeSpinner();
}

// インタースティシャル広告
async function showInterstitialAd() {
  if (!Capacitor || !Capacitor.Plugins || !Capacitor.Plugins.AdMob) return;
  
  try {
    const { AdMob } = Capacitor.Plugins;
    await AdMob.prepareInterstitial({ adId: INTERSTITIAL_AD_ID });
    await AdMob.showInterstitial();
  } catch (e) {
    console.log('Interstitial ad failed:', e);
  }
}

// イベントリスナー
document.addEventListener('DOMContentLoaded', () => {
  // AdMob初期化
  initAdMob();
  
  // ホーム画面アニメーション
  initHomeAnimation();
  
  // ホーム画面更新
  updateHomeScreen();
  
  // ホーム画面のボタン
  document.getElementById('btn-play').addEventListener('click', () => {
    updateStageSelect();
    showScreen('stage-select-screen');
  });
  
  document.getElementById('btn-how-to-play').addEventListener('click', () => {
    showScreen('how-to-play-screen');
  });
  
  // ステージ選択画面のボタン
  document.getElementById('btn-back-from-select').addEventListener('click', () => {
    consecutiveClear = 0;
    showScreen('home-screen');
  });
  
  // ゲーム画面のボタン
  document.getElementById('btn-back-from-game').addEventListener('click', () => {
    gameRunning = false;
    consecutiveClear = 0;
    showScreen('stage-select-screen');
  });
  
  document.getElementById('btn-reset').addEventListener('click', () => {
    startStage(currentStage);
  });
  
  // 猫の手ボタンのタップ
  document.querySelectorAll('.neko-button').forEach(button => {
    let touchStartX = 0;
    let touchStartY = 0;
    let touched = false;

    button.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    button.addEventListener('touchend', (e) => {
      const dx = Math.abs(e.changedTouches[0].clientX - touchStartX);
      const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
      // 移動距離が10px以下ならタップとして処理
      if (dx < 10 && dy < 10) {
        touched = true;
        const nekoType = parseInt(button.dataset.nekoId);
        onNekoButtonTap(nekoType);
      }
    }, { passive: true });

    button.addEventListener('click', (e) => {
      if (touched) { touched = false; return; }
      const nekoType = parseInt(button.dataset.nekoId);
      onNekoButtonTap(nekoType);
    });
  });
  
  // クリア画面のボタン
  document.getElementById('btn-next-stage').addEventListener('click', () => {
    if (currentStage < 20) {
      startStage(currentStage + 1);
    } else {
      updateStageSelect();
      showScreen('stage-select-screen');
    }
  });
  
  document.getElementById('btn-to-select').addEventListener('click', () => {
    consecutiveClear = 0;
    updateStageSelect();
    showScreen('stage-select-screen');
  });
  
  // 失敗画面のボタン
  document.getElementById('btn-retry').addEventListener('click', () => {
    startStage(currentStage);
  });
  
  document.getElementById('btn-to-select-fail').addEventListener('click', () => {
    consecutiveClear = 0;
    updateStageSelect();
    showScreen('stage-select-screen');
  });
  
  // 遊び方画面のボタン
  document.getElementById('btn-back-from-how').addEventListener('click', () => {
    showScreen('home-screen');
  });
  
  document.getElementById('btn-start-from-how').addEventListener('click', () => {
    updateStageSelect();
    showScreen('stage-select-screen');
  });
});
