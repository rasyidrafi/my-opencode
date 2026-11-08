# Personal userscripts

## Popup Guard

`popup-guard.user.js` is a local, opt-in experiment. Install it with Violentmonkey, open the site you want to protect, then use the extension's Popup Guard menu to choose a mode. The menu reloads that site to apply the change.

- **Off** (default): do nothing on this exact hostname.
- **Balanced**: block new windows and targeted links/forms without a current trusted user activation; allow user-initiated actions. Some ads exploit a genuine click and can still get through.
- **Strict**: block all new windows, named targets, and links/forms targeting a new window, even when clicked. Use Off or Allow temporarily for sign-in, payments, and other legitimate popups.
- **Allow**: explicitly leave the hostname unmodified. This is a per-host allow list; subdomains are separate.

Rules belong to this script's userscript-manager storage and are not automatically migrated from the other scripts. Frames use their own hostname's rule, not their parent site's rule. Changes affect new page loads; other open tabs need a reload. Leave the original blockers disabled while testing to avoid interference, but do not delete them until satisfied.

This is not an ad blocker or a security boundary. Browser-native popup blocking and uBlock Origin Lite remain useful. Same-tab navigation, server redirects, direct `location` assignments, some iframe/browser actions, and popups opened during a genuine activation can escape interception. Browser restrictions prevent reliably overriding `location`; this script intentionally does not claim to stop such redirects. Named targets may be existing windows, so strict mode can block legitimate actions. `window.open` interception relies on the userscript manager providing page-world access via `unsafeWindow`; browser or manager changes may reduce coverage.

The design was informed by the installed MIT-licensed Ultra Popup Blocker v2 (1Tdd), BlockPup (0xArCHDeViL), and Stop Nefarious Redirects; no source code or bundled domain lists are copied. In particular, this avoids their substring-based trust decisions, asynchronous popup return values, and attempted location overrides.
