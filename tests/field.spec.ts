import { test, expect, type Download } from '@playwright/test';

async function jsonDownload(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('No exported traverse file was produced.');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const clockSeconds = (text: string) => {
  const [hours, minutes, seconds] = text.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
};
const elapsedClockSeconds = (before: string, after: string) => (clockSeconds(after) - clockSeconds(before) + 86400) % 86400;

test('tap-to-route previews an arbitrary mapped destination before replacing the saved itinerary', async ({ page }) => {
  await page.goto('/');
  const map = page.locator('svg.ops-map');
  await page.getByRole('button', {name:'Route to a point'}).click();
  const tap = await map.evaluate(element => {
    const point = new DOMPoint(800, 500).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
    return {x:point.x,y:point.y};
  });
  await page.mouse.click(tap.x,tap.y);
  await expect(page.locator('.quick-route-line')).toBeVisible();
  await expect(page.getByRole('region',{name:'Quick route preview'})).toContainText('Round trip');
  await expect(page.getByRole('button',{name:'1 Sediment transect'})).toBeVisible();
  await page.getByRole('button',{name:'Zoom in on field map'}).click();
  const oldView = await map.getAttribute('viewBox');
  const bounds=await map.boundingBox();
  const center={x:bounds!.x+bounds!.width/2,y:bounds!.y+bounds!.height/2};
  await page.mouse.move(center.x,center.y);
  await page.mouse.down();
  await page.mouse.move(center.x+130,center.y,{steps:4});
  await page.mouse.up();
  await expect(map).not.toHaveAttribute('viewBox',oldView!);
  await page.getByRole('button',{name:'Fit map to coverage'}).click();
  await expect(page.locator('.quick-route-line')).toBeVisible();
  await page.getByRole('button',{name:'Replace itinerary with this destination'}).click();
  await expect(page.getByRole('button',{name:'1 Map destination'})).toBeVisible();
  await expect(page.getByRole('button',{name:'1 Sediment transect'})).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button',{name:'1 Map destination'})).toBeVisible();
});

test('a reported no-go cell survives reload and is excluded from the route and crew return', async ({ page, request }) => {
  await page.goto('/');
  const exportPlan = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export traverse' }).click();
    return jsonDownload(await pending);
  };
  const initial = await exportPlan();
  const { path } = initial.route;
  const blocked = path[Math.floor(initial.route.legs[0].path.length / 2)];
  const { projectedBoundsMeters: [west, , east, north] } = await (await request.get('/data/jezero-elevation.json')).json();
  const map = page.locator('svg.ops-map');
  const screen = await map.evaluate((element, coordinates) => {
    const point = new DOMPoint(coordinates.x, coordinates.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
    return { x: point.x, y: point.y };
  }, { x: (blocked.xM - west) / (east - west) * 1000, y: (north - blocked.yM) / (east - west) * 1000 });

  await page.mouse.click(screen.x, screen.y);
  await page.getByRole('button', { name: 'Mark cursor as no-go' }).click();
  await expect(page.getByRole('button', { name: 'Clear exclusion at cursor' })).toBeEnabled();
  await page.reload();
  await expect(page.getByText('1 reported no-go cell')).toBeVisible();

  await page.getByRole('button', { name: '1 Sediment transect' }).click();
  await page.getByRole('spinbutton', { name: 'Elapsed minutes' }).fill('90');
  await page.getByRole('button', { name: 'Use cursor position' }).click();
  await expect(page.locator('.return-assessment')).toContainText('direct return');
  await expect(page.getByRole('button', { name: 'Play rehearsal' })).toBeDisabled();
  const reviewed = await exportPlan();
  expect(reviewed.plan.exclusions).toEqual([{ col: blocked.col, row: blocked.row }]);
  expect(reviewed.route.path.length).toBeGreaterThan(0);
  expect(reviewed.drill.source).toBe('crew-reported');
  expect(reviewed.drill.elapsed).toBe(90);
  expect(reviewed.drill.returnLeg.path[0]).toMatchObject({col: 56, row: 43});
  expect([...reviewed.route.path, ...reviewed.drill.returnLeg.path].some(point => point.index === blocked.index)).toBe(false);
  await page.getByRole('button', { name: 'Clear reported position' }).click();
  await expect(page.getByRole('slider', { name: 'Traverse rehearsal timeline' })).toBeEnabled();
});

test('registered CTX imagery is served, decoded and rendered in the measured map', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await request.get('/assets/jezero-ctx-registered.png');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('image/png');
  const png = await response.body();
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.readUInt32BE(16)).toBeGreaterThan(100);
  expect(png.readUInt32BE(20)).toBeGreaterThan(100);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Plan the traverse.' })).toBeVisible();
  const map = page.getByLabel('Jezero terrain map. Click or use arrow keys to inspect a location.');
  const image = map.locator('image');
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('href', './assets/jezero-ctx-registered.png');
  const decoded = await image.evaluate(async element => {
    const reference = element.getAttribute('href')!;
    const img = new Image();
    img.src = reference;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  });
  expect(decoded).toEqual({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
  // Inspect an actual browser raster of the map, not just an SVG href. The
  // textured photographic layer produces a substantial PNG rather than a
  // nearly empty vector background; changing the layer must change the pixels.
  const orbitalRender = await map.screenshot();
  expect(orbitalRender.length).toBeGreaterThan(40_000);
  await page.getByRole('button', { name: 'Elevation preview' }).click();
  await expect(map.locator('image')).toHaveCount(0);
  await expect(map.locator('canvas')).toBeVisible();
  const elevationRender = await map.screenshot();
  expect(orbitalRender.equals(elevationRender)).toBe(false);
  await page.getByRole('button', { name: 'CTX orthoimage' }).click();
  await expect(map.locator('image')).toBeVisible();
  expect(errors).toEqual([]);
});

test('XYZ frames reflect the selected measured cell and habitat is the local origin', async ({ page }) => {
  await page.goto('/');
  const local = page.getByRole('button', { name: 'Local XYZ', exact: true });
  const global = page.getByRole('button', { name: 'Mars-fixed XYZ', exact: true });
  const axes = page.locator('.ops-axes strong');
  await expect(local).toHaveAttribute('aria-pressed', 'true');
  await expect(axes).toHaveCount(3);
  const original = await axes.allTextContents();
  expect(original.every(value => /[+−]\d+\.\d m/.test(value))).toBe(true);
  await page.getByLabel('Jezero terrain map. Click or use arrow keys to inspect a location.').press('ArrowRight');
  await expect(axes.first()).not.toHaveText(original[0]);
  await global.click();
  await expect(global).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.ops-axes')).toContainText('PRIME MERIDIAN');
  await expect(page.locator('.xyz-panel')).toContainText('Spherical Mars-fixed approximation');
  const globalNumbers = (await axes.allTextContents()).map(value => Number(value.replace('−', '-').replace(/[^\d.+-]/g, '')));
  expect(Math.hypot(...globalNumbers)).toBeGreaterThan(3_000_000);
  expect(Math.hypot(...globalNumbers)).toBeLessThan(3_500_000);
  await page.getByRole('button', { name: /H Habitat Alpha/ }).click();
  await local.click();
  await expect(axes).toHaveText(['+0.0 m', '+0.0 m', '+0.0 m']);
});

test('EVA limits block rehearsal, and a direct return is calculated from the timeline position', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use next morning window' }).click();
  const budget = page.getByRole('slider', { name: 'Field EVA budget' });
  await budget.focus();
  await budget.press('Home');
  await expect(budget).toHaveValue('60');
  await expect(page.getByRole('button', { name: 'Play rehearsal' })).toBeDisabled();
  await expect(page.locator('.ops-control-column')).toContainText('Closed-loop plan exceeds the usable EVA budget');
  await budget.press('End');
  await expect(budget).toHaveValue('600');
  await expect(page.getByRole('button', { name: 'Play rehearsal' })).toBeEnabled();
  await page.getByRole('button', { name: 'Play rehearsal' }).click();
  await expect(page.getByRole('button', { name: 'Pause rehearsal' })).toBeVisible();
  const timeline = page.getByRole('slider', { name: 'Traverse rehearsal timeline' });
  await expect.poll(async () => Number(await timeline.inputValue())).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause rehearsal' }).click();
  await page.getByRole('button', { name: 'Reset traverse rehearsal' }).click();
  await expect(timeline).toHaveValue('0');
  await timeline.focus();
  await timeline.press('PageUp');
  await expect.poll(async () => Number(await timeline.inputValue())).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Calculate direct return' }).click();
  await expect(page.locator('.return-assessment')).toContainText('direct return');
  await expect(page.locator('.return-assessment')).toContainText('daylight margin');
  const returnLine = page.locator('.ops-map polyline[stroke="#84f0d8"]');
  await expect(returnLine).not.toHaveAttribute('points', '');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export traverse' }).click();
  const exported = await jsonDownload(await downloadPromise);
  expect(exported.drill.elapsed).toBeGreaterThan(0);
  expect(exported.drill.returnLeg.path.length).toBeGreaterThan(1);
  expect(exported.drill.returnLeg.to).toEqual(exported.route.path[0]);
  expect(exported.drill.returnMargin).toBeGreaterThan(0);
});

