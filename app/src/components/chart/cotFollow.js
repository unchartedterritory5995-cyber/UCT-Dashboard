// app/src/components/chart/cotFollow.js
//
// ─── THE COT INDICATOR THAT FOLLOWS THE CHART SYMBOL (2026-09-30) ───────────
//
// A member adds ONE "COT (Commitment of Traders)" indicator. Its three stored sources
// name no market — `sym:COT:AUTO:COMM|LARGE|SMALL:close` — and the chart symbol picks
// the market: QQQ draws Nasdaq-100 E-Mini positioning, GLD Gold, TLT the 30-Year
// T-Bond. On a symbol with no related futures market (AAPL) the indicator draws
// NOTHING: no pane, no legend, no request.
//
// ⛔⛔ A RENDER-TIME VIEW, NEVER A WRITE. `resolveCotFollow` is applied only where the
// chart READS instances to draw them. The stored blob keeps `AUTO` forever: resolving
// it there would pin the first market a member happened to view, and dropping the
// instances there (AAPL) would DELETE the indicator. Instance ids are untouched, so
// every by-id control (remove, hide, recolour) still acts on the stored record.
//
// ⚠️ The symbol → market table is the SERVER's (`registry.COT_SYMBOL_MAP`, shipped as
// `cot_symbols` in `/api/market-indicators`); nothing here re-types it.
//
// Leaf module: no imports.

export const COT_FOLLOW_TOKEN = 'AUTO'
export const COT_FOLLOW_DISPLAY = 'COT (Commitment of Traders)'

const AUTO_SOURCE = /^sym:COT:AUTO:(COMM|LARGE|SMALL):close$/

/** Is this stored source the follow indicator's (names no market)? */
export function isCotFollowSource(source) {
  return typeof source === 'string' && AUTO_SOURCE.test(source)
}

/** `sym:COT:AUTO:<PART>:close` for one participant code. */
export function cotFollowSource(part) {
  return `sym:COT:${COT_FOLLOW_TOKEN}:${part}:close`
}

/**
 * The COT market a chart symbol shows: `{ market, name }`, or null.
 * `cotSymbols` is the catalogue's `cot_symbols` map (absent until it has loaded —
 * and until then the indicator draws nothing, rather than guessing).
 */
export function cotFollowOf(sym, cotSymbols) {
  if (!sym || !cotSymbols || typeof cotSymbols !== 'object') return null
  const hit = cotSymbols[String(sym).trim().toUpperCase()]
  return hit && typeof hit.market === 'string' && hit.market ? hit : null
}

/**
 * Instances → the list the chart DRAWS: every follow instance resolved to `follow`'s
 * market (its group titled `<market> · COT`), or removed when `follow` is null.
 * Returns the INPUT ARRAY itself when it holds no follow instance, so a memo keyed on
 * it stays stable for every chart without COT.
 */
export function resolveCotFollow(instances, follow) {
  if (!Array.isArray(instances)) return instances
  let changed = false
  const out = []
  for (const i of instances) {
    const src = i && i.inputs && i.inputs.source
    const hit = typeof src === 'string' ? AUTO_SOURCE.exec(src) : null
    if (!hit) { out.push(i); continue }
    changed = true
    if (!follow) continue
    out.push({
      ...i,
      inputs: { ...i.inputs, source: `sym:COT:${follow.market}:${hit[1]}:close` },
      ...(i.group && typeof i.group === 'object'
        ? { group: { ...i.group, name: `${follow.name || follow.market} · COT` } } : {}),
    })
  }
  return changed ? out : instances
}
