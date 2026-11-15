/** Re-fetch the four checked scientific images; optionally rebuild the measured DEM subset.
 * Node 20+; no third-party packages. Run from any working directory.
 *   node scripts/fetch-data.mjs --verify   (offline checksum verification)
 *   node scripts/fetch-data.mjs            (download verified source image bytes)
 *   node scripts/fetch-data.mjs --dem      (also regenerate elevation subset)
 *   node scripts/fetch-data.mjs --registered (also regenerate registered CTX crop)
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extractElevation } from './extract-elevation.mjs';
import { extractRegisteredOrtho } from './extract-registered-ortho.mjs';
const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('public/data/sources.json', root), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('public/data/asset-manifest.json', root), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const verifyOnly = process.argv.includes('--verify');

for (const source of catalog.sources.filter(source => source.asset && source.downloadUrl)) {
  const target = new URL(`public/${source.asset}`, root);
  const expected = manifest.assets.find(asset => asset.path === source.asset);
  if (!expected) throw new Error(`No checksum registered for ${source.asset}`);
  let bytes;
  if (verifyOnly) bytes = await readFile(target);
  else {
    const response = await fetch(source.downloadUrl, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`${source.id}: HTTP ${response.status}`);
    if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error(`${source.id}: expected image response`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) throw new Error(`${source.id}: source differs from the recorded snapshot; inspect before updating the manifest`);
  if (!verifyOnly) {
    await mkdir(new URL('public/assets/', root), { recursive: true });
    const staging = new URL(`${target.href}.partial`);
    await writeFile(staging, bytes);
    await rename(staging, target);
  }
  console.log(`${verifyOnly ? 'Verified' : 'Fetched'} ${source.asset} (${bytes.length} bytes)`);
}
if (process.argv.includes('--dem') && !verifyOnly) {
  const data = await extractElevation();
  console.log(`Rebuilt ${data.width} x ${data.height} observed elevation samples.`);
}
if (process.argv.includes('--registered') && !verifyOnly) await extractRegisteredOrtho();
for (const expected of manifest.derived) {
  const bytes = await readFile(new URL(`public/${expected.path}`, root));
  if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) throw new Error(`${expected.path}: derived data differs from the recorded snapshot; inspect extraction/source changes before updating the manifest`);
  console.log(`Verified ${expected.path}`);
}
