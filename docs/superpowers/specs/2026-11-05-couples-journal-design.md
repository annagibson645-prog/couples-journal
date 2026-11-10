# Couples Journal — Design Spec

Date: 2026-11-05 · Status: draft for review (nothing built yet)

## Purpose
A private journaling site for a friend and her husband. Each has a private journal with a daily mood and written entries. A shared "Notes" space lets them leave notes for each other. Inspired by the look and feel of the owner's earlier progress tracker (mood charts, notes, a record to look back on), but a separate project with a fresh codebase.

## Constraints
- Cost: free. Hosting on GitHub Pages (no Netlify). Backend on Firebase free tier.
- They use **separate devices**, so data must sync online. Local-only storage is not enough.
- Each person's journal is private from the other. Only Notes are shared.
- Users are not technical. Setup that needs her accounts is done last, with her present.
- The repo holds code only. No real journal text is ever committed (fake sample data for tests).

## Decisions made
| Topic | Decision |
|---|---|
| Hosting | GitHub Pages, public code-only repo |
| Backend | Firebase: Authentication (email + password) and Firestore |
| Firebase owner | **The friend's own Google account** (setup is the final step) |
| Accounts | Two accounts, created manually. Open sign-up disabled |
| Mood | One score per day (1–10) with an optional note. No layered scores |
| Exports | Readable formats first; JSON backup hidden under "Advanced" |
| Look | **Orbital sigils**, borrowed from an earlier app of the owner's: three full-height columns, each with a glowing symbol inside slowly turning rings. Hers pink, His blue, Notes violet (the two blended). A light (parchment) and dark (night) mode with a switch. Design reference: the private design canvas (not published) |

## Screens
All screens use the Orbital sigils look and have a Light mode / Dark mode switch. Hers and His are the same pages with a different accent (pink or blue) and symbol (a flower for Hers, a star for His). Notes uses violet and a symbol of two overlapping circles with a heart.
1. **Front page:** three columns, Hers on the left, Notes in the middle (slightly wider), His on the right. Each column is a link: a glowing symbol in turning rings, a small label ("Journal · Private" or "Shared · Both"), a big italic name and one line of text. On a phone the columns stack in the same order.
2. **Sign in:** the person's own symbol on the left; on the right an email and password form, "Open Hers" / "Open His", "Forgot your password?" and a link back to the front page. Notes uses whichever login the person already has.
3. **Today:** a left rail with the person's symbol, name and section links (Today, Look back, Save your journal, Sign out). On the right: the date, ten moon buttons for the daily mood (new moon = heavy, full moon = bright, with a word for the choice), an optional few words, a big writing box, and "Save entry" with a "Saved on this device, then synced" status.
4. **Look back:** a line chart of the last 30 days, a month calendar with days tinted by mood (same accent colour, stronger = brighter), and a detail panel for the chosen day with its mood, note and entry count.
5. **Save your journal:** PDF, Word, Markdown and plain text, each with a Save button; a one-line Google Docs tip; "Advanced: backup file" collapsed.
6. **Notes:** a left rail with the violet symbol, a composer pinned at the bottom ("Leave note"), and the feed drawn as a thread of light: a glowing line runs down the middle with day labels ("Today", "Yesterday", "31 October") and a small glowing dot on the line for each note, in the author's colour. On a phone the line moves to the left edge and notes stack in one column. The viewer's own notes sit on the right with a Delete link; the other person's notes sit on the left. Author colours: pink for Hers, blue for His.

