/**
 * Offline A* routing on sampled, measured Mars DEM heights.
 *
 * XYZ here means equirectangular projected easting/northing and MOLA-tied
 * elevation, in metres. It is NOT a Mars body-fixed Cartesian position.
 * Inter-sample grades cannot resolve cliffs, rocks, or hazards below DEM support.
 */

export interface GridCell {
  col: number;
  row: number;
}
export interface MeasuredStop extends GridCell {
  label?: string;
  dwellMinutes?: number;
}
export interface MeasuredPoint extends GridCell {
  index: number;
  xM: number;
  yM: number;
  zM: number;
}
export type MeasuredMode = 'shortest' | 'balanced' | 'gentlest' | 'fastest';

export interface MeasuredDem {
  id?: string;
  width: number;
  height: number;
  elevationMeters: readonly (number | null)[];
  sourcePixelSizeMeters: number;
  sourcePixelWindow: readonly number[];
  sourceColumns: readonly number[];
  sourceRows: readonly number[];
  projectedBoundsMeters: readonly number[];
  noData?: number | null;
  rowOrder?: string;
  columnOrder?: string;
  units?: string;
}

export interface MeasuredGrid {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly xMeters: readonly number[];
  readonly yMeters: readonly number[];
  readonly elevations: readonly (number | null)[];
  readonly excludedIndices?: ReadonlySet<number>;
  readonly sourcePixelSizeMeters: number;
  readonly sampledSpacingMeters: { readonly min: number; readonly max: number };
  readonly coordinateFrame: 'Mars equirectangular projected XY; MOLA-tied elevation Z';
}

export interface MeasuredRouteOptions {
  maxSlopeDegrees: number;
  speedKmh: number;
  evaMinutes: number;
  reservePercent: number;
  mode: MeasuredMode;
}

export const measuredDefaults: Readonly<MeasuredRouteOptions> = Object.freeze({
  maxSlopeDegrees: 18,
  speedKmh: 3,
  evaMinutes: 360,
  reservePercent: 20,
  mode: 'balanced',
});

export interface MeasuredMetrics {
  /** Map-projected horizontal polyline distance, not great-circle distance. */
  horizontalDistanceM: number;
  /** Piecewise 3-D polyline distance using measured sample heights. */
  surfaceDistanceM: number;
  distanceKm: number;
  ascentM: number;
  descentM: number;
  maxSlopeDegrees: number;
  walkingMinutes: number;
  dwellMinutes: number;
  totalMinutes: number;
}

export interface MeasuredLeg extends MeasuredMetrics {
  index: number;
  from: MeasuredPoint;
  to: MeasuredPoint;
  fromLabel: string;
  toLabel: string;
  isReturn: boolean;
  path: MeasuredPoint[];
}

export interface MeasuredProfilePoint extends MeasuredPoint {
  distanceM: number;
  horizontalDistanceM: number;
  /** Absolute incoming inter-sample grade; zero at departure. */
  slopeDegrees: number;
}

export interface MeasuredRouteResult extends MeasuredMetrics {
  path: MeasuredPoint[];
  legs: MeasuredLeg[];
  profile: MeasuredProfilePoint[];
  feasible: boolean;
  status: 'ready' | 'over-budget' | 'no-path' | 'invalid-input';
  closedLoop: true;
  reserveMinutes: number;
  requiredReserveMinutes: number;
  warnings: string[];
  failedLegIndex?: number;
  model: 'measured-ctx-dem-v1';
  dataId: string;
  options: MeasuredRouteOptions;
  coordinateFrame: MeasuredGrid['coordinateFrame'];
}

export interface MeasuredLegResult extends MeasuredMetrics {
  path: MeasuredPoint[];
  feasible: boolean;
  status: MeasuredRouteResult['status'];
  reserveMinutes: number;
  requiredReserveMinutes: number;
  warnings: string[];
  model: 'measured-ctx-dem-v1';
  dataId: string;
  options: MeasuredRouteOptions;
  coordinateFrame: MeasuredGrid['coordinateFrame'];
}

const DEG = 180 / Math.PI;
const DIRECTIONS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;
const FRAME = 'Mars equirectangular projected XY; MOLA-tied elevation Z' as const;
const LIMITATION =
  'Regional DEM samples do not resolve small rocks, cliffs between samples, or footing hazards. A computed route is not a navigation clearance.';

