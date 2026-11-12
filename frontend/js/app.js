import { FINAL_REWARD } from './final-reward.js';
import { calculateProgress } from './progress.js';
import { createDistanceProvider } from './game.js';
import { loadRuntimeConfig } from './runtime-config.js';
import { createHttpProgressProvider } from './http-progress.js';
import { createApiHistory } from './api-history.js';
import { createMilestoneHistory, FINISH_MILESTONE_ID } from './milestone-history.js';
import { createMilestoneReveals } from './milestone-dialog.js';

let provider;
let history;
let reveals;
let usingApi = false;
const number = new Intl.NumberFormat('es-ES', { maximumSignificantDigits: 12 });
const percentageNumber = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const $ = (id) => document.getElementById(id);
const gameTitle = document.createElement('span');
gameTitle.id = 'game-title';
gameTitle.textContent = 'Cargando aventura…';
document.querySelector('.intro h1').replaceChildren(gameTitle);
document.querySelector('.intro .eyebrow').textContent = 'VERSIÓN DE PRUEBAS';
const setupMessage = document.createElement('p');
setupMessage.id = 'setup-message';
setupMessage.className = 'config-notice';
setupMessage.setAttribute('role', 'status');
setupMessage.textContent = 'Preparando la partida…';
document.querySelector('.adventure-layout').before(setupMessage);
const path = $('route');
const pathLength = path.getTotalLength();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let displayedRatio = 0;
let targetRatio = 0;
let frame;
let milestones = [];

function initializeMilestones(definitions) {
  const template = document.querySelector('[data-milestone]').cloneNode(true);
  milestones = definitions.map((definition, index) => {
    const node = template.cloneNode(true);
    node.dataset.milestone = definition.id;
    node.dataset.percent = definition.percent;
    node.querySelector('.milestone-label > text').textContent = `${String(index + 1).padStart(2, '0')} / ${number.format(definition.percent)} %`;
    const point = path.getPointAtLength(pathLength * definition.percent / 100);
    node.setAttribute('transform', `translate(${point.x} ${point.y})`);
    node.querySelector('.milestone-label').setAttribute('transform', `translate(${point.x > 240 ? -180 : 24} -24)`);
    return node;
  });
  $('milestones').replaceChildren(...milestones);
  $('milestones').setAttribute('visibility', 'visible');
  $('milestone-summary').replaceChildren(...[...definitions.map(item => item.id), FINISH_MILESTONE_ID].map(id => {
    const item = document.createElement('li'); item.dataset.milestoneSummary = id; return item;
  }));
}

function renderMilestones(ratio) {
  const states = milestones.map(node => {
    const unlocked = Boolean(history?.isUnlocked(node.dataset.milestone));
    node.classList.toggle('unlocked', unlocked);
    node.querySelector('.milestone-state').textContent = ratio === null ? 'SIN DATOS' : unlocked ? 'DESBLOQUEADO' : 'BLOQUEADO';
    return `Hito ${number.format(Number(node.dataset.percent))} %: ${ratio === null ? 'sin datos' : unlocked ? 'conseguido históricamente' : 'bloqueado'}.`;
  });
  const finishUnlocked = Boolean(history?.isUnlocked(FINISH_MILESTONE_ID));
  $('completion-card').hidden = !finishUnlocked;
  states.push(`Meta 100 %: ${ratio === null ? 'sin datos' : finishUnlocked ? 'conseguida históricamente' : 'pendiente'}. Regalo final disponible cuando se consigue la meta.`);
  document.querySelectorAll('#milestone-summary li').forEach((item, index) => { item.textContent = states[index]; });
  if (history) {
    const count = milestones.filter(node => history.isUnlocked(node.dataset.milestone)).length;
    $('unlocks-note').hidden = false;
    $('unlocks-note').textContent = `${count} ${count === 1 ? 'hito conseguido' : 'hitos conseguidos'} en este recorrido.${finishUnlocked ? ' Meta conseguida anteriormente; el regalo permanece conseguido.' : ''} Los cofres conseguidos se conservan aunque retroceda el progreso.`;
  }
  return states.join(' ');
}

function placeTraveler(ratio) {
  displayedRatio = ratio;
  const point = path.getPointAtLength(pathLength * ratio);
  $('traveler').setAttribute('transform', `translate(${point.x} ${point.y})`);
  $('route-progress').setAttribute('stroke-dasharray', `${pathLength * ratio} ${pathLength}`);
}

