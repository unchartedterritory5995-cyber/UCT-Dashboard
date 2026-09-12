// Wave F — "Save price to Notebook" from a surface OUTSIDE the note editor
// (TickerPopup's door — checkpoint decision 29). Unlike a widget capture,
// a fact capture is a real, synchronous API call (checkpoint decision 30),
// so this reuses freshLastNote()'s "note you're working in, or start a new
// one" resolution from captureTargets.js rather than the full destination
// picker CaptureMenu offers widgets — there is no comment/target choice to
// make here, just "where does this go."
import { freshLastNote } from './captureTargets'
import { settleNoteWrite } from './offline/settleNoteWrite'

const LAST_NOTE_KEY = 'uct.jw.lastNote'

async function resolveDestinationNoteId(label) {
  const last = freshLastNote()
  if (last) return last.id
  const res = await fetch('/api/j2/notes', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: label }),
  })
  if (!res.ok) return null
  const note = (await res.json().catch(() => ({})))?.note
  if (note?.id) {
    try {
      localStorage.setItem(LAST_NOTE_KEY, JSON.stringify({
        id: note.id, ts: Date.now(), title: (note.title || '').trim() || null,
      }))
    } catch { /* private mode */ }
  }
  return note?.id || null
}

/** Captures the current price for `ticker` into the member's last-active
 * note (or a fresh one), returning a toast line — never throws. */
export async function capturePriceToNotebook(ticker) {
  try {
    const noteId = await resolveDestinationNoteId(ticker)
    if (!noteId) return 'Capture failed — try again'
    const factRes = await fetch(`/api/j2/notes/${noteId}/facts`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, factType: 'price' }),
    })
    if (!factRes.ok) return 'Capture failed — try again'
    const { fact } = await factRes.json()
    const insertRes = await fetch(`/api/j2/notes/${noteId}/facts/${fact.id}/insert`, {
      method: 'POST', credentials: 'include',
    })
    if (!insertRes.ok) return 'Capture failed — try again'
    // ⛔⛔ `append_financial_fact` advanced this note's revision. Unlanded, it
    // reads to the offline queue as a stranger's write and forks the member's
    // note against their own saved price.
    await settleNoteWrite(noteId, insertRes)
    return `${ticker} price captured to Notebook`
  } catch {
    return 'Capture failed — try again'
  }
}
