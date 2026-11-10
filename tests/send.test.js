import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialSendText, sendState, sendLabel, sourceLabel, formatCount, selectedTextIn } from '../js/lib/send.js';

test('initialSendText uses the selection only when it is part of the entry', () => {
  const entry = 'Slow morning, good tea.\nI keep thinking about the walk.';
  assert.equal(initialSendText(entry, 'good tea.'), 'good tea.');
  assert.equal(initialSendText(entry, '  good tea.  '), 'good tea.');
  assert.equal(initialSendText(entry, 'tea.\nI keep'), 'tea.\nI keep');
  assert.equal(initialSendText(entry, 'something from elsewhere'), entry);
});

test('initialSendText falls back to the whole entry for an empty or blank selection', () => {
  assert.equal(initialSendText('hello there', ''), 'hello there');
  assert.equal(initialSendText('hello there', '   \n '), 'hello there');
  assert.equal(initialSendText('hello there', undefined), 'hello there');
  assert.equal(initialSendText('hello there', null), 'hello there');
  assert.equal(initialSendText(undefined, 'x'), '');
});

test('sendState counts UTF-16 length like the Notes composer', () => {
  assert.equal(sendState('abc').count, 3);
  assert.equal(sendState('\u{1F319}').count, 2); // one emoji is two UTF-16 units
  assert.deepEqual(sendState('hello'), { count: 5, over: false, empty: false, canSend: true });
});

test('sendState: exactly the limit can send, one more cannot', () => {
  assert.equal(sendState('a'.repeat(2000)).canSend, true);
  const over = sendState('a'.repeat(2001));
  assert.equal(over.over, true);
  assert.equal(over.canSend, false);
  assert.equal(sendState('a'.repeat(50000)).over, true);
  assert.equal(sendState('a'.repeat(10), 5).over, true);
});

test('sendState: empty and whitespace-only cannot send', () => {
  for (const t of ['', '   ', '\n\t ', undefined, null]) {
    const s = sendState(t);
    assert.equal(s.empty, true);
    assert.equal(s.canSend, false);
  }
});

test('labels follow the viewer, and the source label follows the AUTHOR', () => {
  assert.equal(sendLabel('hers'), 'Send to him');
  assert.equal(sendLabel('his'), 'Send to her');
  assert.equal(sourceLabel('hers'), 'From her journal');
  assert.equal(sourceLabel('his'), 'From his journal');
  assert.equal(sourceLabel('other'), '');
});

test('formatCount puts thousands separators in', () => {
  assert.equal(formatCount(141), '141');
  assert.equal(formatCount(2000), '2,000');
  assert.equal(formatCount(50000), '50,000');
  assert.equal(formatCount(1234567), '1,234,567');
});

// A tiny range/selection stand-in. Nodes are { id, kids: [...] } and `contains` follows the tree.
const mk = (id, kids = []) => { const n = { id, kids, contains(x) { return x === n || kids.some((k) => k.contains && k.contains(x)); }, childNodes: { length: 1 } }; return n; };
function sel(start, end, text, { intersects = true, collapsed = false } = {}) {
  const range = {
    startContainer: start, endContainer: end, intersectsNode: () => intersects,
    cloneRange() { const c = { ...range, calls: [], setStart(n, o) { c.startContainer = n; c.calls.push(['s', n, o]); }, setEnd(n, o) { c.endContainer = n; c.calls.push(['e', n, o]); }, toString: () => c.clipped }; c.clipped = text; return c; },
  };
  return { rangeCount: 1, isCollapsed: collapsed, getRangeAt: () => range, toString: () => text };
}
const docWith = (s) => ({ getSelection: () => s });

test('selectedTextIn returns the selection when it sits inside the node', () => {
  const t = mk('t'); const entry = mk('entry', [t]);
  assert.equal(selectedTextIn(docWith(sel(t, t, 'tea')), t, entry), 'tea');
  assert.equal(selectedTextIn(docWith(sel(t, t, '', { collapsed: true })), t), '');
  assert.equal(selectedTextIn(docWith({ rangeCount: 0 }), t), '');
  assert.equal(selectedTextIn({}, t), '');
  assert.equal(selectedTextIn(docWith(null), t), '');
});

test('a selection that runs slightly past the entry text is clipped to the entry text', () => {
  const t = mk('t'); const when = mk('when'); const entry = mk('entry', [when, t]);
  // starts in the date line, ends inside the text: clipped to start at the text
  const s1 = sel(when, t, 'clipped words');
  assert.equal(selectedTextIn(docWith(s1), t, entry), 'clipped words');
  // ends past the text (in the buttons): clipped at the end of the text
  const actions = mk('actions'); entry.kids.push(actions);
  assert.equal(selectedTextIn(docWith(sel(t, actions, 'tail')), t, entry), 'tail');
});

test('a selection entirely outside the text, or reaching another entry, gives nothing (whole entry is used)', () => {
  const t = mk('t'); const entry = mk('entry', [t]); const other = mk('other', [mk('t2')]);
  const actions = mk('actions'); entry.kids.push(actions);
  assert.equal(selectedTextIn(docWith(sel(actions, actions, 'Delete', { intersects: false })), t, entry), '');
  assert.equal(selectedTextIn(docWith(sel(t, other.kids[0], 'two entries')), t, entry), '');
  assert.equal(selectedTextIn(docWith(sel(other.kids[0], other.kids[0], 'elsewhere')), t, entry), '');
});