## Look and feel
- **Fonts:** Fraunces italic for names and headings, Newsreader for reading and form text, JetBrains Mono for the small spaced-out label above each name.
- **Dark (night):** background `#0e0d14`, text `#eae6f5`; Hers `#f472b6`, His `#60a5fa`, Notes `#b18cf0`; faint stars and an occasional shooting star on the front page.
- **Light (parchment):** background `#f0ead8`, text `#2c1f0e`; Hers `#a8316a`, His `#2f5aa3`, Notes `#6a45b3`; no stars.
- **Mood scale:** ten moon phases, drawn the same on Today, the calendar and the chart so one colour means one feeling.
- **Motion:** slow rings and a gentle glow only; rings speed up on hover; everything stops under reduced-motion. The theme choice is remembered on that device.
- **Placeholders:** the names "Hers" and "His" and the sample entries are placeholders until the friend chooses her own.
- **Alternatives kept on the canvas:** five other sigil styles (moons, wax seals, ripples, orbs, petals) with the same layout, in case the friend prefers one.

## Exports
- Primary (shown first): **PDF, Word (.docx), Markdown (.md), plain text (.txt)**, each containing dated entries with that day's mood and note.
- **Google Docs:** no direct send (would require Google OAuth). The .docx opens in Google Docs via Drive upload; the app shows the two-step instructions beside the button.
- **Advanced (collapsed by default):** JSON backup, with a short explanation that it is for safekeeping, not reading.
- Exports are generated in the browser from the locally cached copy, so they work offline. Export libraries load on demand from a CDN with pinned versions.

## Data model (Firestore)
- `users/{uid}/moods/{YYYY-MM-DD}` → `{ score, note?, updatedAt }`
- `users/{uid}/entries/{entryId}` → `{ day, text, createdAt, updatedAt }`
- `notes/{noteId}` → `{ authorUid, text, createdAt }`
- `config/members` → `{ uids: [uidA, uidB], doors: { hers: uid, his: uid }, names: { hers, his } }` — set manually in the console; clients cannot write it. (`doors` and `names` let the app know which door belongs to which login and what to call them.)

## Security rules (enforced server-side)
- `users/{uid}/**`: read/write only when `request.auth.uid == uid`.
- `notes/**`: read/create only if the signed-in uid is in `config/members`. Update/delete only when `authorUid == request.auth.uid`.
- `config/**`: read-only for members, no client writes.
- Everything else denied.
- Even if someone manages to register, they are not in `members` and can read nothing. Disabling sign-up is the first line of defence, and the rules are the second.

## Error handling and offline
- Wrong password: plain message. Password reset by email (accounts need real emails).
- Offline: Firestore offline persistence is on. A small label shows "Saved on this device" then "Synced".
- Failed export: show which format failed and suggest another.

## Privacy statement (shown in the app)
Entries are stored on Google's servers (Firebase), protected by login and server rules, but **not end-to-end encrypted**. The Firebase project owner (the friend) can technically view data in the admin console. No analytics, no third-party trackers.

## Code layout
Small separate files, not one monolith: `index.html`, `css/`, `js/` (auth, doors, journal, mood, chart, lookback, notes, export, firebase-config). Firebase SDK and export libraries loaded from a CDN with pinned versions. The Firebase web config is public by design.

## Testing
- Firebase Emulator with fake accounts and fake entries only.
- Automated rules tests: her login cannot read his data; a stranger cannot read anything; a member cannot edit or delete the other's notes.
- Each export format produced and opened to confirm it reads correctly.
- Layout checked at phone width, in both themes.

## Build order
**Front end first.** The screens run on invented sample data through a swappable data layer, and are published to GitHub Pages for the friend to look at before any backend exists.
1. Front page, themes, journal, daily mood, chart, look-back, exports, shared notes — all on sample data, with a visible "sample mode" banner.
2. Publish to GitHub Pages; the friend reviews.
3. Then the backend: security rules and tests, the Firebase connection and real sign-in.
4. **Last, with the friend present:** create her Firebase project, add the two accounts, fill `config/members`, add the Pages address as an authorized domain, switch from sample mode to the real backend.

## Open items
- Names to show on the Hers and His doors.
- Which sigil style the friend prefers (the canvas has the main one plus five alternatives), and her own names for the two doors.
- Repo name and GitHub account for the new project.
