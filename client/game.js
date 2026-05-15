// ── Config ──────────────────────────────────────────────────────────────────
const SERVER_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : 'https://selim-3ow4.onrender.com';

const ARENA_W = 800, ARENA_H = 600;
const PLAYER_SIZE = 32, PLAYER_SPEED = 3.5;
const PIZZA_RADIUS = 16, POWERUP_RADIUS = 18;
const COLLECT_DIST = 30;

const CHARACTERS = [
  { id: 'leo',   name: 'Leonardo',     emoji: '🐢', color: '#4fc3f7' },
  { id: 'raph',  name: 'Raphael',      emoji: '🐢', color: '#ef5350' },
  { id: 'mike',  name: 'Michelangelo', emoji: '🐢', color: '#ffa726' },
  { id: 'don',   name: 'Donatello',    emoji: '🐢', color: '#ce93d8' },
];

// ── State ────────────────────────────────────────────────────────────────────
let socket, myId = null, myRoomCode = null;
let selectedChar = CHARACTERS[0];
let gameRunning = false, lastTime = 0;

const state = {
  myPlayer:   null,         // shortcut to allPlayers[myId]
  allPlayers: {},           // id → player (me + opponents)
  pizzas:     [],
  powerups:   [],
  obstacles:  [],
  scores:     {},
  effects:    {},           // id → { speed, slow, shield, stunned }
  myKeys:     {},
};

// ── Socket ───────────────────────────────────────────────────────────────────
function initSocket() {
  socket = io(SERVER_URL);

  socket.on('connect', () => { myId = socket.id; });

  socket.on('roomCreated', ({ code, player }) => {
    myRoomCode = code;
    document.getElementById('lobby-code').textContent = code;
    state.allPlayers = { [player.id]: { ...player, vx: 0, vy: 0 } };
    state.myPlayer = state.allPlayers[player.id];
    updateLobbyPlayers();
    enableReadyBtn();
    showScreen('screen-lobby');
  });

  socket.on('joinedRoom', ({ code, player }) => {
    myRoomCode = code;
    document.getElementById('lobby-code').textContent = code;
    state.allPlayers = { [player.id]: { ...player, vx: 0, vy: 0 } };
    state.myPlayer = state.allPlayers[player.id];
    updateLobbyPlayers();
    enableReadyBtn();
    showScreen('screen-lobby');
  });

  socket.on('joinError', (msg) => {
    document.getElementById('join-error').textContent = msg;
  });

  socket.on('playerJoined', ({ players }) => {
    for (const [id, p] of Object.entries(players)) {
      if (!state.allPlayers[id]) state.allPlayers[id] = { ...p, vx: 0, vy: 0 };
      else Object.assign(state.allPlayers[id], p);
    }
    updateLobbyPlayers();
  });

  socket.on('readyUpdate', ({ players }) => {
    for (const [id, p] of Object.entries(players)) {
      if (state.allPlayers[id]) state.allPlayers[id].ready = p.ready;
    }
    updateLobbyPlayers();
  });

  socket.on('gameStart', ({ players }) => {
    startLocalGame(players);
  });

  socket.on('opponentMove', ({ id, x, y, vx, vy }) => {
    const p = state.allPlayers[id];
    if (p) { p.x = x; p.y = y; p.vx = vx || 0; p.vy = vy || 0; }
  });

  socket.on('pizzaSpawned',   (pizza) => { state.pizzas.push(pizza); });
  socket.on('powerupSpawned', (pu)    => { state.powerups.push(pu); });
  socket.on('obstacleSpawned',(obs)   => { state.obstacles.push(obs); });

  socket.on('pizzaCollected', ({ pizzaId, collectorId, scores }) => {
    state.pizzas = state.pizzas.filter(p => p.id !== pizzaId);
    Object.assign(state.scores, scores);
    updateHUD();
    const col = state.allPlayers[collectorId];
    if (col) showFloatingText(col.x, col.y, '+puan!', '#fff');
  });

  socket.on('powerupCollected', ({ powerupId, collectorId, type }) => {
    state.powerups = state.powerups.filter(p => p.id !== powerupId);
    applyPowerup(collectorId, type);
  });

  socket.on('timerUpdate', (remaining) => {
    const el = document.getElementById('game-timer');
    el.textContent = remaining;
    el.classList.toggle('urgent', remaining <= 10);
  });

  socket.on('gameEnd', ({ players, winner }) => {
    gameRunning = false;
    showResult(players, winner);
  });

  socket.on('playerLeft', () => {
    if (gameRunning) {
      gameRunning = false;
      alert('Bir oyuncu oyundan ayrıldı!');
      showScreen('screen-menu');
    }
  });
}

