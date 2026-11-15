/**
 * CHITRA deterministic Marswalk scenario planner.
 *
 * Coordinates, elevation, hazards, exposure, habitat, and science-stop positions
 * are a synthetic training scenario. They are NOT a registered NASA DEM, live
 * telemetry, or a safety-qualified navigation solution. See docs/ROUTING.md.
 */

export interface Point {
  x: number;
  y: number;
}
export type RouteMode = 'balanced' | 'safest' | 'science';

export interface Constraints {
  /** Maximum modeled local terrain slope, degrees. */
  maxSlope: number;
  /** Total modeled suit/EVA time available, minutes. */
  evaMinutes: number;
  /** Fraction of EVA time reserved at arrival, percent. */
  reservePercent: number;
  /** Level-ground walking speed, km/h. */
  speedKmh: number;
  /** Scenario dose rate, mSv per hour; not current Mars radiation. */
  radiationRate: number;
}

export interface ScienceSite extends Point {
  id: string;
  name: string;
  kind: 'habitat' | 'science' | 'viewpoint';
  description: string;
  scienceValue: number;
  dwellMinutes: number;
}

export interface Hazard extends Point {
  id: string;
  name: string;
  rx: number;
  ry: number;
  kind: 'rock' | 'sand';
  blocked: boolean;
  description: string;
}

export interface TerrainSample {
  elevationM: number;
  slope: number;
  roughness: number;
  radiationFactor: number;
  blocked: boolean;
  geology: string;
}

export interface ProfileSample {
  distanceKm: number;
  elevationM: number;
  slope: number;
}

export interface RouteResult {
  path: Point[];
  distanceKm: number;
  walkingMinutes: number;
  scienceMinutes: number;
  totalMinutes: number;
  maxSlope: number;
  ascentM: number;
  radiationMsv: number;
  /** Time left on arrival, before subtracting the required reserve. */
  reserveMinutes: number;
  feasible: boolean;
  warnings: string[];
  scienceScore: number;
  profile: ProfileSample[];
  /** Named stops explicitly visited; passing nearby is not a science stop. */
  visitedSiteIds: string[];
  /** Raw optimization cost, useful for explaining mode tradeoffs. */
  cost: number;
  model: 'synthetic-scenario-v1';
}

export const WORLD = Object.freeze({
  width: 1000,
  height: 700,
  metersPerUnit: 5,
  gridStep: 10,
});

export const defaults: Constraints = Object.freeze({
  maxSlope: 18,
  evaMinutes: 360,
  reservePercent: 20,
  speedKmh: 3,
  radiationRate: 0.025,
});

export const sites: ScienceSite[] = [
  {
    id: 'habitat',
    name: 'Ares basecamp',
    x: 760,
    y: 555,
    kind: 'habitat',
    scienceValue: 0,
    dwellMinutes: 0,
    description:
      'Hypothetical crew habitat and return point. This is a scenario location, not a structure on Mars.',
  },
  {
    id: 'delta',
    name: 'Delta outcrop',
    x: 365,
    y: 300,
    kind: 'science',
    scienceValue: 35,
    dwellMinutes: 25,
    description:
      'Scenario stop inspired by Jezero’s ancient river delta. Document sedimentary layers and compare grain sizes.',
  },
  {
    id: 'overlook',
    name: 'Ridge overlook',
    x: 575,
    y: 195,
    kind: 'viewpoint',
    scienceValue: 20,
    dwellMinutes: 15,
    description: 'Hypothetical panorama station to relate local layers to the broader delta geometry.',
  },
  {
    id: 'crater',
    name: 'Crater-floor station',
    x: 735,
    y: 280,
    kind: 'science',
    scienceValue: 25,
    dwellMinutes: 20,
    description:
      'Scenario target for documenting crater-floor rock textures and comparing them with delta deposits.',
  },
  {
    id: 'minerals',
    name: 'Mineral survey',
    x: 245,
    y: 440,
    kind: 'science',
    scienceValue: 30,
    dwellMinutes: 30,
    description:
      'Hypothetical mineralogical sampling stop inspired by orbital evidence of water-altered minerals at Jezero.',
  },
];

export const DEFAULT_ROUTE_IDS = ['habitat', 'delta', 'overlook', 'habitat'];

