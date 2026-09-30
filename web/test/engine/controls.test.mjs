// Camera control maths (web/src/engine/view.mjs). Expected values come from project / unproject
// round trips through viewProjection, never from hand-computed numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseView, viewProjection, projectPoint,
  groundOffset, hitsGround, panView, orbitView, zoomView, rotateView,
  wheelFactor, keyAction, keyMotion, twoFingerGesture, twoFingerStep,
} from '../../src/engine/view.mjs';

// Deterministic pseudo-random numbers (mulberry32) so failures reproduce.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (next, low, high) => low + next() * (high - low);

function randomView3d(next, overrides = {}) {
  return normaliseView([between(next, -500, 500), between(next, 40, 120), between(next, -500, 500)], 'world', '3d', {
    yaw: between(next, -360, 720), pitch: between(next, 10, 89), distance: between(next, 8, 1024), ...overrides,
  });
}
function randomSize(next) { return [Math.round(between(next, 320, 1920)), Math.round(between(next, 320, 1200))]; }

// World point -> CSS pixel, through the same matrix the renderer uses.
function toScreen3d(view, width, height, point) {
  const [x, y] = projectPoint(viewProjection(view, width / height), point);
  return [(x + 1) / 2 * width, (1 - y) / 2 * height];
}
// The 2D vertex shader: clip = (world - focus) * zoom * 2 / canvasSize, y flipped; canvasSize is in
// device pixels, so one block covers zoom / pixelRatio CSS pixels.
function toScreen2d(view, width, height, pixelRatio, [x, z]) {
  return [width / 2 + (x - view.x) * view.zoom / pixelRatio, height / 2 + (z - view.z) * view.zoom / pixelRatio];
}
function groundUnder(view, width, height, point, pixelRatio = 1) {
  const [dx, dz] = groundOffset(view, width, height, point, pixelRatio);
  return [view.x + dx, view.y, view.z + dz];
}
function assertNear(actual, expected, tolerance, message) {
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) <= tolerance, `${message}: got ${actual}, expected ${expected}`);
  }
}

test('groundOffset finds the ground point under a cursor (round trip through the projection)', () => {
  const next = random(1);
  for (let i = 0; i < 300; i++) {
    const view = randomView3d(next), [width, height] = randomSize(next);
    const cursor = [between(next, 0, width), between(next, height / 2, height)];
    assert.ok(hitsGround(view, height, cursor[1]));
    assertNear(toScreen3d(view, width, height, groundUnder(view, width, height, cursor)), cursor, 1e-6, `case ${i}`);
  }
});

test('the centre of the screen is the focus point', () => {
  const next = random(2);
  for (let i = 0; i < 50; i++) {
    const view = randomView3d(next), [width, height] = randomSize(next);
    assertNear(groundOffset(view, width, height, [width / 2, height / 2]), [0, 0], 1e-9, `case ${i}`);
  }
});

test('grab the ground: the point grabbed at A is under B after a drag from A to B', () => {
  const next = random(3);
  for (let i = 0; i < 500; i++) {
    const view = randomView3d(next), [width, height] = randomSize(next);
    const a = [between(next, 0, width), between(next, height / 2, height)];
    const b = [between(next, 0, width), between(next, height / 2, height)];
    const grabbed = groundUnder(view, width, height, a);
    const moved = panView(view, width, height, a, b);
    assertNear(toScreen3d(moved, width, height, grabbed), b, 1e-6, `case ${i} yaw ${view.yaw} pitch ${view.pitch}`);
    for (const key of ['y', 'yaw', 'pitch', 'distance', 'mode', 'mapId']) assert.equal(moved[key], view[key]);
  }
});

test('grab the ground holds over the whole screen when the camera looks steeply down', () => {
  const next = random(4);
  for (let i = 0; i < 200; i++) {
    const view = randomView3d(next, { pitch: between(next, 65, 89) }), [width, height] = randomSize(next);
    const a = [between(next, 0, width), between(next, 0, height)];
    const b = [between(next, 0, width), between(next, 0, height)];
    const grabbed = groundUnder(view, width, height, a);
    assertNear(toScreen3d(panView(view, width, height, a, b), width, height, grabbed), b, 1e-6, `case ${i}`);
  }
});

