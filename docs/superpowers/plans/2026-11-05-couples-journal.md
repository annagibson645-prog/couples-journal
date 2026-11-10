# Couples Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free, private two-person journal site (separate private journals, daily mood, shared Notes, readable exports) on GitHub Pages with Firebase behind it. **Front end is built and published first, running on sample data; the backend is connected afterward.**

**Architecture:** Static site, vanilla ES modules, no build step. Every screen talks to a small **data interface** (`js/data/`). Phase A ships a **demo adapter** (sample data held in the browser) so the whole front end works with no backend. Phase B adds a **Firebase adapter** behind the same interface, plus server rules, so no screen code changes. Pure logic is tested with Node's built-in runner; rules are tested on the Firebase Emulator.

**Tech Stack:** HTML/CSS/JS (ES modules), Firebase Web SDK v10 modular (CDN, pinned; Phase B), jsPDF and docx (CDN, pinned, loaded on demand), Node 20+ with `node --test`, `firebase-tools` + `@firebase/rules-unit-testing` (Phase B).

**Spec:** `docs/superpowers/specs/2026-11-05-couples-journal-design.md`

**Design reference:** the private design canvas (not published). Build from its boards: `Main` (front page), `SignIn`, `Today`, `LookBack`, `Save`, `Notes` and their `His…` twins. Each board's markup, colours and copy are the target; the canvas versions use fake data.

## Global Constraints
- Free only: GitHub Pages + Firebase free tier. No paid services, no Netlify.
- Public code-only repo. **No real journal text ever committed**; sample data is invented.
- Demo mode is not secure and says so: a visible banner "Sample mode — entries stay on this device only and aren't private or backed up", and the demo seed contains only invented content.
- Mood = one integer 1–10 per day + optional note. No extra scores.
- Exports: readable first (PDF, .docx, .md, .txt); JSON backup only under a collapsed "Advanced" section. No direct Google Docs send; show the two-step Drive instructions beside the .docx button.
- Each person exports only their own data.
- Final privacy text in app: not end-to-end encrypted; the Firebase project owner can view data in the console; no analytics or trackers.
- CDN scripts use exact pinned versions.
- Look: **Orbital sigils**. Fonts Fraunces (italic headings), Newsreader (text), JetBrains Mono (small labels). Dark: bg `#0e0d14`, text `#eae6f5`, Hers `#f472b6`, His `#60a5fa`, Notes `#b18cf0`. Light: bg `#f0ead8`, text `#2c1f0e`, Hers `#a8316a`, His `#2f5aa3`, Notes `#6a45b3`. Every page has a Light/Dark switch, remembered per device. Usable at phone width (front-page columns stack Hers, Notes, His). Rings and glow stop under `prefers-reduced-motion`.
- Mood scale is ten moon phases (1 = new moon, 10 = full moon), drawn by one shared function, used on Today, the calendar and the chart.
- **Spec amendment:** `config/members` also holds `doors: { hers: uid, his: uid }` and `names: { hers, his }`.

## Data interface (shared by both adapters)
Defined in `js/data/contract.md` and implemented by `js/data/demo.js` (Phase A) and `js/data/firebase.js` (Phase B). `js/data/index.js` exports `data`, chosen by `MODE` in `js/config.js` (`'demo' | 'firebase'`).

```
signIn(door: 'hers'|'his'|'notes', credentials?: {email,password}): Promise<Session>
signOut(): Promise<void>                      // also clears locally cached data
currentSession(): Session|null                // Session = { uid, door: 'hers'|'his' }
getMembers(): Promise<{ names:{hers,his}, doors:{hers,his} }>
saveMood(day: string, score: number, note?: string): Promise<void>
getMoods(): Promise<Record<string,{score:number,note?:string}>>
addEntry(text: string, now?: Date): Promise<string>
listEntries(): Promise<Array<{id,day,text,createdAt}>>   // newest first
deleteEntry(id: string): Promise<void>
addNote(text: string): Promise<string>
listenNotes(cb: (notes: Array<{id,authorDoor,text,createdAt}>) => void): () => void
deleteNote(id: string): Promise<void>
```
All methods act on the signed-in person's own journal only.

