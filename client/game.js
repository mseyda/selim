// ── Config ──────────────────────────────────────────────────────────────────
const SERVER_URL = 'http://localhost:3001';
const ARENA_W = 800, ARENA_H = 600;
const PLAYER_SIZE = 32, PLAYER_SPEED = 3.5;
const PIZZA_RADIUS = 16, POWERUP_RADIUS = 18;
const COLLECT_DIST = 30;

const CHARACTERS = [
  { id: 'leo',   name: 'Leonardo',    emoji: '🐢', color: '#2196F3', bandana: '#1565C0' },
  { id: 'raph',  name: 'Raphael',     emoji: '🐢', color: '#f44336', bandana: '#b71c1c' },
  { id: 'mike',  name: 'Michelangelo',emoji: '🐢', color: '#ff9800', bandana: '#e65100' },
  { id: 'don',   name: 'Donatello',   emoji: '🐢', color: '#9c27b0', bandana: '#4a148c' },
];

// ── State ───────────────────────────────────────────────────────────────────
let socket;
let myId = null, myRoomCode = null;
let selectedChar = CHARACTERS[0];
let gameRunning = false;
let lastTime = 0;

const state = {
  myPlayer: null,
  opponent: null,
  pizzas: [],
  powerups: [],
  obstacles: [],
  scores: {},
  effects: {},  // playerId -> { speed, slow, shield }
  myKeys: {},
};

// ── Socket ──────────────────────────────────────────────────────────────────
function initSocket() {
  socket = io(SERVER_URL);

  socket.on('connect', () => { myId = socket.id; });

  socket.on('roomCreated', ({ code, player }) => {
    myRoomCode = code;
    state.myPlayer = player;
    document.getElementById('lobby-code').textContent = code;
    updateLobbyPlayers({ [player.id]: player });
    enableReadyBtn();
    showScreen('screen-lobby');
  });

  socket.on('joinedRoom', ({ code, player }) => {
    myRoomCode = code;
    state.myPlayer = player;
    document.getElementById('lobby-code').textContent = code;
    updateLobbyPlayers({ [player.id]: player });
    enableReadyBtn();
    showScreen('screen-lobby');
  });

  socket.on('joinError', (msg) => {
    document.getElementById('join-error').textContent = msg;
  });

  socket.on('playerJoined', ({ players }) => {
    updateLobbyPlayers(players);
  });

  socket.on('readyUpdate', ({ players }) => {
    updateLobbyPlayers(players);
    const all = Object.values(players);
    if (all.length === 2 && all.every(p => p.ready)) {
      document.getElementById('lobby-status').textContent = 'Oyun başlıyor...';
    }
  });

  socket.on('gameStart', ({ players, duration }) => {
    startLocalGame(players, duration);
  });

  socket.on('opponentMove', ({ id, x, y, vx, vy }) => {
    if (state.opponent) {
      state.opponent.x = x;
      state.opponent.y = y;
      state.opponent.vx = vx || 0;
      state.opponent.vy = vy || 0;
    }
  });

  socket.on('pizzaSpawned', (pizza) => { state.pizzas.push(pizza); });
  socket.on('powerupSpawned', (pu) => { state.powerups.push(pu); });
  socket.on('obstacleSpawned', (obs) => { state.obstacles.push(obs); });

  socket.on('pizzaCollected', ({ pizzaId, collectorId, scores }) => {
    state.pizzas = state.pizzas.filter(p => p.id !== pizzaId);
    state.scores = scores;
    updateHUD();
    if (collectorId === myId) showFloatingText(state.myPlayer.x, state.myPlayer.y, '+10', '#fff');
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
      alert('Rakip oyundan ayrıldı!');
      showScreen('screen-menu');
    }
  });
}

// ── Screens ─────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function createRoom() {
  const name = document.getElementById('create-name').value.trim() || 'Oyuncu 1';
  socket.emit('createRoom', { playerName: name, character: selectedChar.id });
}

function joinRoom() {
  const name = document.getElementById('join-name').value.trim() || 'Oyuncu 2';
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
  state.myPlayer.ready = !state.myPlayer.ready;
  btn.textContent = state.myPlayer.ready ? '✅ Hazırım!' : '⏳ Hazır Değilim';
  btn.style.background = state.myPlayer.ready
    ? 'linear-gradient(135deg, #4caf50, #388e3c)'
    : 'linear-gradient(135deg, #e94560, #c62a47)';
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
    setTimeout(() => btn.textContent = '📋 Kodu Kopyala', 2000);
  });
}

