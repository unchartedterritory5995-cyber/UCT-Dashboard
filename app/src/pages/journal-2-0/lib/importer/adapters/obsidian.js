/**
 * Obsidian adapter — DETECTION ONLY for now. Real `parse()` lands in Task 11.
 *
 * Detection scores (per plan):
 *  - 0.95 when the export contains a `.obsidian/` config directory (a vault
 *    marker Obsidian writes on every vault, exported or not).
 *  - 0.6 when at least one `.md` file's CONTENT contains a `[[wikilink]]`.
 *    NOT implemented here: `detect(vfiles)` is a synchronous call (the
 *    registry test suite calls `detectAdapter(...)` without awaiting it), but
 *    `VFile.bytes()` is always async — there is no synchronous way to inspect
 *    file content from this signature. The `.obsidian/` directory marker is
 *    the only signal implemented; the content heuristic is deferred to
 *    whichever task changes the registry contract to async (or reads content
 *    during `parse()` instead of `detect()`).
 */

export const obsidianAdapter = {
  id: 'obsidian',
  label: 'Obsidian',
  detect,
  async parse() {
    throw new Error('not implemented')
  },
}

function detect(vfiles) {
  const hasObsidianDir = vfiles.some((v) => /(^|\/)\.obsidian\//i.test(v.path))
  if (hasObsidianDir) return 0.95
  return 0
}
