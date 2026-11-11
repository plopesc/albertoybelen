import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(process.env.VISUAL_FRONTEND ?? fileURLToPath(new URL('../frontend/', import.meta.url)));
const output = resolve(process.env.VISUAL_OUTPUT ?? 'artifacts/visual');
const prefix = '/albertoybelen/';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const file = resolve(root, pathname.slice(prefix.length) || 'index.html');
    if (!file.startsWith(root + sep) && file !== resolve(root, 'index.html')) { response.writeHead(404).end(); return; }
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}${prefix}`;
const config = JSON.parse(await readFile(resolve(root, 'config/game.json'), 'utf8'));
config.game = { ...config.game, id: 'visual-fixture', title: 'Alberto y Belén · Kilómetro Arcade', goalKm: 100, startDate: '2026-11-01', timeZone: 'Europe/Madrid', mode: 'simulation' };
const definitions = config.rewards.milestones;
const reached = km => definitions.filter(item => km >= item.percent).map(item => item.id);
const results = [];
let browser;
try {
  await mkdir(output, { recursive: true });
  // Solo se limpian los archivos conocidos: VISUAL_OUTPUT puede contener otros datos.
  for (const viewport of ['mobile', 'desktop']) for (const state of ['0', '60', '100', 'notice', 'image', 'final-gift']) await rm(resolve(output, `${viewport}-${state}.jpg`), { force: true });
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const [name, viewport] of Object.entries({ mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 900 } })) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'es-ES', timezoneId: 'Europe/Madrid', reducedMotion: 'reduce', colorScheme: 'dark' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
    await page.route('**/config/game.json', route => route.fulfill({ json: config }));
    await page.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== new URL(url).origin) { errors.push('Petición externa no permitida'); return route.abort(); }
      return route.fallback();
    });
    async function state(km, unseen = false) {
      await page.goto(url);
      await page.locator('#simulation-card').waitFor({ state: 'visible' });
      await page.evaluate(({ km, ids, unseen }) => {
        localStorage.clear();
        localStorage.setItem('strava-adventure:simulation:v2', JSON.stringify({ version: 2, distanceKm: km }));
        const unlockedIds = [...ids, ...(km >= 100 ? ['finish'] : [])];
        localStorage.setItem('strava-adventure:milestones:v2:visual-fixture', JSON.stringify({ version: 2, gameId: 'visual-fixture', unlockedIds, seenNoticeIds: unseen ? ids.slice(0, -1) : unlockedIds }));
      }, { km, ids: reached(km), unseen });
      await page.reload();
      await page.locator('#simulation-card').waitFor({ state: 'visible' });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.querySelectorAll('.map image')].map(async node => { const image = new Image(); image.src = node.getAttribute('href'); await image.decode(); }));
      });
    }
    async function capture(label, fullPage = false) {
      if (errors.length) throw new Error(errors.join('\n'));
      await page.evaluate(() => scrollTo(0, 0));
      const file = `${name}-${label}.jpg`;
      await page.screenshot({ path: resolve(output, file), type: 'jpeg', quality: 55, fullPage, animations: 'disabled' });
      results.push({ file, viewport, bytes: (await stat(resolve(output, file))).size });
    }
    for (const km of [0, 60, 100]) { await state(km); await capture(String(km), true); }
    await state(60, true);
    await page.locator('#milestone-dialog').waitFor({ state: 'visible' });
    if (await page.locator('#reward-photo-wrap').isVisible()) throw new Error('El aviso no debe abrir su imagen');
    await capture('notice');
    await page.getByRole('button', { name: 'Ver imagen', exact: true }).click();
    await page.locator('#reward-photo-wrap').waitFor({ state: 'visible' });
    await page.locator('#reward-photo').evaluate(image => image.decode());
    await capture('image');
    await page.locator('#reward-close').click();
    // #16 se puede revisar con este mismo capturador al integrar su botón público.
    await state(100);
    const finalButton = page.getByRole('button', { name: 'Abrir regalo final', exact: true });
    if (await finalButton.count()) {
      await finalButton.click();
      const view = page.getByRole('button', { name: 'Ver imagen', exact: true });
      if (await view.isVisible()) await view.click();
      await page.locator('#reward-photo').evaluate(image => image.decode());
      await capture('final-gift');
    }
    await context.close();
  }
  const bytes = results.reduce((sum, item) => sum + item.bytes, 0);
  if (bytes >= 5_000_000) throw new Error(`Artefacto demasiado grande: ${bytes} bytes`);
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ fixture: 'synthetic-2026-11-01', prefix, format: 'jpeg-quality-55', totalBytes: bytes, screenshots: results }, null, 2) + '\n');
  console.log(`${results.length} capturas; ${bytes} bytes (<5 MB). ${output}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
