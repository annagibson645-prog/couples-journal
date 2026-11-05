// Picks the data adapter by MODE. Screens import `data` from here only.
import { MODE } from '../config.js';
import { createDemoAdapter } from './demo.js';

function pick() {
  if (MODE === 'demo') return createDemoAdapter();
  // Phase B adds js/data/firebase.js behind the same interface.
  throw new Error(`No data adapter for mode "${MODE}" yet.`);
}

export const data = pick();
