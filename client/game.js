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

// ── TMNT Portrait Drawing ─────────────────────────────────────────────────────
function drawTurtlePortrait(ctx, cx, cy, s, charId, isFrozen = false) {
  const maskCol = { leo:'#1565c0', raph:'#c62828', mike:'#e65100', don:'#6a1b9a' }[charId] || '#1565c0';
  const darkG  = isFrozen ? '#2a5f7a' : '#286028';
  const lightG = isFrozen ? '#46a0b8' : '#4ec04e';

  ctx.save();
  ctx.translate(cx, cy);

  // Dark green outer head
  ctx.beginPath();
  ctx.ellipse(0, 0, s*0.46, s*0.5, 0, 0, Math.PI*2);
  ctx.fillStyle = darkG;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Lighter face area
  ctx.beginPath();
  ctx.ellipse(0, s*0.06, s*0.35, s*0.42, 0, 0, Math.PI*2);
  ctx.fillStyle = lightG;
  ctx.fill();

  // Colored mask band (horizontal ellipse over eye area)
  const mY = -s*0.12;
  ctx.beginPath();
  ctx.ellipse(0, mY, s*0.46, s*0.14, 0, 0, Math.PI*2);
  ctx.fillStyle = maskCol;
  ctx.fill();

  // Mask tails (right side — two flowing ribbons)
  ctx.fillStyle = maskCol;
  ctx.beginPath();
  ctx.moveTo(s*0.32, mY - s*0.07);
  ctx.bezierCurveTo(s*0.6, mY-s*0.22, s*0.65, mY-s*0.02, s*0.45, mY+s*0.08);
  ctx.bezierCurveTo(s*0.38, mY+s*0.09, s*0.35, mY+s*0.03, s*0.32, mY-s*0.07);
  ctx.closePath(); ctx.fill();

  ctx.beginPath();
  ctx.moveTo(s*0.32, mY + s*0.07);
  ctx.bezierCurveTo(s*0.62, mY+s*0.02, s*0.66, mY+s*0.2, s*0.46, mY+s*0.25);
  ctx.bezierCurveTo(s*0.38, mY+s*0.26, s*0.35, mY+s*0.2, s*0.32, mY+s*0.07);
  ctx.closePath(); ctx.fill();

  // White eye ovals within mask
  const eY = mY + s*0.01, eG = s*0.15;
  [-eG, eG].forEach(eX => {
    ctx.beginPath();
    ctx.ellipse(eX, eY, s*0.1, s*0.11, 0, 0, Math.PI*2);
    ctx.fillStyle = 'white'; ctx.fill();

    ctx.beginPath();
    ctx.ellipse(eX+s*0.015, eY+s*0.01, s*0.055, s*0.065, 0, 0, Math.PI*2);
    ctx.fillStyle = '#111'; ctx.fill();

    ctx.beginPath();
    ctx.arc(eX+s*0.04, eY-s*0.03, s*0.018, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
  });

  // Nostrils
  ctx.fillStyle = isFrozen ? '#1a506a' : '#2a622a';
  [-s*0.07, s*0.07].forEach(nX => {
    ctx.beginPath();
    ctx.ellipse(nX, s*0.2, s*0.028, s*0.022, nX<0?-0.3:0.3, 0, Math.PI*2);
    ctx.fill();
  });

  // Smile
  ctx.strokeStyle = isFrozen ? '#1a506a' : '#2a622a';
  ctx.lineWidth = s*0.033; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, s*0.2, s*0.15, 0.28, Math.PI-0.28);
  ctx.stroke();

  ctx.restore();
}

function createPortraitEl(charId, sz, isFrozen = false) {
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = sz;
  cvs.style.cssText = `width:${sz}px;height:${sz}px;display:block;flex-shrink:0;`;
  drawTurtlePortrait(cvs.getContext('2d'), sz*0.5, sz*0.53, sz*0.7, charId, isFrozen);
  return cvs;
}

// ── State ────────────────────────────────────────────────────────────────────
let socket, myId = null, myRoomCode = null;
let selectedChar = CHARACTERS[0];
let gameRunning = false, lastTime = 0;

