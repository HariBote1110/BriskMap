// Tests for the UI string dictionary (web/src/ui/i18n.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STRINGS, pickLanguage, createTranslator } from '../../src/ui/i18n.mjs';

test('pickLanguage chooses Japanese for any ja* tag', () => {
  for (const tag of ['ja', 'ja-JP', 'JA-jp', 'ja_JP']) assert.equal(pickLanguage(tag), 'ja');
});

test('pickLanguage chooses English for everything else', () => {
  for (const tag of ['en', 'en-GB', 'fr', 'jav', 'zh-Hans', '', undefined, null]) {
    assert.equal(pickLanguage(tag), 'en', String(tag));
  }
});

test('both languages define exactly the same keys', () => {
  assert.deepEqual(Object.keys(STRINGS.ja).sort(), Object.keys(STRINGS.en).sort());
});

test('every string is non-empty', () => {
  for (const lang of ['en', 'ja']) {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      assert.equal(typeof value, 'string', `${lang}.${key}`);
      assert.ok(value.length > 0, `${lang}.${key}`);
    }
  }
});

test('both languages use the same placeholders for each key', () => {
  const placeholders = (s) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
  for (const key of Object.keys(STRINGS.en)) {
    assert.deepEqual(placeholders(STRINGS.ja[key]), placeholders(STRINGS.en[key]), key);
  }
});

test('createTranslator substitutes placeholders', () => {
  const t = createTranslator('en', { en: { greet: 'Hello {name}, {name}!' } });
  assert.equal(t('greet', { name: 'Steve' }), 'Hello Steve, Steve!');
});

test('createTranslator leaves unknown placeholders intact', () => {
  const t = createTranslator('en', { en: { greet: 'Hello {name}' } });
  assert.equal(t('greet'), 'Hello {name}');
});

test('createTranslator falls back to English, then to the key', () => {
  const t = createTranslator('ja', { en: { only: 'English only' }, ja: {} });
  assert.equal(t('only'), 'English only');
  assert.equal(t('missing.key'), 'missing.key');
});

test('createTranslator exposes its language', () => {
  assert.equal(createTranslator('ja').lang, 'ja');
});

// ---- help dialog controls (web/src/ui/help.mjs) ---------------------------------

import { CONTROLS } from '../../src/ui/help.mjs';

const helpRows = (mode) => Object.values(CONTROLS[mode]).flat();

test('every control listed in the help has a string in both languages', () => {
  for (const mode of ['3d', '2d']) {
    assert.deepEqual(Object.keys(CONTROLS[mode]), ['mouse', 'touch', 'keyboard']);
    for (const [input, action] of helpRows(mode)) {
      for (const lang of ['en', 'ja']) {
        assert.ok(STRINGS[lang][input], `${lang} ${input}`);
        assert.ok(STRINGS[lang][action], `${lang} ${action}`);
      }
    }
  }
});

test('no input or action string is left unused by the help', () => {
  const used = new Set(['3d', '2d'].flatMap((mode) => helpRows(mode).flat()));
  for (const key of Object.keys(STRINGS.en)) {
    if (key.startsWith('in.') || key.startsWith('act.')) assert.ok(used.has(key), key);
  }
});

test('the help matches the controls: drag moves the map, rotating and tilting exist only in 3D', () => {
  const find = (mode, group, input) => CONTROLS[mode][group].find((row) => row[0] === input)?.[1];
  for (const mode of ['3d', '2d']) {
    assert.equal(find(mode, 'mouse', 'in.drag'), 'act.pan');
    assert.equal(find(mode, 'mouse', 'in.wheel'), 'act.zoom');
    assert.equal(find(mode, 'mouse', 'in.doubleClick'), 'act.zoomIn');
    assert.equal(find(mode, 'touch', 'in.oneFinger'), 'act.pan');
    assert.equal(find(mode, 'touch', 'in.pinch'), 'act.zoom');
    assert.equal(find(mode, 'keyboard', 'in.arrows'), 'act.pan');
    assert.equal(find(mode, 'keyboard', 'in.plusMinus'), 'act.zoom');
    assert.equal(find(mode, 'keyboard', 'in.shift'), 'act.faster');
  }
  assert.equal(find('3d', 'mouse', 'in.rightDrag'), 'act.orbit');
  assert.equal(find('3d', 'touch', 'in.twist'), 'act.rotate');
  assert.equal(find('3d', 'touch', 'in.twoFingerVertical'), 'act.tilt');
  assert.equal(find('3d', 'keyboard', 'in.qe'), 'act.rotate');
  assert.equal(find('3d', 'keyboard', 'in.rf'), 'act.tilt');
  const flatActions = new Set(helpRows('2d').map((row) => row[1]));
  for (const action of ['act.orbit', 'act.rotate', 'act.tilt']) assert.equal(flatActions.has(action), false, action);
});