// ── Screens ──────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function createRoom() {
  const name = document.getElementById('create-name').value.trim() || 'Oyuncu 1';
  socket.emit('createRoom', { playerName: name, character: selectedChar.id });
}

function joinRoom() {
  const name = document.getElementById('join-name').value.trim() || 'Oyuncu';
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!code || code.length !== 4) {
    document.getElementById('join-error').textContent = 'Lütfen 4 haneli oda kodunu gir!';
    return;
  }
  document.getElementById('join-error').textContent = '';
  socket.emit('joinRoom', { code, playerName: name, character: selectedChar.id });
}

function setReady() {
  const btn = document.getElementById('ready-btn');
  const me = state.allPlayers[myId];
  if (!me) return;
  me.ready = !me.ready;
  btn.textContent = me.ready ? '✅ Hazırım!' : '⏳ Hazır Değilim';
  btn.style.background = me.ready ? 'linear-gradient(135deg,#00b894,#00cec9)' : '';
  socket.emit('playerReady');
}

function enableReadyBtn() {
  const btn = document.getElementById('ready-btn');
  btn.disabled = false;
  btn.textContent = '⏳ Hazır Değilim';
}

function copyCode() {
  navigator.clipboard.writeText(myRoomCode).then(() => {
    const btn = event.target;
    btn.textContent = '✅ Kopyalandı!';
    setTimeout(() => btn.textContent = '📋 Kopyala', 2000);
  });
}

