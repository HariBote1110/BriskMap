// BriskMap viewer UI entry point: the chrome around the engine's map canvas.
// Everything here is event-driven; the only timer loop is the empty-index retry.
import { loadIndex, createViewer } from '../engine/index.mjs';
import { pickLanguage, createTranslator } from './i18n.mjs';
import { parseHash, serialiseHash, resolveMapId, planHashChange } from './url-state.mjs';
import { formatCoord, dimensionKind, progressInfo, progressText, phaseAnnouncement } from './format.mjs';
import { createThrottle, createRateLimiter } from './timing.mjs';
import { byId, el, setText, templateNodes } from './dom.mjs';
import { ICONS } from './icons.mjs';
import { createPicker } from './picker.mjs';
import { createHelp } from './help.mjs';
import { createStateLayer } from './states.mjs';
import { createNotes } from './notices.mjs';

const EMPTY_RETRY_MS = 10_000;
const HASH_INTERVAL_MS = 500;
const TOAST_INTERVAL_MS = 6000;
const COPY_BUBBLE_MS = 1800;
const TEXTURES_HINT_KEY = 'briskmap.texturesHintDismissed';

// ?lang=ja|en overrides navigator.language (handy for checking both languages).
const langParam = new URLSearchParams(location.search).get('lang');
const lang = pickLanguage(langParam ?? navigator.language);
const t = createTranslator(lang);
document.documentElement.lang = lang;

const dom = {
  app: byId('app'),
  canvas: byId('map-canvas'),
  hud: byId('hud'),
  modeButtons: [...document.querySelectorAll('#mode-group .segment')],
  modeGroup: byId('mode-group'),
  copyLink: byId('copy-link'),
  copyBubble: byId('copy-bubble'),
  manualCopy: byId('manual-copy'),
  manualCopyInput: byId('manual-copy-input'),
  manualCopyLabel: byId('manual-copy-label'),
  manualCopyClose: byId('manual-copy-close'),
  progress: byId('progress'),
  progressText: byId('progress-text'),
  progressBar: byId('progress-bar'),
  coords: byId('coords'),
  coordX: byId('coord-x'),
  coordY: byId('coord-y'),
  coordZ: byId('coord-z'),
  coordYWrap: byId('coord-y-wrap'),
  announcer: byId('announcer'),
};

const states = createStateLayer(byId('state-layer'));
const notes = createNotes(byId('notes'));
const allowToast = createRateLimiter(TOAST_INTERVAL_MS);

let index = null;
let viewer = null;
let lastPhase;
let fatal = false;
let texturesHintShown = false;
let emptyRetryTimer = null;
let switching = Promise.resolve();

// ---- small helpers ------------------------------------------------------------

let announceTimer = null;
function announce(text) {
  // Clear first so that repeating the same text is announced again.
  dom.announcer.textContent = '';
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { dom.announcer.textContent = text; }, 60);
}

function readFlag(key) {
  try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
}
function writeFlag(key) {
  try { sessionStorage.setItem(key, '1'); } catch { /* storage unavailable: forget on reload */ }
}

const findMap = (id) => index?.maps.find((m) => m.id === id);

function focusCanvas() {
  dom.canvas.focus({ preventScroll: true });
}

// ---- static chrome text --------------------------------------------------------

function initChrome() {
  dom.modeGroup.setAttribute('aria-label', t('mode.label'));
  for (const button of dom.modeButtons) {
    const mode = button.dataset.mode;
    button.textContent = t(`mode.${mode}`);
    button.setAttribute('aria-label', `${t(`mode.${mode}`)}, ${t(`mode.${mode}.long`)}`);
    button.title = t(`mode.${mode}.long`);
    button.addEventListener('click', () => switchMode(mode));
  }
  dom.copyLink.innerHTML = ICONS.link;
  dom.copyLink.setAttribute('aria-label', t('link.copy'));
  dom.copyLink.title = t('link.copy');
  dom.copyLink.addEventListener('click', copyLink);
  dom.copyBubble.replaceChildren(el('span', { html: ICONS.check, 'aria-hidden': 'true' }), t('link.copied'));
  dom.manualCopyLabel.textContent = t('link.manual');
  dom.manualCopyClose.innerHTML = ICONS.close;
  dom.manualCopyClose.setAttribute('aria-label', t('help.close'));
  dom.manualCopyClose.addEventListener('click', () => {
    dom.manualCopy.hidden = true;
    dom.copyLink.focus();
  });
  dom.manualCopy.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { dom.manualCopy.hidden = true; dom.copyLink.focus(); }
  });
  dom.progress.setAttribute('aria-label', t('progress.label'));
  dom.coords.setAttribute('aria-label', t('coords.label'));
}

const picker = createPicker({
  button: byId('picker-button'),
  list: byId('picker-list'),
  icon: byId('picker-icon'),
  name: byId('picker-name'),
  chevron: byId('picker-chevron'),
  t,
  onSelect: (id) => switchMap(id),
});

