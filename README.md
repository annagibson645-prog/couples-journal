# Couples Journal

A small private two-person journal. Plain static site: HTML, CSS and ES modules. No build step is needed on the host (a small optional script regenerates committed files, see Build step below).

The live site is a sample-mode preview with invented data; nothing typed there is private or backed up (entries stay in the visitor's own browser).

- Run locally: serve this folder with any static server (for example `npx serve .`) and open it.
- Test: `npm test` (Node's built-in test runner, nothing to install).
- `js/config.js` sets `MODE`. `'demo'` keeps sample data in the browser only and shows a banner saying so.

No real journal text is ever committed to this repository.

## Build step

Edit the files in `css/` and `js/` as usual, then run `node scripts/build.mjs`. It rewrites `css/app.css` (the one stylesheet the page loads), the sigil paths and the `modulepreload` list in `index.html`. `npm test` fails if any of them are out of date.