export const hazards: Hazard[] = [
  {
    id: 'boulder-field',
    name: 'Boulder field',
    x: 520,
    y: 420,
    rx: 76,
    ry: 58,
    kind: 'rock',
    blocked: true,
    description: 'Synthetic exclusion zone. The route planner cannot traverse this ellipse.',
  },
  {
    id: 'scarp',
    name: 'Steep scarp',
    x: 440,
    y: 190,
    rx: 42,
    ry: 78,
    kind: 'rock',
    blocked: true,
    description: 'Synthetic exclusion zone representing a local scarp; not derived from imagery.',
  },
  {
    id: 'soft-sand',
    name: 'Soft-sand basin',
    x: 650,
    y: 355,
    rx: 95,
    ry: 55,
    kind: 'sand',
    blocked: false,
    description: 'Synthetic high-effort terrain. Traversable, but incurs roughness and time penalties.',
  },
  {
    id: 'southern-rocks',
    name: 'Rocky rise',
    x: 305,
    y: 575,
    rx: 55,
    ry: 40,
    kind: 'rock',
    blocked: true,
    description: 'Synthetic exclusion zone representing large blocks.',
  },
];

const MODEL = 'synthetic-scenario-v1' as const;
const DEG = 180 / Math.PI;
const COLS = WORLD.width / WORLD.gridStep + 1;
const ROWS = WORLD.height / WORLD.gridStep + 1;
const NEIGHBORS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;

function insideEllipse(p: Point, h: Hazard): boolean {
  return ((p.x - h.x) / h.rx) ** 2 + ((p.y - h.y) / h.ry) ** 2 <= 1;
}

function inBounds(p: Point): boolean {
  return (
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    p.x >= 0 &&
    p.x <= WORLD.width &&
    p.y >= 0 &&
    p.y <= WORLD.height
  );
}

/** Analytic scenario terrain; gradient is computed in meters, not pixel units. */
export function terrainAt(p: Point): TerrainSample {
  const { x, y } = p;
  const ridge = 155 * Math.exp(-(((x - 430) / 115) ** 2 + ((y - 230) / 170) ** 2));
  const hill = 85 * Math.exp(-(((x - 790) / 145) ** 2 + ((y - 120) / 90) ** 2));
  const elevationM = -2600 + 0.13 * x - 0.08 * y + 35 * Math.sin(x / 105) * Math.cos(y / 140) + ridge + hill;
  const dx =
    0.13 +
    (35 / 105) * Math.cos(x / 105) * Math.cos(y / 140) -
    (ridge * 2 * (x - 430)) / 115 ** 2 -
    (hill * 2 * (x - 790)) / 145 ** 2;
  const dy =
    -0.08 -
    (35 / 140) * Math.sin(x / 105) * Math.sin(y / 140) -
    (ridge * 2 * (y - 230)) / 170 ** 2 -
    (hill * 2 * (y - 120)) / 90 ** 2;
  const slope = Math.atan(Math.hypot(dx, dy) / WORLD.metersPerUnit) * DEG;
  const softSand = hazards.some((h) => h.kind === 'sand' && insideEllipse(p, h));
  const roughness = softSand ? 0.95 : 0.12 + (0.25 * (Math.sin(x / 63) * Math.cos(y / 51) + 1)) / 2;
  const radiationFactor = 0.88 + (0.16 * (Math.sin(x / 180) * Math.cos(y / 150) + 1)) / 2;
  return {
    elevationM,
    slope,
    roughness,
    radiationFactor,
    blocked: !inBounds(p) || hazards.some((h) => h.blocked && insideEllipse(p, h)),
    geology: x < 430 ? 'Delta-inspired deposits' : y < 280 ? 'Ridge terrain' : 'Crater-floor terrain',
  };
}

export function pointDistanceKm(a: Point, b: Point): number {
  return (Math.hypot(a.x - b.x, a.y - b.y) * WORLD.metersPerUnit) / 1000;
}

export function resolveSites(ids: readonly string[]): ScienceSite[] {
  return ids.map((id) => {
    const site = sites.find((candidate) => candidate.id === id);
    if (!site) throw new Error(`Unknown scenario site: ${id}`);
    return site;
  });
}

const gridPoints: Point[] = Array.from({ length: COLS * ROWS }, (_, index) => ({
  x: (index % COLS) * WORLD.gridStep,
  y: Math.floor(index / COLS) * WORLD.gridStep,
}));
const gridTerrain = gridPoints.map(terrainAt);

function canWalk(p: Point, limit: number): boolean {
  const t = terrainAt(p);
  return !t.blocked && t.slope <= limit + 1e-9;
}

