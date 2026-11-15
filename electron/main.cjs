const { app, BrowserWindow, shell, session, Menu, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEV_URL = 'http://127.0.0.1:5173';
const APP_URL = 'areo://app/index.html';
const PRODUCTION_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'";
protocol.registerSchemesAsPrivileged([{ scheme: 'areo', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const externalHosts = new Set([
  'science.nasa.gov', 'www.nasa.gov', 'nasa.gov', 'mars.nasa.gov', 'www.giss.nasa.gov',
  'trek.nasa.gov', 'worldview.earthdata.nasa.gov', 'pds.nasa.gov',
  'astrogeology.usgs.gov', 'www.usgs.gov', 'usgs.gov',
  'astrogeology-usgs.hub.arcgis.com', 'hirise.lpl.arizona.edu',
  'www.hirise.lpl.arizona.edu', 'www.jpl.nasa.gov', 'jpl.nasa.gov',
  'www.uahirise.org',
  'astrogeology.usgs.gov', 'planetarymaps.usgs.gov', 'www.spaceappschallenge.org',
]);

function safeExternal(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && externalHosts.has(url.hostname);
  } catch { return false; }
}

async function createWindow() {
  const development = !app.isPackaged && process.env.AREO_DEV === '1';
  const allowedDocument = development ? DEV_URL : APP_URL;
  const win = new BrowserWindow({
    width: 1550,
    height: 1000,
    minWidth: 880,
    minHeight: 620,
    title: 'AREO · Marswalk Mission Studio',
    icon: path.join(__dirname, '../build/icon.ico'),
    backgroundColor: '#0b0f13',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  win.once('ready-to-show', () => { if (process.env.AREO_TEST !== '1') win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (safeExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url === allowedDocument || url === `${allowedDocument}/`) return;
    event.preventDefault();
    if (safeExternal(url)) void shell.openExternal(url);
  });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  if (development) await win.loadURL(DEV_URL);
  else await win.loadURL(APP_URL);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const distributionRoot = path.resolve(__dirname, '../dist');
  protocol.handle('areo', async request => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'app' || request.method !== 'GET') return new Response('Forbidden', { status: 403 });
      const filename = path.resolve(distributionRoot, `.${decodeURIComponent(url.pathname)}`);
      const relative = path.relative(distributionRoot, filename);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response('Forbidden', { status: 403 });
      const response = await net.fetch(pathToFileURL(filename).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', PRODUCTION_CSP);
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Dev needs Vite's websocket and injected styles; packaged builds allow only bundled scripts.
    const development = !app.isPackaged && process.env.AREO_DEV === '1';
    const policy = development
      ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:5173; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'"
      : PRODUCTION_CSP;
    callback({ responseHeaders: {...details.responseHeaders, 'Content-Security-Policy': [policy]} });
  });
  void createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
