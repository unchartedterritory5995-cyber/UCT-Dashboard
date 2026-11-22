// app/src/components/chart/engine/symbolInputs.js
//
// ─── ⭐⭐ SETTINGS PARITY (symbol): A SYMBOL A SCRIPT READS THROUGH AN INPUT IS A SETTING ─────────────
//
// RS Rating's line is `close / request.security(lineTicker, timeframe.period, close)` with
// `lineTicker = input('SP:SPX', title = 'Comparative Symbol for Line')`. The translator folds the input to
// its default and emits `sym('SPX', …)`, so the chart fetched SP:SPX and a member could not compare against
// anything else, while on TradingView the comparison symbol is one of the script's settings.
//
// The translator records, per side of the document, a ticker EVERY `sym` node of that side reaches through
// ONE input (`translatePine`'s `symbolInputs` -> `meta.symbolInputs`: `{input, ticker, venue, default,
// title, pass}`; a ticker also read through a literal on the same side records nothing). Here:
//   * on load the input is declared as a text setting (`fromSymbol`; never stored: `stripParamInputs`);
//   * at compute (and for the chart's fetch) a member's choice is read with the translator's own reading
//     (`pineSymbolSpelling`), judged by the one servability rule (`staticallyUnservable`: a spelling no
//     binding can serve is REFUSED BY NAME, never fetched), and the side's `sym` nodes and the spelling
//     table (`meta.otherSymbols`) are rewritten to it. The old ticker's row stays: another read (a run
//     half's fixed request) may still need its bars, and fetching one series too many is harmless.
// ⛔ At the default nothing changes: the document computes exactly as before.

import { pineSymbolSpelling } from './ast/pine.js'
import { staticallyUnservable, staticOtherSymbolMessage } from './otherSymbols.js'

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** The recorded symbol inputs of a document (`meta.symbolInputs`), or []. */
export function symbolInputEntries(def) {
  const rows = def && def.meta && Array.isArray(def.meta.symbolInputs) ? def.meta.symbolInputs : []
  return rows.filter((r) => isObj(r) && typeof r.input === 'string' && r.input && typeof r.ticker === 'string'
    && typeof r.default === 'string' && (r.pass === 'plots' || r.pass === 'objects'))
}

/** One text setting per symbol input (a name read on both sides is ONE setting). */
export function symbolInputSpecs(def) {
  const out = []
  const seen = new Set()
  for (const r of symbolInputEntries(def)) {
    if (seen.has(r.input)) continue
    seen.add(r.input)
    out.push({ key: r.input, type: 'string', default: r.default, label: r.title || r.input, fromSymbol: r.input })
  }
  return out
}

/** The document with its symbol settings declared (idempotent; a key already declared is left alone). */
export function withSymbolInputs(def) {
  const specs = symbolInputSpecs(def)
  if (!specs.length) return def
  const have = new Set((Array.isArray(def.inputs) ? def.inputs : []).map((i) => i && i.key))
  const add = specs.filter((s) => !have.has(s.key))
  if (!add.length) return def
  return { ...def, inputs: [...(Array.isArray(def.inputs) ? def.inputs : []), ...add] }
}

const sameSpelling = (a, b) => String(a == null ? '' : a).trim().toUpperCase() === String(b == null ? '' : b).trim().toUpperCase()

/** The member's choice of each MOVED symbol setting: `{ok:true, moved:[{input, value, ticker, venue}]}` |
 *  `{ok:false, key, label, message}` (a choice no binding can serve, by name). */
export function symbolInputChoices(def, inputs) {
  const moved = []
  const vals = isObj(inputs) ? inputs : {}
  for (const spec of symbolInputSpecs(def)) {
    if (!Object.prototype.hasOwnProperty.call(vals, spec.key)) continue
    const value = vals[spec.key]
    if (sameSpelling(value, spec.default)) continue
    const parsed = typeof value === 'string' ? pineSymbolSpelling(value) : null
    if (!parsed) {
      return { ok: false, key: spec.key, label: spec.label,
        message: `${spec.label}: "${String(value)}" is not a symbol (write it as TradingView does, e.g. AMEX:SPY)` }
    }
    const no = staticallyUnservable(parsed.ticker, parsed.venue)
    if (no) return { ok: false, key: spec.key, label: spec.label, message: `${spec.label}: ${staticOtherSymbolMessage(parsed.ticker, no)}` }
    moved.push({ input: spec.key, value: String(value).trim(), ticker: parsed.ticker, venue: parsed.venue })
  }
  return { ok: true, moved }
}