/** Validate the exact source-pixel registration; nominal output spacing is never used. */
export function createMeasuredGrid(dem: MeasuredDem): MeasuredGrid {
  if (
    !dem ||
    !Number.isInteger(dem.width) ||
    !Number.isInteger(dem.height) ||
    dem.width < 2 ||
    dem.height < 2 ||
    dem.width * dem.height > 262144
  ) {
    throw new Error('DEM dimensions must be integers of at least 2, with at most 262,144 samples.');
  }
  const {
    width,
    height,
    sourcePixelSizeMeters: pixel,
    sourcePixelWindow: window,
    projectedBoundsMeters: bounds,
  } = dem;
  if (
    !Number.isFinite(pixel) ||
    pixel <= 0 ||
    !Array.isArray(window) ||
    window.length !== 4 ||
    !window.every(Number.isInteger) ||
    window[0] < 0 ||
    window[1] < 0 ||
    window[2] <= window[0] ||
    window[3] <= window[1] ||
    !Array.isArray(bounds) ||
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite) ||
    bounds[2] <= bounds[0] ||
    bounds[3] <= bounds[1]
  ) {
    throw new Error('DEM needs valid projected bounds, source pixel size, and source window.');
  }
  if (
    Math.abs((window[2] - window[0]) * pixel - (bounds[2] - bounds[0])) > 0.01 ||
    Math.abs((window[3] - window[1]) * pixel - (bounds[3] - bounds[1])) > 0.01
  ) {
    throw new Error('DEM source window and projected bounds disagree.');
  }
  if (
    (dem.rowOrder !== undefined && dem.rowOrder !== 'north-to-south') ||
    (dem.columnOrder !== undefined && dem.columnOrder !== 'west-to-east') ||
    (dem.units !== undefined && dem.units !== 'metres')
  ) {
    throw new Error('DEM must use metres, north-to-south rows and west-to-east columns.');
  }
  const validAxis = (values: readonly number[], length: number, lo: number, hi: number) =>
    Array.isArray(values) &&
    values.length === length &&
    values.every((v, i) => Number.isInteger(v) && v >= lo && v < hi && (i === 0 || v > values[i - 1]));
  if (
    !validAxis(dem.sourceColumns, width, window[0], window[2]) ||
    !validAxis(dem.sourceRows, height, window[1], window[3])
  ) {
    throw new Error('DEM source sample indexes must be strictly increasing and inside the source window.');
  }
  if (!Array.isArray(dem.elevationMeters) || dem.elevationMeters.length !== width * height) {
    throw new Error('DEM elevation sample count does not match its dimensions.');
  }
  const elevations = dem.elevationMeters.map((value) =>
    typeof value === 'number' && Number.isFinite(value) && value !== dem.noData ? value : null
  );
  const xMeters = dem.sourceColumns.map((col) => bounds[0] + (col - window[0] + 0.5) * pixel);
  const yMeters = dem.sourceRows.map((row) => bounds[3] - (row - window[1] + 0.5) * pixel);
  const spacing = [
    ...xMeters.slice(1).map((x, i) => x - xMeters[i]),
    ...yMeters.slice(1).map((y, i) => yMeters[i] - y),
  ];
  return Object.freeze({
    id: dem.id || 'measured-dem',
    width,
    height,
    xMeters: Object.freeze(xMeters),
    yMeters: Object.freeze(yMeters),
    elevations: Object.freeze(elevations),
    sourcePixelSizeMeters: pixel,
    sampledSpacingMeters: Object.freeze(
      spacing.reduce(
        (range, value) => ({ min: Math.min(range.min, value), max: Math.max(range.max, value) }),
        { min: Infinity, max: 0 }
      )
    ),
    coordinateFrame: FRAME,
  });
}

function validCell(grid: MeasuredGrid, cell: GridCell): boolean {
  return (
    !!cell &&
    Number.isInteger(cell.col) &&
    Number.isInteger(cell.row) &&
    cell.col >= 0 &&
    cell.col < grid.width &&
    cell.row >= 0 &&
    cell.row < grid.height
  );
}

