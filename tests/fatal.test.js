import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guarded, reportProblem } from '../js/lib/fatal.js';

test('reportProblem shows the guard message with Reload and the error text', () => {
  const calls = [];
  reportProblem(new Error('boom'), { show: (...a) => calls.push(a) });
  assert.deepEqual(calls, [['Something went wrong opening the journal.', 'boom', true]]);
});

test('reportProblem copes with no guard and with non-Error values', () => {
  reportProblem(new Error('x'), undefined);
  const calls = [];
  reportProblem('plain', { show: (...a) => calls.push(a) });
  assert.equal(calls[0][1], 'plain');
});

test('guarded reports a rejected promise and a synchronous throw, and passes results through', async () => {
  const seen = [];
  const report = (e) => seen.push(e.message);
  await guarded(async () => { throw new Error('async'); }, report)();
  guarded(() => { throw new Error('sync'); }, report)();
  assert.equal(await guarded(async (x) => x + 1, report)(1), 2);
  assert.equal(guarded((x) => x * 2, report)(4), 8);
  assert.deepEqual(seen, ['async', 'sync']);
});
