/**
 * Wave 7 lane H (H2) — editor writing help, the client half.
 *
 * The server (`api/routers/notebook_writing_help.py`) streams a draft; the
 * member reads it in a PREVIEW (WritingHelpPanel.jsx) and decides. This module
 * holds the parts with rules in them, so they are testable without the panel:
 *
 *   captureWritingHelpScope(editor) — what the member asked about: the
 *     selection, or the whole note when nothing is selected;
 *   acceptWritingHelp(editor, ...)  — the ONE document write: an `askInsert`
 *     block carrying `action` + `model` (ruling D-H1, no new node type),
 *     replacing the selection or at the caret, as ONE undo step.
 *
 * ⛔⛔ A DRAFT NEVER TOUCHES THE DOCUMENT. It lives in the panel's state until
 * Accept. Discard therefore removes nothing, because nothing was there — and
 * the autosave and the offline layer never see words the member did not keep.
 */
import { closeHistory } from '@tiptap/pm/history'
import { TextSelection } from '@tiptap/pm/state'

// ⛔ EAGER, SO KEPT SMALL: the editor page and the slash menu import this file
// on every note open. The request itself -- the SSE client, the choices, the
// languages, the sentences -- is `writingHelpStream.js`, which only the LAZY
// panel imports, so a note opens without it.

/** Dispatched by SlashMenu's "Writing help" item on ITS editor's DOM root. */
export const WRITING_HELP_EVENT = 'uct:notebook-writing-help'

/**
 * What the member is asking about, captured when the panel OPENS.
 * → `{ scope: 'selection'|'whole', text, range: {from, to}, originalText }`.
 * A text selection is the passage; a caret (or a selected block node) means
 * the whole note, inserted at the caret — never replacing a selected node.
 */
export function captureWritingHelpScope(editor) {
  if (!editor || editor.isDestroyed) return null
  const { state } = editor
  const sel = state.selection
  if (!sel.empty && !sel.node) {
    const text = state.doc.textBetween(sel.from, sel.to, '\n\n', ' ')
    if (text.trim()) {
      return { scope: 'selection', text, range: { from: sel.from, to: sel.to }, originalText: text }
    }
  }
  const text = state.doc.textBetween(0, state.doc.content.size, '\n\n', ' ')
  return { scope: 'whole', text, range: { from: sel.to, to: sel.to }, originalText: null }
}

/** The draft as paragraphs: blank lines separate, single newlines join. */
export function draftParagraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
}

/**
 * Accept: insert ONE `askInsert` block — `action` + `model` + the existing
 * (`draft` is the accepted text; named apart from the REQUEST's `text`, the
 * passage it was written from, so the two can never be swapped by a spread.)
 * `insertedAt` / `scope` / `question` (= the instruction) — replacing the
 * selection it was written from, or at the caret. ONE undo step.
 *
 * ⛔ The selection is replaced ONLY while it still holds the words the draft
 * was written from. If they changed underneath the panel, the block goes in
 * after the current selection and nothing the member wrote is deleted
 * (`replaced: false` tells the caller to say so).
 * → `{ ok, replaced }` or `{ ok: false, reason }`.
 */
export function acceptWritingHelp(editor, {
  draft, action, model, instruction, scope, range, originalText, now = new Date(),
}) {
  if (!editor || editor.isDestroyed || !editor.isEditable) return { ok: false, reason: 'not-editable' }
  const paras = draftParagraphs(draft)
  if (!paras.length) return { ok: false, reason: 'empty' }
  const node = {
    type: 'askInsert',
    attrs: {
      insertedAt: now.toISOString(), scope: scope || null, question: instruction || '',
      action: action || null, model: model || null,
    },
    content: paras.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
  }
  const { doc, selection } = editor.state
  const size = doc.content.size
  let from
  let to
  let replaced = false
  if (scope === 'selection' && range && originalText != null
      && range.from >= 0 && range.to <= size && range.from < range.to
      && doc.textBetween(range.from, range.to, '\n\n', ' ') === originalText) {
    ;({ from, to } = range)
    replaced = true
  } else {
    from = selection.to
    to = selection.to
  }
  const before = editor.state.doc
  const ok = editor.chain()
    .command(({ tr }) => { closeHistory(tr); return true })
    .insertContentAt({ from, to }, node)
    .command(({ tr }) => caretAfterBlock(tr, node.attrs.insertedAt))
    .run()
  // A transaction a filter refused (an askInsert edge) changes nothing and
  // still reports success, so the DOCUMENT is the only honest witness.
  if (!ok || editor.state.doc.eq(before)) return { ok: false, reason: 'blocked' }
  if (!editor.isDestroyed) editor.view.dispatch(closeHistory(editor.state.tr))
  return { ok: true, replaced }
}

/**
 * ⛔ THE CARET LANDS AFTER THE BLOCK, NEVER IN IT (wave 7 whole-branch fix, frontend review
 * I-2 -- the G-064 close-out lesson, `askInsert.js` `caretAfterAnswer`, reused here).
 *
 * `insertContentAt` leaves the selection at the end of what it inserted. With the caret at the
 * end of a paragraph (the whole-note case at the end of a note) that is INSIDE the block's last
 * paragraph: the Sheet hands focus back to the editor and the member's next words went into a
 * block labelled "Compass · Summarize · …", which Ask then leaves out as not their writing.
 *
 * Within Accept's own transaction (so ONE undo takes it all back out): when the selection sits
 * inside the block just inserted, it moves into an empty paragraph directly after the block --
 * the one already there, or a new one. When the insert split a paragraph (the caret was
 * mid-text) the selection is already after the block and nothing is added: no stray empty line.
 * The editor is not focused here; the panel's close decides focus.
 */
function caretAfterBlock(tr, insertedAt) {
  const { $from } = tr.selection
  let depth = -1
  for (let d = $from.depth; d > 0; d -= 1) {
    const n = $from.node(d)
    if (n.type.name === 'askInsert' && n.attrs.insertedAt === insertedAt) { depth = d; break }
  }
  if (depth < 0) return true
  const paragraph = tr.doc.type.schema.nodes.paragraph
  if (!paragraph) return true
  const after = $from.after(depth)
  const next = tr.doc.nodeAt(after)
  if (!(next && next.type === paragraph && next.content.size === 0)) {
    const $after = tr.doc.resolve(after)
    if (!$after.parent.canReplaceWith($after.index(), $after.index(), paragraph)) return true
    tr.insert(after, paragraph.create())
  }
  tr.setSelection(TextSelection.create(tr.doc, after + 1))
  return true
}
