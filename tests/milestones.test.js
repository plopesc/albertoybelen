import test from 'node:test';
import assert from 'node:assert/strict';
import { createMilestoneHistory, createUnlockState, HISTORY_STORAGE_PREFIX, LEGACY_HISTORY_STORAGE_PREFIX } from '../frontend/js/milestone-history.js';
import { createMilestoneQueue } from '../frontend/js/milestones.js';
import { milestonePhoto } from '../frontend/js/milestone-photos.js';

const milestones = [20, 40, 60, 80].map(percent => ({ id: `milestone-${percent}`, percent }));
const settings = { gameId: 'alberto-belen', milestones, initialRatio: 0 };
const key = `${HISTORY_STORAGE_PREFIX}alberto-belen`;
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
}
function fixture(initialRatio = 0) {
  const storage = memoryStorage();
  const history = createMilestoneHistory(storage, { ...settings, initialRatio });
  return { storage, history, queue: createMilestoneQueue(milestones, history) };
}

test('19 % bloqueado; al alcanzar 20 % abre una vez y permite reapertura ilimitada', () => {
  const { history, queue } = fixture();
  assert.equal(queue.reopen('milestone-20'), false);
  assert.equal(queue.advance(0, .19, 19).current, null);
  assert.equal(queue.advance(.19, .2, 1).current, 'milestone-20');
  queue.close();
  assert.equal(history.isUnlocked('milestone-20'), true);
  for (let count = 0; count < 3; count++) {
    assert.equal(queue.reopen('milestone-20'), true); queue.close();
  }
  assert.equal(queue.reopen('milestone-40'), false);
  assert.equal(queue.advance(.2, .21, 1).current, null);
});
test('cruce múltiple ordenado, sin superposición; cierre descarta cola pero conserva logros', () => {
  const { queue, history } = fixture();
  assert.deepEqual(queue.advance(0, .8, 80).pending, ['milestone-40', 'milestone-60', 'milestone-80']);
  assert.equal(queue.getState().current, 'milestone-20');
  assert.equal(queue.next().current, 'milestone-40');
  const external = queue.getState(); external.pending.length = 0;
  assert.equal(queue.next().current, 'milestone-60');
  queue.close();
  assert.deepEqual(queue.getState().pending, []);
  assert.equal(history.isUnlocked('milestone-80'), true);
  assert.equal(queue.reopen('milestone-80'), true);
});
test('recarga migra una sola vez desde progreso válido, sin apertura automática', () => {
  const { storage, history } = fixture(.4);
  assert.deepEqual(history.getUnlockedIds(), ['milestone-20', 'milestone-40']);
  const restored = createMilestoneHistory(storage, { ...settings, initialRatio: .38 });
  const queue = createMilestoneQueue(milestones, restored);
  queue.synchronize();
  assert.equal(queue.getState().current, null);
  assert.equal(queue.reopen('milestone-40'), true);
  queue.close();
  assert.equal(queue.advance(.38, .4, 2).current, null, 'volver a cruzar no celebra un ID ya conseguido');
  assert.equal(createMilestoneHistory(storage, { ...settings, initialRatio: .1 }).isUnlocked('milestone-40'), true);
});
test('subir meta 500→700 conserva kilómetros fuera del historial, cofres y meta final', () => {
  const { storage, queue } = fixture();
  queue.advance(0, 1, 500); queue.close();
  const restored = createMilestoneHistory(storage, { ...settings, initialRatio: 500 / 700 });
  assert.equal(restored.isUnlocked('finish'), true);
  assert.equal(restored.isUnlocked('milestone-80'), true);
  const nextQueue = createMilestoneQueue(milestones, restored);
  assert.equal(nextQueue.synchronize().current, null);
  assert.equal(nextQueue.advance(500 / 700, 501 / 700, 1).current, null);
  assert.equal(nextQueue.reopen('milestone-80'), true);
});
test('bajar meta o añadir hitos no descubre retroactivamente: espera un avance real', () => {
  const { storage } = fixture(.2);
  const restored = createMilestoneHistory(storage, { ...settings, initialRatio: .5 });
  const queue = createMilestoneQueue(milestones, restored);
  assert.equal(restored.isUnlocked('milestone-40'), false);
  assert.equal(queue.synchronize().current, null);
  assert.equal(queue.advance(.5, .5, 0).current, null);
  assert.equal(queue.advance(.5, .51, 1).current, 'milestone-40');
});
test('avance después del 100 % puede descubrir IDs nuevos aunque el porcentaje siga limitado', () => {
  const { storage, queue } = fixture(1); queue.close();
  const changed = [...milestones, { id: 'nuevo-recuerdo', percent: 90 }];
  const history = createMilestoneHistory(storage, { ...settings, milestones: changed, initialRatio: 1 });
  assert.equal(history.isUnlocked('nuevo-recuerdo'), false);
  const nextQueue = createMilestoneQueue(changed, history);
  assert.equal(nextQueue.advance(1, 1, 1).current, 'nuevo-recuerdo');
});
test('IDs conservan imagen e historial al mover porcentaje o retirar y restaurar hitos', () => {
  const { storage } = fixture(.4);
  const moved = [{ id: 'milestone-40', percent: 70 }];
  const history = createMilestoneHistory(storage, { ...settings, milestones: moved, initialRatio: .1 });
  assert.equal(history.isUnlocked('milestone-40'), true);
  assert.equal(history.isUnlocked('milestone-20'), true, 'el ID retirado queda archivado');
  assert.ok(milestonePhoto(moved[0]).src.endsWith('/assets/milestones/milestone-40.webp'));
  const restored = createMilestoneHistory(storage, { ...settings, initialRatio: .1 });
  assert.equal(restored.isUnlocked('milestone-20'), true);
  assert.ok(milestonePhoto({ id: 'milestone-29', percent: 29 }).src.endsWith('/milestone-29.webp'));
  assert.ok(milestonePhoto({ id: 'other', percent: 40, image: 'assets/milestones/custom.webp' }).src.endsWith('/custom.webp'));
});
test('reinicio explícito limpia también historial y meta; permite repetir experiencia', () => {
  const { storage, history, queue } = fixture(1);
  queue.reopen('milestone-40'); history.reset();
  assert.equal(queue.synchronize().current, null);
  assert.deepEqual(history.getUnlockedIds(), []);
  assert.equal(createMilestoneHistory(storage, { ...settings, initialRatio: 1 }).isUnlocked('finish'), false, 'registro vacío no se vuelve a migrar');
  assert.equal(queue.advance(0, .2, 20).current, 'milestone-20');
});
test('almacenamiento bloqueado/lleno conserva logros en memoria e informa del límite', () => {
  for (const storage of [undefined, { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } }, { getItem: () => null, setItem() { throw new Error('quota'); } }]) {
    const history = createMilestoneHistory(storage, settings);
    history.advance(0, .4, 40);
    assert.equal(history.isUnlocked('milestone-40'), true);
    assert.equal(history.isPersistent(), false);
    assert.deepEqual(history.advance(.4, .38, -2), []);
    assert.equal(history.isUnlocked('milestone-40'), true);
  }
});
test('historial corrupto no se sobrescribe al cargar; un avance permite recuperarlo', () => {
  const storage = memoryStorage({ [key]: '{' });
  const history = createMilestoneHistory(storage, { ...settings, initialRatio: .4 });
  assert.equal(storage.getItem(key), '{');
  assert.equal(history.isPersistent(), false);
  history.advance(.4, .41, 1);
  assert.equal(history.isPersistent(), true);
  assert.equal(JSON.parse(storage.getItem(key)).version, 2);
});
test('fixture de backend compartido: dos dispositivos reciben los mismos IDs históricos', () => {
  const snapshot = Object.freeze({ unlockedIds: ['milestone-20', 'milestone-40', 'finish'] });
  const deviceA = createUnlockState(milestones, snapshot.unlockedIds);
  const deviceB = createUnlockState(milestones, snapshot.unlockedIds);
  assert.equal(deviceA.isUnlocked('milestone-40'), true);
  assert.equal(deviceB.isUnlocked('finish'), true);
  assert.deepEqual(deviceA.advance(.4, .38, -2), []);
  assert.deepEqual(deviceA.getUnlockedIds(), deviceB.getUnlockedIds());
  const copy = deviceA.getUnlockedIds(); copy.length = 0;
  assert.equal(deviceA.isUnlocked('finish'), true);
});

