import { useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Crosshair, Minus, Plus, MousePointer2, ArrowUpRight } from 'lucide-react';
import { hazards, terrainAt, type Point, type RouteResult } from '../lib/routeEngine';
import type { Stop } from '../lib/mission';
import type { LayersState } from './Sidebar';
interface Props {
  layers: LayersState;
  route: RouteResult;
  stops: Stop[];
  selected: string | null;
  select: (id: string) => void;
  placing: boolean;
  place: (p: Point) => void;
  progress: number;
  showSources: () => void;
}
function makeContours() {
  const segments: string[] = [];
  const step = 20;
  for (let y = 0; y < 700; y += step)
    for (let x = 0; x < 1000; x += step) {
      const corners = [
        { x, y },
        { x: x + step, y },
        { x: x + step, y: y + step },
        { x, y: y + step },
      ];
      const v = corners.map((p) => terrainAt(p).elevationM);
      for (let level = Math.ceil(Math.min(...v) / 20) * 20; level <= Math.max(...v); level += 20) {
        const hits: Point[] = [];
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          if (v[i] < level !== v[j] < level) {
            const t = (level - v[i]) / (v[j] - v[i]);
            hits.push({
              x: corners[i].x + (corners[j].x - corners[i].x) * t,
              y: corners[i].y + (corners[j].y - corners[i].y) * t,
            });
          }
        }
        for (let i = 0; i + 1 < hits.length; i += 2)
          segments.push(
            `M${hits[i].x.toFixed(1)},${hits[i].y.toFixed(1)}L${hits[i + 1].x.toFixed(1)},${hits[i + 1].y.toFixed(1)}`
          );
      }
    }
  return segments.join(' ');
}
export default function TerrainMap(p: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const contour = useMemo(makeContours, []);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.max(entry.contentRect.width / 1000, entry.contentRect.height / 700));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const path = p.route.path.map((q, i) => `${i ? 'L' : 'M'}${q.x},${q.y}`).join(' ');
  const target = p.progress * p.route.distanceKm;
  const next = p.route.profile.findIndex((sample) => sample.distanceKm >= target);
  let walker = p.route.path.at(-1);
  if (next === 0) walker = p.route.path[0];
  else if (next > 0) {
    const a = p.route.path[next - 1],
      b = p.route.path[next];
    const first = p.route.profile[next - 1].distanceKm,
      last = p.route.profile[next].distanceKm;
    const f = (target - first) / (last - first || 1);
    walker = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }
  const changeZoom = (z: number) => {
    setZoom(Math.min(3, Math.max(1, z)));
    if (z <= 1) setPan({ x: 0, y: 0 });
  };
  return (
    <section className={`terrain ${p.placing ? 'placing' : ''}`} aria-label="Interactive Mars scenario map">
      <svg
        ref={svg}
        className="map-svg"
        viewBox="0 0 1000 700"
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label="NASA Jezero orbital image with illustrative route overlay"
        onWheel={(e) => changeZoom(zoom + (e.deltaY < 0 ? 0.15 : -0.15))}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('[data-stop]')) return;
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current || p.placing) return;
          const dx = e.clientX - drag.current.x,
            dy = e.clientY - drag.current.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true;
          const rect = e.currentTarget.getBoundingClientRect();
          const scale = Math.max(rect.width / 1000, rect.height / 700);
          setPan({
            x: Math.max(-350, Math.min(350, drag.current.px + dx / scale)),
            y: Math.max(-250, Math.min(250, drag.current.py + dy / scale)),
          });
        }}
        onPointerUp={(e) => {
          if (p.placing && drag.current && !drag.current.moved) {
            const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(
              svg.current!.getScreenCTM()!.inverse()
            );
            p.place({ x: (pt.x - 500 - pan.x) / zoom + 500, y: (pt.y - 350 - pan.y) / zoom + 350 });
          }
          drag.current = null;
        }}
      >
        <defs>
          <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
            <path d="M100 0H0V100" fill="none" stroke="#fff" strokeOpacity=".06" />
          </pattern>
          <pattern
            id="hazard-hatch"
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(35)"
          >
            <line y2="8" stroke="#f0b789" strokeOpacity=".3" strokeWidth="2" />
          </pattern>
          <filter id="route-glow">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <rect width="1000" height="700" fill="#272827" />
        <g transform={`translate(${500 + pan.x} ${350 + pan.y}) scale(${zoom}) translate(-500 -350)`}>
          {p.layers.orbital && (
            <image
              href="./assets/jezero-orbital.jpg"
              width="1000"
              height="700"
              preserveAspectRatio="xMidYMid slice"
            />
          )}
          <rect width="1000" height="700" fill="#080d11" opacity={p.layers.orbital ? 0.12 : 0} />
          <rect width="1000" height="700" fill="url(#grid)" />
          {p.layers.elevation && (
            <path d={contour} fill="none" stroke="#eee5d2" strokeWidth=".65" opacity=".23" />
          )}
          {p.layers.hazards &&
            hazards.map((h) => (
              <g key={h.id}>
                <ellipse
                  cx={h.x}
                  cy={h.y}
                  rx={h.rx}
                  ry={h.ry}
                  fill="url(#hazard-hatch)"
                  stroke="#dfa77a"
                  strokeDasharray="4 5"
                  strokeOpacity=".55"
                />
                <text x={h.x} y={h.y + 3} className="hazard-label" textAnchor="middle">
                  {h.name.toUpperCase()}
                </text>
              </g>
            ))}
          <path d={path} fill="none" stroke="#080a0b" strokeWidth="8" opacity=".38" />
          <path d={path} fill="none" stroke="#f2a377" strokeWidth="2.6" strokeLinejoin="round" />
          <path d={path} fill="none" stroke="#ffe1cd" strokeWidth=".8" strokeDasharray="3 11" opacity=".8" />
          {p.stops.map((s, i) => (
            <g
              key={s.id}
              data-stop={s.id}
              className="map-marker"
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${s.name}`}
              onClick={() => p.select(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  p.select(s.id);
                }
              }}
              transform={`translate(${s.x} ${s.y})`}
            >
              <circle r={p.selected === s.id ? 25 : 18} fill="#ec9568" opacity=".13" />
              <circle
                r="9"
                fill={i === 0 ? '#e8e6df' : '#191e20'}
                stroke={i === 0 ? '#fff' : '#f5a578'}
                strokeWidth="2"
              />
              <text
                y="3.5"
                textAnchor="middle"
                fill={i === 0 ? '#222' : '#fff'}
                fontSize="9"
                fontWeight="600"
              >
                {i === 0 ? 'H' : i}
              </text>
              <rect
                x="16"
                y="-12"
                width={s.name.length * 5.5 + 17}
                height="24"
                rx="4"
                fill="#101619"
                fillOpacity=".82"
              />
              <text x="24" y="3.5" fill="#eeece5" fontSize="9.5" fontWeight="500">
                {s.name}
              </text>
            </g>
          ))}
          {p.progress > 0 && walker && (
            <g transform={`translate(${walker.x} ${walker.y})`}>
              <circle r="13" fill="#fff" opacity=".13" />
              <circle r="4" fill="#fff" stroke="#e68b57" strokeWidth="2" />
            </g>
          )}
        </g>
      </svg>
      <div className="map-vignette" />
      <div className="map-heading">
        <div className="location-line">
          <span className="location-dot" />
          JEZERO CRATER <span>/</span> MARS 2020
        </div>
        <h1>
          Every step.
          <br />
          <span>A new discovery.</span>
        </h1>
        <div className="map-mode">
          <span />
          MISSION SIMULATION <span className="mode-divider" />5 × 3.5 km scenario
        </div>
      </div>
      {p.placing && (
        <div className="placing-message">
          <MousePointer2 size={16} />
          Click the terrain to place a waypoint
        </div>
      )}
      {p.layers.minerals && (
        <div className="mineral-reference">
          <button className="reference-header" onClick={p.showSources}>
            CRISM mineral context <ArrowUpRight size={13} />
          </button>
          <img src="./assets/jezero-spectral.jpg" alt="NASA CRISM map of minerals in Jezero Crater" />
          <span>Regional reference · separate image extent</span>
        </div>
      )}
      <div className="map-bottom">
        <div className="map-scale">
          <span style={{ width: 100 * zoom * scale }}>500 m</span>
          <small>Scenario scale · image not registered</small>
        </div>
        <div className="map-tools">
          <button
            title="Reset map view"
            aria-label="Reset map view"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            <Crosshair size={17} />
          </button>
          <div>
            <button aria-label="Zoom in" onClick={() => changeZoom(zoom + 0.25)}>
              <Plus size={18} />
            </button>
            <button aria-label="Zoom out" onClick={() => changeZoom(zoom - 0.25)}>
              <Minus size={18} />
            </button>
          </div>
          <span className="compass">
            <Compass size={23} />
            <small>IMAGE UP</small>
          </span>
        </div>
      </div>
      <div className="image-credit">NASA / JPL / University of Arizona · HiRISE</div>
    </section>
  );
}