test('UTC changes advance the Mars clocks at a Mars sol rate and expose model details', async ({ page }) => {
  await page.goto('/');
  const departure = page.getByLabel('Departure UTC', { exact: true });
  const clocks = page.locator('.sol-clocks strong');
  await departure.fill('2026-11-15T04:30');
  await expect(clocks).toHaveCount(3);
  await expect(clocks.first()).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  const before = await clocks.allTextContents();
  await departure.fill('2026-11-15T05:30');
  await expect(clocks.nth(1)).not.toHaveText(before[1]);
  const after = await clocks.allTextContents();
  // One Earth hour is about 3,504 Mars clock seconds, not 3,600.
  const meanAdvance = elapsedClockSeconds(before[1], after[1]);
  expect(meanAdvance).toBeGreaterThan(3500);
  expect(meanAdvance).toBeLessThan(3508);
  const longitudeOffset = elapsedClockSeconds(after[2], after[1]);
  expect(longitudeOffset).toBeGreaterThan(18500);
  expect(longitudeOffset).toBeLessThan(18700);
  await page.getByText('Mars time fundamentals', { exact: true }).click();
  await expect(page.locator('.ops-details')).toContainText('24 Mars hours');
  await expect(page.getByRole('link', { name: 'NASA GISS Mars24 equations' })).toHaveAttribute('href', 'https://www.giss.nasa.gov/tools/mars24/help/algorithm.html');
  await page.getByRole('button', { name: 'Use next morning window' }).click();
  await expect(page.getByRole('button', { name: 'Play rehearsal' })).toBeEnabled();
});

