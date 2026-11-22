// Whether the whole app is going away. Its own tiny module because the app shell needs to set it
// (lib/reloadGuard.js) and importing it from PopoutWindow put that whole Charts file on every
// page's first load.
let appClosing = false

/**
 * The whole app is going away (desktop quit, a forced reload), so a window closing
 * now is part of that and not the member closing it. Stops the close from docking
 * the board, which would delete the record the next launch needs.
 */
export function markAppClosing() { appClosing = true }

/** The reload did not happen (the member answered Stay on a Leave site prompt): closes dock boards again. */
export function clearAppClosing() { appClosing = false }

export function isAppClosing() { return appClosing }

/** Tests only. */
export function __resetAppClosingForTests() { appClosing = false }
