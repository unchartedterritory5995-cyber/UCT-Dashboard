// ── UCT Agent COACH concepts (W3-1): the knowledge base, read from the server, matched by alias ───────────────────
//
// The ONLY text the coach explains from is docs/agent/coach/concepts/*.md, parsed by the server
// (api/services/uct_agent/coach/concepts.py) and served by GET /api/agent/coach/concepts (admin-only, 404 while
// UCT_AGENT_COACH is off). This module reads it ONCE per page (cached), and matches the member's words to exactly
// one concept the same way the server does (title or alias, whole or contained at word boundaries; the longest
// alias wins; none → null). Nothing is hand-written here: a concept the server does not serve does not exist.

const ROUTE = '/api/agent/coach/concepts'
let cache = { rows: null, inflight: null, failed: false, footer: 'Educational, not advice.' }

export const _resetConceptsForTest = () => { cache = { rows: null, inflight: null, failed: false, footer: 'Educational, not advice.' } }

/** Load (once) the served concepts → rows | null (null: the server refused or is dark). */
export function loadConcepts() {
  if (cache.rows) return Promise.resolve(cache.rows)
  if (cache.inflight) return cache.inflight
  cache.inflight = fetch(ROUTE, { credentials: 'include', cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then((b) => {
      const rows = b && Array.isArray(b.concepts) ? b.concepts.filter(c => c && typeof c.id === 'string' && typeof c.text === 'string') : null
      if (rows && rows.length) { cache.rows = rows; cache.failed = false } else cache.failed = true
      if (b && typeof b.footer === 'string' && b.footer) cache.footer = b.footer
      return cache.rows
    })
    .catch(() => { cache.failed = true; return null })
    .finally(() => { cache.inflight = null })
  return cache.inflight
}
/** The concepts already loaded (sync), or null. */
export const conceptsLoaded = () => cache.rows
export const coachFooter = () => cache.footer

const norm = (s) => String(s || '').toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim()
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The ONE concept the words name (title or alias), from `rows` (default: the loaded rows) → row | null. */
export function conceptFor(words, rows = cache.rows) {
  const w = norm(words)
  if (!w || w.length > 200 || !Array.isArray(rows)) return null
  let best = null
  for (const c of rows) {
    for (const name of [norm(c.title), ...(c.aliases || []).map(norm)]) {
      if (!name) continue
      // no lookbehind (src/noRegexLookbehind.test.js): the character before is captured instead
      if (w === name || new RegExp(`(^|[^a-z0-9])${esc(name)}(?![a-z0-9])`).test(w)) {
        if (!best || name.length > best[0]) best = [name.length, c]
      }
    }
  }
  return best ? best[1] : null
}

/** "Relative strength, Stop placement principles, …" — the titles, for a "which concept?" answer (no figures). */
export const conceptTitles = (rows = cache.rows) => (Array.isArray(rows) ? rows.map(c => c.title) : [])
