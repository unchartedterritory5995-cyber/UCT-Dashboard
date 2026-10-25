// Notebook widgets phase 2 (wave 8, Task 8.16): the start screen's pure helpers (ExamplesGallery.jsx draws them).
import { useEffect, useState } from 'react'
import { FAILURE_COPY } from '../../../lib/builtWidgets'

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

/** The cards a search shows, in order: a name match first, then a keyword match, each tier in shelf order. */
export function rankExamples(list, query) {
  const all = Array.isArray(list) ? list : []
  const q = norm(query)
  if (!q) return all
  const hits = []
  all.forEach((ex, i) => {
    let tier = null
    if (norm(ex.name).includes(q)) tier = 0
    else if (Array.isArray(ex.keywords) && ex.keywords.some((k) => norm(k).includes(q))) tier = 1
    if (tier !== null) hits.push({ ex, tier, i })
  })
  hits.sort((a, b) => a.tier - b.tier || a.i - b.i)
  return hits.map((h) => h.ex)
}

/** The spec 5.10 sentence for a refused batch (or the shelf), by its code. "busy" never reaches a card. */
export function examplesFailureText(code, fallback) {
  if (code !== 'busy' && code !== 'superseded' && typeof code === 'string' && Object.hasOwn(FAILURE_COPY, code)) {
    return FAILURE_COPY[code]
  }
  return fallback
}

/** True while the member asks for reduced motion (the skeleton does not shimmer then). */
export function useReducedMotion() {
  const QUERY = '(prefers-reduced-motion: reduce)'
  const read = () => {
    try { return !!window.matchMedia?.(QUERY)?.matches } catch { return false }
  }
  const [reduce, setReduce] = useState(read)
  useEffect(() => {
    let mql = null
    try { mql = window.matchMedia?.(QUERY) || null } catch { mql = null }
    if (!mql || typeof mql.addEventListener !== 'function') return undefined
    const on = (e) => setReduce(!!e.matches)
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [])
  return reduce
}
