// Firestore security rules tests. They need the Firestore emulator (Java), so they run
// in GitHub Actions (.github/workflows/rules.yml) or with `npm run test:rules`. The file
// is named *.rules.js on purpose: the plain `npm test` does not pick it up.
import { test, before, after, beforeEach, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';

const HER = 'herUid';
const HIS = 'hisUid';
const STRANGER = 'strangerUid';
const MEMBERS = {
  uids: [HER, HIS],
  doors: { hers: HER, his: HIS },
  names: { hers: 'Hers', his: 'His' },
};
const DAY = '2026-11-05';
const mood = (extra = {}) => ({ score: 7, note: 'ok', updatedAt: 1000, ...extra });
const entry = (extra = {}) => ({ day: DAY, text: 'a quiet day', createdAt: 1000, updatedAt: 1000, ...extra });
const note = (uid, door, extra = {}) => ({ authorUid: uid, authorDoor: door, text: 'hello', createdAt: 1000, ...extra });

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-journal',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => { if (env) await env.cleanup(); });

// Fresh data for every test: members, one mood + entry + draft each, one note each.
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('config/members').set(MEMBERS);
    for (const uid of [HER, HIS]) {
      await db.doc(`users/${uid}/moods/${DAY}`).set(mood());
      await db.doc(`users/${uid}/entries/e1`).set(entry());
      await db.doc(`users/${uid}/drafts/current`).set({ text: 'half a thought' });
    }
    await db.doc('notes/herNote').set(note(HER, 'hers'));
    await db.doc('notes/hisNote').set(note(HIS, 'his'));
    await db.doc('stray/doc').set({ x: 1 });
    await db.doc('config/other').set({ x: 1 });
  });
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

describe('her data and his data', () => {
  test('her can read and write her own moods and entries', async () => {
    const db = as(HER);
    await assertSucceeds(db.doc(`users/${HER}/moods/${DAY}`).get());
    await assertSucceeds(db.doc(`users/${HER}/moods/2026-11-06`).set(mood({ score: 3 })));
    await assertSucceeds(db.doc(`users/${HER}/moods/2026-11-06`).set({ score: 4 }));
    await assertSucceeds(db.doc(`users/${HER}/entries/e1`).get());
    await assertSucceeds(db.collection(`users/${HER}/entries`).get());
    await assertSucceeds(db.doc(`users/${HER}/entries/e2`).set(entry({ text: 'second' })));
    await assertSucceeds(db.doc(`users/${HER}/entries/e2`).delete());
  });

  test('her can read, write and delete her own draft', async () => {
    const db = as(HER);
    await assertSucceeds(db.doc(`users/${HER}/drafts/current`).get());
    await assertSucceeds(db.doc(`users/${HER}/drafts/current`).set({ text: 'more words', updatedAt: 5 }));
    await assertSucceeds(db.doc(`users/${HER}/drafts/current`).delete());
  });

  test('she cannot read or write his moods or entries', async () => {
    const db = as(HER);
    await assertFails(db.doc(`users/${HIS}/moods/${DAY}`).get());
    await assertFails(db.doc(`users/${HIS}/entries/e1`).get());
    await assertFails(db.collection(`users/${HIS}/entries`).get());
    await assertFails(db.collection(`users/${HIS}/moods`).get());
    await assertFails(db.doc(`users/${HIS}/moods/2026-11-06`).set(mood()));
    await assertFails(db.doc(`users/${HIS}/entries/e9`).set(entry()));
    await assertFails(db.doc(`users/${HIS}/entries/e1`).delete());
    await assertFails(db.doc(`users/${HIS}/drafts/current`).get());
    await assertFails(db.doc(`users/${HIS}/drafts/current`).set({ text: 'x' }));
  });

  test('he cannot read or write her data either', async () => {
    const db = as(HIS);
    await assertFails(db.doc(`users/${HER}/moods/${DAY}`).get());
    await assertFails(db.doc(`users/${HER}/entries/e1`).get());
    await assertFails(db.doc(`users/${HER}/entries/e9`).set(entry()));
    await assertSucceeds(db.doc(`users/${HIS}/entries/e1`).get());
  });
});

describe('a signed-in stranger who is not in config/members', () => {
  test('stranger cannot read any user data, notes, or config', async () => {
    const db = as(STRANGER);
    await assertFails(db.doc(`users/${HER}/moods/${DAY}`).get());
    await assertFails(db.doc(`users/${HIS}/entries/e1`).get());
    await assertFails(db.collection('notes').get());
    await assertFails(db.doc('notes/herNote').get());
    await assertFails(db.doc('config/members').get());
  });

  test('stranger cannot write anywhere, not even under their own uid', async () => {
    const db = as(STRANGER);
    await assertFails(db.doc(`users/${STRANGER}/moods/${DAY}`).set(mood()));
    await assertFails(db.doc(`users/${STRANGER}/entries/e1`).set(entry()));
    await assertFails(db.doc(`users/${STRANGER}/drafts/current`).set({ text: 'x' }));
    await assertFails(db.doc(`users/${STRANGER}/entries/e1`).get());
    await assertFails(db.doc('notes/sneaky').set(note(STRANGER, 'hers')));
    await assertFails(db.doc('notes/sneaky2').set(note(STRANGER, 'his')));
    await assertFails(db.doc('config/members').set({ uids: [STRANGER], doors: { hers: STRANGER, his: STRANGER }, names: { hers: 'x', his: 'y' } }));
  });
});

