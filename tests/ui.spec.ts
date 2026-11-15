import { test, expect, type Download } from '@playwright/test';

async function downloadJson(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('The mission download did not produce a readable file.');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

test('planner opens, switches expeditions and route strategies, and toggles real layers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?workspace=training');
  await expect(page.locator('.route-card h2')).toHaveText('Delta reconnaissance');
  await expect(page.getByRole('button', { name: 'Begin simulation' })).toBeEnabled();
  await expect(page.getByText('Return to habitat included in every route.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Mission preset' }).selectOption('minerals');
  await expect(page.locator('.route-card h2')).toHaveText('Mineral expedition');
  await expect(page.locator('.stops-list')).toContainText('Mineral survey');
  await page.getByRole('button', { name: 'Science', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Science', exact: true })).toHaveClass('active');
  await expect(page.locator('.mode-explanation')).toContainText('Favors terrain near science destinations');
  const mineralLayer = page.getByRole('switch', { name: 'Mineral signatures' });
  await expect(mineralLayer).toHaveAttribute('aria-checked', 'false');
  await mineralLayer.click();
  await expect(mineralLayer).toHaveAttribute('aria-checked', 'true');
  await mineralLayer.click();
  await expect(mineralLayer).toHaveAttribute('aria-checked', 'false');
  expect(errors).toEqual([]);
});

test('constraints block an over-budget mission and defaults restore a playable plan', async ({ page }) => {
  await page.goto('/?workspace=training');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Mission constraints' })).toBeVisible();
  const budget = page.getByRole('slider', { name: /EVA time budget/ });
  await budget.focus();
  await budget.press('Home');
  await expect(budget).toHaveValue('60');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('button', { name: 'Begin simulation' })).toBeDisabled();
  await expect(page.locator('.warning-banner')).toContainText('EVA budget');
  await page.getByRole('button', { name: 'Adjust limits' }).click();
  await page.getByRole('button', { name: 'Restore scenario defaults' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Begin simulation' })).toBeEnabled();
  await page.getByRole('button', { name: 'Begin simulation' }).click();
  await expect(page.getByRole('button', { name: 'Pause simulation' })).toBeVisible();
  await expect(page.locator('.simulation-strip')).toContainText('accelerated playback');
  await expect.poll(async () => Number.parseInt(await page.locator('.playback > span').innerText(), 10)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await expect(page.getByRole('button', { name: 'Resume simulation' })).toBeVisible();
  await expect(page.locator('.simulation-strip')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset simulation' }).click();
  await expect(page.getByRole('button', { name: 'Begin simulation' })).toBeEnabled();
});

test('science stops can be added, reordered and removed without moving the habitat', async ({ page }) => {
  await page.goto('/?workspace=training');
  await page.getByRole('button', { name: 'Add a science stop' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Crater-floor station/ }).click();
  const names = page.locator('.stops-list .stop-main strong');
  await expect(names).toHaveText(['Ares basecamp', 'Delta outcrop', 'Ridge overlook', 'Crater-floor station']);
  await page.getByRole('button', { name: 'Move Crater-floor station up' }).click();
  await expect(names).toHaveText(['Ares basecamp', 'Delta outcrop', 'Crater-floor station', 'Ridge overlook']);
  await expect(page.getByRole('button', { name: 'Move Delta outcrop up' })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove Crater-floor station' }).click();
  await expect(names).toHaveText(['Ares basecamp', 'Delta outcrop', 'Ridge overlook']);
  await expect(page.getByRole('button', { name: 'Begin simulation' })).toBeEnabled();
});

test('science notes persist, export in the mission package, and import without losing the route', async ({ page }) => {
  await page.goto('/?workspace=training');
  await page.getByRole('button', { name: 'Field journal', exact: true }).click();
  await page.getByRole('textbox', { name: 'Field observation' }).fill('Thin sedimentary layers. Compare grains at the next station.');
  await page.getByRole('button', { name: 'Save observation' }).click();
  await expect(page.locator('.notes-list')).toContainText('Thin sedimentary layers');
  await page.reload();
  await page.getByRole('button', { name: 'Field journal', exact: true }).click();
  await expect(page.locator('.notes-list')).toContainText('Thin sedimentary layers');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Export mission', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download mission package/ }).click();
  const exported = await downloadJson(await downloadPromise);
  expect(exported.version).toBe(1);
  expect(exported.notes).toHaveLength(1);
  expect(exported.route[0]).toEqual(exported.route.at(-1));
  expect(exported.summary.distanceKm).toBeGreaterThan(0);
  expect(exported.coordinateSystem).toContain('synthetic');
  exported.name = 'Imported delta expedition';
  await page.getByLabel('Import mission file').setInputFiles({
    name: 'mission.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.locator('.route-card h2')).toHaveText('Imported delta expedition');
  await expect(page.getByRole('status')).toContainText('Mission imported');
  await page.reload();
  await expect(page.locator('.route-card h2')).toHaveText('Imported delta expedition');
  await page.getByRole('button', { name: 'Field journal', exact: true }).click();
  await expect(page.locator('.notes-list')).toContainText('Thin sedimentary layers');
});

test('a tampered import is rejected without replacing the saved mission', async ({ page }) => {
  await page.goto('/?workspace=training');
  const mission = await page.evaluate(() => JSON.parse(localStorage.getItem('areo.mission.v1')!));
  mission.name = 'Should not replace the mission';
  mission.stops[1].x += 20;
  await page.getByLabel('Import mission file').setInputFiles({
    name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(mission)),
  });
  await expect(page.getByRole('status')).toContainText('coordinates');
  await expect(page.locator('.route-card h2')).toHaveText('Delta reconnaissance');
  await page.reload();
  await expect(page.locator('.route-card h2')).toHaveText('Delta reconnaissance');
});

test('the data library loads bundled observations and distinguishes modeled terrain', async ({ page }) => {
  await page.goto('/?workspace=training');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Data library' }).click();
  await expect(page.getByRole('dialog')).toContainText('What is simulated?');
  await expect(page.locator('.source-card')).toHaveCount(5);
  await expect.poll(async () => page.locator('.source-card img').evaluateAll(images =>
    images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)),
  ).toBe(true);
  await expect(page.locator('.source-disclosure')).toContainText('not co-registered');
  const grid = page.getByLabel('Measured elevation grid. Use arrow keys to inspect cells.');
  await expect(grid).toBeVisible();
  const coordinates = page.locator('.dem-detail > small').first();
  const originalCoordinates = await coordinates.innerText();
  await grid.press('ArrowRight');
  await expect(coordinates).not.toHaveText(originalCoordinates);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download provenance manifest' }).click();
  const manifest = await downloadJson(await downloadPromise);
  expect(manifest).toBeTruthy();
});

test('the mobile layout keeps the mission and sidebar controls reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?workspace=training');
  await expect(page.getByRole('button', { name: 'Toggle sidebar' })).toBeVisible();
  await expect(page.locator('.route-card h2')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  await expect(page.getByRole('combobox', { name: 'Mission preset' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Mission preset' }).selectOption('crater');
  await page.getByRole('button', { name: 'Close sidebar' }).click();
  await expect(page.getByRole('combobox', { name: 'Mission preset' })).toBeHidden();
  await expect(page.locator('.route-card h2')).toHaveText('Crater-floor survey');
});
