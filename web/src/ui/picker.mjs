// Map picker: a button that opens a single-select listbox (aria-activedescendant pattern).
import { el, setText } from './dom.mjs';
import { ICONS } from './icons.mjs';
import { dimensionKind } from './format.mjs';

export function createPicker({ button, list, icon, name, chevron, t, onSelect }) {
  let maps = [];
  let currentId = null;
  let activeIndex = 0;

  chevron.innerHTML = ICONS.chevronDown;

  const optionId = (i) => `picker-option-${i}`;
  const isOpen = () => !list.hidden;

  function setIcon(node, dimension) {
    const kind = dimensionKind(dimension);
    if (node.dataset.kind !== kind) {
      node.dataset.kind = kind;
      node.innerHTML = ICONS[kind];
    }
  }

  function render() {
    list.replaceChildren(...maps.map((map, i) => {
      const iconNode = el('span', { class: 'dim-icon', 'aria-hidden': 'true' });
      setIcon(iconNode, map.dimension);
      return el('li', {
        id: optionId(i),
        class: 'picker-option',
        role: 'option',
        'aria-selected': map.id === currentId ? 'true' : 'false',
        onclick: () => choose(i),
      }, [
        iconNode,
        el('span', { class: 'picker-option-text' }, [
          el('span', { class: 'picker-option-name', text: map.name }),
          el('span', { class: 'picker-option-dim', text: t(`dimension.${dimensionKind(map.dimension)}`) }),
        ]),
        el('span', { class: 'picker-option-check', html: ICONS.check }),
      ]);
    }));
  }

  function setActive(i) {
    if (maps.length === 0) return;
    activeIndex = (i + maps.length) % maps.length;
    for (const [n, option] of [...list.children].entries()) {
      option.dataset.active = n === activeIndex ? 'true' : 'false';
    }
    list.setAttribute('aria-activedescendant', optionId(activeIndex));
    list.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (maps.length === 0) return;
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    setActive(Math.max(0, maps.findIndex((m) => m.id === currentId)));
    list.focus({ preventScroll: true });
    document.addEventListener('pointerdown', onOutside, true);
  }

  function close({ focusButton = false } = {}) {
    if (!isOpen()) return;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    if (focusButton) button.focus();
  }

  function choose(i) {
    const map = maps[i];
    close();
    if (map) onSelect(map.id);
  }

  function onOutside(event) {
    if (!list.contains(event.target) && !button.contains(event.target)) close();
  }

  button.addEventListener('click', () => (isOpen() ? close() : open()));
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open();
    }
  });
  list.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'ArrowDown': setActive(activeIndex + 1); break;
      case 'ArrowUp': setActive(activeIndex - 1); break;
      case 'Home': setActive(0); break;
      case 'End': setActive(maps.length - 1); break;
      case 'Enter':
      case ' ': choose(activeIndex); break;
      case 'Escape': close({ focusButton: true }); break;
      case 'Tab': close(); return;
      default: return;
    }
    event.preventDefault();
  });
  list.addEventListener('focusout', (event) => {
    if (!list.contains(event.relatedTarget) && event.relatedTarget !== button) close();
  });

  return {
    setMaps(next) {
      maps = next;
      render();
    },
    setCurrent(id) {
      currentId = id;
      const map = maps.find((m) => m.id === id);
      if (!map) return;
      setIcon(icon, map.dimension);
      setText(name, map.name);
      button.setAttribute('aria-label', t('picker.choose', { name: map.name }));
      button.title = map.name;
      for (const [i, option] of [...list.children].entries()) {
        option.setAttribute('aria-selected', maps[i].id === id ? 'true' : 'false');
      }
    },
    close,
  };
}