const help = createHelp({
  dialog: byId('help-dialog'),
  openButton: byId('help-button'),
  closeButton: byId('help-close'),
  title: byId('help-title'),
  current: byId('help-current'),
  body: byId('help-body'),
  note: byId('help-note'),
  t,
});

// ---- view-dependent chrome --------------------------------------------------------

function renderMapAndMode(view) {
  const map = findMap(view.mapId);
  if (!map) return;
  picker.setCurrent(map.id);
  for (const button of dom.modeButtons) {
    button.setAttribute('aria-pressed', button.dataset.mode === view.mode ? 'true' : 'false');
  }
  help.setMode(view.mode);
  dom.coordYWrap.hidden = view.mode !== '3d';
  dom.canvas.setAttribute('aria-label', t('canvas.label', {
    name: map.name,
    dimension: t(`dimension.${dimensionKind(map.dimension)}`),
    mode: t(`mode.${view.mode}.long`),
  }));
  document.title = `${map.name} · ${t('app.name')}`;
}

function renderCoords(view) {
  setText(dom.coordX, formatCoord(view.x));
  setText(dom.coordZ, formatCoord(view.z));
  if (view.mode === '3d') setText(dom.coordY, formatCoord(view.y));
}

// ---- URL hash --------------------------------------------------------------------

function writeHash(view) {
  const hash = serialiseHash(view);
  if (location.hash !== hash) history.replaceState(history.state, '', hash);
}
const writeHashThrottled = createThrottle(writeHash, HASH_INTERVAL_MS);

// Runs engine calls one after another, then brings the chrome and the URL up to date.
function enqueueSwitch(work, { focus = false } = {}) {
  if (!viewer) return;
  switching = switching.then(async () => {
    try { await work(viewer.getView()); } catch (error) { onError(error); }
    const view = viewer.getView();
    renderMapAndMode(view);
    renderCoords(view);
    writeHashThrottled.cancel();
    writeHash(view);
    if (focus) focusCanvas();
  });
}

function onHashChange() {
  const parsed = parseHash(location.hash);
  enqueueSwitch(async (current) => {
    const plan = planHashChange(current, parsed, index.maps);
    if (plan.unknownMap) showUnknownMapNotice(parsed.mapId, findMap(current.mapId));
    if (plan.mapId) await viewer.setMap(plan.mapId);
    if (plan.mode) await viewer.setMode(plan.mode);
    // After a map switch the engine starts from that map's defaults, so apply every field.
    const view = plan.mapId ? parsed.view : plan.view;
    if (view && Object.keys(view).length) viewer.setView(view);
  });
}

function showUnknownMapNotice(id, fallback) {
  if (!fallback) return;
  notes.add({
    key: 'unknown-map', kind: 'warning', timeout: 8000, role: 'status',
    content: t('notice.unknownMap', { id, name: fallback.name }),
    dismissLabel: t('notice.dismiss'),
  });
}

// ---- actions ---------------------------------------------------------------------

function switchMode(mode) {
  enqueueSwitch(async (current) => {
    if (current.mode !== mode) await viewer.setMode(mode);
  }, { focus: true });
}

function switchMap(id) {
  enqueueSwitch(async (current) => {
    if (current.mapId !== id) await viewer.setMap(id);
  }, { focus: true });
}

let bubbleTimer = null;
async function copyLink() {
  writeHashThrottled.flush();
  if (viewer) writeHash(viewer.getView());
  const url = location.href;
  let copied = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      copied = true;
    }
  } catch { /* fall through to the legacy path */ }
  if (!copied) copied = legacyCopy(url);

  if (copied) {
    dom.manualCopy.hidden = true;
    dom.copyBubble.hidden = false;
    announce(t('link.copied'));
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => { dom.copyBubble.hidden = true; }, COPY_BUBBLE_MS);
  } else {
    // No clipboard access at all: show the link selected for manual copying.
    dom.copyBubble.hidden = true;
    dom.manualCopyInput.value = url;
    dom.manualCopy.hidden = false;
    dom.manualCopyInput.focus();
    dom.manualCopyInput.select();
  }
}

