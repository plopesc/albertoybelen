// Ejecutar con playwright-cli run-code --filename=tests/browser-smoke.js.
// Usa exclusivamente el origen local de prueba: reinicia su estado simulado.
async (page) => {
  const errors = [];
  const responses = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) responses.push(response.url());
  });
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const text = (id) => page.locator(`#${id}`).textContent();
  const markerAt = async (ratio) => {
    await page.waitForFunction((expected) => {
      const path = document.getElementById('route');
      const point = path.getPointAtLength(path.getTotalLength() * expected);
      const matrix = document.getElementById('traveler').transform.baseVal.consolidate().matrix;
      return Math.hypot(matrix.e - point.x, matrix.f - point.y) < 0.1;
    }, ratio);
  };

  await page.evaluate(() => localStorage.removeItem('strava-adventure:simulation:v1'));
  await page.reload();
  await markerAt(0);
  await page.evaluate(async () => {
    const background = new Image();
    background.src = document.querySelector('.map image').getAttribute('href');
    await background.decode();
    if (!background.naturalWidth) throw new Error('Debe cargar el fondo local de 16 bits');
  });
  assert(await text('distance') === '0', 'Debe empezar a cero');
  assert(await page.locator('.checkpoint.unlocked').count() === 0, 'Los cuatro checkpoints empiezan bloqueados');
  // Comprueba cada umbral, sus límites y posiciones sobre el mismo trazado.
  for (const km of [0, 19.9, 20, 39.9, 40, 50, 59.9, 60, 79.9, 80, 100, 125]) {
    await page.evaluate((distanceKm) => localStorage.setItem('strava-adventure:simulation:v1',
      JSON.stringify({ distanceKm, goalKm: 100 })), km);
    await page.reload();
    const ratio = Math.min(km / 100, 1);
    await markerAt(ratio);
    const unlockedCount = [20, 40, 60, 80].filter((threshold) => km >= threshold).length;
    assert(await page.locator('.checkpoint.unlocked').count() === unlockedCount, `Checkpoints a ${km} km`);
    const geometry = await page.evaluate(() => {
      const path = document.getElementById('route');
      return [...document.querySelectorAll('[data-checkpoint]')].every((element) => {
        const point = path.getPointAtLength(path.getTotalLength() * Number(element.dataset.checkpoint));
        const matrix = element.transform.baseVal.consolidate().matrix;
        const box = element.getBBox();
        return Math.hypot(matrix.e - point.x, matrix.f - point.y) < 0.1 &&
          box.x + matrix.e >= 0 && box.x + box.width + matrix.e <= 480;
      });
    });
    assert(geometry, 'Los checkpoints deben estar en el trazado y sus etiquetas dentro del mapa');
    assert((await page.locator('#milestone-summary').textContent()).includes(
      km >= 100 ? 'Meta 100 %: alcanzada' : 'Meta 100 %: pendiente'), 'La meta debe tener estado accesible');
  }
  await page.getByRole('button', { name: 'Reiniciar kilómetros' }).click();
  await markerAt(0);
  assert(await page.locator('.checkpoint.unlocked').count() === 0, 'Reiniciar vuelve a bloquear los hitos');
  await page.getByRole('button', { name: '+1 km', exact: true }).click();
  await page.getByRole('button', { name: '+5 km', exact: true }).click();
  await page.getByRole('button', { name: '+10 km', exact: true }).click();
  await markerAt(0.16);
  assert(await text('distance') === '16', 'Los tres botones deben sumar 16 km');
  await page.reload();
  assert(await text('distance') === '16', 'Los kilómetros deben persistir tras recargar');
  await markerAt(0.16);

  for (const value of ['', '0', '-1', '1.23']) {
    await page.getByLabel('¿Cuál es tu próxima meta?').fill(value);
    await page.getByRole('button', { name: 'Guardar meta' }).click();
    assert(await page.locator('#goal-error').isVisible(), `Debe rechazar meta ${value}`);
    assert(await text('goal') === '100', 'Una meta inválida no debe alterar el estado');
    assert(await page.locator('#goal-input').getAttribute('aria-invalid') === 'true', 'El campo debe indicar el error');
  }

  await page.getByLabel('¿Cuál es tu próxima meta?').fill('16');
  await page.getByLabel('¿Cuál es tu próxima meta?').press('Enter');
  await markerAt(1);
  assert(await page.locator('.checkpoint.unlocked').count() === 4, 'Cambiar la meta debe recalcular los hitos');
  assert(await text('percentage') === '100 %', 'Debe completar la ruta');
  assert(await text('remaining') === '0', 'No debe quedar distancia');
  await page.getByRole('button', { name: '+10 km', exact: true }).click();
  await markerAt(1);
  assert(await text('distance') === '26', 'Debe conservar los kilómetros por encima de la meta');
  assert(await text('remaining') === '0', 'No debe mostrar kilómetros negativos');
  await page.reload();
  assert(await page.getByLabel('¿Cuál es tu próxima meta?').inputValue() === '16', 'Debe restaurar la meta');

  await page.getByLabel('¿Cuál es tu próxima meta?').fill('200');
  await page.getByLabel('¿Cuál es tu próxima meta?').press('Enter');
  await markerAt(26 / 200);
  assert(await page.locator('.checkpoint.unlocked').count() === 0, 'Aumentar la meta debe volver a bloquear los hitos');
  await page.getByLabel('¿Cuál es tu próxima meta?').fill('16');
  await page.getByLabel('¿Cuál es tu próxima meta?').press('Enter');
  await markerAt(1);

  await page.getByRole('button', { name: 'Reiniciar kilómetros' }).focus();
  await page.keyboard.press('Space');
  await markerAt(0);
  assert(await text('goal') === '16', 'Reiniciar debe conservar la meta');
  await page.getByRole('button', { name: '+1 km', exact: true }).focus();
  await page.keyboard.press('Enter');
  await markerAt(1 / 16);
  assert(await text('distance') === '1', 'El teclado debe activar los botones');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    const button = document.querySelector('[data-km="5"]');
    button.click();
    const path = document.getElementById('route');
    const point = path.getPointAtLength(path.getTotalLength() * (6 / 16));
    const matrix = document.getElementById('traveler').transform.baseVal.consolidate().matrix;
    if (Math.hypot(matrix.e - point.x, matrix.f - point.y) > 0.1) {
      throw new Error('Movimiento reducido debe actualizar el marcador inmediatamente');
    }
  });

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const fits = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      return document.documentElement.scrollWidth <= viewport &&
        [...document.querySelectorAll('button,input')].every((element) => {
          const box = element.getBoundingClientRect();
          return box.x >= 0 && box.right <= viewport && box.height >= 44;
        });
    });
    assert(fits, `El contenido y los controles deben caber a ${width}px`);
    if (width <= 760) {
      assert(await page.evaluate(() => {
        const map = document.querySelector('.map-card').getBoundingClientRect();
        const hud = document.querySelector('.progress-card').getBoundingClientRect();
        const controls = document.querySelector('.simulation-card').getBoundingClientRect();
        return map.bottom <= hud.top && hud.bottom <= controls.top;
      }), 'En móvil el mapa debe aparecer primero, seguido de los datos y los controles');
    }
    const map = page.locator('.map');
    assert(await map.isVisible() && await page.locator('[data-checkpoint]').count() === 4,
      'Todo el mapa y sus checkpoints deben existir desde el principio');
    await map.scrollIntoViewIfNeeded();
    await page.locator('#simulation-heading').scrollIntoViewIfNeeded();
    assert(await page.locator('#simulation-heading').isVisible(), 'Se debe poder recorrer el mapa hasta los controles');
  }

  await page.evaluate(() => localStorage.setItem('strava-adventure:simulation:v1', '{'));
  await page.reload();
  assert(await text('distance') === '0' && await text('goal') === '100', 'Debe recuperarse de datos corruptos');
  await page.getByRole('button', { name: '+1 km', exact: true }).click();
  await page.reload();
  assert(await text('distance') === '1', 'Debe poder volver a guardar tras recuperar datos');

  const blockedPage = await page.context().newPage();
  await blockedPage.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Bloqueado', 'SecurityError'); },
    });
  });
  await blockedPage.goto(page.url());
  await blockedPage.getByRole('button', { name: '+5 km', exact: true }).click();
  assert(await blockedPage.locator('#distance').textContent() === '5', 'Debe funcionar con almacenamiento bloqueado');
  assert((await blockedPage.locator('#storage-note').textContent()).includes('podrían perderse'), 'Debe avisar del almacenamiento bloqueado');
  await blockedPage.close();
  assert(errors.length === 0, `Errores JavaScript: ${errors.join(', ')}`);
  assert(responses.length === 0, `Recursos fallidos: ${responses.join(', ')}`);
  return 'OK: simulación, geometría SVG a 0/20/50/80/100 %, umbrales y estados de hitos, límites, validación, persistencia, teclado, movimiento reducido, almacenamiento bloqueado y tamaños 320/390/768/1280.';
}
