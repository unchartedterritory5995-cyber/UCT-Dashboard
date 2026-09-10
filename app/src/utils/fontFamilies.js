/* The approved typeface set, for every surface that lets a user pick a font.
 *
 * ⚰️ WHY THIS IS ITS OWN FILE. This table lived inside
 * `pages/journal-2-0/components/notebook/NoteEditorPage.jsx` as a private
 * const, which was fine while the Notebook was the only place a font could be
 * chosen. Phase 6 gives chart Text Notes a font picker, and a second hand-typed
 * list is how two surfaces end up offering "Helvetica" and "Helvetica Neue" and
 * nobody can say which is the approved one. One table, two importers.
 *
 * ⛔ NO WEB FONTS ARE LOADED FROM HERE, AND THAT IS DELIBERATE. Every entry is a
 * face already present on the platform or already loaded by the app's own CSS
 * (Instrument Sans). A picker that offers a font the browser has to fetch would
 * make a chart drawing depend on a network round trip to look right — and would
 * silently fall back to something else on a cold load, which is exactly the kind
 * of "my note changed" a trader should never see.
 *
 * ⭐ EACH VALUE IS A FULL CSS STACK, not a bare family name, so a missing face
 * degrades to a deliberate neighbour rather than to the browser default. The
 * same string is valid in `style.fontFamily` and in `ctx.font`, which is what
 * lets the DOM editor and the canvas painter agree by construction.
 *
 * `''` is the DEFAULT entry: it means "inherit whatever this surface's own
 * typography is", not "Arial". Resolving it is the caller's job.
 */
export const FONT_OPTIONS = Object.freeze([
  { label: 'Default', value: '' },
  { label: 'Sans Serif', value: 'Instrument Sans, Arial, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Monospace', value: 'Consolas, "Courier New", monospace' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", Helvetica, sans-serif' },
  { label: 'Calibri', value: 'Calibri, Candara, sans-serif' },
  { label: 'Century Gothic', value: '"Century Gothic", sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Garamond', value: 'Garamond, serif' },
  { label: 'Palatino', value: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
  { label: 'Cambria', value: 'Cambria, Georgia, serif' },
  { label: 'Baskerville', value: 'Baskerville, "Baskerville Old Face", serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'Lucida Sans', value: '"Lucida Sans Unicode", "Lucida Grande", sans-serif' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", "Comic Sans", cursive' },
  { label: 'Impact', value: 'Impact, Haettenschweiler, sans-serif' },
  { label: 'Brush Script MT', value: '"Brush Script MT", cursive' },
])

/** The label for a stored stack — what a picker shows as the current choice.
 *  Unknown stacks (a note from a future build, or hand-edited data) report
 *  themselves rather than silently reading as "Default". */
export function fontLabelFor(value) {
  if (!value) return 'Default'
  const hit = FONT_OPTIONS.find((f) => f.value === value)
  return hit ? hit.label : String(value).split(',')[0].replace(/["']/g, '').trim()
}