function updateLobbyPlayers() {
  const list = document.getElementById('lobby-players');
  list.innerHTML = '';
  const all = Object.values(state.allPlayers);
  all.forEach(p => {
    const char = CHARACTERS.find(c => c.id === p.character) || CHARACTERS[0];
    const row = document.createElement('div');
    row.className = 'player-row card';
    row.innerHTML = `
      <div class="p-avatar">${char.emoji}</div>
      <div class="p-info">
        <div class="p-name">${escHtml(p.name)}${p.isHost ? ' 👑' : ''}</div>
        <div class="p-char" style="color:${char.color}">${char.name}</div>
      </div>
      <div class="p-badge ${p.ready ? 'badge-ready' : 'badge-waiting'}">
        ${p.ready ? '✅ Hazır' : '⏳ Bekliyor'}
      </div>`;
    list.appendChild(row);
  });

  const status = document.getElementById('lobby-status');
  if (all.length < 2) status.textContent = 'Arkadaşlarının bağlanmasını bekle… (maks 4 oyuncu)';
  else if (all.every(p => p.ready)) status.textContent = 'Oyun başlıyor! 🎮';
  else status.textContent = 'Tüm oyuncular hazır olduğunda oyun başlar.';
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Character Selection ───────────────────────────────────────────────────────
function renderCharGrids() {
  ['create-char-grid', 'join-char-grid'].forEach(gridId => {
    const grid = document.getElementById(gridId);
    grid.innerHTML = '';
    CHARACTERS.forEach(char => {
      const card = document.createElement('div');
      card.className = 'char-card' + (char.id === selectedChar.id ? ' selected' : '');
      card.innerHTML = `
        <div class="char-emoji">${char.emoji}</div>
        <div class="char-name">${char.name}</div>
        <div class="char-dot" style="background:${char.color}"></div>`;
      card.onclick = () => {
        selectedChar = char;
        document.querySelectorAll(`#${gridId} .char-card`).forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
      };
      grid.appendChild(card);
    });
  });
}

// ── Game ─────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const floatingTexts = [];

function startLocalGame(players) {
  state.pizzas = []; state.powerups = []; state.obstacles = [];
  state.effects = {}; state.scores = {};
  floatingTexts.length = 0;

  state.allPlayers = {};
  for (const [id, p] of Object.entries(players)) {
    state.allPlayers[id] = { ...p, vx: 0, vy: 0 };
    state.scores[id] = 0;
  }
  state.myPlayer = state.allPlayers[myId];

  buildHUD();
  gameRunning = true;
  lastTime = performance.now();
  showScreen('screen-game');
  requestAnimationFrame(gameLoop);
}

// ── HUD ──────────────────────────────────────────────────────────────────────
function buildHUD() {
  const leftEl  = document.getElementById('hud-left');
  const rightEl = document.getElementById('hud-right');
  leftEl.innerHTML = rightEl.innerHTML = '';

  const me = state.allPlayers[myId];
  const opponents = Object.values(state.allPlayers).filter(p => p.id !== myId);

  leftEl.appendChild(makeHudCard(me, true));
  opponents.forEach(p => rightEl.appendChild(makeHudCard(p, false)));
}

function makeHudCard(p, isMe) {
  const char = CHARACTERS.find(c => c.id === p.character) || CHARACTERS[0];
  const div = document.createElement('div');
  div.className = 'hud-card' + (isMe ? ' hud-me' : '');
  if (isMe) div.style.borderColor = char.color + '80';
  div.innerHTML = `
    <span class="hc-avatar">${char.emoji}</span>
    <div>
      <div class="hc-name" style="color:${char.color}">${escHtml(p.name)}${isMe ? ' ▶' : ''}</div>
      <div class="hc-score" id="hc-score-${p.id}">0</div>
    </div>`;
  return div;
}

function updateHUD() {
  for (const [id, score] of Object.entries(state.scores)) {
    const el = document.getElementById(`hc-score-${id}`);
    if (el) el.textContent = score;
  }
}

// ── Game Loop ─────────────────────────────────────────────────────────────────
function gameLoop(ts) {
  if (!gameRunning) return;
  const dt = Math.min((ts - lastTime) / 16.67, 3);
  lastTime = ts;
  update(dt);
  render();
  requestAnimationFrame(gameLoop);
}

// ── Collision helper ──────────────────────────────────────────────────────────
function collidesObs(x, y) {
  const r = PLAYER_SIZE / 2;
  for (const obs of state.obstacles) {
    if (x + r > obs.x - obs.w / 2 &&
        x - r < obs.x + obs.w / 2 &&
        y + r > obs.y - obs.h / 2 &&
        y - r < obs.y + obs.h / 2) return true;
  }
  return false;
}

// ── Update ────────────────────────────────────────────────────────────────────
function update(dt) {
  const p = state.myPlayer;
  if (!p) return;

  const now = Date.now();
  const fx = state.effects[myId] || {};
  const hasSpeed  = fx.speed  > now;
  const hasSlow   = fx.slow   > now;
  const hasShield = fx.shield > now;
  const spd = PLAYER_SPEED * (hasSpeed ? 1.8 : hasSlow ? 0.45 : 1) * dt;

  let vx = 0, vy = 0;
  if (state.myKeys['ArrowUp']    || state.myKeys['w'] || state.myKeys['W']) vy -= 1;
  if (state.myKeys['ArrowDown']  || state.myKeys['s'] || state.myKeys['S']) vy += 1;
  if (state.myKeys['ArrowLeft']  || state.myKeys['a'] || state.myKeys['A']) vx -= 1;
  if (state.myKeys['ArrowRight'] || state.myKeys['d'] || state.myKeys['D']) vx += 1;
  if (vx && vy) { vx *= 0.707; vy *= 0.707; }

  // Clamp to arena bounds first
  let newX = Math.max(PLAYER_SIZE / 2, Math.min(ARENA_W - PLAYER_SIZE / 2, p.x + vx * spd));
  let newY = Math.max(PLAYER_SIZE / 2, Math.min(ARENA_H - PLAYER_SIZE / 2, p.y + vy * spd));

  // Axis-separated obstacle collision — fixes wall sticking
  if (!hasShield) {
    let hit = false;
    if (collidesObs(newX, p.y)) { newX = p.x; hit = true; }   // block X, keep old X
    if (collidesObs(p.x, newY)) { newY = p.y; hit = true; }   // block Y, keep old Y
    if (hit && !(fx.stunned > now)) {
      if (!state.effects[myId]) state.effects[myId] = {};
      state.effects[myId].stunned = now + 2000;
      state.effects[myId].slow    = now + 2000;
      showFloatingText(p.x, p.y, 'Sersemledin! 😵', '#ff5722');
      updateEffectsBar();
    }
  }

  p.x = newX; p.y = newY; p.vx = vx; p.vy = vy;
  socket.emit('playerMove', { x: p.x, y: p.y, vx, vy });

  // Collect pizzas
  for (const pizza of [...state.pizzas]) {
    const dx = p.x - pizza.x, dy = p.y - pizza.y;
    if (Math.sqrt(dx*dx + dy*dy) < COLLECT_DIST) {
      socket.emit('collectPizza', { pizzaId: pizza.id });
    }
  }

  // Collect powerups
  for (const pu of [...state.powerups]) {
    const dx = p.x - pu.x, dy = p.y - pu.y;
    if (Math.sqrt(dx*dx + dy*dy) < COLLECT_DIST + 4) {
      socket.emit('collectPowerup', { powerupId: pu.id });
    }
  }

  // Tick floating texts
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    floatingTexts[i].y -= 1.2 * dt;
    floatingTexts[i].life -= dt;
    if (floatingTexts[i].life <= 0) floatingTexts.splice(i, 1);
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  ctx.clearRect(0, 0, ARENA_W, ARENA_H);

  // Background
  ctx.fillStyle = '#0d0d1f';
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  for (let x = 0; x < ARENA_W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,ARENA_H); ctx.stroke(); }
  for (let y = 0; y < ARENA_H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(ARENA_W,y); ctx.stroke(); }

  // Arena border
  ctx.strokeStyle = '#ff4757';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, ARENA_W - 4, ARENA_H - 4);

  // Obstacles
  for (const obs of state.obstacles) {
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.roundRect(obs.x - obs.w/2, obs.y - obs.h/2, obs.w, obs.h, 6);
    ctx.fill();
    ctx.strokeStyle = '#546e7a'; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = '18px serif'; ctx.textAlign = 'center';
    ctx.fillText('🧱', obs.x, obs.y + 6);
  }

  // Pizzas
  for (const pizza of state.pizzas) {
    const pulse = 1 + 0.07 * Math.sin(Date.now() * 0.005 + pizza.id);
    ctx.save();
    ctx.translate(pizza.x, pizza.y);
    ctx.scale(pulse, pulse);
    if (pizza.gold) { ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 18; }
    ctx.font = `${PIZZA_RADIUS * 2}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🍕', 0, 0);
    if (pizza.gold) {
      ctx.shadowBlur = 0;
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = '#ffd700';
      ctx.fillText('+30', 0, -PIZZA_RADIUS - 6);
    }
    ctx.restore();
  }

  // Powerups
  const puEmoji = { speed: '⚡', slow: '🐌', shield: '🛡️' };
  for (const pu of state.powerups) {
    const pulse = 1 + 0.1 * Math.sin(Date.now() * 0.004 + pu.id);
    ctx.save();
    ctx.translate(pu.x, pu.y);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = pu.type === 'speed' ? '#ffeb3b' : pu.type === 'slow' ? '#2196f3' : '#4caf50';
    ctx.shadowBlur = 18;
    ctx.font = `${POWERUP_RADIUS * 2}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(puEmoji[pu.type], 0, 0);
    ctx.restore();
  }

  // Draw opponents first, me on top
  const sorted = Object.values(state.allPlayers).sort(p => p.id === myId ? 1 : -1);
  for (const p of sorted) drawPlayer(p, p.id === myId);

  // Floating texts
  for (const ft of floatingTexts) {
    ctx.globalAlpha = Math.min(1, ft.life / 30);
    ctx.font = 'bold 15px Nunito, sans-serif';
    ctx.fillStyle = ft.color;
    ctx.textAlign = 'center';
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.globalAlpha = 1;
  }
}

