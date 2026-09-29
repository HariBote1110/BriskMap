// Tests for the URL hash <-> view state module (web/src/ui/url-state.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMITS,
  parseHash,
  serialiseHash,
  resolveMapId,
  planHashChange,
} from '../../src/ui/url-state.mjs';

const MAPS = [
  { id: 'world', name: 'world', dimension: 'minecraft:overworld' },
  { id: 'world_nether', name: 'world_nether', dimension: 'minecraft:the_nether' },
];

test('LIMITS follow the engine contract', () => {
  assert.equal(LIMITS.pitch.min, 10);
  assert.equal(LIMITS.pitch.max, 89);
  assert.equal(LIMITS.distance.min, 8);
  assert.equal(LIMITS.distance.max, 1024);
  assert.equal(LIMITS.zoom.min, 1 / 16);
  assert.equal(LIMITS.zoom.max, 16);
});

test('parseHash reads a full 3D hash', () => {
  const parsed = parseHash('#map=world&mode=3d&x=12.5&z=-40&y=70&yaw=45&pitch=60&d=128');
  assert.deepEqual(parsed, {
    mapId: 'world',
    mode: '3d',
    view: { x: 12.5, z: -40, y: 70, yaw: 45, pitch: 60, distance: 128 },
  });
});

test('parseHash reads a full 2D hash', () => {
  const parsed = parseHash('#map=world_nether&mode=2d&x=-3&z=7&zoom=0.5');
  assert.deepEqual(parsed, {
    mapId: 'world_nether',
    mode: '2d',
    view: { x: -3, z: 7, zoom: 0.5 },
  });
});

test('parseHash accepts a hash without the leading #', () => {
  assert.equal(parseHash('map=world').mapId, 'world');
});

test('parseHash of an empty or missing hash yields nothing', () => {
  for (const hash of ['', '#', undefined, null]) {
    assert.deepEqual(parseHash(hash), { mapId: undefined, mode: undefined, view: {} });
  }
});

test('parseHash drops invalid numbers so the engine defaults apply', () => {
  const parsed = parseHash('#x=abc&z=&y=NaN&yaw=Infinity&pitch=1e999&d=12px&zoom=-');
  assert.deepEqual(parsed.view, {});
});

test('parseHash drops an unknown mode and an empty map id', () => {
  const parsed = parseHash('#map=&mode=4d');
  assert.equal(parsed.mapId, undefined);
  assert.equal(parsed.mode, undefined);
});

test('parseHash accepts upper-case mode values', () => {
  assert.equal(parseHash('#mode=2D').mode, '2d');
});

test('parseHash clamps numbers into the contract ranges', () => {
  const parsed = parseHash('#pitch=0&d=100000&zoom=1000&x=1e12&z=-1e12&y=99999');
  assert.equal(parsed.view.pitch, 10);
  assert.equal(parsed.view.distance, 1024);
  assert.equal(parsed.view.zoom, 16);
  assert.equal(parsed.view.x, LIMITS.coordinate.max);
  assert.equal(parsed.view.z, LIMITS.coordinate.min);
  assert.equal(parsed.view.y, LIMITS.height.max);
  assert.equal(parseHash('#pitch=120&d=1&zoom=0.001').view.pitch, 89);
  assert.equal(parseHash('#d=1').view.distance, 8);
  assert.equal(parseHash('#zoom=0.001').view.zoom, 1 / 16);
  assert.equal(parseHash('#zoom=0').view.zoom, 1 / 16);
});

test('parseHash normalises yaw into [0, 360)', () => {
  assert.equal(parseHash('#yaw=-90').view.yaw, 270);
  assert.equal(parseHash('#yaw=360').view.yaw, 0);
  assert.equal(parseHash('#yaw=725').view.yaw, 5);
});

test('parseHash decodes percent-encoded map ids', () => {
  assert.equal(parseHash('#map=my%20world%2Bextra').mapId, 'my world+extra');
});

test('parseHash ignores a map id longer than the limit', () => {
  assert.equal(parseHash(`#map=${'a'.repeat(300)}`).mapId, undefined);
});

test('parseHash ignores unknown keys', () => {
  assert.deepEqual(parseHash('#foo=1&map=world').view, {});
});

test('serialiseHash writes the 3D form with sensible rounding', () => {
  const hash = serialiseHash({
    mode: '3d', mapId: 'world',
    x: 12.345, z: -40.04, y: 70.26, yaw: 45.6, pitch: 59.5, distance: 127.8, zoom: 2,
  });
  assert.equal(hash, '#map=world&mode=3d&x=12.3&z=-40&y=70.3&yaw=46&pitch=60&d=128');
});

