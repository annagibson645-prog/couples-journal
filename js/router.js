// Moves between the journal screens. Takes its dependencies so it can be tested
// without a browser. Every rail button comes through navigate().
//   today / lookback: screen controllers { show(door), clear() }; today also leave()
//   rails: shared rails to wipe on sign-out; showGate(title, text, who, signOut, toToday)
export function createRouter({ data, today, lookback, rails = [], showScreen, showGate }) {
  // Sign out: wait for a pending draft to be written, THEN wipe, so the write
  // cannot land after (and undo) the wipe.
  async function signOut() {
    try { await today.leave(); } catch (e) { /* a draft must never block sign-out */ }
    today.clear();
    lookback.clear();
    for (const r of rails) r.clear();
    try { await data.signOut(); } finally { showScreen('front'); }
  }

  function navigate(name) {
    if (name === 'signout') return signOut();
    today.leave(); // saves a draft that was still waiting
    const session = data.currentSession();
    if (!session) { showScreen('front'); return undefined; }
    if (name === 'today') return today.show(session.door);
    if (name === 'lookback') return lookback.show(session.door);
    if (name === 'save') {
      // Save your journal replaces this stand-in in a later task.
      showGate('Save your journal', 'This part of the journal arrives in the next build step.', session.door, true, true);
    }
    return undefined;
  }

  return { navigate, signOut };
}