/** Exact segment/ellipse check so a short edge cannot skip a narrow intersection. */
function intersectsExclusion(a: Point, b: Point, h: Hazard): boolean {
  const ax = (a.x - h.x) / h.rx;
  const ay = (a.y - h.y) / h.ry;
  const dx = (b.x - a.x) / h.rx;
  const dy = (b.y - a.y) / h.ry;
  const lengthSquared = dx * dx + dy * dy;
  const nearest = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  return (ax + nearest * dx) ** 2 + (ay + nearest * dy) ** 2 <= 1;
}

/** Check each short edge at 2.5-world-unit intervals, including both endpoints. */
function clearSegment(a: Point, b: Point, limit: number): boolean {
  if (hazards.some((h) => h.blocked && intersectsExclusion(a, b, h))) return false;
  const steps = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / 2.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!canWalk({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, limit)) return false;
  }
  return true;
}

interface QueueEntry {
  index: number;
  f: number;
  g: number;
  order: number;
}

/** Small binary min heap; stable insertion order makes equal-cost runs repeatable. */
class MinHeap {
  private items: QueueEntry[] = [];
  get size(): number {
    return this.items.length;
  }
  private less(a: QueueEntry, b: QueueEntry): boolean {
    return a.f < b.f || (a.f === b.f && a.order < b.order);
  }
  push(item: QueueEntry): void {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.less(this.items[index], this.items[parent])) break;
      [this.items[index], this.items[parent]] = [this.items[parent], this.items[index]];
      index = parent;
    }
  }
  pop(): QueueEntry | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last) {
      this.items[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.items.length && this.less(this.items[left], this.items[smallest])) smallest = left;
        if (right < this.items.length && this.less(this.items[right], this.items[smallest])) smallest = right;
        if (smallest === index) break;
        [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
        index = smallest;
      }
    }
    return first;
  }
}

function scienceProximity(p: Point): number {
  return Math.max(
    ...sites
      .filter((s) => s.kind !== 'habitat')
      .map((s) => (s.scienceValue / 35) * Math.exp(-((p.x - s.x) ** 2 + (p.y - s.y) ** 2) / (2 * 110 ** 2)))
  );
}

function traversalWeight(t: TerrainSample, p: Point, mode: RouteMode): number {
  if (mode === 'safest') return 1 + 10 * (t.slope / 18) ** 2 + 5 * t.roughness + 2 * t.radiationFactor;
  if (mode === 'science')
    return 1 + 1.3 * (t.slope / 18) ** 2 + 1.3 * t.roughness + 3.5 * (1 - scienceProximity(p));
  return 1 + 2.5 * (t.slope / 18) ** 2 + 2 * t.roughness;
}

/** Find a nearby traversable grid connection without moving the requested stop. */
function gridConnection(p: Point, limit: number): number | null {
  const col = Math.round(p.x / WORLD.gridStep);
  const row = Math.round(p.y / WORLD.gridStep);
  const candidates: { index: number; distance: number }[] = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const c = col + dx;
      const r = row + dy;
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
      const index = r * COLS + c;
      const t = gridTerrain[index];
      if (!t.blocked && t.slope <= limit)
        candidates.push({ index, distance: pointDistanceKm(p, gridPoints[index]) });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.index - b.index);
  for (const candidate of candidates) {
    if (clearSegment(p, gridPoints[candidate.index], limit)) return candidate.index;
  }
  return null;
}

