/**
 * Colony Wars — Main Application Entry Point
 *
 * Responsibilities:
 *  - Auth flow (login / register / logout)
 *  - Game initialization (grid render, menus)
 *  - Game loop (resource tick, auto-save)
 *  - UI event wiring (build mode, cell clicks, modals)
 *  - Attack / battle flow (canvas animation loop)
 *  - Firebase read/write orchestration
 *
 * Uses window.* assignments for functions called from HTML onclick=""
 * attributes because ES Modules are scoped by default.
 */

import {
  registerUser, loginUser, logoutUser, onAuthChange,
  createPlayerRecord, loadPlayerData, savePlayerData,
  getRandomOpponent, updateAfterBattle,
} from './firebase.js';

import {
  BUILDINGS, UNITS,
  GRID_SIZE, GRID_CELLS, CELL_PX,
  getBuildingSize, getOccupiedCells,
  createGameState,
  generateResources, getResourceCaps, getResourceRates,
  canAfford, placeBuilding, upgradeBuilding, demolishBuilding,
  trainUnit,
  initBattle, stepBattle, calculateLoot,
} from './game.js';


// ════════════════════════════════════════════════════════════════════════════
// Application State
// ════════════════════════════════════════════════════════════════════════════

let currentUser        = null;    // Firebase User object
let gameState          = null;    // In-memory game state

let selectedBuildingId = null;    // Active build-menu selection
let selectedCellIndex  = null;    // Selected grid cell
let movingCellIndex    = null;    // Anchor cell of building being moved

let gameLoopInterval   = null;    // setInterval handle for resource tick
let saveTimeout        = null;    // debounce handle for auto-save
let lastTickTime       = Date.now();

let opponentData       = null;    // { uid, data } of target opponent
let battleState        = null;    // initBattle() result
let deployedCounts     = {};      // units deployed in current attack

// Fog-of-war visibility radius (Chebyshev distance) from any occupied cell
const FOG_RANGE = 2;


// ════════════════════════════════════════════════════════════════════════════
// Stars Background (auth screen)
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// Low Poly Auth Background (floating triangles)
// ════════════════════════════════════════════════════════════════════════════

(function spawnPolyBg() {
  const container = document.getElementById('auth-bg');
  if (!container) return;

  const COLOURS = [
    '#a5d6a7','#81c784','#66bb6a','#43a047',
    '#c8e6c9','#ffd600','#ffb300','#fb8c00',
    '#fff59d','#ffffff',
  ];

  for (let i = 0; i < 22; i++) {
    const el  = document.createElement('div');
    el.className = 'lp-poly';
    const size = 60 + Math.random() * 160;
    const col  = COLOURS[Math.floor(Math.random() * COLOURS.length)];
    const rot  = (Math.random() * 360).toFixed(1);
    const clipTypes = [
      'polygon(50% 0%, 100% 100%, 0% 100%)',           // triangle up
      'polygon(50% 100%, 0% 0%, 100% 0%)',             // triangle down
      'polygon(0 50%, 50% 0%, 100% 50%, 50% 100%)',    // diamond
      'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)', // hex
    ];
    const clip = clipTypes[Math.floor(Math.random() * clipTypes.length)];
    el.style.cssText = `
      left:${(Math.random() * 110 - 5).toFixed(1)}%;
      top:${(Math.random() * 110 - 5).toFixed(1)}%;
      width:${size}px; height:${size}px;
      background:${col};
      clip-path:${clip};
      --rot:${rot}deg;
      --dur:${(6 + Math.random() * 10).toFixed(1)}s;
      animation-delay:${(Math.random() * 6).toFixed(2)}s;
    `;
    container.appendChild(el);
  }
})();


// ════════════════════════════════════════════════════════════════════════════
// Auth Event Handlers
// ════════════════════════════════════════════════════════════════════════════

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn      = document.getElementById('login-btn');
  const errEl    = document.getElementById('login-error');

  btn.disabled = true; btn.textContent = 'CONNECTING…'; errEl.textContent = '';
  try {
    await loginUser(email, password);
    // onAuthChange handles the rest
  } catch (ex) {
    errEl.textContent = formatAuthError(ex.code);
    btn.disabled = false; btn.textContent = 'ENTER BASE';
  }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const btn      = document.getElementById('register-btn');
  const errEl    = document.getElementById('register-error');

  btn.disabled = true; btn.textContent = 'ESTABLISHING…'; errEl.textContent = '';
  try {
    const cred         = await registerUser(email, password, name);
    const initialState = createGameState(name);
    await createPlayerRecord(cred.user.uid, name, initialState);
    // onAuthChange fires immediately after registerUser resolves
  } catch (ex) {
    errEl.textContent = formatAuthError(ex.code);
    btn.disabled = false; btn.textContent = 'ESTABLISH COLONY';
  }
});

