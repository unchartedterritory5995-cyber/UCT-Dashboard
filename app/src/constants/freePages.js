// S9 CP1 follow-up — FREE_PAGES was hand-typed identically in THREE files
// (AuthGuard.jsx, mobile/MoreSheet.jsx, NavBar.jsx), each carrying a "keep in
// sync with" comment pointing at the other two. One value, one place.
//
// ⭐ OWNER RULING 2026-10-02 (TERM-081 / OI-12): "Everything is paywall."
// There are NO free member pages. The Morning Wire, the free tier's only page
// since 2026-07-19, is paid like everything else. The server enforces the same
// thing (`api/routers/engine_data.py` gates `/api/rundown` on `require_paid`).
// The rail is `freePages.paywallAll.test.js`.
//
// ⛔ THE MATCHING LOGIC STAYS AT EACH CALL SITE, DELIBERATELY NOT EXPORTED
// HERE ALONGSIDE THE VALUE. AuthGuard.jsx tests a live `location.pathname`
// (which could be any nested path a member navigates to) and needs PREFIX
// matching (`.some(p => pathname.startsWith(p))`); NavBar.jsx/MoreSheet.jsx
// test one FIXED nav-item target string (`item.to`, always exactly one of the
// declared NAV_ITEMS paths, never a sub-path) and EXACT matching
// (`.includes(item.to)`) is correct there, not a bug to converge. Exporting a
// single `isFreePage()` here would force one semantic onto both questions,
// which is wrong for whichever side didn't need it. Only the VALUE was ever
// actually duplicated — this file ends that, and nothing else.
export const FREE_PAGES = []

// Where a signed-in member without a paid plan is sent: the existing upgrade
// screen (`pages/Subscribe.jsx`), the same place every locked nav row already
// pointed. It is OUTSIDE AuthGuard, so bouncing to it can never loop through
// the guard. ⛔ It must never be a member page: with FREE_PAGES empty, a
// member page here would bounce to itself forever.
export const UPGRADE_PATH = '/subscribe'