test('serialiseHash writes the 2D form', () => {
  const hash = serialiseHash({
    mode: '2d', mapId: 'world_nether',
    x: -3.04, z: 7.96, y: 64, yaw: 10, pitch: 50, distance: 200, zoom: 0.0625,
  });
  assert.equal(hash, '#map=world_nether&mode=2d&x=-3&z=8&zoom=0.0625');
});

test('serialiseHash rounds zoom to three significant figures', () => {
  const hash = serialiseHash({ mode: '2d', mapId: 'w', x: 0, z: 0, zoom: 1.23456 });
  assert.equal(hash, '#map=w&mode=2d&x=0&z=0&zoom=1.23');
});

test('serialiseHash never writes negative zero and wraps yaw 359.6 to 0', () => {
  const hash = serialiseHash({
    mode: '3d', mapId: 'w', x: -0.01, z: -0.04, y: 0, yaw: 359.6, pitch: 45, distance: 64,
  });
  assert.equal(hash, '#map=w&mode=3d&x=0&z=0&y=0&yaw=0&pitch=45&d=64');
});

test('serialiseHash percent-encodes the map id', () => {
  const hash = serialiseHash({ mode: '2d', mapId: 'my world&x', x: 0, z: 0, zoom: 1 });
  assert.ok(hash.startsWith('#map=my%20world%26x&'));
  assert.equal(parseHash(hash).mapId, 'my world&x');
});

test('serialiseHash then parseHash round-trips a 3D view', () => {
  const view = { mode: '3d', mapId: 'world', x: 100, z: -200, y: 64, yaw: 90, pitch: 45, distance: 256 };
  const parsed = parseHash(serialiseHash(view));
  assert.deepEqual(parsed, {
    mapId: 'world', mode: '3d',
    view: { x: 100, z: -200, y: 64, yaw: 90, pitch: 45, distance: 256 },
  });
});

test('resolveMapId keeps a known id', () => {
  assert.deepEqual(resolveMapId('world_nether', MAPS), { mapId: 'world_nether', unknown: false });
});

test('resolveMapId falls back to the first map for a missing id without a notice', () => {
  assert.deepEqual(resolveMapId(undefined, MAPS), { mapId: 'world', unknown: false });
});

test('resolveMapId falls back to the first map for an unknown id and flags it', () => {
  assert.deepEqual(resolveMapId('nope', MAPS), { mapId: 'world', unknown: true });
});

test('resolveMapId returns null when there are no maps', () => {
  assert.deepEqual(resolveMapId('world', []), { mapId: null, unknown: false });
});

test('planHashChange returns nothing when the hash matches the current view', () => {
  const current = { mode: '3d', mapId: 'world', x: 1, z: 2, y: 64, yaw: 0, pitch: 45, distance: 64, zoom: 1 };
  const plan = planHashChange(current, parseHash(serialiseHash(current)), MAPS);
  assert.deepEqual(plan, { mapId: undefined, mode: undefined, view: undefined, unknownMap: false });
});

test('planHashChange ignores differences smaller than the URL rounding', () => {
  const current = { mode: '3d', mapId: 'world', x: 1.04, z: 2, y: 64, yaw: 0.3, pitch: 45, distance: 64.2, zoom: 1 };
  const plan = planHashChange(current, parseHash(serialiseHash(current)), MAPS);
  assert.equal(plan.view, undefined);
});

test('planHashChange reports map, mode and view changes', () => {
  const current = { mode: '3d', mapId: 'world', x: 1, z: 2, y: 64, yaw: 0, pitch: 45, distance: 64, zoom: 1 };
  const plan = planHashChange(current, parseHash('#map=world_nether&mode=2d&x=50&z=2&zoom=2'), MAPS);
  assert.deepEqual(plan, {
    mapId: 'world_nether', mode: '2d', view: { x: 50, zoom: 2 }, unknownMap: false,
  });
});

test('planHashChange flags an unknown map id and does not switch map', () => {
  const current = { mode: '2d', mapId: 'world_nether', x: 0, z: 0, zoom: 1 };
  const plan = planHashChange(current, parseHash('#map=missing'), MAPS);
  assert.equal(plan.mapId, undefined);
  assert.equal(plan.unknownMap, true);
});
