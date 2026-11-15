import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createMeasuredGrid, measuredPoint, nearestMeasuredCell, measuredEdge,
  planMeasuredRoute, planMeasuredLeg, withExclusions,
} from '../src/lib/measuredRoute.ts';

const raw = JSON.parse(readFileSync(new URL('../public/data/jezero-elevation.json', import.meta.url), 'utf8'));
const jezero = createMeasuredGrid(raw);
const fixture = (width = 5, height = 5, elevationMeters = Array(width * height).fill(-2000)) => ({
  id: 'test-dem', width, height, elevationMeters, sourcePixelSizeMeters: 10,
  sourcePixelWindow: [0, 0, width, height], sourceColumns: Array.from({ length: width }, (_, i) => i),
  sourceRows: Array.from({ length: height }, (_, i) => i), projectedBoundsMeters: [1000, 2000, 1000 + width * 10, 2000 + height * 10],
  units: 'metres', rowOrder: 'north-to-south', columnOrder: 'west-to-east', noData: null,
});

test('measured coordinates use original pixel centers and nonuniform source sample gaps', () => {
  const first = measuredPoint(jezero, { col: 0, row: 0 });
  assert.equal(first.xM, raw.projectedBoundsMeters[0] + 10);
  assert.equal(first.yM, raw.projectedBoundsMeters[3] - 10);
  assert.equal(first.zM, raw.elevationMeters[0]);
  const last = measuredPoint(jezero, { col: 95, row: 79 });
  assert.equal(last.xM, raw.projectedBoundsMeters[0] + (raw.sourceColumns[95] - raw.sourcePixelWindow[0] + 0.5) * 20);
  assert.equal(last.yM, raw.projectedBoundsMeters[3] - (raw.sourceRows[79] - raw.sourcePixelWindow[1] + 0.5) * 20);
  assert.deepEqual(jezero.sampledSpacingMeters, { min: 40, max: 60 });
  assert.equal(measuredPoint(jezero, { col: 9, row: 0 }).xM - measuredPoint(jezero, { col: 8, row: 0 }).xM, 40);
  assert.deepEqual(nearestMeasuredCell(jezero, first.xM, first.yM), { col: 0, row: 0 });
  assert.equal(nearestMeasuredCell(jezero, first.xM - 1, first.yM), null);
});

test('flat ground has known distance and time, and closure is automatic', () => {
  const grid = createMeasuredGrid(fixture());
  const route = planMeasuredRoute(grid, [{ col: 0, row: 0 }, { col: 3, row: 4, dwellMinutes: 10 }], { mode: 'shortest', speedKmh: 3 });
  const expectedDistance = 2 * (3 * Math.hypot(10, 10) + 10);
  assert.equal(route.status, 'ready');
  assert.equal(route.legs.length, 2);
  assert.equal(route.legs[1].isReturn, true);
  assert.deepEqual(route.path[0], route.path.at(-1));
  assert(Math.abs(route.surfaceDistanceM - expectedDistance) < 1e-8);
  assert.equal(route.horizontalDistanceM, route.surfaceDistanceM);
  assert.equal(route.ascentM, 0);
  assert.equal(route.descentM, 0);
  assert.equal(route.dwellMinutes, 10);
  assert(Math.abs(route.walkingMinutes - expectedDistance / 3000 * 60) < 1e-8);
  assert.equal(route.totalMinutes, route.walkingMinutes + 10);
});

test('preclosed itineraries do not append another home leg or home dwell', () => {
  const grid = createMeasuredGrid(fixture());
  const a = { col: 0, row: 0, dwellMinutes: 100 }, b = { col: 4, row: 4, dwellMinutes: 8 };
  const automatic = planMeasuredRoute(grid, [a, b]);
  const explicit = planMeasuredRoute(grid, [a, b, a]);
  assert.equal(explicit.legs.length, 2);
  assert.equal(explicit.dwellMinutes, 8);
  assert.deepEqual(explicit.path, automatic.path);
});