test('a drag made in several steps ends where a single drag ends', () => {
  const next = random(5);
  for (let i = 0; i < 100; i++) {
    const view = randomView3d(next), [width, height] = randomSize(next);
    const points = Array.from({ length: 6 }, () => [between(next, 0, width), between(next, -50, height)]);
    let stepped = view;
    for (let k = 1; k < points.length; k++) stepped = panView(stepped, width, height, points[k - 1], points[k]);
    const direct = panView(view, width, height, points[0], points.at(-1));
    assertNear([stepped.x, stepped.z], [direct.x, direct.z], 1e-6 * view.distance, `case ${i}`);
  }
});

test('panning near or above the horizon never jumps', () => {
  const next = random(6);
  for (let i = 0; i < 300; i++) {
    const view = randomView3d(next, { pitch: between(next, 10, 40) }), [width, height] = randomSize(next);
    const centre = [width / 2, height / 2];
    const reference = panView(view, width, height, centre, [centre[0], centre[1] + 1]);
    const onePixelAtCentre = Math.hypot(reference.x - view.x, reference.z - view.z);
    const a = [between(next, 0, width), between(next, -200, height / 2)];
    const b = [a[0] + between(next, -1, 1), a[1] + between(next, -1, 1)];
    const moved = panView(view, width, height, a, b);
    const step = Math.hypot(moved.x - view.x, moved.z - view.z);
    assert.ok(Number.isFinite(step), `case ${i}`);
    assert.ok(step <= 25 * onePixelAtCentre * Math.hypot(b[0] - a[0], b[1] - a[1]) + 1e-9,
      `case ${i}: ${step} blocks for a sub-pixel drag (centre pixel is ${onePixelAtCentre})`);
  }
});

test('the ground under the cursor is continuous across the row where the exact solution stops', () => {
  const next = random(7);
  for (let i = 0; i < 100; i++) {
    const view = randomView3d(next, { pitch: between(next, 10, 40) }), [width, height] = randomSize(next);
    const x = between(next, 0, width);
    let previous = groundOffset(view, width, height, [x, height]);
    for (let y = height - 1; y >= -100; y--) {
      const current = groundOffset(view, width, height, [x, y]);
      const centreRow = groundOffset(view, width, height, [x, height / 2 - 1]);
      const centreStep = Math.hypot(centreRow[0] - groundOffset(view, width, height, [x, height / 2])[0],
        centreRow[1] - groundOffset(view, width, height, [x, height / 2])[1]);
      assert.ok(Math.hypot(current[0] - previous[0], current[1] - previous[1]) <= 25 * centreStep, `case ${i} row ${y}`);
      previous = current;
    }
  }
});

test('hitsGround is false for a cursor on or above the horizon', () => {
  const view = normaliseView([0, 64, 0], 'world', '3d', { pitch: 10 });
  assert.equal(hitsGround(view, 600, 0), false);
  assert.equal(hitsGround(view, 600, 599), true);
  assert.equal(hitsGround(normaliseView([0, 64, 0], 'world', '3d', { pitch: 80 }), 600, 0), true);
  assert.equal(hitsGround(normaliseView([0, 64, 0], 'world', '2d'), 600, -50), true);
});

test('keyboard forward moves into the screen and right moves to the right, at any yaw', () => {
  const next = random(8);
  const yaws = [0, 90, 180, 270, ...Array.from({ length: 60 }, () => between(next, -360, 720))];
  for (const yaw of yaws) {
    const view = randomView3d(next, { yaw }), [width, height] = randomSize(next);
    const forward = keyMotion(view, ['forward'], 0.1);
    const ahead = toScreen3d(view, width, height, [forward.x, view.y, forward.z]);
    assert.ok(Math.abs(ahead[0] - width / 2) < 1e-6, `yaw ${yaw}: forward drifts sideways (${ahead})`);
    assert.ok(ahead[1] < height / 2 - 1e-3, `yaw ${yaw}: forward is not up the screen (${ahead})`);
    const back = keyMotion(view, ['back'], 0.1);
    assertNear([back.x - view.x, back.z - view.z], [view.x - forward.x, view.z - forward.z], 1e-9, `yaw ${yaw} back`);
    const right = keyMotion(view, ['right'], 0.1);
    const beside = toScreen3d(view, width, height, [right.x, view.y, right.z]);
    assert.ok(Math.abs(beside[1] - height / 2) < 1e-6, `yaw ${yaw}: right drifts vertically (${beside})`);
    assert.ok(beside[0] > width / 2 + 1e-3, `yaw ${yaw}: right is not to the right (${beside})`);
    const left = keyMotion(view, ['left'], 0.1);
    assertNear([left.x - view.x, left.z - view.z], [view.x - right.x, view.z - right.z], 1e-9, `yaw ${yaw} left`);
  }
});

