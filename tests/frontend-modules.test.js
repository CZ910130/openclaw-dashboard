const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeClassList {
  constructor() {
    this.set = new Set();
  }
  add(...names) { names.forEach(name => this.set.add(name)); }
  remove(...names) { names.forEach(name => this.set.delete(name)); }
  toggle(name, force) {
    if (force === undefined) {
      if (this.set.has(name)) {
        this.set.delete(name);
        return false;
      }
      this.set.add(name);
      return true;
    }
    if (force) this.set.add(name);
    else this.set.delete(name);
    return !!force;
  }
  contains(name) { return this.set.has(name); }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
    this.classList = new FakeClassList();
    this.style = {};
    this.textContent = '';
    this.innerHTML = '';
    this.id = '';
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

function createContext(extra = {}) {
  const document = {
    hidden: false,
    visibilityState: 'visible',
    createElement: tag => new FakeElement(tag),
    getElementById: id => extra.elements?.[id] || null,
    addEventListener: () => {},
    querySelector: () => null,
  };
  const context = {
    console,
    document,
    window: { location: { pathname: '/' } },
    setInterval: fn => ({ fn }),
    clearInterval: () => {},
    ...extra,
  };
  vm.createContext(context);
  return context;
}

function loadScript(context, filename) {
  const fullPath = path.join(__dirname, '..', filename);
  const code = fs.readFileSync(fullPath, 'utf8');
  vm.runInContext(code, context, { filename });
}

test('index.html loads frontend scripts in dependency order', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const order = [
    'core-helpers.js?v=1',
    'render-helpers.js?v=1',
    'app.js?v=36',
    'misc-ui.js?v=1',
    'system-ui.js?v=1',
  ];
  let last = -1;
  for (const token of order) {
    const idx = html.indexOf(token);
    assert.ok(idx > last, `expected ${token} after previous script tag`);
    last = idx;
  }
});

test('core-helpers getApiBasePath handles nested index route', () => {
  const context = createContext();
  context.window.location.pathname = '/dashboard/index.html';
  loadScript(context, 'core-helpers.js');
  assert.strictEqual(context.getApiBasePath(), '/dashboard');
});

test('core-helpers state helpers toggle classes and badge text', () => {
  const target = new FakeElement();
  const badge = new FakeElement();
  const context = createContext({ elements: { badge } });
  loadScript(context, 'core-helpers.js');

  context.setHiddenState(target, true, 'hidden-x');
  assert.ok(target.classList.contains('hidden-x'));
  context.setOpenState(target, true, 'open-x');
  assert.ok(target.classList.contains('open-x'));
  assert.strictEqual(context.isOpenState(target, 'open-x'), true);

  context.setNotifBadgeVisible('badge', true, 7);
  assert.ok(badge.classList.contains('notification-badge-visible'));
  assert.strictEqual(badge.textContent, 7);
});

test('render-helpers create labeled values and message lists', () => {
  const context = createContext();
  loadScript(context, 'render-helpers.js');

  const stat = context.createLabeledValue('Tokens', '123', {
    mono: true,
    valueColor: 'red',
    subText: '$4.56',
    compactLabel: true,
  });
  assert.strictEqual(stat.children.length, 3);
  assert.ok(stat.children[0].className.includes('ui-meta-label'));
  assert.ok(stat.children[1].classList.contains('mono'));
  assert.strictEqual(stat.children[1].style.color, 'red');
  assert.strictEqual(stat.children[2].textContent, '$4.56');

  const container = new FakeElement();
  context.renderSessionMessages(container, [
    { role: 'assistant', content: 'Done', timestamp: '2026-04-15T20:00:00Z' },
    { role: 'user', content: 'Hi', timestamp: '2026-04-15T20:01:00Z' },
  ], { compact: true });
  assert.strictEqual(container.children.length, 2);
  assert.ok(container.children[0].className.includes('session-message-row-compact'));
  assert.ok(container.children[0].children[1].className.includes('session-message-body-compact'));
});

test('frontend module files are registered for static serving and hot reload', () => {
  const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const devmodeJs = fs.readFileSync(path.join(__dirname, '..', 'lib', 'devmode.js'), 'utf8');
  const middlewareJs = fs.readFileSync(path.join(__dirname, '..', 'lib', 'middleware.js'), 'utf8');
  for (const token of ['/core-helpers.js', '/render-helpers.js', '/misc-ui.js', '/system-ui.js']) {
    assert.ok(serverJs.includes(token), `server missing ${token}`);
  }
  for (const token of ['core-helpers.js', 'render-helpers.js', 'misc-ui.js', 'system-ui.js']) {
    assert.ok(devmodeJs.includes(token), `devmode missing ${token}`);
    assert.ok(middlewareJs.includes(token), `middleware missing ${token}`);
  }
});
