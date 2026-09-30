// Wave 10 (lane TY). Owner finding, L12 full proof walk 62e252649: G-131 (touch)
// read BROKEN after the toolbar re-render bailout landed, because a render-time
// `editor` read existed that the toolbar-sync SIGNATURE (`readToolbarFormatState`
// in NoteEditorPage.jsx) did not cover. This is the requested rail: it GREPS
// NoteEditorPage.jsx and every component it hands `editor` to for exactly the
// reads that can go stale behind a bailed-out render, and asserts the set
// EXACTLY matches a named, reasoned list -- so an ADDED read (a new toolbar
// control, a new child reading `editor` at render time) fails here by name
// before it can go stale in production, and a REMOVED one leaves a stale
// entry this test would also catch, rather than the list silently drifting
// from the code the way "48 modules unreachable" or the writer-index counts
// this repo keeps re-deriving from hand-typed lists did.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DIR = path.resolve(__dirname)
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8')

const READ_RE = /editor\.isActive\(|editor\.getAttributes\(|editor\.can\(\)|editor\.state\?\.selection|editor\.state\.selection/g

/** Real code lines only -- a JSDoc line (trimmed, starts with `*`) or a `//`
 *  comment can quote `editor.isActive(...)` as PROSE (this very file's own
 *  audit table in NoteEditorPage.jsx does), and that is not a render-time
 *  read. */
function findReads(src) {
  const lines = src.split('\n')
  const hits = []
  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) return
    READ_RE.lastIndex = 0
    // One hit per MATCHING line, not per match within it: every consumer below
    // keys on the line's trimmed text (a Set, or an exact-map lookup), so a
    // line with two reads (the colour glyph's getAttributes call, twice) would
    // only ever produce one distinct entry anyway.
    if (READ_RE.test(line)) hits.push({ line: i + 1, text: trimmed })
  })
  return hits
}

// Every render-time read this file (or a child it hands `editor` to without
// that child owning its own subscription) currently makes, keyed by its exact
// trimmed source line, with WHY it is safe: either the name of the
// toolbar-sync signature field that makes React re-render when it changes, or
// "event/effect" for a read that runs at click/effect time (always live,
// this reducer cannot make it stale).
const NOTE_EDITOR_PAGE_READS = {
  // readToolbarFormatState's own body -- the signature IS these reads.
  "bold: editor.isActive('bold'),": 'bold',
  "italic: editor.isActive('italic'),": 'italic',
  "h1: editor.isActive('heading', { level: 1 }),": 'h1',
  "h2: editor.isActive('heading', { level: 2 }),": 'h2',
  "bulletList: editor.isActive('bulletList'),": 'bulletList',
  "orderedList: editor.isActive('orderedList'),": 'orderedList',
  "blockquote: editor.isActive('blockquote'),": 'blockquote',
  "codeBlock: editor.isActive('codeBlock'),": 'codeBlock',
  "fontFamily: editor.getAttributes('textStyle').fontFamily || '',": 'fontFamily',
  "fontSize: editor.getAttributes('textStyle').fontSize || '',": 'fontSize',
  "textColor: editor.getAttributes('textColor').color || '',": 'textColor',
  "highlightActive: editor.isActive('highlight'),": 'highlightActive',
  "highlightColor: editor.isActive('highlight') ? (editor.getAttributes('highlight').color || 'yellow') : '',": 'highlightActive/highlightColor',
  "selectionEmpty: Boolean(editor.state?.selection?.empty),": 'selectionEmpty',
  // canRunHistory's own body -- shared by canUndo/canRedo AND canBlockquote
  // (G-131 second finding: canRunHistory(editor, 'toggleBlockquote')), one
  // source line covers every caller.
  'try { return Boolean(editor.can()[cmd]?.()) } catch { return false }': 'canUndo/canRedo/canBlockquote (via canRunHistory)',
  // the toolbar JSX -- LIVE reads at NoteEditorPage's OWN render time, each
  // covered by the signature field of the same name above.
  "value={editor.getAttributes('textStyle').fontFamily || ''}": 'fontFamily',
  "value={editor.getAttributes('textStyle').fontSize || ''}": 'fontSize',
  "active={editor.isActive('bold')}": 'bold',
  "active={editor.isActive('italic')}": 'italic',
  '<span className={`${styles.colorGlyph} ${editor.getAttributes(\'textColor\').color ? textColorClass(editor.getAttributes(\'textColor\').color) : \'\'}`}>A</span>': 'textColor',
  "active={editor.isActive('heading', { level: 1 })}": 'h1',
  "active={editor.isActive('heading', { level: 2 })}": 'h2',
  "active={editor.isActive('bulletList')}": 'bulletList',
  "active={editor.isActive('orderedList')}": 'orderedList',
  "active={editor.isActive('blockquote')}": 'blockquote',
  "active={editor.isActive('codeBlock')}": 'codeBlock',
  // event handlers -- never render time. (`editor.state.doc` reads -- the
  // task-open effect, the conflict-merge walk -- use `.doc`, not `.selection`,
  // so this file's READ_RE does not even see them; they are not listed here.)
  'const sel = editor.state.selection': 'event: CaptureInboxTray.place(cap), a click handler',
}

