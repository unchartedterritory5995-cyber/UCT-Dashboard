// app/src/pages/charts/groupSymSavePace.js
//
// ─── WHEN THE CHARTS BOARD SAVES THE LINKED TICKER TO THE ACCOUNT ────────────
//
// The ticker a colour group is on changes on screen at once; saving it (so a refresh or
// another device opens on the same symbol) is a POST /api/auth/preferences.
//
// ⚰️ MEASURED ON PRODUCTION 2026-11-14 (bench member, 40 charts at 0.7 s each): one save
// per chart, 38 in a 40-chart scan. Each took the server 0.17 s when calm and 0.7 to 2.1 s
// in the minutes after a restart (max 8.7 s), all for symbols the member had already left.
//
//   - a PICK (a change with no other change just before it) is saved `GROUP_SAVE_MS` later,
//     exactly as before;
//   - a SCAN (changes less than `GROUP_SCAN_GAP_MS` apart) is saved ONCE, `GROUP_SCAN_SAVE_MS`
//     after the last change: the symbol the member stopped on.
//
// Leaving the board, or the page going away (`pagehide`), saves a pending symbol at once.
// So a scan of forty charts is two saves (its first chart, and where it stopped), not forty.

/** A pick is saved this long after it. */
export const GROUP_SAVE_MS = 400
/** Changes closer together than this are a member scanning, not picking. */
export const GROUP_SCAN_GAP_MS = 1500
/** A scan is saved once, this long after its last change. */
export const GROUP_SCAN_SAVE_MS = 1500