test('keyboard movement follows the compass convention (yaw 0 looks north, 90 looks east)', () => {
  const north = keyMotion(normaliseView([0, 64, 0], 'world', '3d', { yaw: 0 }), ['forward'], 0.1);
  assert.ok(north.z < 0 && Math.abs(north.x) < 1e-9);
  const east = keyMotion(normaliseView([0, 64, 0], 'world', '3d', { yaw: 90 }), ['forward'], 0.1);
  assert.ok(east.x > 0 && Math.abs(east.z) < 1e-9);
});

test('keyboard speed scales with time and distance, Shift is faster, diagonals are not', () => {
  const view = normaliseView([0, 64, 0], 'world', '3d', { yaw: 30, distance: 100 });
  const length = (v) => Math.hypot(v.x - view.x, v.z - view.z);
  const slow = length(keyMotion(view, ['forward'], 0.1));
  assert.ok(Math.abs(length(keyMotion(view, ['forward'], 0.2)) - 2 * slow) < 1e-9);
  assert.ok(Math.abs(length(keyMotion({ ...view, distance: 200 }, ['forward'], 0.1)) - 2 * slow) < 1e-9);
  assert.ok(length(keyMotion(view, ['forward'], 0.1, { fast: true })) > 1.5 * slow);
  assert.ok(Math.abs(length(keyMotion(view, ['forward', 'right'], 0.1)) - slow) < 1e-9);
  assert.equal(keyMotion(view, ['forward', 'back'], 0.1).x, view.x);
  assert.equal(keyMotion(view, [], 0.1), view);
});

test('keyboard rotate, tilt and zoom in 3D respect the clamps', () => {
  const view = normaliseView([0, 64, 0], 'world', '3d', { yaw: 10, pitch: 45, distance: 100 });
  assert.ok(keyMotion(view, ['turnRight'], 0.1).yaw > view.yaw);
  assert.ok(keyMotion(view, ['turnLeft'], 0.1).yaw < view.yaw);
  assert.ok(keyMotion(view, ['tiltUp'], 0.1).pitch < view.pitch);
  assert.ok(keyMotion(view, ['tiltDown'], 0.1).pitch > view.pitch);
  assert.ok(keyMotion(view, ['zoomIn'], 0.1).distance < view.distance);
  assert.ok(keyMotion(view, ['zoomOut'], 0.1).distance > view.distance);
  assert.equal(keyMotion(view, ['tiltUp'], 1000).pitch, 10);
  assert.equal(keyMotion(view, ['tiltDown'], 1000).pitch, 89);
  assert.equal(keyMotion(view, ['zoomIn'], 1000).distance, 8);
  assert.equal(keyMotion(view, ['zoomOut'], 1000).distance, 1024);
  const turned = keyMotion(view, ['turnRight'], 0.1);
  assert.deepEqual([turned.x, turned.z], [view.x, view.z]);
});

test('keyboard in 2D pans north-up and zooms, and never rotates or tilts', () => {
  const view = normaliseView([0, 64, 0], 'world', '2d', { zoom: 2, yaw: 40 });
  const up = keyMotion(view, ['forward'], 0.1);
  assert.ok(up.z < view.z && up.x === view.x);
  const right = keyMotion(view, ['right'], 0.1);
  assert.ok(right.x > view.x && right.z === view.z);
  assert.ok(keyMotion(view, ['zoomIn'], 0.1).zoom > view.zoom);
  assert.equal(keyMotion(view, ['zoomIn'], 1000).zoom, 16);
  assert.equal(keyMotion(view, ['zoomOut'], 1000).zoom, 1 / 16);
  for (const action of ['turnLeft', 'turnRight', 'tiltUp', 'tiltDown']) assert.equal(keyMotion(view, [action], 0.1), view);
  // The same number of screen pixels per second whatever the zoom.
  const far = keyMotion({ ...view, zoom: 1 }, ['right'], 0.1);
  assert.ok(Math.abs((far.x - view.x) - 2 * (right.x - view.x)) < 1e-9);
});