function searchLeg(
  start: Point,
  end: Point,
  mode: RouteMode,
  limit: number
): { path: Point[]; cost: number } | null {
  if (pointDistanceKm(start, end) < 1e-9) return { path: [{ x: start.x, y: start.y }], cost: 0 };
  const startIndex = gridConnection(start, limit);
  const endIndex = gridConnection(end, limit);
  if (startIndex === null || endIndex === null) return null;
  const distances = new Float64Array(gridPoints.length).fill(Infinity);
  const previous = new Int32Array(gridPoints.length).fill(-1);
  const visited = new Uint8Array(gridPoints.length);
  const queue = new MinHeap();
  let order = 0;
  distances[startIndex] = 0;
  queue.push({
    index: startIndex,
    g: 0,
    f: pointDistanceKm(gridPoints[startIndex], gridPoints[endIndex]),
    order: order++,
  });
  while (queue.size) {
    const current = queue.pop()!;
    if (visited[current.index] || current.g > distances[current.index]) continue;
    if (current.index === endIndex) {
      const indexes: number[] = [];
      let index = endIndex;
      while (index !== -1) {
        indexes.push(index);
        index = previous[index];
      }
      indexes.reverse();
      const rawPath = [
        { x: start.x, y: start.y },
        ...indexes.map((i) => ({ ...gridPoints[i] })),
        { x: end.x, y: end.y },
      ];
      const path = rawPath.filter((point, i) => i === 0 || pointDistanceKm(point, rawPath[i - 1]) > 1e-9);
      return { path, cost: current.g };
    }
    visited[current.index] = 1;
    const currentCol = current.index % COLS;
    const currentRow = Math.floor(current.index / COLS);
    for (const [dx, dy] of NEIGHBORS) {
      const col = currentCol + dx;
      const row = currentRow + dy;
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;
      const next = row * COLS + col;
      const nextTerrain = gridTerrain[next];
      if (visited[next] || nextTerrain.blocked || nextTerrain.slope > limit) continue;
      // Diagonal motion may not squeeze between excluded or steep cells.
      if (dx !== 0 && dy !== 0) {
        const sideA = gridTerrain[currentRow * COLS + col];
        const sideB = gridTerrain[row * COLS + currentCol];
        if (sideA.blocked || sideB.blocked || sideA.slope > limit || sideB.slope > limit) continue;
      }
      const a = gridPoints[current.index];
      const b = gridPoints[next];
      if (!clearSegment(a, b, limit)) continue;
      const weight =
        (traversalWeight(gridTerrain[current.index], a, mode) + traversalWeight(nextTerrain, b, mode)) / 2;
      const tentative = current.g + pointDistanceKm(a, b) * weight;
      if (tentative + 1e-12 < distances[next]) {
        previous[next] = current.index;
        distances[next] = tentative;
        // Every traversal weight is >= 1, so straight-line distance is admissible.
        const heuristic = pointDistanceKm(b, gridPoints[endIndex]);
        queue.push({ index: next, g: tentative, f: tentative + heuristic, order: order++ });
      }
    }
  }
  return null;
}

function emptyResult(warning: string, constraints: Constraints): RouteResult {
  return {
    path: [],
    distanceKm: 0,
    walkingMinutes: 0,
    scienceMinutes: 0,
    totalMinutes: 0,
    maxSlope: 0,
    ascentM: 0,
    radiationMsv: 0,
    reserveMinutes: Number.isFinite(constraints.evaMinutes) ? constraints.evaMinutes : 0,
    feasible: false,
    warnings: [warning],
    scienceScore: 0,
    profile: [],
    visitedSiteIds: [],
    cost: 0,
    model: MODEL,
  };
}

function validateConstraints(c: Constraints): string | null {
  if (!Number.isFinite(c.maxSlope) || c.maxSlope <= 0 || c.maxSlope > 45)
    return 'Slope limit must be greater than 0° and at most 45°.';
  if (!Number.isFinite(c.evaMinutes) || c.evaMinutes < 1 || c.evaMinutes > 1440)
    return 'EVA duration must be between 1 and 1,440 minutes.';
  if (!Number.isFinite(c.reservePercent) || c.reservePercent < 0 || c.reservePercent >= 100)
    return 'Reserve must be between 0% and less than 100%.';
  if (!Number.isFinite(c.speedKmh) || c.speedKmh <= 0 || c.speedKmh > 10)
    return 'Walking speed must be greater than 0 and at most 10 km/h.';
  if (!Number.isFinite(c.radiationRate) || c.radiationRate < 0 || c.radiationRate > 100)
    return 'Scenario dose rate must be between 0 and 100 mSv/h.';
  return null;
}

/**
 * Plan the supplied ordered itinerary. Include the origin again as the last
 * point for a return journey. Never silently adds stops or a return segment.
 */