## Review Focus
1. **Timezone:** an entry at 11:30 pm local time belongs to that local day, not the next UTC day (Task 2).
2. **Empty states:** a brand-new journal, a mood-only day, and an entry-only day render and export cleanly; an empty export says so rather than producing a blank file (Tasks 5, 6).
3. **Awkward text:** emoji, Markdown symbols, `<script>`, quotes and 10,000+ characters render safely (no HTML injection) and export intact in all four formats (Tasks 4, 6).
4. **Shared device:** `signOut` clears locally cached journal data so the other person cannot read it from the same browser (Tasks 3, 10).
5. **Wrong door:** a signed-in person clicking the other's door sees a friendly locked message, not an error or blank page (Task 3).

---

# PHASE A — Front end on sample data

### Task 1: Scaffold, themes, three-door front page

**Files:** Create `index.html`, `css/theme.css`, `css/layout.css`, `css/sigil.css`, `js/app.js`, `js/config.js`, `js/lib/sigil.js`, `package.json`, `.gitignore`, `README.md`; Test `tests/smoke.test.js`, `tests/sigil.test.js`

**Interfaces:** Produces `showScreen(name: 'front'|'signin'|'today'|'lookback'|'save'|'notes', who?: 'hers'|'his'): void` in `js/app.js`; CSS variables `--bg --fg --muted --line --acc --accrgb` for `:root[data-theme="dark"|"light"]` and per person (`[data-who="hers"|"his"|"notes"]`); `MODE` in `js/config.js` (default `'demo'`); script `"test": "node --test tests/"`. In `js/lib/sigil.js`: `tickPath(n: number, long: boolean): string` (SVG path of tick marks around a 200-unit circle; every fifth tick is long), `dotPath(n: number): string` (round dots on a ring), `moonPath(p: number): string` (SVG path for a moon with fraction lit `p` from 0 new to 1 full, 38-unit box). The sigil rings are drawn by `css/sigil.css` and the paths above, matching the canvas `Main` board.

- [ ] **Step 1:** `git init`; add `.gitignore` (node_modules, .firebase, firebase-debug.log) and `package.json` (type: module, test script).
- [ ] **Step 2:** Write `tests/smoke.test.js` asserting `index.html` has three links `data-door="hers"`, `data-door="notes"`, `data-door="his"` in that order, a viewport meta tag, a theme switch button, and the sample-mode banner element. Write `tests/sigil.test.js`: `tickPath(60, false)` has 48 segments and `tickPath(60, true)` has 12; `dotPath(16)` has 16 points; `moonPath(0)` encloses no area (new moon) and `moonPath(1)` is a full circle.
- [ ] **Step 3:** Run `npm test`. Expected: FAIL.
- [ ] **Step 4:** Build `sigil.js` and `sigil.css` to the tests, then the front page to match the canvas `Main` board: three full-height columns (middle wider) with a glowing symbol inside turning rings (outer ring, tick ring, dashed ring; Notes also gets a dot ring), a small label, a big italic name, a short rule and one line of text. Symbols: flower (Hers), star (His), two overlapping circles with a heart (Notes). Add the Light/Dark switch (choice stored in `localStorage` inside try/catch) and the sample-mode banner shown whenever `MODE === 'demo'`. Dark mode shows faint stars and an occasional shooting star; light mode shows none.
- [ ] **Step 5:** Run `npm test`. Expected: PASS. Check at 375px width: no horizontal scroll. Commit `feat: scaffold and front page`.

### Task 2: Date and mood logic (pure)

**Files:** Create `js/lib/days.js`, `js/lib/moodlogic.js`; Test `tests/days.test.js`, `tests/moodlogic.test.js`

**Interfaces:** Produces
- `dayKey(date: Date): string` → local `YYYY-MM-DD`.
- `isValidScore(n: unknown): boolean` → integers 1–10 only.
- `moodSeries(moods, from: string, to: string): Array<{day:string, score:number|null}>` → one point per day, inclusive, `null` where no mood.
- `buildCalendar(year: number, month: number, moods): Array<Array<{day:string|null, score:number|null}>>` → weeks of 7, Monday first, `day: null` padding.

- [ ] **Step 1:** Failing tests: `dayKey(new Date(2026, 10, 5, 23, 30))` is `'2026-11-05'`; `isValidScore` rejects 0, 11, 5.5, `"5"`, null; `moodSeries` gaps are `null`; `buildCalendar(2026, 11, …)` has correct padding and 30 real days; Feb 2028 has 29.
- [ ] **Step 2:** Run (FAIL), implement with local-date getters (never `toISOString`), run (PASS). Commit `feat: day and mood logic`.