/** Human-readable Firebase auth error messages */
function formatAuthError(code) {
  const MAP = {
    'auth/email-already-in-use': 'That commander email is already registered.',
    'auth/invalid-email':        'Invalid email format.',
    'auth/wrong-password':       'Incorrect access code.',
    'auth/user-not-found':       'Commander not found.',
    'auth/weak-password':        'Access code must be at least 6 characters.',
    'auth/too-many-requests':    'Too many attempts. Try again shortly.',
    'auth/invalid-credential':   'Invalid email or password.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return MAP[code] || `Error: ${code}`;
}

/** Switch between login / register tabs */
window.switchTab = function (tab) {
  document.getElementById('login-form').classList.toggle('active', tab === 'login');
  document.getElementById('register-form').classList.toggle('active', tab === 'register');
  document.getElementById('login-tab-btn').classList.toggle('active', tab === 'login');
  document.getElementById('register-tab-btn').classList.toggle('active', tab === 'register');
  document.getElementById('login-error').textContent    = '';
  document.getElementById('register-error').textContent = '';
};


// ════════════════════════════════════════════════════════════════════════════
// Auth State Management
// ════════════════════════════════════════════════════════════════════════════

onAuthChange(async (user) => {
  if (user) {
    currentUser = user;
    showLoadingOverlay(true);

    try {
      let data = await loadPlayerData(user.uid);

      // Guard: if Firestore record doesn't exist yet, create it
      if (!data) {
        const fresh = createGameState(user.displayName || 'Commander');
        await createPlayerRecord(user.uid, user.displayName || 'Commander', fresh);
        data = fresh;
      }

      gameState = {
        playerName: data.displayName || data.playerName || 'Commander',
        resources:  data.resources  || { minerals: 500, energy: 300, oxygen: 200 },
        baseLayout: data.baseLayout || {},
        units:      data.units      || { drone: 0, robot: 0, ranger: 0 },
        defenseLog: data.defenseLog || [],
      };

      initGame();
      showScreen('game');
    } catch (err) {
      console.error('Failed to load player data:', err);
      notify('Failed to connect to server. Retrying…', 'error');
      showScreen('auth');
    }
  } else {
    currentUser = null;
    gameState   = null;
    stopGameLoop();
    showScreen('auth');
  }

  showLoadingOverlay(false);
});


// ════════════════════════════════════════════════════════════════════════════
// Game Initialisation
// ════════════════════════════════════════════════════════════════════════════

function initGame() {
  renderCommanderInfo();
  buildBuildMenu();
  buildUnitMenu();
  renderArmyDisplay();
  renderDefenseLog();
  renderGrid();      // Full grid rebuild
  renderResourceBar();
  startGameLoop();
}

function startGameLoop() {
  stopGameLoop();
  lastTickTime      = Date.now();
  gameLoopInterval  = setInterval(gameTick, 1000);
}

function stopGameLoop() {
  if (gameLoopInterval) { clearInterval(gameLoopInterval); gameLoopInterval = null; }
}

function gameTick() {
  if (!gameState) return;
  const now     = Date.now();
  const delta   = (now - lastTickTime) / 1000;
  lastTickTime  = now;
  generateResources(gameState, delta);
  renderResourceBar();
}


// ════════════════════════════════════════════════════════════════════════════
// Grid Rendering
// ════════════════════════════════════════════════════════════════════════════

/**
 * Map every building alias (buildingId) to its PNG prefix in assets/.
 * The full path is: assets/{prefix}_lvl{level}.png
 */
const ASSET_PREFIX = {
  cc:       'cc',
  mine:     'mineral_extractor',
  solar:    'solar_arra',
  oxy:      'oxygen_farm',
  depot:    'storage_depot',
  turret:   'defense_turret',
  barracks: 'barrack',
};

/** Return the PNG src for a building at a given level. */
function buildingImgSrc(buildingId, level) {
  const prefix = ASSET_PREFIX[buildingId] || buildingId;
  return `assets/${prefix}_lvl${level}.png`;
}

/** Build a helper map: cellIndex -> anchorIndex (for ghost/occupied cells) */
function buildOccupiedMap() {
  const map = {}; // cellIdx -> anchorIdx
  for (const [ancStr, cell] of Object.entries(gameState.baseLayout)) {
    const anc   = parseInt(ancStr, 10);
    const cells = getOccupiedCells(anc, cell.buildingId);
    if (!cells) continue;
    for (const c of cells) map[c] = anc;
  }
  return map;
}

function renderGrid() {
  const grid = document.getElementById('game-grid');
  grid.innerHTML = '';

  // Build occupied map (all cells including ghost footprint)
  const occupiedMap = buildOccupiedMap();

  for (let i = 0; i < GRID_CELLS; i++) {
    const cell = document.createElement('div');
    cell.className   = 'grid-cell';
    cell.dataset.idx = i;

    cell.addEventListener('click',      () => onCellClick(i));
    cell.addEventListener('mouseenter', () => onCellHover(i));
    cell.addEventListener('mouseleave', onCellLeave);

    // Ghost cells (part of a building's footprint but not the anchor) get hidden
    const anchorIdx = occupiedMap[i];
    if (anchorIdx !== undefined && anchorIdx !== i) {
      // This is a ghost cell — make it invisible but keep it in the grid
      cell.classList.add('ghost-cell');
    }

    grid.appendChild(cell);
  }

  // Now render buildings (as absolutely-positioned spans over gridarea)
  renderBuildingOverlays();
  updateFogOfWar();
  sizeEffectCanvas();
}

/**
 * Place absolutely-positioned building overlays on the grid.
 * Buildings span multiple grid cells via grid-column/row span CSS.
 */
function renderBuildingOverlays(animate = false, animateAnchor = null) {
  // Remove existing overlays
  document.querySelectorAll('.building-overlay').forEach(el => el.remove());

  const gridEl = document.getElementById('game-grid');
  const CELL   = 44; // matches CSS .grid-cell width/height

  for (const [ancStr, cell] of Object.entries(gameState.baseLayout)) {
    const anc  = parseInt(ancStr, 10);
    const bDef = BUILDINGS[cell.buildingId];
    if (!bDef) continue;

    const size   = getBuildingSize(cell.buildingId);
    const ancRow = Math.floor(anc / GRID_SIZE);
    const ancCol = anc % GRID_SIZE;

    const hpPct = (cell.hp / (cell.maxHp || bDef.hp[cell.level - 1])) * 100;
    const hpClass = hpPct > 60 ? '' : hpPct > 25 ? ' hp-mid' : ' hp-low';

    const overlay = document.createElement('div');
    overlay.className = `building-overlay building-${cell.buildingId}${cell.buildingId === 'cc' ? ' building-cc-anim' : ''}`;
    if (animate && anc === animateAnchor) overlay.classList.add('building-construct');
    overlay.dataset.anchor = anc;

    // Position using grid coordinates (1-indexed)
    overlay.style.gridColumn = `${ancCol + 1} / span ${size}`;
    overlay.style.gridRow    = `${ancRow + 1} / span ${size}`;
    overlay.style.zIndex     = '3';

    const imgSrc = buildingImgSrc(cell.buildingId, cell.level);

    overlay.innerHTML = `
      <div class="bld-img-wrap">
        <img src="${imgSrc}" alt="${bDef.name} Lv${cell.level}" class="bld-img" draggable="false"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
        <div class="bld-fallback" style="display:none;color:${bDef.color}">${bDef.emoji}</div>
      </div>
      <div class="building-level">L${cell.level}</div>
      <div class="building-hp-bar"><div class="hp-fill${hpClass}" style="width:${hpPct.toFixed(1)}%"></div></div>`;

    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedBuildingId) return; // in build mode
      if (movingCellIndex !== null) return; // handled by cell click
      selectCell(anc);
    });

    gridEl.appendChild(overlay);
  }
}

/** Re-render a single cell's building overlay without rebuilding the whole grid. */
function updateCell(index, animate = false) {
  // Rebuild overlays (lightweight since it's just DOM)
  renderBuildingOverlays(animate, animate ? index : null);
  updateFogOfWar();
}

