const test = require('node:test');
const assert = require('node:assert');
const auth = require('../lib/auth');
const utils = require('../lib/utils');

test('Auth: password hashing and verification', () => {
  const password = 'TestPassword123';
  const { hash, salt } = auth.hashPassword(password);
  
  assert.ok(hash);
  assert.ok(salt);
  assert.strictEqual(auth.verifyPassword(password, hash, salt), true);
  assert.strictEqual(auth.verifyPassword('WrongPassword', hash, salt), false);
});

test('Auth: password validation', () => {
  assert.strictEqual(auth.validatePassword('short'), 'Password must be at least 8 characters');
  assert.strictEqual(auth.validatePassword('nonumbers'), 'Password must contain at least 1 number');
  assert.strictEqual(auth.validatePassword('12345678'), 'Password must contain at least 1 letter');
  assert.strictEqual(auth.validatePassword('ValidPass123'), null);
});

test('Utils: normalizeProvider', () => {
  assert.strictEqual(utils.normalizeProvider(' Anthropic '), 'anthropic');
  assert.strictEqual(utils.normalizeProvider(null), 'unknown');
});

test('Utils: normalizeModel', () => {
  assert.strictEqual(utils.normalizeModel('anthropic', 'claude-3-5-sonnet-20241022'), 'claude-sonnet-4-6');
  assert.strictEqual(utils.normalizeModel('google', 'gemini-3-flash-preview'), 'gemini-3-flash-preview');
});

test('Utils: estimateMsgCost', () => {
  const msg = {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    usage: {
      input: 1000000,
      output: 1000000
    }
  };
  // Sonnet rates: 3.00 input, 15.00 output
  const cost = utils.estimateMsgCost(msg);
  assert.strictEqual(cost, 18.00);
});