test('missing samples and steep corners cannot be crossed diagonally', () => {
  for (const elevations of [[0, null, null, 0], [0, 100, 100, 0]]) {
    const grid = createMeasuredGrid(fixture(2, 2, elevations));
    const route = planMeasuredRoute(grid, [{ col: 0, row: 0 }, { col: 1, row: 1 }], { maxSlopeDegrees: 10 });
    assert.equal(route.status, 'no-path');
    assert.equal(route.feasible, false);
    assert.deepEqual(route.path, []);
  }
});

test('reported exclusions reroute while preserving the underlying height and preventing diagonal shortcuts', () => {
  const grid = createMeasuredGrid(fixture());
  const blocked = { col: 2, row: 2 };
  const origin = { col: 0, row: 0 };
  const end = { col: 4, row: 4 };
  const marked = withExclusions(grid, [blocked]);
  const original = planMeasuredLeg(grid, origin, end);
  const detour = planMeasuredLeg(marked, origin, end, { mode: 'fastest' });
  assert(original.path.some(point => point.col === blocked.col && point.row === blocked.row));
  assert.equal(detour.status, 'ready');
  assert(detour.surfaceDistanceM > original.surfaceDistanceM);
  assert(!detour.path.some(point => point.col === blocked.col && point.row === blocked.row));
  assert.equal(measuredPoint(marked, blocked).zM, measuredPoint(grid, blocked).zM);
  assert.equal(planMeasuredLeg(marked, blocked, end).status, 'invalid-input');
  assert.match(planMeasuredRoute(marked, [origin, blocked]).warnings[0], /reported exclusion/);
  const corner = withExclusions(createMeasuredGrid(fixture(2, 2)), [{ col: 1, row: 0 }, { col: 0, row: 1 }]);
  assert.equal(planMeasuredLeg(corner, origin, { col: 1, row: 1 }).status, 'no-path');
});

test('NoData sentinels, NaN and infinity are unavailable rather than zero elevation', () => {
  const dem = fixture(3, 2, [0, -9999, NaN, 0, Infinity, 0]);
  dem.noData = -9999;
  const grid = createMeasuredGrid(dem);
  for (const cell of [{ col: 1, row: 0 }, { col: 2, row: 0 }, { col: 1, row: 1 }]) assert.equal(measuredPoint(grid, cell), null);
  const missingStop = planMeasuredRoute(grid, [{ col: 0, row: 0 }, { col: 1, row: 0 }]);
  assert.equal(missingStop.status, 'invalid-input');
  assert.match(missingStop.warnings[0], /no measured elevation/);
});

test('closed measured routes retain exact source heights and comply with grade limits', () => {
  const stops = [{ col: 75, row: 62 }, { col: 34, row: 35, dwellMinutes: 20 }, { col: 52, row: 20, dwellMinutes: 15 }];
  for (const mode of ['shortest', 'balanced', 'gentlest']) {
    const route = planMeasuredRoute(jezero, stops, { mode, maxSlopeDegrees: 10, evaMinutes: 600 });
    assert.equal(route.status, 'ready', route.warnings[0]);
    assert.deepEqual(route.path[0], route.path.at(-1));
    for (let i = 0; i < route.path.length; i++) {
      const point = route.path[i];
      assert.equal(point.zM, raw.elevationMeters[point.row * raw.width + point.col]);
      if (i > 0) assert(measuredEdge(route.path[i - 1], point).slopeDegrees <= 10 + 1e-8);
    }
    assert(Math.abs(route.ascentM - route.descentM) < 1e-8);
    assert(Math.abs(route.surfaceDistanceM - route.legs.reduce((sum, leg) => sum + leg.surfaceDistanceM, 0)) < 1e-8);
    assert(Math.abs(route.totalMinutes - route.legs.reduce((sum, leg) => sum + leg.totalMinutes, 0)) < 1e-8);
    assert.equal(route.profile.at(-1).distanceM, route.surfaceDistanceM);
    assert.equal(route.dwellMinutes, 35);
  }
});