test('keyAction maps physical keys to actions', () => {
  const cases = {
    forward: [['ArrowUp', 'ArrowUp'], ['KeyW', 'w']], back: [['ArrowDown', 'ArrowDown'], ['KeyS', 's']],
    left: [['ArrowLeft', 'ArrowLeft'], ['KeyA', 'a']], right: [['ArrowRight', 'ArrowRight'], ['KeyD', 'd']],
    turnLeft: [['KeyQ', 'q']], turnRight: [['KeyE', 'e']],
    tiltUp: [['KeyR', 'r'], ['PageUp', 'PageUp']], tiltDown: [['KeyF', 'f'], ['PageDown', 'PageDown']],
    // '+' is Shift+Equal on a US keyboard and Shift+Semicolon on a Japanese one.
    zoomIn: [['Equal', '='], ['Equal', '+'], ['Semicolon', '+'], ['NumpadAdd', '+'], ['Minus', '=']],
    zoomOut: [['Minus', '-'], ['Minus', '_'], ['NumpadSubtract', '-'], ['IntlRo', '_']],
  };
  for (const [action, keys] of Object.entries(cases)) {
    for (const [code, key] of keys) assert.equal(keyAction(code, key), action, `${code} ${key}`);
  }
  assert.equal(keyAction('KeyZ', 'z'), null);
  assert.equal(keyAction('Tab', 'Tab'), null);
});

test('zoom towards the cursor keeps the ground under the cursor in 3D', () => {
  const next = random(9);
  for (let i = 0; i < 300; i++) {
    const view = randomView3d(next, { distance: between(next, 20, 500) }), [width, height] = randomSize(next);
    const cursor = [between(next, 0, width), between(next, height / 2, height)];
    const scale = between(next, 0.6, 1.7);
    const under = groundUnder(view, width, height, cursor);
    const zoomed = zoomView(view, width, height, cursor, scale);
    assert.ok(Math.abs(zoomed.distance - view.distance / scale) < 1e-9, `case ${i}`);
    assertNear(toScreen3d(zoomed, width, height, under), cursor, 1e-6, `case ${i}`);
  }
});

test('zoom in 3D clamps the distance, and falls back to the centre without a cursor or above the horizon', () => {
  const view = normaliseView([10, 64, 20], 'world', '3d', { pitch: 20, distance: 100 });
  assert.equal(zoomView(view, 800, 600, [700, 500], 1e6).distance, 8);
  assert.equal(zoomView(view, 800, 600, [700, 500], 1e-6).distance, 1024);
  const clamped = zoomView({ ...view, distance: 8 }, 800, 600, [700, 500], 2);
  assert.deepEqual([clamped.x, clamped.z, clamped.distance], [10, 20, 8]);
  for (const cursor of [null, [700, 0]]) {
    const zoomed = zoomView(view, 800, 600, cursor, 2);
    assert.deepEqual([zoomed.x, zoomed.z, zoomed.distance], [10, 20, 50]);
  }
});

test('rotating about a point keeps that ground point on the same pixel', () => {
  const next = random(10);
  for (let i = 0; i < 200; i++) {
    const view = randomView3d(next), [width, height] = randomSize(next);
    const pivot = [between(next, 0, width), between(next, height / 2, height)];
    const degrees = between(next, -170, 170);
    const under = groundUnder(view, width, height, pivot);
    const turned = rotateView(view, width, height, pivot, degrees);
    assert.ok(Math.abs(turned.yaw - (view.yaw + degrees)) < 1e-9);
    assertNear(toScreen3d(turned, width, height, under), pivot, 1e-6, `case ${i}`);
  }
  const flat = normaliseView([0, 64, 0], 'world', '2d', { yaw: 0 });
  assert.equal(rotateView(flat, 800, 600, [100, 100], 30), flat);
});

test('rotate drag: the world in front of the camera follows the cursor, the focus stays put', () => {
  const next = random(11);
  for (let i = 0; i < 100; i++) {
    const view = randomView3d(next, { pitch: between(next, 30, 80) }), [width, height] = randomSize(next);
    // A ground point between the camera and the focus, straight below the centre of the screen.
    const near = groundUnder(view, width, height, [width / 2, height * 0.75]);
    const right = orbitView(view, 40, 0);
    assert.ok(toScreen3d(right, width, height, near)[0] > width / 2, `case ${i}: drag right`);
    assert.ok(toScreen3d(orbitView(view, -40, 0), width, height, near)[0] < width / 2, `case ${i}: drag left`);
    assert.deepEqual([right.x, right.y, right.z, right.distance, right.pitch], [view.x, view.y, view.z, view.distance, view.pitch]);
    assertNear(toScreen3d(right, width, height, [view.x, view.y, view.z]), [width / 2, height / 2], 1e-6, `case ${i}`);
  }
});

