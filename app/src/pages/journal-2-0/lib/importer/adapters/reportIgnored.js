/**
 * Shared "what did this adapter leave out" reporter — the fix for audit
 * B4 (2026-09-02): Evernote's `detect()` returns 1.0 for any drop containing
 * a `.enex` file, the Export Guide tells members to "drop them all in
 * together", and every adapter's `parse()` filtered `vfiles` down to what it
 * recognized and warned about NOTHING it skipped. A mixed drop (Evernote +
 * a Notion export, say) silently imported only the Evernote notes — no
 * warning, no count, a preview that looked entirely healthy.
 *
 * Each adapter calls this at the end of its own `parse()` with whatever
 * vfiles it did NOT consume — neither as a note/page source nor as media
 * referenced from a produced doc's body — so the member always learns, by
 * name and by count, exactly what did not make it into the import. This
 * does not change adapter selection or detect() scoring in any way (that
 * ordering — evernote > notion > obsidian > generic — is railed elsewhere
 * and untouched here); it only makes the LOSING platforms' files visible
 * instead of silently discarded.
 */
const MAX_NAMES = 8

/**
 * @param {import('../intake').VFile[]} ignored - vfiles this adapter did not import
 * @param {string} label - the adapter's own display label (e.g. "Evernote")
 * @returns {string[]} zero or one warning string
 */
export function reportIgnoredFiles(ignored, label) {
  if (!ignored || ignored.length === 0) return []
  const names = ignored.slice(0, MAX_NAMES).map((v) => v.path)
  const extra = ignored.length - names.length
  const more = extra > 0 ? `, and ${extra} more` : ''
  const noun = ignored.length === 1 ? 'file' : 'files'
  return [
    `${ignored.length} ${noun} in this drop ${ignored.length === 1 ? "wasn't" : "weren't"} ` +
      `recognized by the ${label} import and ${ignored.length === 1 ? 'was' : 'were'} not imported: ` +
      `${names.join(', ')}${more}. If ${ignored.length === 1 ? 'it belongs' : 'these belong'} to a ` +
      `different export (Notion, Obsidian, Evernote), import ${ignored.length === 1 ? 'it' : 'them'} separately.`,
  ]
}
