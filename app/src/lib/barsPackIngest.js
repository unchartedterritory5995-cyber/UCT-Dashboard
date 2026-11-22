/**
 * One bars-pack shard: download, decode the columnar payload, import into IndexedDB.
 *
 * Runs in a Web Worker (`barsPack.worker.js`) whenever the browser can start one, and on the main
 * thread otherwise. Both import THIS module, so there is one implementation.
 *
 * ⭐ WHY A WORKER (measured 2026-11-10, CPU profile of a new member's first visit to /dashboard):
 * over 25 s the main thread spent ~18 s on this work: 6.8 s in the IndexedDB success callback that
 * builds and serializes each series, 3.8 s of garbage collection, 1.7 s in `put`, 1.2 s decoding and
 * 0.6 s in `get`. The page was 65-95% busy for the whole first minute, so any click stuttered. None
 * of it needs the DOM: a worker has fetch, IndexedDB and the session cookie for same-origin requests.
 *
 * `ingestShard` returns `{ status, written, aborted }`, never throws:
 *   * 'fetch-failed'   the request threw (offline, aborted)
 *   * 'empty'          a non-ok response or a shard with no series (a real shard carries hundreds
 *                      of tickers, so this is a 404 / outage, never a valid empty shard)
 *   * 'import-failed'  decoding or the IndexedDB import threw
 *   * 'ok'             imported; `written` rows, `aborted` true on a quota / transaction abort
 */
import { idbImportPack } from '../utils/barsIDB'
import { decodeShardPayload } from './barsPackShard'

export async function ingestShard(job, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch
  const importPack = deps.importPack || idbImportPack
  let obj
  try {
    // ⚰️ The session cookie must go (see barsPackClient's header: 'omit' was an eleven-day outage).
    const r = await fetchImpl(job.url, { credentials: 'same-origin' })
    if (!r.ok) return { status: 'empty', written: 0, aborted: false }
    obj = await r.json()  // the browser transparently gunzips Content-Encoding: gzip
  } catch {
    return { status: 'fetch-failed', written: 0, aborted: false }
  }
  try {
    const entries = decodeShardPayload(obj)
    if (!entries.length) return { status: 'empty', written: 0, aborted: false }
    const res = await importPack(entries, { batchSize: job.batchSize, yieldBetween: job.yieldBetween, replaceIfNewer: !!job.replaceIfNewer })
    return { status: 'ok', written: res?.written || 0, aborted: !!res?.aborted }
  } catch {
    return { status: 'import-failed', written: 0, aborted: false }
  }
}
