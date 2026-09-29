import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parsePsTime, collectProcessCpu, parseProcStat, collectProcCpu, detectSettle, orbitStatistics, classifyUrl, argumentsFrom, invalidReasons } from '../run.mjs';

const procStat = (pid, name, ppid, utime, stime) => {
  const fields = Array(19).fill('0');
  fields[0] = String(ppid);
  fields[10] = String(utime);
  fields[11] = String(stime);
  return `${pid} (${name}) S ${fields.join(' ')}`;
};

test('Linux stat parsing handles process names with spaces and parentheses', () => {
  assert.deepEqual(parseProcStat(procStat(101, 'Chrome_ChildIOT hread (worker)', 100, 13, 7)),
    { pid: 101, ppid: 100, ticks: 20 });
});

test('Linux CPU collection follows descendants and converts ticks to milliseconds', () => {
  const entries = [
    { stat: procStat(100, 'chrome', 1, 10, 15), cmdline: 'chrome\0--headless\0' },
    { stat: procStat(101, 'Chrome_ChildIOT hread', 100, 3, 4), cmdline: 'chrome\0--type=renderer\0' },
    { stat: procStat(102, 'gpu)', 101, 5, 0), cmdline: 'chrome\0--type=gpu-process\0' },
    { stat: procStat(103, 'unrelated', 1, 100, 0), cmdline: 'chrome\0--type=renderer\0' },
  ];
  assert.deepEqual(collectProcCpu(entries, 100, 250), {
    total: 148, byType: { browser: 100, renderer: 28, 'gpu-process': 20 },
  });
});

test('phone options parse with defaults and reject invalid durations', () => {
  const defaults = argumentsFrom(['--chrome', 'chromium']);
  assert.deepEqual([defaults.chromeFlags, defaults.mobile, defaults.label, defaults.settleTimeoutMs, defaults.orbitMs], [[], false, null, 180000, 10000]);
  const options = argumentsFrom(['--chrome', 'chromium', '--chrome-flags', '  --use-gl=angle   --disable-gpu ', '--mobile', '--label', 'phone gpu', '--settle-timeout-ms', '45000', '--orbit-ms', '3000']);
  assert.deepEqual(options.chromeFlags, ['--use-gl=angle', '--disable-gpu']);
  assert.equal(options.mobile, true);
  assert.equal(options.label, 'phone gpu');
  assert.equal(options.settleTimeoutMs, 45000);
  assert.equal(options.orbitMs, 3000);
  assert.throws(() => argumentsFrom(['--chrome', 'chromium', '--orbit-ms', '0']));
  assert.throws(() => argumentsFrom(['--chrome', 'chromium', '--settle-timeout-ms', 'abc']));
});

test('every invalid-run reason is classified independently', () => {
  const brisk = { viewer: 'brisk', timed_out: false, orbit: { frames: 2 }, transfer_bytes: 10 };
  assert.deepEqual(invalidReasons(brisk, { screenshotFailed: false, briskReady: true, briskError: null }), []);
  assert.deepEqual(invalidReasons({ ...brisk, timed_out: true }, { briskReady: true }), ['timed_out']);
  assert.deepEqual(invalidReasons(brisk, { screenshotFailed: true, briskReady: true }), ['screenshot_failed']);
  assert.deepEqual(invalidReasons({ ...brisk, orbit: { frames: 0 } }, { briskReady: true }), ['orbit_no_frames']);
  assert.deepEqual(invalidReasons(brisk, { briskReady: false }), ['brisk_not_ready']);
  assert.deepEqual(invalidReasons(brisk, { briskReady: true, briskError: 'boom' }), ['brisk_error']);
  assert.deepEqual(invalidReasons({ ...brisk, transfer_bytes: 0 }, { briskReady: true }), ['zero_transfer_bytes']);
  const blue = { ...brisk, viewer: 'bluemap', bluemap_view_distances: { hires: 256, lowres: 0 } };
  assert.deepEqual(invalidReasons(blue, { setting: { hires: 256, lowres: 0 } }), []);
  assert.deepEqual(invalidReasons({ ...blue, bluemap_view_distances: { hires: 100, lowres: 0 } }, { setting: { hires: 256, lowres: 0 } }), ['bluemap_view_distances_mismatch']);
  assert.deepEqual(invalidReasons({ ...blue, bluemap_view_distances: { hires: 256, lowres: null } }, { setting: { hires: 256, lowres: 0 } }), ['bluemap_view_distances_mismatch']);
  assert.deepEqual(invalidReasons({ ...blue, bluemap_view_distances: null }, { setting: { hires: 256, lowres: 0 } }), ['bluemap_view_distances_mismatch']);
});

test('ps time formats and descendant process types', () => {
  assert.equal(parsePsTime('0:01.23'), 1230);
  assert.equal(parsePsTime('01:02:03.45'), 3723450);
  assert.equal(parsePsTime('1-02:03:04.00'), 93784000);
  const listing = `100 1 0:01.00 chrome\n101 100 0:02.00 chrome --type=renderer\n102 101 0:03.00 chrome --type=gpu-process\n103 1 0:09.00 unrelated`;
  assert.deepEqual(collectProcessCpu(listing, 100), { total: 6000, byType: { browser: 1000, renderer: 2000, 'gpu-process': 3000 } });
});

