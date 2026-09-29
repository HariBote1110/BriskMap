// Help dialog: lists the controls from the engine contract for the current mode.
import { el } from './dom.mjs';
import { ICONS } from './icons.mjs';

// [input key, action key] pairs, taken from the engine contract.
const CONTROLS = {
  '3d': {
    mouse: [['in.drag', 'act.orbit'], ['in.rightDrag', 'act.pan'], ['in.wheel', 'act.zoom']],
    touch: [['in.oneFinger', 'act.orbit'], ['in.twoFinger', 'act.pan'], ['in.pinch', 'act.zoom']],
    keyboard: [['in.arrows', 'act.pan'], ['in.wasd', 'act.pan'], ['in.qe', 'act.rotate']],
  },
  '2d': {
    mouse: [['in.drag', 'act.pan'], ['in.wheel', 'act.zoom']],
    touch: [['in.oneFinger', 'act.pan'], ['in.pinch', 'act.zoom']],
    keyboard: [['in.arrows', 'act.pan']],
  },
};

const KEY_INPUTS = new Set(['in.arrows', 'in.wasd', 'in.qe']);

export function createHelp({ dialog, openButton, closeButton, title, current, body, note, t }) {
  let mode = '3d';

  openButton.innerHTML = ICONS.help;
  openButton.setAttribute('aria-label', t('help.open'));
  openButton.title = t('help.open');
  closeButton.innerHTML = ICONS.close;
  closeButton.setAttribute('aria-label', t('help.close'));
  title.textContent = t('help.title');
  note.textContent = t('help.keyboardNote');

  function render() {
    current.textContent = t('help.current', { mode: t(`mode.${mode}.long`) });
    body.replaceChildren(...Object.entries(CONTROLS[mode]).map(([group, rows]) =>
      el('section', { class: 'help-section' }, [
        el('h3', { text: t(`help.${group}`) }),
        el('dl', { class: 'help-list' }, rows.flatMap(([input, action]) => [
          el('dt', {}, KEY_INPUTS.has(input) ? el('kbd', { text: t(input) }) : t(input)),
          el('dd', { text: t(action) }),
        ])),
      ])));
  }

  openButton.addEventListener('click', () => {
    render();
    dialog.showModal();
    closeButton.focus();
  });
  closeButton.addEventListener('click', () => dialog.close());
  // Some browsers (Safari) do not focus a clicked button, so return focus explicitly.
  dialog.addEventListener('close', () => openButton.focus({ preventScroll: true }));
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    if (!inside) dialog.close();
  });
  // showModal() makes the rest of the page inert; keep Tab cycling inside as well.
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')];
    if (focusable.length === 0) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  return {
    setMode(next) {
      mode = next;
      if (dialog.open) render();
    },
  };
}
