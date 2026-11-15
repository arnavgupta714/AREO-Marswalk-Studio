import { useEffect, useState } from 'react';
import ElevationExplorer from './ElevationExplorer';
import {
  Download,
  ExternalLink,
  FileJson,
  FileText,
  Plus,
  Trash2,
  Upload,
  ArrowUpRight,
  CircleHelp,
  Mountain,
  ShieldCheck,
} from 'lucide-react';
import type { Constraints, RouteResult } from '../lib/routeEngine';
import { defaults, sites } from '../lib/routeEngine';
import { downloadFile, formatMinutes, type Mission, type Observation, type Stop } from '../lib/mission';

export function SettingsPanel({
  value,
  onChange,
}: {
  value: Constraints;
  onChange: (c: Constraints) => void;
}) {
  const fields: {
    key: keyof Constraints;
    label: string;
    unit: string;
    min: number;
    max: number;
    step: number;
    help: string;
  }[] = [
    {
      key: 'evaMinutes',
      label: 'EVA time budget',
      unit: 'min',
      min: 60,
      max: 600,
      step: 15,
      help: 'Total time available, including science stops and return.',
    },
    {
      key: 'reservePercent',
      label: 'Required return reserve',
      unit: '%',
      min: 10,
      max: 50,
      step: 5,
      help: 'The portion of the budget that must remain at habitat.',
    },
    {
      key: 'maxSlope',
      label: 'Maximum terrain slope',
      unit: '°',
      min: 5,
      max: 30,
      step: 1,
      help: 'A hard limit: routes cannot cross steeper model terrain.',
    },
    {
      key: 'speedKmh',
      label: 'Level-ground walking speed',
      unit: 'km/h',
      min: 1,
      max: 6,
      step: 0.25,
      help: 'Terrain roughness and slope add a walking time penalty.',
    },
    {
      key: 'radiationRate',
      label: 'Assumed radiation dose rate',
      unit: 'mSv/h',
      min: 0,
      max: 0.1,
      step: 0.005,
      help: 'User-defined scenario assumption; not a measured forecast.',
    },
  ];
  return (
    <>
      <div className="info-box">
        <ShieldCheck size={20} />
        <p>
          Change the assumptions and the route recalculates. These are scenario planning limits, not approved
          spacesuit specifications.
        </p>
      </div>
      <div className="settings-list">
        {fields.map((f) => (
          <label className="setting" key={f.key}>
            <span>
              <strong>{f.label}</strong>
              <b>
                {value[f.key]} <small>{f.unit}</small>
              </b>
            </span>
            <input
              type="range"
              min={f.min}
              max={f.max}
              step={f.step}
              value={value[f.key]}
              onChange={(e) => onChange({ ...value, [f.key]: Number(e.target.value) })}
            />
            <small>{f.help}</small>
          </label>
        ))}
      </div>
      <button className="secondary" onClick={() => onChange({ ...defaults })}>
        Restore scenario defaults
      </button>
    </>
  );
}

export function AddStopPanel({
  stops,
  onAdd,
  onPlace,
}: {
  stops: Stop[];
  onAdd: (s: Stop) => void;
  onPlace: () => void;
}) {
  return (
    <>
      <p className="panel-intro">
        Choose a science objective, or place a custom waypoint on the scenario map.
      </p>
      <div className="site-options">
        {sites
          .filter((s) => s.kind !== 'habitat')
          .map((s) => (
            <button key={s.id} disabled={stops.some((x) => x.id === s.id)} onClick={() => onAdd(s)}>
              <span className="site-icon">
                <Mountain size={21} />
              </span>
              <span>
                <strong>{s.name}</strong>
                <p>{s.description}</p>
                <small>
                  {s.dwellMinutes} min science activity ·{' '}
                  {stops.some((x) => x.id === s.id) ? 'Already on route' : 'Add to itinerary'}
                </small>
              </span>
              <Plus size={18} />
            </button>
          ))}
      </div>
      <button className="secondary full-width" onClick={onPlace}>
        <Plus size={16} />
        Place a custom waypoint
      </button>
      <p className="fine-print">
        All stop positions are hypothetical. Custom waypoints are transit points with no science dwell time.
      </p>
    </>
  );
}

