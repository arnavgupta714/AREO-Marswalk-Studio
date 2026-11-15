import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const filename = `AREO-Marswalk-Studio-${pkg.version}-Windows-x64.exe`;
const artifact = path.join(root, 'release', filename);
const hash = createHash('sha256');
for await (const chunk of createReadStream(artifact)) hash.update(chunk);
const sha256 = hash.digest('hex');
const metadata = { name: pkg.build.productName, version: pkg.version, platform: 'win32', architecture: 'x64', filename, bytes: (await stat(artifact)).size, sha256, signed: false };
await writeFile(path.join(root, 'release', `${filename}.sha256`), `${sha256}  ${filename}\n`);
await writeFile(path.join(root, 'release', 'release-info.json'), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`Portable release ready: ${filename} (${(metadata.bytes / 1024 / 1024).toFixed(1)} MiB)`);
