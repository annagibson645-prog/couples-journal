// Door gating. Pure: no DOM, no storage. Real enforcement is the server rules
// in Phase B; this decides what the screens offer.

// Which journal door does this uid own? members = { doors: { hers: uid, his: uid } }.
export function doorFor(uid, members) {
  if (!uid || !members || !members.doors) return null;
  if (members.doors.hers === uid) return 'hers';
  if (members.doors.his === uid) return 'his';
  return null;
}

// hers/his only for their owner; notes for either signed-in person; signed out gets nothing.
export function canOpen(door, session) {
  if (!session || (session.door !== 'hers' && session.door !== 'his')) return false;
  if (door === 'notes') return true;
  if (door === 'hers' || door === 'his') return session.door === door;
  return false;
}

// What the front page should do when someone opens `door`.
export function gateFor(door, session) {
  if (!session) return 'signin';
  return canOpen(door, session) ? 'open' : 'private';
}
