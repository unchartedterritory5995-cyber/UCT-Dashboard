// S14 (audit 2026-11-05, detail #70): which keyboard-shortcut section works on the page the member is on, so the
// sheet (components/ShortcutCheatSheet.jsx, a lazy chunk) can put it FIRST. Kept apart from the sheet: the Journal
// shell reads it on every render, and importing the sheet for it would pull the sheet into the first open.

/** 'notebook' | 'positions' | 'journal', or null for a page with no section of its own. Ids are the sheet's. */
export function pageSection(pathname = '', search = '') {
  if (pathname.startsWith('/journal/notebook')) return 'notebook'
  // Trades opens on its Open segment by default (TradesSurface.jsx: no `seg` = open); Closed is the Trade Journal's.
  if (pathname.startsWith('/journal/trades')) return /(?:^|[?&])seg=closed(?:&|$)/.test(search) ? 'journal' : 'positions'
  return null
}