/** Add crew-reported no-go cells without overwriting measured elevation. */
export function withExclusions(grid: MeasuredGrid, exclusions: readonly GridCell[]): MeasuredGrid {
  const excludedIndices = new Set(grid.excludedIndices);
  for (const cell of exclusions) {
    if (!validCell(grid, cell)) throw new RangeError('An exclusion is outside the DEM sample grid.');
    excludedIndices.add(cell.row * grid.width + cell.col);
  }
  return { ...grid, excludedIndices };
}

function availablePoint(grid: MeasuredGrid, cell: GridCell): MeasuredPoint | null {
  const point = measuredPoint(grid, cell);
  return point && !grid.excludedIndices?.has(point.index) ? point : null;
}

/** Returns null for out-of-range or missing samples; missing heights never become zero. */
export function measuredPoint(grid: MeasuredGrid, cell: GridCell): MeasuredPoint | null {
  if (!validCell(grid, cell)) return null;
  const index = cell.row * grid.width + cell.col;
  const zM = grid.elevations[index];
  return zM === null || !Number.isFinite(zM)
    ? null
    : {
        col: cell.col,
        row: cell.row,
        index,
        xM: grid.xMeters[cell.col],
        yM: grid.yMeters[cell.row],
        zM,
      };
}

/** Nearest sampled cell within sampled-center coverage; does not skip missing cells. */
export function nearestMeasuredCell(grid: MeasuredGrid, xM: number, yM: number): GridCell | null {
  if (
    !Number.isFinite(xM) ||
    !Number.isFinite(yM) ||
    xM < grid.xMeters[0] ||
    xM > grid.xMeters[grid.width - 1] ||
    yM > grid.yMeters[0] ||
    yM < grid.yMeters[grid.height - 1]
  )
    return null;
  const nearest = (axis: readonly number[], value: number) => {
    let best = 0;
    for (let i = 1; i < axis.length; i++)
      if (Math.abs(axis[i] - value) < Math.abs(axis[best] - value)) best = i;
    return best;
  };
  return { col: nearest(grid.xMeters, xM), row: nearest(grid.yMeters, yM) };
}

export function measuredEdge(a: MeasuredPoint, b: MeasuredPoint) {
  const horizontalDistanceM = Math.hypot(b.xM - a.xM, b.yM - a.yM);
  const heightChangeM = b.zM - a.zM;
  return {
    horizontalDistanceM,
    surfaceDistanceM: Math.hypot(horizontalDistanceM, heightChangeM),
    heightChangeM,
    slopeDegrees:
      horizontalDistanceM === 0
        ? heightChangeM === 0
          ? 0
          : 90
        : Math.atan2(Math.abs(heightChangeM), horizontalDistanceM) * DEG,
  };
}

function walkingEquivalentMeters(edge: ReturnType<typeof measuredEdge>): number {
  return edge.surfaceDistanceM * (1 + edge.slopeDegrees / 30);
}

export function measuredWalkingMinutes(a: MeasuredPoint, b: MeasuredPoint, speedKmh: number): number {
  return (walkingEquivalentMeters(measuredEdge(a, b)) * 60) / (speedKmh * 1000);
}

interface QueueItem {
  index: number;
  cost: number;
  score: number;
  order: number;
}
class Queue {
  private list: QueueItem[] = [];
  get size() {
    return this.list.length;
  }
  private before(a: QueueItem, b: QueueItem) {
    return a.score < b.score || (a.score === b.score && a.order < b.order);
  }
  push(value: QueueItem) {
    this.list.push(value);
    let i = this.list.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.before(this.list[i], this.list[p])) break;
      [this.list[i], this.list[p]] = [this.list[p], this.list[i]];
      i = p;
    }
  }
  pop(): QueueItem {
    const first = this.list[0],
      last = this.list.pop()!;
    if (this.list.length) {
      this.list[0] = last;
      let i = 0;
      while (true) {
        const l = 2 * i + 1,
          r = l + 1;
        let k = i;
        if (l < this.list.length && this.before(this.list[l], this.list[k])) k = l;
        if (r < this.list.length && this.before(this.list[r], this.list[k])) k = r;
        if (k === i) break;
        [this.list[i], this.list[k]] = [this.list[k], this.list[i]];
        i = k;
      }
    }
    return first;
  }
}

