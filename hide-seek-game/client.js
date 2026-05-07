// Hide & Seek Zone — client

const socket = io();

// ===== Tile providers =====
const TILE_PROVIDERS = {
  street: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © Esri',
    maxZoom: 19,
  },
};

// ===== State =====
let currentGameId = null;
let isOwner = false;
let myRole = 'unassigned';

let setupMap = null;
let setupTileLayer = null;
let setupCircleLayer = null;
let setupCenter = null;

let previewMap = null;
let previewTileLayer = null;
let previewCircleLayer = null;

let gameMap = null;
let gameTileLayer = null;
let gameCircleLayer = null;
let startZoneLayer = null;
let powerupMarker = null;
let playerMarkers = {};
let myMarker = null;

let watchId = null;
let lastLocation = null;
let inGameView = false;
let bannerTimeout = null;
let countdownInterval = null;
let alertsInterval = null;

let lastState = null;
let currentMapType = 'street';

// ===== Menu =====
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

  if (isOwner) {
    document.getElementById('lobby-title').textContent = `Lobby: ${gameName}`;
    document.getElementById('lobby-share').textContent = `Share the game name and password with your friends so they can join.`;
    document.getElementById('owner-controls').classList.remove('hidden');
    setTimeout(initSetupMap, 50);
  } else {
    document.getElementById('lobby-title').textContent = `Waiting On Owner`;
    document.getElementById('lobby-share').textContent = `The owner is setting things up.`;
    document.getElementById('non-owner-view').classList.remove('hidden');
    setTimeout(initPreviewMap, 50);
  }
}