/** Darken cells that are far from any placed building (fog of war). */
function updateFogOfWar() {
  // Collect all occupied cell indices (anchor + footprint)
  const occupiedCells = [];
  for (const [ancStr, cell] of Object.entries(gameState.baseLayout)) {
    const anc   = parseInt(ancStr, 10);
    const cells = getOccupiedCells(anc, cell.buildingId);
    if (cells) occupiedCells.push(...cells);
  }

  for (let i = 0; i < GRID_CELLS; i++) {
    const row = Math.floor(i / GRID_SIZE);
    const col = i % GRID_SIZE;
    let visible = false;

    for (const ci of occupiedCells) {
      const bRow = Math.floor(ci / GRID_SIZE);
      const bCol = ci % GRID_SIZE;
      if (Math.max(Math.abs(row - bRow), Math.abs(col - bCol)) <= FOG_RANGE) {
        visible = true; break;
      }
    }

    const el = document.querySelector(`.grid-cell[data-idx="${i}"]`);
    if (el) el.classList.toggle('fog', !visible);
  }
}

/** Match the effect canvas size to the grid wrapper. */
function sizeEffectCanvas() {
  const wrapper = document.querySelector('.grid-wrapper');
  const canvas  = document.getElementById('effect-canvas');
  if (!wrapper || !canvas) return;
  const rect        = wrapper.getBoundingClientRect();
  canvas.width      = rect.width;
  canvas.height     = rect.height;
}


// ════════════════════════════════════════════════════════════════════════════
// Cell Interaction
// ════════════════════════════════════════════════════════════════════════════

/** Return all cell indices currently covered by buildings (anchor + footprint). */
function getAllOccupiedCells() {
  const set = new Set();
  for (const [ancStr, cell] of Object.entries(gameState.baseLayout)) {
    const anc   = parseInt(ancStr, 10);
    const cells = getOccupiedCells(anc, cell.buildingId);
    if (cells) cells.forEach(c => set.add(c));
  }
  return set;
}

function onCellClick(index) {
  // ── Move mode ───────────────────────────────────────────────────────────
  if (movingCellIndex !== null) {
    const movingCell = gameState.baseLayout[movingCellIndex];
    if (!movingCell) { cancelMove(); return; }

    // If clicked the same building, cancel
    if (index === movingCellIndex) { cancelMove(); return; }

    // Check if this anchor is valid
    const bId  = movingCell.buildingId;
    const footprint = getOccupiedCells(index, bId);
    if (!footprint) { notify('Cannot place here — too close to edge', 'error'); return; }

    // Check all footprint cells are free (ignoring the building's own old cells)
    const oldCells = new Set(getOccupiedCells(movingCellIndex, bId) || []);
    const occupied = getAllOccupiedCells();
    const blocked  = footprint.some(c => occupied.has(c) && !oldCells.has(c));
    if (blocked) { notify('Not enough space here', 'error'); return; }

    // Move: remove from old anchor, add to new anchor
    delete gameState.baseLayout[movingCellIndex];
    gameState.baseLayout[index] = movingCell;

    cancelMove();
    renderGrid();
    selectCell(index);
    scheduleAutoSave();
    notify('Building moved!', 'success');
    return;
  }

  if (selectedBuildingId) {
    // ── Place building ──────────────────────────────────────────────────
    const result = placeBuilding(gameState, index, selectedBuildingId);
    if (result.success) {
      renderGrid();                        // Rebuild grid + ghost cells + overlays
      renderBuildingOverlays(true, index); // With construction animation
      renderResourceBar();
      buildBuildMenu();
      scheduleAutoSave();
      flashCell(index, 'success');
      notify(`${BUILDINGS[selectedBuildingId].name} placed!`, 'success');
    } else {
      flashCell(index, 'error');
      notify(result.error, 'error');
    }
  } else {
    // ── Inspect / select ────────────────────────────────────────────────
    // Check if clicked cell is an anchor or a ghost footprint cell
    const occupiedMap = buildOccupiedMap();
    const anchor = occupiedMap[index];
    if (anchor !== undefined) {
      selectCell(anchor);
    } else {
      clearCellSelection();
    }
  }
}

function onCellHover(index) {
  // Move mode: highlight footprint of hovered destination
  if (movingCellIndex !== null) {
    clearFootprintHighlight();
    const bId = gameState.baseLayout[movingCellIndex]?.buildingId;
    if (!bId) return;
    const footprint = getOccupiedCells(index, bId);
    if (!footprint) return;
    const oldCells  = new Set(getOccupiedCells(movingCellIndex, bId) || []);
    const occupied  = getAllOccupiedCells();
    const isValid   = !footprint.some(c => occupied.has(c) && !oldCells.has(c));
    footprint.forEach(c => {
      const el = document.querySelector(`.grid-cell[data-idx="${c}"]`);
      if (el) el.classList.add(isValid ? 'move-preview-ok' : 'move-preview-bad');
    });
    return;
  }

  if (!selectedBuildingId) return;

  clearFootprintHighlight();
  const footprint = getOccupiedCells(index, selectedBuildingId);
  if (!footprint) return;
  const occupied  = getAllOccupiedCells();
  const isValid   = !footprint.some(c => occupied.has(c));
  footprint.forEach(c => {
    const el = document.querySelector(`.grid-cell[data-idx="${c}"]`);
    if (el) el.classList.add(isValid ? 'place-preview' : 'place-preview-bad');
  });
}

function onCellLeave() {
  clearFootprintHighlight();
}

function clearFootprintHighlight() {
  document.querySelectorAll(
    '.place-preview, .place-preview-bad, .move-preview-ok, .move-preview-bad'
  ).forEach(c => c.classList.remove('place-preview','place-preview-bad','move-preview-ok','move-preview-bad'));
}

function selectCell(index) {
  clearCellSelection();
  // Highlight ALL cells of this building's footprint
  const cell = gameState.baseLayout[index];
  if (cell) {
    const cells = getOccupiedCells(index, cell.buildingId) || [index];
    cells.forEach(c => {
      const el = document.querySelector(`.grid-cell[data-idx="${c}"]`);
      if (el) el.classList.add('selected');
    });
    // Also highlight the overlay
    document.querySelectorAll(`.building-overlay[data-anchor="${index}"]`)
      .forEach(el => el.classList.add('selected'));
  }
  selectedCellIndex = index;
  renderBuildingInfo(index);
}

function clearCellSelection() {
  document.querySelectorAll('.grid-cell.selected').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.building-overlay.selected').forEach(c => c.classList.remove('selected'));
  selectedCellIndex = null;
  document.getElementById('selected-info').innerHTML =
    '<p class="hint-text">Click a building to inspect it. Click an empty cell while a structure is selected to place it.</p>';
}

function cancelMove() {
  movingCellIndex = null;
  document.getElementById('game-grid').classList.remove('move-mode');
  document.querySelectorAll('.building-overlay.moving').forEach(el => el.classList.remove('moving'));
  clearFootprintHighlight();
  // Re-render building info if a cell is still selected
  if (selectedCellIndex !== null) renderBuildingInfo(selectedCellIndex);
}

