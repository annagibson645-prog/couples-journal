import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doorFor, canOpen, gateFor } from '../js/doors.js';
import { escapeText } from '../js/lib/escape.js';

const members = { names: { hers: 'Hers', his: 'His' }, doors: { hers: 'u-a', his: 'u-b' } };
const hers = { uid: 'u-a', door: 'hers' };
const his = { uid: 'u-b', door: 'his' };

test('doorFor maps a uid to its own door, or null', () => {
  assert.equal(doorFor('u-a', members), 'hers');
  assert.equal(doorFor('u-b', members), 'his');
  assert.equal(doorFor('u-x', members), null);
  assert.equal(doorFor('', members), null);
  assert.equal(doorFor('u-a', null), null);
});

test('an owner opens their own door', () => {
  assert.equal(canOpen('hers', hers), true);
  assert.equal(canOpen('his', his), true);
});

test('an owner is refused the other journal', () => {
  assert.equal(canOpen('his', hers), false);
  assert.equal(canOpen('hers', his), false);
});

test('notes opens for either signed-in person', () => {
  assert.equal(canOpen('notes', hers), true);
  assert.equal(canOpen('notes', his), true);
});

test('signed out is refused every door', () => {
  for (const d of ['hers', 'his', 'notes']) {
    assert.equal(canOpen(d, null), false);
    assert.equal(canOpen(d, undefined), false);
  }
});

test('unknown doors and malformed sessions are refused', () => {
  assert.equal(canOpen('admin', hers), false);
  assert.equal(canOpen('hers', { uid: 'u-a' }), false);
});

test('gateFor: open, sign-in, or private', () => {
  assert.equal(gateFor('hers', null), 'signin');
  assert.equal(gateFor('notes', null), 'signin');
  assert.equal(gateFor('hers', hers), 'open');
  assert.equal(gateFor('notes', his), 'open');
  assert.equal(gateFor('his', hers), 'private');
});

test('escapeText escapes HTML-significant characters', () => {
  assert.equal(escapeText('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeText(`a & "b" 'c'`), 'a &amp; &quot;b&quot; &#39;c&#39;');
  assert.equal(escapeText(null), '');
  assert.equal(escapeText(5), '5');
});
