import TABLE from './ast/closedTable.json'

// ─── WHAT CAN THIS NAME ANSWER, AND WHERE? ──────────────────────────────────
//
// ⭐⭐ ONE VOCABULARY, TWO EXECUTION CONTEXTS. The grammar is shared: a scan and a
// chart parse the same text into the same tree with the same 64 functions and the
// same 15 operators. What differs is what the RUNTIME can resolve. A scan runs
// against a row of `screener_rows`; a chart runs against a column of bars. So the
// same expression can be perfectly valid in one and answerless in the other.
//
// ⛔⛔ AND THAT IS NOT A NEW IDEA THAT NEEDS NEW METADATA — the table already says
// it, twice. Structurally, `series` and `scalars` are SEPARATE SECTIONS. In prose,
// `_scalars` states the category outright: *"A SCALAR IS A DIFFERENT KIND FROM A
// SERIES … `market_cap` is ONE NUMBER PER SYMBOL, dated to a nightly snapshot, and
// it is the SAME number at every bar of the column."* Every scalar additionally
// carries `source.store: 'screener_rows'` and `cadence: 'nightly'`. This module
// only READS that; it declares nothing the table did not already declare.
//
// ⛔ THE HAZARD THIS EXISTS TO CLOSE, MEASURED. `interpret` seeds every declared
// scalar as NaN when the caller passes no `scalars` argument — and the chart's two
// consumers (`conditions.js`, `infoFields.js`) pass none, because a chart has no
// screener row. So `adr_pct > 5` on a chart PARSES, VALIDATES, SAVES, and is false
// on 300 of 300 bars; `adr_pct` as an info field renders `—` with `error: null`.
// A trader is handed a condition that can never fire and told nothing. That is the
// "silent dead formula", and it is worse than a refusal.

/** The per-bar vocabulary: one value for every bar, derived from the bar itself. */
export const CHART_SERIES = Object.freeze(Object.keys(TABLE.series))
/** Also per-bar — `barindex`, `dayofweek`, `isdaily` … all read the bar's own clock. */
export const CHART_CLOCK = Object.freeze(Object.keys(TABLE.clock || {}))
/** One value per SYMBOL, from a nightly `screener_rows` snapshot. Not a column. */
export const SCREENER_SCALARS = Object.freeze(Object.keys(TABLE.scalars))

const SERIES_SET = new Set(CHART_SERIES)
const CLOCK_SET = new Set(CHART_CLOCK)
const SCALAR_SET = new Set(SCREENER_SCALARS)
const FN_SET = new Set(Object.keys(TABLE.functions))

/**
 * Which execution contexts can resolve this name.
 *
 * ⭐ `'binding'` IS THE CHART'S OWN EXTENSION and is deliberately not in the table:
 * `@<instanceId>::<plotKey>` names another indicator's output on THIS chart, which
 * the screener has no notion of. It is supplied by the binder at evaluate time.
 *
 * @returns {{kind: string, chart: boolean, screener: boolean, why: string|null}}
 */
export function capabilityOf(name) {
  if (typeof name !== 'string' || !name) {
    return { kind: 'unknown', chart: false, screener: false, why: 'that is not a name this table declares' }
  }
  if (name.startsWith('@')) {
    return { kind: 'binding', chart: true, screener: false, why: null }
  }
  if (SERIES_SET.has(name)) return { kind: 'series', chart: true, screener: true, why: null }
  if (CLOCK_SET.has(name)) return { kind: 'clock', chart: true, screener: true, why: null }
  if (FN_SET.has(name)) return { kind: 'function', chart: true, screener: true, why: null }
  if (SCALAR_SET.has(name)) {
    const spec = TABLE.scalars[name] || {}
    const sentence = typeof spec.sentence === 'string' ? spec.sentence : name
    return {
      kind: 'screenerScalar',
      chart: false,
      screener: true,
      // ⛔ THE TABLE'S OWN SENTENCE, never a phrase invented here — the same rule
      // `ConciergeBox` follows for refusal reasons.
      why: `${sentence} is available in the screener but has no historical chart data — `
        + 'it is one value per symbol from a nightly snapshot, not a value per bar',
    }
  }
  return { kind: 'unknown', chart: false, screener: false, why: `nothing declares ${JSON.stringify(name)}` }
}

/** Is this name usable in a CHART formula (indicator / condition / info value)? */
export const isChartEvaluable = (name) => capabilityOf(name).chart === true

/**
 * Every identifier a tree reads.
 *
 * ⛔⛔ A NAME LOOKUP IS THE ONLY SEAM THERE IS, AND THE TABLE EXPLAINS WHY. A
 * SCALAR RIDES THE `series` NODE TYPE rather than carrying one of its own —
 * `parse.js` turns every identifier into a `series` node deliberately, so the
 * parser needs no table and resolution is `interpret`'s job. `_scalars_node` states
 * the cost of the alternative outright: a `scalar` node type would be a new type in
 * five declaration sites, and `astHash` is taken over `{type,…}`, so adding one
 * could never be undone without migrating every persisted definition. The node
 * therefore CANNOT tell us; only the name can.
 */
export function namesIn(ast) {
  const out = new Set()
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (typeof n.name === 'string' && n.name) out.add(n.name)
    for (const k of Object.keys(n)) if (k !== 'name') walk(n[k])
  }
  walk(ast)
  return [...out]
}

/**
 * Can this TREE run on a chart — and if not, exactly which names stop it?
 *
 * ⛔ IT NAMES THEM. "This formula cannot run here" with no list is a refusal a
 * member cannot act on; the whole point is that they can see `adr_pct` and swap it
 * for something the chart can answer.
 *
 * @returns {{ok: true} | {ok: false, offenders: string[], reason: string}}
 */
export function chartEvaluability(ast) {
  const offenders = namesIn(ast).filter((n) => {
    const cap = capabilityOf(n)
    return cap.kind === 'screenerScalar'
  })
  if (!offenders.length) return { ok: true }
  const first = capabilityOf(offenders[0])
  const reason = offenders.length === 1
    ? `\`${offenders[0]}\` — ${first.why}.`
    : `${offenders.map((o) => `\`${o}\``).join(', ')} are available in the screener but have no `
      + 'historical chart data — they are one value per symbol from a nightly snapshot, not a value per bar.'
  return { ok: false, offenders, reason }
}
