/**
 * Wave 7 lane H (H2) — writing help's REQUEST: the choices, the language list,
 * the sentences, and the SSE client. Imported only by the LAZY preview panel
 * (WritingHelpPanel.jsx), so none of it is in a note's first open; the eager
 * half (scope capture, Accept) is `writingHelp.js`.
 */
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