export function JournalPanel({
  notes,
  stops,
  onAdd,
  onDelete,
}: {
  notes: Observation[];
  stops: Stop[];
  onAdd: (n: Observation) => void;
  onDelete: (id: string) => void;
}) {
  const [site, setSite] = useState(stops[1]?.name || 'General');
  const [category, setCategory] = useState('Geology');
  const [text, setText] = useState('');
  return (
    <>
      <form
        className="journal-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onAdd({
            id: crypto.randomUUID(),
            site,
            category,
            text: text.trim(),
            createdAt: new Date().toISOString(),
          });
          setText('');
        }}
      >
        <div className="form-row">
          <label>
            Science station
            <select value={site} onChange={(e) => setSite(e.target.value)}>
              {stops.map((s) => (
                <option key={s.id}>{s.name}</option>
              ))}
              <option>General</option>
            </select>
          </label>
          <label>
            Discipline
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option>Geology</option>
              <option>Atmosphere</option>
              <option>Imaging</option>
              <option>Operations</option>
            </select>
          </label>
        </div>
        <label>
          Field observation
          <textarea
            placeholder="Describe textures, layers, sample context, or a question for the next traverse…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={10000}
            required
            rows={4}
          />
        </label>
        <button type="submit" className="primary" disabled={!text.trim()}>
          <Plus size={16} />
          Save observation
        </button>
      </form>
      <div className="journal-heading">
        <span className="section-label">Mission notebook ({notes.length})</span>
        {notes.length > 0 && (
          <button
            className="text-button"
            onClick={() => {
              const rows = [
                ['Time', 'Station', 'Discipline', 'Observation'],
                ...notes.map((n) => [n.createdAt, n.site, n.category, n.text]),
              ];
              const safe = (s: string) => {
                const guarded = /^[=+@\-\t\r]/.test(s) ? `'${s}` : s;
                return `"${guarded.replaceAll('"', '""')}"`;
              };
              downloadFile(
                'areo-field-notes.csv',
                rows.map((r) => r.map(safe).join(',')).join('\r\n'),
                'text/csv'
              );
            }}
          >
            <Download size={13} />
            Export CSV
          </button>
        )}
      </div>
      {!notes.length ? (
        <div className="empty-state">
          <FileText size={27} />
          <h3>Science starts with a question.</h3>
          <p>
            Record your first observation. Notes are saved on this device and included in your mission export.
          </p>
        </div>
      ) : (
        <div className="notes-list">
          {[...notes].reverse().map((n) => (
            <article key={n.id}>
              <div>
                <span>
                  {n.category} / {n.site}
                </span>
                <button
                  className="icon-button"
                  aria-label="Delete observation"
                  onClick={() => onDelete(n.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <p>{n.text}</p>
              <time>{new Date(n.createdAt).toLocaleString()}</time>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

export function ExportPanel({
  mission,
  route,
  onImport,
}: {
  mission: Mission;
  route: RouteResult;
  onImport: () => void;
}) {
  const exportData = () =>
    downloadFile(
      'areo-mission.json',
      JSON.stringify(
        {
          ...mission,
          exportedAt: new Date().toISOString(),
          coordinateSystem:
            'Local synthetic scenario, x 0–1000, y 0–700, 5 meters per unit. Not planetary coordinates.',
          model: route.model,
          summary: {
            distanceKm: route.distanceKm,
            totalMinutes: route.totalMinutes,
            radiationMsv: route.radiationMsv,
            feasible: route.feasible,
            warnings: route.warnings,
          },
          route: route.path,
          provenance:
            'See bundled data/sources.json and docs/DATA_SOURCES.md. NASA imagery is unregistered contextual background. Routing terrain is synthetic.',
        },
        null,
        2
      )
    );
  return (
    <>
      <div className="export-summary">
        <span className="section-label">Your mission, ready to take with you</span>
        <h3>{mission.name}</h3>
        <div>
          <span>{route.distanceKm.toFixed(2)} km round trip</span>
          <span>{formatMinutes(route.totalMinutes)}</span>
          <span>{mission.notes.length} observations</span>
        </div>
      </div>
      <button className="export-option" onClick={exportData}>
        <FileJson size={25} />
        <span>
          <strong>Download mission package</strong>
          <small>JSON · route, assumptions, stops and field notes</small>
        </span>
        <Download size={18} />
      </button>
      <button className="export-option" onClick={() => window.print()}>
        <FileText size={25} />
        <span>
          <strong>Print mission brief</strong>
          <small>Print or save a portable PDF briefing</small>
        </span>
        <ArrowUpRight size={18} />
      </button>
      <button className="export-option" onClick={onImport}>
        <Upload size={25} />
        <span>
          <strong>Import a saved mission</strong>
          <small>Restore a validated AREO version 1 JSON file</small>
        </span>
        <ArrowUpRight size={18} />
      </button>
      <p className="fine-print">
        Exports include scenario assumptions and data provenance. Original science assets remain bundled with
        the application and source repository.
      </p>
    </>
  );
}

export function AboutPanel() {
  return (
    <>
      <div className="about-team">
        <img
          src="./assets/team-chitra-reference.png"
          alt="Team CHITRA supplied artwork, showing explorers looking toward space"
        />
        <div>
          <div className="wordmark">
            AREO<span>BY CHITRA</span>
          </div>
          <h3>Built for the next giant leap.</h3>
          <p>
            A Marswalk mission studio for NASA Space Apps. Explore the evidence, plan an excursion, and bring
            the science home.
          </p>
        </div>
      </div>
      <div className="info-box">
        <CircleHelp size={22} />
        <p>
          Independent competition prototype by Team CHITRA. NASA imagery and science references are credited
          individually. This project is not an official NASA product.
        </p>
      </div>
      <h3>Three ideas behind AREO</h3>
      <ol className="about-principles">
        <li>
          <strong>Evidence before confidence.</strong> Every layer explains its source and what it can
          actually tell you.
        </li>
        <li>
          <strong>The return is part of the mission.</strong> Route planning includes the journey home and a
          configurable time reserve.
        </li>
        <li>
          <strong>Discovery keeps working offline.</strong> Bundled imagery, local calculations, and a
          persistent science notebook travel with the crew.
        </li>
      </ol>
      <p className="fine-print">
        Map: drag to pan, scroll or use + / − to zoom, select a station to inspect it. Use Add a science stop
        for custom waypoints. Esc closes any dialog. Simulation plays an accelerated route preview, not live
        telemetry.
      </p>
    </>
  );
}

interface Source {
  id: string;
  title: string;
  category: string;
  instrument: string;
  classification: string;
  url: string;
  credit: string;
  summary: string;
  limitations: string;
  asset?: string;
}

export function SourcesPanel() {
  const [sources, setSources] = useState<Source[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('./data/sources.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Missing source catalog');
        return response.json() as Promise<{ sources: Source[] }>;
      })
      .then((catalog) => setSources(catalog.sources))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  return (
    <>
      <div className="info-box">
        <ShieldCheck size={21} />
        <p>
          Explore optical imagery, mineral context and measured elevations. All five images and the elevation
          grid are bundled for offline use.
        </p>
      </div>
      {!sources.length && (
        <p className="fine-print">
          {failed ? 'The source catalog could not be loaded.' : 'Loading source catalog…'}
        </p>
      )}
      <div className="source-grid">
        {sources
          .filter((source) => source.asset)
          .map((source) => (
            <article className="source-card" key={source.id}>
              <img src={`./${source.asset}`} alt={source.title} />
              <div>
                <span className="source-type">
                  {source.category} /{' '}
                  {source.classification === 'observed-derived' ? 'DERIVED' : 'OBSERVATION'}
                </span>
                <h3>{source.title}</h3>
                <span className="source-mission">
                  {source.instrument} · {source.credit}
                </span>
                <p>{source.summary}</p>
                <a href={source.url} target="_blank" rel="noreferrer">
                  Open science source <ExternalLink size={12} />
                </a>
              </div>
            </article>
          ))}
      </div>
      <ElevationExplorer />
      <div className="source-disclosure">
        <h3>What is simulated?</h3>
        <p>
          The habitat, science-stop locations, route contours, hazards and radiation assumptions are a
          deterministic training scenario. Scenario overlays are not co-registered with the optical image. The
          measured elevation grid supports science interpretation and is separate from the route calculation.
        </p>
        <div className="source-links">
          {sources
            .filter((source) => !source.asset && source.url)
            .map((source) => (
              <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
                {source.title} <ExternalLink size={12} />
              </a>
            ))}
        </div>
        <a href="./data/sources.json" download="areo-sources.json">
          <Download size={14} />
          Download provenance manifest
        </a>
      </div>
    </>
  );
}