function flashCell(index, type) {
  const el = document.querySelector(`.grid-cell[data-idx="${index}"]`);
  if (!el) return;
  el.classList.add(`flash-${type}`);
  setTimeout(() => el.classList.remove(`flash-${type}`), 600);
}


// ════════════════════════════════════════════════════════════════════════════
// Building Info Panel
// ════════════════════════════════════════════════════════════════════════════

function renderBuildingInfo(index) {
  const cell = gameState.baseLayout[index];
  if (!cell) return;

  const bDef      = BUILDINGS[cell.buildingId];
  const nextLvl   = cell.level < bDef.maxLevel ? cell.level + 1 : null;
  const upgCost   = nextLvl ? bDef.cost[cell.level] : null;
  const canUpg    = upgCost && canAfford(gameState.resources, upgCost);
  const hpPct     = Math.round((cell.hp / (cell.maxHp || bDef.hp[cell.level - 1])) * 100);
  const imgSrc    = buildingImgSrc(cell.buildingId, cell.level);

  const statsRows = [];
  statsRows.push(`<div class="stat-row"><span>HP</span><span>${Math.ceil(cell.hp)} / ${bDef.hp[cell.level-1]} (${hpPct}%)</span></div>`);
  if (bDef.provides) {
    Object.entries(bDef.provides).forEach(([res, lvls]) => {
      statsRows.push(`<div class="stat-row"><span>${res.toUpperCase()}/s</span><span>+${lvls[cell.level-1]}</span></div>`);
    });
  }
  if (bDef.dps)   statsRows.push(`<div class="stat-row"><span>DPS</span><span>${bDef.dps[cell.level-1]}</span></div>`);
  if (bDef.range) statsRows.push(`<div class="stat-row"><span>RANGE</span><span>${bDef.range[cell.level-1]} cells</span></div>`);

  const isMoveActive = movingCellIndex === index;

  document.getElementById('selected-info').innerHTML = `
    <div class="building-info">
      <div class="info-header" style="border-color:${bDef.color}">
        <img src="${imgSrc}" class="info-bld-img" alt="${bDef.name}"
             onerror="this.style.display='none'" />
        <div>
          <h3>${bDef.name}</h3>
          <span class="info-level">Level ${cell.level} / ${bDef.maxLevel}</span>
        </div>
      </div>
      <p class="info-desc">${bDef.description}</p>
      <div class="info-stats">${statsRows.join('')}</div>
      ${nextLvl
        ? `<button class="btn-upgrade ${canUpg ? '' : 'disabled'}"
                   onclick="openUpgradeModal(${index})">
             ↑ UPGRADE TO L${nextLvl}
             <span class="cost">${formatCost(upgCost)}</span>
           </button>`
        : '<div class="max-level-badge">★ MAX LEVEL</div>'}
      <button class="btn-move ${isMoveActive ? 'active' : ''}" onclick="toggleMoveMode(${index})">
        ${isMoveActive ? '✕ CANCEL MOVE' : '✥ MOVE BUILDING'}
      </button>
      ${cell.buildingId !== 'cc'
        ? `<button class="btn-demolish" onclick="confirmDemolish(${index})">☠ DEMOLISH</button>`
        : ''}
    </div>`;
}

/** Format a cost object as a readable string: ⛏150 ⚡80 */
function formatCost(cost) {
  if (!cost) return 'Free';
  const ICONS = { minerals: '⛏', energy: '⚡', oxygen: '◎' };
  return Object.entries(cost).map(([res, amt]) => `${ICONS[res]}${amt}`).join(' ');
}


// ════════════════════════════════════════════════════════════════════════════
// Upgrade / Demolish Modals
// ════════════════════════════════════════════════════════════════════════════

window.openUpgradeModal = function (index) {
  const cell    = gameState.baseLayout[index];
  if (!cell || cell.level >= BUILDINGS[cell.buildingId].maxLevel) return;

  const bDef    = BUILDINGS[cell.buildingId];
  const nextLvl = cell.level + 1;
  const cost    = bDef.cost[cell.level];
  const canUpg  = canAfford(gameState.resources, cost);

  document.getElementById('upgrade-title').textContent = `UPGRADE — ${bDef.name.toUpperCase()}`;

  // Build bonus comparison rows
  const bonuses = [];
  if (bDef.provides) {
    Object.entries(bDef.provides).forEach(([res, lvls]) =>
      bonuses.push(`<div class="bonus-row"><span>${res.toUpperCase()}/s</span>
                    <span>${lvls[cell.level-1]} → <strong>${lvls[nextLvl-1]}</strong></span></div>`));
  }
  bonuses.push(`<div class="bonus-row"><span>HP</span>
                <span>${bDef.hp[cell.level-1]} → <strong>${bDef.hp[nextLvl-1]}</strong></span></div>`);
  if (bDef.dps) bonuses.push(`<div class="bonus-row"><span>DPS</span>
                <span>${bDef.dps[cell.level-1]} → <strong>${bDef.dps[nextLvl-1]}</strong></span></div>`);

  document.getElementById('upgrade-body').innerHTML = `
    <div class="upgrade-info">
      <div class="upgrade-lvl">Level ${cell.level} → ${nextLvl}</div>
      <div class="upgrade-cost">Cost: ${formatCost(cost)}</div>
      <hr class="divider">
      <div class="upgrade-bonuses">
        <h4>IMPROVEMENTS</h4>
        ${bonuses.join('')}
      </div>
    </div>`;

  const confirmBtn = document.getElementById('upgrade-confirm-btn');
  confirmBtn.disabled     = !canUpg;
  confirmBtn.textContent  = canUpg ? 'UPGRADE NOW' : 'INSUFFICIENT RESOURCES';
  confirmBtn.onclick = () => {
    const result = upgradeBuilding(gameState, index);
    if (result.success) {
      renderBuildingOverlays(); // Refresh PNGs (level changed)
      renderResourceBar();
      buildBuildMenu();
      renderBuildingInfo(index);
      selectCell(index); // Re-highlight
      scheduleAutoSave();
      closeModal('upgrade-modal');
      notify(`${bDef.name} upgraded to Level ${gameState.baseLayout[index].level}!`, 'success');
    } else {
      notify(result.error, 'error');
    }
  };

  document.getElementById('demolish-modal-btn').onclick = () => {
    closeModal('upgrade-modal');
    confirmDemolish(index);
  };

  openModal('upgrade-modal');
};

window.confirmDemolish = function (index) {
  if (!confirm('Demolish this building? Resources are NOT refunded.')) return;
  const result = demolishBuilding(gameState, index);
  if (result.success) {
    clearCellSelection();
    if (movingCellIndex === index) cancelMove();
    renderGrid(); // Full grid rebuild to clean up ghost cells
    scheduleAutoSave();
    notify('Building demolished.', 'info');
  } else {
    notify(result.error, 'error');
  }
};


