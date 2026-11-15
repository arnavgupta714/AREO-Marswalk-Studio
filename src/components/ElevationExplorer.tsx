import { useEffect, useRef, useState } from 'react';
import { Download, Mountain } from 'lucide-react';

interface ElevationGrid {
  width: number;
  height: number;
  bounds: { west: number; east: number; south: number; north: number };
  minMeters: number;
  maxMeters: number;
  elevationMeters: (number | null)[];
}

export default function ElevationExplorer() {
  const [grid, setGrid] = useState<ElevationGrid>();
  const [error, setError] = useState(false);
  const [cell, setCell] = useState({ x: 48, y: 40 });
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('./data/jezero-elevation.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Missing elevation data');
        return response.json() as Promise<ElevationGrid>;
      })
      .then(setGrid)
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!grid || !canvas.current) return;
    const ctx = canvas.current.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(grid.width, grid.height);
    grid.elevationMeters.forEach((height, index) => {
      const t = height === null ? 0 : (height - grid.minMeters) / (grid.maxMeters - grid.minMeters);
      image.data.set([28 + t * 226, 39 + t * 146, 47 + t * 74, 255], index * 4);
    });
    ctx.putImageData(image, 0, 0);
  }, [grid]);

  if (error) return <p className="fine-print">The bundled elevation grid could not be loaded.</p>;
  if (!grid) return <p className="fine-print">Loading measured elevations…</p>;
  const height = grid.elevationMeters[cell.y * grid.width + cell.x];
  const longitude = grid.bounds.west + ((cell.x + 0.5) / grid.width) * (grid.bounds.east - grid.bounds.west);
  const latitude =
    grid.bounds.north - ((cell.y + 0.5) / grid.height) * (grid.bounds.north - grid.bounds.south);

  return (
    <section className="measured-panel">
      <span className="section-label">
        <Mountain size={15} />
        Measured terrain · western Jezero
      </span>
      <div className="dem-layout">
        <div className="dem-map" style={{ aspectRatio: `${grid.width}/${grid.height}` }}>
          <canvas
            ref={canvas}
            width={grid.width}
            height={grid.height}
            tabIndex={0}
            aria-label="Measured elevation grid. Use arrow keys to inspect cells."
            onKeyDown={(event) => {
              const offsets: Record<string, [number, number]> = {
                ArrowLeft: [-1, 0],
                ArrowRight: [1, 0],
                ArrowUp: [0, -1],
                ArrowDown: [0, 1],
              };
              const offset = offsets[event.key];
              if (!offset) return;
              event.preventDefault();
              setCell((previous) => ({
                x: Math.max(0, Math.min(grid.width - 1, previous.x + offset[0])),
                y: Math.max(0, Math.min(grid.height - 1, previous.y + offset[1])),
              }));
            }}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setCell({
                x: Math.max(
                  0,
                  Math.min(
                    grid.width - 1,
                    Math.floor(((event.clientX - rect.left) / rect.width) * grid.width)
                  )
                ),
                y: Math.max(
                  0,
                  Math.min(
                    grid.height - 1,
                    Math.floor(((event.clientY - rect.top) / rect.height) * grid.height)
                  )
                ),
              });
            }}
          />
          <span
            className="dem-cursor"
            style={{
              left: `${((cell.x + 0.5) / grid.width) * 100}%`,
              top: `${((cell.y + 0.5) / grid.height) * 100}%`,
            }}
          />
        </div>
        <div className="dem-detail">
          <span className="source-type">USGS · CTX STEREO</span>
          <strong>{height === null ? 'No data' : `${height.toFixed(1)} m`}</strong>
          <small>
            {latitude.toFixed(4)}° N / {longitude.toFixed(4)}° E
          </small>
          <div className="dem-scale" />
          <small className="dem-range">
            {grid.minMeters} m <span>{grid.maxMeters} m</span>
          </small>
          <p>
            96 × 80 sampled heights. Point at the grid or use arrow keys to inspect a cell. This grid has its
            own footprint and is used for science context.
          </p>
          <a href="./data/jezero-elevation.json" download="jezero-elevation.json">
            <Download size={13} />
            Download elevation grid
          </a>
        </div>
      </div>
    </section>
  );
}
