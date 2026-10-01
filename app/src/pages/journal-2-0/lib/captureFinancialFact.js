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

// Ruling 149: a locked note takes no captures. `append_financial_fact`'s
// server half refuses with 423 (`notes_service.NoteLockedError`); this names
// that outcome to the two capture functions below rather than letting it
// read as the generic 'Capture failed' every OTHER failure uses — the member
// needs to know WHY nothing landed, and that the fact row still exists
// un-placed (it is not retried or deleted here; it simply never got a node).
async function insertFactNode(noteId, factId) {
  const res = await fetch(`/api/j2/notes/${noteId}/facts/${factId}/insert`, {
    method: 'POST', credentials: 'include',
  })
  if (res.status === 423) return 'locked'
  if (!res.ok) return false
  // ⛔⛔ `append_financial_fact` advanced this note's revision. Unlanded, it
  // reads to the offline queue as a stranger's write and forks the member's
  // note against their own saved price.
  await settleNoteWrite(noteId, res)
  return true
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
    const outcome = await insertFactNode(noteId, fact.id)
    if (outcome === 'locked') {
      return `${ticker} price not saved — that note is locked. Unlock it in the Notebook first.`
    }
    if (!outcome) return 'Capture failed — try again'
    return `${ticker} price captured to Notebook`
  } catch {
    return 'Capture failed — try again'
  }
}

/** G-062 (wave 10, lane G62) — the analyst-consensus twin of
 * capturePriceToNotebook, mirrored exactly (same capture call shape, same
 * frozen-at-insert settle, same honest failure text): TickerPopup's second
 * "Save … to Notebook" door, beside the price one. The only differences are
 * `factType` and the success line. Never throws. */
export async function captureConsensusToNotebook(ticker) {
  try {
    const noteId = await resolveDestinationNoteId(ticker)
    if (!noteId) return 'Capture failed — try again'
    const factRes = await fetch(`/api/j2/notes/${noteId}/facts`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, factType: 'analyst_price_target_consensus' }),
    })
    // A refusal here is most likely the honest "no consensus available"
    // path (note_facts.create_fact_observation) — FMP unconfigured, or no
    // consensus for this ticker. Never fabricate a number; the generic
    // failure line is the same one every other capture failure uses.
    if (!factRes.ok) return 'Capture failed — try again'
    const { fact } = await factRes.json()
    const outcome = await insertFactNode(noteId, fact.id)
    if (outcome === 'locked') {
      return `${ticker} analyst consensus not saved — that note is locked. Unlock it in the Notebook first.`
    }
    if (!outcome) return 'Capture failed — try again'
    return `${ticker} analyst consensus captured to Notebook`
  } catch {
    return 'Capture failed — try again'
  }
}
