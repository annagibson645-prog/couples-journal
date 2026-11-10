import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechSupport, insertAtCaret, describeError, restartDelay } from '../js/lib/dictation.js';

class Ctor {}

test('speechSupport: needs a speech engine and a secure context', () => {
  assert.deepEqual(speechSupport({ SpeechRecognition: Ctor, isSecureContext: true }), { available: true });
  assert.deepEqual(speechSupport({ webkitSpeechRecognition: Ctor, isSecureContext: true }), { available: true });
  assert.deepEqual(speechSupport({ isSecureContext: true }), { available: false, reason: 'unsupported' });
  assert.deepEqual(speechSupport({ SpeechRecognition: Ctor, isSecureContext: false }), { available: false, reason: 'insecure' });
  assert.deepEqual(speechSupport({ SpeechRecognition: Ctor }), { available: false, reason: 'insecure' });
  assert.deepEqual(speechSupport(undefined), { available: false, reason: 'unsupported' });
  assert.deepEqual(speechSupport(null), { available: false, reason: 'unsupported' });
});

test('insertAtCaret: appends with exactly one space and puts the caret after the words', () => {
  assert.deepEqual(insertAtCaret('', 0, 0, 'hello there'), { value: 'hello there', caret: 11 });
  assert.deepEqual(insertAtCaret('Dear diary', 10, 10, 'today was good'), { value: 'Dear diary today was good', caret: 25 });
  assert.deepEqual(insertAtCaret('Dear diary ', 11, 11, 'hi'), { value: 'Dear diary hi', caret: 13 });
  assert.deepEqual(insertAtCaret('Dear diary\n', 11, 11, 'hi'), { value: 'Dear diary\nhi', caret: 13 });
});

test('insertAtCaret: never doubles spaces, trims what was heard', () => {
  assert.deepEqual(insertAtCaret('a', 1, 1, '  b  '), { value: 'a b', caret: 3 });
  assert.deepEqual(insertAtCaret('a ', 2, 2, ' b'), { value: 'a b', caret: 3 });
  assert.equal(insertAtCaret('a', 1, 1, 'b c').value.includes('  '), false);
});

test('insertAtCaret: inserts in the middle, with a space on each side when needed', () => {
  assert.deepEqual(insertAtCaret('one three', 4, 4, 'two'), { value: 'one two three', caret: 7 });
  assert.deepEqual(insertAtCaret('onethree', 3, 3, 'two'), { value: 'one two three', caret: 7 });
  assert.deepEqual(insertAtCaret('hello.', 5, 5, 'there'), { value: 'hello there.', caret: 11 });
});

test('insertAtCaret: replaces a selection', () => {
  assert.deepEqual(insertAtCaret('one XXX three', 4, 7, 'two'), { value: 'one two three', caret: 7 });
  assert.deepEqual(insertAtCaret('all of it', 0, 9, 'new'), { value: 'new', caret: 3 });
});

test('insertAtCaret: nothing heard changes nothing; odd selections are clamped', () => {
  assert.deepEqual(insertAtCaret('abc', 1, 1, '   '), { value: 'abc', caret: 1 });
  assert.deepEqual(insertAtCaret('abc', 99, 99, 'd'), { value: 'abc d', caret: 5 });
  assert.deepEqual(insertAtCaret('abc', 3, 1, 'x'), { value: 'a x', caret: 3 });
  assert.deepEqual(insertAtCaret('abc', undefined, undefined, 'd'), { value: 'abc d', caret: 5 });
});

test('describeError: plain words, none of them blaming the person', () => {
  const blocked = "The microphone is blocked. Allow it in your browser's settings, or use your keyboard's microphone key.";
  assert.deepEqual(describeError('not-allowed'), { message: blocked, retry: false });
  assert.deepEqual(describeError('service-not-allowed'), { message: blocked, retry: false });
  const noMic = describeError('audio-capture');
  assert.match(noMic.message, /no microphone/i);
  assert.equal(noMic.retry, false);
  const net = describeError('network');
  assert.match(net.message, /internet connection/i);
  assert.equal(net.retry, false);
  assert.deepEqual(describeError('no-speech'), { message: '', retry: true });
  const other = describeError('something-new');
  assert.ok(other.message.length > 20);
  assert.equal(other.retry, false);
  assert.ok(describeError(undefined).message.length > 20);
  for (const code of ['not-allowed', 'audio-capture', 'network', 'language-not-supported', 'x']) {
    assert.doesNotMatch(describeError(code).message, /error|exception|undefined|\bcode\b/i);
  }
});

test('restartDelay: grows with each failed attempt and is capped', () => {
  const d = [0, 1, 2, 3, 4, 5, 20].map(restartDelay);
  for (let i = 1; i < 5; i++) assert.ok(d[i] > d[i - 1], `grows at ${i}`);
  assert.ok(d[0] > 0);
  assert.equal(d[6], restartDelay(1000));
  assert.ok(restartDelay(1000) <= 5000);
  assert.equal(restartDelay(1000), restartDelay(2000));
  assert.ok(restartDelay(-3) > 0);
  assert.ok(restartDelay(NaN) > 0);
});

test('insertAtCaret: no space before punctuation that follows, none after an opening bracket or quote', () => {
  assert.deepEqual(insertAtCaret('hello', 5, 5, ', world'), { value: 'hello, world', caret: 12 });
  for (const p of ['.', ',', ';', ':', '!', '?', ')', ']', '}']) {
    assert.equal(insertAtCaret('word', 4, 4, `${p} next`).value, `word${p} next`, p);
  }
  for (const o of ['(', '[', '{', '"', '“', '‘', "'"]) {
    assert.equal(insertAtCaret(`say ${o}`, 5, 5, 'hi').value, `say ${o}hi`, o);
  }
  assert.equal(insertAtCaret('plain', 5, 5, 'text').value, 'plain text');
});
