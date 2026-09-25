/**
 * Wave 7 lane H (H2) — editor writing help, the client half.
 *
 * The server (`api/routers/notebook_writing_help.py`) streams a draft; the
 * member reads it in a PREVIEW (WritingHelpPanel.jsx) and decides. This module
 * holds the parts with rules in them, so they are testable without the panel:
 *
 *   captureWritingHelpScope(editor) — what the member asked about: the
 *     selection, or the whole note when nothing is selected;
 *   streamWritingHelp(...)          — the SSE request, every refusal a sentence;
 *   acceptWritingHelp(editor, ...)  — the ONE document write: an `askInsert`
 *     block carrying `action` + `model` (ruling D-H1, no new node type),
 *     replacing the selection or at the caret, as ONE undo step.
 *
 * ⛔⛔ A DRAFT NEVER TOUCHES THE DOCUMENT. It lives in the panel's state until
 * Accept. Discard therefore removes nothing, because nothing was there — and
 * the autosave and the offline layer never see words the member did not keep.
 */
import { closeHistory } from '@tiptap/pm/history'

/** Dispatched by SlashMenu's "Writing help" item on ITS editor's DOM root. */
export const WRITING_HELP_EVENT = 'uct:notebook-writing-help'

/** The actions, in the panel's order. `style` / `lang` complete two of them. */
export const WRITING_HELP_CHOICES = Object.freeze([
  { id: 'summarize', label: 'Summarize', action: 'summarize' },
  { id: 'rewrite-shorter', label: 'Rewrite shorter', action: 'rewrite', style: 'shorter' },
  { id: 'rewrite-clearer', label: 'Rewrite clearer', action: 'rewrite', style: 'clearer' },
  { id: 'rewrite-formal', label: 'Rewrite more formally', action: 'rewrite', style: 'formal' },
  { id: 'continue', label: 'Continue writing', action: 'continue' },
  { id: 'translate', label: 'Translate', action: 'translate' },
])

/**
 * ⛔ ONE FACT IN TWO FILES, PINNED: the server's allowlist is
 * `writing_help.LANGUAGES` (api/services/journal_two/writing_help.py), and
 * tests/test_notebook_writing_help.py PARSES this list and compares the two —
 * a language here the server refuses is a button that 422s; one there that is
 * missing here is a capability nobody can reach.
 */
export const WRITING_HELP_LANGUAGES = Object.freeze([
  ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
  ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ja', 'Japanese'], ['ko', 'Korean'],
  ['zh', 'Chinese (Simplified)'], ['hi', 'Hindi'], ['ar', 'Arabic'], ['ru', 'Russian'],
  ['en', 'English'],
])

/** The server's ceiling (writing_help.MAX_TEXT_CHARS), checked before sending. */
export const WRITING_HELP_MAX_CHARS = 20000

// The sentences the member reads. Server-authored `detail` wins wherever the
// server gave one (the budget sentence is the server's own words).
export const WH_MESSAGES = Object.freeze({
  budget: "You've used today's writing help — it resets at midnight ET",
  paid: 'Writing help requires a paid plan',
  gone: "Writing help isn't available for this note.",
  network: "Couldn't reach writing help. Nothing was changed in your note.",
  failed: 'Something went wrong writing that. Nothing was changed in your note.',
  empty: "Compass didn't write anything for that. Try again, or pick another action.",
  tooLong: `That's more text than writing help takes at once (${WRITING_HELP_MAX_CHARS.toLocaleString('en-US')} characters). Select a shorter passage.`,
  nothing: 'Select some text, or write something in this note first.',
})

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

/** Read the SSE frames out of a buffer: `[events, rest]`. */
export function drainSseEvents(buf) {
  const events = []
  let rest = buf
  let idx
  while ((idx = rest.indexOf('\n\n')) >= 0) {
    const block = rest.slice(0, idx)
    rest = rest.slice(idx + 2)
    const line = block.split('\n').find((l) => l.startsWith('data:'))
    if (!line) continue
    try { events.push(JSON.parse(line.slice(5))) } catch { /* partial frame */ }
  }
  return [events, rest]
}

/**
 * Stream one draft. → `{ ok, text, model, action, instruction, error }`.
 * ⛔ Every way it can fail comes back as a SENTENCE in `error` — the panel says
 * it; nothing here is ever a silent no-op. An abort returns `{ aborted: true }`.
 */
export async function streamWritingHelp({ noteId, choice, lang, scope, text, signal, onStart, onDelta }) {
  if (!text || !text.trim()) return { ok: false, error: WH_MESSAGES.nothing }
  if (text.length > WRITING_HELP_MAX_CHARS) return { ok: false, error: WH_MESSAGES.tooLong }
  const body = { action: choice.action, scope, text }
  if (choice.style) body.style = choice.style
  if (choice.action === 'translate') body.lang = lang
  let r
  try {
    r = await fetch(`/api/j2/notes/${encodeURIComponent(noteId)}/writing-help/stream`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') return { ok: false, aborted: true }
    return { ok: false, error: WH_MESSAGES.network }
  }
  if (!r.ok) {
    const d = await r.json().catch(() => null)
    const detail = typeof d?.detail === 'string' ? d.detail : ''
    if (r.status === 429) return { ok: false, error: detail || WH_MESSAGES.budget }
    if (r.status === 402) return { ok: false, error: WH_MESSAGES.paid }
    if (r.status === 404) return { ok: false, error: WH_MESSAGES.gone }
    if (r.status === 422 && detail) return { ok: false, error: detail }
    return { ok: false, error: WH_MESSAGES.failed }
  }
  if (!r.body?.getReader) return { ok: false, error: WH_MESSAGES.failed }
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let out = ''
  let meta = {}
  let error = null
  let finished = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let events
      ;[events, buf] = drainSseEvents(buf)
      for (const ev of events) {
        if (ev.type === 'start') {
          meta = { model: ev.model || null, action: ev.action || choice.action, instruction: ev.instruction || '' }
          onStart?.(meta)
        } else if (ev.type === 'delta' && ev.text) {
          out += ev.text
          onDelta?.(out)
        } else if (ev.type === 'final') {
          finished = true
          if (typeof ev.text === 'string') out = ev.text
        } else if (ev.type === 'error') {
          error = ev.detail || WH_MESSAGES.failed
        }
      }
    }
  } catch (e) {
    if (e?.name === 'AbortError') return { ok: false, aborted: true }
    return { ok: false, error: WH_MESSAGES.network }
  }
  if (error) return { ok: false, error }
  if (!finished) return { ok: false, error: WH_MESSAGES.failed }
  if (!out.trim()) return { ok: false, error: WH_MESSAGES.empty }
  return { ok: true, text: out, ...meta }
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
    .run()
  // A transaction a filter refused (an askInsert edge) changes nothing and
  // still reports success, so the DOCUMENT is the only honest witness.
  if (!ok || editor.state.doc.eq(before)) return { ok: false, reason: 'blocked' }
  if (!editor.isDestroyed) editor.view.dispatch(closeHistory(editor.state.tr))
  return { ok: true, replaced }
}
