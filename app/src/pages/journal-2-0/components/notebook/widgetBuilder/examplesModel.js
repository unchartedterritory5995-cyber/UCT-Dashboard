// Notebook widgets phase 2 (wave 8, Task 8.16): the start screen's pure helpers (ExamplesGallery.jsx draws them).
import { FAILURE_COPY, failureText } from '../../../lib/builtWidgets'

/** The media query for reduced motion, read through the shared hooks/useMediaQuery. */
export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

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

/** Codes whose spec 5.10 sentence is about ANOTHER surface (the builder's own preview, or a card's busy gate, which is
 *  never shown): on the gallery these read the gallery's own `fallback`. */
const NOT_HERE = new Set(['busy', 'superseded', 'rate_preview', 'too_long'])

/** The member sentence for a refused batch (or the list read): the shared failureText lookup for every code it knows
 *  (offline, unavailable, rate, daily cap, ...), else the gallery's own fallback, never developer words. */
export function examplesFailureText(code, fallback) {
  if (typeof code !== 'string' || NOT_HERE.has(code) || !Object.hasOwn(FAILURE_COPY, code)) return fallback
  return failureText(code) || fallback
}
