import { createMilestoneQueue } from './milestones.js';
import { MILESTONE_PHOTOS } from './milestone-photos.js';

/** Sincronizar nunca abre; advance solo debe llamarse tras aumentar distancia. */
export function createMilestoneReveals({ root, dialog, photos = MILESTONE_PHOTOS }) {
  const $ = id => dialog.querySelector(`#${id}`);
  const number = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
  const photoFor = threshold => photos.find(photo => photo.ratio === threshold);
  const nodes = () => [...root.querySelectorAll('[data-checkpoint]')];
  const queue = createMilestoneQueue(nodes().map(node => Number(node.dataset.checkpoint)).filter(threshold => photoFor(threshold)));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let timers = [];
  let returnFocus = null;
  let presentation = 0;
  let phase = 'closed';
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  function updateControls() {
    const { pending } = queue.getState();
    $('reward-next').hidden = pending.length === 0;
    $('reward-next').textContent = `Siguiente hito (${pending.length})`;
    $('reward-skip').hidden = phase === 'revealed';
    $('reward-counter').textContent = pending.length ? `${pending.length} ${pending.length === 1 ? 'hito pendiente' : 'hitos pendientes'}` : 'Puedes volver a abrir esta imagen desde el mapa.';
  }

  function reveal() {
    clearTimers();
    if (!dialog.open || queue.getState().current === null) return;
    const skipHadFocus = document.activeElement === $('reward-skip');
    phase = 'revealed';
    dialog.dataset.phase = phase;
    $('reward-chest').classList.add('is-open');
    $('reward-photo-wrap').hidden = false;
    $('reward-status').textContent = 'Imagen desbloqueada. Imagen provisional de esta versión de pruebas.';
    updateControls();
    if (skipHadFocus) ($('reward-next').hidden ? $('reward-close') : $('reward-next')).focus();
  }

  function present(opener) {
    const { current } = queue.getState();
    const photo = photoFor(current);
    if (!photo) return;
    clearTimers();
    const token = ++presentation;
    phase = 'closed';
    dialog.dataset.phase = phase;
    $('reward-chest').classList.remove('is-open');
    $('reward-photo-wrap').hidden = true;
    $('reward-image-error').hidden = true;
    $('reward-photo').hidden = false;
    $('reward-title').textContent = `Hito ${number.format(current * 100)} %`;
    $('reward-description').textContent = photo.title;
    $('reward-status').textContent = 'Has llegado a un nuevo recuerdo. El cofre se está abriendo.';
    $('reward-photo').alt = photo.alt;
    $('reward-photo').onerror = () => {
      if (token !== presentation) return;
      $('reward-photo').hidden = true;
      $('reward-image-error').hidden = false;
    };
    $('reward-photo').src = photo.src;
    if (!dialog.open) {
      returnFocus = opener ?? document.activeElement;
      dialog.showModal();
    }
    $('reward-close').focus();
    updateControls();
    if (reducedMotion.matches) { reveal(); return; }
    timers.push(setTimeout(() => {
      if (token !== presentation || !dialog.open) return;
      phase = 'opening'; dialog.dataset.phase = phase;
      $('reward-chest').classList.add('is-open');
    }, 180));
    timers.push(setTimeout(() => { if (token === presentation) reveal(); }, 1050));
  }

  function close() {
    clearTimers(); presentation++;
    queue.close();
    if (dialog.open) dialog.close();
    if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function activate(node) {
    const threshold = Number(node.dataset.checkpoint);
    if (!photoFor(threshold) || !queue.reopen(threshold)) return;
    present(node);
  }
  root.addEventListener('click', event => {
    const node = event.target.closest('[data-checkpoint]');
    if (node && root.contains(node)) activate(node);
  });
  root.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const node = event.target.closest('[data-checkpoint]');
    if (!node || !root.contains(node)) return;
    event.preventDefault(); activate(node);
  });
  $('reward-close').addEventListener('click', close);
  $('reward-skip').addEventListener('click', reveal);
  $('reward-next').addEventListener('click', () => {
    if (queue.next().current === null) close(); else present();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => {
    const box = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) close();
  });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches && dialog.open) reveal(); });

  return {
    synchronize(ratio) {
      const before = queue.getState().current;
      const state = queue.synchronize(ratio);
      for (const node of nodes()) {
        const threshold = Number(node.dataset.checkpoint);
        const available = Boolean(photoFor(threshold));
        const unlocked = queue.isUnlocked(threshold);
        node.setAttribute('role', 'button');
        node.setAttribute('tabindex', '0');
        node.setAttribute('aria-disabled', String(!available || !unlocked));
        node.setAttribute('aria-label', `Hito ${number.format(threshold * 100)} %: ${!available ? 'imagen todavía sin configurar' : unlocked ? 'abrir imagen desbloqueada' : 'bloqueado'}`);
        node.classList.toggle('milestone-reopen', available && unlocked);
        if (!node.querySelector('.checkpoint-hit-area')) {
          const box = node.getBBox();
          const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          hit.setAttribute('class', 'checkpoint-hit-area');
          hit.setAttribute('x', box.x - 4); hit.setAttribute('y', '-38');
          hit.setAttribute('width', box.width + 8); hit.setAttribute('height', '76');
          hit.setAttribute('fill', 'transparent');
          node.prepend(hit);
        }
      }
      if (before !== null && state.current === null) close();
      updateControls();
    },
    advance(previousRatio, nextRatio) {
      const before = queue.getState().current;
      const state = queue.advance(previousRatio, nextRatio);
      if (state.current !== null && (before !== state.current || !dialog.open)) present();
      else updateControls();
    },
    close,
  };
}
