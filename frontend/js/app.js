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
    ? '¡Meta alcanzada! Cada paso ha merecido la pena.'
    : result.distanceKm === 0
      ? 'Todo gran viaje empieza con un primer paso.'
      : `¡Sigue así! Te quedan ${number.format(result.remainingKm)} km de aventura.`;
  $('map-description').textContent = `Sendero de salida a meta. Has recorrido ${number.format(result.distanceKm)} de ${number.format(result.goalKm)} km (${number.format(result.percentage)} %).`;
  $('storage-note').textContent = provider.isPersistent()
    ? 'Tu progreso se guarda en este navegador.'
    : 'No se ha podido leer o guardar el progreso. Puedes seguir; los cambios podrían perderse al recargar.';
  moveTraveler(result.ratio, animate);
  if (animate) $('status').textContent = `${number.format(result.distanceKm)} km recorridos. ${number.format(result.percentage)} % completado. ${$('journey-message').textContent}`;
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