// ════════════════════════════════════════════════════════════════════════════
// Build Menu
// ════════════════════════════════════════════════════════════════════════════

function buildBuildMenu() {
  const list = document.getElementById('build-list');
  list.innerHTML = '';

  Object.values(BUILDINGS).forEach(bDef => {
    if (bDef.id === 'cc') return; // Command Center is permanent

    const cost       = bDef.cost[0];
    const affordable = canAfford(gameState.resources, cost);
    const selected   = selectedBuildingId === bDef.id;
    const imgSrc     = buildingImgSrc(bDef.id, 1);

    const item = document.createElement('div');
    item.className = `build-item ${affordable ? '' : 'unaffordable'} ${selected ? 'selected-build' : ''}`;
    item.id = `build-item-${bDef.id}`;
    item.innerHTML = `
      <div class="build-thumb">
        <img src="${imgSrc}" alt="${bDef.name}" class="build-thumb-img"
             onerror="this.style.display='none';this.nextElementSibling.style.display='inline'" />
        <span style="display:none;color:${bDef.color}">${bDef.emoji}</span>
      </div>
      <div class="build-info">
        <span class="build-name">${bDef.name}</span>
        <span class="build-cost">${formatCost(cost)}</span>
      </div>`;
    item.addEventListener('click', () => {
      if (!affordable) { notify('Insufficient resources', 'error'); return; }
      selectBuildItem(bDef.id);
    });
    list.appendChild(item);
  });
}

function selectBuildItem(buildingId) {
  if (selectedBuildingId === buildingId) { cancelBuild(); return; }

  selectedBuildingId = buildingId;
  document.querySelectorAll('.build-item').forEach(i => i.classList.remove('selected-build'));
  document.getElementById(`build-item-${buildingId}`)?.classList.add('selected-build');
  document.getElementById('cancel-build-btn').style.display = 'inline-flex';
  document.getElementById('game-grid').classList.add('build-mode');
  clearCellSelection();
  notify(`Placing ${BUILDINGS[buildingId].name} — click an empty cell`, 'info');
}

window.cancelBuild = function () {
  selectedBuildingId = null;
  document.querySelectorAll('.build-item').forEach(i => i.classList.remove('selected-build'));
  document.getElementById('cancel-build-btn').style.display = 'none';
  document.getElementById('game-grid').classList.remove('build-mode');
  clearFootprintHighlight();
};

/** Enter / exit move mode for a building at anchorIndex. */
window.toggleMoveMode = function (anchorIndex) {
  if (movingCellIndex === anchorIndex) {
    cancelMove();
    return;
  }
  // Exit any existing move
  if (movingCellIndex !== null) cancelMove();

  movingCellIndex = anchorIndex;
  document.getElementById('game-grid').classList.add('move-mode');
  // Highlight overlay as 'moving'
  document.querySelectorAll('.building-overlay.moving').forEach(el => el.classList.remove('moving'));
  document.querySelectorAll(`.building-overlay[data-anchor="${anchorIndex}"]`)
    .forEach(el => el.classList.add('moving'));
  renderBuildingInfo(anchorIndex); // Refresh button state
  notify('Click any valid empty area to move this building', 'info');
};


// ════════════════════════════════════════════════════════════════════════════
// Unit Menu
// ════════════════════════════════════════════════════════════════════════════

function buildUnitMenu() {
  const list        = document.getElementById('unit-list');
  const hasBarracks = Object.values(gameState.baseLayout).some(c => c.buildingId === 'barracks');

  list.innerHTML = '';

  Object.values(UNITS).forEach(uDef => {
    const affordable = canAfford(gameState.resources, uDef.cost);
    const locked     = !hasBarracks;

    const item = document.createElement('div');
    item.className = `unit-item ${(affordable && !locked) ? '' : 'unaffordable'}`;
    item.innerHTML = `
      <span class="build-icon" style="color:${uDef.color}">${uDef.emoji}</span>
      <div class="build-info">
        <span class="build-name">${uDef.name}</span>
        <span class="build-cost">${formatCost(uDef.cost)}</span>
      </div>
      <button class="btn-train ${(affordable && !locked) ? '' : 'disabled'}"
              id="train-${uDef.id}"
              onclick="onTrainUnit('${uDef.id}')">+1</button>`;
    list.appendChild(item);
  });

  if (!hasBarracks) {
    const note = document.createElement('p');
    note.className   = 'hint-text';
    note.textContent = '⊞ Build Barracks to recruit units';
    list.appendChild(note);
  }
}

window.onTrainUnit = function (unitId) {
  const result = trainUnit(gameState, unitId);
  if (result.success) {
    renderResourceBar();
    buildUnitMenu();
    renderArmyDisplay();
    scheduleAutoSave();
    notify(`${UNITS[unitId].name} recruited!`, 'success');
  } else {
    notify(result.error, 'error');
  }
};

function renderArmyDisplay() {
  const display = document.getElementById('army-display');
  const units   = gameState.units || {};
  const total   = Object.values(units).reduce((s, n) => s + n, 0);

  if (total === 0) {
    display.innerHTML = '<p class="hint-text">No units trained.</p>';
    return;
  }

  display.innerHTML = Object.entries(units)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => {
      const u = UNITS[id];
      return `<div class="army-unit" style="border-color:${u.color}40">
        <span style="color:${u.color}">${u.emoji}</span>
        <span>${u.name}</span>
        <span class="army-count">×${n}</span>
      </div>`;
    }).join('');
}


// ════════════════════════════════════════════════════════════════════════════
// Resource Bar
// ════════════════════════════════════════════════════════════════════════════

function renderResourceBar() {
  if (!gameState) return;

  const { resources } = gameState;
  const caps          = getResourceCaps(gameState);
  const rates         = getResourceRates(gameState);

  ['minerals', 'energy', 'oxygen'].forEach(res => {
    const val  = Math.floor(resources[res] || 0);
    const cap  = caps[res];
    const rate = rates[res];
    const pct  = val / cap;

    document.getElementById(`val-${res}`).textContent  = val.toLocaleString();
    document.getElementById(`cap-${res}`).textContent  = `/${cap.toLocaleString()}`;
    document.getElementById(`rate-${res}`).textContent = `+${rate.toFixed(1)}/s`;

    const pill = document.getElementById(`res-${res}`);
    pill.classList.toggle('resource-full',    pct >= 0.99);
    pill.classList.toggle('resource-warning', pct >= 0.80 && pct < 0.99);
  });
}

function renderCommanderInfo() {
  document.getElementById('commander-name').textContent = gameState.playerName || 'Commander';
}

