import {
  ArrowRight,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type { RouteMode, RouteResult } from '../lib/routeEngine';
import { formatMinutes } from '../lib/mission';
interface Props {
  name: string;
  route: RouteResult;
  mode: RouteMode;
  setMode: (m: RouteMode) => void;
  settings: () => void;
  running: boolean;
  progress: number;
  toggle: () => void;
  reset: () => void;
  count: number;
}
export default function RouteCard(p: Props) {
  return (
    <div className="route-card">
      <div className="route-card-heading">
        <span className="section-label">
          EVA 01 <span className="draft-dot" /> {p.progress > 0 ? 'IN SIMULATION' : 'MISSION PLAN'}
        </span>
        <button className="icon-button" aria-label="Mission constraints" onClick={p.settings}>
          <SlidersHorizontal size={16} />
        </button>
      </div>
      <h2>{p.name}</h2>
      <div className="route-metrics">
        <div>
          <span>DISTANCE</span>
          <strong>
            {p.route.distanceKm.toFixed(2)}
            <small>km</small>
          </strong>
        </div>
        <div>
          <span>DURATION</span>
          <strong className="duration">{formatMinutes(p.route.totalMinutes)}</strong>
        </div>
        <div>
          <span>SCIENCE STOPS</span>
          <strong>
            {p.count}
            <small>sites</small>
          </strong>
        </div>
      </div>
      <div className="route-choice">
        <span className="section-label">Route priority</span>
        <div className="segments">
          {(['balanced', 'safest', 'science'] as RouteMode[]).map((m) => (
            <button key={m} className={p.mode === m ? 'active' : ''} onClick={() => p.setMode(m)}>
              {m === 'balanced' ? 'Balanced' : m === 'safest' ? 'Lower risk' : 'Science'}
            </button>
          ))}
        </div>
      </div>
      <p className="mode-explanation">
        {p.mode === 'balanced'
          ? 'Distance, terrain and science in balance.'
          : p.mode === 'safest'
            ? 'Stronger penalties for slope and roughness.'
            : 'Favors terrain near science destinations.'}
      </p>
      <div className={`route-feasibility ${p.route.feasible ? '' : 'caution'}`}>
        {p.route.feasible ? <ShieldCheck size={15} /> : <TriangleAlert size={15} />}
        <span>{p.route.feasible ? 'Within scenario limits' : 'Review mission limits'}</span>
        <strong>{Math.round(p.route.reserveMinutes)}m reserve</strong>
      </div>
      <button className="primary simulation-button" disabled={!p.route.feasible} onClick={p.toggle}>
        {p.running ? <Pause size={17} /> : <Play size={17} />}
        <span>
          {p.running
            ? 'Pause simulation'
            : p.progress >= 1
              ? 'Replay mission'
              : p.progress > 0
                ? 'Resume simulation'
                : 'Begin simulation'}
        </span>
        <ArrowRight size={16} />
      </button>
      {p.progress > 0 && (
        <div className="playback">
          <div>
            <span style={{ width: `${p.progress * 100}%` }} />
          </div>
          <span>{Math.round(p.progress * 100)}%</span>
          <button className="icon-button" aria-label="Reset simulation" onClick={p.reset}>
            <RotateCcw size={13} />
          </button>
        </div>
      )}
      <span className="card-footnote">Planning estimates · not flight-qualified</span>
    </div>
  );
}
