/**
 * Colony Wars — Core Game Logic
 *
 * This module is framework-agnostic and handles:
 *  - Building & unit definitions (config data)
 *  - Game state factory
 *  - Resource generation
 *  - Building placement / upgrade / demolish
 *  - Unit training
 *  - Full battle simulation (tick-based)
 *
 * No DOM access — pure logic only.
 */

// ════════════════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════════════════

export const GRID_SIZE = 15;          // Grid is GRID_SIZE × GRID_SIZE cells
export const GRID_CELLS = GRID_SIZE * GRID_SIZE;
export const CELL_PX = 36;           // Pixels per cell on the attack canvas

/** Returns the grid footprint size for a building (all buildings occupy 1 cell now). */
export function getBuildingSize(buildingId) {
  return 1;
}

/**
 * Returns the list of cell indices occupied by a building with the given
 * anchor (top-left) at anchorIdx. Returns null if any cell would be out of bounds.
 */
export function getOccupiedCells(anchorIdx, buildingId) {
  const ancRow = Math.floor(anchorIdx / GRID_SIZE);
  const ancCol = anchorIdx % GRID_SIZE;

  // Check fits on grid
  if (ancRow >= GRID_SIZE || ancCol >= GRID_SIZE) return null;

  return [anchorIdx];
}

/** Base storage caps before any depots */
const BASE_CAPS = { minerals: 1000, energy: 1000, oxygen: 1000 };


// ════════════════════════════════════════════════════════════════════════════
// Building Definitions
// ════════════════════════════════════════════════════════════════════════════

/**
 * Building config map.
 *
 * Keys:
 *  id, name, emoji, color        — display
 *  maxLevel                      — max upgrade tier (1–3)
 *  hp[lvl-1]                     — hitpoints per level
 *  cost[lvl-1]                   — resource cost (null = free)
 *  provides                      — { resource: [gen/sec per level] }
 *  storageBonus[lvl-1]           — extra resource cap per depot
 *  dps[lvl-1]                    — turret damage per second per level
 *  range[lvl-1]                  — turret range in grid cells
 *  fireRate[lvl-1]               — ms between shots
 *  isUnique                      — only one per base if true
 */
export const BUILDINGS = {
  cc: {
    id: 'cc', name: 'Command Center', emoji: '⬡', color: '#00e5ff',
    description: 'The heart of your colony. If destroyed, the battle is lost.',
    maxLevel: 3,
    hp:   [800, 1200, 1800],
    cost: [null, { minerals: 500, energy: 300 }, { minerals: 1200, energy: 700, oxygen: 200 }],
    provides: {},
    isUnique: true,
  },
  mine: {
    id: 'mine', name: 'Mineral Extractor', emoji: '⛏', color: '#ffab00',
    description: 'Drills alien rock to extract raw minerals.',
    maxLevel: 3,
    hp:      [200, 280, 400],
    cost:    [{ minerals: 100 }, { minerals: 220, energy: 60 }, { minerals: 500, energy: 120, oxygen: 40 }],
    provides: { minerals: [2, 4, 7] },
    isUnique: false,
  },
  solar: {
    id: 'solar', name: 'Solar Array', emoji: '◈', color: '#ffe066',
    description: 'Captures the alien sun\'s energy to power your base.',
    maxLevel: 3,
    hp:      [150, 220, 320],
    cost:    [{ energy: 80 }, { energy: 180, minerals: 70 }, { energy: 380, minerals: 150 }],
    provides: { energy: [3, 5, 9] },
    isUnique: false,
  },
  oxy: {
    id: 'oxy', name: 'Oxygen Farm', emoji: '◎', color: '#00e676',
    description: 'Bio-algae vats that synthesize breathable oxygen.',
    maxLevel: 3,
    hp:      [180, 260, 380],
    cost:    [{ oxygen: 80,  minerals: 60  },
              { oxygen: 180, minerals: 130, energy: 50 },
              { oxygen: 380, minerals: 260, energy: 110 }],
    provides: { oxygen: [1.5, 3, 5] },
    isUnique: false,
  },
  depot: {
    id: 'depot', name: 'Storage Depot', emoji: '▣', color: '#448aff',
    description: 'Expands your colony\'s resource storage capacity.',
    maxLevel: 3,
    hp:          [300, 420, 600],
    cost:        [{ minerals: 200 }, { minerals: 450, energy: 110 }, { minerals: 900, energy: 220, oxygen: 110 }],
    provides:    {},
    storageBonus: [500, 1000, 2000],
    isUnique: false,
  },
  turret: {
    id: 'turret', name: 'Defense Turret', emoji: '⊕', color: '#ff1744',
    description: 'Automated plasma cannon. Shreds attacking units on sight.',
    maxLevel: 3,
    hp:       [350, 500, 720],
    cost:     [{ minerals: 150, energy: 100 },
               { minerals: 320, energy: 220 },
               { minerals: 700, energy: 450, oxygen: 60 }],
    provides:  {},
    dps:       [28, 50, 80],
    range:     [3,  4,  5 ],      // cells
    fireRate:  [1400, 1100, 850], // ms
    isUnique: false,
  },
  barracks: {
    id: 'barracks', name: 'Barracks', emoji: '⊞', color: '#e040fb',
    description: 'Manufactures combat units for planetary warfare.',
    maxLevel: 3,
    hp:      [250, 360, 520],
    cost:    [{ minerals: 250, energy: 100 },
              { minerals: 550, energy: 220, oxygen: 50 },
              { minerals: 1100, energy: 450, oxygen: 120 }],
    provides: {},
    isUnique: false,
  },
};