test('rotate drag: dragging down tilts towards top-down and the pitch stays clamped', () => {
  const view = normaliseView([0, 64, 0], 'world', '3d', { pitch: 45 });
  assert.ok(orbitView(view, 0, 30).pitch > 45);
  assert.ok(orbitView(view, 0, -30).pitch < 45);
  assert.equal(orbitView(view, 0, 30).yaw, view.yaw);
  assert.equal(orbitView(view, 0, 1e6).pitch, 89);
  assert.equal(orbitView(view, 0, -1e6).pitch, 10);
});

test('2D pan keeps the map point under the cursor at any device pixel ratio', () => {
  const next = random(12);
  for (let i = 0; i < 300; i++) {
    const pixelRatio = [1, 1.5, 2, 3][i % 4];
    const view = normaliseView([between(next, -500, 500), 64, between(next, -500, 500)], 'world', '2d', { zoom: between(next, 1 / 16, 16) });
    const [width, height] = randomSize(next);
    const a = [between(next, 0, width), between(next, 0, height)], b = [between(next, 0, width), between(next, 0, height)];
    const [x, , z] = groundUnder(view, width, height, a, pixelRatio);
    assertNear(toScreen2d(view, width, height, pixelRatio, [x, z]), a, 1e-6, `case ${i} unproject`);
    const moved = panView(view, width, height, a, b, pixelRatio);
    assertNear(toScreen2d(moved, width, height, pixelRatio, [x, z]), b, 1e-6, `case ${i} pan`);
    assert.equal(moved.zoom, view.zoom);
  }
});

test('2D zoom keeps the map point under the cursor and clamps', () => {
  const next = random(13);
  for (let i = 0; i < 300; i++) {
    const pixelRatio = [1, 2][i % 2];
    const view = normaliseView([between(next, -500, 500), 64, between(next, -500, 500)], 'world', '2d', { zoom: between(next, 0.25, 4) });
    const [width, height] = randomSize(next);
    const cursor = [between(next, 0, width), between(next, 0, height)], scale = between(next, 0.6, 1.7);
    const [x, , z] = groundUnder(view, width, height, cursor, pixelRatio);
    const zoomed = zoomView(view, width, height, cursor, scale, pixelRatio);
    assert.ok(Math.abs(zoomed.zoom - view.zoom * scale) < 1e-12);
    assertNear(toScreen2d(zoomed, width, height, pixelRatio, [x, z]), cursor, 1e-6, `case ${i}`);
  }
  const view = normaliseView([0, 64, 0], 'world', '2d', { zoom: 1 });
  assert.equal(zoomView(view, 800, 600, [10, 10], 1e6).zoom, 16);
  assert.equal(zoomView(view, 800, 600, [10, 10], 1e-6).zoom, 1 / 16);
});

test('wheel: one mouse notch zooms 10-15 %, small trackpad deltas are proportional, big ones are bounded', () => {
  const notchIn = wheelFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false }, 600);
  assert.ok(notchIn >= 1.10 && notchIn <= 1.15, String(notchIn));
  const notchOut = wheelFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false }, 600);
  assert.ok(Math.abs(notchIn * notchOut - 1) < 1e-12);
  const small = wheelFactor({ deltaY: -2, deltaMode: 0, ctrlKey: false }, 600);
  assert.ok(small > 1 && small < 1.005);
  assert.ok(Math.abs(small ** 2 - wheelFactor({ deltaY: -4, deltaMode: 0, ctrlKey: false }, 600)) < 1e-12);
  assert.ok(wheelFactor({ deltaY: -1e6, deltaMode: 0, ctrlKey: false }, 600) <= 1.2);
  assert.ok(wheelFactor({ deltaY: 1e6, deltaMode: 0, ctrlKey: false }, 600) >= 1 / 1.2);
  // Firefox reports lines: three lines are one notch.
  const lines = wheelFactor({ deltaY: -3, deltaMode: 1, ctrlKey: false }, 600);
  assert.ok(lines >= 1.10 && lines <= 1.15, String(lines));
  const page = wheelFactor({ deltaY: -1, deltaMode: 2, ctrlKey: false }, 600);
  assert.ok(page > 1 && page <= 1.2);
  assert.equal(wheelFactor({ deltaY: 0, deltaMode: 0, ctrlKey: false }, 600), 1);
  assert.equal(wheelFactor({ deltaY: NaN, deltaMode: 0, ctrlKey: false }, 600), 1);
});

