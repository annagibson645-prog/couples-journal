import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRail, SECTIONS } from '../js/screens/rail.js';
import { makeLookbackDom } from './helpers/fake-dom.js';

function setup(current, members) {
  const doc = makeLookbackDom();
  const host = doc.createElement('aside');
  const clicks = [];
  const rail = createRail({ host, current, onNavigate: (k) => clicks.push(k), document: doc });
  const data = { getMembers: async () => members };
  const nav = () => host.find((c) => c.tag === 'nav')[0];
  return { host, rail, clicks, data, nav };
}

test('the rail has real buttons for the four sections, with the current one marked', () => {
  const { nav } = setup('lookback');
  const buttons = nav().children;
  assert.deepEqual(buttons.map((b) => b.tag), ['button', 'button', 'button', 'button']);
  assert.deepEqual(buttons.map((b) => b.textContent), SECTIONS.map((s) => s.label));
  assert.deepEqual(buttons.map((b) => b.type), ['button', 'button', 'button', 'button']);
  assert.deepEqual(buttons.map((b) => b.getAttribute('aria-current')), [null, 'page', null, null]);
});

test('other sections navigate (sign out too); the current one does nothing', () => {
  const { nav, clicks } = setup('today');
  const [today, lookback, save, signout] = nav().children;
  today.click(); lookback.click(); save.click(); signout.click();
  assert.deepEqual(clicks, ['lookback', 'save', 'signout']);
});

test('show() puts in the plain label, then the real name; clear() wipes it', async () => {
  const { host, rail, data } = setup('today', { names: { hers: 'Maya', his: 'Sam' } });
  const name = () => host.byClass('rail-name').length ? host.byClass('rail-name')[0] : host.find((c) => c.className.includes('rail-name'))[0];
  const p = rail.show('his', data);
  assert.equal(name().textContent, 'His');
  await p;
  assert.equal(name().textContent, 'Sam');
  rail.clear();
  assert.equal(name().textContent, '');
});

test('a failed name lookup leaves the plain label', async () => {
  const { host, rail } = setup('today');
  await rail.show('hers', { getMembers: async () => { throw new Error('x'); } });
  assert.equal(host.find((c) => c.className.includes('rail-name'))[0].textContent, 'Hers');
});

test('the Notes rail has no section buttons: a back link to the front page, then sign out', () => {
  const { host, clicks } = setup('notes');
  const buttons = host.find((c) => c.tag === 'button');
  assert.deepEqual(buttons.map((b) => b.textContent), ['Back to the three doors', 'Sign out']);
  buttons[0].click(); buttons[1].click();
  assert.deepEqual(clicks, ['front', 'signout']);
});

test('the Notes rail shows Shared · Both, the name Notes and its line, whoever is signed in', async () => {
  const { host, rail, data } = setup('notes', { names: { hers: 'Maya', his: 'Sam' } });
  await rail.show('notes', data);
  const text = (cls) => host.find((c) => c.className.split(' ').includes(cls))[0].textContent;
  assert.equal(text('kicker'), 'Shared · Both');
  assert.equal(text('rail-name'), 'Notes');
  assert.equal(text('rail-tag'), 'Little letters for the two of us. Only the two of you can read them.');
  rail.clear();
  assert.equal(text('rail-name'), '');
});
