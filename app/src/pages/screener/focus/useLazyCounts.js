import { useEffect, useState } from 'react'

const cache = new Map()        // spec JSON -> number | null
const inflight = new Map()     // spec JSON -> Promise
let active = 0
const queue = []
const LIMIT = 12
export function __resetCountCache() { cache.clear(); inflight.clear(); queue.length = 0; active = 0 }

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

// undefined = not asked yet, null = the count failed (never 0)
export default function useLazyCounts(specsById, enabled) {
  const [counts, setCounts] = useState({})
  const sig = enabled ? JSON.stringify(specsById) : ''
  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    for (const [id, spec] of Object.entries(specsById || {})) {
      const key = JSON.stringify(spec)
      if (cache.has(key)) { setCounts(c => (c[id] === cache.get(key) ? c : { ...c, [id]: cache.get(key) })); continue }
      countFor(spec).then(v => { if (alive) setCounts(c => ({ ...c, [id]: v })) })
    }
    return () => { alive = false }
  }, [sig, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return counts
}