describe('shared notes', () => {
  test('member can create a note with own authorUid', async () => {
    await assertSucceeds(as(HER).doc('notes/n1').set(note(HER, 'hers')));
    await assertSucceeds(as(HIS).doc('notes/n2').set(note(HIS, 'his', { source: 'entry' })));
    await assertSucceeds(as(HER).doc('notes/herNote').get());
    await assertSucceeds(as(HER).doc('notes/hisNote').get());
    await assertSucceeds(as(HER).collection('notes').get());
  });

  test('member cannot create a note claiming the other person as author', async () => {
    await assertFails(as(HER).doc('notes/spoof1').set(note(HIS, 'his')));
    await assertFails(as(HIS).doc('notes/spoof2').set(note(HER, 'hers')));
  });

  test('member cannot claim the other door on their own note', async () => {
    await assertFails(as(HER).doc('notes/spoof3').set(note(HER, 'his')));
    await assertFails(as(HIS).doc('notes/spoof4').set(note(HIS, 'hers')));
    await assertFails(as(HER).doc('notes/spoof5').set(note(HER, 'admin')));
  });

  test('member can delete own note but not the other one', async () => {
    await assertFails(as(HER).doc('notes/hisNote').delete());
    await assertFails(as(HIS).doc('notes/herNote').delete());
    await assertSucceeds(as(HER).doc('notes/herNote').delete());
    await assertSucceeds(as(HIS).doc('notes/hisNote').delete());
  });

  test('a note can never be edited, by its author or anyone else', async () => {
    await assertFails(as(HER).doc('notes/herNote').update({ text: 'changed' }));
    await assertFails(as(HER).doc('notes/herNote').set(note(HER, 'hers', { text: 'changed' })));
    await assertFails(as(HIS).doc('notes/herNote').update({ text: 'changed' }));
  });

  test('note text must be 1 to 2000 characters, a string; source may only be entry; no extra fields', async () => {
    const db = as(HER);
    await assertSucceeds(db.doc('notes/ok2000').set(note(HER, 'hers', { text: 'x'.repeat(2000) })));
    await assertFails(db.doc('notes/long').set(note(HER, 'hers', { text: 'x'.repeat(2001) })));
    await assertFails(db.doc('notes/empty').set(note(HER, 'hers', { text: '' })));
    await assertFails(db.doc('notes/num').set(note(HER, 'hers', { text: 42 })));
    await assertFails(db.doc('notes/src').set(note(HER, 'hers', { source: 'email' })));
    await assertFails(db.doc('notes/extra').set(note(HER, 'hers', { admin: true })));
    await assertFails(db.doc('notes/time').set(note(HER, 'hers', { createdAt: 'yesterday' })));
  });
});

describe('validation of moods, entries and drafts', () => {
  test('mood score must be an integer from 1 to 10', async () => {
    const db = as(HER);
    const path = `users/${HER}/moods/2026-12-01`;
    await assertSucceeds(db.doc(path).set({ score: 1 }));
    await assertSucceeds(db.doc(path).set({ score: 10 }));
    for (const bad of [0, 11, 5.5, -3, '7', null, true]) {
      await assertFails(db.doc(path).set({ score: bad }));
    }
    await assertFails(db.doc(path).set({ note: 'no score' }));
  });

  test('mood note is a string of at most 500 characters; no extra fields; day id must be a date', async () => {
    const db = as(HER);
    const path = `users/${HER}/moods/2026-12-02`;
    await assertSucceeds(db.doc(path).set({ score: 5, note: 'n'.repeat(500) }));
    await assertFails(db.doc(path).set({ score: 5, note: 'n'.repeat(501) }));
    await assertFails(db.doc(path).set({ score: 5, note: 12 }));
    await assertFails(db.doc(path).set({ score: 5, hidden: 'x' }));
    await assertFails(db.doc(`users/${HER}/moods/not-a-day`).set({ score: 5 }));
  });

  test('entry text is a string of 1 to 200000 characters, day is YYYY-MM-DD, createdAt a number', async () => {
    const db = as(HER);
    await assertSucceeds(db.doc(`users/${HER}/entries/big`).set(entry({ text: 'x'.repeat(200000) })));
    await assertFails(db.doc(`users/${HER}/entries/toobig`).set(entry({ text: 'x'.repeat(200001) })));
    await assertFails(db.doc(`users/${HER}/entries/empty`).set(entry({ text: '' })));
    await assertFails(db.doc(`users/${HER}/entries/num`).set(entry({ text: 5 })));
    await assertFails(db.doc(`users/${HER}/entries/day1`).set(entry({ day: '5 Nov 2026' })));
    await assertFails(db.doc(`users/${HER}/entries/day2`).set(entry({ day: 20261105 })));
    await assertFails(db.doc(`users/${HER}/entries/time`).set(entry({ createdAt: 'now' })));
    await assertFails(db.doc(`users/${HER}/entries/extra`).set(entry({ admin: true })));
    const noDay = entry();
    delete noDay.day;
    await assertFails(db.doc(`users/${HER}/entries/noday`).set(noDay));
  });

  test('draft text is a string of at most 200000 characters', async () => {
    const db = as(HER);
    await assertSucceeds(db.doc(`users/${HER}/drafts/current`).set({ text: '' }));
    await assertFails(db.doc(`users/${HER}/drafts/current`).set({ text: 'x'.repeat(200001) }));
    await assertFails(db.doc(`users/${HER}/drafts/current`).set({ text: 9 }));
    await assertFails(db.doc(`users/${HER}/drafts/current`).set({ text: 'x', extra: 1 }));
  });
});