test('actual directional grade controls route availability, not a synthetic slope field', () => {
  const heights = [0, 10, 20, 0, 10, 20];
  const grid = createMeasuredGrid(fixture(3, 2, heights));
  const stops = [{ col: 0, row: 0 }, { col: 2, row: 0 }];
  const lowLimit = planMeasuredRoute(grid, stops, { maxSlopeDegrees: 44 });
  const highLimit = planMeasuredRoute(grid, stops, { maxSlopeDegrees: 45, mode: 'shortest' });
  assert.equal(lowLimit.status, 'no-path');
  assert.equal(highLimit.status, 'ready');
  assert.equal(highLimit.maxSlopeDegrees, 45);
  assert.equal(highLimit.ascentM, 20);
  assert.equal(highLimit.descentM, 20);
  const gentler = planMeasuredRoute(grid, stops, { maxSlopeDegrees: 45, mode: 'gentlest' });
  assert(gentler.maxSlopeDegrees < highLimit.maxSlopeDegrees);
  assert(gentler.surfaceDistanceM > highLimit.surfaceDistanceM);
});

test('single-leg turnback routes are not silently doubled', () => {
  const grid = createMeasuredGrid(fixture());
  const start = { col: 0, row: 0 }, end = { col: 4, row: 4 };
  const leg = planMeasuredLeg(grid, start, end, { mode: 'shortest' });
  const closed = planMeasuredRoute(grid, [start, end], { mode: 'shortest' });
  assert.equal(leg.status, 'ready');
  assert.equal(leg.path[0].col, 0);
  assert.equal(leg.path.at(-1).col, 4);
  assert(Math.abs(leg.surfaceDistanceM * 2 - closed.surfaceDistanceM) < 1e-8);
  const alreadyHome = planMeasuredLeg(grid, start, start);
  assert.equal(alreadyHome.surfaceDistanceM, 0);
  assert.equal(alreadyHome.status, 'ready');
});

test('time budgets include all legs, dwell, and explicit reserve', () => {
  const stops = [{ col: 75, row: 62 }, { col: 34, row: 35, dwellMinutes: 20 }];
  const ample = planMeasuredRoute(jezero, stops, { evaMinutes: 600 });
  const tight = planMeasuredRoute(jezero, stops, { evaMinutes: 60 });
  assert.equal(ample.feasible, true);
  assert.equal(tight.status, 'over-budget');
  assert(tight.path.length > 0);
  assert.equal(tight.requiredReserveMinutes, 12);
  assert.equal(tight.reserveMinutes, 60 - tight.totalMinutes);
  const slow = planMeasuredRoute(jezero, stops, { speedKmh: 1.5 });
  assert(Math.abs(slow.walkingMinutes - ample.walkingMinutes * 2) < 1e-8);
  assert.equal(slow.dwellMinutes, ample.dwellMinutes);
});

test('registration errors and invalid route inputs fail explicitly', () => {
  for (const change of [
    d => { d.sourceColumns[1] = d.sourceColumns[0]; },
    d => { d.projectedBoundsMeters[2] += 1; },
    d => { d.sourceRows = []; },
    d => { d.elevationMeters.pop(); },
    d => { d.rowOrder = 'south-to-north'; },
    d => { d.units = 'feet'; },
  ]) {
    const dem = fixture(); change(dem);
    assert.throws(() => createMeasuredGrid(dem));
  }
  const grid = createMeasuredGrid(fixture());
  const valid = [{ col: 0, row: 0 }, { col: 4, row: 4 }];
  for (const options of [{ maxSlopeDegrees: NaN }, { speedKmh: 0 }, { reservePercent: 100 }, { evaMinutes: -10 }, { mode: 'fake' }]) {
    assert.equal(planMeasuredRoute(grid, valid, options).status, 'invalid-input');
  }
  for (const stops of [[], [valid[0]], [valid[0], valid[0]], [valid[0], { col: 5, row: 0 }], [valid[0], { col: 1.5, row: 1 }]]) {
    assert.equal(planMeasuredRoute(grid, stops).status, 'invalid-input');
  }
});
