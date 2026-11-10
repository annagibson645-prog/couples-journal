// Last-resort handling for a door that fails to open: show the boot guard's message (with Reload) instead of nothing.
export function reportProblem(err, guard = globalThis.__journalGuard) {
  const msg = (err && err.message) || String(err);
  if (guard && guard.show) guard.show('Something went wrong opening the journal.', msg, true);
}

// Wraps a function that may throw or return a rejecting promise.
export function guarded(fn, report = reportProblem) {
  return (...args) => {
    try {
      const out = fn(...args);
      return out && typeof out.catch === 'function' ? out.catch(report) : out;
    } catch (e) {
      report(e);
      return undefined;
    }
  };
}
