// ==UserScript==
// @name         Personal Popup Guard
// @namespace    personal.userscripts.popup-guard
// @version      0.1.0
// @description  Opt-in popup protection with per-site balanced, strict and allow modes.
// @match        http://*/*
// @match        https://*/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// ==/UserScript==

(() => {
  'use strict';

  // Rules are exact hostnames, not guessed registrable domains or URL substrings.
  const key = 'popupGuard.siteModes.v1';
  const host = location.hostname.toLowerCase();
  const rules = GM_getValue(key, {});
  const mode = ['balanced', 'strict', 'allow'].includes(rules?.[host]) ? rules[host] : 'off';

  if (window === window.top) {
    for (const next of ['off', 'balanced', 'strict', 'allow']) {
      GM_registerMenuCommand(`Popup Guard: ${next === mode ? '✓ ' : ''}${next} for ${host}`, () => {
        const current = GM_getValue(key, {});
        const updated = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
        if (next === 'off') delete updated[host];
        else updated[host] = next;
        GM_setValue(key, updated);
        location.reload();
      });
    }
  }

  if (mode === 'off' || mode === 'allow') return;

  const page = unsafeWindow;
  const originalOpen = page.open;
  const isNewWindow = target => {
    const value = String(target || '').trim().toLowerCase();
    return value !== '_self' && value !== '_top' && value !== '_parent';
  };
  const hasActivation = () => navigator.userActivation?.isActive === true;
  const shouldBlock = trusted => mode === 'strict' || !trusted;

  page.open = function (...args) {
    // window.open with no target defaults to _blank. Preserve native return values.
    if (isNewWindow(args[1]) && shouldBlock(hasActivation())) return null;
    return Reflect.apply(originalOpen, this, args);
  };

  function intercept(event) {
    if (!shouldBlock(event.isTrusted)) return;
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    const element = event.type === 'submit' ? target.closest('form') : target.closest('a, area');
    if (!element || element.hasAttribute('download')) return;
    const explicit = element.getAttribute('target');
    const base = document.querySelector('base[target]');
    const destination = explicit === null ? base?.getAttribute('target') : explicit;
    // An absent or empty target navigates the current browsing context.
    if (!destination || !isNewWindow(destination)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  document.addEventListener('click', intercept, true);
  document.addEventListener('auxclick', intercept, true);
  document.addEventListener('submit', intercept, true);

  const originalSubmit = page.HTMLFormElement.prototype.submit;
  page.HTMLFormElement.prototype.submit = function (...args) {
    const explicit = this.getAttribute('target');
    const base = document.querySelector('base[target]');
    const target = explicit === null ? base?.getAttribute('target') : explicit;
    if (target && isNewWindow(target) && shouldBlock(hasActivation())) return;
    return Reflect.apply(originalSubmit, this, args);
  };
})();