function legacyCopy(text) {
  const area = el('textarea', { readonly: true, 'aria-hidden': 'true', style: 'position:fixed;top:0;left:0;opacity:0;' });
  area.value = text;
  document.body.append(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  dom.copyLink.focus({ preventScroll: true });
  return ok;
}

// ---- engine callbacks ---------------------------------------------------------------

function onViewChange(view) {
  renderCoords(view);
  writeHashThrottled(view);
}

let progressShown = null;
function onStatus(status) {
  const spoken = phaseAnnouncement(lastPhase, status, t);
  if (spoken) announce(spoken);
  lastPhase = status.phase;

  const info = progressInfo(status);
  dom.progress.hidden = !info;
  if (info) {
    const text = progressText(status, t);
    setText(dom.progressText, text);
    dom.progress.setAttribute('aria-valuetext', text);
    const indeterminate = info.fraction === null;
    if (dom.progress.dataset.indeterminate !== String(indeterminate)) {
      dom.progress.dataset.indeterminate = String(indeterminate);
    }
    if (indeterminate) {
      dom.progress.removeAttribute('aria-valuenow');
    } else {
      const percent = Math.round(info.fraction * 100);
      if (progressShown !== percent) {
        progressShown = percent;
        dom.progressBar.style.width = `${percent}%`;
        dom.progress.setAttribute('aria-valuenow', String(percent));
      }
    }
  } else {
    progressShown = null;
  }

  if (status.textures === false && !texturesHintShown && !readFlag(TEXTURES_HINT_KEY)) showTexturesHint();
  if (status.textures === true && texturesHintShown) notes.removeKey('textures');

  if (status.phase === 'error' && !fatal) showFatal(status.message);
}

function onError(error) {
  console.warn('[BriskMap]', error);
  // Fatal errors also set status.phase = 'error'; let that status arrive before deciding.
  setTimeout(() => {
    if (fatal || lastPhase === 'error') return;
    if (allowToast()) notes.toast(t('toast.error', { message: error?.message ?? String(error) }));
  }, 0);
}

function showTexturesHint() {
  texturesHintShown = true;
  const code = (text) => el('code', { text });
  notes.add({
    key: 'textures', kind: 'info',
    content: el('details', { class: 'note-details' }, [
      el('summary', { text: t('hint.textures') }),
      el('p', {}, templateNodes(t('hint.texturesHow'), {
        setting: code('textures.accept-mojang-download'),
        file: code('plugins/BriskMap/config.yml'),
      })),
    ]),
    dismissLabel: t('hint.dismiss'),
    onDismiss: () => writeFlag(TEXTURES_HINT_KEY),
  });
}

function showFatal(message) {
  fatal = true;
  dom.hud.inert = true;
  states.show({
    tone: 'error', icon: 'error',
    title: t('state.fatal.title'),
    body: t('state.fatal.body'),
    detail: message || null,
    action: { label: t('state.reload'), onClick: () => location.reload() },
  });
}

// ---- start-up -----------------------------------------------------------------------

// `quiet` keeps the current card (the empty-index retry shows its own "Checking…").
async function boot({ quiet = false } = {}) {
  clearTimeout(emptyRetryTimer);
  if (!quiet) states.show({ compact: true, scrim: false, title: t('state.loadingIndex') });
  let loaded;
  try {
    loaded = await loadIndex('./');
  } catch (error) {
    showIndexError(error);
    return;
  }
  if (!loaded.maps || loaded.maps.length === 0) {
    showEmpty();
    return;
  }
  index = loaded;
  await startViewer();
}

function showIndexError(error) {
  console.warn('[BriskMap] index', error);
  const body = error?.code === 'http'
    ? t('state.indexFailed.http', { status: error.status ?? '?' })
    : error?.code === 'format' ? t('state.indexFailed.format') : t('state.indexFailed.network');
  const reload = error?.code === 'format';
  states.show({
    tone: 'error', icon: error?.code === 'network' ? 'offline' : 'error', scrim: false,
    title: t('state.indexFailed.title'),
    body,
    action: reload
      ? { label: t('state.reload'), onClick: () => location.reload() }
      : { label: t('state.retry'), onClick: () => boot() },
  });
}

function showEmpty() {
  states.show({
    tone: 'info', icon: 'clock', scrim: false,
    title: t('state.empty.title'),
    body: t('state.empty.body'),
    action: { label: t('state.retry'), onClick: retryEmpty },
    status: '',
  });
  emptyRetryTimer = setTimeout(retryEmpty, EMPTY_RETRY_MS);
}

function retryEmpty() {
  clearTimeout(emptyRetryTimer);
  states.setStatus(t('state.empty.checking'));
  boot({ quiet: true });
}

async function startViewer() {
  const parsed = parseHash(location.hash);
  const { mapId, unknown } = resolveMapId(parsed.mapId, index.maps);
  try {
    viewer = await createViewer(dom.canvas, {
      baseUrl: './',
      index,
      mapId,
      mode: parsed.mode ?? '3d',
      view: parsed.view,
      onViewChange,
      onStatus,
      onError,
    });
  } catch (error) {
    console.warn('[BriskMap] viewer', error);
    if (error?.code === 'webgl2') {
      states.show({
        tone: 'warning', icon: 'display', scrim: false,
        title: t('state.webgl.title'),
        body: t('state.webgl.body'),
      });
    } else {
      showFatal(error?.message);
    }
    return;
  }

  picker.setMaps(index.maps);
  const view = viewer.getView();
  renderMapAndMode(view);
  renderCoords(view);
  writeHash(view);
  if (!fatal) {
    states.hide();
    dom.hud.hidden = false;
  }
  if (unknown) showUnknownMapNotice(parsed.mapId, findMap(mapId));

  new ResizeObserver(() => viewer.resize()).observe(dom.app);
  addEventListener('hashchange', onHashChange);
}

initChrome();
boot();
