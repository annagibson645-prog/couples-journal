// Sign-in screen. The sigil is cloned from the front-page column so the markup
// and CSS live in one place. All text is set with textContent.
const LABEL = { hers: 'Hers', his: 'His' };

// deps: { data, demo: boolean, showScreen, onSignedIn(door, returnTo), onBack() }
export function createSignIn({ data, demo, showScreen, onSignedIn, onBack }) {
  const $ = (id) => document.getElementById(id);
  let who = 'hers';
  let returnTo = null;

  function setSigil(w) {
    const src = document.querySelector(`.col-${w} .sigil`);
    const host = $('si-sigil');
    host.replaceChildren();
    if (src) host.appendChild(src.cloneNode(true));
  }

  function setError(msg) {
    const el = $('si-error');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function render() {
    setSigil(who);
    $('si-name').textContent = LABEL[who];
    $('si-submit').textContent = `Open ${LABEL[who]}`;
    $('si-label').textContent = demo ? 'Sample sign-in' : 'Sign in';
    $('si-help').textContent = demo
      ? 'Sample mode: no email or password is needed. One click opens the sample journal.'
      : 'Sign in with your own email and password.';
    for (const id of ['si-email', 'si-password']) {
      const input = $(id);
      input.disabled = demo;
      input.value = '';
    }
    $('si-forgot-note').hidden = true;
    $('si-switch').hidden = !(returnTo === 'notes' && who === 'hers');
    setError('');
    showScreen('signin', who);
    // Inputs are disabled in sample mode, so land on the heading.
    $('si-name').focus();
  }

  $('si-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
    const credentials = demo ? undefined : { email: $('si-email').value, password: $('si-password').value };
    const btn = $('si-submit');
    btn.disabled = true;
    try {
      await data.signIn(who, credentials);
      onSignedIn(who, returnTo);
    } catch (err) {
      setError(demo ? 'Could not open the sample journal.' : 'That email and password did not work. Please try again.');
    } finally {
      btn.disabled = false;
    }
  });

  $('si-forgot').addEventListener('click', (e) => {
    e.preventDefault();
    const note = $('si-forgot-note');
    note.textContent = demo
      ? 'Nothing to reset in sample mode.'
      : 'Password reset arrives with the live journal.';
    note.hidden = false;
  });

  $('si-switch').addEventListener('click', (e) => {
    e.preventDefault();
    who = 'his';
    render();
  });

  $('si-back').addEventListener('click', (e) => {
    e.preventDefault();
    onBack();
  });

  return {
    // door: 'hers' | 'his'; back: the door to return to after sign-in (or null).
    show(door, back) {
      who = door === 'his' ? 'his' : 'hers';
      returnTo = back || null;
      render();
    },
  };
}
