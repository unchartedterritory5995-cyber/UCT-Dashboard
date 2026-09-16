// app/src/components/chart/breadthLibrary.js
//
// ─── THE BREADTH LIBRARY, CLIENT SIDE ───────────────────────────────────────
//
// ⭐⭐ BREADTH IS A LIBRARY OF METRICS ACROSS UNIVERSES, NOT A FLAT COLLECTION OF
// PSEUDO-TICKERS. A member looking for Nasdaq's 50-day participation is looking for
// "% of Stocks Above 50-Day MA" and then for "NASDAQ" — not for the string
// `NASDAQ:A50`, which is an ADDRESS. So everything here ranks and groups by METRIC
// first and UNIVERSE second, and the symbol is carried for the member who already
// knows it.
//
// ⛔⛔ THIS IS NOT A SECOND CATALOGUE AND NOT A SECOND SEARCH SYSTEM. It owns no
// names, no families, no units and no symbols: every row arrives from
// `/api/breadth-symbols`' `library` block, which `breadth_symbols.library_catalog()`
// projects from `breadth_universes` × `breadth_metrics`. Add a metric or publish a
// universe and this file reports it without being edited.
//
// ⛔ THE RANKING HAS TWO IMPLEMENTATIONS AND ONE DEFINITION, which is a real risk
// and is handled the way this repo already handles the AST's two lanes: with a
// GENERATED fixture. `breadth_symbols.library_search` is the reference; this is the
// lane the UI uses because a ranked list must not cost a network round-trip per
// keystroke; and `breadthLibrary.parity.test.js` asserts the two agree on the
// canonical query set, from `__fixtures__/breadthSearchParity.json`. If they drift,
// a rail says so by name rather than a member noticing that search "feels different
// in the dialog".

/** Query words that name the LIBRARY rather than anything in it. "NASDAQ breadth"
 *  means "Nasdaq's breadth metrics"; requiring the word to appear in a metric's own
 *  text would return the one metric with "Breadth" in its name and hide the rest. */
const NOISE = new Set(['BREADTH', 'METRIC', 'METRICS', 'INDICATOR', 'INDICATORS',
                       'LIBRARY', 'SERIES'])

/** Upper-cased alphanumeric runs. `:` is a separator HERE and nothing more — the
 *  registry, never the tokeniser, decides whether a colon string is an identity. */
export function tokens(q) {
  const out = []
  let cur = ''
  for (const ch of String(q || '').toUpperCase()) {
    if (/[A-Z0-9%]/.test(ch)) cur += ch
    else if (cur) { out.push(cur); cur = '' }
  }
  if (cur) out.push(cur)
  return out
}

const own = (r) => `${r.name} ${r.short_name} ${r.code}`.toUpperCase()
// ⚰️ THE PARENTHESES ARE LOAD-BEARING. Written as `\`a\` + \`b\`.toUpperCase()` the
// method binds to the SECOND template only, so `group_label` stayed mixed-case and
// every family-tier match silently failed — "high low" found the three NETHL rows
// (which match on their own name) and none of New Highs or New Lows. The parity rail
// caught it; nothing about the code looked wrong.
const hay = (r) => (`${r.name} ${r.short_name} ${r.code} ${r.group_label} `
  + `${r.symbol || ''} ${r.universe_label}`).toUpperCase()

/**
 * An INDEX over the catalogue rows — built once per payload, not per keystroke.
 *
 * ⚠️ PERFORMANCE IS A REAL CONCERN HERE AND HAS ALREADY BITTEN ONCE. Phase 5 put a
 * catalogue rebuild on `/api/bars`' hot path and paid 404 µs per ordinary ticker to
 * answer "no". The catalogue is 44 rows today and ~156 with every universe
 * published; upper-casing each row's text on every keystroke would be fine at that
 * size and wrong in principle, so it is precomputed and keyed on the array identity.
 */
let _idxFor = null
let _idx = null

export function buildIndex(rows) {
  const list = Array.isArray(rows) ? rows : []
  if (_idxFor === list && _idx) return _idx
  _idx = {
    rows: list,
    own: list.map(own),
    hay: list.map(hay),
    bySymbol: new Map(list.map((r, i) => [String(r.symbol || '').toUpperCase(), i])),
    universes: new Map(list.map((r) => [String(r.universe_label).toUpperCase(), r.universe])),
  }
  _idxFor = list
  return _idx
}

