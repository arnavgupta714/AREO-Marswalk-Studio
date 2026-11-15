import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaults, sites, hazards, WORLD, DEFAULT_ROUTE_IDS,
  terrainAt, planRoute, pointDistanceKm, resolveSites,
} from '../src/lib/routeEngine.ts';

const itinerary = resolveSites(DEFAULT_ROUTE_IDS);

test('default itinerary returns to habitat with a reproducible feasible plan', () => {
  const route = planRoute(itinerary);
  assert.equal(route.feasible, true);
  assert.deepEqual(route.path[0], { x: itinerary[0].x, y: itinerary[0].y });
  assert.deepEqual(route.path.at(-1), { x: itinerary[0].x, y: itinerary[0].y });
  assert(route.distanceKm > 4 && route.distanceKm < 10);
  assert(route.totalMinutes < defaults.evaMinutes * (1 - defaults.reservePercent / 100));
  assert.equal(route.scienceMinutes, 40);
  assert.equal(route.scienceScore, 55);
  assert.deepEqual(route.visitedSiteIds, ['delta', 'overlook']);
  assert.deepEqual(route, planRoute(itinerary));
});

test('every traversed segment stays outside exclusion zones and respects the slope limit', () => {
  for (const mode of ['balanced', 'safest', 'science']) {
    const route = planRoute(itinerary, mode);
    assert(route.path.length > 2, mode);
    for (let i = 1; i < route.path.length; i++) {
      const a = route.path[i - 1];
      const b = route.path[i];
      // Analytically check the closest approach to each ellipse, rather than
      // trusting the engine's discrete checks or a sparse point sample.
      for (const h of hazards.filter(h => h.blocked)) {
        const ax = (a.x - h.x) / h.rx;
        const ay = (a.y - h.y) / h.ry;
        const dx = (b.x - a.x) / h.rx;
        const dy = (b.y - a.y) / h.ry;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
        assert((ax + t * dx) ** 2 + (ay + t * dy) ** 2 > 1, `${mode} clips ${h.name}`);
      }
      for (let j = 0; j <= 20; j++) {
        const sample = terrainAt({ x: a.x + (b.x - a.x) * j / 20, y: a.y + (b.y - a.y) * j / 20 });
        assert.equal(sample.blocked, false, `${mode} crosses a blocked area`);
        assert(sample.slope <= defaults.maxSlope + 0.01, `${mode} crosses an excessive slope`);
      }
    }
  }
});

test('route choices change the path while preserving the requested stops', () => {
  const balanced = planRoute(itinerary, 'balanced');
  const safest = planRoute(itinerary, 'safest');
  const science = planRoute(itinerary, 'science');
  assert.notDeepEqual(balanced.path, safest.path);
  assert.notDeepEqual(balanced.path, science.path);
  for (const result of [balanced, safest, science]) {
    for (const stop of itinerary) assert(result.path.some(p => pointDistanceKm(p, stop) < 1e-9));
  }
});

test('a blocked waypoint fails explicitly instead of silently moving it', () => {
  const blocked = hazards.find(h => h.blocked);
  const route = planRoute([sites[0], { x: blocked.x, y: blocked.y }, sites[0]]);
  assert.equal(route.feasible, false);
  assert.deepEqual(route.path, []);
  assert.match(route.warnings[0], /exclusion zone/);
});

test('time and reserve constraints are enforced and include science dwell', () => {
  const base = planRoute(itinerary);
  const tooShort = planRoute(itinerary, 'balanced', { ...defaults, evaMinutes: 30 });
  assert.equal(tooShort.feasible, false);
  assert.match(tooShort.warnings.join(' '), /EVA budget/);
  assert.equal(base.totalMinutes, base.walkingMinutes + base.scienceMinutes);
  assert.equal(base.reserveMinutes, defaults.evaMinutes - base.totalMinutes);
  const noReserve = planRoute(itinerary, 'balanced', { ...defaults, evaMinutes: base.totalMinutes + 1, reservePercent: 0 });
  const highReserve = planRoute(itinerary, 'balanced', { ...defaults, evaMinutes: base.totalMinutes + 1, reservePercent: 30 });
  assert.equal(noReserve.feasible, true);
  assert.equal(highReserve.feasible, false);
});

test('speed and dose rate have predictable quantitative effects', () => {
  const base = planRoute(itinerary);
  const slower = planRoute(itinerary, 'balanced', { ...defaults, speedKmh: defaults.speedKmh / 2 });
  const doubleDose = planRoute(itinerary, 'balanced', { ...defaults, radiationRate: defaults.radiationRate * 2 });
  assert(Math.abs(slower.walkingMinutes - base.walkingMinutes * 2) < 1e-8);
  assert.equal(slower.scienceMinutes, base.scienceMinutes);
  assert(Math.abs(doubleDose.radiationMsv - base.radiationMsv * 2) < 1e-8);
});

test('one-way itineraries clearly warn that return travel is missing', () => {
  const route = planRoute(itinerary.slice(0, -1));
  assert.match(route.warnings.join(' '), /One-way itinerary/);
  assert(route.distanceKm < planRoute(itinerary).distanceKm);
});

test('duplicate science stops do not double-count sample dwell or score', () => {
  const route = planRoute([sites[0], sites[1], sites[1], sites[0]]);
  assert.equal(route.scienceMinutes, sites[1].dwellMinutes);
  assert.equal(route.scienceScore, sites[1].scienceValue);
});

test('invalid and impossible requests cannot create a plausible route', () => {
  const requests = [
    planRoute([]),
    planRoute([sites[0]]),
    planRoute([sites[0], sites[0]]),
    planRoute([{ x: NaN, y: 5 }, sites[0]]),
    planRoute([{ x: -1, y: 5 }, sites[0]]),
    planRoute(itinerary, 'balanced', { ...defaults, speedKmh: 0 }),
    planRoute(itinerary, 'balanced', { ...defaults, maxSlope: 0.001 }),
    planRoute(itinerary, 'balanced', { ...defaults, reservePercent: 100 }),
    planRoute(itinerary, 'balanced', { ...defaults, radiationRate: -1 }),
  ];
  for (const route of requests) {
    assert.equal(route.feasible, false);
    assert.deepEqual(route.path, []);
    assert(route.warnings.length > 0);
  }
});

test('profile distance and coordinate scale agree with the completed route', () => {
  const route = planRoute(itinerary);
  assert.equal(pointDistanceKm({ x: 0, y: 0 }, { x: WORLD.width, y: 0 }), 5);
  assert.equal(route.profile[0].distanceKm, 0);
  assert.equal(route.profile.at(-1).distanceKm, route.distanceKm);
  assert.equal(route.profile.length, route.path.length);
  assert(route.profile.every((sample, i) => i === 0 || sample.distanceKm >= route.profile[i - 1].distanceKm));
});