function moveTraveler(ratio, animate) {
  cancelAnimationFrame(frame);
  targetRatio = ratio;
  if (!animate || reducedMotion.matches) {
    placeTraveler(ratio);
    return;
  }
  const startRatio = displayedRatio;
  const started = performance.now();
  function step(now) {
    const elapsed = Math.min(1, (now - started) / 650);
    const eased = 1 - (1 - elapsed) ** 3;
    placeTraveler(startRatio + (ratio - startRatio) * eased);
    if (elapsed < 1) frame = requestAnimationFrame(step);
  }
  frame = requestAnimationFrame(step);
}

reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    cancelAnimationFrame(frame);
    placeTraveler(targetRatio);
  }
});

function render(state, animate = true) {
  const result = calculateProgress(state.distanceKm, state.goalKm);
  $('distance').textContent = number.format(result.distanceKm);
  $('goal').textContent = number.format(result.goalKm);
  $('remaining').textContent = number.format(result.remainingKm);
  $('percentage').textContent = `${percentageNumber.format(result.percentage)} %`;
  $('progress').value = result.percentage;
  $('progress').textContent = `${percentageNumber.format(result.percentage)} %`;
  $('journey-message').textContent = result.complete
    ? '¡Recorrido completado! Has llegado a la cima.'
    : result.distanceKm === 0
      ? 'Todo listo. ¡A por el primer kilómetro!'
      : `¡Sigue sumando! Quedan ${number.format(result.remainingKm)} km hasta la cima.`;
  const milestoneDescription = renderMilestones(result.ratio);
  reveals?.synchronize();
  $('map-description').textContent = `Mapa vertical completo desde la salida abajo hasta la meta arriba, pasando por bosque, río, cañón y montaña. Has recorrido ${number.format(result.distanceKm)} de ${number.format(result.goalKm)} km (${percentageNumber.format(result.percentage)} %). ${milestoneDescription}`;
  if (!usingApi) $('storage-note').textContent = (provider.isPersistent() && (!history || history.isPersistent()))
    ? 'Tu progreso se guarda en este navegador.'
    : 'No se ha podido leer o guardar todo el avance y los hitos. Puedes seguir; los cambios podrían perderse al recargar.';
  $('traveler').setAttribute('visibility', 'visible');
  moveTraveler(result.ratio, animate);
  if (animate) $('status').textContent = `${number.format(result.distanceKm)} km recorridos. ${percentageNumber.format(result.percentage)} % completado. ${$('journey-message').textContent} ${milestoneDescription}`;
}

function showNotice(message, error = false) {
  const notice = $('setup-message');
  notice.hidden = false;
  notice.classList.toggle('error', error);
  notice.setAttribute('role', error ? 'alert' : 'status');
  notice.textContent = message;
}

async function start() {
  try {
    const { game, rewards, api } = await loadRuntimeConfig();
    document.title = game.title;
    $('game-title').textContent = game.title;
    $('goal').textContent = number.format(game.goalKm);
    $('start-date').dateTime = game.startDate;
    $('start-date').textContent = game.startDate.split('-').reverse().join('/');
    $('time-zone').textContent = game.timeZone;
    $('mode-label').textContent = game.mode === 'simulation' ? 'MODO SIMULADO' : 'MODO REAL';
    $('data-source').textContent = game.mode === 'simulation' ? 'PROTOTIPO / DATOS SIMULADOS' : 'API / PENDIENTE DE DATOS';
    initializeMilestones(rewards.milestones);
    if (game.mode === 'real' && api) { startReal(game, rewards, api); return; }
    let storage;
    if (game.mode === 'simulation') {
      try { storage = window.localStorage; } catch { /* Puede estar bloqueado. */ }
    }
    provider = createDistanceProvider(game, storage);
    if (!provider) {
      const message = 'Modo real sin API configurada. No hay datos para mostrar.';
      showNotice(message);
      $('journey-message').textContent = 'Progreso no disponible en modo real.';
      const milestones = renderMilestones(null);
      $('map-description').textContent = `Mapa completo de salida a meta. Progreso real no disponible. ${milestones}`;
      return;
    }
    const initialState = provider.getState();
    history = createMilestoneHistory(storage, { gameId: game.id, milestones: rewards.milestones, initialRatio: calculateProgress(initialState.distanceKm, initialState.goalKm).ratio });
    reveals = createMilestoneReveals({ root: $('milestones'), dialog: $('milestone-dialog'), milestones: [...rewards.milestones, FINAL_REWARD], history });
    $('final-reward-open').addEventListener('click', event => reveals.openFinal(event.currentTarget));
    for (const button of document.querySelectorAll('[data-km]')) {
      button.addEventListener('click', () => {
        const before = provider.getState();
        const next = provider.addDistance(Number(button.dataset.km));
        const distanceDelta = next.distanceKm - before.distanceKm;
        reveals.advance(calculateProgress(before.distanceKm, before.goalKm).ratio, calculateProgress(next.distanceKm, next.goalKm).ratio, distanceDelta, button);
        render(next);
      });
    }
    $('reset').addEventListener('click', () => {
      const next = provider.reset();
      history.reset();
      reveals.close();
      render(next);
    });
    $('setup-message').hidden = true;
    $('simulation-card').hidden = false;
    document.querySelector('.controls-link').hidden = false;
    $('progress').hidden = false;
    reveals.showPending();
    render(provider.getState(), false);
  } catch (error) {
    $('game-title').textContent = 'Partida no disponible';
    $('map-description').textContent = 'Mapa ilustrativo de salida a meta. Progreso no disponible: no se ha podido iniciar la configuración.';
    $('mode-label').textContent = 'ERROR CONFIG.';
    $('journey-message').textContent = 'No se ha iniciado la partida.';
    showNotice(`No se puede iniciar el juego. ${error.message}`, true);
  }
}

