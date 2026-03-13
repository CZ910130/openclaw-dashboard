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

test('Utils: estimateMsgCost with zero usage', () => {
  const msg = { provider: 'anthropic', model: 'claude-sonnet-4-6', usage: { input: 0, output: 0 } };
  assert.strictEqual(utils.estimateMsgCost(msg), 0);
});

test('Utils: estimateMsgCost with unknown model returns 0', () => {
  const msg = { provider: 'unknown', model: 'nonexistent', usage: { input: 1000000, output: 1000000 } };
  assert.strictEqual(utils.estimateMsgCost(msg), 0);
});

test('Utils: safePath allows valid subpath', () => {
  const base = '/tmp/testdir';
  const result = utils.safePath(base, 'subdir/file.txt');
  assert.ok(result.startsWith(base));
  assert.strictEqual(result, '/tmp/testdir/subdir/file.txt');
});

test('Utils: safePath blocks path traversal', () => {
  const base = '/tmp/testdir';
  assert.throws(() => utils.safePath(base, '../etc/passwd'), /Path traversal/);
  assert.throws(() => utils.safePath(base, '../../root/.ssh/id_rsa'), /Path traversal/);
});

test('Utils: safePath blocks absolute path escape', () => {
  const base = '/tmp/testdir';
  assert.throws(() => utils.safePath(base, '/etc/passwd'), /Path traversal/);
});

test('Auth: safeCompare', () => {
  assert.strictEqual(auth.safeCompare('abc', 'abc'), true);
  assert.strictEqual(auth.safeCompare('abc', 'def'), false);
  assert.strictEqual(auth.safeCompare('abc', 'abcd'), false);
  assert.strictEqual(auth.safeCompare(null, 'abc'), false);
  assert.strictEqual(auth.safeCompare('abc', undefined), false);
});

test('Auth: session management', () => {
  const sessions = new Map();
  const token = auth.createSession(sessions, 'testuser', '127.0.0.1', false);
  assert.ok(token);
  assert.ok(sessions.has(token));
  const sess = sessions.get(token);
  assert.strictEqual(sess.username, 'testuser');
  assert.strictEqual(sess.ip, '127.0.0.1');
  assert.strictEqual(sess.rememberMe, false);
  assert.ok(sess.expiresAt > Date.now());
});

test('Auth: rate limiting', () => {
  const store = new Map();
  // First few attempts should not be locked
  assert.deepStrictEqual(auth.checkRateLimit(store, '1.2.3.4'), { blocked: false, softLocked: false });
  // Record 5 failures to trigger soft lock
  for (let i = 0; i < 5; i++) auth.recordFailedAuth(store, '1.2.3.4');
  const check = auth.checkRateLimit(store, '1.2.3.4');
  assert.strictEqual(check.softLocked, true);
  // Clear and verify unlocked
  auth.clearFailedAuth(store, '1.2.3.4');
  assert.deepStrictEqual(auth.checkRateLimit(store, '1.2.3.4'), { blocked: false, softLocked: false });
});

test('Auth: isAuthenticated with no token returns false', () => {
  const sessions = new Map();
  const fakeReq = { headers: {}, url: '/api/test' };
  assert.strictEqual(auth.isAuthenticated(sessions, fakeReq), false);
});

test('Auth: isAuthenticated with valid session returns true', () => {
  const sessions = new Map();
  const token = auth.createSession(sessions, 'user', '127.0.0.1', false);
  const fakeReq = { headers: { authorization: `Bearer ${token}` }, url: '/api/test' };
  assert.strictEqual(auth.isAuthenticated(sessions, fakeReq), true);
});

test('Auth: isAuthenticated with expired session returns false', () => {
  const sessions = new Map();
  const token = auth.createSession(sessions, 'user', '127.0.0.1', false);
  // Manually expire the session
  sessions.get(token).expiresAt = Date.now() - 1000;
  const fakeReq = { headers: { authorization: `Bearer ${token}` }, url: '/api/test' };
  assert.strictEqual(auth.isAuthenticated(sessions, fakeReq), false);
  assert.strictEqual(sessions.has(token), false); // Should be cleaned up
});

test('Utils: normalizeModel handles provider prefix stripping', () => {
  assert.strictEqual(utils.normalizeModel('anthropic', 'anthropic/claude-opus-4-6-latest'), 'claude-opus-4-6');
  assert.strictEqual(utils.normalizeModel('zai', 'glm-5-plus'), 'glm-5');
  assert.strictEqual(utils.normalizeModel('kimi-coding', 'k2p5-latest'), 'k2p5');
});
