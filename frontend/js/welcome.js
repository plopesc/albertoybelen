export function shouldWelcome(start, now, distanceKm) {
  return now < start || distanceKm === 0;
}

export function createWelcome({dialog, title, button, fallbackFocus, rewardDialog}) {
  let opener;
  const open = (trigger = fallbackFocus) => {
    if (dialog.open || rewardDialog.open) return;
    opener = trigger;
    dialog.showModal();
    title.parentElement.scrollTop = 0;
    title.focus({preventScroll:true});
  };
  const close = () => {
    dialog.close();
    opener?.focus({preventScroll:true});
  };
  button.addEventListener('click', close);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    button.focus();
  });
  return {open, get isOpen() { return dialog.open; }};
}
