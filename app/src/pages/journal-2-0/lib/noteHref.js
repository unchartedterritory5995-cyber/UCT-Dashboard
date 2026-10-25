// The one owner of a note's link and of opening a note in place (Task 10.17 fix round 2, moved from
// components/notebook/routines/toolEditorLib.js, which re-exports both unchanged).
//
// ⛔ NO IMPORTS. It depends on `window.history` and `PopStateEvent` only, so any surface, eager or lazy, may import it
// without pulling another module's code onto its path (lib/toolsCrud.lazy.test.js).

export const noteHref = (id) => `/journal/notebook?note=${encodeURIComponent(String(id))}`

/** Open a note from the editor (mounted on its OWN root, outside the app's router): a plain left click pushes the
 *  location the way the router's own history does and tells the router with `popstate`; a modified click is the
 *  browser's, since the row is a real link. Returns true when it navigated in place. */
export function openNoteInPlace(e, id) {
  if (!e || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
  if (typeof window === 'undefined' || !window.history?.pushState) return false
  e.preventDefault()
  const prev = window.history.state
  const idx = prev && typeof prev === 'object' && Number.isInteger(prev.idx) ? prev.idx + 1 : 0
  window.history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx }, '', noteHref(id))
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
  return true
}
