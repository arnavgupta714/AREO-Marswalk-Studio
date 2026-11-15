import { defaults, sites, type Constraints, type Point, type RouteMode } from './routeEngine';

export interface Stop extends Point {
  id: string;
  name: string;
  description?: string;
  dwellMinutes?: number;
  scienceValue?: number;
}
export interface Observation {
  id: string;
  site: string;
  text: string;
  category: string;
  createdAt: string;
}
export interface Mission {
  version: 1;
  name: string;
  mode: RouteMode;
  constraints: Constraints;
  stops: Stop[];
  notes: Observation[];
}
export const seedMission = (): Mission => ({
  version: 1,
  name: 'Delta reconnaissance',
  mode: 'balanced',
  constraints: { ...defaults },
  stops: ['habitat', 'delta', 'overlook'].map((id) => ({ ...sites.find((s) => s.id === id)! })),
  notes: [],
});
export const STORE_KEY = 'areo.mission.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value);
}

function validLabel(value: unknown, max = 100): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

/** Import only whitelisted fields; never retain references to an untrusted object. */
export function validateMission(value: unknown): Mission {
  if (!isRecord(value)) throw new Error('This file does not contain a mission.');
  const m = value;
  if (
    m.version !== 1 ||
    !validLabel(m.name) ||
    typeof m.mode !== 'string' ||
    !['balanced', 'safest', 'science'].includes(m.mode)
  )
    throw new Error('Unsupported mission format. Use an AREO version 1 mission file.');
  if (!Array.isArray(m.stops) || m.stops.length < 2 || m.stops.length > 12)
    throw new Error('A mission needs between 2 and 12 stops.');
  const stops: Stop[] = m.stops.map((value: unknown) => {
    if (
      !isRecord(value) ||
      !validId(value.id) ||
      !validLabel(value.name) ||
      typeof value.x !== 'number' ||
      typeof value.y !== 'number' ||
      !Number.isFinite(value.x) ||
      !Number.isFinite(value.y) ||
      value.x < 0 ||
      value.x > 1000 ||
      value.y < 0 ||
      value.y > 700
    ) {
      throw new Error(
        'Every stop needs a valid identifier, a name, and coordinates within the scenario area.'
      );
    }
    const canonical = sites.find((site) => site.id === value.id);
    if (canonical && (value.x !== canonical.x || value.y !== canonical.y)) {
      throw new Error(
        `The coordinates for ${canonical.name} do not match the scenario. Use a custom waypoint for another location.`
      );
    }
    // Imported metadata cannot alter a site's science value, dwell time or label.
    return { id: value.id, name: canonical?.name ?? value.name.trim(), x: value.x, y: value.y };
  });
  if (new Set(stops.map((s) => s.id)).size !== stops.length)
    throw new Error('Stop identifiers must be unique.');
  const home = sites.find((s) => s.kind === 'habitat')!;
  if (stops[0].id !== home.id) throw new Error('The first stop must be the scenario habitat.');
  const ranges: Record<keyof Constraints, [number, number]> = {
    maxSlope: [5, 30],
    evaMinutes: [60, 600],
    reservePercent: [10, 50],
    speedKmh: [1, 6],
    radiationRate: [0, 0.1],
  };
  if (!isRecord(m.constraints)) throw new Error('Missing mission constraints.');
  const constraints = {} as Constraints;
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const n = m.constraints[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
      throw new Error(`Invalid ${key} constraint.`);
    constraints[key as keyof Constraints] = n;
  }
  if (!Array.isArray(m.notes) || m.notes.length > 500)
    throw new Error('A mission supports up to 500 field observations.');
  const notes: Observation[] = m.notes.map((value: unknown) => {
    if (
      !isRecord(value) ||
      !validId(value.id) ||
      !validLabel(value.site) ||
      !validLabel(value.category, 32) ||
      !['Geology', 'Atmosphere', 'Imaging', 'Operations'].includes(value.category) ||
      typeof value.text !== 'string' ||
      !value.text.trim() ||
      value.text.length > 10000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.text) ||
      typeof value.createdAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      new Date(value.createdAt).toISOString() !== value.createdAt
    ) {
      throw new Error('Invalid field observation. Check its identifier, text, discipline and UTC timestamp.');
    }
    return {
      id: value.id,
      site: value.site.trim(),
      text: value.text.trim(),
      category: value.category,
      createdAt: value.createdAt,
    };
  });
  if (new Set(notes.map((n) => n.id)).size !== notes.length)
    throw new Error('Observation identifiers must be unique.');
  return { version: 1, name: m.name.trim(), mode: m.mode as RouteMode, constraints, stops, notes };
}
export function readMission(): Mission {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? validateMission(JSON.parse(raw)) : seedMission();
  } catch {
    return seedMission();
  }
}
export function downloadFile(name: string, data: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const formatMinutes = (minutes: number) => {
  const rounded = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  return `${Math.floor(rounded / 60)}h ${(rounded % 60).toString().padStart(2, '0')}m`;
};