// ════════════════════════════════════════════════════════════════════════════
// Unit Definitions
// ════════════════════════════════════════════════════════════════════════════

/**
 * Unit config map.
 *
 * Keys:
 *  id, name, emoji, color
 *  hp, dps, speed (cells/sec), range (attack radius in cells)
 *  cost                   — resources to train one unit
 *  trainTime              — seconds to train (informational)
 *  preferBuilding[]       — target type priority list (nearest otherwise)
 */
export const UNITS = {
  drone: {
    id: 'drone', name: 'Scout Drone', emoji: '◆', color: '#00e5ff',
    description: 'Fast but fragile. Prioritises resource buildings.',
    hp: 80, dps: 15, speed: 2.0, range: 1.0,
    cost: { minerals: 50, energy: 30 },
    trainTime: 20,
    preferBuilding: ['mine', 'solar', 'oxy', 'depot'],
  },
  robot: {
    id: 'robot', name: 'Combat Robot', emoji: '◉', color: '#ff9100',
    description: 'Slow tank that soaks turret fire for the rest of the army.',
    hp: 250, dps: 38, speed: 0.9, range: 1.0,
    cost: { minerals: 120, energy: 80, oxygen: 30 },
    trainTime: 45,
    preferBuilding: ['turret', 'cc', 'barracks'],
  },
  ranger: {
    id: 'ranger', name: 'Plasma Ranger', emoji: '◇', color: '#ea80fc',
    description: 'Stays at range and picks off buildings with plasma bolts.',
    hp: 120, dps: 48, speed: 1.3, range: 2.5,
    cost: { minerals: 80, energy: 100, oxygen: 50 },
    trainTime: 35,
    preferBuilding: ['turret', 'cc'],
  },
};


// ════════════════════════════════════════════════════════════════════════════
// Game State Factory
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a fresh game state for a brand-new player.
 * Command Center is placed at the grid centre automatically.
 * @param {string} playerName
 * @returns {Object}
 */
export function createGameState(playerName) {
  const baseLayout = {};

  // Command Center anchor at row 5, col 5 so 4×4 fits well in a 15×15 grid
  // (rows 5-8, cols 5-8)
  const centerCell = 5 * GRID_SIZE + 5; // = 80
  baseLayout[centerCell] = {
    buildingId: 'cc',
    level:      1,
    hp:         BUILDINGS.cc.hp[0],
    maxHp:      BUILDINGS.cc.hp[0],
  };

  return {
    playerName,
    resources:   { minerals: 500, energy: 300, oxygen: 200 },
    baseLayout,
    units:       { drone: 0, robot: 0, ranger: 0 },
    defenseLog:  [],
  };
}