test('aviso mostrado se persiste aunque se cierre sin abrir la imagen', () => {
  const { storage, history, queue } = fixture();
  queue.advance(0, .2, 20);
  assert.equal(history.hasSeenNotice('milestone-20'), false);
  queue.acknowledgeCurrent(); queue.close();
  const restored = createMilestoneHistory(storage, { ...settings, initialRatio: .2 });
  assert.equal(restored.hasSeenNotice('milestone-20'), true);
  assert.equal(createMilestoneQueue(milestones, restored).restorePending().current, null);
  assert.equal(restored.isUnlocked('milestone-20'), true);
});
test('cerrar el primer aviso conserva los demás pendientes para la siguiente visita', () => {
  const { storage, history, queue } = fixture();
  queue.advance(0, .8, 80);
  queue.acknowledgeCurrent(); queue.close();
  assert.deepEqual(history.getSeenNoticeIds(), ['milestone-20']);
  const restored = createMilestoneHistory(storage, { ...settings, initialRatio: .38 });
  const nextQueue = createMilestoneQueue(milestones, restored);
  assert.deepEqual(nextQueue.restorePending().pending, ['milestone-60', 'milestone-80']);
  assert.equal(nextQueue.getState().current, 'milestone-40');
  nextQueue.acknowledgeCurrent();
  assert.equal(nextQueue.next().current, 'milestone-60');
  assert.equal(restored.hasSeenNotice('milestone-60'), false, 'seleccionar no equivale a haber mostrado');
});
test('logros recibidos desde la última visita se anuncian, sin volver a calcular umbrales', () => {
  const storage = memoryStorage({ [key]: JSON.stringify({ version: 2, gameId: settings.gameId, unlockedIds: ['milestone-20', 'milestone-40'], seenNoticeIds: ['milestone-20'] }) });
  const history = createMilestoneHistory(storage, { ...settings, initialRatio: .1 });
  const queue = createMilestoneQueue(milestones, history);
  assert.equal(queue.restorePending().current, 'milestone-40');
  assert.equal(history.isUnlocked('milestone-60'), false);
});
test('abrir manualmente una imagen también da su aviso por visto, sin consumir otros', () => {
  const { history, queue } = fixture();
  queue.advance(0, .4, 40); queue.close();
  queue.reopen('milestone-40'); queue.acknowledgeCurrent(); queue.close();
  assert.equal(queue.restorePending().current, 'milestone-20');
  assert.equal(history.hasSeenNotice('milestone-40'), true);
  history.markNoticeSeen('milestone-80');
  assert.equal(history.hasSeenNotice('milestone-80'), false, 'un hito bloqueado no puede darse por visto');
});
test('migración v1 conserva logros y considera vistos los avisos antiguos sin modificar v1', () => {
  const legacyKey = `${LEGACY_HISTORY_STORAGE_PREFIX}${settings.gameId}`;
  const original = JSON.stringify({ version: 1, gameId: settings.gameId, unlockedIds: ['milestone-40', 'retirado', 'finish'] });
  const storage = memoryStorage({ [legacyKey]: original });
  const history = createMilestoneHistory(storage, { ...settings, initialRatio: .1 });
  assert.deepEqual(history.getUnlockedIds(), ['milestone-40', 'retirado', 'finish']);
  assert.deepEqual(history.getSeenNoticeIds(), history.getUnlockedIds());
  assert.equal(createMilestoneQueue(milestones, history).restorePending().current, null);
  assert.equal(storage.getItem(legacyKey), original);
  assert.equal(JSON.parse(storage.getItem(key)).version, 2);
  history.reset();
  assert.deepEqual(history.getSeenNoticeIds(), []);
  assert.deepEqual(createMilestoneHistory(storage, { ...settings, initialRatio: 1 }).getUnlockedIds(), [], 'v2 vacío prevalece sobre v1');
});
test('v2 corrupto no resucita logros de v1 ni avisos inválidos', () => {
  const legacyKey = `${LEGACY_HISTORY_STORAGE_PREFIX}${settings.gameId}`;
  const legacy = JSON.stringify({ version: 1, gameId: settings.gameId, unlockedIds: ['finish'] });
  for (const saved of ['{', JSON.stringify({ version: 2, gameId: settings.gameId, unlockedIds: [], seenNoticeIds: ['milestone-40'] })]) {
    const storage = memoryStorage({ [key]: saved, [legacyKey]: legacy });
    const history = createMilestoneHistory(storage, settings);
    assert.equal(history.isPersistent(), false);
    assert.equal(history.isUnlocked('finish'), false);
    assert.equal(storage.getItem(key), saved);
  }
});
test('avisos vistos resisten cambios de porcentaje y archivo, reset limpia ambos conjuntos', () => {
  const { storage, history, queue } = fixture();
  queue.advance(0, .4, 40); queue.acknowledgeCurrent(); queue.next(); queue.acknowledgeCurrent();
  const moved = [{ id: 'milestone-40', percent: 70 }];
  const restored = createMilestoneHistory(storage, { ...settings, milestones: moved, initialRatio: .1 });
  assert.equal(restored.hasSeenNotice('milestone-40'), true);
  assert.equal(restored.hasSeenNotice('milestone-20'), true);
  assert.equal(createMilestoneQueue(moved, restored).restorePending().current, null);
  history.reset();
  assert.deepEqual(history.getUnlockedIds(), []);
  assert.deepEqual(history.getSeenNoticeIds(), []);
});
