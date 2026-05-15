const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function spawnPizza(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const ARENA_W = 800, ARENA_H = 600, MARGIN = 40;
  const isGold = Math.random() < 0.15;
  const pizza = {
    id: Date.now() + Math.random(),
    x: MARGIN + Math.random() * (ARENA_W - MARGIN * 2),
    y: MARGIN + Math.random() * (ARENA_H - MARGIN * 2),
    gold: isGold,
    points: isGold ? 30 : 10
  };
  room.pizzas.push(pizza);
  io.to(roomCode).emit('pizzaSpawned', pizza);
}

function spawnPowerup(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.powerups.length >= 3) return;
  const ARENA_W = 800, ARENA_H = 600, MARGIN = 40;
  const types = ['speed', 'slow', 'shield'];
  const pu = {
    id: Date.now() + Math.random(),
    x: MARGIN + Math.random() * (ARENA_W - MARGIN * 2),
    y: MARGIN + Math.random() * (ARENA_H - MARGIN * 2),
    type: types[Math.floor(Math.random() * types.length)]
  };
  room.powerups.push(pu);
  io.to(roomCode).emit('powerupSpawned', pu);
}

function spawnObstacle(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.obstacles.length >= 4) return;
  const ARENA_W = 800, ARENA_H = 600, MARGIN = 60;
  const obs = {
    id: Date.now() + Math.random(),
    x: MARGIN + Math.random() * (ARENA_W - MARGIN * 2),
    y: MARGIN + Math.random() * (ARENA_H - MARGIN * 2),
    w: 50 + Math.random() * 30,
    h: 30 + Math.random() * 20
  };
  room.obstacles.push(obs);
  io.to(roomCode).emit('obstacleSpawned', obs);
}

function startGameLoop(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  room.gameState = 'playing';
  room.startTime = Date.now();
  room.gameDuration = 90000;
  room.pizzas = [];
  room.powerups = [];
  room.obstacles = [];

  const players = Object.values(room.players);
  players[0].x = 150; players[0].y = 300; players[0].score = 0;
  players[1].x = 650; players[1].y = 300; players[1].score = 0;

  io.to(roomCode).emit('gameStart', {
    players: room.players,
    duration: 90
  });

  for (let i = 0; i < 5; i++) spawnPizza(roomCode);
  for (let i = 0; i < 2; i++) spawnObstacle(roomCode);

  room.pizzaInterval = setInterval(() => {
    if (room.pizzas.length < 6) spawnPizza(roomCode);
  }, 2000);

  room.powerupInterval = setInterval(() => {
    spawnPowerup(roomCode);
  }, 5000);

  room.timerInterval = setInterval(() => {
    if (!rooms[roomCode]) { clearAllIntervals(room); return; }
    const elapsed = Date.now() - room.startTime;
    const remaining = Math.max(0, Math.ceil((room.gameDuration - elapsed) / 1000));
    io.to(roomCode).emit('timerUpdate', remaining);
    if (remaining <= 0) {
      endGame(roomCode);
    }
  }, 1000);
}

function clearAllIntervals(room) {
  clearInterval(room.pizzaInterval);
  clearInterval(room.powerupInterval);
  clearInterval(room.timerInterval);
}

function endGame(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.gameState === 'ended') return;
  room.gameState = 'ended';
  clearAllIntervals(room);

  const players = Object.values(room.players);
  let winner = null;
  if (players[0].score > players[1].score) winner = players[0].id;
  else if (players[1].score > players[0].score) winner = players[1].id;

  io.to(roomCode).emit('gameEnd', {
    players: room.players,
    winner
  });

  setTimeout(() => { delete rooms[roomCode]; }, 30000);
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('createRoom', ({ playerName, character }) => {
    let code;
    do { code = generateRoomCode(); } while (rooms[code]);

    rooms[code] = {
      code,
      gameState: 'waiting',
      players: {},
      pizzas: [],
      powerups: [],
      obstacles: []
    };

    rooms[code].players[socket.id] = {
      id: socket.id,
      name: playerName || 'Oyuncu 1',
      character,
      score: 0,
      x: 150,
      y: 300,
      ready: false,
      isHost: true,
      effects: {}
    };

    socket.join(code);
    socket.roomCode = code;
    socket.emit('roomCreated', { code, player: rooms[code].players[socket.id] });
  });

  socket.on('joinRoom', ({ code, playerName, character }) => {
    const room = rooms[code];
    if (!room) { socket.emit('joinError', 'Oda bulunamadı!'); return; }
    if (room.gameState !== 'waiting') { socket.emit('joinError', 'Oyun zaten başladı!'); return; }
    if (Object.keys(room.players).length >= 2) { socket.emit('joinError', 'Oda dolu!'); return; }

    room.players[socket.id] = {
      id: socket.id,
      name: playerName || 'Oyuncu 2',
      character,
      score: 0,
      x: 650,
      y: 300,
      ready: false,
      isHost: false,
      effects: {}
    };

    socket.join(code);
    socket.roomCode = code;
    socket.emit('joinedRoom', { code, player: room.players[socket.id] });
    io.to(code).emit('playerJoined', { players: room.players });
  });

  socket.on('playerReady', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;
    room.players[socket.id].ready = true;
    io.to(code).emit('readyUpdate', { players: room.players });

    const players = Object.values(room.players);
    if (players.length === 2 && players.every(p => p.ready)) {
      setTimeout(() => startGameLoop(code), 1000);
    }
  });

  socket.on('playerMove', ({ x, y, vx, vy }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.gameState !== 'playing') return;
    const player = room.players[socket.id];
    if (!player) return;
    player.x = x; player.y = y;
    socket.to(code).emit('opponentMove', { id: socket.id, x, y, vx, vy });
  });

  socket.on('collectPizza', ({ pizzaId }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.gameState !== 'playing') return;
    const idx = room.pizzas.findIndex(p => p.id === pizzaId);
    if (idx === -1) return;
    const pizza = room.pizzas.splice(idx, 1)[0];
    const player = room.players[socket.id];
    if (!player) return;
    player.score += pizza.points;
    io.to(code).emit('pizzaCollected', { pizzaId, collectorId: socket.id, scores: getScores(room) });
  });

  socket.on('collectPowerup', ({ powerupId }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.gameState !== 'playing') return;
    const idx = room.powerups.findIndex(p => p.id === powerupId);
    if (idx === -1) return;
    const pu = room.powerups.splice(idx, 1)[0];
    io.to(code).emit('powerupCollected', { powerupId, collectorId: socket.id, type: pu.type });
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    delete rooms[code].players[socket.id];
    if (Object.keys(rooms[code].players).length === 0) {
      clearAllIntervals(rooms[code]);
      delete rooms[code];
    } else {
      io.to(code).emit('playerLeft');
      if (rooms[code].gameState === 'playing') endGame(code);
    }
  });
});

function getScores(room) {
  const scores = {};
  for (const [id, p] of Object.entries(room.players)) scores[id] = p.score;
  return scores;
}

app.get('/health', (_, res) => res.json({ ok: true, rooms: Object.keys(rooms).length }));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
