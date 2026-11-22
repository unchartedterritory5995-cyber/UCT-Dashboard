/**
 * Follow-up B, item 1: the Daily brief's address (the Notebook's notes day, `?view=today`). The Journal's Today tab
 * (Quick actions), the command palette and the setups board's way back link here, so the two day pages are one press
 * apart. Its own tiny module, so none of those (none is on the Notebook's first open) adds bytes to a module that is
 * (lib/notebookDoors.js is). Restated as a literal, not lib/todayHome.js's TODAY_VIEW, so this file imports nothing.
 */
export const NOTEBOOK_TODAY_TO = '/journal/notebook?view=today'
