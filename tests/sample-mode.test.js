process.env.TZ = 'America/Los_Angeles';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDemoAdapter } from '../js/data/demo.js';
import { createDoors } from '../js/open-door.js';
import { createBanner } from '../js/screens/banner.js';
import { makeBannerDom } from './helpers/fake-dom.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

class MemoryStorage {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

// Real adapter, stub screens that record what the door opener asked of them.
function doorsSetup(demo) {
  const storage = new MemoryStorage();
  const data = createDemoAdapter(storage);
  const log = [];
  const sessionNow = () => data.currentSession()?.door ?? null;
  const today = { show: (d) => log.push(['today.show', d]), leave: async () => { log.push(['today.leave', sessionNow()]); }, clear: () => log.push(['today.clear']) };
  const lookback = { clear: () => log.push(['lookback.clear']) };
  const save = { clear: () => log.push(['save.clear']) };
  const notes = { show: (d) => log.push(['notes.show', d]), leave: () => log.push(['notes.leave']) };
  const signIn = { show: (...a) => log.push(['signin.show', ...a]) };
  const showGate = (...a) => log.push(['gate', ...a]);
  const doors = createDoors({ data, demo, today, lookback, save, notes, signIn, showGate });
  return { data, storage, log, doors, sessionNow };
}

test('sample mode: the Hers column signs Hers in and opens Today, with no sign-in screen', async () => {
  const { doors, log, sessionNow } = doorsSetup(true);
  await doors.openDoor('hers');
  assert.equal(sessionNow(), 'hers');
  assert.ok(log.some((l) => l[0] === 'today.show' && l[1] === 'hers'));
  assert.ok(!log.some((l) => l[0] === 'signin.show' || l[0] === 'gate'));
});

test('sample mode: the His column signs His in and opens Today', async () => {
  const { doors, log, sessionNow } = doorsSetup(true);
  await doors.openDoor('his');
  assert.equal(sessionNow(), 'his');
  assert.ok(log.some((l) => l[0] === 'today.show' && l[1] === 'his'));
  assert.ok(!log.some((l) => l[0] === 'signin.show' || l[0] === 'gate'));
});

test('sample mode: Notes signs in as Hers and opens Notes', async () => {
  const { doors, log, sessionNow } = doorsSetup(true);
  await doors.openDoor('notes');
  assert.equal(sessionNow(), 'hers');
  assert.deepEqual(log.filter((l) => l[0] === 'notes.show'), [['notes.show', 'hers']]);
  assert.ok(!log.some((l) => l[0] === 'signin.show' || l[0] === 'gate'));
});

test('sample mode: Notes opens as Hers even after the viewer was switched to His', async () => {
  const { doors, data, sessionNow } = doorsSetup(true);
  await doors.openDoor('hers');
  await data.signIn('his'); // what the Notes switch does
  await doors.openDoor('notes');
  assert.equal(sessionNow(), 'hers');
});

test('sample mode: moving from one person to the other flushes the leaver first, then clears every screen', async () => {
  const { doors, log } = doorsSetup(true);
  await doors.openDoor('hers');
  log.length = 0;
  await doors.openDoor('his');
  const names = log.map((l) => l[0]);
  assert.deepEqual(log[0], ['today.leave', 'hers'], 'the draft is flushed while still signed in as the person leaving');
  assert.ok(names.indexOf('today.clear') > 0 && names.indexOf('lookback.clear') > 0 && names.indexOf('save.clear') > 0);
  assert.ok(names.indexOf('today.clear') < names.indexOf('today.show'));
  assert.deepEqual(log.at(-1), ['today.show', 'his']);
});

test('sample mode: opening a door never wipes the sample data', async () => {
  const { doors, data } = doorsSetup(true);
  await doors.openDoor('hers');
  const moods = Object.keys(await data.getMoods()).length;
  const entries = (await data.listEntries()).length;
  assert.ok(moods > 0 && entries > 0);
  await doors.openDoor('his');
  await doors.openDoor('hers');
  assert.equal(Object.keys(await data.getMoods()).length, moods);
  assert.equal((await data.listEntries()).length, entries);
});

test('real mode: signed out, a column asks for the sign-in screen (Notes offers Hers, then returns to Notes)', async () => {
  const { doors, log, sessionNow } = doorsSetup(false);
  await doors.openDoor('his');
  await doors.openDoor('notes');
  assert.deepEqual(log, [['signin.show', 'his', 'his'], ['signin.show', 'hers', 'notes']]);
  assert.equal(sessionNow(), null);
});

test("real mode: the other person's journal shows the private gate, and Notes opens for either", async () => {
  const { doors, data, log } = doorsSetup(false);
  await data.signIn('hers');
  await doors.openDoor('his');
  assert.equal(log[0][0], 'gate');
  assert.equal(log[0][1], 'This journal is private.');
  await doors.openDoor('notes');
  await doors.openDoor('hers');
  assert.deepEqual(log.slice(1), [['notes.show', 'hers'], ['today.show', 'hers']]);
});

// --- banner ---------------------------------------------------------------
function bannerSetup(onReset = async () => {}) {
  const doc = makeBannerDom();
  const resets = [];
  const banner = createBanner({ document: doc, onReset: async () => { resets.push(1); await onReset(); } });
  const $ = (id) => doc.byId[id];
  return { doc, banner, $, resets };
}

test('banner: html keeps the sample-mode text and has a Reset sample data button plus a Yes / No confirm', () => {
  assert.match(html, /Sample mode — entries stay on this device only and aren't private or backed up</);
  assert.match(html, /<button[^>]+id="sample-reset"[^>]*>Reset sample data</);
  assert.match(html, /Reset the sample data on this device\?/);
  assert.match(html, /<button[^>]+id="sample-yes"[^>]*>Yes</);
  assert.match(html, /<button[^>]+id="sample-no"[^>]*>No</);
  assert.match(html, /id="sample-status"[^>]*role="status"/);
  const b = html.indexOf('id="sample-banner"'), r = html.indexOf('id="sample-reset"'), m = html.indexOf('id="screen-front"');
  assert.ok(b < r && r < m, 'the reset button is inside the banner, before the screens');
});

test('banner: shown only when asked', () => {
  const { banner, $ } = bannerSetup();
  banner.show(false);
  assert.equal($('sample-banner').hidden, true);
  banner.show(true);
  assert.equal($('sample-banner').hidden, false);
});

test('banner: Reset asks first, focuses No, and resets nothing yet', () => {
  const { banner, $, doc, resets } = bannerSetup();
  banner.show(true);
  $('sample-reset').click();
  assert.equal($('sample-confirm').hidden, false);
  assert.equal($('sample-reset').hidden, true);
  assert.equal(doc.activeElement, $('sample-no'));
  assert.equal(resets.length, 0);
});

test('banner: No closes the question and puts focus back on Reset', () => {
  const { banner, $, doc, resets } = bannerSetup();
  banner.show(true);
  $('sample-reset').click();
  $('sample-no').click();
  assert.equal($('sample-confirm').hidden, true);
  assert.equal($('sample-reset').hidden, false);
  assert.equal(doc.activeElement, $('sample-reset'));
  assert.equal(resets.length, 0);
});

test('banner: Escape cancels like No', () => {
  const { banner, $, doc, resets } = bannerSetup();
  banner.show(true);
  $('sample-reset').click();
  $('sample-confirm').dispatch('keydown', { key: 'Escape' });
  assert.equal($('sample-confirm').hidden, true);
  assert.equal(doc.activeElement, $('sample-reset'));
  assert.equal(resets.length, 0);
});

test('banner: Yes resets once, closes the question, announces it and returns focus to Reset', async () => {
  const { banner, $, doc, resets } = bannerSetup();
  banner.show(true);
  $('sample-reset').click();
  $('sample-yes').click();
  $('sample-yes').click(); // a double press must not reset twice
  await tick();
  assert.equal(resets.length, 1);
  assert.equal($('sample-confirm').hidden, true);
  assert.equal($('sample-reset').hidden, false);
  assert.equal($('sample-status').textContent, 'Sample data reset.');
  assert.equal(doc.activeElement, $('sample-reset'));
});

test('banner: a failed reset says so and can be tried again', async () => {
  let fail = true;
  const { banner, $, resets } = bannerSetup(async () => { if (fail) throw new Error('x'); });
  banner.show(true);
  $('sample-reset').click(); $('sample-yes').click(); await tick();
  assert.match($('sample-status').textContent, /Could not reset/);
  fail = false;
  $('sample-reset').click(); $('sample-yes').click(); await tick();
  assert.equal(resets.length, 2);
  assert.equal($('sample-status').textContent, 'Sample data reset.');
});
