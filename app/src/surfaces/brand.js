/**
 * The product name a browser tab carries after a page's own title ("Charts — UCT Intelligence").
 *
 * ⛔ ONE AUTHORITY. It lives in its own module, with no imports, so a page outside the app
 * shell can use it without pulling the shell in: `pageTitle.js` (the shell's per-page titles)
 * imports NavBar, and the public share and published pages must not carry the whole nav in
 * their bundle to spell the brand. `pageTitle.js` re-exports it, so its callers are unchanged.
 */
export const APP_BRAND = 'UCT Intelligence'

/** "<what this page is> — UCT Intelligence". */
export const brandedTitle = (what) => `${what} — ${APP_BRAND}`
