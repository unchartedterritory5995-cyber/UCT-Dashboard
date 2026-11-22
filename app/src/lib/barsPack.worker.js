/**
 * barsPack.worker.js — runs bars-pack shard ingests off the main thread (see barsPackIngest.js for
 * why and what each status means).
 *
 * Protocol, correlated by `id`:  { id, job: { url, batchSize, yieldBetween, replaceIfNewer } }
 *                             -> { id, status, written, aborted }
 */
import { ingestShard } from './barsPackIngest'

self.onmessage = async (e) => {
  const { id, job } = e.data || {}
  let res
  try {
    res = await ingestShard(job)
  } catch {
    res = { status: 'import-failed', written: 0, aborted: false }
  }
  self.postMessage({ id, ...res })
}
