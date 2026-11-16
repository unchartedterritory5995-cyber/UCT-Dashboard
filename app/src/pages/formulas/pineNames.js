// app/src/pages/formulas/pineNames.js
//
// ─── TRADINGVIEW (PINE) NAMES, FOR THE REFERENCE PAGE ────────────────────────
//
// A member who writes or pastes Pine asks one question of a reference: "does
// `ta.rsi` run here, and if not, why not?" The answer already exists and is kept
// current by somebody else: `supportLoop/doorNameCoverage.json` is regenerated
// from the Pine door whenever the door changes, and its own test fails when the
// committed file is stale. This module only arranges it for reading.
//
// ⛔ NOTHING IS DECIDED HERE. A name's status is the file's; the plain-words
// family of a refusal is the engine's (`editorStatus.familyOf`, passed in so this
// module stays free of the engine and its tests stay fast).
//
// ⛔ WHAT THE FILE MEASURES, AND WHAT IT DOES NOT. It asks the TRANSLATOR, which
// is what a formula and a screen use. A whole script pasted on a chart is checked
// there as a whole, and that answer can differ from this list. The page says so;
// `SCOPE_NOTE` is that sentence, kept beside the data it qualifies.
//
// Plan: docs/pine/studio/STUDIO-TRACK-PLAN.md section 9, lane R2 (first cut).

export const STATUS_WORDS = Object.freeze({
  reachable: 'Runs',
  'call-unmapped': 'Not yet',
  'name-unknown': 'Not yet',
  unprobed: 'Not checked',
})

export const SCOPE_NOTE = 'This is what a formula or a screen can use. A whole script pasted on a chart '
  + 'is checked there as a whole, and its answer can differ from this list.'

/** Namespaces shown first, in this order; the rest follow alphabetically. */
const LEAD = Object.freeze(['ta', 'math', 'request', 'input', 'str', 'color'])
const BARE = 'plain'
const TITLES = Object.freeze({ [BARE]: 'Plain names' })

const namespaceOf = (name) => (name.includes('.') ? name.slice(0, name.indexOf('.')) : BARE)
const rank = (id) => {
  const i = LEAD.indexOf(id)
  if (i >= 0) return [0, i, id]
  return id === BARE ? [2, 0, id] : [1, 0, id]
}
const byRank = (a, b) => {
  const x = rank(a); const y = rank(b)
  return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0)
}

/**
 * @param coverage  the parsed `doorNameCoverage.json`
 * @param familyOf  `editorStatus.familyOf`, or nothing (rows then carry no family)
 * @returns {{ total, runs, groups: Array<{ id, title, runs, items }> }}
 */
export function buildPineNames(coverage, familyOf = null) {
  const names = (coverage && coverage.names) || {}
  const buckets = new Map()
  let total = 0
  let runs = 0
  for (const name of Object.keys(names).sort()) {
    const row = names[name] || {}
    const status = typeof row.status === 'string' ? row.status : 'unprobed'
    const isRun = status === 'reachable'
    let family = null
    if (!isRun && typeof familyOf === 'function' && typeof row.guard === 'string') {
      const f = familyOf(row.guard)
      if (f && f.id && f.id !== 'unknown' && f.label) family = { id: f.id, label: f.label, why: f.why || '' }
    }
    const item = {
      name,
      status,
      words: STATUS_WORDS[status] || STATUS_WORDS.unprobed,
      // The shortest form the door was seen to accept. Shown only when it adds something.
      example: isRun && typeof row.probe === 'string' && row.probe !== name ? row.probe : null,
      family,
    }
    const id = namespaceOf(name)
    if (!buckets.has(id)) buckets.set(id, [])
    buckets.get(id).push(item)
    total += 1
    if (isRun) runs += 1
  }
  const groups = [...buckets.keys()].sort(byRank).map((id) => {
    const items = buckets.get(id)
    return { id, title: TITLES[id] || `${id}.`, runs: items.filter((it) => it.status === 'reachable').length, items }
  })
  return { total, runs, groups }
}

/**
 * Filter by what a member types: part of a name (`rsi`, `ta.`, `request.sec`),
 * or `runs` / `not yet` to see one kind. Case is ignored. An empty query returns
 * everything.
 */
export function searchPineNames(query, built) {
  const q = String(query == null ? '' : query).trim().toLowerCase()
  if (!q) return { ...built, query: '', shown: built.total }
  const wantRuns = q === 'runs' || q === 'run'
  const wantNot = q === 'not yet' || q === 'not'
  let shown = 0
  const groups = []
  for (const g of built.groups) {
    const items = g.items.filter((it) => {
      if (wantRuns) return it.status === 'reachable'
      if (wantNot) return it.status !== 'reachable'
      return it.name.toLowerCase().includes(q)
    })
    if (!items.length) continue
    shown += items.length
    groups.push({ ...g, items, runs: items.filter((it) => it.status === 'reachable').length })
  }
  return { total: built.total, runs: built.runs, groups, query: q, shown }
}
