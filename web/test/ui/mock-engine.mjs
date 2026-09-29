// Mock of the BriskMap browser engine (web/src/engine/index.mjs) for UI development.
// Implements the same contract with a 2D-context placeholder drawing.
//
// Query parameters on the page URL:
//   mock-error=http|network|format|zero-maps|webgl2|fatal|nonfatal
//   mock-zero-count=N     with zero-maps: the index is empty for the first N loads, then real
//   mock-index-delay=MS   delay before loadIndex settles (default 250)
//   mock-textures=0       status.textures === false
//   mock-tick=MS          loading progress tick (default 120)
//   mock-hold=1           stop loading progress at about 60 % (for screenshots)

const params = new URLSearchParams(globalThis.location?.search ?? '');
const MOCK = {
  error: params.get('mock-error'),
  zeroCount: params.has('mock-zero-count') ? Number(params.get('mock-zero-count')) : Infinity,
  indexDelay: Number(params.get('mock-index-delay') ?? 250),
  textures: params.get('mock-textures') !== '0',
  tick: Number(params.get('mock-tick') ?? 120),
  hold: params.get('mock-hold') === '1',
};

const LIMITS = { pitch: [10, 89], distance: [8, 1024], zoom: [1 / 16, 16] };
const clamp = (v, [min, max]) => Math.min(max, Math.max(min, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const codedError = (message, props) => Object.assign(new Error(message), props);

let indexLoads = 0;

export async function loadIndex(baseUrl = './') {
  await sleep(MOCK.indexDelay);
  indexLoads++;
  if (MOCK.error === 'http') throw codedError('HTTP 503 for maps/index.json', { code: 'http', status: 503 });
  if (MOCK.error === 'network') throw codedError('Failed to fetch', { code: 'network' });
  if (MOCK.error === 'format') throw codedError('Unknown index format 7', { code: 'format' });
  let response;
  try {
    response = await fetch(`${baseUrl}maps/index.json`, { cache: 'no-store' });
  } catch (cause) {
    throw codedError('Failed to fetch', { code: 'network', cause });
  }
  if (!response.ok) throw codedError(`HTTP ${response.status}`, { code: 'http', status: response.status });
  const index = await response.json();
  if (index.format !== 1) throw codedError(`Unknown index format ${index.format}`, { code: 'format' });
  if (MOCK.error === 'zero-maps' && indexLoads <= MOCK.zeroCount) index.maps = [];
  if (!MOCK.textures) index.textures = null;
  return index;
}

// ---- placeholder terrain ---------------------------------------------------

function hash(x, z) {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x, z, cell) {
  const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
  const fx = x / cell - gx, fz = z / cell - gz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(gx, gz), b = hash(gx + 1, gz), c = hash(gx, gz + 1), d = hash(gx + 1, gz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

const PALETTES = {
  overworld: (n) => (n < 0.38 ? '#2c5aa0' : n < 0.43 ? '#d8c98f' : n < 0.7 ? '#5f9a3c' : n < 0.85 ? '#3d6b2a' : '#8a8a86'),
  nether: (n) => (n < 0.3 ? '#d85a1a' : n < 0.7 ? '#6e2424' : '#4a1818'),
  end: (n) => (n < 0.45 ? '#0b0b14' : '#dcd9a0'),
  other: (n) => (n < 0.5 ? '#3b4c5e' : '#8fa6b3'),
};

function dimensionKind(dimension) {
  const d = String(dimension ?? '').replace(/^minecraft:/, '');
  if (d === 'overworld') return 'overworld';
  if (d === 'the_nether') return 'nether';
  if (d === 'the_end') return 'end';
  return 'other';
}

// ---- viewer ---------------------------------------------------------------

export async function createViewer(canvas, options) {
  if (MOCK.error === 'webgl2') {
    await sleep(100);
    throw codedError('WebGL2 is not available', { code: 'webgl2' });
  }
  const { index } = options;
  const ctx = canvas.getContext('2d');
  if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex', '0');

  let map = index.maps.find((m) => m.id === options.mapId);
  if (!map) throw new Error(`Unknown map ${options.mapId}`);
  let view = defaults(map, options.mode ?? '3d');
  Object.assign(view, sanitise(options.view ?? {}));

  const status = {
    phase: 'loading', mode: view.mode, textures: index.textures !== null,
    regionsLoaded: 0, regionsTotal: 0, chunksReady: 0, chunksTotal: 0, fps: 0,
  };
  let progressTimer = null;
  let lastViewEmit = 0;
  let viewTimer = null;
  let settleTimer = null;
  let drawQueued = false;
  let disposed = false;

  function defaults(m, mode) {
    return { mode, mapId: m.id, x: m.spawn[0], z: m.spawn[2], y: m.spawn[1], yaw: 0, pitch: 45, distance: 128, zoom: 1 };
  }

  function sanitise(partial) {
    const out = {};
    for (const key of ['x', 'z', 'y']) if (Number.isFinite(partial[key])) out[key] = partial[key];
    if (Number.isFinite(partial.yaw)) out.yaw = ((partial.yaw % 360) + 360) % 360;
    if (Number.isFinite(partial.pitch)) out.pitch = clamp(partial.pitch, LIMITS.pitch);
    if (Number.isFinite(partial.distance)) out.distance = clamp(partial.distance, LIMITS.distance);
    if (Number.isFinite(partial.zoom)) out.zoom = clamp(partial.zoom, LIMITS.zoom);
    return out;
  }

  function emitStatus() {
    options.onStatus?.({ ...status });
  }

  function emitView() {
    const now = performance.now();
    const fire = () => { lastViewEmit = performance.now(); viewTimer = null; options.onViewChange?.({ ...view }); };
    if (now - lastViewEmit >= 100 && !viewTimer) fire();
    else if (!viewTimer) viewTimer = setTimeout(fire, 100 - (now - lastViewEmit));
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { status.fps = 0; options.onViewChange?.({ ...view }); }, 250);
    status.fps = 60;
  }

  function startLoading() {
    clearInterval(progressTimer);
    Object.assign(status, {
      phase: 'loading', mode: view.mode,
      regionsLoaded: 0, regionsTotal: map.regions.length,
      chunksReady: 0, chunksTotal: view.mode === '3d' ? map.regions.length * 64 : 0,
    });
    emitStatus();
    progressTimer = setInterval(() => {
      if (status.regionsLoaded < status.regionsTotal) status.regionsLoaded++;
      else if (status.chunksReady < status.chunksTotal) {
        status.chunksReady = Math.min(status.chunksTotal, status.chunksReady + Math.ceil(status.chunksTotal / 8));
      }
      const done = status.regionsLoaded === status.regionsTotal && status.chunksReady === status.chunksTotal;
      const held = MOCK.hold && status.regionsLoaded >= Math.ceil(status.regionsTotal * 0.6);
      if (held) { clearInterval(progressTimer); emitStatus(); return; }
      if (done) {
        clearInterval(progressTimer);
        status.phase = 'ready';
      }
      emitStatus();
    }, MOCK.tick);
  }

  function requestDraw() {
    if (drawQueued || disposed) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; draw(); });
  }

  function draw() {
    const w = canvas.width, h = canvas.height;
    const dpr = globalThis.devicePixelRatio || 1;
    const palette = PALETTES[dimensionKind(map.dimension)];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    let scale; // device px per block
    let horizon = 0;
    if (view.mode === '2d') {
      scale = view.zoom * dpr;
    } else {
      scale = (700 / view.distance) * dpr;
      horizon = h * clamp((45 - view.pitch) / 80 + 0.3, [-0.2, 0.9]);
      if (horizon > 0) {
        const sky = ctx.createLinearGradient(0, 0, 0, horizon);
        sky.addColorStop(0, '#7dabff');
        sky.addColorStop(1, '#b9d2ff');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, horizon);
      }
    }

    ctx.save();
    if (view.mode === '3d') {
      ctx.beginPath();
      ctx.rect(0, Math.max(0, horizon), w, h);
      ctx.clip();
      ctx.translate(w / 2, h / 2 + Math.max(0, horizon) / 2);
      ctx.scale(1, Math.sin((view.pitch * Math.PI) / 180));
      ctx.rotate((-view.yaw * Math.PI) / 180);
    } else {
      ctx.translate(w / 2, h / 2);
    }
    // Cell size in blocks: a power of two times 16 that is at least 6 device px.
    let cell = 16;
    while (cell * scale < 6) cell *= 2;
    const reach = (Math.hypot(w, h) / scale) * (view.mode === '3d' ? 1.6 : 0.6) + cell;
    const x0 = Math.floor((view.x - reach) / cell) * cell, x1 = view.x + reach;
    const z0 = Math.floor((view.z - reach) / cell) * cell, z1 = view.z + reach;
    for (let x = x0; x < x1; x += cell) {
      for (let z = z0; z < z1; z += cell) {
        ctx.fillStyle = palette(noise(x + cell / 2, z + cell / 2, 384));
        ctx.fillRect((x - view.x) * scale, (z - view.z) * scale, cell * scale + 0.6, cell * scale + 0.6);
      }
    }
    // Region grid.
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    for (let x = Math.floor(x0 / 512) * 512; x < x1; x += 512) {
      ctx.moveTo((x - view.x) * scale, (z0 - view.z) * scale);
      ctx.lineTo((x - view.x) * scale, (z1 - view.z) * scale);
    }
    for (let z = Math.floor(z0 / 512) * 512; z < z1; z += 512) {
      ctx.moveTo((x0 - view.x) * scale, (z - view.z) * scale);
      ctx.lineTo((x1 - view.x) * scale, (z - view.z) * scale);
    }
    ctx.stroke();
    ctx.restore();

    // Centre marker and label.
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 8 * dpr, h / 2); ctx.lineTo(w / 2 + 8 * dpr, h / 2);
    ctx.moveTo(w / 2, h / 2 - 8 * dpr); ctx.lineTo(w / 2, h / 2 + 8 * dpr);
    ctx.stroke();
    ctx.font = `${11 * dpr}px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'center';
    ctx.fillText(`mock engine · ${view.mode} · ${map.id}`, w / 2, h / 2 + 24 * dpr);
  }

  // ---- input (the engine owns all canvas input) ----------------------------

  const pointers = new Map();
  let pinchDistance = 0;

  function panByScreen(dxCss, dyCss) {
    const perBlock = view.mode === '2d' ? view.zoom : 700 / view.distance;
    let dx = -dxCss / perBlock, dz = -dyCss / perBlock;
    if (view.mode === '3d') {
      dz /= Math.sin((view.pitch * Math.PI) / 180);
      const yaw = (view.yaw * Math.PI) / 180;
      const rx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const rz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      dx = rx; dz = rz;
    }
    change({ x: view.x + dx, z: view.z + dz });
  }

  function zoomBy(factor) {
    if (view.mode === '2d') change({ zoom: view.zoom * factor });
    else change({ distance: view.distance / factor });
  }

  function change(partial) {
    Object.assign(view, sanitise(partial));
    requestDraw();
    emitView();
  }

  const onPointerDown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onPointerMove = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance > 0) zoomBy(d / pinchDistance);
      pinchDistance = d;
      panByScreen(dx / 2, dy / 2);
    } else if (view.mode === '3d' && p.button === 0) {
      change({ yaw: view.yaw + dx * 0.3, pitch: view.pitch + dy * 0.2 });
    } else {
      panByScreen(dx, dy);
    }
  };
  const onPointerUp = (e) => { pointers.delete(e.pointerId); pinchDistance = 0; };
  const onWheel = (e) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015)); };
  const onContextMenu = (e) => e.preventDefault();
  const onKeyDown = (e) => {
    const step = 60;
    const keys = {
      ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step],
    };
    if (view.mode === '3d') Object.assign(keys, { a: keys.ArrowLeft, d: keys.ArrowRight, w: keys.ArrowUp, s: keys.ArrowDown });
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (keys[k]) { e.preventDefault(); panByScreen(...keys[k]); }
    else if (view.mode === '3d' && (k === 'q' || k === 'e')) { e.preventDefault(); change({ yaw: view.yaw + (k === 'q' ? -15 : 15) }); }
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('keydown', onKeyDown);

  function resize() {
    const dpr = globalThis.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    draw();
  }

  // Simulated errors after start-up.
  if (MOCK.error === 'fatal') {
    setTimeout(() => {
      clearInterval(progressTimer);
      Object.assign(status, { phase: 'error', message: 'WebGL context lost (mock).' });
      options.onError?.(codedError('WebGL context lost (mock).', { code: 'context-lost', fatal: true }));
      emitStatus();
    }, 1500);
  }
  if (MOCK.error === 'nonfatal') {
    let n = 0;
    const timer = setInterval(() => {
      options.onError?.(codedError(`r.${n}.0.b3d: HTTP 404`, { code: 'http', status: 404 }));
      if (++n >= 8) clearInterval(timer);
    }, 700);
  }

  resize();
  startLoading();
  queueMicrotask(() => options.onViewChange?.({ ...view }));

  return {
    getView: () => ({ ...view }),
    setView(partial) { change(partial); },
    async setMode(mode) {
      if (mode !== '2d' && mode !== '3d') throw new Error(`Unknown mode ${mode}`);
      if (mode === view.mode) return;
      await sleep(30);
      view.mode = mode;
      requestDraw();
      startLoading();
      options.onViewChange?.({ ...view });
    },
    async setMap(mapId) {
      const next = index.maps.find((m) => m.id === mapId);
      if (!next) throw new Error(`Unknown map ${mapId}`);
      if (next === map) return;
      await sleep(30);
      map = next;
      view = { ...defaults(map, view.mode) };
      requestDraw();
      startLoading();
      options.onViewChange?.({ ...view });
    },
    resize,
    dispose() {
      disposed = true;
      clearInterval(progressTimer);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('keydown', onKeyDown);
    },
    get status() { return { ...status }; },
  };
}
