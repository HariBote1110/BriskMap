// URL hash <-> view state.
// 3D: #map=<id>&mode=3d&x=..&z=..&y=..&yaw=..&pitch=..&d=..
// 2D: #map=<id>&mode=2d&x=..&z=..&zoom=..

export const LIMITS = Object.freeze({
  coordinate: Object.freeze({ min: -30_000_000, max: 30_000_000 }),
  height: Object.freeze({ min: -2048, max: 2048 }),
  pitch: Object.freeze({ min: 10, max: 89 }),
  distance: Object.freeze({ min: 8, max: 1024 }),
  zoom: Object.freeze({ min: 1 / 16, max: 16 }),
  mapIdLength: 128,
});

const clamp = (v, { min, max }) => Math.min(max, Math.max(min, v));
const normaliseYaw = (v) => ((v % 360) + 360) % 360;

// Hash key -> [view field, sanitiser].
const FIELDS = {
  x: ['x', (v) => clamp(v, LIMITS.coordinate)],
  z: ['z', (v) => clamp(v, LIMITS.coordinate)],
  y: ['y', (v) => clamp(v, LIMITS.height)],
  yaw: ['yaw', normaliseYaw],
  pitch: ['pitch', (v) => clamp(v, LIMITS.pitch)],
  d: ['distance', (v) => clamp(v, LIMITS.distance)],
  zoom: ['zoom', (v) => clamp(v, LIMITS.zoom)],
};

function parseNumber(text) {
  if (typeof text !== 'string' || text.trim() === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

export function parseHash(hash) {
  const text = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  const params = new URLSearchParams(text);
  const result = { mapId: undefined, mode: undefined, view: {} };

  const mapId = params.get('map');
  if (mapId && mapId.length <= LIMITS.mapIdLength) result.mapId = mapId;

  const mode = params.get('mode')?.toLowerCase();
  if (mode === '3d' || mode === '2d') result.mode = mode;

  for (const [key, [field, sanitise]] of Object.entries(FIELDS)) {
    const n = parseNumber(params.get(key) ?? undefined);
    if (n !== undefined) result.view[field] = sanitise(n);
  }
  return result;
}

// Rounding used in the URL; also used to decide whether a hash differs from the view.
const noNegativeZero = (v) => (Object.is(v, -0) ? 0 : v);
const roundTenth = (v) => noNegativeZero(Math.round(v * 10) / 10);
const roundInt = (v) => noNegativeZero(Math.round(v));
const ROUND = {
  x: roundTenth,
  z: roundTenth,
  y: roundTenth,
  yaw: (v) => normaliseYaw(roundInt(v)),
  pitch: (v) => clamp(roundInt(v), LIMITS.pitch),
  distance: (v) => clamp(roundInt(v), LIMITS.distance),
  zoom: (v) => clamp(Number(v.toPrecision(3)), LIMITS.zoom),
};

const KEYS_3D = [['x', 'x'], ['z', 'z'], ['y', 'y'], ['yaw', 'yaw'], ['pitch', 'pitch'], ['d', 'distance']];
const KEYS_2D = [['x', 'x'], ['z', 'z'], ['zoom', 'zoom']];

export function serialiseHash(view) {
  const parts = [`map=${encodeURIComponent(view.mapId)}`, `mode=${view.mode}`];
  for (const [key, field] of view.mode === '2d' ? KEYS_2D : KEYS_3D) {
    const v = view[field];
    if (Number.isFinite(v)) parts.push(`${key}=${ROUND[field](v)}`);
  }
  return `#${parts.join('&')}`;
}

export function resolveMapId(mapId, maps) {
  if (!maps || maps.length === 0) return { mapId: null, unknown: false };
  if (mapId !== undefined && maps.some((m) => m.id === mapId)) return { mapId, unknown: false };
  return { mapId: maps[0].id, unknown: mapId !== undefined };
}

// Works out what a hashchange asks for relative to the current view.
// Fields equal to the current view after URL rounding are left out.
export function planHashChange(current, parsed, maps) {
  const plan = { mapId: undefined, mode: undefined, view: undefined, unknownMap: false };
  if (parsed.mapId !== undefined && parsed.mapId !== current.mapId) {
    if (maps.some((m) => m.id === parsed.mapId)) plan.mapId = parsed.mapId;
    else plan.unknownMap = true;
  }
  if (parsed.mode !== undefined && parsed.mode !== current.mode) plan.mode = parsed.mode;
  for (const [field, value] of Object.entries(parsed.view)) {
    const now = current[field];
    if (Number.isFinite(now) && ROUND[field](now) === ROUND[field](value)) continue;
    (plan.view ??= {})[field] = value;
  }
  return plan;
}
