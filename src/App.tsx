import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  CheckCircle2,
  Database,
  ExternalLink,
  HelpCircle,
  Map,
  Menu,
  Orbit,
  Settings2,
  Upload,
  X,
  TriangleAlert,
  FlaskConical,
  Compass,
} from 'lucide-react';
import Sidebar, { type LayersState } from './components/Sidebar';
import TerrainMap from './components/TerrainMap';
import RouteCard from './components/RouteCard';
import Profile from './components/Profile';
import Dialog from './components/Dialog';
import MeasuredPlanner from './components/MeasuredPlanner';
import {
  AboutPanel,
  AddStopPanel,
  ExportPanel,
  JournalPanel,
  SettingsPanel,
  SourcesPanel,
} from './components/MissionPanels';
import { planRoute, sites, terrainAt, type Point } from './lib/routeEngine';
import {
  readMission,
  STORE_KEY,
  validateMission,
  formatMinutes,
  type Mission,
  type Stop,
} from './lib/mission';

type Panel = 'sources' | 'journal' | 'settings' | 'export' | 'add' | 'about' | 'surface' | null;
const panelCopy = {
  sources: ['The science beneath the surface.', 'Imagery, measured terrain, and source provenance.'],
  journal: ['Field journal', 'The observations that turn a traverse into a discovery.'],
  settings: ['Mission constraints', 'Set the assumptions behind every step.'],
  export: ['Export mission', 'Keep the plan. Carry the science.'],
  add: ['Where will you explore?', 'Build your science itinerary.'],
  about: ['A new perspective.', 'AREO Marswalk Studio · Team CHITRA'],
  surface: ['From the surface', 'Perseverance · Jezero Crater'],
} as const;