// ════════════════════════════════════════════════════════════════════════════
// Resource System
// ════════════════════════════════════════════════════════════════════════════

/**
 * Calculate resource storage caps considering all Storage Depots.
 * @param {Object} state
 * @returns {{ minerals: number, energy: number, oxygen: number }}
 */
export function getResourceCaps(state) {
  const caps = { ...BASE_CAPS };
  Object.values(state.baseLayout).forEach(cell => {
    if (cell.buildingId === 'depot') {
      const bonus = BUILDINGS.depot.storageBonus[cell.level - 1];
      caps.minerals += bonus;
      caps.energy   += bonus;
      caps.oxygen   += bonus;
    }
  });
  return caps;
}

/**
 * Calculate passive generation rates (units per second) for all resources.
 * @param {Object} state
 * @returns {{ minerals: number, energy: number, oxygen: number }}
 */
export function getResourceRates(state) {
  const rates = { minerals: 0, energy: 0, oxygen: 0 };
  Object.values(state.baseLayout).forEach(cell => {
    const bDef = BUILDINGS[cell.buildingId];
    if (!bDef?.provides) return;
    Object.entries(bDef.provides).forEach(([res, levels]) => {
      rates[res] += levels[cell.level - 1];
    });
  });
  return rates;
}

/**
 * Apply passive resource generation by deltaSec seconds.
 * Mutates state.resources in place.
 * @param {Object} state
 * @param {number} deltaSec
 */
export function generateResources(state, deltaSec) {
  const rates = getResourceRates(state);
  const caps  = getResourceCaps(state);
  ['minerals', 'energy', 'oxygen'].forEach(res => {
    state.resources[res] = Math.min(
      caps[res],
      (state.resources[res] || 0) + rates[res] * deltaSec,
    );
  });
}


// ════════════════════════════════════════════════════════════════════════════
// Affordability Helpers
// ════════════════════════════════════════════════════════════════════════════

/**
 * @param {{ minerals?: number, energy?: number, oxygen?: number }} resources
 * @param {{ minerals?: number, energy?: number, oxygen?: number } | null} cost
 */
export function canAfford(resources, cost) {
  if (!cost) return true;
  return Object.entries(cost).every(([res, amt]) => (resources[res] || 0) >= amt);
}

/**
 * Subtract cost from resources. Mutates resources.
 */
export function deductCost(resources, cost) {
  if (!cost) return;
  Object.entries(cost).forEach(([res, amt]) => {
    resources[res] = (resources[res] || 0) - amt;
  });
}


// ════════════════════════════════════════════════════════════════════════════
// Building Management
// ════════════════════════════════════════════════════════════════════════════

/**
 * Place a building at a grid cell index.
 * @param {Object} state
 * @param {number} cellIndex  0…(GRID_CELLS-1)
 * @param {string} buildingId
 * @returns {{ success: boolean, error?: string }}
 */
