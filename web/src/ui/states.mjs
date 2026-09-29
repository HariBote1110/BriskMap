// Full-screen states shown instead of (or over) the map: loading, errors, empty index.
import { el } from './dom.mjs';
import { ICONS } from './icons.mjs';

export function createStateLayer(layer) {
  let actionButton = null;

  return {
    // { tone, icon, title, body, detail, action: { label, onClick }, status, scrim, compact }
    show({ tone = 'info', icon, title, body, detail, action, status, scrim = true, compact = false }) {
      layer.dataset.scrim = scrim ? 'true' : 'false';
      if (compact) {
        layer.replaceChildren(el('div', {
          class: 'panel state-card', 'data-compact': 'true', role: 'status',
        }, [el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('span', { text: title })]));
        layer.hidden = false;
        return;
      }
      actionButton = action
        ? el('button', { type: 'button', class: 'button', text: action.label, onclick: action.onClick })
        : null;
      const card = el('section', {
        class: 'panel state-card', 'data-tone': tone, role: tone === 'error' ? 'alert' : 'status',
        'aria-labelledby': 'state-title',
      }, [
        icon ? el('div', { class: 'state-icon', 'aria-hidden': 'true', html: ICONS[icon] }) : null,
        el('h1', { id: 'state-title', text: title }),
        body ? el('p', { text: body }) : null,
        detail ? el('p', { class: 'state-detail', text: detail }) : null,
        actionButton || status
          ? el('div', { class: 'state-actions' }, [
            actionButton,
            status ? el('span', { class: 'state-status', id: 'state-status', text: status }) : null,
          ])
          : null,
      ]);
      layer.replaceChildren(card);
      layer.hidden = false;
      actionButton?.focus({ preventScroll: true });
    },
    setStatus(text) {
      const node = layer.querySelector('#state-status');
      if (node) node.textContent = text;
    },
    hide() {
      layer.hidden = true;
      layer.replaceChildren();
      actionButton = null;
    },
    get visible() { return !layer.hidden; },
  };
}
