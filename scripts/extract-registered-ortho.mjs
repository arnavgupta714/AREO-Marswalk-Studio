/** Download only relevant TIFF strips and create a compact north-up orthophoto.
 * Node 20+, no third-party packages. PNG pixel centers are resampled into the
 * exact projected extent of the bundled elevation subset; NoData is transparent.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
export const ORTHO_URL = 'https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXortho_mosaic_5m.tif';

async function range(start, length) {
  const response = await fetch(ORTHO_URL, { headers: { Range: `bytes=${start}-${start + length - 1}` }, signal: AbortSignal.timeout(90000) });
  if (response.status !== 206) throw new Error(`Expected HTTP 206, received ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== length) throw new Error('Truncated source byte range');
  return bytes;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function png(width, height, grayAlpha) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 4;
  const scanlines = Buffer.alloc(height * (width * 2 + 1));
  for (let row = 0; row < height; row++) grayAlpha.copy(scanlines, row * (width * 2 + 1) + 1, row * width * 2, (row + 1) * width * 2);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export async function extractRegisteredOrtho() {
  const elevation = JSON.parse(await readFile(new URL('public/data/jezero-elevation.json', root), 'utf8'));
  const header = await range(0, 8);
  if (header.toString('ascii', 0, 2) !== 'II' || header.readUInt16LE(2) !== 42) throw new Error('Expected little-endian classic TIFF');
  const ifdOffset = header.readUInt32LE(4), count = (await range(ifdOffset, 2)).readUInt16LE();
  const directory = await range(ifdOffset + 2, count * 12), entries = new Map();
  for (let p = 0; p < directory.length; p += 12) entries.set(directory.readUInt16LE(p), directory.subarray(p, p + 12));
  async function tag(id) {
    const entry = entries.get(id); if (!entry) throw new Error(`Missing TIFF tag ${id}`);
    const type = entry.readUInt16LE(2), n = entry.readUInt32LE(4), size = ({ 2: 1, 3: 2, 4: 4, 12: 8 })[type] * n;
    if (!size) throw new Error(`Unsupported TIFF field ${id}`);
    const bytes = size <= 4 ? entry.subarray(8, 8 + size) : await range(entry.readUInt32LE(8), size);
    if (type === 2) return bytes.toString('utf8').replace(/\0+$/, '');
    return Array.from({ length: n }, (_, i) => type === 3 ? bytes.readUInt16LE(i * 2) : type === 4 ? bytes.readUInt32LE(i * 4) : bytes.readDoubleLE(i * 8));
  }
  const [w, h, bits, compression, samples, rows, offsets, counts, scale, tie, keys, doubles] = await Promise.all([256, 257, 258, 259, 277, 278, 273, 279, 33550, 33922, 34735, 34736].map(tag));
  if (bits[0] !== 8 || compression[0] !== 1 || samples[0] !== 1 || rows[0] !== 1) throw new Error('Source is no longer an uncompressed one-band byte image in row strips');
  const geoKeys = {};
  for (let i = 4; i < keys.length; i += 4) geoKeys[keys[i]] = keys[i + 1] === 0 ? keys[i + 3] : keys[i + 1] === 34736 ? doubles[keys[i + 3]] : undefined;
  if (geoKeys[3075] !== 17 || geoKeys[2057] !== elevation.projection.sphereRadiusMeters || geoKeys[3078] !== elevation.projection.standardParallelDegrees || geoKeys[3088] !== 0 || geoKeys[3082] !== 0 || geoKeys[3083] !== 0) throw new Error('Ortho and elevation projections differ');
  const origin = [tie[3] - tie[0] * scale[0], tie[4] + tie[1] * scale[1]];
  const [xmin, ymin, xmax, ymax] = elevation.projectedBoundsMeters;
  const width = 960, height = 800;
  const sourceCols = Array.from({ length: width }, (_, col) => Math.round((xmin + (col + 0.5) * (xmax - xmin) / width - origin[0]) / scale[0] - 0.5));
  const sourceRows = Array.from({ length: height }, (_, row) => Math.round((origin[1] - ymax + (row + 0.5) * (ymax - ymin) / height) / scale[1] - 0.5));
  if (Math.min(...sourceCols) < 0 || Math.max(...sourceCols) >= w[0] || Math.min(...sourceRows) < 0 || Math.max(...sourceRows) >= h[0]) throw new Error('Requested extent outside source ortho');
  const top = Math.min(...sourceRows), bottom = Math.max(...sourceRows) + 1;
  for (let row = top; row < bottom; row++) if (counts[row] !== w[0] || (row > top && offsets[row] !== offsets[row - 1] + counts[row - 1])) throw new Error('Expected contiguous byte strips');
  const raster = await range(offsets[top], offsets[bottom - 1] + counts[bottom - 1] - offsets[top]);
  let missing = 0; const pixels = Buffer.alloc(width * height * 2);
  sourceRows.forEach((row, j) => sourceCols.forEach((col, i) => {
    const value = raster[(row - top) * w[0] + col], p = (j * width + i) * 2;
    pixels[p] = value; pixels[p + 1] = value === 0 ? 0 : 255; if (value === 0) missing++;
  }));
  const image = png(width, height, pixels);
  await mkdir(new URL('public/assets/', root), { recursive: true });
  await writeFile(new URL('public/assets/jezero-ctx-registered.png', root), image);
  const metadata = {
    id: 'jezero-ctx-registered', sourceId: 'ctx-registered-optical', title: 'CTX orthoimage in the elevation subset extent', classification: 'observed-derived',
    retrievedAt: '2026-11-15', asset: 'assets/jezero-ctx-registered.png', sourceUrl: ORTHO_URL,
    sourceLabelUrl: ORTHO_URL.replace('.tif', '.xml'), pdsIdentifier: 'urn:nasa:pds:mars2020_ctx_basemap_2021:data:m20_ctxortho_mosaic', pdsVersion: '1.0',
    width, height, bounds: elevation.bounds, projectedBoundsMeters: elevation.projectedBoundsMeters, projection: elevation.projection,
    sourceWidth: w[0], sourceHeight: h[0], sourceOrigin: origin, sourcePixelSizeMeters: scale.slice(0, 2),
    outputPixelSizeMeters: [(xmax - xmin) / width, (ymax - ymin) / height], rowOrder: 'north-to-south', columnOrder: 'west-to-east', noData: 0, noDataOutput: 'alpha=0', noDataPixelCount: missing,
    resampling: 'Nearest source pixel to each output pixel center in the common projected CRS; no contrast manipulation.',
    limitations: 'Same map projection and geographic extent as the DEM subset; registration follows the supplied GeoTIFF transforms and is not independently surveyed. Native pixel spacing is about 5 m, output about 6 m; neither resolves astronaut footing. The original HiRISE wallpaper remains a separate non-registered visual reference.'
  };
  await writeFile(new URL('public/data/jezero-ctx-registered.json', root), JSON.stringify(metadata, null, 2) + '\n');
  console.log(`Saved ${width} x ${height} registered CTX PNG (${image.length} bytes; ${missing} NoData pixels).`);
  return metadata;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await extractRegisteredOrtho();
