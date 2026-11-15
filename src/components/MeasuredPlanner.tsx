import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Compass,
  Download,
  Flag,
  LocateFixed,
  Play,
  Pause,
  Plus,
  RotateCcw,
  Route,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import rawDem from '../../public/data/jezero-elevation.json';
import {
  createMeasuredGrid,
  measuredDefaults,
  measuredPoint,
  measuredWalkingMinutes,
  planMeasuredLeg,
  planMeasuredRoute,
  withExclusions,
  type GridCell,
  type MeasuredMode,
  type MeasuredRouteOptions,
  type MeasuredStop,
} from '../lib/measuredRoute';
import { geographic, localXYZ, marsFixed, type ProjectedPoint } from '../lib/marsFrames';
import { marsTime, nextSolarCrossing } from '../lib/marsClock';
import { daylightWindow } from '../lib/traverseOps';
import { downloadFile, formatMinutes } from '../lib/mission';
import MeasuredMap from './MeasuredMap';
import SolOperations from './SolOperations';
import { TerrainRelief } from './TerrainRelief';
import './operations.css';

const grid = createMeasuredGrid(rawDem);
const origin: MeasuredStop = { col: 70, row: 59, label: 'Habitat Alpha', dwellMinutes: 0 };
const defaultStops: MeasuredStop[] = [
  origin,
  { col: 56, row: 43, label: 'Sediment transect', dwellMinutes: 20 },
  { col: 74, row: 24, label: 'Delta panorama', dwellMinutes: 15 },
];
const projection = rawDem.projection;
const storageKey = 'areo.measured.traverse.v1';
const utcField = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)} m`;
const midnight = Date.parse('1972-01-02T00:00:00Z');
const lastDate = Date.parse('2127-12-30T00:00:00Z');
const cellEquals = (a: GridCell, b: GridCell) => a.col === b.col && a.row === b.row;

interface TraversePlan {
  stops: MeasuredStop[];
  options: MeasuredRouteOptions;
  utc: string;
  solarLimit: number;
  exclusions: GridCell[];
}

function morning(utcMs: number, point: ProjectedPoint, limit: number) {
  const coordinates = geographic(point, projection);
  const rise = nextSolarCrossing(utcMs, coordinates.latitudeGraphic, coordinates.longitudeEast, limit, true);
  return rise === null ? utcField(utcMs) : utcField(rise + 30 * 60000);
}

function readPlan(): TraversePlan {
  const initial: TraversePlan = {
    stops: defaultStops,
    options: { ...measuredDefaults },
    utc: morning(Date.now(), measuredPoint(grid, origin)!, 10),
    solarLimit: 10,
    exclusions: [],
  };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null') as TraversePlan | null;
    if (
      !saved ||
      !Array.isArray(saved.stops) ||
      saved.stops.length < 2 ||
      saved.stops.length > 10 ||
      !saved.stops.every(
        (stop) =>
          stop &&
          measuredPoint(grid, stop) &&
          typeof stop.label === 'string' &&
          stop.label.length <= 80 &&
          Number.isFinite(stop.dwellMinutes) &&
          stop.dwellMinutes! >= 0 &&
          stop.dwellMinutes! <= 90
      ) ||
      new Set(saved.stops.map((s) => `${s.col},${s.row}`)).size !== saved.stops.length
    )
      return initial;
    const options = saved.options;
    if (
      !options ||
      !['shortest', 'balanced', 'gentlest'].includes(options.mode) ||
      !Number.isFinite(options.maxSlopeDegrees) ||
      options.maxSlopeDegrees < 3 ||
      options.maxSlopeDegrees > 25 ||
      !Number.isFinite(options.speedKmh) ||
      options.speedKmh < 1 ||
      options.speedKmh > 6 ||
      !Number.isFinite(options.evaMinutes) ||
      options.evaMinutes < 60 ||
      options.evaMinutes > 600 ||
      !Number.isFinite(options.reservePercent) ||
      options.reservePercent < 10 ||
      options.reservePercent > 50
    )
      return initial;
    const date = Date.parse(`${saved.utc}Z`);
    const validExclusions = Array.isArray(saved.exclusions)
      ? saved.exclusions
          .filter(
            (cell) => cell && measuredPoint(grid, cell) && !saved.stops.some((stop) => cellEquals(stop, cell))
          )
          .slice(0, 64)
      : [];
    const exclusions = [
      ...new Map(validExclusions.map(({ col, row }) => [`${col},${row}`, { col, row }])).values(),
    ];
    return {
      stops: saved.stops,
      options,
      utc: Number.isFinite(date) && date >= midnight && date < lastDate ? saved.utc : initial.utc,
      solarLimit: [0, 5, 10, 15, 20].includes(saved.solarLimit) ? saved.solarLimit : initial.solarLimit,
      exclusions,
    };
  } catch {
    return initial;
  }
}

export default function MeasuredPlanner() {
  const [plan, setPlan] = useState(readPlan);
  const [cursor, setCursor] = useState<GridCell>(plan.stops[1]);
  const [frame, setFrame] = useState<'local' | 'global'>('local');
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [returnPreview, setReturnPreview] = useState(false);
  const [reportedCell, setReportedCell] = useState<GridCell | null>(null);
  const [reportedMinutes, setReportedMinutes] = useState(0);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(true);
  const [selectingDestination, setSelectingDestination] = useState(false);
  const [destination, setDestination] = useState<GridCell | null>(null);
  const { stops, options, utc, solarLimit, exclusions } = plan;
  const habitat = measuredPoint(grid, stops[0])!;
  const site = geographic(habitat, projection);
  const focus = measuredPoint(grid, cursor);
  const coords = focus ? geographic(focus, projection) : null;
  const xyz = focus ? (frame === 'local' ? localXYZ(focus, habitat) : marsFixed(focus, projection)) : null;
  const navigationGrid = useMemo(() => withExclusions(grid, exclusions), [exclusions]);
  const route = useMemo(
    () => planMeasuredRoute(navigationGrid, stops, options),
    [navigationGrid, stops, options]
  );
  const cursorExcluded = exclusions.some((cell) => cellEquals(cell, cursor));
  const cursorHasStop = stops.some((stop) => cellEquals(stop, cursor));
  const departure = Date.parse(`${utc}Z`);
  const validDeparture = Number.isFinite(departure) && departure >= midnight && departure < lastDate;
  const daylight = useMemo(
    () => daylightWindow(validDeparture ? departure : Date.now(), route.totalMinutes, site, solarLimit),
    [validDeparture, departure, route.totalMinutes, site.latitudeGraphic, site.longitudeEast, solarLimit]
  );
  const canRun = route.feasible && validDeparture && daylight.clears;
  const quickRoute = useMemo(
    () =>
      destination
        ? planMeasuredRoute(
            navigationGrid,
            [stops[0], { ...destination, label: 'Map destination', dwellMinutes: 0 }],
            options
          )
        : null,
    [destination, navigationGrid, stops, options]
  );
  const quickDaylight =
    quickRoute?.path.length && validDeparture
      ? daylightWindow(departure, quickRoute.totalMinutes, site, solarLimit)
      : null;

  useEffect(() => {
    if (!validDeparture) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(plan));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [plan, validDeparture]);
  useEffect(() => {
    setElapsed(0);
    setPlaying(false);
    setReturnPreview(false);
  }, [route, utc, solarLimit]);
  useEffect(() => {
    if (!playing) return;
    const clock = setInterval(
      () => setElapsed((t) => Math.min(route.totalMinutes, t + Math.max(0.2, route.totalMinutes / 140))),
      160
    );
    return () => clearInterval(clock);
  }, [playing, route.totalMinutes]);
  useEffect(() => {
    if (playing && elapsed >= route.totalMinutes) setPlaying(false);
  }, [elapsed, playing, route.totalMinutes]);

  let remaining = elapsed;
  let current = habitat;
  let stage = 'At habitat';
  for (const leg of route.legs) {
    if (remaining < leg.walkingMinutes) {
      current = leg.from;
      for (let i = 1; i < leg.path.length; i++) {
        const segmentTime = measuredWalkingMinutes(leg.path[i - 1], leg.path[i], options.speedKmh);
        if (remaining < segmentTime) break;
        remaining -= segmentTime;
        current = leg.path[i];
      }
      stage = `Walking to ${leg.toLabel}`;
      break;
    }
    current = leg.to;
    if (remaining < leg.totalMinutes) {
      stage = `Science stop · ${leg.toLabel}`;
      break;
    }
    remaining -= leg.totalMinutes;
  }
  const returnFrom = (reportedCell && measuredPoint(grid, reportedCell)) || current;
  const returnElapsed = reportedCell ? reportedMinutes : elapsed;
  const showReturn = Boolean(reportedCell || returnPreview);
  const returnLeg = useMemo(() => {
    if (!showReturn || cellEquals(returnFrom, habitat)) return null;
    const direct = planMeasuredLeg(navigationGrid, returnFrom, habitat, { ...options, mode: 'fastest' });
    return direct.path.length ? { ...direct, from: returnFrom, to: habitat } : null;
  }, [showReturn, returnFrom.col, returnFrom.row, habitat.col, habitat.row, options, navigationGrid]);
  const returnMargin = returnLeg
    ? options.evaMinutes * (1 - options.reservePercent / 100) - returnElapsed - returnLeg.walkingMinutes
    : null;
  const returnDaylight =
    returnLeg && validDeparture
      ? daylightWindow(departure + returnElapsed * 60000, returnLeg.walkingMinutes, site, solarLimit)
      : null;
  const marker = reportedCell ? returnFrom : elapsed > 0 ? current : undefined;

  function selectMapCell(cell: GridCell) {
    setCursor(cell);
    if (selectingDestination) setDestination(cell);
  }

  function toggleDestinationMode() {
    setSelectingDestination(!selectingDestination);
    setDestination(null);
  }

  function useQuickRoute() {
    if (!destination || !quickRoute?.path.length) return;
    update({ stops: [stops[0], { ...destination, label: 'Map destination', dwellMinutes: 0 }] });
    setDestination(null);
    setSelectingDestination(false);
    setMessage('Map destination set as the traverse.');
  }

  function update(patch: Partial<TraversePlan>) {
    setPlan((currentPlan) => ({ ...currentPlan, ...patch }));
    setMessage('');
  }
  function addStop() {
    if (!focus || cursorHasStop || cursorExcluded || stops.length >= 10) return;
    update({ stops: [...stops, { ...cursor, label: `Science station ${stops.length}`, dwellMinutes: 15 }] });
  }
  function placeHabitat() {
    if (!focus || cursorHasStop || cursorExcluded) return;
    update({ stops: [{ ...cursor, label: 'Habitat Alpha', dwellMinutes: 0 }, ...stops.slice(1)] });
  }
  function moveStop(index: number, delta: number) {
    const next = [...stops];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    update({ stops: next });
  }
  function toggleExclusion() {
    if (!focus || cursorHasStop) return;
    if (cursorExcluded) update({ exclusions: exclusions.filter((cell) => !cellEquals(cell, cursor)) });
    else if (exclusions.length < 64)
      update({ exclusions: [...exclusions, { col: cursor.col, row: cursor.row }] });
  }
  function exportPlan() {
    downloadFile(
      'areo-jezero-traverse.json',
      JSON.stringify(
        {
          schemaVersion: 1,
          workspace: 'measured-jezero',
          dataId: grid.id,
          plan,
          coordinateReference: {
            local: 'X east, Y north, Z above habitat from projected DEM',
            marsFixed: 'Spherical approximation',
            projection,
          },
          waypointCoordinates: stops.map((stop) => {
            const point = measuredPoint(grid, stop)!;
            return {
              ...stop,
              local: localXYZ(point, habitat),
              geographic: geographic(point, projection),
              marsFixedApprox: marsFixed(point, projection),
            };
          }),
          daylight: validDeparture ? daylight : null,
          route,
          drill: {
            source: reportedCell ? 'crew-reported' : 'rehearsal',
            elapsed: returnElapsed,
            current: returnFrom,
            returnLeg,
            returnMargin,
            daylightMargin: returnDaylight?.marginMinutes ?? null,
          },
          dataCatalog: 'data/sources.json',
          limitation:
            'Regional DEM planning estimates. Verify footing, local hazards, communications and lighting separately.',
        },
        null,
        2
      )
    );
    setMessage('Traverse package downloaded.');
  }

  return (
    <div className="ops-workspace">
      <div className="ops-summary">
        <div>
          <span className="section-label">
            <Compass size={14} /> WESTERN JEZERO / FIELD OPERATIONS
          </span>
          <h1>Plan the traverse.</h1>
          <p>Registered CTX terrain and local Mars time. All calculations run on this device.</p>
        </div>
        <div className="ops-summary-actions">
          <span className="ops-badge ready">
            <ShieldCheck size={14} />
            {saved ? 'Offline · plan saved' : 'Offline · export to save'}
          </span>
          <button className="primary" onClick={exportPlan}>
            <Download size={16} />
            Export traverse
          </button>
        </div>
      </div>
      <div className="ops-columns">
        <div className="ops-map-column">
          <MeasuredMap
            grid={grid}
            bounds={rawDem.projectedBoundsMeters}
            path={route.path}
            returnPath={returnLeg?.path ?? []}
            previewPath={quickRoute?.path ?? []}
            destination={destination ?? undefined}
            selectingDestination={selectingDestination}
            onToggleDestination={toggleDestinationMode}
            stops={stops}
            exclusions={exclusions}
            cursor={cursor}
            current={marker}
            onSelect={selectMapCell}
          />
          {selectingDestination && (
            <section className="ops-panel quick-route-panel" aria-label="Quick route preview">
              <div className="ops-panel-heading">
                <Route size={16} />
                <h2>Quick route preview</h2>
              </div>
              {!destination ? (
                <p className="ops-context">
                  Select a point inside the western Jezero coverage. The preview keeps your saved itinerary
                  intact.
                </p>
              ) : quickRoute?.path.length ? (
                <>
                  <p className="ops-context">
                    Habitat → cell {destination.col}, {destination.row} → habitat · no science dwell
                  </p>
                  <div className="ops-metrics">
                    <div>
                      <b>{quickRoute.distanceKm.toFixed(2)} km</b>
                      <small>Round trip</small>
                    </div>
                    <div>
                      <b>{formatMinutes(quickRoute.totalMinutes)}</b>
                      <small>Walking time</small>
                    </div>
                    <div>
                      <b>{quickRoute.maxSlopeDegrees.toFixed(1)}°</b>
                      <small>Peak sampled grade</small>
                    </div>
                  </div>
                  <p
                    className={`ops-context ${quickRoute.feasible && quickDaylight?.clears ? '' : 'caution'}`}
                    role="status"
                  >
                    {!quickRoute.feasible
                      ? quickRoute.warnings[0]
                      : quickDaylight?.clears
                        ? `${Math.floor(quickDaylight.marginMinutes)} min daylight margin`
                        : validDeparture
                          ? 'Daylight threshold is not met for the full trip.'
                          : 'Set a departure time to check daylight.'}
                  </p>
                  <button className="secondary" onClick={useQuickRoute}>
                    <Flag size={15} />
                    Replace itinerary with this destination
                  </button>
                </>
              ) : (
                <p className="ops-badge caution" role="status">
                  {quickRoute?.warnings[0]}
                </p>
              )}
            </section>
          )}
          <section className="ops-panel xyz-panel">
            <div className="ops-panel-heading">
              <LocateFixed size={16} />
              <h2>Coordinate inspector</h2>
            </div>
            <div className="ops-frame">
              <button aria-pressed={frame === 'local'} onClick={() => setFrame('local')}>
                Local XYZ
              </button>
              <button aria-pressed={frame === 'global'} onClick={() => setFrame('global')}>
                Mars-fixed XYZ
              </button>
            </div>
            {xyz && coords ? (
              <>
                <div className="ops-axes">
                  {(['x', 'y', 'z'] as const).map((axis, i) => (
                    <div key={axis}>
                      <small>
                        {axis.toUpperCase()} ·{' '}
                        {frame === 'local'
                          ? ['EAST', 'NORTH', 'UP'][i]
                          : ['PRIME MERIDIAN', '90° EAST', 'NORTH POLE'][i]}
                      </small>
                      <strong>{signed(xyz[axis])}</strong>
                    </div>
                  ))}
                </div>
                <p className="ops-context">
                  {coords.latitude.toFixed(5)}° N / {coords.longitudeEast.toFixed(5)}° E ·{' '}
                  {coords.elevation.toFixed(1)} m MOLA-tied elevation · cell {cursor.col}, {cursor.row}
                </p>
                <p className="ops-context">
                  {frame === 'local'
                    ? 'Projected offsets from Habitat Alpha. Z is the elevation difference.'
                    : 'Spherical Mars-fixed approximation. Absolute positions require an areoid correction.'}
                </p>
              </>
            ) : (
              <p className="ops-context">No measured height at this cell.</p>
            )}
            <div className="ops-inline-actions">
              <button
                className="secondary"
                disabled={!focus || cursorHasStop || cursorExcluded || stops.length >= 10}
                onClick={addStop}
              >
                <Plus size={15} />
                Add station at cursor
              </button>
              <button
                className="secondary"
                disabled={!focus || cursorHasStop || cursorExcluded}
                onClick={placeHabitat}
              >
                <Flag size={15} />
                Set as habitat
              </button>
              <button
                className="secondary exclusion-button"
                disabled={!focus || cursorHasStop || (!cursorExcluded && exclusions.length >= 64)}
                onClick={toggleExclusion}
              >
                <TriangleAlert size={15} />
                {cursorExcluded ? 'Clear exclusion at cursor' : 'Mark cursor as no-go'}
              </button>
            </div>
            {exclusions.length > 0 && (
              <p className="ops-context">
                Reported no-go cells reroute both the traverse and direct return. Select a hatched cell to
                clear it.
              </p>
            )}
          </section>
          <section className="ops-panel">
            <div className="ops-panel-heading">
              <Activity size={16} />
              <h2>Measured route profile</h2>
            </div>
            <MeasuredProfile route={route} />
            <p className="ops-context">
              Source DEM 20 m pixels. This offline pack uses samples{' '}
              {grid.sampledSpacingMeters.min.toFixed(0)}–{grid.sampledSpacingMeters.max.toFixed(0)} m apart.
              Grades between samples can miss smaller hazards and abrupt changes.
            </p>
          </section>
          <TerrainRelief
            width={grid.width}
            height={grid.height}
            elevations={grid.elevations}
            route={route.path}
            current={marker}
            gridSpacingMeters={[rawDem.gridSpacingMeters[0], rawDem.gridSpacingMeters[1]]}
          />
        </div>
        <aside className="ops-control-column">
          <section className="ops-panel">
            <div className="ops-panel-heading">
              <Route size={16} />
              <h2>Itinerary & constraints</h2>
            </div>
            <p className="ops-context">
              Habitat and science stations are proposed coordinates. The engine closes the traverse back to
              habitat.
            </p>
            <div className="ops-stops">
              {stops.map((stop, index) => (
                <div key={`${stop.col},${stop.row}`} className="ops-stop">
                  <button className="ops-stop-name" onClick={() => setCursor(stop)}>
                    <b>{index === 0 ? 'H' : index}</b>
                    <span>{stop.label}</span>
                  </button>
                  {index > 0 && (
                    <>
                      <label>
                        <input
                          type="number"
                          aria-label={`Dwell time for ${stop.label}`}
                          min={0}
                          max={90}
                          value={stop.dwellMinutes}
                          onChange={(event) =>
                            update({
                              stops: stops.map((s, i) =>
                                i === index
                                  ? {
                                      ...s,
                                      dwellMinutes: Math.max(0, Math.min(90, Number(event.target.value))),
                                    }
                                  : s
                              ),
                            })
                          }
                        />
                        <small>min</small>
                      </label>
                      <button
                        className="icon-button"
                        aria-label={`Move ${stop.label} up`}
                        disabled={index === 1}
                        onClick={() => moveStop(index, -1)}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Move ${stop.label} down`}
                        disabled={index === stops.length - 1}
                        onClick={() => moveStop(index, 1)}
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Remove ${stop.label}`}
                        disabled={stops.length === 2}
                        onClick={() => update({ stops: stops.filter((_, i) => i !== index) })}
                      >
                        <X size={13} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="ops-inputs">
              <label>
                Route priority
                <select
                  value={options.mode}
                  onChange={(e) => update({ options: { ...options, mode: e.target.value as MeasuredMode } })}
                >
                  <option value="balanced">Balanced</option>
                  <option value="shortest">Shortest</option>
                  <option value="gentlest">Gentlest</option>
                </select>
              </label>
              <label>
                Grade limit
                <select
                  value={options.maxSlopeDegrees}
                  onChange={(e) =>
                    update({ options: { ...options, maxSlopeDegrees: Number(e.target.value) } })
                  }
                >
                  {[3, 5, 8, 10, 12, 15, 18, 20, 25].map((n) => (
                    <option key={n} value={n}>
                      {n}°
                    </option>
                  ))}
                </select>
              </label>
              <label>
                EVA budget <output>{options.evaMinutes} min</output>
                <input
                  type="range"
                  aria-label="Field EVA budget"
                  min="60"
                  max="600"
                  step="15"
                  value={options.evaMinutes}
                  onChange={(e) => update({ options: { ...options, evaMinutes: Number(e.target.value) } })}
                />
              </label>
              <label>
                Return reserve <output>{options.reservePercent}%</output>
                <input
                  type="range"
                  aria-label="Field return reserve"
                  min="10"
                  max="50"
                  step="5"
                  value={options.reservePercent}
                  onChange={(e) =>
                    update({ options: { ...options, reservePercent: Number(e.target.value) } })
                  }
                />
              </label>
              <label>
                Level-ground speed <output>{options.speedKmh.toFixed(1)} km/h</output>
                <input
                  type="range"
                  aria-label="Field walking speed"
                  min="1"
                  max="6"
                  step=".5"
                  value={options.speedKmh}
                  onChange={(e) => update({ options: { ...options, speedKmh: Number(e.target.value) } })}
                />
              </label>
            </div>
            <div className="ops-metrics">
              <div>
                <b>{route.distanceKm.toFixed(2)} km</b>
                <small>3D loop distance</small>
              </div>
              <div>
                <b>{formatMinutes(route.totalMinutes)}</b>
                <small>Walk + science</small>
              </div>
              <div>
                <b>{route.maxSlopeDegrees.toFixed(1)}°</b>
                <small>Peak sampled grade</small>
              </div>
            </div>
            <div className={`ops-badge ${route.feasible ? 'ready' : 'caution'}`}>
              {route.feasible ? <ShieldCheck size={14} /> : <TriangleAlert size={14} />}{' '}
              {route.feasible ? `${Math.floor(route.reserveMinutes)} min left at habitat` : route.warnings[0]}
            </div>
          </section>
          <SolOperations
            utc={utc}
            setUtc={(value) => update({ utc: value })}
            duration={route.totalMinutes}
            solarLimit={solarLimit}
            setSolarLimit={(value) => update({ solarLimit: value })}
            site={site}
            daylight={daylight}
            onNextWindow={() =>
              update({ utc: morning(validDeparture ? departure : Date.now(), habitat, solarLimit) })
            }
          />
          {!validDeparture && (
            <p className="ops-badge caution">Choose a valid departure between 1972 and 2127.</p>
          )}
          <section className="ops-panel">
            <div className="ops-panel-heading">
              <Activity size={16} />
              <h2>Traverse rehearsal</h2>
            </div>
            <p className="ops-context">
              {elapsed === 0 ? 'At habitat' : stage} · {formatMinutes(elapsed)} elapsed. Use the timeline to
              inspect a return decision at that point.
            </p>
            <input
              className="ops-timeline"
              aria-label="Traverse rehearsal timeline"
              type="range"
              min="0"
              max={route.totalMinutes || 1}
              step=".05"
              value={elapsed}
              disabled={!route.path.length || Boolean(reportedCell)}
              onChange={(event) => {
                setPlaying(false);
                setElapsed(Number(event.target.value));
              }}
            />
            <div className="ops-inline-actions">
              <button
                className="primary"
                disabled={!canRun || Boolean(reportedCell)}
                onClick={() => {
                  if (elapsed >= route.totalMinutes) setElapsed(0);
                  setPlaying(!playing);
                }}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}{' '}
                {playing ? 'Pause rehearsal' : 'Play rehearsal'}
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setPlaying(false);
                  setElapsed(0);
                  setReturnPreview(false);
                  setReportedCell(null);
                }}
                aria-label="Reset traverse rehearsal"
              >
                <RotateCcw size={15} />
              </button>
            </div>
            {!reportedCell && (
              <button
                className="text-button ops-return"
                onClick={() => {
                  setPlaying(false);
                  setReturnPreview(!returnPreview);
                }}
              >
                {returnPreview ? 'Hide return route' : 'Calculate direct return'}
                <ArrowRight size={14} />
              </button>
            )}
            <div className="reported-return">
              <h3>Return from a reported position</h3>
              <p className="ops-context">
                Select your position on the map and enter elapsed Earth minutes since the planned UTC
                departure.
              </p>
              <div className="ops-inputs">
                <label>
                  Elapsed minutes
                  <input
                    type="number"
                    min="0"
                    max="1440"
                    value={reportedMinutes}
                    onChange={(event) =>
                      setReportedMinutes(Math.min(1440, Math.max(0, Number(event.target.value))))
                    }
                  />
                </label>
                <button
                  className="secondary"
                  disabled={!focus || cursorExcluded}
                  onClick={() => {
                    setPlaying(false);
                    setReturnPreview(false);
                    setReportedCell({ col: cursor.col, row: cursor.row });
                  }}
                >
                  <LocateFixed size={14} />
                  Use cursor position
                </button>
              </div>
              {reportedCell && (
                <div className="reported-label">
                  <span>
                    Reported cell {reportedCell.col}, {reportedCell.row}
                  </span>
                  <button className="text-button" onClick={() => setReportedCell(null)}>
                    Clear reported position
                  </button>
                </div>
              )}
            </div>
            {showReturn && (
              <div
                className={`return-assessment ${returnMargin !== null && returnMargin >= 0 && returnDaylight?.clears ? '' : 'caution'}`}
              >
                {cellEquals(returnFrom, habitat) ? (
                  'Position is at habitat.'
                ) : returnLeg ? (
                  <>
                    <strong>
                      {returnLeg.distanceKm.toFixed(2)} km · {formatMinutes(returnLeg.walkingMinutes)} direct
                      return
                    </strong>
                    <p>
                      {Math.floor(returnMargin!)} min beyond required EVA reserve ·{' '}
                      {returnDaylight
                        ? `${Math.floor(returnDaylight.marginMinutes)} min daylight margin`
                        : 'daylight unavailable'}
                    </p>
                    {returnDaylight && (
                      <p>
                        Return {marsTime(returnDaylight.end.ltst)} LTST.{' '}
                        {!returnDaylight.clears && 'Sun angle threshold is not met for the full return.'}
                      </p>
                    )}
                    <p>The cyan path respects the current grade limit and reported exclusions.</p>
                  </>
                ) : (
                  'No return path under current constraints.'
                )}
              </div>
            )}
          </section>
          {message && (
            <p className="ops-badge ready" role="status">
              {message}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function MeasuredProfile({ route }: { route: ReturnType<typeof planMeasuredRoute> }) {
  if (!route.profile.length) return <p className="ops-context">No continuous route to profile.</p>;
  const high = Math.max(...route.profile.map((p) => p.zM));
  const low = Math.min(...route.profile.map((p) => p.zM));
  const points = route.profile
    .map(
      (p) =>
        `${(p.distanceM / (route.surfaceDistanceM || 1)) * 640},${87 - ((p.zM - low) / (high - low || 1)) * 65}`
    )
    .join(' ');
  return (
    <figure className="ops-profile">
      <svg
        viewBox="0 0 640 100"
        preserveAspectRatio="none"
        role="img"
        aria-label="Measured elevation along the complete route"
      >
        <defs>
          <linearGradient id="ops-profile-fade" x2="0" y2="1">
            <stop stopColor="#e59b69" stopOpacity=".4" />
            <stop offset="1" stopColor="#e59b69" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,100 ${points} 640,100`} fill="url(#ops-profile-fade)" />
        <polyline
          points={points}
          stroke="#ffab7a"
          fill="none"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption>
        <span>
          {low.toFixed(1)} to {high.toFixed(1)} m elevation
        </span>
        <span>+{route.ascentM.toFixed(0)} m ascent</span>
        <span>{route.distanceKm.toFixed(2)} km</span>
      </figcaption>
    </figure>
  );
}
