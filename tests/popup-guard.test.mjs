import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../userscripts/popup-guard.user.js', import.meta.url), 'utf8');

function setup(mode = 'off', activation = false) {
  const callbacks = {};
  const menus = {};
  const stored = { 'popupGuard.siteModes.v1': mode === 'off' ? {} : { 'ads.example': mode } };
  let opens = 0;
  let submits = 0;
  const page = { open() { opens++; return 'native-window'; }, HTMLFormElement: function Form() {} };
  page.HTMLFormElement.prototype.submit = function () { submits++; return 'submitted'; };
  const document = { addEventListener(type, fn) { callbacks[type] = fn; }, querySelector() { return null; } };
  const window = { top: null };
  window.top = window;
  const location = { hostname: 'ads.example', reload() {} };
  runInNewContext(source, { window, unsafeWindow: page, document, location, navigator: { userActivation: { isActive: activation } }, GM_getValue: key => stored[key], GM_setValue: (key, value) => { stored[key] = value; }, GM_registerMenuCommand: (name, callback) => { menus[name] = callback; } });
  return { page, callbacks, menus, stored, get opens() { return opens; }, get submits() { return submits; } };
}

test('default is off, with explicit per-host modes', () => {
  const env = setup();
  assert.equal(env.page.open('https://example.com'), 'native-window');
  env.menus['Popup Guard: strict for ads.example']();
  assert.equal(env.stored['popupGuard.siteModes.v1']['ads.example'], 'strict');
});

test('balanced keeps native synchronous results for active user gestures', () => {
  const blocked = setup('balanced');
  assert.equal(blocked.page.open('https://example.com'), null);
  assert.equal(blocked.page.open('https://example.com', '_self'), 'native-window');
  const allowed = setup('balanced', true);
  assert.equal(allowed.page.open('https://example.com'), 'native-window');
});

test('strict blocks new windows even during activation but not same-window actions', () => {
  const env = setup('strict', true);
  assert.equal(env.page.open('https://example.com'), null);
  assert.equal(env.page.open('https://example.com', '_top'), 'native-window');
  const form = new env.page.HTMLFormElement();
  form.getAttribute = () => '_blank';
  assert.equal(form.submit(), undefined);
  assert.equal(env.submits, 0);
});

test('strict intercepts targeted links while balanced allows trusted links', () => {
  for (const [mode, trusted, expected] of [['strict', true, true], ['balanced', true, false], ['balanced', false, true]]) {
    const env = setup(mode);
    let prevented = false;
    const link = { hasAttribute: () => false, getAttribute: () => '_blank' };
    env.callbacks.click({ type: 'click', isTrusted: trusted, target: { closest: () => link }, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
    assert.equal(prevented, expected);
  }
});
