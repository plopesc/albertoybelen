import { createMilestoneQueue } from './milestones.js';
import { milestonePhoto } from './milestone-photos.js';

/** Los avisos pendientes se muestran al entrar; las imágenes requieren una acción. */
export function createMilestoneReveals({ root, dialog, milestones, history }) {
  const $ = id => dialog.querySelector(`#${id}`);
  const number = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
  const definitions = new Map(milestones.map(item => [item.id, item]));
  const photos = new Map(milestones.map(item => [item.id, milestonePhoto(item)]));
  const photoFor = id => photos.get(id);
  const nodes = () => [...root.querySelectorAll('[data-milestone]')];
  const queue = createMilestoneQueue(milestones, history);
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
    $('reward-view').hidden = phase !== 'notice';
    $('reward-counter').textContent = pending.length ? `${pending.length} ${pending.length === 1 ? 'hito pendiente' : 'hitos pendientes'}` : 'Puedes volver a abrir esta imagen desde el mapa.';
  }

  function reveal() {
    clearTimers();
    if (queue.getState().current === null) return;
    phase = 'revealed';
    dialog.dataset.phase = phase;
    $('reward-eyebrow').textContent = 'UN RECUERDO EN EL CAMINO';
    $('reward-chest').toggleAttribute('hidden', true);
    $('reward-photo-wrap').hidden = false;
    $('reward-status').textContent = '';
    $('reward-status').hidden = true;
    const token = presentation;
    $('reward-photo').onerror = () => {
      if (token !== presentation) return;
      $('reward-photo').hidden = true;
      $('reward-image-error').hidden = false;
    };
    $('reward-photo').src = photoFor(queue.getState().current).src;
    updateControls();
  }

  function present(opener, directImage = false) {
    const { current } = queue.getState();
    const photo = photoFor(current);
    if (!photo) return;
    clearTimers();
    ++presentation;
    phase = 'notice';
    dialog.dataset.phase = phase;
    $('reward-eyebrow').textContent = 'UN NUEVO HITO';
    $('reward-chest').toggleAttribute('hidden', false);
    $('reward-chest').classList.remove('is-open');
    $('reward-photo-wrap').hidden = true;
    $('reward-image-error').hidden = true;
    $('reward-photo').hidden = false;
    $('reward-photo').onerror = null;
    $('reward-photo').removeAttribute('src');
    $('reward-title').textContent = `Hito ${number.format(definitions.get(current).percent)} %`;
    $('reward-description').textContent = photo.title;
    $('reward-status').hidden = false;
    $('reward-status').textContent = '¡Has conseguido un nuevo hito! Abre el cofre para descubrir su imagen.';
    $('reward-photo').alt = photo.alt;
    if (directImage) reveal();
    if (!dialog.open) {
      returnFocus = opener ?? nodes().find(node => node.dataset.milestone === current) ?? document.activeElement;
      dialog.showModal();
    }
    queue.acknowledgeCurrent();
    $('reward-close').focus();
    updateControls();
  }

  function openImage() {
    if (phase !== 'notice') return;
    if (reducedMotion.matches) { reveal(); $('reward-close').focus(); return; }
    phase = 'opening';
    dialog.dataset.phase = phase;
    $('reward-chest').classList.add('is-open');
    $('reward-status').textContent = 'Abriendo el cofre…';
    updateControls();
    $('reward-close').focus();
    const token = presentation;
    timers.push(setTimeout(() => { if (token === presentation) reveal(); }, 800));
  }

  function close() {
    clearTimers(); presentation++;
    queue.close();
    if (dialog.open) dialog.close();
    if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function activate(node) {
    const id = node.dataset.milestone;
    if (!photoFor(id) || !queue.reopen(id)) return;
    present(node, true);
  }
  root.addEventListener('click', event => {
    const node = event.target.closest('[data-milestone]');
    if (node && root.contains(node)) activate(node);
  });
  root.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const node = event.target.closest('[data-milestone]');
    if (!node || !root.contains(node)) return;
    event.preventDefault(); activate(node);
  });
  $('reward-close').addEventListener('click', close);
  $('reward-view').addEventListener('click', openImage);
  $('reward-next').addEventListener('click', () => {
    if (queue.next().current === null) close(); else present();
  });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button')].filter(button => !button.hidden && !button.disabled && button.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => {
    const box = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) close();
  });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches && dialog.open && phase === 'opening') reveal();
  });

  return {
    showPending() {
      if (queue.restorePending().current !== null) present();
    },
    synchronize() {
      const before = queue.getState().current;
      const state = queue.synchronize();
      for (const node of nodes()) {
        const id = node.dataset.milestone;
        const definition = definitions.get(id);
        const available = Boolean(photoFor(id));
        const unlocked = queue.isUnlocked(id);
        node.setAttribute('role', 'button');
        node.setAttribute('tabindex', '0');
        node.setAttribute('aria-disabled', String(!available || !unlocked));
        node.setAttribute('aria-label', `Hito ${number.format(definition.percent)} %: ${!available ? 'imagen todavía sin configurar' : unlocked ? 'abrir imagen desbloqueada' : 'bloqueado'}`);
        node.classList.toggle('milestone-reopen', available && unlocked);
        if (!node.querySelector('.milestone-hit-area')) {
          const box = node.getBBox();
          const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          hit.setAttribute('class', 'milestone-hit-area');
          hit.setAttribute('x', box.x - 4); hit.setAttribute('y', '-38');
          hit.setAttribute('width', box.width + 8); hit.setAttribute('height', '76');
          hit.setAttribute('fill', 'transparent');
          node.prepend(hit);
        }
      }
      if (before !== null && state.current === null) close();
      updateControls();
    },
    advance(previousRatio, nextRatio, distanceDelta, opener) {
      const before = queue.getState().current;
      const state = queue.advance(previousRatio, nextRatio, distanceDelta);
      if (state.current !== null && (before !== state.current || !dialog.open)) present(opener);
      else updateControls();
    },
    close,
  };
}