export function placeBuilding(state, cellIndex, buildingId) {
  const bDef = BUILDINGS[buildingId];
  if (!bDef) return { success: false, error: 'Unknown building type' };

  // Multi-cell footprint check
  const cells = getOccupiedCells(cellIndex, buildingId);
  if (!cells) return { success: false, error: 'Building does not fit here (too close to edge)' };

  // Check all footprint cells are free (ignore anchor check for 'cc' during init)
  const occupiedAnchors = new Set(
    Object.keys(state.baseLayout).map(Number)
  );
  // Build a set of ALL cells currently occupied (anchor + ghost cells)
  const allOccupied = new Set();
  for (const [ancStr, cell] of Object.entries(state.baseLayout)) {
    const anc = parseInt(ancStr, 10);
    const occupied = getOccupiedCells(anc, cell.buildingId);
    if (occupied) occupied.forEach(c => allOccupied.add(c));
  }

  for (const c of cells) {
    if (allOccupied.has(c)) return { success: false, error: 'Not enough space for this building' };
  }

  if (bDef.isUnique) {
    const exists = Object.values(state.baseLayout).some(c => c.buildingId === buildingId);
    if (exists) return { success: false, error: `Only one ${bDef.name} allowed` };
  }

  const cost = bDef.cost[0];
  if (!canAfford(state.resources, cost)) return { success: false, error: 'Insufficient resources' };

  deductCost(state.resources, cost);

  // Store only at anchor cell
  state.baseLayout[cellIndex] = {
    buildingId,
    level: 1,
    hp:    bDef.hp[0],
    maxHp: bDef.hp[0],
  };

  return { success: true };
}

/**
 * Upgrade a building at cellIndex to the next level.
 * @param {Object} state
 * @param {number} cellIndex
 * @returns {{ success: boolean, error?: string }}
 */
export function upgradeBuilding(state, cellIndex) {
  const cell = state.baseLayout[cellIndex];
  if (!cell) return { success: false, error: 'No building here' };

  const bDef = BUILDINGS[cell.buildingId];
  if (cell.level >= bDef.maxLevel) return { success: false, error: 'Already at maximum level' };

  const cost = bDef.cost[cell.level]; // cost[1] for L2, cost[2] for L3
  if (!canAfford(state.resources, cost)) return { success: false, error: 'Insufficient resources' };

  deductCost(state.resources, cost);
  cell.level += 1;
  cell.hp    = bDef.hp[cell.level - 1];
  cell.maxHp = bDef.hp[cell.level - 1];

  return { success: true };
}

/**
 * Demolish (delete) a building. Command Center cannot be demolished.
 * @param {Object} state
 * @param {number} cellIndex
 * @returns {{ success: boolean, error?: string }}
 */
export function demolishBuilding(state, cellIndex) {
  const cell = state.baseLayout[cellIndex];
  if (!cell) return { success: false, error: 'No building here' };
  if (cell.buildingId === 'cc') return { success: false, error: 'Cannot demolish the Command Center' };

  delete state.baseLayout[cellIndex];
  return { success: true };
}


// ════════════════════════════════════════════════════════════════════════════
// Unit Training
// ════════════════════════════════════════════════════════════════════════════

/**
 * Train one unit of the given type. Requires a Barracks.
 * @param {Object} state
 * @param {string} unitId
 * @returns {{ success: boolean, error?: string }}
 */
export function trainUnit(state, unitId) {
  const hasBarracks = Object.values(state.baseLayout).some(c => c.buildingId === 'barracks');
  if (!hasBarracks) return { success: false, error: 'Requires a Barracks to train units' };

  const uDef = UNITS[unitId];
  if (!uDef) return { success: false, error: 'Unknown unit type' };

  if (!canAfford(state.resources, uDef.cost)) return { success: false, error: 'Insufficient resources' };

  deductCost(state.resources, uDef.cost);
  state.units[unitId] = (state.units[unitId] || 0) + 1;
  return { success: true };
}


// ════════════════════════════════════════════════════════════════════════════
// Battle Simulation
// ════════════════════════════════════════════════════════════════════════════

/**
 * Initialise a battle state from deployed units and the defender's layout.
 * Units are spawned at evenly-distributed positions around the grid perimeter.
 *
 * @param {{ drone: number, robot: number, ranger: number }} deployedUnits
 * @param {Object} defenderLayout  — baseLayout from Firestore
 * @returns {Object} — BattleState
 */
