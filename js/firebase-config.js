// Firebase web-app settings. These values are public by design (they only name the project;
// the security rules and the login protect the data), but they must be the REAL ones before
// the site can leave sample mode.
//
// PLACEHOLDER VALUES: nothing here points at a real project. While `enabled` is false, or any
// value still starts with "PLACEHOLDER", choosing a non-demo MODE in js/config.js fails closed
// with a plain message instead of contacting Google. See docs/SETUP-RUNBOOK.md for the steps
// that fill this in (Firebase console > Project settings > Your apps > Web app).
export const firebaseConfig = {
  enabled: false,
  apiKey: 'PLACEHOLDER-api-key',
  authDomain: 'PLACEHOLDER-project-id.firebaseapp.com',
  projectId: 'PLACEHOLDER-project-id',
  storageBucket: 'PLACEHOLDER-project-id.appspot.com',
  messagingSenderId: 'PLACEHOLDER-sender-id',
  appId: 'PLACEHOLDER-app-id',
};
