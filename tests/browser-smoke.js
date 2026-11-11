// Ejecutar contra un servidor estático local; solo modifica su estado simulado.
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  const failedAssets = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/config/game.json')) failedAssets.push(response.url());
  });
  const currentKey = 'strava-adventure:simulation:v2';
  const legacyKey = 'strava-adventure:simulation:v1';
  const historyPrefix = 'strava-adventure:milestones:';
  const configUrl = new URL('./config/game.json', page.url()).href;
  await page.unroute(configUrl);
  const base = await page.evaluate(async (url) => (await fetch(url, { cache: 'no-store' })).json(), configUrl);
  base.game.mode = 'simulation';
  base.game.goalKm = 100;
  base.rewards = { milestones: [20, 40, 60, 80], finish: 100 };
  let requested = 0;
  let configured = structuredClone(base);
  let failure = null;
  await page.route(configUrl, async (route) => {
    requested++;
    if (failure === 'http') return route.fulfill({ status: 404, body: 'not found' });
    if (failure === 'json') return route.fulfill({ contentType: 'application/json', body: '{' });
    if (failure === 'network') return route.abort();
    return route.fulfill({ json: configured });
  });
  const text = (id) => page.locator(`#${id}`).textContent();
  const ready = () => page.waitForFunction(() => !document.getElementById('simulation-card').hidden && document.getElementById('distance').textContent !== '—');
  const reload = async () => { await page.reload(); await ready(); };
  const saveState = (distanceKm) => page.evaluate(({ key, distanceKm }) => localStorage.setItem(key, JSON.stringify({ version: 2, distanceKm })), { key: currentKey, distanceKm });
  const markerAt = (ratio) => page.waitForFunction((expected) => {
    const path = document.getElementById('route');
    const point = path.getPointAtLength(path.getTotalLength() * expected);
    const matrix = document.getElementById('traveler').transform.baseVal.consolidate().matrix;
    return document.getElementById('traveler').getAttribute('visibility') === 'visible' && Math.hypot(matrix.e - point.x, matrix.f - point.y) < 0.1;
  }, ratio);

  await page.evaluate(({ currentKey, legacyKey }) => { localStorage.removeItem(currentKey); localStorage.removeItem(legacyKey); }, { currentKey, legacyKey });
  await page.evaluate(prefix => { for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key); }, historyPrefix);
  await reload();
  assert(requested > 0, 'Debe pedir el JSON desde la subruta del sitio');
  assert(await text('distance') === '0' && await text('goal') === String(base.game.goalKm), 'El objetivo debe venir del JSON');
  assert(await page.locator('#goal-form').count() === 0, 'La meta no debe poder editarse en la interfaz pública');
  await page.evaluate(async () => {
    for (const asset of document.querySelectorAll('.map image')) {
      const image = new Image(); image.src = asset.getAttribute('href'); await image.decode();
    }
  });
  await markerAt(0);
  for (const km of [1, 5, 10]) await page.getByRole('button', { name: `+${km} km`, exact: true }).click();
  await markerAt(16 / base.game.goalKm);
  assert(await text('distance') === '16', 'Los tres botones deben sumar 16 km');
  await reload();
  assert(await text('distance') === '16', 'La distancia debe persistir');

  // Cambiar solo la respuesta del JSON equivale a editar la configuración pública.
  configured.game = { ...configured.game, title: 'Carrera de prueba <segura>', goalKm: 16, startDate: '2028-02-29', timeZone: 'Europe/Madrid' };
  await reload();
  await markerAt(1);
  assert(await page.title() === configured.game.title && await text('game-title') === configured.game.title, 'Título procedente del JSON mediante texto seguro');
  assert(await text('start-date') === '29/02/2028' && await text('time-zone') === 'Europe/Madrid', 'Fecha inclusiva y zona horaria deben mostrarse sin depender de la zona del navegador');
  assert(await text('remaining') === '0' && await text('percentage') === '100 %', 'Debe recalcular con el nuevo objetivo');
  await page.getByRole('button', { name: '+10 km', exact: true }).click();
  await markerAt(1);
  assert(await text('distance') === '26', 'Se conservan los kilómetros por encima del 100 %');

  configured = structuredClone(base);
  configured.game.goalKm = 100;
  for (const km of [0, 19.9, 20, 39.9, 40, 50, 59.9, 60, 79.9, 80, 100, 125]) {
    await page.evaluate(prefix => { for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key); }, historyPrefix);
    await saveState(km); await reload(); await markerAt(Math.min(km / 100, 1));
    assert(await page.locator('[data-milestone].unlocked').count() === [20, 40, 60, 80].filter(p => km >= p).length, `Estados a ${km} km`);
    const geometry = await page.evaluate(() => {
      const path = document.getElementById('route');
      return [...document.querySelectorAll('[data-milestone]')].every((element) => {
        const point = path.getPointAtLength(path.getTotalLength() * Number(element.dataset.percent) / 100);
        const matrix = element.transform.baseVal.consolidate().matrix;
        const box = element.getBBox();
        return Math.hypot(matrix.e - point.x, matrix.f - point.y) < 0.1 && box.x + matrix.e >= 0 && box.x + box.width + matrix.e <= 480;
      });
    });
    assert(geometry, 'Hitos sobre el camino con etiquetas dentro del mapa');
  }
  configured.game.goalKm = 200;
  await reload();
  assert(await page.locator('[data-milestone].unlocked').count() === 4, 'El objetivo nuevo conserva los hitos históricos aunque cambie el progreso actual');
  await page.getByRole('button', { name: 'Reiniciar kilómetros' }).focus();
  await page.keyboard.press('Space'); await markerAt(0);
  assert(await text('goal') === '200' && await page.locator('[data-milestone].unlocked').count() === 0, 'Reiniciar conserva configuración y bloquea hitos');
  await page.getByRole('button', { name: '+1 km', exact: true }).focus();
  await page.keyboard.press('Enter'); await markerAt(1 / 200);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    document.querySelector('[data-km="5"]').click();
    const path = document.getElementById('route');
    const point = path.getPointAtLength(path.getTotalLength() * 6 / 200);
    const matrix = document.getElementById('traveler').transform.baseVal.consolidate().matrix;
    if (Math.hypot(matrix.e - point.x, matrix.f - point.y) > 0.1) throw new Error('Movimiento reducido debe ser inmediato');
  });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      return document.documentElement.scrollWidth <= viewport && [...document.querySelectorAll('button:not([hidden])')].filter(element => element.getClientRects().length).every(element => {
        const box = element.getBoundingClientRect(); return box.x >= 0 && box.right <= viewport && box.height >= 44;
      });
    }), `Sin desbordamientos a ${width} px`);
    if (width <= 760) assert(await page.evaluate(() => document.querySelector('.map-card').getBoundingClientRect().bottom <= document.querySelector('.progress-card').getBoundingClientRect().top), 'Mapa antes que datos en móvil');
  }

  // Migración: se conserva distancia, se ignora objetivo antiguo y se escribe v2.
  await page.evaluate(({ currentKey, legacyKey }) => {
    localStorage.removeItem(currentKey); localStorage.setItem(legacyKey, JSON.stringify({ distanceKm: 12, goalKm: 999 }));
  }, { currentKey, legacyKey });
  configured.game.goalKm = 50;
  await reload(); await markerAt(12 / 50);
  assert(await text('distance') === '12' && await text('goal') === '50', 'Migración con precedencia del JSON');
  assert(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).version, currentKey) === 2, 'Debe migrar a v2');
  await page.evaluate((key) => localStorage.setItem(key, '{'), currentKey);
  await reload();
  assert(await text('distance') === '0', 'Debe recuperarse de v2 corrupto sin resucitar v1');

  configured.rewards.milestones = [25, 50, 75];
  await saveState(25); await reload();
  assert(await page.locator('[data-milestone]').count() === 3 && await page.locator('[data-milestone].unlocked').count() === 0, 'Los hitos nuevos del JSON no se descubren retroactivamente');
  configured.rewards.milestones = [];
  await reload();
  assert(await page.locator('[data-milestone]').count() === 0, 'Lista vacía de milestones válida');

  configured = structuredClone(base); configured.game.mode = 'real';
  await saveState(88); await page.reload();
  await page.waitForFunction(() => document.getElementById('mode-label').textContent === 'MODO REAL');
  assert((await text('setup-message')).includes('Modo real aún no disponible'), 'Debe explicar que no hay proveedor real');
  assert(await text('distance') === '—' && await text('remaining') === '—' && await text('percentage') === '—', 'No debe presentar datos simulados como reales');
  assert(!await page.locator('#simulation-card').isVisible() && !await page.locator('#progress').isVisible(), 'Sin controles ni progreso ficticio en modo real');
  assert(await page.locator('#traveler').getAttribute('visibility') === 'hidden', 'Sin posición inventada');
  assert(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).distanceKm, currentKey) === 88, 'Real no modifica simulación guardada');

  for (const scenario of ['http', 'json', 'network', 'goal', 'date', 'mode', 'milestones']) {
    configured = structuredClone(base); failure = ['http', 'json', 'network'].includes(scenario) ? scenario : null;
    if (scenario === 'goal') configured.game.goalKm = 0;
    if (scenario === 'date') configured.game.startDate = '2027-02-29';
    if (scenario === 'mode') configured.game.mode = 'other';
    if (scenario === 'milestones') configured.rewards.milestones = [20, 20];
    await page.reload();
    await page.waitForFunction(() => document.getElementById('setup-message').getAttribute('role') === 'alert');
    assert((await text('setup-message')).includes('No se puede iniciar'), `Error visible: ${scenario}`);
    assert(await text('distance') === '—' && !await page.locator('#simulation-card').isVisible(), 'Un error no debe activar simulación');
  }
  failure = null; configured = structuredClone(base);
  const blocked = await page.context().newPage();
  await blocked.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Bloqueado', 'SecurityError'); } }));
  await blocked.route(configUrl, route => route.fulfill({ json: base }));
  await blocked.goto(page.url());
  await blocked.locator('#simulation-card').waitFor({ state: 'visible' });
  await blocked.getByRole('button', { name: '+5 km', exact: true }).click();
  assert(await blocked.locator('#distance').textContent() === '5', 'Debe funcionar sin almacenamiento');
  assert((await blocked.locator('#storage-note').textContent()).includes('podrían perderse'), 'Debe avisar de persistencia bloqueada');
  await blocked.close();
  await page.unroute(configUrl); await page.reload();
  await page.waitForFunction(() => document.getElementById('mode-label').textContent !== 'CARGANDO');
  assert(errors.length === 0, `Errores JS: ${errors.join(', ')}`);
  assert(failedAssets.length === 0, `Recursos fallidos: ${failedAssets.join(', ')}`);
  return 'OK: JSON en subruta, validación, fecha/zona, título, objetivo, migración v1/v2, selección real/simulado, hitos configurables, persistencia, teclado, movimiento reducido y responsive 320/390/768/1280.';
}
