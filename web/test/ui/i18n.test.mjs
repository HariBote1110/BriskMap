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
