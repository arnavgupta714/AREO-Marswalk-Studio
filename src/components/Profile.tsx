import { ArrowUpRight, Mountain } from 'lucide-react';
import { formatMinutes } from '../lib/mission';
import type { RouteResult } from '../lib/routeEngine';
export default function Profile({ route, progress }: { route: RouteResult; progress: number }) {
  const data = route.profile;
  const min = Math.min(...data.map((p) => p.elevationM), 0);
  const max = Math.max(...data.map((p) => p.elevationM), min + 1);
  const lo = data.length ? Math.min(...data.map((p) => p.elevationM)) - 12 : 0;
  const hi = data.length ? Math.max(...data.map((p) => p.elevationM)) + 12 : 100;
  const points = data
    .map(
      (p) =>
        `${(p.distanceKm / (route.distanceKm || 1)) * 1000},${95 - ((p.elevationM - lo) / (hi - lo)) * 75}`
    )
    .join(' ');
  return (
    <section className="profile-panel">
      <div className="profile-header">
        <div>
          <span className="section-label">
            <Mountain size={14} />
            Traverse profile
          </span>
          <p>Simulated elevation along your route</p>
        </div>
        <div className="profile-stats">
          <span>
            <ArrowUpRight size={13} />
            {Math.round(route.ascentM)} m <small>ascent</small>
          </span>
          <span>
            {route.maxSlope.toFixed(1)}° <small>max slope</small>
          </span>
          <span>
            {formatMinutes(route.walkingMinutes)} <small>walking</small>
          </span>
        </div>
      </div>
      <div className="profile-chart">
        <div className="chart-y">
          <span>{Math.round(hi)} m</span>
          <span>{Math.round(lo)} m</span>
        </div>
        <svg
          viewBox="0 0 1000 115"
          preserveAspectRatio="none"
          aria-label={`Simulated elevation profile, ${Math.round(route.ascentM)} meters ascent`}
          role="img"
        >
          <defs>
            <linearGradient id="profile-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#eb9668" stopOpacity=".25" />
              <stop offset="100%" stopColor="#eb9668" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[20, 55, 90].map((y) => (
            <line
              key={y}
              x1="0"
              x2="1000"
              y1={y}
              y2={y}
              stroke="#ffffff"
              strokeOpacity=".06"
              strokeDasharray="3 6"
            />
          ))}
          <polygon points={`0,110 ${points} 1000,110`} fill="url(#profile-fill)" />
          <polyline
            points={points}
            fill="none"
            stroke="#ed9a6c"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          {progress > 0 && (
            <line
              x1={progress * 1000}
              x2={progress * 1000}
              y1="0"
              y2="110"
              stroke="#fff"
              strokeDasharray="3 3"
            />
          )}
        </svg>
      </div>
      <div className="chart-x">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f}>{(f * route.distanceKm).toFixed(1)} km</span>
        ))}
      </div>
      <span className="sr-only">
        Elevation range {min} to {max}
      </span>
    </section>
  );
}
