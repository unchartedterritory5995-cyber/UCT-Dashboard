import { useEffect, useState } from 'react'

const cache = new Map()        // spec JSON -> number | null
const inflight = new Map()     // spec JSON -> Promise
let active = 0
const queue = []
const LIMIT = 12
const BATCH_MAX = 30           // the server's cap on one /count/batch request
let batchDown = false          // the batch route answered 404: use /count for the page lifetime
export function __resetCountCache() { cache.clear(); inflight.clear(); queue.length = 0; active = 0; batchDown = false }

function pump() {
  while (active < LIMIT && queue.length) {
    const job = queue.shift(); active++
    job().finally(() => { active--; pump() })
  }
}
function countFor(spec) {
  const key = JSON.stringify(spec)
  if (cache.has(key)) return Promise.resolve(cache.get(key))
  if (inflight.has(key)) return inflight.get(key)
  const p = new Promise(resolve => {
    queue.push(async () => {
      let v = null
      try {
        const r = await fetch('/api/screener/count', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key })
        if (r.ok) { const j = await r.json(); v = Number.isFinite(j?.count) ? j.count : null }
      } catch { v = null }
      // a failure is never cached: the next open retries
      if (v !== null) cache.set(key, v)
      inflight.delete(key); resolve(v)
    })
    pump()
  })
  inflight.set(key, p)
  return p
}

// One POST for up to BATCH_MAX specs. entries: [{ key, spec, settle }].
// Per item: a number is cached; {error} or anything unreadable is null and NOT cached.
function sendBatch(entries) {
  queue.push(async () => {
    let vals = null          // null = the batch route is missing (404): fall back below
    try {
      const r = await fetch('/api/screener/count/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specs: entries.map(e => e.spec) }),
      })
      if (r.status === 404) batchDown = true
      else if (!r.ok) vals = entries.map(() => null)
      else {
        const j = await r.json()
        vals = entries.map((_, i) => (Number.isFinite(j?.counts?.[i]?.count) ? j.counts[i].count : null))
      }
    } catch { vals = entries.map(() => null) }
    if (vals === null) {
      // Hand the keys back to the per-spec path. It runs OUTSIDE this job so a full
      // set of batch jobs cannot wait on queue slots they are themselves holding.
      for (const e of entries) inflight.delete(e.key)
      Promise.all(entries.map(e => countFor(e.spec))).then(vs => entries.forEach((e, i) => e.settle(vs[i])))
      return
    }
    entries.forEach((e, i) => {
      if (vals[i] !== null) cache.set(e.key, vals[i])
      inflight.delete(e.key); e.settle(vals[i])
    })
  })
  pump()
}

// A promise per spec. Cached and in-flight specs are shared; the rest go out in batches.
function countMany(specs) {
  const fresh = []
  const promises = specs.map(spec => {
    const key = JSON.stringify(spec)
    if (cache.has(key)) return Promise.resolve(cache.get(key))
    if (inflight.has(key)) return inflight.get(key)
    if (batchDown) return countFor(spec)
    let settle
    const p = new Promise(resolve => { settle = resolve })
    inflight.set(key, p)
    fresh.push({ key, spec, settle })
    return p
  })
  for (let i = 0; i < fresh.length; i += BATCH_MAX) sendBatch(fresh.slice(i, i + BATCH_MAX))
  return promises
}

// undefined = not asked yet, null = the count failed (never 0)
export default function useLazyCounts(specsById, enabled) {
  const [counts, setCounts] = useState({})
  const sig = enabled ? JSON.stringify(specsById) : ''
  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    const pending = []
    for (const [id, spec] of Object.entries(specsById || {})) {
      const key = JSON.stringify(spec)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a cached count lands in the same pass as the fetches for the rest
      if (cache.has(key)) { setCounts(c => (c[id] === cache.get(key) ? c : { ...c, [id]: cache.get(key) })); continue }
      pending.push([id, spec])
    }
    countMany(pending.map(([, spec]) => spec)).forEach((p, i) => {
      p.then(v => { if (alive) setCounts(c => ({ ...c, [pending[i][0]]: v })) })
    })
    return () => { alive = false }
  }, [sig, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return counts
}