function renderDefenseLog() {
  const log     = document.getElementById('defense-log');
  const entries = (gameState.defenseLog || []).slice(-5).reverse();

  if (entries.length === 0) {
    log.innerHTML = '<p class="hint-text">No attacks recorded.</p>';
    return;
  }

  log.innerHTML = entries.map(e => `
    <div class="log-entry ${e.victory ? 'log-defeat' : 'log-success'}">
      <span>${e.victory ? '💀' : '🛡'}</span>
      <div>
        <div>${e.victory ? 'Base raided!' : 'Attack repelled!'}</div>
        <div class="log-loot">Loot lost: ⛏${e.loot?.minerals||0} ⚡${e.loot?.energy||0} ◎${e.loot?.oxygen||0}</div>
        <div class="log-time">${new Date(e.timestamp).toLocaleString()}</div>
      </div>
    </div>`).join('');
}


// ════════════════════════════════════════════════════════════════════════════
// Attack / Battle Flow
// ════════════════════════════════════════════════════════════════════════════

window.initiateAttack = async function () {
  if (!currentUser) return;
  const totalUnits = Object.values(gameState.units).reduce((s, n) => s + n, 0);
  if (totalUnits === 0) { notify('Train units before attacking!', 'error'); return; }

  const attackBtn = document.getElementById('attack-btn');
  attackBtn.disabled = true;
  notify('Scanning for targets…', 'info');

  try {
    const opponent = await getRandomOpponent(currentUser.uid);
    if (!opponent) {
      notify('Nenhum outro jogador encontrado! Você é o único com uma base no momento.', 'error');
      attackBtn.disabled = false;
      return;
    }
    opponentData = opponent;
    openBattleModal(opponent);
  } catch (err) {
    console.error('Attack error:', err);
    
    // Mostrando exatamente qual foi o erro na tela para ajudar a debugar
    if (err.message && err.message.includes('Missing or insufficient permissions')) {
      notify('ERRO FIREBASE: Ajuste as suas Security Rules no console do Firebase Firestore!', 'error');
    } else {
      notify(`Erro ao atacar: ${err.message || 'Desconhecido'}`, 'error');
    }
    
    attackBtn.disabled = false;
  }
};

/** Open the attack canvas modal and show the enemy base. */
function openBattleModal(opponent) {
  const canvas = document.getElementById('attack-canvas');
  const W      = GRID_SIZE * CELL_PX;
  canvas.width  = W;
  canvas.height = W;

  document.getElementById('battle-title').textContent =
    `⚔ ATTACKING: ${opponent.data.displayName || 'Unknown Commander'}`;

  // Reset UI
  document.getElementById('battle-log').innerHTML = '';
  document.getElementById('start-battle-btn').disabled = false;
  document.getElementById('retreat-btn').textContent   = 'RETREAT';

  // Draw the static enemy base
  drawBaseOnCanvas(canvas.getContext('2d'), opponent.data.baseLayout || {}, CELL_PX);

  // Build deploy section
  deployedCounts = {};
  Object.keys(gameState.units).forEach(id => { deployedCounts[id] = 0; });

  const deployEl = document.getElementById('deploy-units');
  deployEl.innerHTML = Object.entries(gameState.units)
    .filter(([, n]) => n > 0)
    .map(([id, total]) => {
      const u = UNITS[id];
      return `
        <div class="deploy-unit-row">
          <span style="color:${u.color}">${u.emoji} ${u.name}</span>
          <div class="deploy-controls">
            <button onclick="adjustDeploy('${id}',-1)">−</button>
            <span id="deploy-count-${id}">0</span>
            <button onclick="adjustDeploy('${id}',1)">+</button>
          </div>
          <span class="deploy-max">/${total}</span>
        </div>`;
    }).join('');

  openModal('battle-modal');
}

window.adjustDeploy = function (unitId, delta) {
  const max    = gameState.units[unitId] || 0;
  deployedCounts[unitId] = Math.max(0, Math.min(max, (deployedCounts[unitId] || 0) + delta));
  document.getElementById(`deploy-count-${unitId}`).textContent = deployedCounts[unitId];
};

window.startBattle = function () {
  const total = Object.values(deployedCounts).reduce((s, n) => s + n, 0);
  if (total === 0) { notify('Deploy at least one unit!', 'error'); return; }

  document.getElementById('start-battle-btn').disabled = true;
  document.getElementById('retreat-btn').textContent   = 'END BATTLE';

  battleState = initBattle(deployedCounts, opponentData.data.baseLayout || {});

  const canvas  = document.getElementById('attack-canvas');
  const ctx     = canvas.getContext('2d');
  let lastTime  = performance.now();

  function loop(ts) {
    if (!battleState) return;
    const dt = Math.min((ts - lastTime) / 1000, 0.1);
    lastTime = ts;

    stepBattle(battleState, dt, ts);
    renderBattleFrame(ctx, battleState, opponentData.data.baseLayout || {});

    // Update log display
    if (battleState.log.length) {
      const logEl = document.getElementById('battle-log');
      logEl.innerHTML = battleState.log.slice(-12).reverse()
        .map(l => `<div class="log-line">${l}</div>`).join('');
    }

    if (battleState.done) {
      renderBattleFrame(ctx, battleState, opponentData.data.baseLayout || {}); // Final frame
      finishBattle();
    } else {
      requestAnimationFrame(loop);
    }
  }

  requestAnimationFrame(loop);
};

// ════════════════════════════════════════════════════════════════════════════
// Low Poly Canvas Helpers
// ════════════════════════════════════════════════════════════════════════════

/** Low poly terrain colours (alternating tiles) */
const LP_TILE_A = '#7cb87c';
const LP_TILE_B = '#8dcf8d';
const LP_TILE_C = '#6aa56a';

/** Draw a low poly terrain grid background on canvas. */
function drawLPTerrain(ctx, W, cellSize) {
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const x = col * cellSize, y = row * cellSize;
      const idx = row * GRID_SIZE + col;
      ctx.fillStyle = (idx % 3 === 0) ? LP_TILE_C : (idx % 2 === 0) ? LP_TILE_A : LP_TILE_B;
      ctx.fillRect(x, y, cellSize, cellSize);
      // Tile border
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x + 0.25, y + 0.25, cellSize - 0.5, cellSize - 0.5);
    }
  }
}

/**
 * Draw a single low poly building block on canvas.
 * Uses a 3-tone approach: front face, right side face (shadow), top face.
 */
