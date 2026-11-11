import { calculateProgress } from './progress.js';
import { createSimulatedProvider } from './game.js';

let storage;
try { storage = window.localStorage; } catch { /* Puede estar bloqueado. */ }
const provider = createSimulatedProvider(storage);
const number = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const $ = (id) => document.getElementById(id);
const path = $('route');
const pathLength = path.getTotalLength();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let displayedRatio = 0;
let targetRatio = 0;
let frame;
const checkpoints = [...document.querySelectorAll('[data-checkpoint]')];

// Los hitos y el indicador comparten la geometría; no dependen de participantes.
for (const checkpoint of checkpoints) {
  const point = path.getPointAtLength(pathLength * Number(checkpoint.dataset.checkpoint));
  checkpoint.setAttribute('transform', `translate(${point.x} ${point.y})`);
  checkpoint.querySelector('.checkpoint-label').setAttribute(
    'transform', `translate(${point.x > 240 ? -180 : 24} -24)`,
  );
}

function renderCheckpoints(ratio) {
  const states = [];
  for (const checkpoint of checkpoints) {
    const threshold = Number(checkpoint.dataset.checkpoint);
    const unlocked = ratio >= threshold;
    checkpoint.classList.toggle('unlocked', unlocked);
    checkpoint.querySelector('.checkpoint-state').textContent = unlocked ? 'DESBLOQUEADO' : 'BLOQUEADO';
    states.push(`Checkpoint ${threshold * 100} %: ${unlocked ? 'desbloqueado' : 'bloqueado'}.`);
  }
  states.push(`Meta 100 %: ${ratio >= 1 ? 'alcanzada' : 'pendiente'}. Regalo misterioso sin revelar.`);
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
  $('percentage').textContent = `${number.format(result.percentage)} %`;
  $('progress').value = result.percentage;
  $('progress').textContent = `${number.format(result.percentage)} %`;
  $('journey-message').textContent = result.complete
    ? '¡Recorrido completado! Has llegado a la cima.'
    : result.distanceKm === 0
      ? 'Todo listo. ¡A por el primer kilómetro!'
      : `¡Sigue sumando! Quedan ${number.format(result.remainingKm)} km hasta la cima.`;
  const milestoneDescription = renderCheckpoints(result.ratio);
  $('map-description').textContent = `Mapa vertical completo desde la salida abajo hasta la meta arriba, pasando por bosque, río, cañón y montaña. Has recorrido ${number.format(result.distanceKm)} de ${number.format(result.goalKm)} km (${number.format(result.percentage)} %). ${milestoneDescription}`;
  $('storage-note').textContent = provider.isPersistent()
    ? 'Tu progreso se guarda en este navegador.'
    : 'No se ha podido leer o guardar el progreso. Puedes seguir; los cambios podrían perderse al recargar.';
  moveTraveler(result.ratio, animate);
  if (animate) $('status').textContent = `${number.format(result.distanceKm)} km recorridos. ${number.format(result.percentage)} % completado. ${$('journey-message').textContent} ${milestoneDescription}`;
}

for (const button of document.querySelectorAll('[data-km]')) {
  button.addEventListener('click', () => render(provider.addDistance(Number(button.dataset.km))));
}

const goalInput = $('goal-input');
function clearError() {
  goalInput.removeAttribute('aria-invalid');
  $('goal-error').hidden = true;
}
goalInput.addEventListener('input', clearError);
$('goal-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!goalInput.checkValidity()) {
    goalInput.setAttribute('aria-invalid', 'true');
    $('goal-error').textContent = 'Introduce una meta válida: al menos 0,1 km, en pasos de 0,1.';
    $('goal-error').hidden = false;
    $('status').textContent = $('goal-error').textContent;
    goalInput.focus();
    return;
  }
  clearError();
  render(provider.setGoal(goalInput.valueAsNumber));
});
$('reset').addEventListener('click', () => render(provider.reset()));
const initialState = provider.getState();
goalInput.value = initialState.goalKm;
render(initialState, false);
