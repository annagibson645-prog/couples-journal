# Data interface

Every screen talks to `data` from `js/data/index.js`, never to an adapter directly.
`demo.js` implements it over `localStorage` (Phase A). `firebase.js` implements the
same methods over Firebase Auth and Cloud Firestore (Phase B). `tests/adapter-contract.test.js`
runs one behaviour suite against both. All methods act on the signed-in person's own journal only.
`Session = { uid, door: 'hers' | 'his' }`.

```
ready(): Promise<void>                                       // resolves once a sign-in from an earlier visit is restored (the demo resolves at once); the app waits for it before opening any door
signIn(door: 'hers'|'his', credentials?: {email,password}): Promise<Session>   // firebase: `session.door` is the door config/members gives that login, NOT the door asked for (His's login on the Hers form gives door 'his'); a login not in config/members is refused
signOut(opts?: { force?: boolean }): Promise<{ wiped: boolean, unsynced: boolean }>   // never rejects; see "Sign-out result" below
currentSession(): Session|null
getMembers(): Promise<{ names:{hers,his}, doors:{hers,his} }>
saveMood(day: string, score: number, note?: string): Promise<void>
getMoods(): Promise<Record<string,{score:number,note?:string}>>
addEntry(text: string, now?: Date): Promise<string>
listEntries(): Promise<Array<{id,day,text,createdAt}>>      // newest first
deleteEntry(id: string): Promise<void>
saveDraft(text: string): Promise<void>                       // the unsent writing box; '' removes it
getDraft(): Promise<string>                                   // '' when there is none
addNote(text: string, opts?: { source?: 'entry' }): Promise<string>  // `source: 'entry'` marks a note sent from a journal entry: the adapter MUST store it on the note and return it from listenNotes; any other value is ignored. The note's author (`authorDoor`) is fixed when `addNote` is called, not when the write resolves. Also: stored as given by the adapter; the screen trims it at the ends (the demo adapter does not)
listenNotes(cb: (notes: Array<{id,authorDoor,text,createdAt,source?:'entry'}>) => void, onError?: (err: Error) => void): () => void   // `onError` gets a friendly Error on permission-denied or a network failure; the demo never calls it
deleteNote(id: string): Promise<void>                      // rejects for a note the signed-in person did not write
```

## Rules both adapters follow

- **Notes has no login of its own.** `signIn` is only ever called with `'hers'` or `'his'`;
  a signed-out person who opens Notes is sent to the Hers sign-in (with a link to His)
  and returns to Notes afterwards. Any other door is rejected.
- **Signed out means no data.** Every method except `signIn`, `currentSession`,
  `getMembers` and `signOut` rejects (or throws) when there is no session.
- **`signOut` clears local state.** It ends the session and empties the per-person
  journal data held in memory on this device. The demo adapter also deletes every
  `journal-demo:` key, which resets the sample data; the Firebase adapter clears its
  device cache.
- **Days are local.** `day` is a `YYYY-MM-DD` key in local time (`dayKey`), so an entry
  at 11:30 pm belongs to that evening.
- **Moods:** one integer 1-10 per day plus an optional note; saving a day again
  replaces it. An invalid score or day rejects and stores nothing.
- **Text is plain text.** Entries and notes are stored and returned exactly as typed
  (blank text is rejected). Render with `textContent` or `escapeText`, never `innerHTML`.
- **Ordering:** `listEntries` and the arrays passed to `listenNotes` are newest first.
  `listenNotes` calls back with the current notes (at once in the demo; once loaded in firebase)
  and again after every change; call the returned function to stop.
- **Drafts:** `saveDraft`/`getDraft` hold one unsent writing-box text per person, so a
  half-written entry survives a reload or leaving the screen. `saveDraft` never rejects
  because of a storage problem (keep the draft in memory for the visit instead) and
  `signOut` clears drafts with the rest of the local data. Saving an entry is followed
  by `saveDraft('')` from the screen. Drafts are plain text, any length.
- **Ids** are opaque strings; `createdAt` is always a finite number of epoch milliseconds
  (the firebase adapter writes the client time and substitutes the current time for a missing value).
- **Friendly errors only.** Anything shown to a person is a plain sentence. The firebase adapter
  maps wrong password, unknown user, too many tries, offline and permission errors to sentences and
  never exposes a Firebase code or message. Nothing logs credentials, tokens or document contents.
- **Sign-out result.** `signOut` always resolves `{ wiped, unsynced }`.
  - `{ wiped: true, unsynced: false }`: signed out and the device is clean (the demo always returns this and ignores `force`).
  - `{ wiped: false, unsynced: true }`: firebase only. Some writing has not reached the server yet and `force`
    was not given, so NOTHING was changed (still signed in). Words for the UI: "Some of your writing has not
    been saved online yet. Signing out now will discard it. Sign out anyway?" Confirming calls `signOut({ force: true })`,
    which wipes anyway and returns `unsynced: true`.
  - `{ wiped: false, unsynced: false }`: signed out, but the device copy could not be cleared (another tab of the
    journal has it open). Words for the UI: "Close the journal's other tabs, then sign out again."
  Existing callers ignore the result and keep working; the router will use it when the live login is wired.
- **Session lost.** The firebase adapter takes an optional `onSessionLost()` callback. If Firebase Auth becomes
  signed-out while this tab still holds a session (another tab signed out, the account was removed), the adapter
  clears its session and listeners and calls it once. The app will reload there when the live login is wired.
- **Firebase sign-out** also ends Firebase Auth, empties the Firestore offline cache (`terminate()` then
  `clearIndexedDbPersistence()`), removes the unsent draft from the person's cloud copy, and builds a fresh
  app and database for the next sign-in under the same fixed app name (`journal`). It never rejects. Unsynced
  offline writes are discarded only when the person confirms (`force`).
- **Limits** (the rules enforce them too): entry text up to 200,000 characters, a note 1-2,000, a mood note up
  to 500. The firebase adapter checks them first and says so in plain words.
- **Extra on the firebase adapter only:** `sendPasswordReset(email)` (never reveals whether an account exists).
- **Writes while offline** do not freeze the screen: after a few seconds the call resolves and the write stays
  queued in the device cache until the connection returns; a refused write rejects at once.
