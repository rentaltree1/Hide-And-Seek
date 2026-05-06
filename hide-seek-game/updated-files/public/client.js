// Hide & Seek Zone — client
// Handles UI, map, geolocation, and Socket.IO communication.

const socket = io();

let currentGameId = null;
let isOwner = false;
let myRole = 'unassigned';

let setupMap = null;
let setupCircleLayer = null;
let setupCenter = null;

let gameMap = null;
let gameCircleLayer = null;
let playerMarkers = {}; // id -> Leaflet marker
let myMarker = null;

let watchId = null;
let lastLocation = null;
let inGameView = false;
let bannerTimeout = null;

// ===== Menu navigation =====
const menuButtons = document.getElementById('menu-buttons');
const createForm = document.getElementById('create-form');
const joinForm = document.getElementById('join-form');
const errorMsg = document.getElementById('error-msg');

document.getElementById('show-create').onclick = () => {
  menuButtons.classList.add('hidden');
  createForm.classList.remove('hidden');
  errorMsg.textContent = '';
};
document.getElementById('show-join').onclick = () => {
  menuButtons.classList.add('hidden');
  joinForm.classList.remove('hidden');
  errorMsg.textContent = '';
};
document.querySelectorAll('.back').forEach(btn => {
  btn.onclick = () => {
    createForm.classList.add('hidden');
    joinForm.classList.add('hidden');
    menuButtons.classList.remove('hidden');
    errorMsg.textContent = '';
  };
});

createForm.onsubmit = (e) => {
  e.preventDefault();
  const gameName = document.getElementById('create-game-name').value.trim();
  const password = document.getElementById('create-password').value;
  const playerName = document.getElementById('create-player-name').value.trim();
  socket.emit('create-game', { gameName, password, playerName }, (res) => {
    if (res.error) { errorMsg.textContent = res.error; return; }
    currentGameId = res.gameId;
    isOwner = true;
    enterLobby(gameName);
  });
};

joinForm.onsubmit = (e) => {
  e.preventDefault();
  const gameName = document.getElementById('join-game-name').value.trim();
  const password = document.getElementById('join-password').value;
  const playerName = document.getElementById('join-player-name').value.trim();
  socket.emit('join-game', { gameName, password, playerName }, (res) => {
    if (res.error) { errorMsg.textContent = res.error; return; }
    currentGameId = res.gameId;
    isOwner = false;
    enterLobby(gameName);
  });
};

// ===== Lobby =====
function enterLobby(gameName) {
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('lobby').classList.remove('hidden');
  document.getElementById('lobby-title').textContent = `Lobby: ${gameName}`;
  document.getElementById('lobby-share').textContent = isOwner
    ? `Share the game name and password with your friends so they can join.`
    : `Waiting for players. The owner will start the game.`;

  if (isOwner) {
    document.getElementById('owner-controls').classList.remove('hidden');
    setTimeout(initSetupMap, 50);
  } else {
    document.getElementById('non-owner-message').classList.remove('hidden');
  }
}

function initSetupMap() {
  if (setupMap) return;

  setupMap = L.map('setup-map').setView([44.2619, -88.4154], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(setupMap);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => setupMap.setView([pos.coords.latitude, pos.coords.longitude], 16),
      () => {},
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }

  setupMap.on('click', (e) => {
    setupCenter = e.latlng;
    drawSetupCircle();
    sendSettings();
  });

  const radiusSlider = document.getElementById('radius-slider');
  const radiusValue = document.getElementById('radius-value');
  radiusSlider.oninput = () => {
    radiusValue.textContent = radiusSlider.value;
    if (setupCenter) { drawSetupCircle(); sendSettings(); }
  };

  ['shrink-interval', 'shrink-amount', 'asymmetric'].forEach(id => {
    document.getElementById(id).onchange = () => { if (setupCenter) sendSettings(); };
  });
}

function drawSetupCircle() {
  if (!setupCenter) return;
  const radius = parseInt(document.getElementById('radius-slider').value);
  if (setupCircleLayer) setupMap.removeLayer(setupCircleLayer);
  setupCircleLayer = L.circle(setupCenter, {
    radius,
    color: '#4ecca3',
    fillColor: '#4ecca3',
    fillOpacity: 0.2,
  }).addTo(setupMap);
}

function sendSettings() {
  if (!setupCenter) return;
  socket.emit('update-settings', {
    circle: {
      lat: setupCenter.lat,
      lng: setupCenter.lng,
      radius: parseInt(document.getElementById('radius-slider').value),
    },
    shrinkIntervalMs: parseInt(document.getElementById('shrink-interval').value) * 60 * 1000,
    shrinkAmount: parseInt(document.getElementById('shrink-amount').value),
    asymmetric: document.getElementById('asymmetric').checked,
  });
}

document.getElementById('start-game-btn').onclick = () => {
  socket.emit('start-game', (res) => {
    if (res && res.error) {
      document.getElementById('start-error').textContent = res.error;
    }
  });
};

document.getElementById('end-game-btn').onclick = () => {
  if (confirm('End the game for everyone?')) socket.emit('end-game');
};

// ===== Visibility banner =====
function showVisibilityBanner(role) {
  const banner = document.getElementById('visibility-banner');
  const text = document.getElementById('visibility-banner-text');

  banner.classList.remove('hider-banner', 'seeker-banner');

  if (role === 'hider') {
    text.textContent = '⚠️ The seeker can see you';
    banner.classList.add('hider-banner');
  } else if (role === 'seeker') {
    text.textContent = '👀 You can see the hiders';
    banner.classList.add('seeker-banner');
  } else {
    return; // unassigned: skip
  }

  banner.classList.remove('hidden');

  if (bannerTimeout) clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => {
    banner.classList.add('hidden');
  }, 5000);
}