function drawLPBuilding(ctx, x, y, cellSize, color, alive) {
  const pad  = Math.floor(cellSize * 0.12);
  const bx   = x + pad,     by   = y + pad;
  const bw   = cellSize - pad * 2 - Math.floor(cellSize * 0.18);
  const bh   = cellSize - pad * 2;
  const side = Math.floor(cellSize * 0.18); // right-face width
  const top  = Math.floor(cellSize * 0.20); // top-face height

  if (!alive) {
    // Rubble — scattered grey polygons
    ctx.fillStyle = 'rgba(100,100,100,0.6)';
    ctx.fillRect(bx + 2, by + bh * 0.5, bw * 0.5, bh * 0.45);
    ctx.fillStyle = 'rgba(80,80,80,0.5)';
    ctx.fillRect(bx + bw * 0.4, by + bh * 0.6, bw * 0.5, bh * 0.35);
    ctx.fillStyle = 'rgba(60,60,60,0.4)';
    ctx.fillRect(bx + bw * 0.2, by + bh * 0.72, bw * 0.3, bh * 0.2);
    return;
  }

  // ── Front face ──
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.rect(bx, by + top, bw, bh - top);
  ctx.fill();

  // ── Right / shadow face ──
  ctx.fillStyle = shadeColor(color, -38);
  ctx.beginPath();
  ctx.moveTo(bx + bw,       by + top);
  ctx.lineTo(bx + bw + side, by + top + side * 0.5);
  ctx.lineTo(bx + bw + side, by + bh + side * 0.5);
  ctx.lineTo(bx + bw,        by + bh);
  ctx.closePath();
  ctx.fill();

  // ── Top face ──
  ctx.fillStyle = shadeColor(color, 30);
  ctx.beginPath();
  ctx.moveTo(bx,             by + top);
  ctx.lineTo(bx + side,      by);
  ctx.lineTo(bx + bw + side, by);
  ctx.lineTo(bx + bw,        by + top);
  ctx.closePath();
  ctx.fill();

  // Subtle top edge highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(bx, by + top); ctx.lineTo(bx + side, by); ctx.lineTo(bx + bw + side, by);
  ctx.stroke();
}

/** Lighten (+) or darken (-) a CSS hex colour by amount. */
function shadeColor(hex, amount) {
  const num = parseInt(hex.replace('#',''), 16);
  const r   = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g   = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b   = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `rgb(${r},${g},${b})`;
}

/** Map of building id → flat canvas colour (friendlier than bDef.color for LP) */
const LP_COLORS = {
  cc:       '#ffd600',
  mine:     '#ff8f00',
  solar:    '#fdd835',
  oxy:      '#66bb6a',
  depot:    '#42a5f5',
  turret:   '#ef5350',
  barracks: '#ab47bc',
};

/** Draw a static base grid (enemy base or initial view). */
function drawBaseOnCanvas(ctx, layout, cellSize) {
  const W = GRID_SIZE * cellSize;

  // Low poly terrain
  drawLPTerrain(ctx, W, cellSize);

  // Outer border
  ctx.strokeStyle = '#5a9e5a';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, W, W);

  Object.entries(layout).forEach(([idx, cell]) => {
    const ci   = parseInt(idx, 10);
    const row  = Math.floor(ci / GRID_SIZE);
    const col  = ci % GRID_SIZE;
    const bDef = BUILDINGS[cell.buildingId];
    if (!bDef) return;

    const x = col * cellSize, y = row * cellSize;
    const color = LP_COLORS[cell.buildingId] || bDef.color;

    drawLPBuilding(ctx, x, y, cellSize, color, true);

    // Level badge
    ctx.font        = `bold ${Math.floor(cellSize * 0.20)}px Nunito,Inter,sans-serif`;
    ctx.fillStyle   = '#fff';
    ctx.textAlign   = 'left';
    ctx.textBaseline= 'top';
    ctx.fillText(`L${cell.level}`, x + 2, y + 2);
  });
}

