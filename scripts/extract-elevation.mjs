/** A dependency-free reader for this specific uncompressed USGS Float32 GeoTIFF.
 * It validates the layout and projection before reading a ~4 MB strip window.
 * Not a general GIS library. Fail closed if USGS replaces the source format.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const DEM_URL = 'https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif';
const root = new URL('../', import.meta.url);

async function range(start, length) {
  const response = await fetch(DEM_URL, { headers: { Range: `bytes=${start}-${start + length - 1}` }, signal: AbortSignal.timeout(60000) });
  if (response.status !== 206) throw new Error(`Expected HTTP 206 for DEM byte range; received ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== length) throw new Error('Truncated DEM byte range');
  return bytes;
}

export async function extractElevation() {
  const header = await range(0, 8);
  if (header.toString('ascii', 0, 2) !== 'II' || header.readUInt16LE(2) !== 42) throw new Error('Expected little-endian classic TIFF');
  const ifdOffset = header.readUInt32LE(4);
  const count = (await range(ifdOffset, 2)).readUInt16LE();
  const directory = await range(ifdOffset + 2, count * 12);
  const entries = new Map();
  for (let p = 0; p < directory.length; p += 12) entries.set(directory.readUInt16LE(p), directory.subarray(p, p + 12));
  async function tag(id) {
    const entry = entries.get(id);
    if (!entry) throw new Error(`Required TIFF tag ${id} missing`);
    const type = entry.readUInt16LE(2), n = entry.readUInt32LE(4);
    const sizes = { 2: 1, 3: 2, 4: 4, 12: 8 };
    if (!sizes[type]) throw new Error(`Unsupported TIFF field type ${type}`);
    const size = sizes[type] * n;
    const bytes = size <= 4 ? entry.subarray(8, 8 + size) : await range(entry.readUInt32LE(8), size);
    if (type === 2) return bytes.toString('utf8').replace(/\0+$/, '');
    return Array.from({ length: n }, (_, i) => type === 3 ? bytes.readUInt16LE(i * 2) : type === 4 ? bytes.readUInt32LE(i * 4) : bytes.readDoubleLE(i * 8));
  }
  const [w, h, compression, bits, format, samples, rows, offsets, counts, scale, tie, keys, doubles, noDataText] = await Promise.all(
    [256, 257, 259, 258, 339, 277, 278, 273, 279, 33550, 33922, 34735, 34736, 42113].map(tag)
  );
  if (compression[0] !== 1 || bits[0] !== 32 || format[0] !== 3 || samples[0] !== 1 || rows[0] !== 1) throw new Error('Source is no longer single-band, uncompressed, one-row-strip Float32');
  const geoKeys = {};
  for (let i = 4; i < keys.length; i += 4) geoKeys[keys[i]] = keys[i + 1] === 0 ? keys[i + 3] : keys[i + 1] === 34736 ? doubles[keys[i + 3]] : undefined;
  const radius = geoKeys[2057], standardParallel = geoKeys[3078];
  if (geoKeys[3075] !== 17 || radius !== 3396190 || standardParallel !== 18.4663 || geoKeys[3088] !== 0 || geoKeys[3082] !== 0 || geoKeys[3083] !== 0 || scale[0] !== 20 || scale[1] !== 20) throw new Error('Source projection changed; review extraction before proceeding');
  const rad = Math.PI / 180;
  const origin = [tie[3] - tie[0] * scale[0], tie[4] + tie[1] * scale[1]];
  const x = lon => radius * lon * rad * Math.cos(standardParallel * rad);
  const y = lat => radius * lat * rad;
  const window = [Math.floor((x(77.42) - origin[0]) / 20), Math.floor((origin[1] - y(18.48)) / 20), Math.ceil((x(77.52) - origin[0]) / 20), Math.ceil((origin[1] - y(18.40)) / 20)];
  const [left, top, right, bottom] = window;
  if (left < 0 || top < 0 || right > w[0] || bottom > h[0]) throw new Error('Requested subset lies outside source');
  for (let row = top; row < bottom; row++) {
    if (counts[row] !== w[0] * 4 || (row > top && offsets[row] !== offsets[row - 1] + counts[row - 1])) throw new Error('Expected contiguous full-width strips');
  }
  const raster = await range(offsets[top], offsets[bottom - 1] + counts[bottom - 1] - offsets[top]);
  const width = 96, height = 80, noDataValue = Number(noDataText);
  const sourceColumns = Array.from({ length: width }, (_, col) => left + Math.min(Math.round((right - left) * col / width), right - left - 1));
  const sourceRows = Array.from({ length: height }, (_, row) => top + Math.min(Math.round((bottom - top) * row / height), bottom - top - 1));
  const elevationMeters = sourceRows.flatMap(row => sourceColumns.map(col => {
    const value = raster.readFloatLE(((row - top) * w[0] + col) * 4);
    return !Number.isFinite(value) || value === noDataValue || value < -10000 ? null : Math.round(value * 10) / 10;
  }));
  const projectedBoundsMeters = [origin[0] + left * 20, origin[1] - bottom * 20, origin[0] + right * 20, origin[1] - top * 20];
  const [px0, py1, px1, py0] = projectedBoundsMeters;
  const valid = elevationMeters.filter(v => v !== null);
  const output = {
    id: 'jezero-ctx-dem-subset', title: 'Western Jezero CTX elevation subset', classification: 'observed-derived', sourceId: 'ctx-topography', sourceUrl: DEM_URL,
    retrievedAt: '2026-11-14', units: 'metres', verticalReference: 'MOLA-tied source DEM; see USGS source documentation', sourcePixelSizeMeters: 20,
    resampling: 'nearest-neighbor; source index = round(output index * source size / output size); values rounded to 0.1 m', width, height,
    bounds: { west: px0 / radius / Math.cos(standardParallel * rad) / rad, east: px1 / radius / Math.cos(standardParallel * rad) / rad, south: py1 / radius / rad, north: py0 / radius / rad },
    projection: { name: 'Equirectangular', sphereRadiusMeters: radius, standardParallelDegrees: standardParallel, centralLongitudeDegrees: 0 },
    projectedBoundsMeters, sourcePixelWindow: window, sourceColumns, sourceRows,
    gridSpacingMeters: [(px1 - px0) / width, (py0 - py1) / height], rowOrder: 'north-to-south', columnOrder: 'west-to-east', noData: null,
    minMeters: Math.min(...valid), maxMeters: Math.max(...valid),
    limitations: 'Decimated regional context only. Pixel support is too coarse for obstacle clearance or astronaut foot placement. Not spatially registered to the separate HiRISE wallpaper crop. NoData cells must never be treated as safe terrain. Nominal spacing is approximate; sourceRows/sourceColumns identify exact sampled pixels.',
    elevationMeters
  };
  await mkdir(new URL('public/data/', root), { recursive: true });
  await writeFile(new URL('public/data/jezero-elevation.json', root), JSON.stringify(output));
  return output;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = await extractElevation();
  console.log(`Saved ${data.width} x ${data.height} measured elevation samples (${data.minMeters} to ${data.maxMeters} m).`);
}