export function initBattle(deployedUnits, defenderLayout) {
  // ── Build defender buildings ─────────────────────────────────────────────
  const buildings = [];
  Object.entries(defenderLayout).forEach(([idx, cell]) => {
    const cidx = parseInt(idx, 10);
    const row  = Math.floor(cidx / GRID_SIZE);
    const col  = cidx % GRID_SIZE;
    const bDef = BUILDINGS[cell.buildingId];
    if (!bDef) return;

    buildings.push({
      id:          cidx,
      buildingId:  cell.buildingId,
      level:       cell.level,
      row, col,
      // Canvas pixel centres:
      x: col * CELL_PX + CELL_PX / 2,
      y: row * CELL_PX + CELL_PX / 2,
      hp:    bDef.hp[cell.level - 1],
      maxHp: bDef.hp[cell.level - 1],
      alive: true,
      isTurret:     cell.buildingId === 'turret',
      lastFireTime: 0,
    });
  });

  // ── Spawn units around the perimeter ────────────────────────────────────
  const totalUnits   = Object.values(deployedUnits).reduce((s, n) => s + n, 0);
  const spawnPoints  = buildSpawnPoints(Math.max(totalUnits, 12));

  const units = [];
  let uid = 0;
  let spawnIdx = 0;

  Object.entries(deployedUnits).forEach(([unitType, count]) => {
    const uDef = UNITS[unitType];
    for (let i = 0; i < count; i++) {
      const sp = spawnPoints[spawnIdx % spawnPoints.length];
      spawnIdx++;

      units.push({
        id:            uid++,
        unitType,
        x:             sp.x,
        y:             sp.y,
        hp:            uDef.hp,
        maxHp:         uDef.hp,
        dps:           uDef.dps,
        speed:         uDef.speed * CELL_PX * 0.4, // pixels per tick-second
        rangePx:       uDef.range * CELL_PX,
        alive:         true,
        targetBldId:   null,
        lastAttackTime: 0,
        preferBuilding: uDef.preferBuilding,
      });
    }
  });

  return {
    buildings,
    units,
    projectiles: [],
    log:         [],
    tick:        0,
    done:        false,
    victory:     false,
  };
}

/** Generate GRID_SIZE * CELL_PX wide spawn positions on all four edges. */
function buildSpawnPoints(count) {
  const pts = [];
  const W   = GRID_SIZE * CELL_PX;
  const m   = CELL_PX * 0.3; // inset margin so units start just inside

  for (let i = 0; i < count; i++) {
    const t   = i / count;
    const per = t * 4;        // 0–1 = top, 1–2 = right, 2–3 = bottom, 3–4 = left

    let x, y;
    if (per < 1) {
      x = per * W;       y = m;
    } else if (per < 2) {
      x = W - m;         y = (per - 1) * W;
    } else if (per < 3) {
      x = W - (per - 2) * W; y = W - m;
    } else {
      x = m;             y = W - (per - 3) * W;
    }
    pts.push({ x: Math.max(m, Math.min(W - m, x)), y: Math.max(m, Math.min(W - m, y)) });
  }
  return pts;
}

/**
 * Advance the battle simulation by dt seconds.
 * Mutates battleState in place.
 *
 * @param {Object} bs           — BattleState from initBattle
 * @param {number} dt           — elapsed seconds since last tick (capped to 0.1)
 * @param {number} nowMs        — current timestamp (ms) for fire-rate gating
 */