document.getElementById('visibility-banner-close').onclick = () => {
  document.getElementById('visibility-banner').classList.add('hidden');
  if (bannerTimeout) { clearTimeout(bannerTimeout); bannerTimeout = null; }
};

// ===== Game state handling =====
socket.on('game-state', (state) => {
  if (state.status === 'lobby') {
    renderPlayerList(state);
  } else if (state.status === 'playing') {
    if (!inGameView) enterGame(state);
    else updateGame(state);
  }
});

socket.on('game-ended', () => {
  alert('Game ended.');
  location.reload();
});

socket.on('disconnect', () => {
  alert('Lost connection to server. Reload the page.');
});

function renderPlayerList(state) {
  const list = document.getElementById('players-list');
  list.innerHTML = '';

  state.players.forEach(p => {
    if (p.id === socket.id) myRole = p.role;

    const li = document.createElement('li');
    const left = document.createElement('span');
    const roleClass = p.role === 'hider' ? 'role-hider'
                    : p.role === 'seeker' ? 'role-seeker' : 'role-unassigned';
    left.innerHTML = `<strong>${escapeHtml(p.name)}</strong>` +
      (p.isOwner ? `<span class="owner-tag">[Owner]</span>` : '') +
      ` — <span class="${roleClass}">${p.role}</span>`;
    li.appendChild(left);

    if (isOwner) {
      const buttons = document.createElement('div');
      buttons.className = 'role-buttons';
      buttons.innerHTML = `
        <button data-role="hider">Hider</button>
        <button data-role="seeker">Seeker</button>
      `;
      buttons.querySelectorAll('button').forEach(b => {
        b.onclick = () => socket.emit('assign-role', { playerId: p.id, role: b.dataset.role });
      });
      li.appendChild(buttons);
    }
    list.appendChild(li);
  });
}

// ===== Game view =====
function enterGame(state) {
  inGameView = true;
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');

  if (isOwner) document.getElementById('end-game-btn').classList.remove('hidden');

  const me = state.players.find(p => p.id === socket.id);
  myRole = me ? me.role : 'unassigned';
  const badge = document.getElementById('role-badge');
  badge.textContent = `You are ${myRole.toUpperCase()}`;
  badge.className = myRole;

  showVisibilityBanner(myRole);

  setTimeout(() => {
    initGameMap(state);
    startTracking();
    updateGame(state);
  }, 50);
}

function initGameMap(state) {
  if (gameMap) return;
  gameMap = L.map('game-map').setView([state.circle.lat, state.circle.lng], 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(gameMap);
}

function updateGame(state) {
  if (!gameMap || !state.circle) return;

  if (gameCircleLayer) gameMap.removeLayer(gameCircleLayer);
  gameCircleLayer = L.circle([state.circle.lat, state.circle.lng], {
    radius: state.circle.radius,
    color: '#4ecca3',
    fillColor: '#4ecca3',
    fillOpacity: 0.1,
    weight: 3,
  }).addTo(gameMap);

  const seenIds = new Set();
  state.players.forEach(p => {
    if (p.id === socket.id) return;
    seenIds.add(p.id);

    if (p.location) {
      const color = p.role === 'seeker' ? '#ff6b6b' : '#4ecdc4';
      const icon = L.divIcon({
        className: 'player-marker',
        html: `<div style="background:${color};color:#1a1a2e;padding:4px 10px;border-radius:6px;font-weight:700;white-space:nowrap;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);font-size:12px;">${escapeHtml(p.name)}</div>`,
        iconSize: [80, 26],
        iconAnchor: [40, 13],
      });
      if (playerMarkers[p.id]) {
        playerMarkers[p.id].setLatLng([p.location.lat, p.location.lng]);
        playerMarkers[p.id].setIcon(icon);
      } else {
        playerMarkers[p.id] = L.marker(
          [p.location.lat, p.location.lng],
          { icon }
        ).addTo(gameMap);
      }
    } else if (playerMarkers[p.id]) {
      gameMap.removeLayer(playerMarkers[p.id]);
      delete playerMarkers[p.id];
    }
  });

  Object.keys(playerMarkers).forEach(id => {
    if (!seenIds.has(id)) {
      gameMap.removeLayer(playerMarkers[id]);
      delete playerMarkers[id];
    }
  });

  if (lastLocation) {
    const d = distanceMeters(
      lastLocation.lat, lastLocation.lng,
      state.circle.lat, state.circle.lng
    );
    const inside = d <= state.circle.radius;
    const status = document.getElementById('status-badge');
    status.textContent = inside ? 'Inside Zone' : 'OUTSIDE ZONE';
    status.className = inside ? 'inside-zone' : 'outside-zone';
  }
}

// ===== Geolocation =====
function startTracking() {
  if (watchId !== null) return;
  if (!navigator.geolocation) {
    alert('Geolocation not supported on this device.');
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      socket.emit('location-update', lastLocation);

      if (gameMap) {
        if (myMarker) {
          myMarker.setLatLng([lastLocation.lat, lastLocation.lng]);
        } else {
          const icon = L.divIcon({
            className: 'my-marker',
            html: `<div style="background:#ffd700;color:#1a1a2e;padding:4px 10px;border-radius:6px;font-weight:700;white-space:nowrap;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);font-size:12px;">YOU</div>`,
            iconSize: [50, 26],
            iconAnchor: [25, 13],
          });
          myMarker = L.marker(
            [lastLocation.lat, lastLocation.lng],
            { icon }
          ).addTo(gameMap);
        }
      }
    },
    (err) => console.error('Geolocation error:', err),
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
  );
}

// ===== Helpers =====
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}
