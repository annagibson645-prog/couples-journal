// Local-calendar day keys. Always local getters: toISOString would shift an
// entry written at 23:30 onto the next UTC day.

const pad = (n) => String(n).padStart(2, '0');

// Date -> 'YYYY-MM-DD' in local time.
export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