function startReal(game, rewards, api) {
  usingApi = true;
  provider = createHttpProgressProvider({ ...api, pageUrl: window.location.href, milestoneIds: rewards.milestones.map(m => m.id) });
  let storage;
  try { storage = window.localStorage; } catch { /* Solo avisos, nunca distancia ni premios. */ }
  history = createApiHistory(storage, { gameId: game.id, endpoint: provider.endpoint, milestoneIds: rewards.milestones.map(m => m.id) });
  reveals = createMilestoneReveals({ root: $('milestones'), dialog: $('milestone-dialog'), milestones: [...rewards.milestones, FINAL_REWARD], history });
  reveals.synchronize();
  $('final-reward-open').addEventListener('click', event => reveals.openFinal(event.currentTarget));
  $('setup-message').hidden = true;
  $('api-card').hidden = false;
  $('api-refresh').addEventListener('click', () => provider.refresh());
  window.addEventListener('pagehide', event => { if (!event.persisted) provider.dispose(); });
  let previous = null;
  provider.subscribe(({ status, snapshot, error }) => {
    $('api-refresh').disabled = status === 'loading';
    $('api-card').setAttribute('aria-busy', String(status === 'loading'));
    $('api-card').dataset.state = status;
    if (status === 'loading') {
      $('api-state').setAttribute('role', 'status');
      $('api-state').textContent = 'Cargando el progreso guardado…';
      return;
    }
    if (status === 'ready') {
      $('progress').hidden = false;
      history.applySnapshot(snapshot.unlockedMilestoneIds);
      if (previous) reveals.advance(calculateProgress(previous.distanceKm, game.goalKm).ratio, calculateProgress(snapshot.distanceKm, game.goalKm).ratio, snapshot.distanceKm - previous.distanceKm, $('api-refresh'), { hadFinal: previous.unlockedMilestoneIds.includes(FINISH_MILESTONE_ID) });
      render({ distanceKm: snapshot.distanceKm, goalKm: game.goalKm }, Boolean(previous));
      if (!previous) reveals.showPending();
      previous = snapshot;
    }
    if (snapshot) {
      const source = snapshot.source === 'fixture' ? 'DATOS DE PRUEBA · D1 LOCAL' : snapshot.source === 'strava-pilot' ? 'PILOTO LOCAL · API' : 'PROGRESO COMPARTIDO · API';
      $('api-source').textContent = source;
      $('data-source').textContent = source;
      $('mode-label').textContent = snapshot.source === 'fixture' ? 'MODO REAL · PRUEBAS' : 'MODO REAL · API';
      $('api-updated').textContent = snapshot.updatedAt === null ? 'Sin fecha de actualización disponible.' : `Última actualización conocida: ${new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short', timeZone: game.timeZone }).format(new Date(snapshot.updatedAt))}.`;
      $('api-state').textContent = status === 'error'
        ? 'Sin conexión o respuesta no válida. Se conserva el último dato recibido; puede estar desactualizado.'
        : `${snapshot.partial ? 'Progreso parcial. Conexión o carga de datos pendiente.' : 'Datos completos.'} ${snapshot.stale ? 'Actualización pendiente. Se conserva el último progreso válido.' : 'Datos actualizados.'}`;
    } else {
      $('api-source').textContent = 'API · SIN DATOS';
      $('api-state').textContent = error === 'timeout' ? 'La API no ha respondido a tiempo. Puedes volver a actualizar.' : 'Sin conexión o sin datos válidos. Puedes volver a actualizar.';
      $('journey-message').textContent = 'Progreso pendiente de la API.';
      $('map-description').textContent = `Mapa ilustrativo. Sin progreso disponible. ${renderMilestones(null)}`;
    }
    $('api-state').setAttribute('role', status === 'error' ? 'alert' : 'status');
  });
  $('journey-message').textContent = 'Esperando datos de la API.';
  provider.refresh();
}

start();
