/**
 * UCT News -> UCT Notebook: "Send to Notebook" on a headline.
 *
 * ONE door, the Notebook's own: `sendCaptureToJournal` (pages/journal-2-0/lib/sendToJournal.js)
 * with the capture-only kind `tradeExchangeHeadline` (widgets/registry.js). It lands in the
 * member's current note, or the Notebook inbox when there is none -- the same route every
 * Charts widget's capture takes, so the Notebook's offline guard, write settling and
 * telemetry all apply, and nothing here writes a note itself. The member stays on Charts.
 *
 * The capture is a FROZEN reference: the headline verbatim, UCT's receipt time, the source,
 * the tickers the resolver linked, and the headline's permanent `event_id` (the R2 journal
 * key), so the Notebook card names exactly which archived headline it came from. Sending
 * never bookmarks, and bookmarking never sends.
 *
 * Repeats: a second click while a send is in flight is the same send (never two embeds);
 * a send that just succeeded asks for one more deliberate click ("Send again") before it
 * sends the same headline again.
 */
export const NOTEBOOK_KIND = 'tradeExchangeHeadline'
export const SOURCE = 'Trade Exchange'
const RECENT_MS = 20_000

const _inflight = new Map()     // event id -> Promise
const _sentAt = new Map()       // event id -> ms of the last successful send

const FAILED = new Set(['Capture failed — try again', 'This note is still syncing — try again in a moment.'])

/** The frozen capture for one headline (pure). */
export function headlineCapture(item) {
  return {
    eventId: String(item.id),
    content: String(item.content || ''),
    receivedAtMs: Number(item.received_at_ms) || 0,
    source: SOURCE,
    tickers: [...new Set((item.tickers || []).filter((t) => typeof t === 'string' && t))],
  }
}

/** True when this headline was sent a moment ago: the next send must be asked for again. */
export const sentRecently = (id, now = Date.now()) => now - (_sentAt.get(String(id)) || 0) < RECENT_MS

/** Send one headline. -> { ok, text } (the Notebook's own sentence for where it went). */
export function sendHeadlineToNotebook(item) {
  const id = String(item.id)
  if (_inflight.has(id)) return _inflight.get(id)
  const run = (async () => {
    try {
      const { sendCaptureToJournal } = await import('../pages/journal-2-0/lib/sendToJournal')
      const text = await sendCaptureToJournal(NOTEBOOK_KIND, headlineCapture(item), { label: 'Headline' })
      const ok = typeof text === 'string' && !FAILED.has(text)
      if (ok) _sentAt.set(id, Date.now())
      return { ok, text: typeof text === 'string' ? text : 'Could not send to Notebook — try again' }
    } catch {
      return { ok: false, text: 'Could not send to Notebook — try again' }
    } finally {
      _inflight.delete(id)
    }
  })()
  _inflight.set(id, run)
  return run
}

export function _resetNotebookSendsForTests() {
  _inflight.clear()
  _sentAt.clear()
}
