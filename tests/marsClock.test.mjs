import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marsClock, marsTime, nextSolarCrossing, SOL_SECONDS } from '../src/lib/marsClock.ts';
import { geographic, localXYZ, marsFixed } from '../src/lib/marsFrames.ts';

test('NASA Mars24 prime meridian worked example', () => {
  const time = marsClock(Date.parse('2000-01-06T00:00:00Z'), 0, 0);
  assert.equal(marsTime(time.mtc), '23:59:39');
  assert.equal(marsTime(time.ltst), '23:38:54');
  assert.ok(Math.abs(time.ls - 277.18758) < 0.0001);
  assert.ok(Math.abs(time.solarElevation + 64.26182) < 0.0001);
  assert.ok(Math.abs(time.solarAzimuth - 191.03905) < 0.0001);
});

test('NASA Spirit worked example converts west longitude to east', () => {
  const time = marsClock(Date.parse('2004-01-03T13:46:31Z'), -14.640, -184.702);
  assert.equal(marsTime(time.lmst), '00:51:07');
  assert.ok(Math.min(time.ltst, 24 - time.ltst) < 1.5 / 3600);
  assert.ok(Math.abs(time.solarElevation + 61.93895) < 0.001);
});

test('Mars clock wraps at midnight and advances exactly one MSD per mean sol', () => {
  const epoch = Date.parse('2026-11-15T12:00:00Z');
  assert.ok(Math.abs(marsClock(epoch + SOL_SECONDS * 1000, 18.5, 77.5).msd - marsClock(epoch, 18.5, 77.5).msd - 1) < 1e-8);
  assert.equal(marsTime(23.999999), '00:00:00');
  assert.equal(marsClock(Date.parse('2027-01-02T00:00:00Z'), 18.5, 77.5).leapTableExtrapolated, true);
  const threshold = 10;
  const sunset = nextSolarCrossing(epoch, 18.5, 77.5, threshold, false);
  assert.ok(sunset > epoch && (sunset - epoch) < SOL_SECONDS * 1000);
  assert.ok(marsClock(sunset - 2000, 18.5, 77.5).solarElevation > threshold);
  assert.ok(marsClock(sunset + 2000, 18.5, 77.5).solarElevation < threshold);
});

test('coordinate axes align with Mars prime meridian and local origin', () => {
  const proj = { sphereRadiusMeters: 3396190, standardParallelDegrees: 18.4663, centralLongitudeDegrees: 0 };
  const origin = { xM: 0, yM: 0, zM: -2500 };
  assert.deepEqual(marsFixed(origin, proj), { x: 3393690, y: 0, z: 0 });
  const point = { xM: 100, yM: 40, zM: -2480 };
  assert.deepEqual(localXYZ(point, origin), { x: 100, y: 40, z: 20 });
  assert.ok(geographic(point, proj).longitudeEast > 0);
  assert.ok(geographic(point, proj).latitudeGraphic > geographic(point, proj).latitude);
});