function findLeg(
  grid: MeasuredGrid,
  start: MeasuredPoint,
  end: MeasuredPoint,
  options: MeasuredRouteOptions
): MeasuredPoint[] | null {
  if (start.index === end.index) return [start];
  const n = grid.width * grid.height;
  const costs = new Float64Array(n).fill(Infinity);
  const parents = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const queue = new Queue();
  const point = (index: number) =>
    availablePoint(grid, { col: index % grid.width, row: Math.floor(index / grid.width) });
  const allowed = (a: MeasuredPoint, b: MeasuredPoint) =>
    measuredEdge(a, b).slopeDegrees <= options.maxSlopeDegrees + 1e-10;
  costs[start.index] = 0;
  let order = 0;
  queue.push({
    index: start.index,
    cost: 0,
    score: measuredEdge(start, end).surfaceDistanceM,
    order: order++,
  });
  while (queue.size) {
    const current = queue.pop();
    if (closed[current.index] || current.cost > costs[current.index]) continue;
    if (current.index === end.index) {
      const path: MeasuredPoint[] = [];
      for (let i = end.index; i !== -1; i = parents[i]) path.push(point(i)!);
      return path.reverse();
    }
    closed[current.index] = 1;
    const a = point(current.index)!;
    for (const [dc, dr] of DIRECTIONS) {
      const b = availablePoint(grid, { col: a.col + dc, row: a.row + dr });
      if (!b || closed[b.index] || !allowed(a, b)) continue;
      if (dc !== 0 && dr !== 0) {
        const sideA = availablePoint(grid, { col: a.col + dc, row: a.row });
        const sideB = availablePoint(grid, { col: a.col, row: a.row + dr });
        // Both sides of a diagonal must be present and connected under the same
        // grade limit. A diagonal cannot cut across a missing/steep corner.
        if (
          !sideA ||
          !sideB ||
          !allowed(a, sideA) ||
          !allowed(sideA, b) ||
          !allowed(a, sideB) ||
          !allowed(sideB, b)
        )
          continue;
      }
      const edge = measuredEdge(a, b);
      const penalty = options.mode === 'shortest' ? 0 : options.mode === 'gentlest' ? 12 : 2;
      const edgeCost =
        options.mode === 'fastest'
          ? walkingEquivalentMeters(edge)
          : edge.surfaceDistanceM *
            (1 + penalty * (edge.slopeDegrees / Math.max(1, options.maxSlopeDegrees)) ** 2);
      const cost = current.cost + edgeCost;
      if (cost + 1e-9 >= costs[b.index]) continue;
      costs[b.index] = cost;
      parents[b.index] = current.index;
      queue.push({
        index: b.index,
        cost,
        score: cost + measuredEdge(b, end).surfaceDistanceM,
        order: order++,
      });
    }
  }
  return null;
}

function metrics(path: readonly MeasuredPoint[], speedKmh: number, dwellMinutes: number): MeasuredMetrics {
  let horizontalDistanceM = 0,
    surfaceDistanceM = 0,
    ascentM = 0,
    descentM = 0,
    maxSlopeDegrees = 0,
    walkingMinutes = 0;
  for (let i = 1; i < path.length; i++) {
    const edge = measuredEdge(path[i - 1], path[i]);
    horizontalDistanceM += edge.horizontalDistanceM;
    surfaceDistanceM += edge.surfaceDistanceM;
    ascentM += Math.max(0, edge.heightChangeM);
    descentM += Math.max(0, -edge.heightChangeM);
    maxSlopeDegrees = Math.max(maxSlopeDegrees, edge.slopeDegrees);
    // Explicit planning assumption: both uphill and downhill grades slow travel.
    // This is not a validated astronaut/suit physiological model.
    walkingMinutes += (walkingEquivalentMeters(edge) * 60) / (speedKmh * 1000);
  }
  return {
    horizontalDistanceM,
    surfaceDistanceM,
    distanceKm: surfaceDistanceM / 1000,
    ascentM,
    descentM,
    maxSlopeDegrees,
    walkingMinutes,
    dwellMinutes,
    totalMinutes: walkingMinutes + dwellMinutes,
  };
}