function drawPlayer(p, isMe) {
  const char = CHARACTERS.find(c => c.id === p.character) || CHARACTERS[0];
  const now = Date.now();
  const fx = state.effects[p.id] || {};
  const hasShield = fx.shield > now;
  const hasSpeed  = fx.speed  > now;
  const hasSlow   = fx.slow   > now;

  ctx.save();
  ctx.translate(p.x, p.y);

  if (hasShield) {
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_SIZE / 2 + 10, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(76,175,80,0.2)';
    ctx.fill();
    ctx.strokeStyle = '#4caf50'; ctx.lineWidth = 2; ctx.stroke();
  }
  if (hasSpeed) { ctx.shadowColor = '#ffeb3b'; ctx.shadowBlur = 20; }

  ctx.beginPath();
  ctx.arc(0, 0, PLAYER_SIZE / 2, 0, Math.PI * 2);
  ctx.fillStyle = char.color + '55';
  ctx.fill();
  if (isMe) { ctx.strokeStyle = char.color; ctx.lineWidth = 3; ctx.stroke(); }

  ctx.font = `${PLAYER_SIZE * 0.9}px serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(char.emoji, 0, 0);

  // Name tag
  ctx.shadowBlur = 0;
  ctx.font = 'bold 11px Nunito, sans-serif';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 3;
  ctx.textAlign = 'center';
  const label = (isMe ? '▶ ' : '') + p.name;
  ctx.strokeText(label, 0, -PLAYER_SIZE / 2 - 8);
  ctx.fillStyle = isMe ? char.color : 'white';
  ctx.fillText(label, 0, -PLAYER_SIZE / 2 - 8);

  if (hasSlow && !hasShield) {
    ctx.font = '12px serif';
    ctx.fillText('🐌', PLAYER_SIZE / 2 + 2, -PLAYER_SIZE / 2);
  }

  ctx.restore();
}

function showFloatingText(x, y, text, color) {
  floatingTexts.push({ x, y: y - 20, text, color, life: 60 });
}

// ── Effects ───────────────────────────────────────────────────────────────────
function applyPowerup(collectorId, type) {
  if (!state.effects[collectorId]) state.effects[collectorId] = {};
  const now = Date.now();
  const col = state.allPlayers[collectorId];

  if (type === 'speed') {
    state.effects[collectorId].speed = now + 5000;
    if (collectorId === myId && col) showFloatingText(col.x, col.y, '⚡ Hızlandın!', '#ffeb3b');
  } else if (type === 'slow') {
    const targetId = collectorId === myId
      ? Object.keys(state.allPlayers).find(id => id !== myId)
      : myId;
    if (targetId) {
      if (!state.effects[targetId]) state.effects[targetId] = {};
      state.effects[targetId].slow = now + 3000;
      if (targetId === myId && state.myPlayer) showFloatingText(state.myPlayer.x, state.myPlayer.y, '🐌 Yavaşladın!', '#2196f3');
    }
    if (collectorId === myId && col) showFloatingText(col.x, col.y, '🐌 Rakip yavaşladı!', '#ff9800');
  } else if (type === 'shield') {
    state.effects[collectorId].shield = now + 5000;
    if (collectorId === myId && col) showFloatingText(col.x, col.y, '🛡️ Kalkan aktif!', '#4caf50');
  }

  updateEffectsBar();
  setTimeout(updateEffectsBar, 5200);
}

function updateEffectsBar() {
  const bar = document.getElementById('effects-bar');
  const fx = state.effects[myId];
  if (!fx) { bar.innerHTML = ''; return; }
  const now = Date.now();
  const badges = [];
  if (fx.speed  > now) badges.push(`<div class="effect-badge">⚡ Hız ${Math.ceil((fx.speed-now)/1000)}s</div>`);
  if (fx.slow   > now) badges.push(`<div class="effect-badge">🐌 Yavaş ${Math.ceil((fx.slow-now)/1000)}s</div>`);
  if (fx.shield > now) badges.push(`<div class="effect-badge">🛡️ Kalkan ${Math.ceil((fx.shield-now)/1000)}s</div>`);
  bar.innerHTML = badges.join('');
}

// ── Result ────────────────────────────────────────────────────────────────────
function showResult(players, winnerId) {
  document.getElementById('result-trophy').textContent =
    winnerId === myId ? '🏆' : winnerId === null ? '🤝' : '😔';
  document.getElementById('result-title').textContent =
    winnerId === myId ? 'Kazandın! 🎉' : winnerId === null ? 'Beraberlik!' : 'Kaybettin…';

  const scoresEl = document.getElementById('result-scores');
  scoresEl.innerHTML = '';
  const sorted = Object.values(players).sort((a, b) => b.score - a.score);
  sorted.forEach(p => {
    const char = CHARACTERS.find(c => c.id === p.character) || CHARACTERS[0];
    const row = document.createElement('div');
    row.className = 'result-row' + (p.id === winnerId ? ' winner' : '');
    row.innerHTML = `
      <div class="result-avatar">${char.emoji}</div>
      <div class="result-name" style="color:${char.color}">${escHtml(p.name)}${p.id === winnerId ? ' 🏆' : ''}</div>
      <div class="result-score">${p.score ?? 0}</div>`;
    scoresEl.appendChild(row);
  });

  showScreen('screen-result');
}

function playAgain() {
  const me = state.allPlayers[myId];
  if (me) me.ready = false;
  const btn = document.getElementById('ready-btn');
  btn.textContent = '⏳ Hazır Değilim';
  btn.style.background = '';
  showScreen('screen-lobby');
}

// ── Input ─────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  state.myKeys[e.key] = true;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
});
document.addEventListener('keyup', e => { state.myKeys[e.key] = false; });

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderCharGrids();
  initSocket();
  const codeInput = document.getElementById('join-code');
  codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase(); });
});