test('measured settings persist and the exported loop carries original DEM heights and frames', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Route priority', exact: true }).selectOption('gentlest');
  await page.getByLabel('Dwell time for Sediment transect', { exact: true }).fill('25');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Route priority', exact: true })).toHaveValue('gentlest');
  await expect(page.getByLabel('Dwell time for Sediment transect', { exact: true })).toHaveValue('25');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export traverse' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('areo-jezero-traverse.json');
  const exported = await jsonDownload(download);
  const dem = await (await request.get('/data/jezero-elevation.json')).json();
  expect(exported.workspace).toBe('measured-jezero');
  expect(exported.dataId).toBe(dem.id);
  expect(exported.route.model).toBe('measured-ctx-dem-v1');
  expect(exported.route.closedLoop).toBe(true);
  expect(exported.route.path[0]).toEqual(exported.route.path.at(-1));
  expect(exported.route.legs).toHaveLength(3);
  expect(exported.route.dwellMinutes).toBe(40);
  for (const point of exported.route.path) expect(point.zM).toBe(dem.elevationMeters[point.index]);
  expect(exported.waypointCoordinates).toHaveLength(exported.plan.stops.length);
  expect(exported.waypointCoordinates[0].local).toEqual({ x: 0, y: 0, z: 0 });
  expect(exported.coordinateReference.marsFixed).toContain('Spherical approximation');
  await expect(page.getByRole('status').filter({ hasText: 'Traverse package downloaded' })).toBeVisible();
});