const state = {
  myPlayer:   null,
  allPlayers: {},
  pizzas:     [],
  powerups:   [],
  obstacles:  [],
  topac:      null,         // { x, y } — server güncelliyor
  scores:     {},
  effects:    {},           // id → { speed, slow, shield, stunned, frozen }
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
    const pizza = state.pizzas.find(p => p.id === pizzaId);
    state.pizzas = state.pizzas.filter(p => p.id !== pizzaId);
    Object.assign(state.scores, scores);
    updateHUD();
    const col = state.allPlayers[collectorId];
    if (col) {
      const pts = pizza?.gold ? 30 : 10;
      showFloatingText(col.x, col.y, `+${pts}`, pizza?.gold ? '#ffd700' : '#fff');
      if (collectorId === myId) pizza?.gold ? audio.goldPizza() : audio.pizza();
    }
  });

  socket.on('powerupCollected', ({ powerupId, collectorId, type }) => {
    state.powerups = state.powerups.filter(p => p.id !== powerupId);
    applyPowerup(collectorId, type);
    if (collectorId === myId) audio.powerup(type);
  });

  socket.on('topacUpdate', ({ x, y }) => {
    if (!state.topac) state.topac = { x, y };
    else { state.topac.x = x; state.topac.y = y; }
  });

  socket.on('playerFrozen', ({ targetId, until }) => {
    if (!state.effects[targetId]) state.effects[targetId] = {};
    state.effects[targetId].frozen = until;
    const target = state.allPlayers[targetId];
    if (target) showFloatingText(target.x, target.y, '❄️ Dondu!', '#29b6f6');
    if (targetId === myId) { audio.hit(); updateEffectsBar(); }
  });

  socket.on('timerUpdate', (remaining) => {
    const el = document.getElementById('game-timer');
    el.textContent = remaining;
    el.classList.toggle('urgent', remaining <= 10);
    if (remaining <= 10 && remaining > 0) audio.countdown();
  });

  socket.on('gameEnd', ({ players, winner }) => {
    gameRunning = false;
    audio.stopMusic();
    setTimeout(() => winner === myId ? audio.win() : audio.lose(), 300);
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

function toggleMute() {
  const muted = audio.toggleMute();
  document.getElementById('mute-btn').textContent = muted ? '🔇' : '🔊';
}

function createRoom() {
  audio._boot();
  const name = document.getElementById('create-name').value.trim() || 'Oyuncu 1';
  socket.emit('createRoom', { playerName: name, character: selectedChar.id });
}

function joinRoom() {
  audio._boot();
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

    row.appendChild(createPortraitEl(char.id, 52));

    const info = document.createElement('div');
    info.className = 'p-info';
    const pName = document.createElement('div');
    pName.className = 'p-name';
    pName.textContent = p.name + (p.isHost ? ' 👑' : '');
    const pChar = document.createElement('div');
    pChar.className = 'p-char';
    pChar.style.color = char.color;
    pChar.textContent = char.name;
    info.appendChild(pName); info.appendChild(pChar);
    row.appendChild(info);

    const badge = document.createElement('div');
    badge.className = 'p-badge ' + (p.ready ? 'badge-ready' : 'badge-waiting');
    badge.textContent = p.ready ? '✅ Hazır' : '⏳ Bekliyor';
    row.appendChild(badge);

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

      const portrait = document.createElement('canvas');
      portrait.className = 'char-portrait';
      portrait.width = portrait.height = 72;
      drawTurtlePortrait(portrait.getContext('2d'), 36, 38, 50, char.id);
      card.appendChild(portrait);

      const nameDiv = document.createElement('div');
      nameDiv.className = 'char-name';
      nameDiv.textContent = char.name;
      card.appendChild(nameDiv);

      const dotDiv = document.createElement('div');
      dotDiv.className = 'char-dot';
      dotDiv.style.background = char.color;
      card.appendChild(dotDiv);

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
  audio.gameStart();
  setTimeout(() => audio.startMusic(), 600);
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

  div.appendChild(createPortraitEl(char.id, 38));

  const info = document.createElement('div');
  const hcName = document.createElement('div');
  hcName.className = 'hc-name';
  hcName.style.color = char.color;
  hcName.textContent = p.name + (isMe ? ' ▶' : '');
  const hcScore = document.createElement('div');
  hcScore.className = 'hc-score';
  hcScore.id = `hc-score-${p.id}`;
  hcScore.textContent = '0';
  info.appendChild(hcName); info.appendChild(hcScore);
  div.appendChild(info);

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

// ── Collision helpers ─────────────────────────────────────────────────────────
const R = PLAYER_SIZE / 2;

function collidesObs(x, y) {
  for (const obs of state.obstacles) {
    if (x + R > obs.x - obs.w / 2 &&
        x - R < obs.x + obs.w / 2 &&
        y + R > obs.y - obs.h / 2 &&
        y - R < obs.y + obs.h / 2) return true;
  }
  return false;
}

// Push the player out of any obstacle it currently overlaps.
// This ensures p.x/p.y is always outside obstacles before movement is resolved,
// which prevents the axis-separated check from seeing false positives on both axes.
function pushOut(p) {
  for (const obs of state.obstacles) {
    const ox1 = obs.x - obs.w / 2, ox2 = obs.x + obs.w / 2;
    const oy1 = obs.y - obs.h / 2, oy2 = obs.y + obs.h / 2;
    if (p.x + R <= ox1 || p.x - R >= ox2 || p.y + R <= oy1 || p.y - R >= oy2) continue;
    // Overlapping — push out along the shallowest axis
    const ol = (p.x + R) - ox1;   // overlap from left
    const or_ = ox2 - (p.x - R);  // overlap from right
    const ot = (p.y + R) - oy1;   // overlap from top
    const ob = oy2 - (p.y - R);   // overlap from bottom
    const min = Math.min(ol, or_, ot, ob);
    if      (min === ol)  p.x = ox1 - R;
    else if (min === or_) p.x = ox2 + R;
    else if (min === ot)  p.y = oy1 - R;
    else                  p.y = oy2 + R;
  }
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
  let   hasFrozen = fx.frozen > now;

  // Topaç çarpışması (kalkan korur)
  if (state.topac && !hasShield && !hasFrozen) {
    const dist = Math.hypot(p.x - state.topac.x, p.y - state.topac.y);
    if (dist < R + 22) {
      if (!state.effects[myId]) state.effects[myId] = {};
      state.effects[myId].frozen = now + 3000;
      hasFrozen = true;
      showFloatingText(p.x, p.y, '❄️ Dondu!', '#29b6f6');
      audio.hit();
      updateEffectsBar();
      socket.emit('topacHit', { targetId: myId });
    }
  }

  const spd = hasFrozen ? 0 : PLAYER_SPEED * (hasSpeed ? 1.8 : hasSlow ? 0.45 : 1) * dt;

  let vx = 0, vy = 0;
  if (!hasFrozen) {
    if (state.myKeys['ArrowUp']    || state.myKeys['w'] || state.myKeys['W']) vy -= 1;
    if (state.myKeys['ArrowDown']  || state.myKeys['s'] || state.myKeys['S']) vy += 1;
    if (state.myKeys['ArrowLeft']  || state.myKeys['a'] || state.myKeys['A']) vx -= 1;
    if (state.myKeys['ArrowRight'] || state.myKeys['d'] || state.myKeys['D']) vx += 1;
    if (vx && vy) { vx *= 0.707; vy *= 0.707; }
  }

  // 1) Push player out of any overlap FIRST so p.x/p.y is guaranteed clean.
  //    Without this, collidesObs(p.x, newY) can return true even when the player
  //    is just grazing a corner, locking both axes simultaneously.
  if (!hasShield) pushOut(p);

  // 2) Desired positions (arena-unclamped so wall-slide works correctly)
  let newX = p.x + vx * spd;
  let newY = p.y + vy * spd;

  // 3) Axis-separated obstacle check — now reliable because p.x/p.y is clean
  let hit = false;
  if (!hasShield) {
    if (collidesObs(newX, p.y)) { newX = p.x; hit = true; }
    if (collidesObs(p.x, newY)) { newY = p.y; hit = true; }
    if (hit && !(fx.stunned > now)) {
      if (!state.effects[myId]) state.effects[myId] = {};
      state.effects[myId].stunned = now + 2000;
      state.effects[myId].slow    = now + 2000;
      showFloatingText(p.x, p.y, 'Sersemledin! 😵', '#ff5722');
      audio.hit();
      updateEffectsBar();
    }
  }

  // 4) Clamp to arena bounds last (so wall-slide isn't confused by clamping)
  p.x = Math.max(R, Math.min(ARENA_W - R, newX));
  p.y = Math.max(R, Math.min(ARENA_H - R, newY));
  p.vx = vx; p.vy = vy;
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

  // Topaç
  drawTopac();

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

function drawTopac() {
  if (!state.topac) return;
  const { x, y } = state.topac;
  const spin = (Date.now() * 0.007) % (Math.PI * 2);
  const pulse = 1 + 0.06 * Math.sin(Date.now() * 0.004);

  ctx.save();
  ctx.translate(x, y);

  // Tehlike alanı (soluk halka)
  ctx.beginPath();
  ctx.arc(0, 0, (R + 22) * pulse, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,64,129,0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.rotate(spin);
  ctx.shadowColor = '#ff4081';
  ctx.shadowBlur = 16;

  // 4 renkli dilim (beyblade stili)
  const colors = ['#ff4757', '#ffd32a', '#2ed573', '#4fc3f7'];
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 18, i * Math.PI/2, (i+1) * Math.PI/2);
    ctx.fillStyle = colors[i];
    ctx.fill();
  }
  // Dış çember
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Merkez
  ctx.beginPath();
  ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = 'white';
  ctx.shadowBlur = 0;
  ctx.fill();

  ctx.restore();

  // Sivri uç (döndürme dışında sabit)
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-3, 16); ctx.lineTo(3, 16); ctx.lineTo(0, 27);
  ctx.closePath();
  ctx.fillStyle = '#666';
  ctx.fill();
  ctx.restore();
}

function drawPlayer(p, isMe) {
  const char = CHARACTERS.find(c => c.id === p.character) || CHARACTERS[0];
  const now = Date.now();
  const fx = state.effects[p.id] || {};
  const hasShield = fx.shield > now;
  const hasSpeed  = fx.speed  > now;
  const hasSlow   = fx.slow   > now;
  const hasFrozen = fx.frozen > now;

  ctx.save();
  ctx.translate(p.x, p.y);

  // Donma efekti (kalkan altında değilse)
  if (hasFrozen) {
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_SIZE / 2 + 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(100,200,255,0.35)';
    ctx.fill();
    ctx.strokeStyle = '#29b6f6'; ctx.lineWidth = 3; ctx.stroke();
    ctx.shadowColor = '#29b6f6'; ctx.shadowBlur = 14;
  }

  if (hasShield) {
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_SIZE / 2 + 10, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(76,175,80,0.2)';
    ctx.fill();
    ctx.strokeStyle = '#4caf50'; ctx.lineWidth = 2; ctx.stroke();
  }
  if (hasSpeed && !hasFrozen) { ctx.shadowColor = '#ffeb3b'; ctx.shadowBlur = 20; }

  ctx.beginPath();
  ctx.arc(0, 0, PLAYER_SIZE / 2, 0, Math.PI * 2);
  ctx.fillStyle = hasFrozen ? '#90caf9' + '88' : char.color + '55';
  ctx.fill();
  if (isMe) { ctx.strokeStyle = hasFrozen ? '#29b6f6' : char.color; ctx.lineWidth = 3; ctx.stroke(); }

  drawTurtlePortrait(ctx, 0, 0, PLAYER_SIZE, char.id, hasFrozen);

  ctx.shadowBlur = 0;
  ctx.font = 'bold 11px Nunito, sans-serif';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 3;
  ctx.textAlign = 'center';
  const label = (isMe ? '▶ ' : '') + p.name;
  ctx.strokeText(label, 0, -PLAYER_SIZE / 2 - 8);
  ctx.fillStyle = hasFrozen ? '#29b6f6' : isMe ? char.color : 'white';
  ctx.fillText(label, 0, -PLAYER_SIZE / 2 - 8);

  // Durum ikonları
  if (hasFrozen) {
    ctx.font = '13px serif';
    ctx.fillText('❄️', PLAYER_SIZE / 2 + 4, -PLAYER_SIZE / 2);
  } else if (hasSlow && !hasShield) {
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
  if (fx.frozen > now) badges.push(`<div class="effect-badge" style="color:#29b6f6">❄️ Dondu ${Math.ceil((fx.frozen-now)/1000)}s</div>`);
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

    row.appendChild(createPortraitEl(char.id, 52));

    const nameDiv = document.createElement('div');
    nameDiv.className = 'result-name';
    nameDiv.style.color = char.color;
    nameDiv.textContent = p.name + (p.id === winnerId ? ' 🏆' : '');
    row.appendChild(nameDiv);

    const scoreDiv = document.createElement('div');
    scoreDiv.className = 'result-score';
    scoreDiv.textContent = p.score ?? 0;
    row.appendChild(scoreDiv);

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

// ── Keyboard Input ────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  state.myKeys[e.key] = true;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
});
document.addEventListener('keyup', e => { state.myKeys[e.key] = false; });

// ── D-pad (touch + mouse) ─────────────────────────────────────────────────────
function setupDpad() {
  document.querySelectorAll('.dpad-btn[data-key]').forEach(btn => {
    const key = btn.dataset.key;
    const press   = e => { e.preventDefault(); state.myKeys[key] = true;  btn.classList.add('pressed'); };
    const release = e => { e.preventDefault(); state.myKeys[key] = false; btn.classList.remove('pressed'); };
    btn.addEventListener('touchstart',  press,   { passive: false });
    btn.addEventListener('touchend',    release, { passive: false });
    btn.addEventListener('touchcancel', release, { passive: false });
    btn.addEventListener('mousedown',  press);
    btn.addEventListener('mouseup',    release);
    btn.addEventListener('mouseleave', release);
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderCharGrids();
  initSocket();
  setupDpad();
  const codeInput = document.getElementById('join-code');
  codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase(); });
});
