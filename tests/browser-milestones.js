// Prueba local de cofres, historial e imágenes; no modifica el JSON del repositorio.
async page => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const url = new URL('./config/game.json', page.url()).href;
  await page.unroute(url);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const base = await page.evaluate(async url => (await fetch(url)).json(), url);
  base.game = { ...base.game, id: 'browser-milestones', goalKm: 100, mode: 'simulation' };
  base.rewards.milestones = [20, 40, 60, 80].map(percent => ({ id: `milestone-${percent}`, percent }));
  let configured = structuredClone(base);
  const historyKey = 'strava-adventure:milestones:v1:browser-milestones';
  const distanceKey = 'strava-adventure:simulation:v2';
  const errors = [], resources = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/no-existe.webp')) resources.push(response.url()); });
  await page.route(url, route => route.fulfill({ json: configured }));
  const dialog = page.locator('#milestone-dialog');
  const node = id => page.locator(`[data-milestone="${id}"]`);
  const add = km => page.getByRole('button', { name: `+${km} km`, exact: true }).click();
  const distance = km => page.evaluate(({ key, km }) => localStorage.setItem(key, JSON.stringify({ version: 2, distanceKm: km })), { key: distanceKey, km });
  const reload = async () => { await page.reload(); await page.locator('#simulation-card').waitFor({ state: 'visible' }); };
  const isClosed = async () => assert(!await dialog.isVisible(), 'No debe abrirse un cofre automáticamente');
  const title = percent => page.waitForFunction(percent => document.getElementById('milestone-dialog').open && document.getElementById('reward-title').textContent === `Hito ${percent} %`, percent);
  const reveal = async id => {
    if (await page.locator('#reward-skip').isVisible()) await page.locator('#reward-skip').click();
    await page.locator('#reward-photo-wrap').waitFor({ state: 'visible' });
    await page.locator('#reward-photo').evaluate(image => image.decode());
    assert((await page.locator('#reward-photo').getAttribute('src')).endsWith(`${id}.webp`), `Imagen correspondiente a ${id}`);
  };
  const close = async () => { await page.locator('#reward-close').click(); await isClosed(); };
  try {
    await page.evaluate(({ historyKey }) => {
      localStorage.removeItem(historyKey);
      localStorage.removeItem('strava-adventure:simulation:v1');
    }, { historyKey });
    await distance(19); await reload(); await isClosed();
    assert(await node('milestone-20').getAttribute('aria-disabled') === 'true', '19 % debe estar bloqueado');
    await node('milestone-20').dispatchEvent('click'); await isClosed();
    await add(1); await title(20);
    assert(await page.locator('#reward-photo-wrap').isHidden(), 'Primero debe verse el cofre, antes de la foto');
    await reveal('milestone-20');
    assert(await page.evaluate(() => document.getElementById('milestone-dialog').contains(document.activeElement)), 'Saltar animación debe conservar el foco en el modal');
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      assert(await page.evaluate(() => document.getElementById('milestone-dialog').contains(document.activeElement)), 'Tab debe permanecer en el modal');
    }
    await page.keyboard.press('Shift+Tab');
    assert(await page.evaluate(() => document.getElementById('milestone-dialog').contains(document.activeElement)), 'Mayús+Tab debe permanecer en el modal');
    await page.keyboard.press('Escape'); await isClosed();
    assert(await page.locator('[data-km="1"]').evaluate(button => button === document.activeElement), 'Escape devuelve foco al control que hizo avanzar');
    await node('milestone-20').focus(); await page.keyboard.press('Enter'); await title(20);
    await page.keyboard.press('Escape'); await isClosed();
    assert(await node('milestone-20').evaluate(element => element === document.activeElement), 'Reapertura devuelve foco al hito');
    await page.waitForTimeout(1100); await isClosed();
    await reload(); await isClosed();
    await node('milestone-20').click(); await title(20);
    await page.waitForFunction(() => document.getElementById('milestone-dialog').dataset.phase === 'opening');
    await page.locator('#reward-photo-wrap').waitFor({ state: 'visible' });
    await page.locator('#reward-photo').evaluate(image => image.decode());
    assert(await page.locator('#reward-chest').evaluate(chest => chest.classList.contains('is-open')), 'La animación automática abre el cofre antes de revelar');
    await page.mouse.click(1, 1); await isClosed();
    assert(await node('milestone-20').evaluate(element => element === document.activeElement), 'Cerrar desde el fondo restaura el foco');

    await distance(39); await reload(); await add(1); await title(40); await reveal('milestone-40'); await close();
    await distance(38); await reload(); await isClosed();
    assert(await page.locator('#percentage').textContent() === '38 %', 'El porcentaje actual debe retroceder');
    assert(await node('milestone-40').getAttribute('aria-disabled') === 'false', 'El hito 40 % permanece reabrible al 38 %');
    await node('milestone-40').click(); await reveal('milestone-40'); await close();
    await add(1); await isClosed(); await add(1); await isClosed();
    for (const percent of [60, 80]) {
      await distance(percent - 1); await reload(); await isClosed();
      assert(await node(`milestone-${percent}`).getAttribute('aria-disabled') === 'true', 'Cada hito futuro está bloqueado');
      await add(1); await title(percent); await reveal(`milestone-${percent}`); await close();
    }

    await page.getByRole('button', { name: 'Reiniciar kilómetros', exact: true }).click(); await isClosed();
    assert(await node('milestone-40').getAttribute('aria-disabled') === 'true', 'El reinicio de pruebas limpia los hitos');
    configured.game.goalKm = 10; await reload(); await add(10);
    for (const percent of [20, 40, 60, 80]) {
      await title(percent);
      assert(await page.locator('dialog[open]').count() === 1, 'No superponer modales');
      await reveal(`milestone-${percent}`);
      if (percent < 80) await page.locator('#reward-next').click();
    }
    await close();
    assert(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).unlockedIds.includes('finish'), historyKey), 'La meta final también se conserva históricamente');
    await page.getByRole('button', { name: 'Reiniciar kilómetros', exact: true }).click();
    await add(10); await title(20); await close();
    await add(1); await isClosed();
    await node('milestone-80').click(); await title(80); await close();

    configured.game.goalKm = 500; await distance(500); await reload(); await isClosed();
    configured.game.goalKm = 700; await reload(); await isClosed();
    assert(await page.locator('#distance').textContent() === '500', 'Cambiar meta conserva kilómetros');
    assert((await page.locator('#unlocks-note').textContent()).includes('Meta conseguida anteriormente'), 'Distinguir meta histórica del porcentaje actual');
    assert(await node('milestone-80').getAttribute('aria-disabled') === 'false', '80 % histórico sigue disponible con meta más alta');
    await node('milestone-80').click(); await reveal('milestone-80'); await close();
    configured.game.goalKm = 350; await reload(); await isClosed();

    configured.game.goalKm = 700;
    configured.rewards.milestones = [
      { id: 'milestone-40', percent: 30 },
      { id: 'nuevo-hito', percent: 55, image: 'assets/milestones/milestone-60.webp' },
    ];
    await reload(); await isClosed();
    assert(await node('nuevo-hito').getAttribute('aria-disabled') === 'true', 'Un hito nuevo no se descubre por editar la configuración');
    await node('milestone-40').click(); await title(30); await reveal('milestone-40'); await close();
    await add(1); await title(55); await reveal('milestone-60'); await close();
    configured.rewards.milestones = [{ id: 'nuevo-hito', percent: 55, image: 'assets/milestones/milestone-60.webp' }];
    await reload();
    assert(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).unlockedIds.includes('milestone-40'), historyKey), 'Retirar un ID no borra su historial');
    configured.rewards.milestones = [{ id: 'milestone-40', percent: 30 }]; await reload();
    assert(await node('milestone-40').getAttribute('aria-disabled') === 'false', 'Restaurar un ID recupera el mismo recuerdo');

    configured.rewards.milestones = [{ id: 'imagen-ausente', percent: 90, image: 'assets/milestones/no-existe.webp' }];
    configured.game.goalKm = 100; await distance(95); await reload(); await isClosed();
    await add(1); await title(90);
    await page.locator('#reward-skip').click();
    await page.locator('#reward-image-error').waitFor({ state: 'visible' });
    assert(await page.locator('#reward-photo').isHidden(), 'Imagen ausente muestra aviso, nunca una foto anterior');
    await close();
    configured = structuredClone(base);
    await reload();
    await page.getByRole('button', { name: 'Reiniciar kilómetros', exact: true }).click();
    await distance(19); await reload();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await add(1); await title(20);
    assert(await dialog.getAttribute('data-phase') === 'revealed', 'Movimiento reducido revela sin temporizadores ni transición');
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const fits = await dialog.evaluate(element => {
        const box = element.getBoundingClientRect();
        return box.x >= 0 && box.right <= innerWidth && box.height <= innerHeight && document.documentElement.scrollWidth <= innerWidth;
      });
      assert(fits, `Modal dentro del viewport a ${width} px`);
      assert(await page.locator('#mode-label').isVisible(), 'Modo visible también a 320 px');
    }
    await close();
    await node('milestone-20').focus(); await page.keyboard.press('Space'); await title(20); await close();
    const session = await page.context().newCDPSession(page);
    const tree = await session.send('Accessibility.getFullAXTree');
    assert(tree.nodes.some(item => item.role?.value === 'button' && item.name?.value?.includes('Hito 20')), 'El árbol accesible debe exponer los botones SVG');
    await session.detach();

    const touchContext = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      const touchPage = await touchContext.newPage();
      touchPage.on('pageerror', error => errors.push(error.message));
      await touchPage.route(url, route => route.fulfill({ json: base }));
      await touchPage.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ version: 2, distanceKm: 40 })), { key: distanceKey });
      await touchPage.goto(page.url());
      await touchPage.locator('#simulation-card').waitFor({ state: 'visible' });
      assert(!await touchPage.locator('#milestone-dialog').isVisible(), 'Recarga móvil con progreso no abre');
      await touchPage.locator('[data-milestone="milestone-40"]').tap();
      await touchPage.locator('#milestone-dialog').waitFor({ state: 'visible' });
      await touchPage.locator('#reward-skip').tap();
      await touchPage.locator('#reward-photo').evaluate(image => image.decode());
      await touchPage.locator('#reward-close').tap();
      assert(!await touchPage.locator('#milestone-dialog').isVisible(), 'Apertura y cierre táctil');
    } finally { await touchContext.close(); }
    assert(errors.length === 0, `Errores JavaScript: ${errors.join(', ')}`);
    assert(resources.length === 0, `Recursos fallidos: ${resources.join(', ')}`);
    return 'OK: 19→20 %, clic/teclado/táctil, cofre→foto, cola 20/40/60/80, Escape/foco, recarga sin autoapertura, retroceso 40→38→40, meta 500→700, IDs/imágenes estables, imagen ausente y movimiento reducido.';
  } finally {
    await page.unroute(url);
    await page.reload();
  }
}
