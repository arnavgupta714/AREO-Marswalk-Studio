import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Layers, Minus, Plus, Route } from 'lucide-react';
import {
  measuredPoint,
  nearestMeasuredCell,
  type GridCell,
  type MeasuredGrid,
  type MeasuredStop,
  type MeasuredPoint,
} from '../lib/measuredRoute';

interface Props {
  grid: MeasuredGrid;
  bounds: readonly number[];
  path: readonly MeasuredPoint[];
  returnPath: readonly MeasuredPoint[];
  previewPath?: readonly MeasuredPoint[];
  destination?: GridCell;
  selectingDestination?: boolean;
  onToggleDestination: () => void;
  stops: readonly MeasuredStop[];
  exclusions: readonly GridCell[];
  cursor: GridCell;
  current?: GridCell;
  onSelect: (cell: GridCell) => void;
}

export default function MeasuredMap({
  grid,
  bounds,
  path,
  returnPath,
  previewPath = [],
  destination,
  selectingDestination = false,
  onToggleDestination,
  stops,
  exclusions,
  cursor,
  current,
  onSelect,
}: Props) {
  const [base, setBase] = useState<'ortho' | 'elevation'>('ortho');
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<{ x: number; y: number } | null>(null);
  const pointer = useRef<{
    x: number;
    y: number;
    cx: number;
    cy: number;
    scale: number;
    dragged: boolean;
  } | null>(null);
  const skipClick = useRef(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width, height, elevations } = grid;
  const [west, south, east, north] = bounds;
  const mapWidth = east - west;
  const mapHeight = north - south;
  const points = useMemo(() => {
    const measured = elevations.filter((value): value is number => value !== null);
    return { min: Math.min(...measured), max: Math.max(...measured) };
  }, [elevations]);
  const x = (cell: GridCell) => ((grid.xMeters[cell.col] - west) / mapWidth) * 1000;
  const y = (cell: GridCell) => ((north - grid.yMeters[cell.row]) / mapWidth) * 1000;
  const frameHeight = (mapHeight / mapWidth) * 1000;
  const xBounds = useMemo(() => cellBoundaries(grid.xMeters, west, east), [grid.xMeters, west, east]);
  const yBounds = useMemo(() => cellBoundaries(grid.yMeters, north, south), [grid.yMeters, north, south]);
  const line = (way: readonly MeasuredPoint[]) => way.map((cell) => `${x(cell)},${y(cell)}`).join(' ');
  const cx = zoom === 1 ? 500 : Math.min(1000 - 500 / zoom, Math.max(500 / zoom, center?.x ?? x(cursor)));
  const cy =
    zoom === 1
      ? frameHeight / 2
      : Math.min(
          frameHeight - frameHeight / (2 * zoom),
          Math.max(frameHeight / (2 * zoom), center?.y ?? y(cursor))
        );

  useEffect(() => {
    if (base !== 'elevation' || !canvas.current) return;
    const ctx = canvas.current.getContext('2d');
    if (!ctx) return;
    const rasterWidth = width * 4;
    const rasterHeight = height * 4;
    const bitmap = ctx.createImageData(rasterWidth, rasterHeight);
    const cols = rasterAxis(xBounds, rasterWidth);
    const rows = rasterAxis(yBounds, rasterHeight);
    for (let pixel = 0; pixel < rasterWidth * rasterHeight; pixel++) {
      const value = elevations[rows[Math.floor(pixel / rasterWidth)] * width + cols[pixel % rasterWidth]];
      const f = value === null ? 0 : (value - points.min) / (points.max - points.min || 1);
      bitmap.data.set(
        value === null ? [8, 12, 15, 255] : [35 + f * 205, 45 + f * 134, 53 + f * 65, 255],
        pixel * 4
      );
    }
    ctx.putImageData(bitmap, 0, 0);
  }, [base, width, height, elevations, points, xBounds, yBounds]);

  return (
    <section className="ops-map-region" aria-label="Registered Jezero terrain map">
      <div className="ops-map-header">
        <div>
          <span className="section-label">WESTERN JEZERO · MARS</span>
          <h2>Traverse map</h2>
        </div>
        <div className="ops-map-actions">
          <button
            className={`secondary quick-route-toggle${selectingDestination ? ' active' : ''}`}
            type="button"
            aria-pressed={selectingDestination}
            onClick={onToggleDestination}
          >
            <Route size={15} />
            Route to a point
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => setBase(base === 'ortho' ? 'elevation' : 'ortho')}
          >
            <Layers size={15} />
            {base === 'ortho' ? 'Elevation preview' : 'CTX orthoimage'}
          </button>
          <button
            className="icon-button"
            aria-label="Zoom out of field map"
            disabled={zoom === 1}
            onClick={() => setZoom(Math.max(1, zoom - 0.5))}
          >
            <Minus size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Zoom in on field map"
            disabled={zoom === 3}
            onClick={() => setZoom(Math.min(3, zoom + 0.5))}
          >
            <Plus size={17} />
          </button>
          {zoom > 1 && (
            <button
              className="icon-button"
              aria-label="Fit map to coverage"
              onClick={() => {
                setZoom(1);
                setCenter(null);
              }}
            >
              <Crosshair size={17} />
            </button>
          )}
        </div>
      </div>
      <svg
        className={`ops-map${zoom > 1 ? ' zoomed' : ''}`}
        viewBox={`${cx - 500 / zoom} ${cy - frameHeight / (2 * zoom)} ${1000 / zoom} ${frameHeight / zoom}`}
        style={{ aspectRatio: `${mapWidth}/${mapHeight}` }}
        tabIndex={0}
        aria-label="Jezero terrain map. Click or use arrow keys to inspect a location."
        onPointerDown={(event) => {
          skipClick.current = false;
          if (zoom === 1 || event.button !== 0) return;
          const matrix = event.currentTarget.getScreenCTM();
          if (matrix?.a)
            pointer.current = { x: event.clientX, y: event.clientY, cx, cy, scale: matrix.a, dragged: false };
        }}
        onPointerMove={(event) => {
          const start = pointer.current;
          if (!start) return;
          const dx = event.clientX - start.x,
            dy = event.clientY - start.y;
          if (!start.dragged && Math.hypot(dx, dy) < 5) return;
          if (!start.dragged) event.currentTarget.setPointerCapture(event.pointerId);
          start.dragged = true;
          setCenter({ x: start.cx - dx / start.scale, y: start.cy - dy / start.scale });
        }}
        onPointerUp={() => {
          skipClick.current = Boolean(pointer.current?.dragged);
          pointer.current = null;
        }}
        onPointerCancel={() => {
          pointer.current = null;
          skipClick.current = false;
        }}
        onPointerLeave={() => {
          if (!pointer.current?.dragged) pointer.current = null;
        }}
        onClick={(event) => {
          if (skipClick.current) {
            skipClick.current = false;
            return;
          }
          const matrix = event.currentTarget.getScreenCTM();
          if (!matrix) return;
          const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
          if (p.x < 0 || p.x > 1000 || p.y < 0 || p.y > frameHeight) return;
          const [minX, maxX] = [grid.xMeters[0], grid.xMeters[width - 1]];
          const [minY, maxY] = [grid.yMeters[height - 1], grid.yMeters[0]];
          const cell = nearestMeasuredCell(
            grid,
            Math.max(minX, Math.min(maxX, west + (p.x / 1000) * mapWidth)),
            Math.max(minY, Math.min(maxY, north - (p.y / 1000) * mapWidth))
          );
          if (cell) onSelect(cell);
        }}
        onKeyDown={(event) => {
          const arrows: Record<string, [number, number]> = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          };
          const step = arrows[event.key];
          if (!step) return;
          event.preventDefault();
          onSelect({
            col: Math.max(0, Math.min(width - 1, cursor.col + step[0])),
            row: Math.max(0, Math.min(height - 1, cursor.row + step[1])),
          });
        }}
      >
        <defs>
          <pattern
            id="registered-map-grid"
            width={(500 / mapWidth) * 1000}
            height={(500 / mapWidth) * 1000}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${(500 / mapWidth) * 1000} 0 H 0 V ${(500 / mapWidth) * 1000}`}
              stroke="#dbdec4"
              strokeOpacity=".27"
              fill="none"
            />
          </pattern>
          <pattern
            id="field-exclusion-hatch"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="5" height="5" fill="#6b2927" />
            <path d="M0 0 V5" stroke="#ff9b86" strokeWidth="2" />
          </pattern>
        </defs>
        <rect width="1000" height={frameHeight} fill="#28292b" />
        {base === 'ortho' ? (
          <image
            href="./assets/jezero-ctx-registered.png"
            width="1000"
            height={frameHeight}
            preserveAspectRatio="none"
          />
        ) : (
          <foreignObject width="1000" height={frameHeight}>
            <canvas ref={canvas} width={width * 4} height={height * 4} className="height-raster" />
          </foreignObject>
        )}
        <rect width="1000" height={frameHeight} fill="#100b07" opacity={base === 'ortho' ? 0.18 : 0} />
        <rect width="1000" height={frameHeight} fill="url(#registered-map-grid)" />
        {exclusions.map(({ col, row }) => (
          <rect
            key={`${col},${row}`}
            className="field-exclusion"
            x={((xBounds[col] - west) / mapWidth) * 1000}
            y={((north - yBounds[row]) / mapWidth) * 1000}
            width={((xBounds[col + 1] - xBounds[col]) / mapWidth) * 1000}
            height={((yBounds[row] - yBounds[row + 1]) / mapWidth) * 1000}
            fill="url(#field-exclusion-hatch)"
            stroke="#ffd4c9"
            vectorEffect="non-scaling-stroke"
          >
            <title>
              Reported exclusion · cell {col}, {row}
            </title>
          </rect>
        ))}
        <polyline
          points={line(path)}
          fill="none"
          stroke="#1c120d"
          strokeOpacity=".75"
          strokeWidth="6"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={line(path)}
          fill="none"
          stroke="#ffa46e"
          strokeWidth="3"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={line(returnPath)}
          fill="none"
          stroke="#84f0d8"
          strokeWidth="3"
          strokeDasharray="6 5"
          vectorEffect="non-scaling-stroke"
        />
        {previewPath.length > 0 && (
          <polyline
            className="quick-route-line"
            points={line(previewPath)}
            fill="none"
            stroke="#d4bdff"
            strokeWidth="3"
            strokeDasharray="5 4"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {destination && (
          <circle
            cx={x(destination)}
            cy={y(destination)}
            r={12 / zoom}
            fill="#513876"
            stroke="#e4d4ff"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          >
            <title>Quick-route destination</title>
          </circle>
        )}
        {stops.map(
          (stop, index) =>
            measuredPoint(grid, stop) && (
              <g key={`${stop.col}-${stop.row}`} transform={`translate(${x(stop)} ${y(stop)})`}>
                <circle
                  r={13 / zoom}
                  fill={index === 0 ? '#f9ac79' : '#262425'}
                  stroke="#ffb681"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  y={4 / zoom}
                  fontSize={12 / zoom}
                  fontWeight="700"
                  dominantBaseline="auto"
                  textAnchor="middle"
                  fill={index === 0 ? '#2e1a0d' : '#fff'}
                >
                  {index === 0 ? 'H' : index}
                </text>
              </g>
            )
        )}
        {current && (
          <circle
            cx={x(current)}
            cy={y(current)}
            r={7 / zoom}
            fill="#8df2db"
            stroke="#183d35"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <g transform={`translate(${x(cursor)} ${y(cursor)}) scale(${1 / zoom})`}>
          <circle r="21" stroke="#fff" strokeWidth="1.3" fill="none" vectorEffect="non-scaling-stroke" />
          <path
            d="M-28 0H-16M16 0H28M0 -28V-16M0 16V28"
            stroke="#fff"
            strokeWidth="1.3"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>
      <footer className="ops-map-footer">
        <span>
          <Crosshair size={14} /> North up · 500 m grid
        </span>
        {exclusions.length > 0 && (
          <span className="exclusion-key">
            ▧ {exclusions.length} reported no-go {exclusions.length === 1 ? 'cell' : 'cells'}
          </span>
        )}
        <span>
          {base === 'ortho' ? 'NASA/JPL-Caltech/MSSS · USGS CTX ortho' : 'USGS CTX DEM · elevation colors'}
        </span>
      </footer>
      {selectingDestination && (
        <p className="quick-map-instruction">
          Tap the map or move the crosshair with the arrow keys. AREO previews a round trip from your habitat.
        </p>
      )}
    </section>
  );
}

function cellBoundaries(axis: readonly number[], start: number, end: number): number[] {
  return [start, ...axis.slice(1).map((value, index) => (value + axis[index]) / 2), end];
}

function rasterAxis(boundaries: number[], rasterSize: number): number[] {
  const origin = boundaries[0];
  const span = boundaries.at(-1)! - origin;
  let cell = 0;
  return Array.from({ length: rasterSize }, (_, pixel) => {
    const fraction = (pixel + 0.5) / rasterSize;
    while ((boundaries[cell + 1] - origin) / span < fraction) cell++;
    return cell;
  });
}
