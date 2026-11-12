// Picks the data adapter by MODE. Screens import `data` from here only.
//   'demo'     the sample adapter over localStorage (the default; never contacts Google)
//   'firebase' the real adapter. Its code and the Firebase SDK are fetched only now, on demand,
//              and only when js/firebase-config.js holds real settings (otherwise: fail closed).
import { MODE } from '../config.js';
import { firebaseConfig } from '../firebase-config.js';
import { createDemoAdapter } from './demo.js';

const NOT_CONNECTED = 'This journal is not connected to its storage yet, so nothing can be opened or saved.';
const NO_GOOGLE = "Couldn't reach Google to start the journal. Check your connection and reload.";
const NOT_SIGNED_IN = 'Not signed in.';

export function isRealConfig(cfg) {
  if (!cfg || cfg.enabled !== true) return false;
  for (const k of ['apiKey', 'authDomain', 'projectId', 'appId']) {
    if (typeof cfg[k] !== 'string' || !cfg[k] || cfg[k].startsWith('PLACEHOLDER')) return false;
  }
  return true;
}

// Looks like the adapter right away; the real one is created on the first ready().
// `load()` resolves to the adapter. A failure leaves every data call rejecting with a plain message.
export function createLazyAdapter(load) {
  let inner = null;
  let loading = null;
  const ensure = () => {
    // A failed load is not remembered: the next call tries again.
    if (!loading) loading = load().then((a) => { inner = a; return a; }, (e) => { loading = null; throw e; });
    return loading;
  };
  const forward = (name) => async (...args) => (await ensure())[name](...args);
  return {
    async ready() { return (await ensure()).ready(); },
    currentSession() { return inner ? inner.currentSession() : null; },
    listenNotes(cb, onError) {
      if (!inner) throw new Error(NOT_SIGNED_IN);
      return inner.listenNotes(cb, onError);
    },
    signIn: forward('signIn'),
    // Signing out with nothing loaded is already done.
    async signOut(opts) { return inner ? inner.signOut(opts) : { wiped: true, unsynced: false }; },
    getMembers: async () => (inner ? inner.getMembers() : { names: { hers: 'Hers', his: 'His' }, doors: { hers: '', his: '' } }),
    sendPasswordReset: forward('sendPasswordReset'),
    saveMood: forward('saveMood'),
    getMoods: forward('getMoods'),
    addEntry: forward('addEntry'),
    listEntries: forward('listEntries'),
    deleteEntry: forward('deleteEntry'),
    saveDraft: forward('saveDraft'),
    getDraft: forward('getDraft'),
    addNote: forward('addNote'),
    deleteNote: forward('deleteNote'),
  };
}

// `onSessionLost` is called when Firebase signs this tab out behind its back (for example from another tab);
// the app will reload there once the live login is wired.
export function pickAdapter(mode = MODE, config = firebaseConfig, loadModule = () => import('./firebase.js'), onSessionLost = null) {
  if (mode === 'demo') return createDemoAdapter();
  if (mode === 'firebase') {
    return createLazyAdapter(async () => {
      if (!isRealConfig(config)) throw new Error(NOT_CONNECTED);
      let mod;
      let sdk;
      try {
        mod = await loadModule();
        sdk = await mod.loadFirebaseSdk();
      } catch (e) {
        throw new Error(NO_GOOGLE); // never the raw import error
      }
      const appConfig = { ...config };
      delete appConfig.enabled;
      return mod.createFirebaseAdapter({ sdk, config: appConfig, onSessionLost: () => { if (typeof onSessionLost === 'function') onSessionLost(); } });
    });
  }
  // Any other value fails closed too: never fall back to sample data by accident.
  return createLazyAdapter(async () => { throw new Error(NOT_CONNECTED); });
}

export const data = pickAdapter();