function invalidOptions(o: MeasuredRouteOptions): string | null {
  if (!Number.isFinite(o.maxSlopeDegrees) || o.maxSlopeDegrees < 0 || o.maxSlopeDegrees > 45)
    return 'Directional grade limit must be between 0° and 45°.';
  if (!Number.isFinite(o.speedKmh) || o.speedKmh <= 0 || o.speedKmh > 10)
    return 'Assumed speed must be greater than 0 and at most 10 km/h.';
  if (!Number.isFinite(o.evaMinutes) || o.evaMinutes <= 0 || o.evaMinutes > 1440)
    return 'EVA time must be greater than 0 and at most 1,440 minutes.';
  if (!Number.isFinite(o.reservePercent) || o.reservePercent < 0 || o.reservePercent >= 100)
    return 'Return reserve must be between 0% and less than 100%.';
  if (!['shortest', 'balanced', 'gentlest', 'fastest'].includes(o.mode))
    return 'Unknown measured-terrain route strategy.';
  return null;
}

/** Single directed leg for turnback analysis. No return is appended. */
export function planMeasuredLeg(
  grid: MeasuredGrid,
  start: GridCell,
  end: GridCell,
  overrides: Partial<MeasuredRouteOptions> = {}
): MeasuredLegResult {
  const options: MeasuredRouteOptions = { ...measuredDefaults, ...overrides };
  const base = { model: 'measured-ctx-dem-v1' as const, dataId: grid.id, options, coordinateFrame: FRAME };
  const invalid = invalidOptions(options);
  const a = availablePoint(grid, start),
    b = availablePoint(grid, end);
  if (invalid || !a || !b)
    return {
      ...base,
      ...metrics([], 1, 0),
      path: [],
      feasible: false,
      status: 'invalid-input',
      reserveMinutes: 0,
      requiredReserveMinutes: 0,
      warnings: [
        invalid || 'Both endpoints must have measured elevation and be outside reported exclusions.',
        LIMITATION,
      ],
    };
  const path = findLeg(grid, a, b, options);
  if (!path)
    return {
      ...base,
      ...metrics([], 1, 0),
      path: [],
      feasible: false,
      status: 'no-path',
      reserveMinutes: options.evaMinutes,
      requiredReserveMinutes: (options.evaMinutes * options.reservePercent) / 100,
      warnings: ['No single-leg path satisfies grade, missing-data and exclusion constraints.', LIMITATION],
    };
  const total = metrics(path, options.speedKmh, 0);
  const reserveMinutes = options.evaMinutes - total.totalMinutes;
  const requiredReserveMinutes = (options.evaMinutes * options.reservePercent) / 100;
  const feasible = reserveMinutes + 1e-9 >= requiredReserveMinutes;
  return {
    ...base,
    ...total,
    path,
    feasible,
    status: feasible ? 'ready' : 'over-budget',
    reserveMinutes,
    requiredReserveMinutes,
    warnings: [
      ...(!feasible ? ['Single-leg travel exceeds the available time after the requested reserve.'] : []),
      LIMITATION,
    ],
  };
}

