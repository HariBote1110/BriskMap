// Small floating notes in the bottom corner: the textures hint, notices and error toasts.
import { el } from './dom.mjs';
import { ICONS } from './icons.mjs';

export function createNotes(container) {
  const timers = new Map();

  function remove(note) {
    clearTimeout(timers.get(note));
    timers.delete(note);
    note.remove();
  }

  // Adds a note; `key` replaces an earlier note with the same key.
  function add({ key, kind = 'info', content, dismissLabel, timeout = 0, onDismiss, role }) {
    const old = key && container.querySelector(`[data-key="${key}"]`);
    if (old) remove(old);
    const note = el('div', { class: 'panel note', 'data-kind': kind, 'data-key': key, role }, [
      el('span', { class: 'note-icon', 'aria-hidden': 'true', html: ICONS[kind === 'info' ? 'info' : kind === 'error' ? 'error' : 'warning'] }),
      el('span', { class: 'note-text' }, content),
    ]);
    if (dismissLabel) {
      note.append(el('button', {
        type: 'button', class: 'icon-button', 'aria-label': dismissLabel, title: dismissLabel,
        html: ICONS.close,
        onclick: () => { remove(note); onDismiss?.(); },
      }));
    }
    container.append(note);
    if (timeout > 0) timers.set(note, setTimeout(() => remove(note), timeout));
    return note;
  }

  return {
    add,
    has: (key) => Boolean(container.querySelector(`[data-key="${key}"]`)),
    removeKey(key) {
      const note = container.querySelector(`[data-key="${key}"]`);
      if (note) remove(note);
    },
    toast(message) {
      return add({ key: 'toast', kind: 'error', content: message, timeout: 5000, role: 'status' });
    },
  };
}