// ===== Setup map (owner) =====
function initSetupMap() {
  if (setupMap) return;

  setupMap = L.map('setup-map').setView([44.2619, -88.4154], 13);
  setupTileLayer = L.tileLayer(TILE_PROVIDERS.street.url, {
    attribution: TILE_PROVIDERS.street.attribution,
    maxZoom: TILE_PROVIDERS.street.maxZoom,
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

  document.getElementById('radius-slider').oninput = (e) => {
    document.getElementById('radius-value').textContent = e.target.value;
    if (setupCenter) { drawSetupCircle(); sendSettings(); }
  };

  document.getElementById('map-type').onchange = (e) => {
    swapTileLayer(setupMap, setupTileLayer, e.target.value);
    setupTileLayer = currentTileLayer; // updated by swap
    sendSettings();
  };

  ['shrink-interval', 'shrink-amount', 'asymmetric', 'ping-interval', 'powerup-interval'].forEach(id => {
    document.getElementById(id).onchange = () => sendSettings();
  });
}

let currentTileLayer = null;
function swapTileLayer(map, oldLayer, mapType) {
  if (oldLayer) map.removeLayer(oldLayer);
  const provider = TILE_PROVIDERS[mapType] || TILE_PROVIDERS.street;
  currentTileLayer = L.tileLayer(provider.url, {
    attribution: provider.attribution,
    maxZoom: provider.maxZoom,
  }).addTo(map);
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
  socket.emit('update-settings', {
    circle: setupCenter ? {
      lat: setupCenter.lat,
      lng: setupCenter.lng,
      radius: parseInt(document.getElementById('radius-slider').value),
    } : undefined,
    shrinkIntervalMs: parseInt(document.getElementById('shrink-interval').value) * 60 * 1000,
    shrinkAmount: parseInt(document.getElementById('shrink-amount').value),
    asymmetric: document.getElementById('asymmetric').checked,
    mapType: document.getElementById('map-type').value,
    pingIntervalMs: parseInt(document.getElementById('ping-interval').value) * 60 * 1000,
    powerupIntervalMs: parseInt(document.getElementById('powerup-interval').value) * 60 * 1000,
  });
}

document.getElementById('start-game-btn').onclick = () => {
  socket.emit('start-game', (res) => {
    if (res && res.error) document.getElementById('start-error').textContent = res.error;
  });
};

document.getElementById('end-game-btn').onclick = () => {
  if (confirm('End the game for everyone?')) socket.emit('end-game');
};

// ===== Preview map (non-owner) =====
function initPreviewMap() {
  if (previewMap) return;
  previewMap = L.map('preview-map', { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false })
    .setView([44.2619, -88.4154], 13);
  previewTileLayer = L.tileLayer(TILE_PROVIDERS.street.url, {
    attribution: TILE_PROVIDERS.street.attribution,
    maxZoom: TILE_PROVIDERS.street.maxZoom,
  }).addTo(previewMap);
}

function updatePreview(state) {
  if (!previewMap) return;

  // Map type
  const newType = state.settings.mapType || 'street';
  if (newType !== currentMapType) {
    currentMapType = newType;
    if (previewTileLayer) previewMap.removeLayer(previewTileLayer);
    const provider = TILE_PROVIDERS[newType] || TILE_PROVIDERS.street;
    previewTileLayer = L.tileLayer(provider.url, {
      attribution: provider.attribution,
      maxZoom: provider.maxZoom,
    }).addTo(previewMap);
  }

  // Circle
  const empty = document.getElementById('preview-empty');
  if (state.circle) {
    if (empty) empty.style.display = 'none';
    previewMap.setView([state.circle.lat, state.circle.lng], 15);
    if (previewCircleLayer) previewMap.removeLayer(previewCircleLayer);
    previewCircleLayer = L.circle([state.circle.lat, state.circle.lng], {
      radius: state.circle.radius,
      color: '#4ecca3',
      fillColor: '#4ecca3',
      fillOpacity: 0.2,
    }).addTo(previewMap);
  } else {
    if (empty) empty.style.display = '';
  }

  // Settings preview
  const settingsEl = document.getElementById('preview-settings');
  if (!settingsEl) return;
  const s = state.settings;
  const items = [
    { label: 'Radius', value: state.circle ? `${state.circle.radius} m` : '—' },
    { label: 'Shrink every', value: `${Math.round(s.shrinkIntervalMs / 60000)} min` },
    { label: 'Shrink by', value: `${s.shrinkAmount} m` },
    { label: 'Asymmetric', value: s.asymmetric ? 'On' : 'Off' },
    { label: 'Ping every', value: s.pingIntervalMs ? `${Math.round(s.pingIntervalMs / 60000)} min` : 'Off' },
    { label: 'Power-ups', value: s.powerupIntervalMs ? `Every ${Math.round(s.powerupIntervalMs / 60000)} min` : 'Off' },
  ];
  settingsEl.innerHTML = items.map(i =>
    `<div class="setting-item"><div class="setting-label">${i.label}</div><div class="setting-value">${escapeHtml(i.value)}</div></div>`
  ).join('');
}

// ===== Visibility banner =====
function showVisibilityBanner(role) {
  const banner = document.getElementById('visibility-banner');
  const text = document.getElementById('visibility-banner-text');
  banner.classList.remove('hider-banner', 'seeker-banner');

  if (role === 'hider') {
    text.textContent = '⚠️ Stay inside the circle — leaving makes you visible to seekers';
    banner.classList.add('hider-banner');
  } else if (role === 'seeker') {
    text.textContent = '👀 Hiders only show on your map when they leave the circle';
    banner.classList.add('seeker-banner');
  } else {
    return;
  }
  banner.classList.remove('hidden');

  if (bannerTimeout) clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => banner.classList.add('hidden'), 5000);
}

document.getElementById('visibility-banner-close').onclick = () => {
  document.getElementById('visibility-banner').classList.add('hidden');
  if (bannerTimeout) { clearTimeout(bannerTimeout); bannerTimeout = null; }
};

// ===== Game state =====
socket.on('game-state', (state) => {
  lastState = state;

  if (state.status === 'lobby') {
    renderPlayerList(state);
    if (!isOwner) updatePreview(state);
  } else if (state.status === 'playing') {
    if (!inGameView) enterGame(state);
    else updateGame(state);
  }
});

socket.on('game-ended', () => {
  alert('Game ended.');
  location.reload();
});

socket.on('disconnect', () => alert('Lost connection to server. Reload the page.'));

// ===== Player list =====
function renderPlayerList(state) {
  const list = document.getElementById('players-list');
  list.innerHTML = '';

  state.players.forEach(p => {
    if (p.id === socket.id) myRole = p.role;

    const li = document.createElement('li');
    if (p.role === 'hider') li.classList.add('is-hider');
    if (p.role === 'seeker') li.classList.add('is-seeker');

    const info = document.createElement('div');
    info.className = 'player-info';
    info.innerHTML = `
      <span class="player-name">${escapeHtml(p.name)}</span>
      ${p.isOwner ? '<span class="owner-crown" title="Owner">👑</span>' : ''}
    `;

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.gap = '8px';
    right.style.alignItems = 'center';

    const pill = document.createElement('span');
    const cls = p.role === 'hider' ? 'hider' : p.role === 'seeker' ? 'seeker' : 'unassigned';
    pill.className = `player-role-pill ${cls}`;
    pill.textContent = p.role;
    right.appendChild(pill);

    if (isOwner) {
      const btns = document.createElement('div');
      btns.className = 'role-buttons';
      btns.innerHTML = `
        <button class="set-hider" data-role="hider">H</button>
        <button class="set-seeker" data-role="seeker">S</button>
      `;
      btns.querySelectorAll('button').forEach(b => {
        b.onclick = () => socket.emit('assign-role', { playerId: p.id, role: b.dataset.role });
      });
      right.appendChild(btns);
    }

    li.appendChild(info);
    li.appendChild(right);
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
  const header = document.getElementById('game-header');
  const badge = document.getElementById('role-badge');
  badge.textContent = `YOU ARE ${myRole.toUpperCase()}`;
  header.className = '';
  header.classList.add(myRole);

  showVisibilityBanner(myRole);

  setTimeout(() => {
    initGameMap(state);
    startTracking();
    updateGame(state);
    if (!countdownInterval) countdownInterval = setInterval(updateCountdown, 1000);
    if (!alertsInterval) alertsInterval = setInterval(updateAlerts, 500);
  }, 50);
}

function initGameMap(state) {
  if (gameMap) return;
  gameMap = L.map('game-map').setView([state.circle.lat, state.circle.lng], 16);
  const type = state.settings.mapType || 'street';
  currentMapType = type;
  const provider = TILE_PROVIDERS[type];
  gameTileLayer = L.tileLayer(provider.url, {
    attribution: provider.attribution,
    maxZoom: provider.maxZoom,
  }).addTo(gameMap);
}

function updateGame(state) {
  if (!gameMap || !state.circle) return;

  // Map type changes (in case owner toggled in lobby; rare but possible)
  const type = state.settings.mapType || 'street';
  if (type !== currentMapType) {
    currentMapType = type;
    if (gameTileLayer) gameMap.removeLayer(gameTileLayer);
    const provider = TILE_PROVIDERS[type];
    gameTileLayer = L.tileLayer(provider.url, {
      attribution: provider.attribution,
      maxZoom: provider.maxZoom,
    }).addTo(gameMap);
  }

  // Play zone circle
  if (gameCircleLayer) gameMap.removeLayer(gameCircleLayer);
  gameCircleLayer = L.circle([state.circle.lat, state.circle.lng], {
    radius: state.circle.radius,
    color: '#4ecca3',
    fillColor: '#4ecca3',
    fillOpacity: 0.1,
    weight: 3,
  }).addTo(gameMap);

  // Seeker start zone (only if you're a seeker and zone is still active)
  if (startZoneLayer) { gameMap.removeLayer(startZoneLayer); startZoneLayer = null; }
  if (state.myStartZone && Date.now() < state.myStartZone.expiresAt) {
    startZoneLayer = L.circle([state.myStartZone.lat, state.myStartZone.lng], {
      radius: state.myStartZone.radius,
      color: '#ff4d6d',
      fillColor: '#ff4d6d',
      fillOpacity: 0.15,
      dashArray: '8, 8',
      weight: 2,
    }).addTo(gameMap);
  }

  // Power-up dot
  if (powerupMarker) { gameMap.removeLayer(powerupMarker); powerupMarker = null; }
  if (state.currentPowerup) {
    const icon = L.divIcon({
      className: 'powerup-marker',
      html: `<div class="powerup-pulse">⚡</div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
    powerupMarker = L.marker([state.currentPowerup.lat, state.currentPowerup.lng], { icon }).addTo(gameMap);
  }

  // Other players' markers
  const seenIds = new Set();
  state.players.forEach(p => {
    if (p.id === socket.id) return;
    seenIds.add(p.id);

    if (p.location) {
      const color = p.role === 'seeker' ? '#ff5577' : '#4ecdc4';
      const textColor = p.role === 'seeker' ? '#fff' : '#00263a';
      const icon = L.divIcon({
        className: 'player-marker',
        html: `<div style="background:${color};color:${textColor};padding:4px 10px;border-radius:6px;font-weight:700;white-space:nowrap;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.5);font-size:12px;">${escapeHtml(p.name)}</div>`,
        iconSize: [80, 26],
        iconAnchor: [40, 13],
      });
      if (playerMarkers[p.id]) {
        playerMarkers[p.id].setLatLng([p.location.lat, p.location.lng]);
        playerMarkers[p.id].setIcon(icon);
      } else {
        playerMarkers[p.id] = L.marker([p.location.lat, p.location.lng], { icon }).addTo(gameMap);
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

  // Status badge
  if (lastLocation) {
    const d = distanceMeters(lastLocation.lat, lastLocation.lng, state.circle.lat, state.circle.lng);
    const inside = d <= state.circle.radius;
    const status = document.getElementById('status-badge');
    status.textContent = inside ? 'Inside Zone' : 'OUTSIDE ZONE';
    status.className = inside ? 'inside-zone' : 'outside-zone';
  }

  // Auto-collect powerup if I'm close enough
  tryCollectPowerup(state);

  updateAlerts();
}

function tryCollectPowerup(state) {
  if (!state || !state.currentPowerup || !lastLocation) return;
  const pu = state.currentPowerup;
  const d = distanceMeters(lastLocation.lat, lastLocation.lng, pu.lat, pu.lng);
  if (d <= 15.24) socket.emit('collect-powerup');
}

// ===== Alerts strip (ping / reveal / start zone) =====
function updateAlerts() {
  const strip = document.getElementById('alerts-strip');
  if (!strip || !lastState) return;
  strip.innerHTML = '';
  const now = Date.now();

  // Ping (everyone visible)
  if (lastState.pingActiveUntil && now < lastState.pingActiveUntil) {
    const left = Math.ceil((lastState.pingActiveUntil - now) / 1000);
    const a = document.createElement('div');
    a.className = 'alert ping';
    a.innerHTML = `📡 PING ACTIVE — Everyone is visible (${left}s)`;
    strip.appendChild(a);
  }

  // Power-up reveal (other team visible to my team)
  if (lastState.myTeamRevealMsLeft > 0) {
    const left = Math.ceil(lastState.myTeamRevealMsLeft / 1000);
    const otherTeam = myRole === 'hider' ? 'seekers' : 'hiders';
    const a = document.createElement('div');
    a.className = 'alert reveal';
    a.innerHTML = `⚡ POWER-UP — You can see the ${otherTeam} (${left}s)`;
    strip.appendChild(a);
    // Decrement locally so the timer feels live between server messages
    lastState.myTeamRevealMsLeft = Math.max(0, lastState.myTeamRevealMsLeft - 500);
  }

  // Seeker start zone countdown
  if (lastState.myStartZone) {
    const remaining = lastState.myStartZone.expiresAt - now;
    if (remaining > 0) {
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      const a = document.createElement('div');
      a.className = 'alert start-zone';
      a.innerHTML = `🚫 STAY IN START ZONE — ${m}:${String(s).padStart(2, '0')} left`;
      strip.appendChild(a);
    }
  }
}

// ===== Countdown =====
function updateCountdown() {
  const elTime = document.getElementById('countdown-time');
  if (!elTime || !lastState) return;
  if (!lastState.nextShrinkAt) {
    elTime.textContent = '—';
    return;
  }
  const remaining = Math.max(0, lastState.nextShrinkAt - Date.now());
  const totalSec = Math.floor(remaining / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  elTime.textContent = `${m}:${String(s).padStart(2, '0')}`;
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
            html: `<div style="background:#ffd166;color:#1a1a2e;padding:4px 10px;border-radius:6px;font-weight:700;white-space:nowrap;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.5);font-size:12px;">YOU</div>`,
            iconSize: [50, 26],
            iconAnchor: [25, 13],
          });
          myMarker = L.marker([lastLocation.lat, lastLocation.lng], { icon }).addTo(gameMap);
        }
      }

      // Try collecting after each location update
      if (lastState) tryCollectPowerup(lastState);
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