/** A copy of `node` with every `sym` node whose ticker is `from` reading `to` instead (copy-on-write). */
function rewriteSyms(node, from, to) {
  if (Array.isArray(node)) {
    let changed = false
    const out = node.map((x) => { const y = rewriteSyms(x, from, to); if (y !== x) changed = true; return y })
    return changed ? out : node
  }
  if (!isObj(node)) return node
  let out = node
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (v && typeof v === 'object') {
      const w = rewriteSyms(v, from, to)
      if (w !== v) { if (out === node) out = { ...node }; out[k] = w }
    }
  }
  if (out.type === 'sym' && typeof out.value === 'string' && out.value.trim().toUpperCase() === from) {
    if (out === node) out = { ...node }
    out.value = to
  }
  return out
}

/** The document a specialised one was made from (`specializeSymbols`, then `paramInputs.specializeParams`),
 *  or itself: what a stamp or a digest of the stored document is checked against. */
export function originalDocumentOf(def) {
  const p = def && def.specializedFrom ? def.specializedFrom : def
  return p && p.specializedSymbolsFrom ? p.specializedSymbolsFrom : p
}

const _memo = new WeakMap()

/**
 * The document as the member's symbol choices make it: `{ok:true, def, moved}` (`def` is the input
 * document itself when nothing moved) | `{ok:false, key, label, message}`. Memoised per document and
 * choice, so a chart recomputing at the same choice gets the same object (and every memo downstream hits).
 */
export function specializeSymbols(def, inputs) {
  const entries = symbolInputEntries(def)
  if (!entries.length) return { ok: true, def, moved: [] }
  const choice = symbolInputChoices(def, inputs)
  if (!choice.ok) return choice
  if (!choice.moved.length) return { ok: true, def, moved: [] }
  const memoKey = choice.moved.map((m) => `${m.input}=${m.ticker}|${m.venue}`).join(',')
  const byDef = _memo.get(def)
  if (byDef && byDef.has(memoKey)) return byDef.get(memoKey)
  let out = { ...def }
  let rows = Array.isArray(def.meta && def.meta.otherSymbols) ? def.meta.otherSymbols.map((r) => ({ ...r })) : []
  for (const m of choice.moved) {
    for (const e of entries.filter((x) => x.input === m.input)) {
      const from = e.ticker.trim().toUpperCase()
      if (e.pass === 'plots' && out.compute) out = { ...out, compute: rewriteSyms(out.compute, from, m.ticker) }
      if (e.pass === 'objects' && out.objects) out = { ...out, objects: rewriteSyms(out.objects, from, m.ticker) }
    }
    const row = rows.find((r) => r && String(r.ticker).toUpperCase() === m.ticker)
    if (row) row.spellings = [...new Set([...(row.spellings || []), m.venue])].sort()
    else rows = [...rows, { ticker: m.ticker, spellings: [m.venue] }].sort((a, b) => (a.ticker < b.ticker ? -1 : 1))
  }
  out = { ...out, meta: { ...(out.meta || {}), otherSymbols: rows } }
  Object.defineProperty(out, 'specializedSymbolsFrom', { value: def, enumerable: false })
  const result = { ok: true, def: out, moved: choice.moved }
  if (!_memo.has(def)) _memo.set(def, new Map())
  _memo.get(def).set(memoKey, result)
  return result
}

/** The other symbols a chart fetches for ONE instance: the document as that instance's symbol choices make it
 *  (a choice no binding can serve fetches nothing new: the compute refuses it by name). */
export function instanceDocumentForFetch(def, inst) {
  if (!def || !symbolInputEntries(def).length) return def
  const s = specializeSymbols(def, inst && inst.inputs)
  return s.ok ? s.def : def
}