/** Animated low poly battle frame renderer. */
function renderBattleFrame(ctx, bs, layout) {
  const cellSize = CELL_PX;
  const W        = GRID_SIZE * cellSize;

  // Low poly terrain background
  drawLPTerrain(ctx, W, cellSize);

  // Outer border
  ctx.strokeStyle = '#5a9e5a';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, W, W);

  // Buildings
  bs.buildings.forEach(b => {
    const x = b.col * cellSize;
    const y = b.row * cellSize;
    const color = LP_COLORS[b.buildingId] || '#888';

    drawLPBuilding(ctx, x, y, cellSize, color, b.alive);

    if (b.alive) {
      // HP bar
      const hpPct = Math.max(0, b.hp / b.maxHp);
      const barW  = cellSize - 6;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x + 3, y + cellSize - 5, barW, 4);
      ctx.fillStyle = hpPct > 0.5 ? '#43a047' : hpPct > 0.25 ? '#fb8c00' : '#e53935';
      ctx.fillRect(x + 3, y + cellSize - 5, barW * hpPct, 4);

      // Level badge
      ctx.font        = `bold ${Math.floor(cellSize * 0.2)}px Nunito,Inter,sans-serif`;
      ctx.fillStyle   = '#fff';
      ctx.textAlign   = 'left';
      ctx.textBaseline= 'top';
      ctx.fillText(`L${b.level}`, x + 2, y + 2);

      // Turret range ring
      if (b.buildingId === 'turret') {
        const range = BUILDINGS.turret.range[b.level - 1] * cellSize;
        ctx.beginPath();
        ctx.arc(b.x, b.y, range, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(239,83,80,0.22)';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  });

  // Projectiles — low poly bolts (small triangles)
  bs.projectiles.forEach(p => {
    const t  = 1 - p.life;
    const px = p.x + (p.tx - p.x) * t;
    const py = p.y + (p.ty - p.y) * t;
    const angle = Math.atan2(p.ty - p.y, p.tx - p.x);
    const len   = 8;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.moveTo(len, 0);
    ctx.lineTo(-len * 0.5,  3);
    ctx.lineTo(-len * 0.5, -3);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  });

  // Units — low poly capsule / rhombus shape
  bs.units.forEach(unit => {
    if (!unit.alive) return;
    const uDef = UNITS[unit.unitType];
    const hs = 7;  // half-size

    // Ground shadow
    ctx.save();
    ctx.translate(unit.x + 2, unit.y + 3);
    ctx.scale(1, 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, hs, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();
    ctx.restore();

    // Body — diamond shape (low poly)
    ctx.save();
    ctx.translate(unit.x, unit.y);
    ctx.fillStyle = uDef.color;
    ctx.beginPath();
    ctx.moveTo(0,  -hs);    // top
    ctx.lineTo(hs,   0);    // right
    ctx.lineTo(0,    hs);   // bottom
    ctx.lineTo(-hs,  0);    // left
    ctx.closePath();
    ctx.fill();

    // Top highlight face
    ctx.fillStyle = shadeColor(uDef.color, 40);
    ctx.beginPath();
    ctx.moveTo(0,  -hs);
    ctx.lineTo(hs,   0);
    ctx.lineTo(0,    0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // HP bar
    const hpPct = Math.max(0, unit.hp / unit.maxHp);
    const barW  = hs * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(unit.x - hs, unit.y - hs - 5, barW, 3);
    ctx.fillStyle = hpPct > 0.5 ? '#43a047' : hpPct > 0.25 ? '#fb8c00' : '#e53935';
    ctx.fillRect(unit.x - hs, unit.y - hs - 5, barW * hpPct, 3);
  });

  // Victory / Defeat overlay
  if (bs.done) {
    ctx.fillStyle = 'rgba(0, 40, 0, 0.65)';
    ctx.fillRect(0, 0, W, W);
    const txt   = bs.victory ? '⚔  VICTORY!' : '💀  DEFEAT';
    const tColor = bs.victory ? '#ffd600' : '#ef5350';
    ctx.font      = `bold 26px Nunito, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(txt, W / 2 + 2, W / 2 + 2);
    ctx.fillStyle = tColor;
    ctx.fillText(txt, W / 2, W / 2);
  }
}

/** Persist results and show the summary modal. */
async function finishBattle() {
  if (!battleState || !opponentData) return;

  const loot = calculateLoot(opponentData.data.resources || {}, battleState);

  try {
    await updateAfterBattle(
      currentUser.uid,
      opponentData.uid,
      loot,
      battleState.victory,
      battleState.log,
    );

    // Credit loot to local state
    const caps = getResourceCaps(gameState);
    gameState.resources.minerals = Math.min(caps.minerals, (gameState.resources.minerals || 0) + loot.minerals);
    gameState.resources.energy   = Math.min(caps.energy,   (gameState.resources.energy   || 0) + loot.energy);
    gameState.resources.oxygen   = Math.min(caps.oxygen,   (gameState.resources.oxygen   || 0) + loot.oxygen);

    // Deduct deployed units from army
    Object.entries(deployedCounts).forEach(([id, n]) => {
      gameState.units[id] = Math.max(0, (gameState.units[id] || 0) - n);
    });

    renderResourceBar();
    renderArmyDisplay();
    buildUnitMenu();
    scheduleAutoSave();

    closeModal('battle-modal');
    showBattleResult(battleState.victory, loot, battleState.log);
  } catch (err) {
    console.error('Battle save error:', err);
    notify('Battle over! (Could not save results)', 'error');
    closeModal('battle-modal');
  }

  document.getElementById('attack-btn').disabled = false;
  battleState = null;
  opponentData = null;
}

function showBattleResult(victory, loot, log) {
  document.getElementById('result-title').textContent = victory ? '🏆 VICTORY!' : '💀 DEFEAT';
  document.getElementById('result-body').innerHTML = `
    <div class="result-content ${victory ? 'victory' : 'defeat'}">
      <div class="result-loot">
        <h3>${victory ? 'RESOURCES PLUNDERED' : 'PARTIAL LOOT'}</h3>
        <div class="loot-grid">
          <div class="loot-item"><span>⛏</span><span>${loot.minerals.toLocaleString()} Minerals</span></div>
          <div class="loot-item"><span>⚡</span><span>${loot.energy.toLocaleString()} Energy</span></div>
          <div class="loot-item"><span>◎</span><span>${loot.oxygen.toLocaleString()} Oxygen</span></div>
        </div>
      </div>
      <div class="result-log">
        ${log.slice(-6).map(l => `<div>${l}</div>`).join('')}
      </div>
    </div>`;
  openModal('result-modal');
}

window.closeBattleResult = function () { closeModal('result-modal'); };

window.retreatFromBattle = function () {
  if (battleState) battleState.done = true;
  closeModal('battle-modal');
  document.getElementById('attack-btn').disabled = false;
  document.getElementById('start-battle-btn').disabled = false;
  battleState  = null;
  opponentData = null;
};


// ════════════════════════════════════════════════════════════════════════════
// Save / Load
// ════════════════════════════════════════════════════════════════════════════

function scheduleAutoSave() {
  setSaveStatus('saving');
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(performSave, 4000);
}

async function performSave() {
  if (!currentUser || !gameState) return;
  try {
    await savePlayerData(currentUser.uid, {
      playerName:  gameState.playerName,
      displayName: gameState.playerName,
      resources: {
        minerals: Math.floor(gameState.resources.minerals),
        energy:   Math.floor(gameState.resources.energy),
        oxygen:   Math.floor(gameState.resources.oxygen),
      },
      baseLayout:  gameState.baseLayout,
      units:       gameState.units,
      defenseLog:  gameState.defenseLog,
    });
    setSaveStatus('saved');
  } catch (err) {
    console.error('Save error:', err);
    setSaveStatus('error');
  }
}

window.manualSave = async function () {
  const btn       = document.getElementById('save-btn');
  btn.disabled    = true;
  btn.textContent = '💾 SAVING…';
  await performSave();
  btn.disabled    = false;
  btn.textContent = '💾 SAVE';
};

function setSaveStatus(status) {
  const el = document.getElementById('save-status');
  const MAP = { saving: '⟳ Saving…', saved: '✓ All changes saved', error: '⚠ Save failed' };
  el.textContent  = MAP[status] || '';
  el.className    = `save-status ${status}`;
}


// ════════════════════════════════════════════════════════════════════════════
// Modal Helpers
// ════════════════════════════════════════════════════════════════════════════

function openModal(id)         { document.getElementById(id).classList.add('active'); }
window.closeModal = function(id) { document.getElementById(id).classList.remove('active'); }


// ════════════════════════════════════════════════════════════════════════════
// Notification Toast
// ════════════════════════════════════════════════════════════════════════════

let notifTimer = null;

function notify(msg, type = 'info') {
  let el = document.getElementById('notif');
  if (!el) {
    el        = document.createElement('div');
    el.id     = 'notif';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className   = `notif notif-${type} active`;
  if (notifTimer) clearTimeout(notifTimer);
  notifTimer = setTimeout(() => el.classList.remove('active'), 3200);
}


// ════════════════════════════════════════════════════════════════════════════
// Screen / Loading Helpers
// ════════════════════════════════════════════════════════════════════════════

function showScreen(name) {
  document.getElementById('auth-screen').classList.toggle('active', name === 'auth');
  document.getElementById('game-screen').classList.toggle('active', name === 'game');
}

function showLoadingOverlay(show) {
  document.getElementById('loading-overlay').classList.toggle('active', show);
}


// ════════════════════════════════════════════════════════════════════════════
// Logout
// ════════════════════════════════════════════════════════════════════════════

window.logoutPlayer = async function () {
  stopGameLoop();
  await performSave();
  await logoutUser();
};