describe('config and everything else', () => {
  test('members can read config/members', async () => {
    await assertSucceeds(as(HER).doc('config/members').get());
    await assertSucceeds(as(HIS).doc('config/members').get());
  });

  test('no client can write config/members', async () => {
    const next = { uids: [HER, HIS, STRANGER], doors: { hers: HER, his: HIS }, names: { hers: 'a', his: 'b' } };
    await assertFails(as(HER).doc('config/members').set(next));
    await assertFails(as(HIS).doc('config/members').update({ uids: [HIS] }));
    await assertFails(as(HER).doc('config/members').delete());
    await assertFails(as(STRANGER).doc('config/members').set(next));
    await assertFails(anon().doc('config/members').set(next));
  });

  test('other documents and collections are denied even to members', async () => {
    await assertFails(as(HER).doc('config/other').get());
    await assertFails(as(HER).doc('stray/doc').get());
    await assertFails(as(HER).doc('stray/new').set({ x: 1 }));
    await assertFails(as(HER).doc(`users/${HER}`).get());
    await assertFails(as(HER).doc(`users/${HER}/secrets/s1`).set({ x: 1 }));
  });

  test('unauthenticated reads and writes are denied everywhere', async () => {
    const db = anon();
    await assertFails(db.doc('config/members').get());
    await assertFails(db.doc(`users/${HER}/moods/${DAY}`).get());
    await assertFails(db.doc(`users/${HER}/moods/2026-11-09`).set(mood()));
    await assertFails(db.doc(`users/${HER}/entries/e1`).get());
    await assertFails(db.doc(`users/${HER}/entries/e7`).set(entry()));
    await assertFails(db.doc(`users/${HER}/drafts/current`).get());
    await assertFails(db.collection('notes').get());
    await assertFails(db.doc('notes/anon').set(note(HER, 'hers')));
    await assertFails(db.doc('notes/herNote').delete());
    await assertFails(db.doc('stray/doc').get());
  });
});

describe('hardening', () => {
  test('a missing config/members refuses everything, even to the former members', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().doc('config/members').delete(); });
    const db = as(HER);
    await assertFails(db.doc(`users/${HER}/moods/${DAY}`).get());
    await assertFails(db.doc(`users/${HER}/entries/e3`).set(entry()));
    await assertFails(db.collection('notes').get());
    await assertFails(db.doc('notes/n9').set(note(HER, 'hers')));
    await assertFails(db.doc('config/members').get());
    await assertFails(db.doc('notes/herNote').delete());
  });

  test('collection-group queries are refused, even for members', async () => {
    await assertFails(as(HER).collectionGroup('entries').get());
    await assertFails(as(HER).collectionGroup('moods').get());
    await assertFails(as(HER).collectionGroup('notes').get());
    await assertFails(anon().collectionGroup('entries').get());
  });

  test('listing the users or config collections is refused', async () => {
    await assertFails(as(HER).collection('users').get());
    await assertFails(as(HER).collection('config').get());
    await assertFails(as(STRANGER).collection('users').get());
    await assertFails(anon().collection('config').get());
  });

  test('a stranger cannot delete a note', async () => {
    await assertFails(as(STRANGER).doc('notes/herNote').delete());
    await assertFails(anon().doc('notes/hisNote').delete());
  });

  test('a note dated far in the future is refused; a little ahead or long ago is fine', async () => {
    const db = as(HER);
    await assertFails(db.doc('notes/future1').set(note(HER, 'hers', { createdAt: Date.now() + 10 * 60 * 1000 })));
    await assertFails(db.doc('notes/future2').set(note(HER, 'hers', { createdAt: Date.now() + 365 * 24 * 3600 * 1000 })));
    await assertSucceeds(db.doc('notes/near').set(note(HER, 'hers', { createdAt: Date.now() + 60 * 1000 })));
    await assertSucceeds(db.doc('notes/old').set(note(HER, 'hers', { createdAt: 5 })));
  });

  test('a draft at any id other than current is refused', async () => {
    const db = as(HER);
    await assertFails(db.doc(`users/${HER}/drafts/other`).set({ text: 'x' }));
    await assertFails(db.doc(`users/${HER}/drafts/current2`).set({ text: 'x' }));
    await assertSucceeds(db.doc(`users/${HER}/drafts/current`).set({ text: 'x' }));
  });
});
