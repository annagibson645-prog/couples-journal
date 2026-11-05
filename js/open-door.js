// What happens when someone opens a door on the front page. No DOM here, so it
// can be tested with stand-in screens.
//   demo: sample mode. Nobody signs in: the column picked signs that person in
//   and opens straight away. Notes opens as Hers (the Notes screen has a switch).
//   Otherwise the door is gated by the session (sign-in screen / private notice).
import { gateFor } from './doors.js';

export function createDoors({ data, demo, today, lookback, save, notes, signIn, showGate }) {
  async function openSample(door) {
    const who = door === 'his' ? 'his' : 'hers';
    // Save what the person leaving was writing, while still signed in as them.
    try { await today.leave(); } catch (e) { /* a draft must never block opening */ }
    notes.leave();
    const session = data.currentSession();
    if (!session || session.door !== who) {
      // A different person: nothing typed for the last one may show for this one.
      today.clear();
      lookback.clear();
      save.clear();
      await data.signIn(who); // does not wipe the sample data
    }
    if (door === 'notes') notes.show(who); else today.show(who);
  }

  function openGated(door) {
    const session = data.currentSession();
    const gate = gateFor(door, session);
    if (gate === 'signin') {
      // Notes has no login of its own: offer Hers, with a link to His.
      if (door === 'notes') signIn.show('hers', 'notes');
      else signIn.show(door, door);
    } else if (gate === 'private') {
      showGate('This journal is private.', 'Only its owner can open it. Your own journal and the shared Notes are still yours to open.', session.door, true);
    } else if (door === 'notes') {
      notes.show(session.door);
    } else {
      today.show(session.door);
    }
  }

  return { openDoor: (door) => (demo ? openSample(door) : Promise.resolve(openGated(door))) };
}