export default function App() {
  const [fieldMode, setFieldMode] = useState(() => new URLSearchParams(window.location.search).get('workspace') !== 'training');
  const [mission, setMission] = useState<Mission>(readMission);
  const [layers, setLayers] = useState<LayersState>({
    orbital: true,
    elevation: true,
    minerals: false,
    hazards: true,
  });
  const [panel, setPanel] = useState<Panel>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [toast, setToast] = useState('');
  const [saved, setSaved] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const closePanel = useCallback(() => setPanel(null), []);
  const route = useMemo(
    () => planRoute([...mission.stops, mission.stops[0]], mission.mode, mission.constraints),
    [mission.stops, mission.mode, mission.constraints]
  );
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(mission));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [mission]);
  useEffect(() => {
    setRunning(false);
    setProgress(0);
  }, [route]);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setProgress((p) => Math.min(1, p + 1 / 150)), 200);
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => {
    if (progress >= 1) {
      setRunning(false);
      setToast('Simulation complete. Crew returned to habitat.');
    }
  }, [progress]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  const update = (patch: Partial<Mission>) => setMission((m) => ({ ...m, ...patch }));
  const addStop = (s: Stop) => {
    if (mission.stops.length >= 12) {
      setToast('A mission supports up to 12 stops.');
      return;
    }
    update({ stops: [...mission.stops, s] });
    setSelected(s.id);
    setPanel(null);
    setToast(`${s.name} added to your traverse.`);
  };
  const place = (p: Point) => {
    if (p.x < 0 || p.x > 1000 || p.y < 0 || p.y > 700) {
      setToast('Place the waypoint within the scenario boundary.');
      return;
    }
    const t = terrainAt(p);
    if (t.blocked || t.slope > mission.constraints.maxSlope) {
      setToast('This terrain exceeds the route constraints. Choose another location.');
      return;
    }
    addStop({
      id: crypto.randomUUID(),
      name: `Waypoint ${mission.stops.filter((s) => s.name.startsWith('Waypoint')).length + 1}`,
      x: Math.round(p.x),
      y: Math.round(p.y),
    });
    setPlacing(false);
  };
  const preset = (value: string) => {
    const ids =
      value === 'minerals'
        ? ['habitat', 'minerals', 'delta']
        : value === 'crater'
          ? ['habitat', 'crater', 'overlook']
          : ['habitat', 'delta', 'overlook'];
    update({
      name:
        value === 'minerals'
          ? 'Mineral expedition'
          : value === 'crater'
            ? 'Crater-floor survey'
            : 'Delta reconnaissance',
      stops: ids.map((id) => ({ ...sites.find((s) => s.id === id)! })),
    });
    setSelected(null);
    setToast('Itinerary updated. Field notes kept.');
  };
  const selectedStop = mission.stops.find((s) => s.id === selected);
  const selectedSite = sites.find((s) => s.id === selected);
  const terrain = selectedStop ? terrainAt(selectedStop) : null;
  async function importMission(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 25_000_000) throw new Error('Mission files must be smaller than 25 MB.');
      const next = validateMission(JSON.parse(await file.text()));
      setMission(next);
      setPanel(null);
      setSelected(null);
      setToast('Mission imported.');
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not import this mission.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }
  return (
    <>
      <div className={`app-shell${fieldMode ? ' field-mode' : ''}`}>
        <nav className="nav-rail" aria-label="Main navigation">
          <button className="orbit-brand" aria-label="About AREO" onClick={() => setPanel('about')}>
            <Orbit size={30} strokeWidth={1.3} />
          </button>
          <div className="rail-main">
            <button className={fieldMode && !panel ? 'active' : ''} aria-label="Field operations" title="Field operations" onClick={() => {setFieldMode(true);setPanel(null);setRunning(false);}}><Compass size={22}/></button>
            <button
              className={!fieldMode && !panel ? 'active' : ''}
              aria-label="Mission planner"
              title="Mission planner"
              onClick={() => {
                setFieldMode(false);
                setPanel(null);
                setSelected(null);
              }}
            >
              <Map size={22} />
            </button>
            <button
              className={panel === 'sources' ? 'active' : ''}
              aria-label="Data library"
              title="Data library"
              onClick={() => setPanel('sources')}
            >
              <Database size={21} />
            </button>
            <button
              className={panel === 'journal' ? 'active' : ''}
              aria-label="Field journal"
              title="Field journal"
              onClick={() => setPanel('journal')}
            >
              <BookOpen size={21} />
            </button>
            <button
              className={panel === 'settings' ? 'active' : ''}
              aria-label="Settings"
              title="Mission constraints"
              onClick={() => setPanel('settings')}
            >
              <Settings2 size={21} />
            </button>
          </div>
          <div className="rail-bottom">
            <button aria-label="Help and team" title="About Team CHITRA" onClick={() => setPanel('about')}>
              <HelpCircle size={20} />
            </button>
            <button className="team-avatar" aria-label="Team CHITRA" onClick={() => setPanel('about')}>
              <img src="./assets/team-chitra-reference.png" alt="" />
            </button>
          </div>
        </nav>
        {!fieldMode && <div className={`sidebar-wrapper ${sidebarOpen ? 'open' : ''}`}>
          <button
            className="mobile-sidebar-close icon-button"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
          </button>
          <Sidebar
            layers={layers}
            setLayer={(key) => setLayers((l) => ({ ...l, [key]: !l[key] }))}
            stops={mission.stops}
            selected={selected}
            select={setSelected}
            remove={(id) => {
              if (mission.stops.length <= 2) {
                setToast('Keep at least one destination in your itinerary.');
                return;
              }
              update({ stops: mission.stops.filter((s) => s.id !== id) });
              if (selected === id) setSelected(null);
            }}
            move={(index, direction) => {
              const stops = [...mission.stops];
              [stops[index], stops[index + direction]] = [stops[index + direction], stops[index]];
              update({ stops });
            }}
            add={() => setPanel('add')}
            preset={preset}
            onImage={() => setPanel('surface')}
          />
        </div>}
        {fieldMode ? <main className="field-main"><MeasuredPlanner/></main> : <main className="workspace">
          <header className="topbar">
            <div className="topbar-title">
              <button
                className="mobile-menu icon-button"
                aria-label="Toggle sidebar"
                aria-expanded={sidebarOpen}
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                <Menu size={20} />
              </button>
              <h2>Mission planner</h2>
              <span className="workspace-divider" />
              <span className="workspace-label">JEZERO EXPEDITION</span>
            </div>
            <div className="topbar-actions">
              <button className="library-button" onClick={() => setPanel('sources')}>
                <Database size={16} />
                Data library
              </button>
              <button className="primary" onClick={() => setPanel('export')}>
                <Upload size={16} />
                <span>Export mission</span>
              </button>
            </div>
          </header>
          <div className="mission-canvas">
            <TerrainMap
              layers={layers}
              route={route}
              stops={mission.stops}
              selected={selected}
              select={setSelected}
              placing={placing}
              place={place}
              progress={progress}
              showSources={() => setPanel('sources')}
            />
            <RouteCard
              name={mission.name}
              route={route}
              mode={mission.mode}
              setMode={(mode) => update({ mode })}
              settings={() => setPanel('settings')}
              running={running}
              progress={progress}
              toggle={() => {
                if (progress >= 1) setProgress(0);
                setRunning(!running);
              }}
              reset={() => {
                setRunning(false);
                setProgress(0);
              }}
              count={
                mission.stops.filter((stop) =>
                  sites.some((site) => site.id === stop.id && site.kind !== 'habitat')
                ).length
              }
            />
            {selectedStop && terrain && (
              <div className="station-inspector">
                <button
                  className="icon-button inspector-close"
                  aria-label="Close station details"
                  onClick={() => setSelected(null)}
                >
                  <X size={16} />
                </button>
                <span className="section-label">
                  <FlaskConical size={13} />
                  SCENARIO STATION
                </span>
                <h3>{selectedStop.name}</h3>
                <p>
                  {selectedSite?.description ||
                    'Custom transit waypoint in the local scenario. No science dwell time is assigned.'}
                </p>
                <div>
                  <span>
                    {terrain.elevationM.toFixed(0)} m <small>model elevation</small>
                  </span>
                  <span>
                    {terrain.slope.toFixed(1)}° <small>local slope</small>
                  </span>
                </div>
                <button className="text-button" onClick={() => setPanel('journal')}>
                  Record an observation <BookOpen size={13} />
                </button>
              </div>
            )}
            {!route.feasible && (
              <div className="warning-banner">
                <TriangleAlert size={17} />
                <div>
                  <strong>Mission needs adjustment</strong>
                  <p>{route.warnings[0]}</p>
                </div>
                <button className="text-button" onClick={() => setPanel('settings')}>
                  Adjust limits
                </button>
              </div>
            )}
            {running && (
              <div className="simulation-strip">
                <span className="live-dot" />
                <strong>Mission preview</strong>
                <span>{(progress * route.distanceKm).toFixed(2)} km previewed · accelerated playback</span>
              </div>
            )}
            {placing && (
              <button className="cancel-placement secondary" onClick={() => setPlacing(false)}>
                <X size={15} />
                Cancel placement
              </button>
            )}
          </div>
          <Profile route={route} progress={progress} />
        </main>}
        <footer className="statusbar">
          <div>
            <CheckCircle2 size={13} />
            <span>Offline ready</span>
            <i />
            <span>{fieldMode?'CTX terrain · offline field planning':'NASA imagery · scenario navigation'}</span>
          </div>
          <div>
            {!fieldMode&&<span className="save-status">
              {saved ? (
                <>
                  <Check size={12} />
                  Saved on this device
                </>
              ) : (
                <>
                  <TriangleAlert size={12} />
                  Storage unavailable — export to save
                </>
              )}
            </span>}
            <i />
            <button onClick={() => setPanel('about')}>CHITRA / AREO 1.2</button>
          </div>
        </footer>
      </div>
      {panel && (
        <Dialog
          title={panelCopy[panel][0]}
          subtitle={panelCopy[panel][1]}
          onClose={closePanel}
          wide={panel === 'sources' || panel === 'surface'}
        >
          {panel === 'sources' && <SourcesPanel />}
          {panel === 'settings' && (
            <SettingsPanel value={mission.constraints} onChange={(constraints) => update({ constraints })} />
          )}{' '}
          {panel === 'add' && (
            <AddStopPanel
              stops={mission.stops}
              onAdd={addStop}
              onPlace={() => {
                setPanel(null);
                setSelected(null);
                setPlacing(true);
                setSidebarOpen(false);
              }}
            />
          )}
          {panel === 'journal' && (
            <JournalPanel
              notes={mission.notes}
              stops={mission.stops}
              onAdd={(n) => {
                if (mission.notes.length >= 500) {
                  setToast('The notebook supports up to 500 observations.');
                  return;
                }
                update({ notes: [...mission.notes, n] });
                setToast('Observation saved.');
              }}
              onDelete={(id) => update({ notes: mission.notes.filter((n) => n.id !== id) })}
            />
          )}{' '}
          {panel === 'export' && (
            <ExportPanel mission={mission} route={route} onImport={() => fileInput.current?.click()} />
          )}{' '}
          {panel === 'about' && <AboutPanel />}
          {panel === 'surface' && (
            <figure className="surface-full">
              <img src="./assets/jezero-surface.jpg" alt="Perseverance view of the delta in Jezero Crater" />
              <figcaption>
                <strong>Ancient landscapes. New questions.</strong>
                <p>
                  Reference imagery from Perseverance’s Mastcam-Z instrument. Surface context helps connect
                  orbital patterns with rock textures and depositional history.
                </p>
                <a
                  href="https://science.nasa.gov/resource/perseverance-view-of-the-delta-in-jezero-crater/"
                  target="_blank"
                  rel="noreferrer"
                >
                  NASA image and full credit <ExternalLink size={13} />
                </a>
              </figcaption>
            </figure>
          )}
        </Dialog>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label="Import mission file"
        onChange={(e) => void importMission(e.target.files?.[0])}
      />
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      <section className="print-brief">
        <h1>AREO / Mission brief</h1>
        <h2>{mission.name}</h2>
        <p>Team CHITRA · NASA Space Apps competition prototype</p>
        <p>
          Route: {mission.stops.map((s) => s.name).join(' → ')} → {mission.stops[0].name}
        </p>
        <table>
          <tbody>
            {[
              ['Distance', `${route.distanceKm.toFixed(2)} km`],
              ['Total duration', formatMinutes(route.totalMinutes)],
              ['Science dwell', `${route.scienceMinutes} minutes`],
              ['Maximum slope', `${route.maxSlope.toFixed(1)}°`],
              ['Return reserve', `${Math.round(route.reserveMinutes)} minutes`],
              ['Mode', mission.mode],
              ['Modeled dose', `${route.radiationMsv.toFixed(3)} mSv`],
              ['Status', route.feasible ? 'Within scenario limits' : 'Requires adjustment'],
            ].map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Assumptions</h3>
        <p>
          EVA budget {mission.constraints.evaMinutes} min; reserve {mission.constraints.reservePercent}%;
          speed {mission.constraints.speedKmh} km/h; slope limit {mission.constraints.maxSlope}°; dose rate{' '}
          {mission.constraints.radiationRate} mSv/h.
        </p>
        {route.warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
        <h3>Field observations</h3>
        {mission.notes.length ? (
          mission.notes.map((n) => (
            <p key={n.id}>
              <strong>
                {n.site} / {n.category}:
              </strong>{' '}
              {n.text}
            </p>
          ))
        ) : (
          <p>No observations recorded.</p>
        )}
        <h3>Provenance & limits</h3>
        <p>
          NASA MRO HiRISE / CRISM imagery, Perseverance Mastcam-Z context, and USGS CTX elevation reference.
          Route coordinates, elevations, obstacles and dose are synthetic. Imagery is not registered to this
          scenario. Not for operational navigation. See bundled data/sources.json and docs/DATA_SOURCES.md.
        </p>
      </section>
    </>
  );
}
