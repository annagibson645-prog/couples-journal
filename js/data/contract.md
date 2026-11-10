# Data interface

Every screen talks to `data` from `js/data/index.js`, never to an adapter directly.
`demo.js` implements it over `localStorage` (Phase A). `firebase.js` will implement the
same methods (Phase B). All methods act on the signed-in person's own journal only.
`Session = { uid, door: 'hers' | 'his' }`.

```
signIn(door: 'hers'|'his', credentials?: {email,password}): Promise<Session>
signOut(): Promise<void>
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
listenNotes(cb: (notes: Array<{id,authorDoor,text,createdAt,source?:'entry'}>) => void): () => void
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
  `listenNotes` calls back immediately and again after every change; call the returned
  function to stop.
- **Drafts:** `saveDraft`/`getDraft` hold one unsent writing-box text per person, so a
  half-written entry survives a reload or leaving the screen. `saveDraft` never rejects
  because of a storage problem (keep the draft in memory for the visit instead) and
  `signOut` clears drafts with the rest of the local data. Saving an entry is followed
  by `saveDraft('')` from the screen. Drafts are plain text, any length.
- **Ids** are opaque strings; `createdAt` is epoch milliseconds.