/**
 * Ranked Breadth Library results for one query.
 *
 * Tiers, lowest wins — the same five `library_search` uses:
 *   0  an exact registered symbol (or alias) was typed
 *   1  the metric CODE was typed  (`A50` → every A50 universe)
 *   2  a bare universe word       (`NASDAQ` → Nasdaq's library)
 *   3  every token is in the METRIC'S OWN text  (`new lows`, `above 50`)
 *   4  every token is somewhere in its row      (family, universe, symbol)
 *
 * ⭐ TIER 3 EXISTS BECAUSE OF "new lows". Without it, New Highs and New Lows match
 * only through the family label they share, the tie breaks on catalogue order, and
 * the member who typed "lows" is shown "New 52-Week Highs" first.
 *
 * ⚠️ A UNIVERSE WORD NARROWS RATHER THAN MATCHES, so "NASDAQ 50 MA" means "Nasdaq's
 * 50-day family" rather than "rows whose text contains NASDAQ".
 *
 * ⭐ AND THE SORT IS (score, METRIC, universe), so one metric appears with its
 * universe variants ADJACENT. Sorting by universe first produces every UCT metric
 * then every US metric — the ticker-soup list this library exists to replace.
 */
export function searchLibrary(rows, q, { limit = 40, metricOrder } = {}) {
  const raw = String(q || '').trim()
  if (!raw) return []
  const idx = buildIndex(rows)
  const list = idx.rows

  const scored = []
  const exact = idx.bySymbol.get(raw.toUpperCase())
  if (exact !== undefined) scored.push([0, exact])

  const toks = tokens(raw)
  const wantUni = new Set()
  const rest = []
  for (const t of toks) {
    if (idx.universes.has(t)) wantUni.add(idx.universes.get(t))
    else if (!NOISE.has(t)) rest.push(t)
  }

  for (let i = 0; i < list.length; i++) {
    if (i === exact) continue
    const r = list[i]
    if (wantUni.size && !wantUni.has(r.universe)) continue
    const code = String(r.code).toUpperCase()
    let score = null
    if (!rest.length) score = wantUni.size ? 2 : null
    else if (rest.every((t) => t === code)) score = 1
    else if (rest.every((t) => idx.own[i].includes(t))) score = 3
    else if (rest.every((t) => idx.hay[i].includes(t))) score = 4
    if (score !== null) scored.push([score, i])
  }

  const mrank = metricOrder instanceof Map ? metricOrder : null
  const metricKey = (i) => (mrank ? (mrank.get(list[i].metric) ?? 1e6) : i)
  scored.sort((a, b) => (a[0] - b[0])
    || (metricKey(a[1]) - metricKey(b[1]))
    || (a[1] - b[1]))

  const out = []
  const seen = new Set()
  for (const [score, i] of scored) {
    const r = list[i]
    const key = `${r.universe}|${r.metric}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...r, score, symbolHit: score <= 1 })
    if (out.length >= limit) break
  }
  return out
}

/** `[{id, label, rows}]` — the library grouped for BROWSE, in catalogue order.
 *
 *  ⭐ ONE ENTRY PER METRIC, with its universes collected, because that is the thing
 *  a member is choosing: "% of Stocks Above 50-Day MA" is ONE idea that happens to
 *  exist over four populations. A flat list of `universe × metric` rows is the
 *  ticker soup again, wearing headings. */
export function browseFamilies(rows) {
  const list = Array.isArray(rows) ? rows : []
  const fams = []
  const byFam = new Map()
  for (const r of list) {
    let fam = byFam.get(r.group)
    if (!fam) {
      fam = { id: r.group, label: r.group_label, metrics: [], _byMetric: new Map() }
      byFam.set(r.group, fam)
      fams.push(fam)
    }
    let m = fam._byMetric.get(r.metric)
    if (!m) {
      m = { metric: r.metric, name: r.name, shortName: r.short_name, code: r.code,
            unit: r.unit, domain: r.domain, presentation: r.presentation, universes: [] }
      fam._byMetric.set(r.metric, m)
      fam.metrics.push(m)
    }
    m.universes.push({ universe: r.universe, label: r.universe_label,
                       symbol: r.symbol, floor: r.floor, legacy: r.legacy })
  }
  for (const f of fams) delete f._byMetric
  return fams
}

/** Availability a surface may SHOW. `null` when the payload said nothing, which is
 *  not the same as "not populated" and must not render as it. */
export function availabilityOf(universes, id) {
  const row = (Array.isArray(universes) ? universes : []).find((u) => u && u.id === id)
  return row ? { state: row.state, first: row.first, last: row.last, floor: row.floor } : null
}
