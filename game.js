/*
 * ポケモンと ブロックパズル！ - 学習用・非公式の試作品
 * ライブラリや外部通信は使いません。GitHub Pagesでそのまま動きます。
 */
'use strict';

(() => {
  const COLS = 10;
  const ROWS = 20;
  const CELL = 60;
  const STAGES = [
    { name: 'はじめて', partner: 'ピカチュウ', emoji: '⚡', speed: 1450 },
    { name: 'ゆっくり', partner: 'フシギダネ', emoji: '🌱', speed: 1050 },
    { name: 'ふつう', partner: 'ゼニガメ', emoji: '💧', speed: 760 },
    { name: 'チャレンジ', partner: 'ヒトカゲ', emoji: '🔥', speed: 480 }
  ];
  const TILES = {
    I: { color: '#4bd0f2', matrix: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
    O: { color: '#ffcf54', matrix: [[1, 1], [1, 1]] },
    T: { color: '#bb9aff', matrix: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] },
    S: { color: '#61dba2', matrix: [[0, 1, 1], [1, 1, 0], [0, 0, 0]] },
    Z: { color: '#ff8192', matrix: [[1, 1, 0], [0, 1, 1], [0, 0, 0]] },
    J: { color: '#82a9ff', matrix: [[1, 0, 0], [1, 1, 1], [0, 0, 0]] },
    L: { color: '#ffa768', matrix: [[0, 0, 1], [1, 1, 1], [0, 0, 0]] }
  };
  const SCORE_BY_LINES = [0, 100, 250, 450, 700];
  const $ = (id) => document.getElementById(id);
  const boardCanvas = $('board');
  const boardCtx = boardCanvas.getContext('2d');
  const nextCanvas = $('nextBoard');
  const nextCtx = nextCanvas.getContext('2d');

  let selectedStage = 0;
  let soundOn = true;
  let lastMotionSound = -Infinity;
  let audioContext = null;
  let toastTimer = null;
  const heldControls = new Map();
  let animationId = null;
  let helpShouldResume = false;

  const game = {
    phase: 'home', board: [], current: null, next: null, bag: [],
    score: 0, lines: 0, clearEvents: 0, level: 1, stage: 0,
    fallClock: 0, lastTime: null, lastDraw: 0
  };

  function emptyBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function stageNumber() {
    return game.stage + 1 + Math.floor(game.lines / 5);
  }

  function storedBest(stage) {
    try {
      return Math.max(0, Number(localStorage.getItem(`pokemon-block-best-v1-${stage}`)) || 0);
    } catch (_) {
      return 0;
    }
  }

  function saveBest() {
    if (game.score <= storedBest(game.stage)) return;
    try { localStorage.setItem(`pokemon-block-best-v1-${game.stage}`, String(game.score)); }
    catch (_) { /* ブラウザで保存がオフなら、その回だけ記録します */ }
  }

  function refreshHUD() {
    $('scoreValue').textContent = game.score.toLocaleString('ja-JP');
    $('linesValue').textContent = game.lines;
    $('levelValue').textContent = game.level;
    $('bestValue').textContent = Math.max(storedBest(game.stage), game.score).toLocaleString('ja-JP');
  }

  function chooseStage(index) {
    if (!Number.isInteger(index) || index < 0 || index >= STAGES.length) return;
    selectedStage = index;
    document.querySelectorAll('.stage-card').forEach((button) => {
      const active = Number(button.dataset.stage) === selectedStage;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function shuffledBag() {
    const bag = Object.keys(TILES);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }

  function takePieceType() {
    if (!game.bag.length) game.bag = shuffledBag();
    return game.bag.pop();
  }

  function makePiece(type) {
    const matrix = TILES[type].matrix.map((row) => row.slice());
    return { type, matrix, x: Math.floor((COLS - matrix.length) / 2), y: -1 };
  }

  function collision(piece, dx = 0, dy = 0, candidate = piece.matrix) {
    for (let r = 0; r < candidate.length; r++) {
      for (let c = 0; c < candidate[r].length; c++) {
        if (!candidate[r][c]) continue;
        const x = piece.x + c + dx;
        const y = piece.y + r + dy;
        if (x < 0 || x >= COLS || y >= ROWS) return true;
        if (y >= 0 && game.board[y][x]) return true;
      }
    }
    return false;
  }

  function spawnPiece() {
    game.current = makePiece(game.next);
    game.next = takePieceType();
    drawNext();
    if (collision(game.current)) finishGame();
  }

  function startGame(stage = selectedStage) {
    clearHold();
    hideToast();
    game.stage = stage;
    game.board = emptyBoard();
    game.bag = [];
    game.next = takePieceType();
    game.current = null;
    game.score = 0;
    game.lines = 0;
    game.clearEvents = 0;
    game.level = stage + 1;
    game.fallClock = 0;
    game.lastTime = null;
    game.lastDraw = 0;
    game.phase = 'playing';
    // サウンドはスタートボタンを押した操作をきっかけに有効化（iPhone対応）。
    prepareAudio();
    playTone(620, .09, 'sine', .045);
    $('partnerEmoji').textContent = STAGES[stage].emoji;
    $('partnerName').textContent = STAGES[stage].partner;
    $('gameTip').textContent = stage === 0 ? 'うすい ブロックが おちる ばしょの めじるし！' : 'すきまを つくらずに ならべよう！';
    $('homeScreen').classList.add('hidden');
    $('gameScreen').classList.remove('hidden');
    $('gameOverlay').classList.add('hidden');
    $('helpOverlay').classList.add('hidden');
    spawnPiece();
    refreshHUD();
    drawBoard();
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (animationId === null) animationId = requestAnimationFrame(frame);
  }

  function goHome() {
    clearHold();
    hideToast();
    game.phase = 'home';
    game.current = null;
    $('gameOverlay').classList.add('hidden');
    $('helpOverlay').classList.add('hidden');
    $('gameScreen').classList.add('hidden');
    $('homeScreen').classList.remove('hidden');
    if (animationId !== null) { cancelAnimationFrame(animationId); animationId = null; }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function move(dx) {
    if (game.phase !== 'playing' || !game.current) return;
    if (!collision(game.current, dx, 0)) {
      game.current.x += dx;
      playMotionSound(385);
      drawBoard();
    }
  }

  function rotateMatrix(matrix) {
    const n = matrix.length;
    const result = Array.from({ length: n }, () => Array(n).fill(0));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) result[x][n - 1 - y] = matrix[y][x];
    }
    return result;
  }

  function rotate() {
    if (game.phase !== 'playing' || !game.current) return;
    const candidate = rotateMatrix(game.current.matrix);
    // かべの近くでも回せるように、左右に少しずらしてみる
    const kicks = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [-1, -1], [1, -1]];
    for (const [dx, dy] of kicks) {
      if (!collision(game.current, dx, dy, candidate)) {
        game.current.x += dx;
        game.current.y += dy;
        game.current.matrix = candidate;
        playTone(560, .075, 'sine', .05);
        playTone(760, .075, 'sine', .035, .045);
        drawBoard();
        return;
      }
    }
  }

  function softFall(manual = false) {
    if (game.phase !== 'playing' || !game.current) return;
    if (!collision(game.current, 0, 1)) {
      game.current.y++;
      if (manual) { game.score += 1; playMotionSound(280); refreshHUD(); }
    } else {
      lockPiece();
    }
    drawBoard();
  }

  function hardDrop() {
    if (game.phase !== 'playing' || !game.current) return;
    let distance = 0;
    while (!collision(game.current, 0, 1)) {
      game.current.y++;
      distance++;
    }
    game.score += distance * 2;
    playTone(150, .125, 'triangle', .075);
    lockPiece();
    drawBoard();
  }

  function lockPiece() {
    const p = game.current;
    if (!p || game.phase !== 'playing') return;
    let aboveTop = false;
    for (let r = 0; r < p.matrix.length; r++) {
      for (let c = 0; c < p.matrix[r].length; c++) {
        if (!p.matrix[r][c]) continue;
        const x = p.x + c;
        const y = p.y + r;
        if (y < 0) aboveTop = true;
        else if (y < ROWS) game.board[y][x] = TILES[p.type].color;
      }
    }
    game.score += 5;
    game.fallClock = 0;

    // 埋まった行を下から探し、行を消して上のブロックを下ろす
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (game.board[y].every(Boolean)) {
        game.board.splice(y, 1);
        game.board.unshift(Array(COLS).fill(null));
        cleared++;
        y++;
      }
    }

    if (cleared) {
      // 1〜4列を同時に消しても「1回」と数え、10回ごとに表示します。
      game.clearEvents++;
      game.lines += cleared;
      game.score += SCORE_BY_LINES[Math.min(cleared, 4)];
      game.level = stageNumber();
      if (game.clearEvents % 10 === 0) {
        showToast(`🎉 ${game.clearEvents}かい けせたよ！\nすごい！ そのちょうし！`);
        playMelody([523, 659, 784, 1046, 1175]);
      } else {
        // メッセージを出さない回にも、列が消えた音は鳴ります。
        playMelody([660, 880, 1046]);
      }
    } else {
      playTone(230, .055, 'triangle', .035);
    }
    saveBest();
    refreshHUD();
    if (aboveTop) {
      finishGame();
    } else {
      spawnPiece();
    }
  }

  function finishGame() {
    game.phase = 'over';
    playMelody([392, 330, 262]);
    game.current = null;
    clearHold();
    saveBest();
    refreshHUD();
    hideToast();
    $('modalEmoji').textContent = '🏆';
    $('modalTitle').textContent = 'よく がんばったね！';
    $('modalMessage').textContent = `${game.lines}れつ そろえたよ！ もういちど あそぼう！`;
    $('finalScore').textContent = game.score.toLocaleString('ja-JP');
    $('modalScore').classList.remove('hidden');
    $('resumeButton').classList.add('hidden');
    $('gameOverlay').classList.remove('hidden');
    $('retryButton').focus();
  }

  function pauseGame() {
    if (game.phase !== 'playing') return;
    clearHold();
    game.phase = 'paused';
    game.lastTime = null;
    $('modalEmoji').textContent = '⏸️';
    $('modalTitle').textContent = 'ちょっと きゅうけい！';
    $('modalMessage').textContent = 'だいじょうぶ！ つづきから あそべるよ。';
    $('modalScore').classList.add('hidden');
    $('resumeButton').classList.remove('hidden');
    $('gameOverlay').classList.remove('hidden');
    $('resumeButton').focus();
  }

  function resumeGame() {
    if (game.phase !== 'paused') return;
    game.phase = 'playing';
    game.lastTime = null;
    $('gameOverlay').classList.add('hidden');
  }

  function showHelp() {
    if (game.phase !== 'playing') return;
    clearHold();
    helpShouldResume = true;
    game.phase = 'paused';
    game.lastTime = null;
    $('helpOverlay').classList.remove('hidden');
    $('closeHelpButton').focus();
  }

  function closeHelp() {
    $('helpOverlay').classList.add('hidden');
    if (helpShouldResume && game.phase === 'paused') resumeGame();
    helpShouldResume = false;
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    const toast = $('boardToast');
    toast.textContent = message;
    toast.style.whiteSpace = 'pre-line';
    toast.classList.remove('hidden');
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 1450);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    $('boardToast').classList.add('hidden');
  }

  function intervalForLevel() {
    const bonusLevels = Math.floor(game.lines / 5);
    return Math.max(175, STAGES[game.stage].speed * Math.pow(0.88, bonusLevels));
  }

  function frame(now) {
    if (game.phase === 'home') { animationId = null; return; }
    if (game.phase === 'playing') {
      if (game.lastTime === null) game.lastTime = now;
      game.fallClock += Math.min(100, Math.max(0, now - game.lastTime));
      game.lastTime = now;
      if (game.fallClock >= intervalForLevel()) {
        game.fallClock = 0;
        softFall(false);
      }
    } else {
      game.lastTime = null;
    }
    if (now - game.lastDraw >= 35) {
      drawBoard();
      game.lastDraw = now;
    }
    animationId = requestAnimationFrame(frame);
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawTile(ctx, x, y, size, color, ghost = false) {
    const margin = Math.max(2, size * .065);
    const d = size - 2 * margin;
    ctx.save();
    if (ghost) {
      ctx.globalAlpha = .48;
      roundedRect(ctx, x + margin, y + margin, d, d, size * .16);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(3, size * .06);
      ctx.stroke();
      ctx.globalAlpha = .14;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
      return;
    }
    roundedRect(ctx, x + margin, y + margin + size * .05, d, d, size * .15);
    ctx.fillStyle = 'rgba(2,18,40,.24)';
    ctx.fill();
    roundedRect(ctx, x + margin, y + margin, d, d - size * .05, size * .15);
    ctx.fillStyle = color;
    ctx.fill();
    roundedRect(ctx, x + size * .15, y + size * .11, size * .57, size * .13, size * .065);
    ctx.fillStyle = 'rgba(255,255,255,.37)';
    ctx.fill();
    // ひとマスずつ、ちいさな目のような かわいい点
    if (size >= 33) {
      ctx.fillStyle = 'rgba(42,56,79,.45)';
      ctx.beginPath();
      ctx.arc(x + size * .38, y + size * .57, size * .036, 0, 2 * Math.PI);
      ctx.arc(x + size * .61, y + size * .57, size * .036, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBoard() {
    const ctx = boardCtx;
    ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
    ctx.fillStyle = '#203454';
    ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#283c5d' : '#293e61';
        ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
        if (game.board[y] && game.board[y][x]) drawTile(ctx, x * CELL, y * CELL, CELL, game.board[y][x]);
      }
    }
    if (game.current && game.phase !== 'over') {
      const p = game.current;
      const shadow = { ...p, y: p.y };
      while (!collision(shadow, 0, 1)) shadow.y++;
      // おちる ばしょを かげで おしえる
      for (let y = 0; y < p.matrix.length; y++) {
        for (let x = 0; x < p.matrix[y].length; x++) {
          if (!p.matrix[y][x]) continue;
          const destinationRow = shadow.y + y;
          if (destinationRow >= 0 && destinationRow < ROWS) {
            drawTile(ctx, (shadow.x + x) * CELL, destinationRow * CELL, CELL, TILES[p.type].color, true);
          }
        }
      }
      for (let y = 0; y < p.matrix.length; y++) {
        for (let x = 0; x < p.matrix[y].length; x++) {
          if (!p.matrix[y][x]) continue;
          const row = p.y + y;
          if (row >= 0 && row < ROWS) drawTile(ctx, (p.x + x) * CELL, row * CELL, CELL, TILES[p.type].color);
        }
      }
    }
  }

  function drawNext() {
    const ctx = nextCtx;
    const width = nextCanvas.width;
    const height = nextCanvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#f0f7ff';
    ctx.fillRect(0, 0, width, height);
    if (!game.next) return;
    const matrix = TILES[game.next].matrix;
    const blocks = [];
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) if (matrix[y][x]) blocks.push([x, y]);
    }
    if (!blocks.length) return;
    const minX = Math.min(...blocks.map(([x]) => x));
    const maxX = Math.max(...blocks.map(([x]) => x));
    const minY = Math.min(...blocks.map(([, y]) => y));
    const maxY = Math.max(...blocks.map(([, y]) => y));
    const tileSize = 46;
    const offX = (width - (maxX - minX + 1) * tileSize) / 2;
    const offY = (height - (maxY - minY + 1) * tileSize) / 2;
    for (const [x, y] of blocks) {
      drawTile(ctx, offX + (x - minX) * tileSize, offY + (y - minY) * tileSize, tileSize, TILES[game.next].color);
    }
  }

  // Web Audio API で短いオリジナル効果音を合成します（外部音源・通信なし）。
  // ブラウザの制限により、最初の「スタート」タップ後から鳴ります。
  function prepareAudio() {
    if (!soundOn) return false;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return false;
      if (!audioContext) audioContext = new Audio();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      return true;
    } catch (_) { return false; }
  }

  function playTone(frequency, duration = .09, wave = 'sine', volume = .05, delay = 0) {
    if (!prepareAudio()) return;
    try {
      const start = audioContext.currentTime + delay;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(Math.max(.001, volume), start);
      gain.gain.exponentialRampToValueAtTime(.001, start + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + .01);
    } catch (_) { /* 音に対応しない端末でもゲームは継続 */ }
  }

  function playMotionSound(frequency) {
    // 長押し中に効果音が連続しすぎないよう間引きます。
    const now = performance.now();
    if (now - lastMotionSound < 75) return;
    lastMotionSound = now;
    playTone(frequency, .04, 'sine', .025);
  }

  function playMelody(notes) {
    if (!soundOn) return;
    notes.forEach((note, index) => playTone(note, .105, 'sine', .052, index * .09));
  }

  function updateSoundButton() {
    $('soundButton').textContent = soundOn ? '🔊 おと オン' : '🔇 おと オフ';
    $('soundButton').setAttribute('aria-pressed', String(soundOn));
  }

  function performAction(action) {
    if (game.phase !== 'playing') return;
    switch (action) {
      case 'left': move(-1); break;
      case 'right': move(1); break;
      case 'rotate': rotate(); break;
      case 'down': softFall(true); break;
      case 'drop': hardDrop(); break;
    }
  }

  // ひだりの十字キーを押したまま、右の回転ボタンも同時に押せます。
  function releaseHeldControl(button) {
    const state = heldControls.get(button);
    if (!state) return;
    clearTimeout(state.timer);
    clearInterval(state.interval);
    button.classList.remove('pressed');
    heldControls.delete(button);
  }

  function clearHold() {
    for (const button of [...heldControls.keys()]) releaseHeldControl(button);
  }

  function init() {
    document.querySelectorAll('.stage-card').forEach((button) => {
      button.addEventListener('click', () => chooseStage(Number(button.dataset.stage)));
    });
    $('startButton').addEventListener('click', () => startGame(selectedStage));
    $('backButton').addEventListener('click', goHome);
    $('pauseButton').addEventListener('click', () => {
      if (game.phase === 'playing') pauseGame();
      else if (game.phase === 'paused' && $('helpOverlay').classList.contains('hidden')) resumeGame();
    });
    $('resumeButton').addEventListener('click', resumeGame);
    $('retryButton').addEventListener('click', () => startGame(game.stage));
    $('modalHomeButton').addEventListener('click', goHome);
    $('helpButton').addEventListener('click', showHelp);
    $('closeHelpButton').addEventListener('click', closeHelp);
    const helpCards = $('exampleCards').cloneNode(true);
    helpCards.removeAttribute('id');
    $('helpExamples').appendChild(helpCards);
    updateSoundButton();
    $('soundButton').addEventListener('click', () => {
      soundOn = !soundOn;
      updateSoundButton();
      if (soundOn) playMelody([660, 880]);
    });

    document.querySelectorAll('.control-btn').forEach((button) => {
      const action = button.dataset.action;
      button.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        if (game.phase !== 'playing') return;
        releaseHeldControl(button);
        const held = { timer: null, interval: null, pointerId: event.pointerId };
        heldControls.set(button, held);
        button.classList.add('pressed');
        if (button.setPointerCapture) button.setPointerCapture(event.pointerId);
        performAction(action);
        if (['left', 'right', 'down'].includes(action)) {
          held.timer = setTimeout(() => {
            if (!heldControls.has(button)) return;
            held.interval = setInterval(() => performAction(action), action === 'down' ? 70 : 110);
          }, 280);
        }
      });
      const release = (event) => {
        if (heldControls.get(button)?.pointerId === event.pointerId) releaseHeldControl(button);
      };
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
      // キーボードでボタンを選択し、Enter/Spaceで押したとき
      button.addEventListener('click', (event) => {
        if (event.detail === 0) performAction(action);
      });
    });

    document.addEventListener('keydown', (event) => {
      if ($('gameScreen').classList.contains('hidden')) return;
      if (!$('helpOverlay').classList.contains('hidden')) {
        if (event.key === 'Escape') closeHelp();
        return;
      }
      const key = event.key;
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'Spacebar', 'p', 'P', 'x', 'X'].includes(key)) {
        event.preventDefault();
      }
      if (key === 'p' || key === 'P' || key === 'Escape') {
        if (game.phase === 'playing') pauseGame();
        else if (game.phase === 'paused') resumeGame();
        return;
      }
      if (game.phase !== 'playing') return;
      switch (key) {
        case 'ArrowLeft': performAction('left'); break;
        case 'ArrowRight': performAction('right'); break;
        case 'ArrowDown': performAction('down'); break;
        case 'ArrowUp': case 'x': case 'X':
          if (!event.repeat) performAction('rotate');
          break;
        case ' ': case 'Spacebar':
          if (!event.repeat) performAction('drop');
          break;
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && game.phase === 'playing') pauseGame();
    });
    window.addEventListener('pagehide', () => {
      if (game.phase === 'playing') pauseGame();
    });
    chooseStage(0);
  }

  init();
})();
