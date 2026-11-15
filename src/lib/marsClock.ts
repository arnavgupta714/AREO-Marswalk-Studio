/** NASA GISS Mars24 solar time, Allison and McEwen (2000), with GISS revisions. */
const DEG = Math.PI / 180;
export const SOL_SECONDS = 86400 * 1.0274912517;
const DAY_MS = 86400000;
const PERTURBERS = [
  [0.0071, 2.2353, 49.409], [0.0057, 2.7543, 168.173], [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736], [0.0021, 2.1354, 15.704], [0.0020, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
] as const;
const LEAPS = [
  '1972-01-01', '1972-07-01', '1973-01-01', '1974-01-01', '1975-01-01', '1976-01-01',
  '1977-01-01', '1978-01-01', '1979-01-01', '1980-01-01', '1981-07-01', '1982-07-01',
  '1983-07-01', '1985-07-01', '1988-01-01', '1990-01-01', '1991-01-01', '1992-07-01',
  '1993-07-01', '1994-07-01', '1996-01-01', '1997-07-01', '1999-01-01', '2006-01-01',
  '2009-01-01', '2012-07-01', '2015-07-01', '2017-01-01',
].map(value => Date.parse(value));
export const LEAP_DATA_END = Date.parse('2027-01-01');
const wrap = (value: number, period: number) => ((value % period) + period) % period;
const sin = (degrees: number) => Math.sin(degrees * DEG);
const cos = (degrees: number) => Math.cos(degrees * DEG);

export interface MarsClock {
  msd: number;
  localSol: number;
  mtc: number;
  lmst: number;
  ltst: number;
  ls: number;
  equationOfTimeMinutes: number;
  solarElevation: number;
  solarAzimuth: number;
  sunDistanceAu: number;
  leapTableExtrapolated: boolean;
}

export function marsClock(utcMs: number, latitudeGraphic: number, longitudeEast: number): MarsClock {
  if (!Number.isFinite(utcMs) || utcMs < LEAPS[0] || utcMs >= Date.parse('2128-01-01')) {
    throw new RangeError('The solar clock supports UTC dates from 1972 through 2127.');
  }
  if (!Number.isFinite(latitudeGraphic) || Math.abs(latitudeGraphic) > 90 || !Number.isFinite(longitudeEast)) {
    throw new RangeError('Provide a finite latitude and east longitude.');
  }
  const taiMinusUtc = 9 + LEAPS.filter(date => date <= utcMs).length;
  const jdTt = 2440587.5 + (utcMs + (taiMinusUtc + 32.184) * 1000) / DAY_MS;
  const d = jdTt - 2451545;
  const meanAnomaly = wrap(19.3871 + 0.52402073 * d, 360);
  const meanSun = 270.3871 + 0.524038496 * d;
  const perturbation = PERTURBERS.reduce((sum, [amplitude, period, phase]) =>
    sum + amplitude * cos(0.985626 * d / period + phase), 0);
  const center = (10.691 + 0.0000003 * d) * sin(meanAnomaly) + 0.623 * sin(2 * meanAnomaly) +
    0.050 * sin(3 * meanAnomaly) + 0.005 * sin(4 * meanAnomaly) + 0.0005 * sin(5 * meanAnomaly) + perturbation;
  const ls = wrap(meanSun + center, 360);
  const equation = 2.861 * sin(2 * ls) - 0.071 * sin(4 * ls) + 0.002 * sin(6 * ls) - center;
  const msd = (jdTt - 2451549.5) / 1.0274912517 + 44796 - 0.0009626;
  const east = wrap(longitudeEast + 180, 360) - 180;
  const mtc = wrap(24 * msd, 24);
  const lmst = wrap(mtc + east / 15, 24);
  const ltst = wrap(lmst + equation / 15, 24);
  const hourAngle = (ltst - 12) * 15;
  const declination = Math.asin(0.42565 * sin(ls)) / DEG + 0.25 * sin(ls);
  const sinElevation = sin(declination) * sin(latitudeGraphic) + cos(declination) * cos(latitudeGraphic) * cos(hourAngle);
  const solarElevation = Math.asin(Math.max(-1, Math.min(1, sinElevation))) / DEG;
  const solarAzimuth = wrap(Math.atan2(-sin(hourAngle), cos(latitudeGraphic) * Math.tan(declination * DEG) - sin(latitudeGraphic) * cos(hourAngle)) / DEG, 360);
  const sunDistanceAu = 1.52367934 * (1.00436 - 0.09309 * cos(meanAnomaly) - 0.004336 * cos(2 * meanAnomaly) - 0.00031 * cos(3 * meanAnomaly) - 0.00003 * cos(4 * meanAnomaly));
  return { msd, mtc, lmst, ltst, ls, equationOfTimeMinutes: equation * 4, solarElevation, solarAzimuth,
    sunDistanceAu, localSol: Math.floor(msd + east / 360), leapTableExtrapolated: utcMs >= LEAP_DATA_END };
}

export function marsTime(hours: number): string {
  const seconds = wrap(Math.round(hours * 3600), 86400);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
}

/** Finds the next geometric threshold crossing in either direction within one mean sol. */
export function nextSolarCrossing(utcMs: number, latitude: number, longitude: number, threshold: number, rising: boolean): number | null {
  const interval = 5 * 60000;
  const altitude = (time: number) => marsClock(time, latitude, longitude).solarElevation - threshold;
  let previous = altitude(utcMs);
  for (let end = utcMs + interval; end <= utcMs + SOL_SECONDS * 1000 + interval; end += interval) {
    const value = altitude(end);
    if (rising ? previous < 0 && value >= 0 : previous >= 0 && value < 0) {
      let a = end - interval;
      let b = end;
      while (b - a > 1000) {
        const mid = (a + b) / 2;
        if ((altitude(mid) >= 0) === rising) b = mid;
        else a = mid;
      }
      return b;
    }
    previous = value;
  }
  return null;
}
