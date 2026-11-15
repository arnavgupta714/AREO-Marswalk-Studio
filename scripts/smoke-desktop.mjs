import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = path.join(root, 'release/win-unpacked/AREO Marswalk Studio.exe');
if (!existsSync(executablePath)) throw new Error('Build the desktop package first: pnpm desktop:build');

const profilePrefix = path.join(tmpdir(), 'areo-desktop-smoke-');
const profile = await mkdtemp(profilePrefix);
const application = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env: { ...process.env, AREO_TEST: '1' }, timeout: 60000 });
try {
  const window = await application.firstWindow();
  const pageErrors = [];
  window.on('pageerror', error => pageErrors.push(error.message));
  await window.waitForLoadState('domcontentloaded');
  await window.locator('#root').waitFor();
  await window.waitForFunction(() => document.querySelector('#root')?.textContent?.includes('AREO'));
  const result = await window.evaluate(async () => {
    const source = await fetch('./data/jezero-elevation.json').catch(() => null);
    const documentResponse = await fetch('./index.html');
    const images = Array.from(document.images);
    await Promise.all(images.map(image => image.decode().catch(() => undefined)));
    return {
      title: document.title,
      url: location.href,
      bodyLength: document.body.textContent.length,
      images: images.map(image => ({ src: image.getAttribute('src'), loaded: image.complete && image.naturalWidth > 0 })),
      hasNode: typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
      sourceRequestStatus: source?.status ?? null,
      contentSecurityPolicy: documentResponse.headers.get('Content-Security-Policy'),
    };
  });
  const preferences = await application.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, webSecurity: prefs.webSecurity };
  });
  assert.match(result.title, /AREO/);
  assert.equal(result.url, 'areo://app/index.html');
  assert.ok(result.bodyLength > 300, 'Application content must render');
  assert.equal(result.hasNode, false, 'Renderer must not have Node privileges');
  assert.equal(result.sourceRequestStatus, 200, 'Bundled scientific data must be available over the local protocol');
  assert.match(result.contentSecurityPolicy, /script-src 'self';/, 'The packaged document must enforce a restrictive CSP');
  assert.equal(result.images.filter(image => !image.loaded).length, 0, 'Visible bundled images must load');
  assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
  assert.deepEqual(pageErrors, [], 'Renderer must not throw');
  console.log(JSON.stringify({ status: 'passed', executablePath, ...result, preferences, pageErrors }, null, 2));
} finally {
  await application.close();
  if (!path.resolve(profile).startsWith(path.resolve(profilePrefix))) throw new Error('Unexpected temporary profile path');
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
