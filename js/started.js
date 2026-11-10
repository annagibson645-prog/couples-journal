// Sets the start flag that the guard in index.html watches. js/boot.js imports this right after app.js,
// so the flag does not depend on a cached copy of app.js (which also sets it).
globalThis.__journalStarted = true;