test('wheel: a trackpad pinch (Ctrl + wheel) zooms with a higher gain and is bounded too', () => {
  const pinch = wheelFactor({ deltaY: -5, deltaMode: 0, ctrlKey: true }, 600);
  const scroll = wheelFactor({ deltaY: -5, deltaMode: 0, ctrlKey: false }, 600);
  assert.ok(pinch > scroll && pinch > 1.02 && pinch < 1.1, String(pinch));
  assert.ok(wheelFactor({ deltaY: -1e6, deltaMode: 0, ctrlKey: true }, 600) <= 1.5);
});

// Two fingers as [[ax, ay], [bx, by]].
const fingers = (ax, ay, bx, by) => [[ax, ay], [bx, by]];
const fresh = { kind: 'pending', zoom: false, twist: false };

test('two fingers: tiny movements stay undecided', () => {
  assert.deepEqual(twoFingerGesture(fresh, fingers(100, 300, 300, 300), fingers(102, 303, 301, 298), '3d'), fresh);
});

test('two fingers: moving both the same way vertically is a tilt, and stays one', () => {
  const start = fingers(100, 300, 300, 310);
  const tilt = twoFingerGesture(fresh, start, fingers(102, 330, 299, 338), '3d');
  assert.deepEqual(tilt, { kind: 'tilt', zoom: false, twist: false });
  // Once decided the gesture is locked, even if the fingers then spread.
  assert.equal(twoFingerGesture(tilt, start, fingers(40, 330, 360, 338), '3d').kind, 'tilt');
  assert.equal(twoFingerGesture(fresh, start, fingers(100, 270, 300, 281), '3d').kind, 'tilt');
});

test('two fingers: a clean pinch zooms and never tilts or twists', () => {
  const start = fingers(150, 300, 250, 300);
  for (const now of [fingers(120, 300, 280, 300), fingers(170, 300, 230, 300), fingers(130, 285, 270, 315)]) {
    const state = twoFingerGesture(fresh, start, now, '3d');
    assert.equal(state.kind, 'transform');
    assert.equal(state.zoom, true);
  }
  assert.equal(twoFingerGesture(fresh, start, fingers(120, 300, 280, 300), '3d').twist, false);
  // A pinch with the fingers one above the other moves them in opposite vertical directions.
  assert.equal(twoFingerGesture(fresh, fingers(200, 200, 200, 300), fingers(200, 170, 200, 330), '3d').kind, 'transform');
});

test('two fingers: a clean two-finger drag pans without zooming or twisting', () => {
  const sideways = twoFingerGesture(fresh, fingers(100, 300, 300, 300), fingers(140, 301, 341, 299), '3d');
  assert.deepEqual(sideways, { kind: 'transform', zoom: false, twist: false });
  // Fingers stacked vertically cannot tilt, so a vertical drag pans.
  const stacked = twoFingerGesture(fresh, fingers(200, 200, 205, 330), fingers(201, 240, 204, 371), '3d');
  assert.deepEqual(stacked, { kind: 'transform', zoom: false, twist: false });
});

test('two fingers: a twist rotates, and 2D never tilts or twists', () => {
  const start = fingers(100, 300, 300, 300);
  const angle = 20 * Math.PI / 180;
  const twisted = fingers(200 - 100 * Math.cos(angle), 300 - 100 * Math.sin(angle), 200 + 100 * Math.cos(angle), 300 + 100 * Math.sin(angle));
  const state = twoFingerGesture(fresh, start, twisted, '3d');
  assert.equal(state.kind, 'transform');
  assert.equal(state.twist, true);
  assert.equal(twoFingerGesture(fresh, start, twisted, '2d').twist, false);
  assert.equal(twoFingerGesture(fresh, start, fingers(100, 340, 300, 341), '2d').kind, 'transform');
});

