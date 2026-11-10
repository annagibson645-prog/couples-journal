// A stand-in for the browser's SpeechRecognition and a window that offers it, for the screen tests.
export class FakeEngine {
  static all = [];
  constructor() { this.aborted = 0; this.started = 0; FakeEngine.all.push(this); }
  start() { this.started += 1; this.running = true; if (this.onstart) this.onstart({}); }
  // Like a real engine: stop() lets it finish, then it reports end (a moment later).
  stop() { this.stopped = (this.stopped || 0) + 1; setTimeout(() => { this.running = false; if (this.onend) this.onend({}); }, 0); }
  abort() { this.aborted += 1; this.running = false; }
  say(text, final = true) {
    const r = Object.assign([{ transcript: text }], { isFinal: final });
    if (this.onresult) this.onresult({ resultIndex: 0, results: [r] });
  }
}

export function makeSpeechWin(doc) {
  FakeEngine.all = [];
  const dd = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  return {
    SpeechRecognition: FakeEngine, isSecureContext: true, document: dd, navigator: { language: 'en-US' },
    Event: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    addEventListener() {}, removeEventListener() {}, localStorage: { getItem: () => '1', setItem() {} },
  };
}
export const engines = () => FakeEngine.all;
