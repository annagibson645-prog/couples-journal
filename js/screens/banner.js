// The sample-mode banner's "Reset sample data" button with its Yes / No question.
// The text lives in index.html; this only shows, hides and moves focus.
// deps: { document?, onReset(): Promise }  (onReset wipes the sample data and goes to the front page)
export function createBanner({ document: doc = globalThis.document, onReset }) {
  const $ = (id) => doc.getElementById(id);
  let busy = false;
  let fade = null; // the confirmation line goes away by itself so the sticky strip stays small
  const STATUS_MS = 4000;
  function say(text) {
    clearTimeout(fade);
    $('sample-status').textContent = text;
    if (text) {
      fade = setTimeout(() => { $('sample-status').textContent = ''; }, STATUS_MS);
      fade.unref?.();
    }
  }

  // Marks the banner while the Yes / No question is showing (CSS hides the long text then; no :has() needed).
  function confirming(on) {
    const b = $('sample-banner');
    if (b.classList) b.classList.toggle('is-confirming', on);
    else b.className = b.className.split(' ').filter((c) => c && c !== 'is-confirming').concat(on ? ['is-confirming'] : []).join(' ');
  }

  function ask() {
    say('');
    confirming(true);
    $('sample-reset').hidden = true;
    $('sample-confirm').hidden = false;
    $('sample-no').focus(); // the safe answer is the one under the cursor
  }
  function close(message) {
    confirming(false);
    $('sample-confirm').hidden = true;
    $('sample-reset').hidden = false;
    if (message !== undefined) say(message);
    $('sample-reset').focus();
  }
  async function confirmYes() {
    if (busy) return;
    busy = true;
    try {
      await onReset();
      close('Sample data reset.');
    } catch (e) {
      close('Could not reset the sample data. Please try again.');
    }
    busy = false;
  }

  $('sample-reset').addEventListener('click', ask);
  $('sample-no').addEventListener('click', () => close(''));
  $('sample-yes').addEventListener('click', confirmYes);
  $('sample-confirm').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault?.(); if (!busy) close(''); }
  });

  return { show(visible) { $('sample-banner').hidden = !visible; } };
}
