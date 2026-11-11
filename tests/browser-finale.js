async page => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const url = new URL('./config/game.json', page.url()).href;
  const config = await page.evaluate(async url => (await fetch(url)).json(), url);
  config.game = { ...config.game, id: 'final-browser', goalKm: 100, mode: 'simulation' };
  let configured = structuredClone(config);
  await page.route(url, route => route.fulfill({ json: configured }));
  const historyKey = 'strava-adventure:milestones:v2:final-browser';
  const distanceKey = 'strava-adventure:simulation:v2';
  const distance = km => page.evaluate(({ distanceKey, km }) => localStorage.setItem(distanceKey, JSON.stringify({ version: 2, distanceKm: km })), { distanceKey, km });
  const reload = async () => { await page.reload(); await page.locator('#simulation-card').waitFor({ state: 'visible' }); };
  await page.evaluate(({ historyKey }) => localStorage.setItem(historyKey, JSON.stringify({ version: 2, gameId: 'final-browser', unlockedIds: ['milestone-20','milestone-40','milestone-60','milestone-80'], seenNoticeIds: ['milestone-20','milestone-40','milestone-60','milestone-80'] })), { historyKey });
  try {
    await distance(99); await reload();
    assert(await page.locator('#completion-card').isHidden(), '99 km sin premio');
    await page.getByRole('button', { name: '+1 km', exact: true }).click();
    assert(await page.locator('#milestone-dialog').evaluate(dialog => dialog.classList.contains('is-celebrating')), 'Primera llegada celebra');
    assert(await page.locator('#reward-title').textContent() === '¡Reto completado!', 'Título de la meta');
    assert(await page.locator('#reward-photo-wrap').isHidden(), 'El regalo espera Ver imagen');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#reward-view').click();
    await page.locator('#reward-photo').evaluate(image => image.decode());
    assert((await page.locator('#reward-message').textContent()).includes('provisional'), 'Mensaje configurable');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'docs/screenshots/issue-16-gift.png' });
    await page.keyboard.press('Escape');
    await reload();
    assert(!await page.locator('#milestone-dialog').isVisible(), 'Recarga no celebra');
    await distance(110); await reload();
    assert(await page.locator('#percentage').textContent() === '100 %', 'Exceso limitado visualmente');
    await distance(95); await reload();
    assert(await page.locator('#percentage').textContent() === '95 %', 'Corrección actual');
    assert(await page.locator('#completion-card').isVisible(), 'Premio histórico permanece');
    await page.locator('#final-reward-open').click();
    assert(!await page.locator('#milestone-dialog').evaluate(dialog => dialog.classList.contains('is-celebrating')), 'Reapertura sin celebración');
    await page.locator('#reward-view').click();
    assert(await page.locator('#milestone-dialog').getAttribute('data-phase') === 'revealed', 'Movimiento reducido inmediato');
    await page.keyboard.press('Escape');
    assert(await page.locator('#final-reward-open').evaluate(button => button === document.activeElement), 'Restauración de foco');
    await page.getByRole('button', { name: '+5 km', exact: true }).click();
    assert(!await page.locator('#milestone-dialog').isVisible(), 'Recuperar100 no celebra');
    configured.game.goalKm = 700; await reload();
    assert(await page.locator('#completion-card').isVisible(), 'Nueva meta conserva premio');
    assert(!await page.locator('#milestone-dialog').isVisible(), 'Cambio de meta no celebra');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 }); await page.evaluate(() => scrollTo(0,0));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Sin desbordamiento');
      await page.screenshot({ path: `docs/screenshots/issue-16-${width === 390 ? 'mobile' : 'desktop'}.png`, fullPage: true });
    }
    return 'OK final: primer desbloqueo, 110%, recarga, 95→100, meta700, reapertura, Escape/foco, movimiento reducido, capturas móvil/escritorio/regalo.';
  } finally { await page.unroute(url); await page.reload(); }
}