function updateLobbyPlayers(players) {
  const list = document.getElementById('lobby-players');
  list.innerHTML = '';
  const all = Object.values(players);
  all.forEach(p => {
    const char = CHARACTERS.find(c => c.id === p.character) || CHARACTERS[0];
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `
      <div class="p-emoji">${char.emoji}</div>
      <div class="p-info">
        <div class="p-name">${escHtml(p.name)} ${p.isHost ? '👑' : ''}</div>
        <div class="p-char" style="color:${char.color}">${char.name}</div>
      </div>
      <div class="p-status ${p.ready ? 'status-ready' : 'status-waiting'}">
        ${p.ready ? '✅ Hazır' : '⏳ Bekliyor'}
      </div>
    `;
    list.appendChild(row);
  });

  const status = document.getElementById('lobby-status');
  if (all.length < 2) status.textContent = 'Arkadaşının bağlanmasını bekle...';
  else if (all.every(p => p.ready)) status.textContent = 'Oyun başlıyor...';
  else status.textContent = 'Her iki oyuncu da hazır olduğunda oyun başlar.';
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Character Selection ──────────────────────────────────────────────────────
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
        <div class="char-color" style="background:${char.color}"></div>
      `;
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

function startLocalGame(players, duration) {
  state.pizzas = [];
  state.powerups = [];
  state.obstacles = [];
  state.effects = {};
  floatingTexts.length = 0;

  const ids = Object.keys(players);
  const myIdx = ids.indexOf(myId);
  state.myPlayer = { ...players[myId], vx: 0, vy: 0 };
  const opId = ids.find(id => id !== myId);
  state.opponent = opId ? { ...players[opId], vx: 0, vy: 0 } : null;

  state.scores[myId] = 0;
  if (opId) state.scores[opId] = 0;

  // HUD
  const myChar = CHARACTERS.find(c => c.id === state.myPlayer.character) || CHARACTERS[0];
  const opChar = state.opponent ? CHARACTERS.find(c => c.id === state.opponent.character) || CHARACTERS[0] : null;

  document.getElementById('hud-p1-name').textContent = state.myPlayer.name;
  document.getElementById('hud-p1-score').textContent = '0';
  document.getElementById('hud-p1-avatar').textContent = myChar.emoji;
  if (state.opponent) {
    document.getElementById('hud-p2-name').textContent = state.opponent.name;
    document.getElementById('hud-p2-score').textContent = '0';
    document.getElementById('hud-p2-avatar').textContent = opChar.emoji;
  }

  gameRunning = true;
  showScreen('screen-game');
  requestAnimationFrame(gameLoop);
}

function gameLoop(ts) {
  if (!gameRunning) return;
  const dt = Math.min((ts - lastTime) / 16.67, 3);
  lastTime = ts;

  update(dt);
  render();
  requestAnimationFrame(gameLoop);
}

function update(dt) {
  const p = state.myPlayer;
  if (!p) return;

  const hasSpeed = state.effects[myId]?.speed > Date.now();
  const hasSlow = state.effects[myId]?.slow > Date.now();
  const spd = PLAYER_SPEED * (hasSpeed ? 1.8 : hasSlow ? 0.45 : 1) * dt;

  let vx = 0, vy = 0;
  if (state.myKeys['ArrowUp']    || state.myKeys['w'] || state.myKeys['W']) vy -= 1;
  if (state.myKeys['ArrowDown']  || state.myKeys['s'] || state.myKeys['S']) vy += 1;
  if (state.myKeys['ArrowLeft']  || state.myKeys['a'] || state.myKeys['A']) vx -= 1;
  if (state.myKeys['ArrowRight'] || state.myKeys['d'] || state.myKeys['D']) vx += 1;

  if (vx && vy) { vx *= 0.707; vy *= 0.707; }

  const nx = Math.max(PLAYER_SIZE/2, Math.min(ARENA_W - PLAYER_SIZE/2, p.x + vx * spd));
  const ny = Math.max(PLAYER_SIZE/2, Math.min(ARENA_H - PLAYER_SIZE/2, p.y + vy * spd));

  const hasShield = state.effects[myId]?.shield > Date.now();
  let blocked = false;
  if (!hasShield) {
    for (const obs of state.obstacles) {
      if (nx > obs.x - obs.w/2 - PLAYER_SIZE/2 && nx < obs.x + obs.w/2 + PLAYER_SIZE/2 &&
          ny > obs.y - obs.h/2 - PLAYER_SIZE/2 && ny < obs.y + obs.h/2 + PLAYER_SIZE/2) {
        blocked = true;
        if (!state.effects[myId]) state.effects[myId] = {};
        if (!state.effects[myId].stunned) {
          state.effects[myId].stunned = Date.now() + 2000;
          state.effects[myId].slow = Date.now() + 2000;
          showFloatingText(p.x, p.y, 'Sersemledin! 😵', '#ff5722');
        }
        break;
      }
    }
  }

  if (!blocked) { p.x = nx; p.y = ny; p.vx = vx; p.vy = vy; }
  else { p.vx = 0; p.vy = 0; }

  // Send position every frame (throttle to ~20/s is fine for a LAN game)
  socket.emit('playerMove', { x: p.x, y: p.y, vx: p.vx, vy: p.vy });

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

  // Floating texts
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    floatingTexts[i].y -= 1.2 * dt;
    floatingTexts[i].life -= dt;
    if (floatingTexts[i].life <= 0) floatingTexts.splice(i, 1);
  }
}

function render() {
  ctx.clearRect(0, 0, ARENA_W, ARENA_H);

  // Background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < ARENA_W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,ARENA_H); ctx.stroke(); }
  for (let y = 0; y < ARENA_H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(ARENA_W,y); ctx.stroke(); }

  // Border
  ctx.strokeStyle = '#e94560';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, ARENA_W-4, ARENA_H-4);

  // Obstacles
  for (const obs of state.obstacles) {
    ctx.fillStyle = '#37474f';
    ctx.beginPath();
    ctx.roundRect(obs.x - obs.w/2, obs.y - obs.h/2, obs.w, obs.h, 6);
    ctx.fill();
    ctx.strokeStyle = '#546e7a';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = '18px serif';
    ctx.textAlign = 'center';
    ctx.fillText('🧱', obs.x, obs.y + 6);
  }

  // Pizzas
  for (const pizza of state.pizzas) {
    const now = Date.now();
    const pulse = 1 + 0.08 * Math.sin(now * 0.005 + pizza.id);
    ctx.save();
    ctx.translate(pizza.x, pizza.y);
    ctx.scale(pulse, pulse);
    if (pizza.gold) {
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 15;
    }
    ctx.font = `${PIZZA_RADIUS * 2}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pizza.gold ? '🍕' : '🍕', 0, 0);
    if (pizza.gold) {
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
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(puEmoji[pu.type], 0, 0);
    ctx.restore();
  }

  // Players
  if (state.opponent) drawPlayer(state.opponent, false);
  if (state.myPlayer) drawPlayer(state.myPlayer, true);

  // Floating texts
  for (const ft of floatingTexts) {
    ctx.globalAlpha = Math.min(1, ft.life / 30);
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = ft.color;
    ctx.textAlign = 'center';
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.globalAlpha = 1;
  }
}