/** Always appends a return leg unless the last stop is already the origin. */
export function planMeasuredRoute(
  grid: MeasuredGrid,
  stops: readonly MeasuredStop[],
  overrides: Partial<MeasuredRouteOptions> = {}
): MeasuredRouteResult {
  const options: MeasuredRouteOptions = { ...measuredDefaults, ...overrides };
  const failure = (
    message: string,
    status: MeasuredRouteResult['status'] = 'invalid-input',
    failedLegIndex?: number
  ): MeasuredRouteResult => ({
    ...metrics([], 1, 0),
    path: [],
    legs: [],
    profile: [],
    feasible: false,
    status,
    closedLoop: true,
    reserveMinutes: Number.isFinite(options.evaMinutes) ? options.evaMinutes : 0,
    requiredReserveMinutes: Number.isFinite(options.evaMinutes * options.reservePercent)
      ? (options.evaMinutes * options.reservePercent) / 100
      : 0,
    warnings: [message, LIMITATION],
    failedLegIndex,
    model: 'measured-ctx-dem-v1',
    dataId: grid.id,
    options,
    coordinateFrame: FRAME,
  });
  const invalid = invalidOptions(options);
  if (invalid) return failure(invalid);
  if (!Array.isArray(stops) || stops.length < 2 || stops.length > 50)
    return failure('Choose between 2 and 50 measured-terrain stops, starting at your return point.');
  const requested: { point: MeasuredPoint; label: string; dwellMinutes: number }[] = [];
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    if (!validCell(grid, stop)) return failure(`Stop ${i + 1} is outside the DEM sample grid.`);
    const p = measuredPoint(grid, stop);
    if (!p) return failure(`Stop ${i + 1} has no measured elevation. Choose a valid DEM sample.`);
    if (grid.excludedIndices?.has(p.index))
      return failure(`Stop ${i + 1} is in a reported exclusion. Choose a different cell.`);
    if (stop.label !== undefined && (typeof stop.label !== 'string' || stop.label.length > 128))
      return failure(`Stop ${i + 1} has an invalid label.`);
    if (
      stop.dwellMinutes !== undefined &&
      (!Number.isFinite(stop.dwellMinutes) || stop.dwellMinutes < 0 || stop.dwellMinutes > 1440)
    )
      return failure(`Stop ${i + 1} has an invalid dwell time.`);
    requested.push({ point: p, label: stop.label || `Stop ${i + 1}`, dwellMinutes: stop.dwellMinutes ?? 0 });
  }
  if (requested.every((s) => s.point.index === requested[0].point.index))
    return failure('Choose a destination distinct from the return point.');
  if (requested.at(-1)!.point.index !== requested[0].point.index)
    requested.push({ ...requested[0], dwellMinutes: 0 });
  const legs: MeasuredLeg[] = [];
  const path: MeasuredPoint[] = [];
  for (let i = 1; i < requested.length; i++) {
    const a = requested[i - 1],
      b = requested[i];
    const legPath = findLeg(grid, a.point, b.point, options);
    if (!legPath)
      return failure(
        `No path from ${a.label} to ${b.label} satisfies grade, missing-data and exclusion constraints.`,
        'no-path',
        i - 1
      );
    const isReturn = i === requested.length - 1;
    const dwell = isReturn ? 0 : b.dwellMinutes;
    legs.push({
      ...metrics(legPath, options.speedKmh, dwell),
      index: i - 1,
      from: a.point,
      to: b.point,
      fromLabel: a.label,
      toLabel: b.label,
      isReturn,
      path: legPath,
    });
    path.push(...(path.length ? legPath.slice(1) : legPath));
  }
  const total = metrics(
    path,
    options.speedKmh,
    legs.reduce((sum, leg) => sum + leg.dwellMinutes, 0)
  );
  const requiredReserveMinutes = (options.evaMinutes * options.reservePercent) / 100;
  const reserveMinutes = options.evaMinutes - total.totalMinutes;
  const feasible = reserveMinutes + 1e-9 >= requiredReserveMinutes;
  const warnings = [
    LIMITATION,
    'Walking time uses an assumed speed and grade penalty; no suit, atmosphere, radiation, or ground hazard model is inferred from elevation.',
  ];
  if (!feasible)
    warnings.unshift(
      `Closed-loop plan exceeds the usable EVA budget by ${Math.ceil(requiredReserveMinutes - reserveMinutes)} minutes, including the requested return reserve.`
    );
  let distanceM = 0,
    horizontalDistanceM = 0;
  const profile = path.map((p, i) => {
    const edge = i === 0 ? null : measuredEdge(path[i - 1], p);
    distanceM += edge?.surfaceDistanceM ?? 0;
    horizontalDistanceM += edge?.horizontalDistanceM ?? 0;
    return { ...p, distanceM, horizontalDistanceM, slopeDegrees: edge?.slopeDegrees ?? 0 };
  });
  return {
    ...total,
    path,
    legs,
    profile,
    feasible,
    status: feasible ? 'ready' : 'over-budget',
    closedLoop: true,
    reserveMinutes,
    requiredReserveMinutes,
    warnings,
    model: 'measured-ctx-dem-v1',
    dataId: grid.id,
    options,
    coordinateFrame: FRAME,
  };
}
