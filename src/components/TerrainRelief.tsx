import { useEffect, useMemo, useRef, useState } from 'react';
import './TerrainRelief.css';

interface Cell { col: number; row: number }
interface TerrainReliefProps {
  width: number;
  height: number;
  elevations: readonly (number | null)[];
  route: readonly Cell[];
  current?: Cell;
  gridSpacingMeters?: readonly [number, number];
  xMeters?: readonly number[];
  yMeters?: readonly number[];
}

/** Orthographic surface visualization of the supplied measured heights.
 * Shading is illustrative; heights and route samples come from the input grid.
 */
export function TerrainRelief({ width, height, elevations, route, current, gridSpacingMeters = [58.75, 59.5], xMeters, yMeters }: TerrainReliefProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [azimuth, setAzimuth] = useState(325);
  const [exaggeration, setExaggeration] = useState(4);
  const valid = useMemo(() => elevations.filter((value): value is number => value !== null && Number.isFinite(value)), [elevations]);
  const minimum = valid.length ? Math.min(...valid) : 0;
  const maximum = valid.length ? Math.max(...valid) : 0;
  const [spacingX, spacingY] = gridSpacingMeters;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const bounds = canvas.getBoundingClientRect();
      const cw = bounds.width, ch = bounds.height, ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (!cw || !ch) return;
      canvas.width = Math.round(cw * ratio); canvas.height = Math.round(ch * ratio);
      ctx.scale(ratio, ratio); ctx.fillStyle = '#121719'; ctx.fillRect(0, 0, cw, ch);
      if (width < 2 || height < 2 || elevations.length !== width * height || !valid.length) {
        ctx.fillStyle = '#b7b8b2'; ctx.font = '13px Segoe UI, sans-serif';
        ctx.fillText('Measured elevation is unavailable.', 24, 44); return;
      }
      const angle = azimuth * Math.PI / 180, ca = Math.cos(angle), sa = Math.sin(angle);
      const valueAt = (col: number, row: number) => col < 0 || row < 0 || col >= width || row >= height ? undefined : elevations[Math.round(row) * width + Math.round(col)];
      const exactX = xMeters?.length === width ? xMeters : undefined;
      const exactY = yMeters?.length === height ? yMeters : undefined;
      const easting = (col: number) => exactX ? exactX[col] - (exactX[0] + exactX[width - 1]) / 2 : (col - (width - 1) / 2) * spacingX;
      const southing = (row: number) => exactY ? (exactY[0] + exactY[height - 1]) / 2 - exactY[row] : (row - (height - 1) / 2) * spacingY;
      const raw = (col: number, row: number, elevation: number) => {
        const x = easting(col);
        const y = southing(row);
        const rx = x * ca - y * sa, ry = x * sa + y * ca;
        const z = (elevation - minimum) * exaggeration;
        return { x: rx, y: ry * 0.52 - z * 0.85, depth: ry + z * 0.25 };
      };
      const corners = [raw(0, 0, minimum), raw(width - 1, 0, minimum), raw(0, height - 1, minimum), raw(width - 1, height - 1, minimum),
        raw(0, 0, maximum), raw(width - 1, 0, maximum), raw(0, height - 1, maximum), raw(width - 1, height - 1, maximum)];
      const left = Math.min(...corners.map(p => p.x)), right = Math.max(...corners.map(p => p.x));
      const top = Math.min(...corners.map(p => p.y)), bottom = Math.max(...corners.map(p => p.y));
      const scale = Math.min((cw - 64) / (right - left), (ch - 70) / (bottom - top));
      const screen = (point: ReturnType<typeof raw>) => ({ x: cw / 2 + (point.x - (left + right) / 2) * scale, y: ch / 2 + (point.y - (top + bottom) / 2) * scale + 4 });
      const project = (col: number, row: number, z: number) => screen(raw(col, row, z));
      type Face = { points: { x: number; y: number }[]; depth: number; shade: number; elevation: number };
      const faces: Face[] = [];
      const step = Math.max(1, Math.ceil(Math.max(width, height) / 60));
      for (let row = 0; row < height - 1; row += step) {
        for (let col = 0; col < width - 1; col += step) {
          const r1 = Math.min(row + step, height - 1), c1 = Math.min(col + step, width - 1);
          const cells = [[col, row], [c1, row], [c1, r1], [col, r1]];
          const heights = cells.map(([c, r]) => valueAt(c, r));
          if (heights.some(v => v == null || !Number.isFinite(v))) continue;
          const z = heights as number[];
          const points = cells.map(([c, r], i) => raw(c, r, z[i]));
          const slopeX = (z[1] - z[0]) / (easting(c1) - easting(col));
          const slopeY = (z[3] - z[0]) / (southing(r1) - southing(row));
          faces.push({ points: points.map(screen), depth: points.reduce((n, p) => n + p.depth, 0) / 4,
            shade: Math.max(-0.23, Math.min(0.23, (-slopeX - slopeY) * 0.7)), elevation: z.reduce((n, v) => n + v, 0) / 4 });
        }
      }
      faces.sort((a, b) => a.depth - b.depth);
      for (const face of faces) {
        const t = (face.elevation - minimum) / Math.max(maximum - minimum, 1);
        const light = 24 + t * 24 + face.shade * 35;
        ctx.beginPath(); face.points.forEach((p, index) => index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
        ctx.fillStyle = `hsl(${32 - t * 8} 23% ${light}%)`; ctx.fill();
        ctx.strokeStyle = 'rgba(220,199,173,0.10)'; ctx.lineWidth = 0.5; ctx.stroke();
      }
      ctx.beginPath(); let started = false;
      for (const cell of route) {
        const z = valueAt(cell.col, cell.row);
        if (z == null || !Number.isFinite(z)) { started = false; continue; }
        const p = project(cell.col, cell.row, z);
        if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = '#ffc186'; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.stroke();
      const markers = route.length ? [route[0], route[route.length - 1]] : [];
      markers.forEach((cell, index) => {
        const z = valueAt(cell.col, cell.row); if (z == null) return;
        const p = project(cell.col, cell.row, z);
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fillStyle = index ? '#ffc186' : '#9bcea9'; ctx.fill();
      });
      if (current) {
        const z = valueAt(current.col, current.row);
        if (z != null) {
          const p = project(current.col, current.row, z);
          ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fillStyle = '#f9f4e7'; ctx.fill();
          ctx.strokeStyle = '#f18e55'; ctx.lineWidth = 2; ctx.stroke();
        }
      }
      ctx.font = '11px Segoe UI, sans-serif'; ctx.fillStyle = '#bdc5be';
      const origin = { x: 37, y: ch - 34 };
      const axes = [{ x: ca * 23, y: sa * 0.52 * 23, label: 'E' }, { x: sa * 23, y: -ca * 0.52 * 23, label: 'N' }];
      for (const axis of axes) {
        ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(origin.x + axis.x, origin.y + axis.y);
        ctx.strokeStyle = '#85918a'; ctx.lineWidth = 1; ctx.stroke(); ctx.fillText(axis.label, origin.x + axis.x + 4, origin.y + axis.y + 4);
      }
      ctx.fillStyle = '#aeb7af'; ctx.fillText(`${exaggeration}× vertical exaggeration`, 18, 24);
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas);
    return () => observer.disconnect();
  }, [width, height, elevations, route, current, azimuth, exaggeration, spacingX, spacingY, minimum, maximum, valid.length, xMeters, yMeters]);

  return <section className="terrain-relief" aria-label="Measured terrain relief">
    <div className="terrain-relief-heading"><div><h3>Terrain relief</h3><p>Measured CTX elevation · illustrative lighting</p></div><span>{minimum.toFixed(0)} to {maximum.toFixed(0)} m</span></div>
    <canvas ref={canvasRef} role="img" aria-label={`Oblique view of measured terrain with the selected route. Heights ${minimum.toFixed(0)} to ${maximum.toFixed(0)} metres; vertical scale exaggerated ${exaggeration} times.`}>Measured terrain relief. Adjust orientation and vertical exaggeration using the controls below.</canvas>
    <div className="terrain-relief-controls">
      <label><span>Orientation <output>{azimuth}°</output></span><input aria-label="Terrain relief orientation" type="range" min="0" max="360" step="5" value={azimuth} onChange={e => setAzimuth(Number(e.target.value))} /></label>
      <label><span>Vertical scale <output>{exaggeration}×</output></span><input aria-label="Terrain relief vertical exaggeration" type="range" min="1" max="12" step="1" value={exaggeration} onChange={e => setExaggeration(Number(e.target.value))} /></label>
    </div>
    <p className="terrain-relief-note">Regional relief only. Gaps are missing data; the mesh cannot resolve individual rocks or safe footing.</p>
  </section>;
}