### Task 3: Demo data adapter and door gating

**Files:** Create `js/data/contract.md`, `js/data/index.js`, `js/data/demo.js`, `js/data/sample-seed.js`, `js/doors.js`, `js/lib/escape.js`; Modify `js/app.js`; Test `tests/doors.test.js`, `tests/demo.test.js`

**Interfaces:** Consumes the data interface above and `dayKey`/`isValidScore`. Produces `doorFor(uid: string, members): 'hers'|'his'|null` and `canOpen(door: 'hers'|'his'|'notes', session: Session|null): boolean` (pure; notes open for either signed-in person, hers/his only for their owner); `escapeText(s: string): string`.

- [ ] **Step 1:** Failing tests. `doors.test.js`: owner opens own door; refused the other's; notes open for both; signed-out refused all. `demo.test.js` (with an in-memory `localStorage` stub): mood saves and updates the same day (one record); invalid score rejected; entry at local 23:30 lands on that local day; two entries same day both listed; `<script>alert(1)</script>` round-trips as plain text; `signOut` empties the demo store.
- [ ] **Step 2:** Run (FAIL). Implement `doors.js`, `escape.js`, and `demo.js` (data in `localStorage` per door, seeded on first run from `sample-seed.js`: about 30 days of invented moods and a few invented entries and notes for each of two sample people named "Hers"/"His"). Run (PASS).
- [ ] **Step 3:** Build the sign-in screen to match the canvas `SignIn` board (person's symbol on the left, email and password on the right, "Open Hers"/"Open His", "Forgot your password?", back to the front page). In demo mode the button signs in with one click and the screen is labelled "Sample sign-in". A signed-in person clicking the other's column sees "This journal is private." with a back link.
- [ ] **Step 4:** Manual check: open hers, try his (friendly lock), sign out, reload (sample data resets or clears as designed). Commit `feat: demo data adapter and door gating`.

### Task 4: Journal Today screen

**Files:** Create `js/screens/today.js`, `css/journal.css`; Modify `js/app.js`

**Interfaces:** Consumes `data.saveMood/getMoods/addEntry/listEntries/deleteEntry`, `dayKey`, `escapeText`.

- [ ] **Step 1:** Build to match the canvas `Today` board (rail with symbol, name and section links; ten moon buttons for the mood with a word for the choice, e.g. 7 = "Mostly bright"; optional few words; writing box; "Save entry"; "Saved on this device, then synced"), plus a past-entries list with delete (confirm). The mood is editable all day. Render text only via `textContent`/`escapeText`. Empty state: "Nothing here yet — write whenever you're ready."
- [ ] **Step 2:** Manual check with seeded data at phone width, both themes; paste emoji, `<b>`, and a 10,000-character entry and confirm they display as typed. Commit `feat: journal today screen`.

### Task 5: Mood chart and look-back

**Files:** Create `js/screens/chart.js`, `js/screens/lookback.js`, `css/chart.css`

**Interfaces:** Consumes `moodSeries`, `buildCalendar`, `data.getMoods/listEntries`. Produces `renderChart(host: HTMLElement, series): void` (SVG line, gaps for `null`, point click dispatches `CustomEvent('daypick', {detail:{day}})`) and `renderLookback(host, year, month, moods, entries): void` with prev/next month; tapping a day shows its mood, note and entries.

- [ ] **Step 1:** Implement chart (hand-drawn SVG, no library, with a screen-reader text list of values) and calendar tinted by score. Empty journal shows a gentle prompt.
- [ ] **Step 2:** Manual check on seeded data: gaps, tap-to-open-day, a mood-only day, an entry-only day, a leap-year February. Commit `feat: mood chart and look-back`.

### Task 6: Exports

**Files:** Create `js/lib/exportmodel.js`, `js/lib/formats.js`, `js/screens/export.js`; Test `tests/exportmodel.test.js`, `tests/formats.test.js`

**Interfaces:** Produces
- `buildExportModel(moods, entries): Array<{day:string, score:number|null, note:string|null, entries:Array<{time:string,text:string}>}>` (days with a mood or entry, oldest first).
- `toMarkdown(model, title: string): string`, `toText(model, title: string): string`, `toJson(model): string`.
- `toPdf(model, title): Promise<Blob>` (jsPDF, pinned CDN) and `toDocx(model, title): Promise<Blob>` (docx, pinned CDN), loaded on demand.
- Empty model → each formatter returns a short "No entries yet" document.

- [ ] **Step 1:** Failing tests: model merges mood-only, entry-only and both-days, oldest first; `toMarkdown`/`toText` keep `# * _ <script>` and emoji intact; a 12,000-character entry survives unchanged; empty model gives the "No entries yet" text.
- [ ] **Step 2:** Run (FAIL), implement, run (PASS).
- [ ] **Step 3:** Implement `toPdf`, `toDocx` and the screen: buttons in order PDF, Word, Markdown, Text; beside Word: "Open in Google Docs: upload it to Google Drive, then open with Docs."; "Advanced: backup file" collapsed with an explanation that it is for safekeeping.
- [ ] **Step 4:** Verify by hand on sample data: open the PDF, the .docx (Word or LibreOffice, and via Drive), the .md and .txt. Commit `feat: readable exports`.

### Task 7: Shared Notes (sample mode)

**Files:** Create `js/screens/notes.js`; Test `tests/notes.test.js`

**Interfaces:** Consumes `data.addNote/listenNotes/deleteNote`, `getMembers().names`.

- [ ] **Step 1:** Failing tests on the demo adapter: a note appears for both people with the right author; a person cannot delete the other's note; whitespace-only note rejected.
- [ ] **Step 2:** Run (FAIL), implement in `demo.js`, run (PASS).
- [ ] **Step 3:** Build the feed UI to match the canvas `Notes` board: composer at the top ("Leave note"), the viewer's own notes on the right with a Delete link, the other person's on the left, author colours pink (Hers) and blue (His), rendered via `textContent`. Commit `feat: shared notes (sample mode)`.

### Task 7b: No-login sample mode (added at the user's request)

The user wants to show the published sample site to the friend with no login. In sample mode (`MODE === 'demo'`) there is nothing to sign in to.

**Files:** Modify `js/app.js`, `js/router.js`, `js/screens/signin.js`, `js/screens/rail.js`, `js/screens/notes.js`, `index.html`, `css/layout.css`, `css/notes.css`; Test `tests/sample-mode.test.js` (plus extensions to existing screen tests)

**Interfaces:** Consumes `data.signIn('hers'|'his')`, `data.signOut()`, `MODE` from `js/config.js`, `gateFor`/`canOpen` from `js/doors.js`. Produces: in demo mode, clicking the Hers or His column signs that person in automatically and opens Today; clicking Notes signs in as Hers and opens Notes with a viewer switch; in firebase mode everything behaves as before (sign-in screen, gating).

- [ ] **Step 1:** Write failing tests: in demo mode a front-page column opens its journal with no sign-in screen (Hers, His); Notes opens signed in as Hers; the Notes viewer switch signs in as the other person without wiping sample data (moods, entries and notes still there, His's own notes now on the right with Delete); in firebase mode the sign-in screen and the "This journal is private." gate still appear; the rail's "Sign out" in demo mode becomes "Back to the three doors" and does not wipe data.
- [ ] **Step 2:** Implement the demo-mode path through the router: auto sign-in for the chosen column, no sign-in screen shown. Keep `signin.js` and its tests for firebase mode. The sample-mode banner stays; add a small "Reset sample data" button in the banner that asks for confirmation ("Reset the sample data on this device?" Yes / No), clears every `journal-demo:` key, reseeds, and returns to the front page.
- [ ] **Step 3:** Add the Notes viewer switch to the Notes screen (demo mode only): a button "Seen from Hers. Switch to His" / "Seen from His. Switch to Hers" that signs in as the other person with `data.signIn` (never `signOut`), re-subscribes the feed without double subscriptions, and keeps focus on the button.
- [ ] **Step 4:** Check in a browser at 375px and 1280px in both themes: every column opens straight in; Today, Look back, Save, Notes all work as both people; switching the Notes viewer shows each side's notes; Reset sample data works; no console errors. Commit `feat: no-login sample mode`.

### Task 7e: Notes as a thread of light (the user's chosen design)

**Files:** Modify `js/screens/notes.js`, `js/lib/notes.js` (day labels), `css/notes.css`, `index.html` (the Notes markup), the built `css/app.css`; Create `js/started.js`; Test `tests/notes-screen.test.js` (extend), `tests/notes.test.js` (extend), `tests/build.test.js` (extend)

**Interfaces:** Consumes the Notes data interface unchanged (`addNote`, `listenNotes`, `deleteNote`). Produces: the feed as a vertical glowing thread with day separators and per-note dots; `dayLabel(createdAt: number, now: number): string` in `js/lib/notes.js` returning "Today", "Yesterday" or a long date like "31 October" (local calendar days, timezone-safe); `js/started.js` which only sets `globalThis.__journalStarted = true`.

- [ ] **Step 1:** Write failing tests: `dayLabel` for today, yesterday, an older date and across midnight and the autumn clock change (TZ pinned); the feed renders a day separator whenever the local day changes and none between two notes of the same day; own notes right and the other person's left; each note has a dot in its author's colour; every behaviour already tested for Notes still passes (2,000-character limit, duplicate-send guard, listener lifecycle, delete confirm and focus, live regions, viewer switch in demo mode, textContent only, the scroll-yank rule and the "New note" button).
- [ ] **Step 2:** Build the thread to match the design board `NotesThread` (central glowing line, day separators, author-coloured dots with a slow pulse that stops under reduced motion, cards with the author's tint, composer pinned at the bottom). At phone width (under 760px) the thread collapses to one column with the line on the left edge; notes are never wider than the screen; targets stay at least 44px. Both themes.
- [ ] **Step 3:** Cache-safety for the start signal: add `js/started.js` (sets `globalThis.__journalStarted = true`) and make the generated `js/boot.js` import it right after `./app.js` (so the flag no longer depends on app.js, which a returning visitor may still have cached for up to 10 minutes); keep the flag in app.js too; update the build and its drift test.
- [ ] **Step 4:** Check in a browser at 375px and 1280px, both themes, as Hers and His (use the viewer switch): sample notes across several days, a long note, an emoji note, no console errors, no horizontal scroll. Commit `feat: notes as a thread of light`.

### Task 7c: Send part of an entry to the other person (the friend's request)

**Files:** Modify `js/screens/today.js`, `js/screens/lookback.js`, `js/screens/notes.js`, `js/screens/shared.js` (shared entry-actions helper if needed), `js/data/demo.js`, `js/data/contract.md`, `js/lib/notes.js`, `index.html`, `css/journal.css`, `css/notes.css`, built `css/app.css` and `js/boot.js` (via `node scripts/build.mjs`); Create `js/screens/send-sheet.js`, `js/lib/send.js`; Test `tests/send.test.js`, `tests/send-sheet.test.js`, extend `tests/demo.test.js`, `tests/notes-screen.test.js`, `tests/today-screen.test.js`, `tests/lookback-screen.test.js`

**Interfaces:** Consumes `data.addNote`, the viewer's door (`session.door`). Produces: `addNote(text: string, opts?: { source?: 'entry' }): Promise<string>` (the adapter stores `source` on the note; any other value is ignored; the contract documents that the Firebase adapter must carry it); notes returned by `listenNotes` may carry `source: 'entry'`; `js/lib/send.js`: `initialSendText(entryText: string, selectedText: string): string` (the selection if it is non-empty after trimming and is part of the entry, else the whole entry), `sendState(text: string, limit = 2000): { count: number, over: boolean, empty: boolean, canSend: boolean }`, `sendLabel(door: 'hers'|'his'): 'Send to him'|'Send to her'`, `sourceLabel(authorDoor): 'From her journal'|'From his journal'`; `js/screens/send-sheet.js`: `createSendSheet({ data, doc, getViewerDoor, onSent })` with `open(entryText, triggerEl, selectedText?)`, `close()`, `clear()`.

- [ ] **Step 1:** Write failing tests: the pure helpers (selection used only when it is part of the entry; counter counts UTF-16 length like the Notes composer; over-limit and whitespace-only cannot send); the demo adapter stores and returns `source: 'entry'` and ignores other values; Notes shows the "From her/his journal" label on such notes only; the sheet (fake DOM): opens with the entry text (or the selection), focus moves into the dialog, Tab stays inside, Escape and Cancel close it and return focus to the button that opened it, "Send to Notes" calls `addNote(text.trim(), { source: 'entry' })` exactly once even on double click or Enter repeat, over the limit or empty disables Send with a clear message, an adapter error shows a friendly alert and keeps the text, success closes the dialog, announces "Sent to him. It's in Notes." in a polite live region, and the original entry is unchanged, `clear()` empties the text on sign-out or leaving, nothing is ever set with innerHTML.
- [ ] **Step 2:** Build the sheet to match the design board `TodaySend`: a modal dialog (role="dialog", aria-modal, labelled by its title, focus trap) with the title "Send to him"/"Send to her", the intro "Keep only the words you want him to read, then send. They appear in Notes, where only the two of you can see them. Your journal stays private, and the original entry doesn't change.", a labelled textarea "What will be sent", a live counter "141 of 2,000 characters" and the line "You can take it back later from Notes.", buttons Cancel and "Send to Notes"; under 760px it is a bottom sheet with the textarea at least 16px, never wider than the screen, usable above the on-screen keyboard (no 100vh), tap targets at least 44px, both themes, reduced motion respected.
- [ ] **Step 3:** Add the "Send to him/her" button to each entry on Today and in the Look back day panel (next to Read more and Delete); if the person has selected text inside that entry's text, the dialog starts with just the selection. Wire `data.addNote(..., { source: 'entry' })`; add the "From her/his journal" label to the Notes card header; update `contract.md`.
- [ ] **Step 4:** Check in a browser at 375px and 1280px, both themes, as Hers and as His (viewer switch): send a whole entry, send a selection, try an over-limit entry (50,000 characters) and trim it, cancel, Escape, an error path, then see the note appear in Notes with its label and take it back with Delete; no console errors, no horizontal scroll. Commit `feat: send part of an entry to the other person`.

### Task 7d: Dictation (the friend's request)

**Files:** Create `js/lib/dictation.js`, `js/screens/dictation.js`; Modify `js/screens/today.js`, `js/screens/notes.js`, `js/router.js` or the places that call `clear()`, `index.html`, `css/journal.css`, `css/notes.css`, built `css/app.css` and `js/boot.js` (via `node scripts/build.mjs`); Test `tests/dictation.test.js`, `tests/dictation-ui.test.js`, extend `tests/today-screen.test.js`, `tests/notes-screen.test.js`

**Interfaces:** Produces `js/lib/dictation.js`: `speechSupport(win): { available: boolean, reason?: 'insecure'|'unsupported' }` (uses `win.SpeechRecognition || win.webkitSpeechRecognition` and `win.isSecureContext`), `insertAtCaret(value: string, selStart: number, selEnd: number, heard: string): { value: string, caret: number }` (adds exactly one space between existing text and the heard words when needed, never doubles spaces, replaces a selection, keeps the caret after the inserted words), `describeError(code: string): { message: string, retry: boolean }` (maps `not-allowed`/`service-not-allowed` to a microphone-blocked message, `audio-capture` to no microphone, `network` to needs-a-connection, `no-speech` to silent retry, others to a generic message), `restartDelay(attempt: number): number` (growing back-off, capped) ; `js/screens/dictation.js`: `createDictation({ win, area, button, previewEl, statusEl, alertEl, storage, onChange })` with `start()`, `stop()`, `clear()`, `isListening()`.

- [ ] **Step 1:** Write failing tests: the pure helpers above; with a fake SpeechRecognition object driving events: it never starts without a click; the first use shows the privacy confirm and starts only after the person chooses Start, and remembers the choice (localStorage in try/catch, memory fallback); interim results go to the preview line only, final results are inserted at the caret and an `input` event is dispatched so the word count, auto-grow and draft saving update; it auto-restarts when the engine ends while the person has not pressed Stop, with back-off and a cap on consecutive failures; each error maps to its plain message and `no-speech` restarts quietly; it stops on Stop, on leaving the screen, sign-out, viewer switch and `visibilitychange` to hidden; the button is hidden when `speechSupport` says unavailable; all text via textContent/value only; nothing is logged or stored (no transcripts anywhere but the textarea).
- [ ] **Step 2:** Build the button and states for Today and Notes: a round microphone button next to Save entry / Leave note (at least 44px, `aria-pressed`, labels "Dictate" and "Stop dictating", a pulsing dot while listening that stops under reduced motion), a polite status line ("Listening", "Stopped"), a preview line "Hearing: ..." under the box, errors in `role="alert"`, the privacy confirm ("Dictation sends your voice to your browser's speech service: Google for Chrome, Apple for Safari. This site doesn't record or keep it. Start dictating?" with Start and Not now), both themes, phone layout (button and Save/Leave note fit at 343px), nothing newer than iOS 14 without a fallback.
- [ ] **Step 3:** Wire `clear()`/`stop()` into the same places the screens already clear typed text (router navigation, sign-out, viewer switch, reset). Never start on screen show.
- [ ] **Step 4:** Check in a browser at 375px and 1280px, both themes, with a fake engine injected through the page (the headless browser has no microphone): start, interim and final results, pause and restart, each error, Stop, leaving the screen mid-dictation, hidden page; plus the unsupported case (button hidden). Commit `feat: dictation`.

### Task 8: Publish the front end to GitHub Pages

**Files:** Modify `README.md`

- [ ] **Step 1:** Run `npm test`. Expected: all PASS. Confirm the repo contains only invented sample content (`git grep -n -i "password\|secret\|api_key"` shows nothing real).
- [ ] **Step 2:** Confirm the repo name and which GitHub account hosts it with the user, create it with `gh repo create` (public, code only), push, enable Pages from `main`.
- [ ] **Step 3:** Load the live URL on a phone; check the banner, all three doors, the chart, look-back, exports and Notes with sample data. Share the link so the friend can look and give design feedback. **Stop here for her feedback before Phase B.**

---

# PHASE B — Backend (after she has seen and approved the front end)

### Task 9: Firestore rules, emulator, rules tests

**Files:** Create `firestore.rules`, `firebase.json`, `tests/rules/rules.test.js`; Modify `package.json` (dev dependencies, `"test:rules"`)

**Interfaces:** Produces the Firestore collections from the spec data model; `config/members` shape `{ uids:[string,string], doors:{hers:string,his:string}, names:{hers:string,his:string} }`.

- [ ] **Step 1:** Install dev dependencies; configure the Firestore emulator.
- [ ] **Step 2:** Failing tests (fake uids `herUid`, `hisUid`, `strangerUid`), one named test each: `her can read and write her own moods and entries`; `she cannot read or write his moods or entries`; `stranger cannot read any user data, notes, or config`; `member can create a note with own authorUid`; `member cannot create a note claiming the other's authorUid`; `member can delete own note but not the other's`; `no client can write config/members`; `unauthenticated reads and writes are denied everywhere`.
- [ ] **Step 3:** Run `npm run test:rules` (FAIL). Write `firestore.rules` per the spec; membership via `get(/databases/$(database)/documents/config/members).data.uids`. Run (PASS). Commit `feat: firestore rules with tests`.

### Task 10: Firebase adapter and real sign-in

**Files:** Create `js/firebase-config.js`, `js/data/firebase.js`; Modify `js/data/index.js`, `js/config.js`, `index.html` (login form); Test `tests/rules/firebase-adapter.test.js` (emulator)

**Interfaces:** Implements the full data interface above. `signIn(door, {email,password})` uses Firebase Auth; `signOut()` calls `terminate()` + `clearIndexedDbPersistence()` before resolving; Firestore offline persistence enabled; a "Forgot password" link calls `sendPasswordResetEmail`. In firebase mode the sample-mode banner is replaced by the privacy statement.

- [ ] **Step 1:** Run the same adapter tests used for `demo.js` against `firebase.js` on the emulator (mood update, 23:30 local-day entry, injection text round-trip, note authorship, `signOut` clears the cache). Expected: FAIL.
- [ ] **Step 2:** Implement `firebase.js` to the contract; run (PASS). Add the login form with plain-language errors for wrong password and unknown user.
- [ ] **Step 3:** Manual check on the emulator with fake accounts: sign in as her, open hers, try his (friendly lock), sign out, reload offline and confirm no journal data remains. Commit `feat: firebase adapter and sign-in`.

### Task 11: Her Firebase project and go-live (done together with the friend)

**Files:** Create `docs/SETUP-RUNBOOK.md`; Modify `js/firebase-config.js`, `js/config.js`

- [ ] **Step 1:** Write the runbook in plain language: create the Firebase project on her Google account, enable Email/Password sign-in, turn off sign-up (the rules already deny non-members), create the two users, create `config/members` with uids, `doors` and `names`, add `<account>.github.io` to authorized domains, deploy `firestore.rules`.
- [ ] **Step 2:** With her present, follow the runbook, paste the web config into `js/firebase-config.js`, set `MODE = 'firebase'`, push.
- [ ] **Step 3:** Acceptance on two real devices: each signs in, writes a mood and an entry, cannot open the other's door, sends and reads a note on both devices, exports a PDF and a .docx, signs out. Commit `chore: go live on her Firebase project`.
