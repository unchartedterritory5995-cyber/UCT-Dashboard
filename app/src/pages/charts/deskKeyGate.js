// While the Charts workspace is kept alive behind another page (a board or widget popped out), the
// widgets rendering into those windows still hold listeners on the OPENER's document and window:
// that is how popped charts receive keys at all (popout/PopoutWindow forwardKeyboard). So those
// listeners also hear keys typed on whatever page is showing in the main window.
//
// Telling the two apart is simple and exact: PopoutWindow re-fires a popup's key by dispatching a
// new event ON the opener's document, so its target IS the document, while a real keypress in the
// main window always targets an element (the focused node, or body).
//
// Only the listeners that act on bare keys consult this (chart hotkeys, the drawing overlay, the
// watchlist and theme-tracker arrow keys, the Ctrl+Alt+J capture); an Escape that closes one of the
// popped widget's own menus needs no guard.
let hidden = false

/** The workspace says whether it is currently hidden behind another page. */
export function markDeskHidden(next) {
  hidden = next === true
}

/** True for a key the member typed on another page while the desk is hidden. */
export function isHiddenDeskKey(e) {
  return hidden && !!e && e.target !== document
}
