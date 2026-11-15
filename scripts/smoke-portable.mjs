import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const executable = path.join(root, `release/AREO-Marswalk-Studio-${metadata.version}-Windows-x64.exe`);
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const profilePrefix = path.join(tmpdir(), 'areo-portable-smoke-');
const profile = await mkdtemp(profilePrefix);
const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], { env: { ...process.env, AREO_TEST: '1' }, windowsHide: true, stdio: 'ignore' });
let browser;
let launchError;
child.once('error', error => { launchError = error; });
try {
  const deadline = Date.now() + 90000;
  let version;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).json();
      break;
    } catch {
      if (child.exitCode !== null) throw new Error(`Portable launcher exited before startup (${child.exitCode})`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if (!version?.webSocketDebuggerUrl) throw new Error('Portable runtime did not expose its test connection within 90 seconds');
  browser = await chromium.connectOverCDP(version.webSocketDebuggerUrl);
  const context = browser.contexts()[0];
  let page = context.pages()[0];
  if (!page) page = await context.waitForEvent('page');
  await page.getByRole('heading', { name: 'Coordinate inspector' }).waitFor();
  const result = await page.evaluate(async () => {
    await Promise.all(Array.from(document.images).map(image => image.decode()));
    const mapped = new Image();
    mapped.src = './assets/jezero-ctx-registered.png';
    await mapped.decode();
    return { title: document.title, url: location.href, imageCount: document.images.length, mapWidth: mapped.naturalWidth, sourceStatus: (await fetch('./data/jezero-elevation.json')).status, hasNode: typeof window.require !== 'undefined' };
  });
  assert.match(result.title, /AREO/);
  assert.equal(result.url, 'areo://app/index.html');
  assert.equal(result.sourceStatus, 200);
  assert.equal(result.mapWidth, 960);
  assert.equal(result.hasNode, false);
  console.log(JSON.stringify({ status: 'passed', executable, ...result }, null, 2));
} finally {
  if (browser) {
    const session = await browser.newBrowserCDPSession().catch(() => null);
    await session?.send('Browser.close').catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
  if (child.exitCode === null && child.pid) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (child.exitCode === null) {
      // Only the process tree launched by this script is eligible for cleanup.
      const cleanup = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await new Promise(resolve => cleanup.once('exit', resolve));
    }
  }
  if (!path.resolve(profile).startsWith(path.resolve(profilePrefix))) throw new Error('Unexpected temporary profile path');
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