export function stepBattle(bs, dt, nowMs) {
  if (bs.done) return;

  const aliveBuildings = bs.buildings.filter(b => b.alive);
  const aliveUnits     = bs.units.filter(u => u.alive);

  // ── Check end conditions ──────────────────────────────────────────────
  if (aliveUnits.length === 0) {
    bs.done    = true;
    bs.victory = false;
    bs.log.push('💀 All units destroyed — DEFEAT.');
    return;
  }
  if (aliveBuildings.length === 0) {
    bs.done    = true;
    bs.victory = true;
    bs.log.push('🏆 All enemy structures destroyed — VICTORY!');
    return;
  }

  // ── Move & attack: units ──────────────────────────────────────────────
  aliveUnits.forEach(unit => {
    // Re-acquire target if needed
    let target = aliveBuildings.find(b => b.id === unit.targetBldId && b.alive);
    if (!target) {
      target            = findBestTarget(unit, aliveBuildings);
      unit.targetBldId  = target?.id ?? null;
    }
    if (!target) return;

    const dist = Math.hypot(target.x - unit.x, target.y - unit.y);

    if (dist <= unit.rangePx) {
      // Attack cooldown ~0.8 s
      if (nowMs - unit.lastAttackTime >= 800) {
        const dmg = unit.dps * 0.8;
        target.hp -= dmg;
        unit.lastAttackTime = nowMs;

        bs.projectiles.push({ x: unit.x, y: unit.y, tx: target.x, ty: target.y, life: 1, color: UNITS[unit.unitType].color });

        if (target.hp <= 0) {
          target.alive     = false;
          unit.targetBldId = null;
          bs.log.push(`🔥 ${BUILDINGS[target.buildingId].name} destroyed!`);
        }
      }
    } else {
      // Move toward target
      const angle = Math.atan2(target.y - unit.y, target.x - unit.x);
      unit.x += Math.cos(angle) * unit.speed * dt;
      unit.y += Math.sin(angle) * unit.speed * dt;
    }
  });

  // ── Turrets fire ──────────────────────────────────────────────────────
  aliveBuildings.filter(b => b.isTurret && b.alive).forEach(turret => {
    const bDef    = BUILDINGS.turret;
    const lvl     = turret.level - 1;
    const rangePx = bDef.range[lvl] * CELL_PX;
    const rate    = bDef.fireRate[lvl];
    const dps     = bDef.dps[lvl];

    if (nowMs - turret.lastFireTime < rate) return;

    // Find nearest unit in range
    let nearest = null, nearDist = Infinity;
    aliveUnits.forEach(unit => {
      const d = Math.hypot(unit.x - turret.x, unit.y - turret.y);
      if (d <= rangePx && d < nearDist) { nearDist = d; nearest = unit; }
    });

    if (!nearest) return;

    const dmg = dps * (rate / 1000);
    nearest.hp -= dmg;
    turret.lastFireTime = nowMs;

    bs.projectiles.push({ x: turret.x, y: turret.y, tx: nearest.x, ty: nearest.y, life: 1, color: '#ff1744' });

    if (nearest.hp <= 0) {
      nearest.alive = false;
      bs.log.push(`⚡ ${UNITS[nearest.unitType].name} eliminated by turret!`);
    }
  });

  // ── Age projectiles ───────────────────────────────────────────────────
  bs.projectiles = bs.projectiles.filter(p => { p.life -= dt * 3; return p.life > 0; });

  bs.tick++;
}

/** Pick the best target for a unit considering its preference list. */
function findBestTarget(unit, aliveBuildings) {
  let best = null, bestScore = Infinity;
  aliveBuildings.forEach(b => {
    const dist    = Math.hypot(b.x - unit.x, b.y - unit.y);
    const priority = unit.preferBuilding.includes(b.buildingId) ? 0.65 : 1.0;
    const score   = dist * priority;
    if (score < bestScore) { bestScore = score; best = b; }
  });
  return best;
}

/**
 * Calculate loot earned from a battle.
 * Loot = 50% of defender's resources on victory, or proportional on partial destruction.
 *
 * @param {{ minerals: number, energy: number, oxygen: number }} defenderResources
 * @param {Object} bs — final BattleState
 * @returns {{ minerals: number, energy: number, oxygen: number }}
 */
export function calculateLoot(defenderResources, bs) {
  const destroyed  = bs.buildings.filter(b => !b.alive).length;
  const total      = bs.buildings.length;
  const pct        = bs.victory
    ? 0.50
    : Math.min(0.50, total > 0 ? (destroyed / total) * 0.55 : 0);

  return {
    minerals: Math.floor((defenderResources.minerals || 0) * pct),
    energy:   Math.floor((defenderResources.energy   || 0) * pct),
    oxygen:   Math.floor((defenderResources.oxygen   || 0) * pct),
  };
}