function drawPlayer(p, isMe) {
  const char = CHARACTERS.find(c => c.id === p.character) || CHARACTERS[0];
  const hasShield = state.effects[p.id]?.shield > Date.now();
  const hasSpeed = state.effects[p.id]?.speed > Date.now();
  const hasSlow = state.effects[p.id]?.slow > Date.now();

  ctx.save();
  ctx.translate(p.x, p.y);

  // Shield glow
  if (hasShield) {
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_SIZE / 2 + 10, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(76,175,80,0.25)';
    ctx.fill();
    ctx.strokeStyle = '#4caf50';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Speed trail
  if (hasSpeed) {
    ctx.shadowColor = '#ffeb3b';
    ctx.shadowBlur = 20;
  }

  // Body circle
  ctx.beginPath();
  ctx.arc(0, 0, PLAYER_SIZE / 2, 0, Math.PI * 2);
  ctx.fillStyle = char.color;
  ctx.fill();
  if (isMe) {
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Emoji face
  ctx.font = `${PLAYER_SIZE * 0.9}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char.emoji, 0, 0);

  // Name tag
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 3;
  ctx.textAlign = 'center';
  const label = (isMe ? '▶ ' : '') + p.name;
  ctx.strokeText(label, 0, -PLAYER_SIZE/2 - 8);
  ctx.fillText(label, 0, -PLAYER_SIZE/2 - 8);

  // Status icon
  if (hasSlow) {
    ctx.font = '14px serif';
    ctx.fillText('🐌', PLAYER_SIZE/2 + 2, -PLAYER_SIZE/2 + 2);
  }

  ctx.restore();
}

function showFloatingText(x, y, text, color) {
  floatingTexts.push({ x, y: y - 20, text, color, life: 60 });
}

// ── Effects ──────────────────────────────────────────────────────────────────
function applyPowerup(collectorId, type) {
  if (!state.effects[collectorId]) state.effects[collectorId] = {};
  const now = Date.now();

  if (type === 'speed') {
    state.effects[collectorId].speed = now + 5000;
    if (collectorId === myId) showFloatingText(state.myPlayer.x, state.myPlayer.y, '⚡ Hızlandın!', '#ffeb3b');
  } else if (type === 'slow') {
    const targetId = collectorId === myId
      ? (state.opponent?.id)
      : myId;
    if (targetId) {
      if (!state.effects[targetId]) state.effects[targetId] = {};
      state.effects[targetId].slow = now + 3000;
      if (targetId === myId) showFloatingText(state.myPlayer.x, state.myPlayer.y, '🐌 Yavaşladın!', '#2196f3');
    }
    if (collectorId === myId) showFloatingText(state.myPlayer.x, state.myPlayer.y, '🐌 Rakip yavaşladı!', '#ff9800');
  } else if (type === 'shield') {
    state.effects[collectorId].shield = now + 5000;
    if (collectorId === myId) showFloatingText(state.myPlayer.x, state.myPlayer.y, '🛡️ Kalkan aktif!', '#4caf50');
  }

  updateEffectsBar();
  setTimeout(updateEffectsBar, Math.max(3000, 5000) + 200);
}

function updateEffectsBar() {
  const bar = document.getElementById('effects-bar');
  if (!state.effects[myId]) { bar.innerHTML = ''; return; }
  const now = Date.now();
  const badges = [];
  const e = state.effects[myId];
  if (e.speed > now) badges.push(`<div class="effect-badge">⚡ Hız ${Math.ceil((e.speed-now)/1000)}s</div>`);
  if (e.slow  > now) badges.push(`<div class="effect-badge">🐌 Yavaş ${Math.ceil((e.slow-now)/1000)}s</div>`);
  if (e.shield > now) badges.push(`<div class="effect-badge">🛡️ Kalkan ${Math.ceil((e.shield-now)/1000)}s</div>`);
  bar.innerHTML = badges.join('');
}

function updateHUD() {
  document.getElementById('hud-p1-score').textContent = state.scores[myId] || 0;
  if (state.opponent) document.getElementById('hud-p2-score').textContent = state.scores[state.opponent.id] || 0;
}

// ── Result ───────────────────────────────────────────────────────────────────
function showResult(players, winnerId) {
  const myChar = CHARACTERS.find(c => c.id === state.myPlayer?.character) || CHARACTERS[0];
  const opChar = state.opponent ? CHARACTERS.find(c => c.id === state.opponent.character) || CHARACTERS[0] : null;

  document.getElementById('result-trophy').textContent = winnerId === myId ? '🏆' : winnerId === null ? '🤝' : '😔';
  document.getElementById('result-title').textContent = winnerId === myId ? 'Kazandın!' : winnerId === null ? 'Beraberlik!' : 'Kaybettin...';

  const scoresEl = document.getElementById('result-scores');
  scoresEl.innerHTML = '';

  Object.values(players).forEach(p => {
    const char = CHARACTERS.find(c => c.id === p.character) || CHARACTERS[0];
    const row = document.createElement('div');
    row.className = 'result-score-row' + (p.id === winnerId ? ' winner' : '');
    row.innerHTML = `
      <div class="r-emoji">${char.emoji}</div>
      <div class="r-name" style="color:${char.color}">${escHtml(p.name)} ${p.id === winnerId ? '🏆' : ''}</div>
      <div class="r-score">${players[p.id]?.score ?? state.scores[p.id] ?? 0}</div>
    `;
    scoresEl.appendChild(row);
  });

  showScreen('screen-result');
}

function playAgain() {
  showScreen('screen-lobby');
  state.myPlayer.ready = false;
  const btn = document.getElementById('ready-btn');
  btn.textContent = '⏳ Hazır Değilim';
  btn.style.background = '';
}

// ── Input ────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  state.myKeys[e.key] = true;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
});
document.addEventListener('keyup', e => { state.myKeys[e.key] = false; });

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderCharGrids();
  initSocket();
  document.getElementById('join-code').addEventListener('input', function() {
    this.value = this.value.toUpperCase();
  });
});
