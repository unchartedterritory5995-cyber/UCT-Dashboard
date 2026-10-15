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
export const REQUEST_TIMEOUT_MS = 8000
// Resolves at once when the signal is already aborted; drops its listener when the timer wins.
const realSleep = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) { resolve(); return }
  let onAbort = null
  const t = setTimeout(() => { signal?.removeEventListener?.('abort', onAbort); resolve() }, ms)
  onAbort = () => { clearTimeout(t); resolve() }
  signal?.addEventListener?.('abort', onAbort, { once: true })
})

// Runs makeWork(innerSignal) bounded by REQUEST_TIMEOUT_MS and the caller's abort: either ends it with null.
// Plain AbortController + setTimeout (no AbortSignal.any/timeout: the iOS 16 floor). Never throws.
async function bounded(makeWork, signal) {
  const ctrl = new AbortController()
  let timer = null
  let onAbort = null
  const gone = new Promise((resolve) => {
    onAbort = () => { ctrl.abort(); resolve(null) }
    timer = setTimeout(onAbort, REQUEST_TIMEOUT_MS)
    if (signal?.aborted) onAbort()
    else signal?.addEventListener?.('abort', onAbort, { once: true })
  })
  const work = (async () => makeWork(ctrl.signal))().catch(() => null)
  try {
    return await Promise.race([work, gone])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onAbort)
  }
}

function getJson(fetchImpl, url, signal) {
  return bounded(async (inner) => {
    const r = await fetchImpl(url, { credentials: 'include', signal: inner })
    return r?.ok ? await r.json() : null
  }, signal)
}

async function readScreenshotInner({ noteId, url, signal, fetchImpl = globalThis.fetch, sleep = realSleep }) {
  if (!noteId || !url || signal?.aborted) return null
  let doc = null
  for (const ms of POLL_DELAYS_MS) {
    await sleep(ms, signal)
    if (signal?.aborted) return null
    const body = await getJson(fetchImpl, `/api/j2/notes/${encodeURIComponent(noteId)}/documents`, signal)
    const found = (Array.isArray(body?.documents) ? body.documents : []).find((d) => d?.attachmentUrl === url)
    if (found && DONE.has(found.status)) { doc = found; break }
  }
  if (!doc || doc.status !== 'ready' || signal?.aborted) return null
  const page = await getJson(fetchImpl, `/api/j2/notes/documents/${encodeURIComponent(doc.id)}/pages/1/text`, signal)
  const head = typeof page?.text === 'string' ? page.text.slice(0, HEADER_CHARS) : ''
  if (!head.trim() || signal?.aborted) return null
  const symbol = pickTicker(await bounded(() => tickersIn(head, fetchImpl), signal))
  if (!symbol || signal?.aborted) return null
  return { symbol, timeframe: timeframeFromText(head) }
}

export async function readScreenshot(args) {
  try {
    return await readScreenshotInner(args || {})
  } catch {
    return null
  }
}
