// Pure helpers for dictation (speech to text). No DOM, no storage, no network: the words a person
// speaks never pass through this code except as strings handed to insertAtCaret.

// Can this page use the browser's speech recognition? Chrome and Safari expose it (Safari with a
// webkit prefix) and only allow it on https or localhost.
export function speechSupport(win) {
  if (!win) return { available: false, reason: 'unsupported' };
  if (!(win.SpeechRecognition || win.webkitSpeechRecognition)) return { available: false, reason: 'unsupported' };
  if (win.isSecureContext !== true) return { available: false, reason: 'insecure' };
  return { available: true };
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Put `heard` where the caret is (or over the selection) with exactly one space between it and the
// words around it, and report where the caret goes: just after the inserted words.
export function insertAtCaret(value, selStart, selEnd, heard) {
  const text = typeof value === 'string' ? value : '';
  const a = clamp(Number.isFinite(selStart) ? selStart : text.length, 0, text.length);
  const b = clamp(Number.isFinite(selEnd) ? selEnd : a, 0, text.length);
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  const words = String(heard == null ? '' : heard).trim();
  if (!words) return { value: text, caret: from };
  const before = text.slice(0, from);
  const after = text.slice(to);
  // No space before heard text that starts with punctuation, nor after an opening bracket or quote.
  const lead = before && !/[\s(\[{"“‘']$/.test(before) && !/^[.,;:!?)\]}]/.test(words) ? ' ' : '';
  const trail = after && !/^[\s.,;:!?)\]}]/.test(after) ? ' ' : '';
  const caret = before.length + lead.length + words.length;
  return { value: before + lead + words + trail + after, caret };
}

const BLOCKED = "The microphone is blocked. Allow it in your browser's settings, or use your keyboard's microphone key.";
const NO_MIC = "There is no microphone to listen with. Check that one is connected, or use your keyboard's microphone key.";
const NO_NET = "Dictation needs an internet connection, because your browser's speech service does the listening. What you typed is safe.";
const GENERIC = "Dictation stopped. What you typed is safe. You can try again, or use your keyboard's microphone key.";

// A plain-words message for a speech engine error code. `retry` says whether to quietly listen again.
export function describeError(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return { message: BLOCKED, retry: false };
    case 'audio-capture':
      return { message: NO_MIC, retry: false };
    case 'network':
      return { message: NO_NET, retry: false };
    case 'no-speech':
      return { message: '', retry: true };
    default:
      return { message: GENERIC, retry: false };
  }
}

// Milliseconds to wait before listening again after `attempt` failed starts in a row (0 = a normal
// restart after the engine ended on its own). Doubles each time and stops growing at 4 seconds.
export function restartDelay(attempt) {
  const n = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(250 * Math.pow(2, Math.min(n, 10)), 4000);
}