test('two-finger pinch and twist keep the ground under both fingers when looking straight down', () => {
  const next = random(14);
  for (let i = 0; i < 200; i++) {
    const view = randomView3d(next, { pitch: 89, distance: between(next, 30, 300) });
    const width = 800, height = 600;
    const point = () => [between(next, 250, 550), between(next, 200, 400)];
    const before = [point(), point()], after = [point(), point()];
    if (Math.hypot(before[0][0] - before[1][0], before[0][1] - before[1][1]) < 40) continue;
    if (Math.hypot(after[0][0] - after[1][0], after[0][1] - after[1][1]) < 40) continue;
    const grabbed = before.map(finger => groundUnder(view, width, height, finger));
    const moved = twoFingerStep(view, width, height, before, after, { kind: 'transform', zoom: true, twist: true });
    // At pitch 89 the projection is not quite a similarity, so allow a few pixels.
    for (let k = 0; k < 2; k++) assertNear(toScreen3d(moved, width, height, grabbed[k]), after[k], 6, `case ${i} finger ${k}`);
  }
});

test('two-finger step: the midpoint ground stays under the midpoint at any pitch, without twist or zoom when not active', () => {
  const next = random(15);
  for (let i = 0; i < 200; i++) {
    const view = randomView3d(next, { distance: between(next, 30, 300) });
    const width = 800, height = 600;
    const point = () => [between(next, 100, 700), between(next, 320, 580)];
    const before = [point(), point()], after = [point(), point()];
    const middle = (pair) => [(pair[0][0] + pair[1][0]) / 2, (pair[0][1] + pair[1][1]) / 2];
    const grabbed = groundUnder(view, width, height, middle(before));
    const all = twoFingerStep(view, width, height, before, after, { kind: 'transform', zoom: true, twist: true });
    assertNear(toScreen3d(all, width, height, grabbed), middle(after), 1e-6, `case ${i} full`);
    const panOnly = twoFingerStep(view, width, height, before, after, { kind: 'transform', zoom: false, twist: false });
    assertNear(toScreen3d(panOnly, width, height, grabbed), middle(after), 1e-6, `case ${i} pan`);
    assert.equal(panOnly.distance, view.distance);
    assert.equal(panOnly.yaw, view.yaw);
    assert.equal(panOnly.pitch, view.pitch);
  }
});

test('two-finger tilt changes only the pitch: down is more top-down', () => {
  const view = normaliseView([0, 64, 0], 'world', '3d', { pitch: 45 });
  const down = twoFingerStep(view, 800, 600, fingers(100, 300, 300, 300), fingers(100, 330, 300, 330), { kind: 'tilt', zoom: false, twist: false });
  assert.ok(down.pitch > 45);
  assert.deepEqual([down.x, down.z, down.yaw, down.distance], [view.x, view.z, view.yaw, view.distance]);
  const pending = twoFingerStep(view, 800, 600, fingers(100, 300, 300, 300), fingers(100, 305, 300, 305), fresh);
  assert.equal(pending, view);
});

test('two-finger step in 2D pans and zooms about the midpoint and never rotates', () => {
  const next = random(16);
  for (let i = 0; i < 100; i++) {
    const pixelRatio = [1, 2][i % 2];
    const view = normaliseView([0, 64, 0], 'world', '2d', { zoom: between(next, 0.5, 4) });
    const width = 800, height = 600;
    const point = () => [between(next, 100, 700), between(next, 100, 500)];
    const before = [point(), point()], after = [point(), point()];
    if (Math.hypot(before[0][0] - before[1][0], before[0][1] - before[1][1]) < 40) continue;
    const grabbed = before.map(finger => groundUnder(view, width, height, finger, pixelRatio));
    // Keep the finger spacing direction so that no rotation would be needed.
    const spread = between(next, 0.7, 1.4);
    const second = [after[0][0] + (before[1][0] - before[0][0]) * spread, after[0][1] + (before[1][1] - before[0][1]) * spread];
    const moved = twoFingerStep(view, width, height, before, [after[0], second], { kind: 'transform', zoom: true, twist: true }, pixelRatio);
    assert.equal(moved.yaw, view.yaw);
    if (moved.zoom === 16 || moved.zoom === 1 / 16) continue;
    assertNear(toScreen2d(moved, width, height, pixelRatio, [grabbed[0][0], grabbed[0][2]]), after[0], 1e-6, `case ${i} a`);
    assertNear(toScreen2d(moved, width, height, pixelRatio, [grabbed[1][0], grabbed[1][2]]), second, 1e-6, `case ${i} b`);
  }
});
