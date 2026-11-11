// services/pine_runtime/metrics.mjs
//
// W5-T9: the numbers `GET /v1/metrics` serves (docs/pine/SERVER-RUNTIME-DESIGN.md 3.8). In-memory,
// counted by the supervisor, and carrying NO source, NO member id and NO owner: the only keys are
// the closed profile names, the closed status words and guard names.
//
//   jobs         by profile, then by status (ok | withheld)
//   refusals     by guard: a job's own refusals (run-wide `*` or per output) and every request the
//                door refused (401, 400, 409, 422, 429, 503, 500)
//   latency_ms   p50 / p95 per profile over the last LATENCY_WINDOW jobs (nearest rank), the `ms`
//                the job adapter stamps on each result
//   instructions NOT MEASURED YET: the wire result carries no instruction count (job.mjs, T7).
//                Reported as null, never as 0, so a reader cannot take "none" for "free".
//   cache        (W5-INT) the result lane's own counts (cache.mjs createResultLane().stats(): hits,
//                misses, stored, entries, bytes); null when the server runs without a result cache.
//   queue/workers from the pool's own `stats()`; heap from this process (the supervisor's; a
//                worker's heap is capped by resourceLimits and not read here).
import { PROFILES } from './protocol.mjs'

export const LATENCY_WINDOW = 1000

/** Nearest-rank percentile of an unsorted list; null for an empty list. */
export function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}

export function createMetrics({ now = () => Date.now(), memory = () => process.memoryUsage() } = {}) {
  const started = now()
  const jobs = Object.fromEntries(PROFILES.map((p) => [p, { ok: 0, withheld: 0 }]))
  const refusals = new Map()
  const samples = Object.fromEntries(PROFILES.map((p) => [p, []]))
  let requests = 0

  const bump = (guard) => refusals.set(guard, (refusals.get(guard) || 0) + 1)

  return {
    /** A request the door refused before any job ran. */
    refused(guard) { bump(String(guard)) },
    /** A request that reached the runner and was answered whole. */
    answered(profile, results) {
      if (!jobs[profile]) return
      requests += 1
      for (const r of results) {
        jobs[profile][r.status === 'ok' ? 'ok' : 'withheld'] += 1
        for (const f of r.refusals || []) bump(f.guard)
        if (Number.isFinite(r.ms)) {
          const s = samples[profile]
          s.push(r.ms)
          if (s.length > LATENCY_WINDOW) s.shift()
        }
      }
    },
    snapshot({ identity = null, boot = null, pool = null, canary = null, cache = null } = {}) {
      const m = memory()
      return {
        protocol: 1,
        uptime_s: Math.round((now() - started) / 1000),
        boot,
        engine: identity,
        requests,
        jobs: structuredClone(jobs),
        refusals: Object.fromEntries([...refusals].sort(([a], [b]) => (a < b ? -1 : 1))),
        latency_ms: Object.fromEntries(PROFILES.map((p) => [p, { n: samples[p].length, p50: percentile(samples[p], 50), p95: percentile(samples[p], 95) }])),
        instructions: null,
        queue_depth: pool ? pool.queued : null,
        workers: pool ? { live: pool.live, starts: pool.starts, recycles: pool.recycles, kills: pool.kills, ooms: pool.ooms, crashes: pool.crashes } : null,
        cache,
        heap: { used_bytes: m.heapUsed, total_bytes: m.heapTotal, rss_bytes: m.rss },
        canary,
      }
    },
  }
}
