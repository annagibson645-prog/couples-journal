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

test('selectedTextIn returns the selection only when it sits inside the node', () => {
  const inside = { id: 'in' };
  const outside = { id: 'out' };
  const node = { contains: (n) => n === inside };
  const doc = (sel) => ({ getSelection: () => sel });
  const sel = (anchor, focus, text, collapsed = false) => ({ rangeCount: 1, isCollapsed: collapsed, anchorNode: anchor, focusNode: focus, toString: () => text });
  assert.equal(selectedTextIn(doc(sel(inside, inside, 'tea')), node), 'tea');
  assert.equal(selectedTextIn(doc(sel(inside, outside, 'tea and more')), node), '');
  assert.equal(selectedTextIn(doc(sel(outside, outside, 'x')), node), '');
  assert.equal(selectedTextIn(doc(sel(inside, inside, '', true)), node), '');
  assert.equal(selectedTextIn(doc({ rangeCount: 0 }), node), '');
  assert.equal(selectedTextIn({}, node), '');
  assert.equal(selectedTextIn(doc(null), node), '');
});
