// Tests for the throttle and rate limiter helpers (web/src/ui/timing.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createThrottle, createRateLimiter } from '../../src/ui/timing.mjs';

// A controllable clock and timer queue.
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = nextId++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
    pending: () => timers.size,
  };
}

test('createThrottle runs the first call immediately', () => {
  const clock = fakeClock();
  const calls = [];
  const throttled = createThrottle((v) => calls.push(v), 500, clock);
  throttled('a');
  assert.deepEqual(calls, ['a']);
});

test('createThrottle coalesces calls and delivers the latest after the interval', () => {
  const clock = fakeClock();
  const calls = [];
  const throttled = createThrottle((v) => calls.push(v), 500, clock);
  throttled('a');
  clock.advance(100); throttled('b');
  clock.advance(100); throttled('c');
  assert.deepEqual(calls, ['a']);
  clock.advance(299);
  assert.deepEqual(calls, ['a']);
  clock.advance(1);
  assert.deepEqual(calls, ['a', 'c']);
  clock.advance(1000);
  assert.deepEqual(calls, ['a', 'c']);
  assert.equal(clock.pending(), 0);
});

test('createThrottle never exceeds one call per interval', () => {
  const clock = fakeClock();
  const times = [];
  const throttled = createThrottle(() => times.push(clock.now()), 500, clock);
  for (let i = 0; i < 100; i++) { throttled(i); clock.advance(37); }
  clock.advance(1000);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 500);
});

test('createThrottle.cancel drops a pending call', () => {
  const clock = fakeClock();
  const calls = [];
  const throttled = createThrottle((v) => calls.push(v), 500, clock);
  throttled('a'); throttled('b');
  throttled.cancel();
  clock.advance(1000);
  assert.deepEqual(calls, ['a']);
});

test('createThrottle.flush delivers a pending call now', () => {
  const clock = fakeClock();
  const calls = [];
  const throttled = createThrottle((v) => calls.push(v), 500, clock);
  throttled('a'); throttled('b');
  throttled.flush();
  assert.deepEqual(calls, ['a', 'b']);
  clock.advance(1000);
  assert.deepEqual(calls, ['a', 'b']);
});

test('createRateLimiter allows one event per interval', () => {
  const clock = fakeClock();
  const allow = createRateLimiter(3000, clock.now);
  assert.equal(allow(), true);
  assert.equal(allow(), false);
  clock.advance(2999);
  assert.equal(allow(), false);
  clock.advance(1);
  assert.equal(allow(), true);
});
