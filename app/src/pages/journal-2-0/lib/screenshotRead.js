// app/src/pages/journal-2-0/lib/screenshotRead.js
/**
 * Tier 2 part A, item 10 -- the network half: wait for the OCR the document pipeline already runs
 * on a pasted image (its text is NOT in the upload's answer), read page 1's header, ask the server
 * which ticker it names. BOUNDED: POLL_DELAYS_MS (about a minute) and then silence. Abortable: a
 * deleted image, another note, or an unmounted editor stops it (Review Focus 3). Never throws.
 */
import { pickTicker, timeframeFromText, HEADER_CHARS } from './screenshotSmarts'
import { tickersIn } from './smartChipsApi'

export const POLL_DELAYS_MS = [1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 10000, 10000]
const DONE = new Set(['ready', 'no_text', 'processing_failed'])
const realSleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener?.('abort', () => { clearTimeout(t); resolve() }, { once: true })
})

async function getJson(fetchImpl, url, signal) {
  try {
    const r = await fetchImpl(url, { credentials: 'include', signal })
    return r?.ok ? await r.json() : null
  } catch {
    return null
  }
}

export async function readScreenshot({ noteId, url, signal, fetchImpl = globalThis.fetch, sleep = realSleep }) {
  if (!noteId || !url || signal?.aborted) return null
  let doc = null
  for (const ms of POLL_DELAYS_MS) {
    await sleep(ms, signal)
    if (signal?.aborted) return null
    const body = await getJson(fetchImpl, `/api/j2/notes/${encodeURIComponent(noteId)}/documents`, signal)
    const found = (body?.documents || []).find((d) => d?.attachmentUrl === url)
    if (found && DONE.has(found.status)) { doc = found; break }
  }
  if (!doc || doc.status !== 'ready' || signal?.aborted) return null
  const page = await getJson(fetchImpl, `/api/j2/notes/documents/${encodeURIComponent(doc.id)}/pages/1/text`, signal)
  const head = typeof page?.text === 'string' ? page.text.slice(0, HEADER_CHARS) : ''
  if (!head.trim() || signal?.aborted) return null
  const symbol = pickTicker(await tickersIn(head, fetchImpl))
  if (!symbol || signal?.aborted) return null
  return { symbol, timeframe: timeframeFromText(head) }
}
