import { calculateProgress } from './progress.js';
import { createDistanceProvider } from './game.js';
import { loadGameConfig } from './config.js';

let provider;
const number = new Intl.NumberFormat('es-ES', { maximumSignificantDigits: 12 });
const percentageNumber = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const $ = (id) => document.getElementById(id);
const gameTitle = document.createElement('span');
gameTitle.id = 'game-title';
gameTitle.textContent = 'Cargando aventura…';
document.querySelector('.intro h1').replaceChildren(gameTitle);
document.querySelector('.intro .eyebrow').textContent = 'VERSIÓN DE PRUEBAS';
const path = $('route');
const pathLength = path.getTotalLength();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let displayedRatio = 0;
let targetRatio = 0;
let frame;
let checkpoints = [];

function initializeCheckpoints(percentages) {
  const template = document.querySelector('[data-checkpoint]').cloneNode(true);
  checkpoints = percentages.map((percent, index) => {
    const checkpoint = template.cloneNode(true);
    const ratio = percent / 100;
    checkpoint.dataset.checkpoint = ratio;
    checkpoint.querySelector('.checkpoint-label > text').textContent = `${String(index + 1).padStart(2, '0')} / ${number.format(percent)} %`;
    const point = path.getPointAtLength(pathLength * ratio);
    checkpoint.setAttribute('transform', `translate(${point.x} ${point.y})`);
    checkpoint.querySelector('.checkpoint-label').setAttribute('transform', `translate(${point.x > 240 ? -180 : 24} -24)`);
    return checkpoint;
  });
  $('checkpoints').replaceChildren(...checkpoints);
  $('checkpoints').setAttribute('visibility', 'visible');
  const milestones = [...percentages, 100].map((percent) => {
    const item = document.createElement('li');
    item.dataset.milestone = percent / 100;
    return item;
  });
  $('milestone-summary').replaceChildren(...milestones);
}

function renderCheckpoints(ratio) {
  const states = [];
  for (const checkpoint of checkpoints) {
    const threshold = Number(checkpoint.dataset.checkpoint);
    const unlocked = ratio !== null && ratio >= threshold;
    checkpoint.classList.toggle('unlocked', unlocked);
    checkpoint.querySelector('.checkpoint-state').textContent = ratio === null ? 'SIN DATOS' : unlocked ? 'DESBLOQUEADO' : 'BLOQUEADO';
    states.push(`Checkpoint ${number.format(threshold * 100)} %: ${ratio === null ? 'sin datos' : unlocked ? 'desbloqueado' : 'bloqueado'}.`);
  }
  states.push(`Meta 100 %: ${ratio === null ? 'sin datos' : ratio >= 1 ? 'alcanzada' : 'pendiente'}. Regalo misterioso sin revelar.`);
  document.querySelectorAll('[data-milestone]').forEach((item, index) => {
    item.textContent = states[index];
  });
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
  const milestoneDescription = renderCheckpoints(result.ratio);
  $('map-description').textContent = `Mapa vertical completo desde la salida abajo hasta la meta arriba, pasando por bosque, río, cañón y montaña. Has recorrido ${number.format(result.distanceKm)} de ${number.format(result.goalKm)} km (${percentageNumber.format(result.percentage)} %). ${milestoneDescription}`;
  $('storage-note').textContent = provider.isPersistent()
    ? 'Tu progreso se guarda en este navegador.'
    : 'No se ha podido leer o guardar el progreso. Puedes seguir; los cambios podrían perderse al recargar.';
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
    const { game, rewards } = await loadGameConfig();
    document.title = game.title;
    $('game-title').textContent = game.title;
    $('goal').textContent = number.format(game.goalKm);
    $('start-date').dateTime = game.startDate;
    $('start-date').textContent = game.startDate.split('-').reverse().join('/');
    $('time-zone').textContent = game.timeZone;
    $('mode-label').textContent = game.mode === 'simulation' ? 'MODO SIMULADO' : 'MODO REAL';
    $('data-source').textContent = game.mode === 'simulation' ? 'PROTOTIPO / DATOS SIMULADOS' : 'PROTOTIPO / MODO REAL NO DISPONIBLE';
    initializeCheckpoints(rewards.checkpoints);
    let storage;
    if (game.mode === 'simulation') {
      try { storage = window.localStorage; } catch { /* Puede estar bloqueado. */ }
    }
    provider = createDistanceProvider(game, storage);
    if (!provider) {
      const message = 'Modo real aún no disponible. La conexión con Strava y el backend todavía no están implementados. No hay kilómetros reales disponibles.';
      showNotice(message);
      $('journey-message').textContent = 'Progreso no disponible en modo real.';
      const milestones = renderCheckpoints(null);
      $('map-description').textContent = `Mapa completo de salida a meta. Progreso real no disponible. ${milestones}`;
      return;
    }
    for (const button of document.querySelectorAll('[data-km]')) {
      button.addEventListener('click', () => render(provider.addDistance(Number(button.dataset.km))));
    }
    $('reset').addEventListener('click', () => render(provider.reset()));
    $('setup-message').hidden = true;
    $('simulation-card').hidden = false;
    document.querySelector('.controls-link').hidden = false;
    $('progress').hidden = false;
    render(provider.getState(), false);
  } catch (error) {
    $('game-title').textContent = 'Partida no disponible';
    $('map-description').textContent = 'Mapa ilustrativo de salida a meta. Progreso no disponible: no se ha podido iniciar la configuración.';
    $('mode-label').textContent = 'ERROR CONFIG.';
    $('journey-message').textContent = 'No se ha iniciado la partida.';
    showNotice(`No se puede iniciar el juego. ${error.message}`, true);
  }
}

start();
