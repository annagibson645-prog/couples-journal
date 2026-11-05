// Deep copy for plain JSON data. Replaces structuredClone, which needs Safari 15.4 / Chrome 98.
// Journal data is plain JSON (strings, numbers, booleans, arrays, objects), so a JSON round trip is exact.
export function cloneData(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
