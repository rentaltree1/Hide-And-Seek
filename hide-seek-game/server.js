// Hide & Seek Zone — server
// Manages game rooms, real-time location, and the shrinking circle.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// In-memory game state. Cleared when server restarts.
const games = {}; // gameId -> game

function gameIdFromName(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
}

// Distance between two lat/lng points in meters (Haversine).
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function broadcastGameState(gameId) {
  const game = games[gameId];
  if (!game) return;

  const players = Object.entries(game.players).map(([id, p]) => {
    let inside = true;
    if (game.circle && p.location) {
      const d = distanceMeters(
        p.location.lat,
        p.location.lng,
        game.circle.lat,
        game.circle.lng
      );
      inside = d <= game.circle.radius;
    }
    return {
      id,
      name: p.name,
      role: p.role,
      isOwner: id === game.ownerId,
      // Reveal location ONLY when player is outside the zone.
      location: !inside && p.location ? p.location : null,
      inside,
    };
  });

  io.to(gameId).emit('game-state', {
    name: game.name,
    status: game.status,
    circle: game.circle,
    settings: game.settings,
    players,
    ownerId: game.ownerId,
  });
}

function shrinkCircle(gameId) {
  const game = games[gameId];
  if (!game || game.status !== 'playing') return;

  const old = game.circle;
  const newRadius = Math.max(20, old.radius - game.settings.shrinkAmount);

  let newLat = old.lat;
  let newLng = old.lng;

  if (game.settings.asymmetric && newRadius < old.radius) {
    // Shift the new center randomly while keeping the new circle inside the old one.
    const maxShift = old.radius - newRadius;
    const angle = Math.random() * 2 * Math.PI;
    const shift = Math.random() * maxShift;
    const latShift = (shift * Math.cos(angle)) / 111000;
    const lngShift =
      (shift * Math.sin(angle)) /
      (111000 * Math.cos((old.lat * Math.PI) / 180));
    newLat += latShift;
    newLng += lngShift;
  }

  game.circle = { lat: newLat, lng: newLng, radius: newRadius };
  broadcastGameState(gameId);

  if (newRadius > 20) {
    game.shrinkTimer = setTimeout(
      () => shrinkCircle(gameId),
      game.settings.shrinkIntervalMs
    );
  }
}

io.on('connection', (socket) => {
  let currentGameId = null;

  socket.on('create-game', ({ gameName, password, playerName }, cb) => {
    if (!gameName || !password || !playerName) {
      return cb({ error: 'Missing required fields' });
    }
    const gameId = gameIdFromName(gameName);
    if (!gameId) return cb({ error: 'Invalid game name' });
    if (games[gameId]) return cb({ error: 'A game with that name already exists' });

    games[gameId] = {
      name: gameName,
      password,
      ownerId: socket.id,
      players: {
        [socket.id]: { name: playerName, role: 'unassigned', location: null },
      },
      status: 'lobby',
      circle: null,
      settings: {
        shrinkIntervalMs: 5 * 60 * 1000, // 5 minutes
        shrinkAmount: 100, // meters per shrink
        asymmetric: false,
      },
    };
    socket.join(gameId);
    currentGameId = gameId;
    cb({ gameId, isOwner: true });
    broadcastGameState(gameId);
  });

  socket.on('join-game', ({ gameName, password, playerName }, cb) => {
    if (!gameName || !password || !playerName) {
      return cb({ error: 'Missing required fields' });
    }
    const gameId = gameIdFromName(gameName);
    const game = games[gameId];
    if (!game) return cb({ error: 'Game not found' });
    if (game.password !== password) return cb({ error: 'Wrong password' });
    if (game.status !== 'lobby') return cb({ error: 'Game already started' });

    game.players[socket.id] = { name: playerName, role: 'unassigned', location: null };
    socket.join(gameId);
    currentGameId = gameId;
    cb({ gameId, isOwner: false });
    broadcastGameState(gameId);
  });

  socket.on('assign-role', ({ playerId, role }) => {
    const game = games[currentGameId];
    if (!game || game.ownerId !== socket.id) return;
    if (!['hider', 'seeker', 'unassigned'].includes(role)) return;
    if (game.players[playerId]) {
      game.players[playerId].role = role;
      broadcastGameState(currentGameId);
    }
  });

  socket.on('update-settings', (settings) => {
    const game = games[currentGameId];
    if (!game || game.ownerId !== socket.id) return;
    if (settings.circle) game.circle = settings.circle;
    if (settings.shrinkIntervalMs > 0) game.settings.shrinkIntervalMs = settings.shrinkIntervalMs;
    if (typeof settings.shrinkAmount === 'number') game.settings.shrinkAmount = settings.shrinkAmount;
    if (typeof settings.asymmetric === 'boolean') game.settings.asymmetric = settings.asymmetric;
    broadcastGameState(currentGameId);
  });

  socket.on('start-game', (cb) => {
    const game = games[currentGameId];
    if (!game || game.ownerId !== socket.id) {
      return cb && cb({ error: 'Only the owner can start the game' });
    }
    if (!game.circle) return cb && cb({ error: 'Set a play zone on the map first' });
    const roles = Object.values(game.players).map((p) => p.role);
    if (!roles.includes('hider')) return cb && cb({ error: 'Need at least 1 hider' });
    if (!roles.includes('seeker')) return cb && cb({ error: 'Need at least 1 seeker' });

    game.status = 'playing';
    game.shrinkTimer = setTimeout(
      () => shrinkCircle(currentGameId),
      game.settings.shrinkIntervalMs
    );
    cb && cb({ ok: true });
    broadcastGameState(currentGameId);
  });

  socket.on('location-update', ({ lat, lng }) => {
    const game = games[currentGameId];
    if (!game) return;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    if (game.players[socket.id]) {
      game.players[socket.id].location = { lat, lng };
      broadcastGameState(currentGameId);
    }
  });

  socket.on('end-game', () => {
    const game = games[currentGameId];
    if (!game || game.ownerId !== socket.id) return;
    if (game.shrinkTimer) clearTimeout(game.shrinkTimer);
    io.to(currentGameId).emit('game-ended');
    delete games[currentGameId];
  });

  socket.on('disconnect', () => {
    const game = games[currentGameId];
    if (!game) return;
    delete game.players[socket.id];

    if (socket.id === game.ownerId || Object.keys(game.players).length === 0) {
      if (game.shrinkTimer) clearTimeout(game.shrinkTimer);
      io.to(currentGameId).emit('game-ended');
      delete games[currentGameId];
    } else {
      broadcastGameState(currentGameId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Hide & Seek Zone server running on port ${PORT}`);
});
