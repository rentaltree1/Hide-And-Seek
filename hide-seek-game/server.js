// Hide & Seek Zone — server

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const games = {};

// ===== Constants =====
const SEEKER_START_ZONE_RADIUS_M = 30.48;       // 100 feet
const SEEKER_START_ZONE_DURATION_MS = 2 * 60 * 1000; // 2 minutes
const POWERUP_PICKUP_RADIUS_M = 15.24;           // 50 feet
const POWERUP_REVEAL_DURATION_MS = 15 * 1000;    // 15 seconds
const POWERUP_DESPAWN_MS = 5 * 60 * 1000;        // 5 minutes
const PING_DURATION_MS = 5 * 1000;               // 5 seconds

function gameIdFromName(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function isInsideCircle(loc, circle) {
  if (!loc || !circle) return false;
  return distanceMeters(loc.lat, loc.lng, circle.lat, circle.lng) <= circle.radius;
}

// ===== Visibility rules =====
// Returns true if `viewer` is allowed to see `target`'s exact location.
function canSee(viewer, target, game) {
  if (viewer === target) return true;
  if (game.status !== 'playing') return false;
  if (!viewer.role || !target.role) return false;

  const now = Date.now();

  // Global ping: everyone sees everyone
  if (game.pingActiveUntil && now < game.pingActiveUntil) return true;

  // Same team: always see teammates
  if (viewer.role === target.role) return true;

  // Power-up active for the viewer's team: see the other team
  const teamReveal = game.teamRevealUntil[viewer.role];
  if (teamReveal && now < teamReveal) return true;

  // Cross-team default: seekers see hiders only when hiders are OUTSIDE the circle.
  // Hiders never see seekers by default.
  if (viewer.role === 'seeker' && target.role === 'hider') {
    return !isInsideCircle(target.location, game.circle);
  }

  return false;
}

function buildPlayersFor(game, viewerSocketId) {
  const viewer = game.players[viewerSocketId];
  if (!viewer) return null;

  return Object.entries(game.players).map(([id, p]) => {
    const visible = canSee(viewer, p, game);
    const inside = isInsideCircle(p.location, game.circle);

    return {
      id,
      name: p.name,
      role: p.role,
      isOwner: id === game.ownerId,
      location: visible && p.location ? p.location : null,
      inside,
    };
  });
}

function broadcastGameState(gameId) {
  const game = games[gameId];
  if (!game) return;

  const now = Date.now();

  Object.keys(game.players).forEach(socketId => {
    const players = buildPlayersFor(game, socketId);
    if (!players) return;

    const viewer = game.players[socketId];
    // Only send the viewer their own start zone (others don't need it)
    const myStartZone = (viewer && viewer.role === 'seeker' && game.seekerStartZones[socketId])
      ? game.seekerStartZones[socketId]
      : null;

    // Tell client which team-reveal is active for them, in millis remaining
    const myTeamRevealMsLeft = (viewer && viewer.role && game.teamRevealUntil[viewer.role])
      ? Math.max(0, game.teamRevealUntil[viewer.role] - now)
      : 0;

    io.to(socketId).emit('game-state', {
      name: game.name,
      status: game.status,
      circle: game.circle,
      settings: game.settings,
      players,
      ownerId: game.ownerId,
      nextShrinkAt: game.nextShrinkAt || null,
      pingActiveUntil: game.pingActiveUntil || null,
      myStartZone,
      myTeamRevealMsLeft,
      currentPowerup: game.currentPowerup || null,
    });
  });
}

// ===== Shrinking =====
function shrinkCircle(gameId) {
  const game = games[gameId];
  if (!game || game.status !== 'playing') return;

  const old = game.circle;
  const newRadius = Math.max(20, old.radius - game.settings.shrinkAmount);

  let newLat = old.lat;
  let newLng = old.lng;

  if (game.settings.asymmetric && newRadius < old.radius) {
    const maxShift = old.radius - newRadius;
    const angle = Math.random() * 2 * Math.PI;
    const shift = Math.random() * maxShift;
    const latShift = (shift * Math.cos(angle)) / 111000;
    const lngShift = (shift * Math.sin(angle)) /
      (111000 * Math.cos((old.lat * Math.PI) / 180));
    newLat += latShift;
    newLng += lngShift;
  }

  game.circle = { lat: newLat, lng: newLng, radius: newRadius };

  if (newRadius > 20) {
    game.nextShrinkAt = Date.now() + game.settings.shrinkIntervalMs;
    game.shrinkTimer = setTimeout(() => shrinkCircle(gameId), game.settings.shrinkIntervalMs);
  } else {
    game.nextShrinkAt = null;
  }

  broadcastGameState(gameId);
}

// ===== Pings =====
function schedulePing(gameId) {
  const game = games[gameId];
  if (!game || game.status !== 'playing') return;
  const ms = game.settings.pingIntervalMs;
  if (!ms || ms <= 0) return;
  game.pingTimer = setTimeout(() => triggerPing(gameId), ms);
}

function triggerPing(gameId) {
  const game = games[gameId];
  if (!game || game.status !== 'playing') return;

  game.pingActiveUntil = Date.now() + PING_DURATION_MS;
  broadcastGameState(gameId);

  setTimeout(() => {
    const g = games[gameId];
    if (!g) return;
    g.pingActiveUntil = null;
    broadcastGameState(gameId);
    schedulePing(gameId);
  }, PING_DURATION_MS);
}

// ===== Power-ups =====
function spawnPowerup(gameId) {
  const game = games[gameId];
  if (!game || game.status !== 'playing') return;
  if (!game.circle) return;
  if (game.currentPowerup) return; // already one out there

  // Random point uniformly within the current circle
  const angle = Math.random() * 2 * Math.PI;
  const r = Math.sqrt(Math.random()) * game.circle.radius;
  const latShift = (r * Math.cos(angle)) / 111000;
  const lngShift = (r * Math.sin(angle)) /
    (111000 * Math.cos((game.circle.lat * Math.PI) / 180));

  const powerup = {
    id: `pu_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    lat: game.circle.lat + latShift,
    lng: game.circle.lng + lngShift,
    spawnedAt: Date.now(),
    expiresAt: Date.now() + POWERUP_DESPAWN_MS,
  };
  game.currentPowerup = powerup;

  // Auto-despawn
  game.powerupExpireTimer = setTimeout(() => {
    const g = games[gameId];
    if (!g) return;
    if (g.currentPowerup && g.currentPowerup.id === powerup.id) {
      g.currentPowerup = null;
      broadcastGameState(gameId);
      schedulePowerupSpawn(gameId);
    }
  }, POWERUP_DESPAWN_MS);

  broadcastGameState(gameId);
}

function schedulePowerupSpawn(gameId) {
  const game = games[gameId];
  if (!game || game.status !== 'playing') return;
  const ms = game.settings.powerupIntervalMs;
  if (!ms || ms <= 0) return;
  game.powerupSpawnTimer = setTimeout(() => spawnPowerup(gameId), ms);
}

function clearGameTimers(game) {
  if (!game) return;
  if (game.shrinkTimer) clearTimeout(game.shrinkTimer);
  if (game.pingTimer) clearTimeout(game.pingTimer);
  if (game.powerupSpawnTimer) clearTimeout(game.powerupSpawnTimer);
  if (game.powerupExpireTimer) clearTimeout(game.powerupExpireTimer);
}

// ===== Connection handling =====
io.on('connection', (socket) => {
  let currentGameId = null;

  socket.on('create-game', ({ gameName, password, playerName }, cb) => {
    if (!gameName || !password || !playerName) return cb({ error: 'Missing required fields' });
    const gameId = gameIdFromName(gameName);
    if (!gameId) return cb({ error: 'Invalid game name' });
    if (games[gameId]) return cb({ error: 'A game with that name already exists' });

    games[gameId] = {
      name: gameName,
      password,
      ownerId: socket.id,
      players: { [socket.id]: { name: playerName, role: 'unassigned', location: null } },
      status: 'lobby',
      circle: null,
      nextShrinkAt: null,
      pingActiveUntil: null,
      seekerStartZones: {},
      teamRevealUntil: { hider: 0, seeker: 0 },
      currentPowerup: null,
      settings: {
        shrinkIntervalMs: 5 * 60 * 1000,
        shrinkAmount: 100,
        asymmetric: false,
        mapType: 'street',
        pingIntervalMs: 0,
        powerupIntervalMs: 0,
      },
    };
    socket.join(gameId);
    currentGameId = gameId;
    cb({ gameId, isOwner: true });
    broadcastGameState(gameId);
  });

  socket.on('join-game', ({ gameName, password, playerName }, cb) => {
    if (!gameName || !password || !playerName) return cb({ error: 'Missing required fields' });
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
    if (settings.mapType === 'street' || settings.mapType === 'satellite') {
      game.settings.mapType = settings.mapType;
    }
    if (typeof settings.pingIntervalMs === 'number' && settings.pingIntervalMs >= 0) {
      game.settings.pingIntervalMs = settings.pingIntervalMs;
    }
    if (typeof settings.powerupIntervalMs === 'number' && settings.powerupIntervalMs >= 0) {
      game.settings.powerupIntervalMs = settings.powerupIntervalMs;
    }
    broadcastGameState(currentGameId);
  });

  socket.on('start-game', (cb) => {
    const game = games[currentGameId];
    if (!game || game.ownerId !== socket.id) return cb && cb({ error: 'Only the owner can start the game' });
    if (!game.circle) return cb && cb({ error: 'Set a play zone on the map first' });
    const roles = Object.values(game.players).map((p) => p.role);
    if (!roles.includes('hider')) return cb && cb({ error: 'Need at least 1 hider' });
    if (!roles.includes('seeker')) return cb && cb({ error: 'Need at least 1 seeker' });

    game.status = 'playing';
    game.nextShrinkAt = Date.now() + game.settings.shrinkIntervalMs;
    game.shrinkTimer = setTimeout(() => shrinkCircle(currentGameId), game.settings.shrinkIntervalMs);

    // Initialize seeker start zones from the location they currently have (if any).
    // If a seeker hasn't shared a location yet, the zone will be set on their first
    // location-update after start.
    Object.entries(game.players).forEach(([id, p]) => {
      if (p.role === 'seeker' && p.location && !game.seekerStartZones[id]) {
        game.seekerStartZones[id] = {
          lat: p.location.lat,
          lng: p.location.lng,
          radius: SEEKER_START_ZONE_RADIUS_M,
          expiresAt: Date.now() + SEEKER_START_ZONE_DURATION_MS,
        };
      }
    });

    schedulePing(currentGameId);
    schedulePowerupSpawn(currentGameId);

    cb && cb({ ok: true });
    broadcastGameState(currentGameId);
  });

  socket.on('location-update', ({ lat, lng }) => {
    const game = games[currentGameId];
    if (!game) return;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    const player = game.players[socket.id];
    if (!player) return;
    player.location = { lat, lng };

    // Lazily set start zone for seekers who hadn't reported a location at game start
    if (game.status === 'playing' && player.role === 'seeker' && !game.seekerStartZones[socket.id]) {
      game.seekerStartZones[socket.id] = {
        lat, lng,
        radius: SEEKER_START_ZONE_RADIUS_M,
        expiresAt: Date.now() + SEEKER_START_ZONE_DURATION_MS,
      };
    }

    broadcastGameState(currentGameId);
  });

  socket.on('collect-powerup', () => {
    const game = games[currentGameId];
    if (!game || game.status !== 'playing') return;
    if (!game.currentPowerup) return;
    const player = game.players[socket.id];
    if (!player || !player.location) return;
    if (player.role !== 'hider' && player.role !== 'seeker') return;

    const d = distanceMeters(
      player.location.lat, player.location.lng,
      game.currentPowerup.lat, game.currentPowerup.lng
    );
    if (d > POWERUP_PICKUP_RADIUS_M) return;

    // Stack: extend the current reveal end for this team
    const now = Date.now();
    const currentEnd = game.teamRevealUntil[player.role] || 0;
    const base = Math.max(currentEnd, now);
    game.teamRevealUntil[player.role] = base + POWERUP_REVEAL_DURATION_MS;

    // Clean up the powerup
    if (game.powerupExpireTimer) clearTimeout(game.powerupExpireTimer);
    game.currentPowerup = null;

    // Schedule the next spawn
    schedulePowerupSpawn(currentGameId);

    broadcastGameState(currentGameId);

    // After the team reveal expires, broadcast again so visibility tightens
    setTimeout(() => {
      const g = games[currentGameId];
      if (!g) return;
      // Only act if this was the latest reveal expiry
      if (g.teamRevealUntil[player.role] && Date.now() >= g.teamRevealUntil[player.role]) {
        broadcastGameState(currentGameId);
      }
    }, POWERUP_REVEAL_DURATION_MS + 200);
  });

  socket.on('end-game', () => {
    const game = games[currentGameId];
    if (!game || game.ownerId !== socket.id) return;
    clearGameTimers(game);
    io.to(currentGameId).emit('game-ended');
    delete games[currentGameId];
  });

  socket.on('disconnect', () => {
    const game = games[currentGameId];
    if (!game) return;
    delete game.players[socket.id];
    delete game.seekerStartZones[socket.id];

    if (socket.id === game.ownerId || Object.keys(game.players).length === 0) {
      clearGameTimers(game);
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
