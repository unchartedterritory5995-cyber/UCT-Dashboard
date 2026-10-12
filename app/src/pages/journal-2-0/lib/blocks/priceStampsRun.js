// The lazy half of price stamps (IR-S12): the ticker resolver (and its taxonomy) load here, on the first
// stamp of a session, never on first open. Writes ONE thing that is not a note: a price fact row, through
// the trader-blocks stamp route (lib/blocks/blockDoors.test.js names this method+URL; the /price
// capture's own URL is a note URL, which that rail refuses). The SERVER decides what the price is and
// what it is as of: a live price during the regular session, outside it the last close dated by its
// session (api/services/journal_two/trader_blocks.py price_stamp_quote). Nothing here reads a clock or a
// session edge. The stub hands this module its plugin key and `settle` (rather than this module
// importing the stub): the stub lives in the editor's first-open chunk, and importing it from here would
// make this lazy chunk's preload list carry that whole chunk's dependency list into first open.
import { closeHistory } from '@tiptap/pm/history'
import { resolveCashtags } from '../../../../lib/tickerResolver'

const escapeRe = (s) => s.replace(/[.\-]/g, '\\$&')

/** The symbol a line names (R-P2-3): its first $CASHTAG, else the note's own ticker written as a whole
 *  word, else null. `noteTicker` is a string or a function that reads it live. */
export function lineTicker(text, noteTicker) {
  const tags = resolveCashtags(text)
  if (tags.length) return tags[0]
  const t = String((typeof noteTicker === 'function' ? noteTicker() : noteTicker) || '').toUpperCase()
  return t && new RegExp(`(^|[^A-Za-z0-9$])${escapeRe(t)}(?![A-Za-z0-9])`).test(text) ? t : null
}

/** The stamp's one write. → the created fact ({id, ...}) or null; never throws. */
export async function requestStamp({ noteId, symbol, signal }) {
  try {
    const res = await fetch('/api/j2/trader-blocks/price-stamp', {
      method: 'POST', credentials: 'include', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId, ticker: symbol }),
    })
    if (!res.ok) return null
    return (await res.json())?.fact || null
  } catch {
    return null
  }
}

/** `until`: the stamp's deadline (the Enter + STAMP_TIMEOUT_MS), chunk load already spent from it. */
export default async function runStamp({ editor, id, until, key, settle }) {
  const left = until - Date.now()
  if (!(left > 0)) { settle(editor, id); return }         // the chunk took the whole budget: no fetch
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), left)
  try {
    await stamp({ editor, id, key, settle, signal: ctl.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function stamp({ editor, id, key, settle, signal }) {
  const at = () => (editor.isDestroyed ? null : key.getState(editor.state)?.get(id))
  const start = at()
  const line = start == null ? null : editor.state.doc.nodeAt(start)
  const store = editor.storage.uctJournalWidgets || {}
  const symbol = line?.isTextblock ? lineTicker(line.textContent, store.noteTicker) : null
  if (!symbol || signal.aborted) { settle(editor, id); return }
  const fact = await requestStamp({ noteId: store.noteId, symbol, signal })
  if (editor.isDestroyed) return
  const pos = at()                                       // mapped through every edit since Enter
  const now = pos == null ? null : editor.state.doc.nodeAt(pos)
  if (!fact?.id || signal.aborted || !now) { settle(editor, id); return }   // IR-S3: line gone (pos null) -> nothing
  const tr = closeHistory(editor.state.tr)
    .insert(pos + now.nodeSize, editor.schema.nodes.financialFact.create({ factId: fact.id }))
    .setMeta(key, id)
  editor.view.dispatch(tr)
  // Seal the step (dictationInsert's rule): typing that follows starts its own undo event.
  if (!editor.isDestroyed) editor.view.dispatch(closeHistory(editor.state.tr))
}
