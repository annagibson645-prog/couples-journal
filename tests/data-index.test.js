import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickAdapter, createLazyAdapter, isRealConfig } from '../js/data/index.js';
import { firebaseConfig } from '../js/firebase-config.js';
import { MODE, PRIVACY_STATEMENT } from '../js/config.js';

const REAL = { enabled: true, apiKey: 'k', authDomain: 'd.example', projectId: 'p', appId: 'a' };

test('the live site stays in sample mode, and the shipped config is placeholders that are not enabled', () => {
  assert.equal(MODE, 'demo');
  assert.equal(firebaseConfig.enabled, false);
  assert.equal(isRealConfig(firebaseConfig), false);
  assert.match(firebaseConfig.apiKey, /^PLACEHOLDER/);
});

test('isRealConfig needs enabled: true and no placeholder values', () => {
  assert.equal(isRealConfig(REAL), true);
  assert.equal(isRealConfig({ ...REAL, enabled: false }), false);
  assert.equal(isRealConfig({ ...REAL, apiKey: 'PLACEHOLDER-x' }), false);
  assert.equal(isRealConfig({ ...REAL, projectId: '' }), false);
  assert.equal(isRealConfig(null), false);
});

test('demo mode is the demo adapter and never loads the firebase module', async () => {
  let loads = 0;
  const a = pickAdapter('demo', firebaseConfig, () => { loads++; return {}; });
  await a.ready();
  assert.equal(loads, 0);
  assert.equal(typeof a.signIn, 'function');
  const src = readFileSync(new URL('../js/data/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import[^\n]*firebase\.js/m, 'firebase.js is only ever imported on demand');
});

test('firebase mode with placeholder config fails closed with a plain message and loads nothing', async () => {
  let loads = 0;
  const a = pickAdapter('firebase', firebaseConfig, () => { loads++; return {}; });
  assert.equal(loads, 0, 'nothing is loaded until ready()');
  assert.equal(a.currentSession(), null);
  await assert.rejects(a.ready(), /not connected to its storage yet/);
  await assert.rejects(a.signIn('hers', { email: 'a@b.c', password: 'x' }), /not connected/);
  await assert.rejects(a.getMoods(), /not connected/);
  assert.throws(() => a.listenNotes(() => {}), /Not signed in/);
  await assert.doesNotReject(a.signOut());
  assert.equal(loads, 0);
});

test('an unknown mode fails closed instead of falling back to sample data', async () => {
  const a = pickAdapter('typo', REAL);
  await assert.rejects(a.ready(), /not connected/);
});

test('firebase mode with real config loads the module, then the pinned SDK, and passes the config without the enabled flag', async () => {
  const seen = {};
  const inner = { ready: async () => {}, currentSession: () => ({ uid: 'u', door: 'hers' }), signIn: async (d) => ({ uid: 'u', door: d }), signOut: async () => {}, listenNotes: () => () => {}, getMembers: async () => ({}) };
  const a = pickAdapter('firebase', REAL, async () => ({
    loadFirebaseSdk: async () => ({ fake: true }),
    createFirebaseAdapter: (opts) => { seen.opts = opts; return inner; },
  }));
  await a.ready();
  assert.deepEqual(seen.opts.sdk, { fake: true });
  assert.equal('enabled' in seen.opts.config, false);
  assert.equal(seen.opts.config.projectId, 'p');
  assert.deepEqual(a.currentSession(), { uid: 'u', door: 'hers' });
  assert.equal((await a.signIn('his')).door, 'his');
  assert.equal(typeof a.listenNotes(() => {}), 'function');
});

test('createLazyAdapter loads once even when called many times', async () => {
  let n = 0;
  const a = createLazyAdapter(async () => { n++; return { ready: async () => {} }; });
  await Promise.all([a.ready(), a.ready(), a.ready()]);
  assert.equal(n, 1);
});

test('the real-mode privacy statement is kept as a constant', () => {
  assert.match(PRIVACY_STATEMENT, /not end-to-end encrypted/);
  assert.match(PRIVACY_STATEMENT, /No analytics, no trackers\.$/);
});