test('settle uses latest finished activity and times out', () => {
  const events = [
    { at: 100, kind: 'request' }, { at: 500, kind: 'finish' },
    { at: 600, kind: 'longtask', end: 750 },
  ];
  assert.deepEqual(detectSettle(events, { now: 2749, start: 0, ready: true, quietMs: 2000, timeoutMs: 5000 }), { settled: false, timedOut: false });
  assert.deepEqual(detectSettle(events, { now: 2750, start: 0, ready: true, quietMs: 2000, timeoutMs: 5000 }), { settled: true, timedOut: false, settleMs: 750 });
  assert.deepEqual(detectSettle(events, { now: 5000, start: 0, ready: false, quietMs: 2000, timeoutMs: 5000 }), { settled: false, timedOut: true });
});

test('a response without a finish expires after five seconds', () => {
  const events = [
    { at: 100, kind: 'request', key: 'worker', url: 'http://local/worker.mjs' },
    { at: 200, kind: 'response', key: 'worker' },
  ];
  assert.deepEqual(detectSettle(events, { now: 5199, start: 0 }), { settled: false, timedOut: false });
  assert.deepEqual(detectSettle(events, { now: 5200, start: 0 }), {
    settled: true, timedOut: false, settleMs: 5200, unfinishedCount: 1, unfinishedUrls: ['http://local/worker.mjs'],
  });
});

test('a request without a response or finish expires after ten seconds', () => {
  const events = [{ at: 100, kind: 'request', key: 'worker', url: 'http://local/worker.mjs' }];
  assert.deepEqual(detectSettle(events, { now: 10099, start: 0 }), { settled: false, timedOut: false });
  assert.deepEqual(detectSettle(events, { now: 10100, start: 0 }), {
    settled: true, timedOut: false, settleMs: 10100, unfinishedCount: 1, unfinishedUrls: ['http://local/worker.mjs'],
  });
});

test('orbit percentiles use nearest rank', () => {
  assert.deepEqual(orbitStatistics([0, 10, 30, 70, 130]), {
    frames: 4, fps_mean: 4 * 1000 / (130 - 0), frame_ms_p50: 20, frame_ms_p95: 60,
    frame_ms_p99: 60, frames_over_33ms: 2, frames_over_50ms: 1,
  });
});

test('URL classes', () => {
  assert.equal(classifyUrl('bluemap', 'http://x/maps/overworld/tiles/0/a.prbm'), 'hires');
  assert.equal(classifyUrl('bluemap', 'http://x/maps/overworld/tiles/2/a.prbm'), 'lowres');
  assert.equal(classifyUrl('bluemap', 'http://x/app.js'), 'other');
  assert.equal(classifyUrl('brisk', 'http://x/data/a.bin'), 'data');
  assert.equal(classifyUrl('brisk', 'http://x/viewer/index.html'), 'other');
});

test('instrument counts WebGL buffer and texture upload overloads', () => {
  class GL {
    bufferData() {} bufferSubData() {} texImage2D() {} texImage3D() {}
    texSubImage2D() {} texSubImage3D() {} compressedTexImage2D() {} compressedTexImage3D() {}
  }
  class GL2 extends GL {}
  const context = { window: {}, WebGLRenderingContext: GL, WebGL2RenderingContext: GL2,
    PerformanceObserver: class { observe() {} }, requestAnimationFrame() {} };
  runInNewContext(readFileSync(new URL('../instrument.js', import.meta.url), 'utf8'), context);
  const gl = new GL2();
  gl.bufferData(0, 100, 0);
  gl.bufferData(0, new Uint16Array(3), 0);
  gl.bufferSubData(0, 0, new Uint8Array(5));
  gl.bufferData(0, new Uint8Array(12), 0, 2, 4);
  gl.bufferSubData(0, 0, new Uint16Array(8), 1, 3);
  gl.texImage2D(0, 0, 0, 2, 3, 0, 0, 0, new Uint8Array(24));
  gl.texImage2D(0, 0, 0, 0, 0, { width: 3, height: 4 });
  gl.texImage3D(0, 0, 0, 2, 3, 4, 0, 0, 0, null);
  gl.texSubImage2D(0, 0, 0, 0, 2, 2, 0, 0, new Uint8Array(16));
  gl.texSubImage3D(0, 0, 0, 0, 0, 2, 2, 2, 0, 0, new Uint8Array(32));
  gl.compressedTexImage2D(0, 0, 0, 2, 2, 0, new Uint8Array(7));
  gl.compressedTexImage3D(0, 0, 0, 2, 2, 2, 0, new Uint8Array(9));
  gl.texSubImage2D(0, 0, 0, 0, 2, 2, 0, 0, new Uint8Array(11));
  assert.equal(context.window.__glStats.buffer_bytes, 111 + 4 + 6);
  assert.equal(context.window.__glStats.texture_bytes, 24 + 48 + 0 + 16 + 32 + 7 + 9 + 11);
  assert.equal(context.window.__glStats.calls, 13);
});
