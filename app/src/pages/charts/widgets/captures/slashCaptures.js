// Notebook widgets Task 16: the ONE module the Notebook's / menu loads when a capture-kind command runs
// (lib/notebookWidgets.js CAPTURE_KINDS). Keyed by widget id; each answers `{ok, payload}` or
// `{ok: false, reason}` and never throws. A kind added here costs the Notebook's first open nothing.
export { slashCapture as calendar } from './calendarCapture'
export { slashCapture as news } from './newsCapture'
export { slashCapture as fundamentals } from './fundamentalsCapture'