describe('NoteEditorPage.jsx: every render-time (or handler/effect) editor read is named and reasoned', () => {
  const src = read('NoteEditorPage.jsx')

  it('the file\'s reads are EXACTLY the named set -- an addition or removal fails here first', () => {
    const found = new Set(findReads(src).map((h) => h.text))
    const known = new Set(Object.keys(NOTE_EDITOR_PAGE_READS))
    const added = [...found].filter((t) => !known.has(t))
    const removed = [...known].filter((t) => !found.has(t))
    expect({ added, removed }).toEqual({ added: [], removed: [] })
  })

  it('non-vacuity: the named set is not empty and covers real, distinct signature fields', () => {
    const fields = new Set(Object.values(NOTE_EDITOR_PAGE_READS).filter((v) => !v.startsWith('event') && !v.startsWith('effect')))
    expect(fields.size).toBeGreaterThan(5)
  })
})

describe('TextColorMenu.jsx: every render-time editor read matches a field readToolbarFormatState covers', () => {
  it('reads exactly textColor + highlight, covered by textColor/highlightActive/highlightColor', () => {
    const src = read('TextColorMenu.jsx')
    const hits = findReads(src)
    expect(hits.map((h) => h.text)).toEqual([
      "const textColor = editor.getAttributes('textColor').color || null",
      "const highlighted = editor.isActive('highlight')",
      "const highlightColor = highlighted ? (editor.getAttributes('highlight').color || 'yellow') : null",
    ])
  })
})

describe('control: LinkPasteMenu / NoteStats / NoteOutline / TableToolbar own their re-render (not on the audit list because they need no field here)', () => {
  it('each carries its own subscription to editor doc/selection changes -- direct editor.on(\'transaction\', …) (LinkPasteMenu, TableToolbar), or lib/onDocChange.js\'s wrapper around the same event (NoteStats, NoteOutline) -- so this reducer\'s bailout cannot make any of them stale', () => {
    for (const f of ['LinkPasteMenu.jsx', 'NoteStats.jsx', 'NoteOutline.jsx', 'TableToolbar.jsx']) {
      const src = read(f)
      const direct = /editor\.on\(['"]transaction['"]/.test(src)
      const viaOnDocChange = /onDocChange\(editor/.test(src)
      expect(direct || viaOnDocChange, `${f}: neither a direct 'transaction' subscription nor onDocChange(editor, …)`).toBe(true)
    }
    // control: onDocChange.js itself really does subscribe to 'transaction' -- the
    // indirection above is only sound if this is still true.
    expect(read('../../lib/onDocChange.js')).toMatch(/editor\.on\(['"]transaction['"]/)
  })

  it('TableToolbar.jsx specifically: it reads FAR more than one field at render time (tableAtSelection, six commands\' worth of editor.can(), plus sortable/ctx/width/header) -- that shape is why it got a subscription instead of growing the signature', () => {
    const src = read('TableToolbar.jsx')
    // Two explicit, independent reads: whether the caret is in a table AT ALL
    // (tableAtSelection), and whether a SPECIFIC command can run right now
    // (editor.can(), read once per CONTROLS row -- six of them -- via `can(cmd)`).
    // Both are live at render time and neither is one boolean.
    expect(src).toMatch(/tableAtSelection\(editor\.state\)/)
    expect(src).toMatch(/editor\.can\(\)\[cmd\]/)
  })
})
