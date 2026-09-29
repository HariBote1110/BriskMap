// Tests for display formatting helpers (web/src/ui/format.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatCoord,
  dimensionKind,
  progressInfo,
  progressText,
  phaseAnnouncement,
} from '../../src/ui/format.mjs';

// A translator stub that makes the key and parameters visible.
const t = (key, params = {}) =>
  Object.keys(params).length ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})` : key;

const status = (over) => ({
  phase: 'loading', mode: '3d', textures: true,
  regionsLoaded: 0, regionsTotal: 0, chunksReady: 0, chunksTotal: 0, fps: 0,
  ...over,
});

test('formatCoord floors to the containing block like Minecraft', () => {
  assert.equal(formatCoord(12.7), '12');
  assert.equal(formatCoord(0.2), '0');
  assert.equal(formatCoord(-0.2), '−1');
  assert.equal(formatCoord(-12.7), '−13');
});

test('formatCoord never shows negative zero and handles non-numbers', () => {
  assert.equal(formatCoord(-0), '0');
  assert.equal(formatCoord(NaN), '–');
  assert.equal(formatCoord(undefined), '–');
});

test('dimensionKind recognises the vanilla dimensions', () => {
  assert.equal(dimensionKind('minecraft:overworld'), 'overworld');
  assert.equal(dimensionKind('overworld'), 'overworld');
  assert.equal(dimensionKind('NORMAL'), 'overworld');
  assert.equal(dimensionKind('minecraft:the_nether'), 'nether');
  assert.equal(dimensionKind('nether'), 'nether');
  assert.equal(dimensionKind('minecraft:the_end'), 'end');
  assert.equal(dimensionKind('THE_END'), 'end');
});

test('dimensionKind reports other for custom or missing dimensions', () => {
  assert.equal(dimensionKind('mymod:mining'), 'other');
  assert.equal(dimensionKind(''), 'other');
  assert.equal(dimensionKind(undefined), 'other');
});

test('progressInfo is null unless loading', () => {
  assert.equal(progressInfo(status({ phase: 'ready' })), null);
  assert.equal(progressInfo(status({ phase: 'error' })), null);
  assert.equal(progressInfo(null), null);
});

test('progressInfo is indeterminate while totals are unknown', () => {
  assert.deepEqual(progressInfo(status({})), { fraction: null });
});

test('progressInfo uses regions only in 2D', () => {
  const info = progressInfo(status({ mode: '2d', regionsLoaded: 1, regionsTotal: 4 }));
  assert.deepEqual(info, { fraction: 0.25 });
});

test('progressInfo averages regions and chunks in 3D', () => {
  const info = progressInfo(status({ regionsLoaded: 2, regionsTotal: 4, chunksReady: 0, chunksTotal: 100 }));
  assert.deepEqual(info, { fraction: 0.25 });
});

test('progressInfo clamps the fraction into [0, 1]', () => {
  const info = progressInfo(status({ mode: '2d', regionsLoaded: 9, regionsTotal: 4 }));
  assert.deepEqual(info, { fraction: 1 });
});

test('progressText describes regions and chunks', () => {
  assert.equal(
    progressText(status({ regionsLoaded: 2, regionsTotal: 4, chunksReady: 10, chunksTotal: 100 }), t),
    'progress.regions(done=2,total=4) · progress.chunks(done=10,total=100)',
  );
});

test('progressText omits chunks when there are none', () => {
  assert.equal(
    progressText(status({ mode: '2d', regionsLoaded: 1, regionsTotal: 3 }), t),
    'progress.regions(done=1,total=3)',
  );
});

test('progressText falls back to a generic message while totals are unknown', () => {
  assert.equal(progressText(status({}), t), 'progress.loading');
});

test('phaseAnnouncement speaks only when the phase changes', () => {
  assert.equal(phaseAnnouncement(undefined, status({}), t), 'announce.loading');
  assert.equal(phaseAnnouncement('loading', status({ regionsLoaded: 3 }), t), null);
  assert.equal(phaseAnnouncement('loading', status({ phase: 'ready' }), t), 'announce.ready');
  assert.equal(phaseAnnouncement('ready', status({ phase: 'ready' }), t), null);
});

test('phaseAnnouncement includes the engine message on error', () => {
  assert.equal(
    phaseAnnouncement('ready', status({ phase: 'error', message: 'boom' }), t),
    'announce.error(message=boom)',
  );
  assert.equal(phaseAnnouncement('ready', status({ phase: 'error' }), t), 'announce.error(message=)');
});
