import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Image,
  Layers,
  Mountain,
  Plus,
  TriangleAlert,
  X,
  ArrowUpRight,
} from 'lucide-react';
import type { Stop } from '../lib/mission';
export interface LayersState {
  orbital: boolean;
  elevation: boolean;
  minerals: boolean;
  hazards: boolean;
}
interface Props {
  layers: LayersState;
  setLayer: (key: keyof LayersState) => void;
  stops: Stop[];
  selected: string | null;
  select: (id: string) => void;
  remove: (id: string) => void;
  move: (index: number, direction: number) => void;
  add: () => void;
  preset: (value: string) => void;
  onImage: () => void;
}
export default function Sidebar(p: Props) {
  const layerRows = [
    { key: 'orbital' as const, title: 'Orbital imagery', source: 'MRO · HiRISE observation', Icon: Image },
    {
      key: 'elevation' as const,
      title: 'Elevation model',
      source: 'Illustrative terrain · simulated',
      Icon: Layers,
    },
    {
      key: 'minerals' as const,
      title: 'Mineral signatures',
      source: 'MRO · CRISM reference',
      Icon: Mountain,
    },
    {
      key: 'hazards' as const,
      title: 'Terrain hazards',
      source: 'Scenario obstacles · simulated',
      Icon: TriangleAlert,
    },
  ];
  return (
    <aside className="sidebar">
      <div className="wordmark">
        AREO<span>BY CHITRA</span>
      </div>
      <div className="mission-intro">
        <h2>
          Jezero traverse
          <span className="tiny-dot" />
        </h2>
        <p>A new perspective on the red planet.</p>
      </div>
      <div className="select-wrap">
        <select aria-label="Mission preset" defaultValue="delta" onChange={(e) => p.preset(e.target.value)}>
          <option value="delta">Jezero · delta reconnaissance</option>
          <option value="minerals">Jezero · mineral expedition</option>
          <option value="crater">Jezero · crater survey</option>
        </select>
        <ChevronDown size={14} />
      </div>
      <section className="sidebar-section">
        <div className="section-label">
          Data layers <span>04</span>
        </div>
        <div className="layer-list">
          {layerRows.map(({ key, title, source, Icon }) => (
            <button
              key={key}
              className="layer-row"
              role="switch"
              aria-checked={p.layers[key]}
              aria-label={title}
              onClick={() => p.setLayer(key)}
            >
              <Icon size={19} />
              <span className="layer-copy">
                <strong>{title}</strong>
                <small>{source}</small>
              </span>
              <span className={`switch ${p.layers[key] ? 'on' : ''}`} />
            </button>
          ))}
        </div>
      </section>
      <section className="sidebar-section stops-section">
        <div className="section-label">
          Route stops <span>{String(p.stops.length).padStart(2, '0')}</span>
        </div>
        <div className="stops-list">
          {p.stops.map((s, i) => (
            <div key={s.id} className={`stop-row ${p.selected === s.id ? 'selected' : ''}`}>
              <button className="stop-main" onClick={() => p.select(s.id)}>
                <span className="stop-index">
                  {i === 0 ? <span className="home-dot" /> : String(i).padStart(2, '0')}
                </span>
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {i === 0 ? 'Departure & return' : `Sector ${Math.round(s.x)} / ${Math.round(s.y)}`}
                  </small>
                </span>
              </button>
              {i > 0 && (
                <div className="stop-actions">
                  <button aria-label={`Move ${s.name} up`} disabled={i === 1} onClick={() => p.move(i, -1)}>
                    <ArrowUp size={12} />
                  </button>
                  <button
                    aria-label={`Move ${s.name} down`}
                    disabled={i === p.stops.length - 1}
                    onClick={() => p.move(i, 1)}
                  >
                    <ArrowDown size={12} />
                  </button>
                  <button aria-label={`Remove ${s.name}`} onClick={() => p.remove(s.id)}>
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <button className="add-stop" disabled={p.stops.length >= 12} onClick={p.add}>
          <Plus size={14} />
          Add a science stop
        </button>
        <p className="return-note">Return to habitat included in every route.</p>
      </section>
      <button className="surface-preview" onClick={p.onImage}>
        <img src="./assets/jezero-surface.jpg" alt="Perseverance view of the Jezero delta" />
        <span>
          <span>
            From the surface<small>Perseverance · Mastcam-Z</small>
          </span>
          <ArrowUpRight size={18} />
        </span>
      </button>
      <div className="sidebar-foot">Built for the next giant leap.</div>
    </aside>
  );
}