export function planRoute(
  points: readonly Point[],
  mode: RouteMode = 'balanced',
  constraints: Constraints = defaults
): RouteResult {
  const invalid = validateConstraints(constraints);
  if (invalid) return emptyResult(invalid, constraints);
  if (!['balanced', 'safest', 'science'].includes(mode))
    return emptyResult('Choose a supported route strategy.', constraints);
  if (points.length < 2) return emptyResult('Add a destination to begin planning.', constraints);
  if (points.length > 100) return emptyResult('A scenario itinerary supports up to 100 stops.', constraints);
  for (let i = 0; i < points.length; i++) {
    if (!inBounds(points[i])) return emptyResult(`Stop ${i + 1} is outside the scenario map.`, constraints);
    const terrain = terrainAt(points[i]);
    if (terrain.blocked)
      return emptyResult(
        `Stop ${i + 1} is inside an exclusion zone. Move it to traversable terrain.`,
        constraints
      );
    if (terrain.slope > constraints.maxSlope)
      return emptyResult(
        `Stop ${i + 1} exceeds the ${constraints.maxSlope}° slope limit. Choose another stop or revise the scenario limit.`,
        constraints
      );
  }
  if (points.every((point) => pointDistanceKm(point, points[0]) < 1e-9)) {
    return emptyResult('Add a destination away from the starting point.', constraints);
  }
  const path: Point[] = [];
  let cost = 0;
  for (let i = 1; i < points.length; i++) {
    const leg = searchLeg(points[i - 1], points[i], mode, constraints.maxSlope);
    if (!leg)
      return emptyResult(
        `No traversable path between stops ${i} and ${i + 1} under the current slope limit.`,
        constraints
      );
    path.push(...(path.length ? leg.path.slice(1) : leg.path));
    cost += leg.cost;
  }
  let distanceKm = 0;
  let walkingMinutes = 0;
  let ascentM = 0;
  let radiationMsv = 0;
  let maxSlope = 0;
  const profile: ProfileSample[] = [];
  for (let i = 0; i < path.length; i++) {
    const terrain = terrainAt(path[i]);
    maxSlope = Math.max(maxSlope, terrain.slope);
    if (i > 0) {
      const previousTerrain = terrainAt(path[i - 1]);
      const segmentKm = pointDistanceKm(path[i - 1], path[i]);
      const midTerrain = terrainAt({
        x: (path[i].x + path[i - 1].x) / 2,
        y: (path[i].y + path[i - 1].y) / 2,
      });
      maxSlope = Math.max(maxSlope, midTerrain.slope);
      const minutes =
        (segmentKm / constraints.speedKmh) * 60 * (1 + midTerrain.slope / 50 + midTerrain.roughness * 0.35);
      walkingMinutes += minutes;
      distanceKm += segmentKm;
      ascentM += Math.max(0, terrain.elevationM - previousTerrain.elevationM);
      radiationMsv += (minutes / 60) * constraints.radiationRate * midTerrain.radiationFactor;
    }
    profile.push({ distanceKm, elevationM: terrain.elevationM, slope: terrain.slope });
  }
  const visited = sites.filter(
    (site) =>
      site.kind !== 'habitat' &&
      points.some(
        (point) => (point as Partial<ScienceSite>).id === site.id && point.x === site.x && point.y === site.y
      )
  );
  const scienceMinutes = visited.reduce((total, site) => total + site.dwellMinutes, 0);
  for (const site of visited)
    radiationMsv += (site.dwellMinutes / 60) * constraints.radiationRate * terrainAt(site).radiationFactor;
  const totalMinutes = walkingMinutes + scienceMinutes;
  const requiredReserve = (constraints.evaMinutes * constraints.reservePercent) / 100;
  const reserveMinutes = constraints.evaMinutes - totalMinutes;
  const warnings: string[] = [];
  if (reserveMinutes < requiredReserve) {
    warnings.push(
      `Route exceeds the usable EVA budget by ${Math.ceil(requiredReserve - reserveMinutes)} min, including the ${constraints.reservePercent}% reserve.`
    );
  }
  if (pointDistanceKm(points[0], points[points.length - 1]) > 0.01) {
    warnings.push(
      'One-way itinerary: return travel is not included. Add the starting point as the final stop.'
    );
  }
  if (maxSlope > constraints.maxSlope * 0.9)
    warnings.push('Parts of this route are close to the selected slope limit.');
  return {
    path,
    distanceKm,
    walkingMinutes,
    scienceMinutes,
    totalMinutes,
    maxSlope,
    ascentM,
    radiationMsv,
    reserveMinutes,
    feasible: reserveMinutes + 1e-9 >= requiredReserve,
    warnings,
    scienceScore: Math.min(
      100,
      visited.reduce((total, site) => total + site.scienceValue, 0)
    ),
    profile,
    visitedSiteIds: visited.map((site) => site.id),
    cost,
    model: MODEL,
  };
}
