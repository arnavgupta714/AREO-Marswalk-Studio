import test from 'node:test';
import assert from 'node:assert/strict';
import { seedMission, validateMission, readMission, formatMinutes, STORE_KEY } from '../src/lib/mission.ts';
import { planRoute, sites } from '../src/lib/routeEngine.ts';

const validNote = () => ({
  id: 'note-1', site: 'Delta outcrop', text: 'Layers tilt gently.\nCompare grain size.',
  category: 'Geology', createdAt: '2026-11-14T06:30:00.000Z',
});

test('a mission export round-trips with the same route and notebook', () => {
  const original = seedMission();
  original.notes.push(validNote());
  const imported = validateMission(JSON.parse(JSON.stringify(original)));
  assert.equal(imported.name, original.name);
  assert.deepEqual(imported.notes, original.notes);
  const route = m => planRoute([...m.stops, m.stops[0]], m.mode, m.constraints);
  assert.deepEqual(route(imported), route(original));
});

test('known site coordinates cannot be moved and imported science metadata cannot be forged', () => {
  const moved = seedMission();
  moved.stops[1].x += 1;
  assert.throws(() => validateMission(moved), /coordinates/);
  const forged = seedMission();
  forged.stops[1].name = 'Forged station';
  forged.stops[1].scienceValue = 999;
  forged.stops[1].dwellMinutes = -500;
  const clean = validateMission(forged);
  assert.equal(clean.stops[1].name, sites.find(s => s.id === 'delta').name);
  assert.equal(clean.stops[1].scienceValue, undefined);
  assert.equal(clean.stops[1].dwellMinutes, undefined);
  const route = planRoute([...clean.stops, clean.stops[0]]);
  assert.equal(route.scienceMinutes, 40);
  assert.equal(route.scienceScore, 55);
});

test('custom waypoints at named-site coordinates remain transit-only', () => {
  const mission = seedMission();
  mission.stops = [mission.stops[0], { ...sites[1], id: 'custom-1', name: 'Waypoint 1' }];
  const imported = validateMission(mission);
  const route = planRoute([...imported.stops, imported.stops[0]]);
  assert(route.path.length > 0);
  assert.equal(route.scienceMinutes, 0);
  assert.equal(route.scienceScore, 0);
  assert.deepEqual(route.visitedSiteIds, []);
});

test('an import retains only allowed fields and owns its nested data', () => {
  const mission = seedMission();
  mission.notes = [{ ...validNote(), html: '<script>bad</script>' }];
  mission.constraints.unexpected = 'ignore me';
  mission.extra = 'ignore me';
  const clean = validateMission(mission);
  assert.equal('extra' in clean, false);
  assert.equal('unexpected' in clean.constraints, false);
  assert.equal('html' in clean.notes[0], false);
  mission.name = 'changed';
  mission.constraints.maxSlope = 5;
  mission.stops[0].x = 0;
  mission.notes[0].text = 'changed';
  assert.equal(clean.name, 'Delta reconnaissance');
  assert.notEqual(clean.constraints.maxSlope, 5);
  assert.equal(clean.stops[0].x, sites[0].x);
  assert.equal(clean.notes[0].text, validNote().text);
});

test('all numeric constraints reject non-finite, missing, and out-of-range values', () => {
  const bounds = { maxSlope:[5,30], evaMinutes:[60,600], reservePercent:[10,50], speedKmh:[1,6], radiationRate:[0,.1] };
  for (const [key, [lo, hi]] of Object.entries(bounds)) {
    for (const value of [NaN, Infinity, -Infinity, undefined, String(lo), lo - 0.01, hi + 0.01]) {
      const mission = seedMission();
      mission.constraints[key] = value;
      assert.throws(() => validateMission(mission), new RegExp(key));
    }
    for (const value of [lo, hi]) {
      const mission = seedMission();
      mission.constraints[key] = value;
      assert.equal(validateMission(mission).constraints[key], value);
    }
  }
});

test('mission identity, stop bounds, unique IDs, and a canonical starting habitat are required', () => {
  for (const value of [null, [], 'text', {}, { ...seedMission(), version: 2 }]) assert.throws(() => validateMission(value));
  for (const change of [
    m => { m.name = '   '; },
    m => { m.mode = 'unrecognized'; },
    m => { m.stops = []; },
    m => { m.stops[1].x = NaN; },
    m => { m.stops[1].y = 701; },
    m => { m.stops[1].name = ' '; },
    m => { m.stops[1].name = 'x\nlabel'; },
    m => { m.stops[1].id = ''; },
    m => { m.stops[1].id = 'x'.repeat(101); },
    m => { m.stops.push({ ...m.stops[1] }); },
    m => { m.stops.reverse(); },
    m => { m.stops[0].id = 'custom-habitat'; },
  ]) {
    const mission = seedMission();
    change(mission);
    assert.throws(() => validateMission(mission));
  }
});

test('notebook records require valid fields, unique identifiers, and actual UTC dates', () => {
  for (const change of [
    n => { n.id = ''; },
    n => { n.site = ''; },
    n => { n.category = 'unknown'; },
    n => { n.text = ' '; },
    n => { n.text = 'x'.repeat(10001); },
    n => { n.text = 'bad\u0000text'; },
    n => { n.createdAt = '0'; },
    n => { n.createdAt = '2026-02-30T06:30:00.000Z'; },
  ]) {
    const mission = seedMission();
    mission.notes = [validNote()];
    change(mission.notes[0]);
    assert.throws(() => validateMission(mission), /observation/);
  }
  const duplicate = seedMission();
  duplicate.notes = [validNote(), validNote()];
  assert.throws(() => validateMission(duplicate), /unique/);
});

test('local persistence recovers from corrupt data and storage access failures', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    for (const raw of ['{broken', '{"version":9}', null]) {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => { assert.equal(key, STORE_KEY); return raw; } } });
      assert.deepEqual(readMission(), seedMission());
    }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => { throw new Error('Storage denied'); } } });
    assert.deepEqual(readMission(), seedMission());
    const saved = seedMission();
    saved.name = 'Saved reconnaissance';
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => JSON.stringify(saved) } });
    assert.equal(readMission().name, saved.name);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('duration formatting carries rounded minutes into hours', () => {
  assert.equal(formatMinutes(59.8), '1h 00m');
  assert.equal(formatMinutes(119.8), '2h 00m');
  assert.equal(formatMinutes(0), '0h 00m');
  assert.equal(formatMinutes(191.75), '3h 12m');
});
