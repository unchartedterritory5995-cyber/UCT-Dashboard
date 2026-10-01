// app/src/components/chart/engine/periodReads.js
//
// ─── ⭐⭐ C29 — A DOCUMENT FOLDED AT ONE CHART PERIOD, BOUND ON ANOTHER ───────────
//
// The Pine member door translates ONCE, at the engine's base period (`D`), and
// folds what `timeframe.period` reads as text, `timeframe.multiplier` and
// `timeframe.in_seconds()` to that period's values (`pine.js::periodReadsOf`).
// On a weekly chart those constants are the DAILY chart's — a v6 script's
// `timeframe.period` would print `1D` where TradingView prints `1W` (measured,
// `vw-tf-period-spy-1w-2026-09-30.json`). So the bind asks, per plot and for the
// drawings: does every value it folded take the SAME value on this chart's period
// as on the one it was folded at? If not, that plot (or the drawings) is not
// computable here and says why — a refusal, never the other period's answer.
//
// ⛔ Keyed on VALUES, not on the period itself: `timeframe.multiplier` is 1 on
// D, W and M alike, so a plot that folded only that still draws on a weekly
// chart. An unknown timeframe (no ladder rung) is refused — nothing to compare.
//
// The stamp (`meta.periodReads`, the member door's): `{base, reads: [{name,
// version}], byTf: {code: [value per read]}, objects: bool, keys: [{key, names}]}`.

/** The chart timeframe code a binding is on, in the ladder's spelling. */
const codeOf = (tf) => {
  const s = String(tf == null ? '' : tf).trim()
  if (/^1?D$/i.test(s)) return 'D'
  if (/^1?W$/i.test(s)) return 'W'
  if (/^1?M$/.test(s)) return 'M'
  return s
}

/** The names among `names` (all, when null) whose folded value differs on `tf`,
 *  or null when nothing is refused. `[]`-like "unknown rung" returns every name. */
function differingOn(pr, tf, names) {
  const code = codeOf(tf)
  const base = pr.byTf[pr.base]
  const here = Object.prototype.hasOwnProperty.call(pr.byTf, code) ? pr.byTf[code] : null
  const idx = pr.reads.map((r, i) => [r, i]).filter(([r]) => !names || names.includes(r.name))
  if (!idx.length) return null
  if (!here || !base) return { unknownRung: true, reads: idx.map(([r]) => r) }
  const differ = idx.filter(([, i]) => here[i] !== base[i]).map(([r]) => r)
  return differ.length ? { unknownRung: false, reads: differ } : null
}

const stampOf = (def) => {
  const pr = def && def.meta && def.meta.periodReads
  return pr && Array.isArray(pr.reads) && pr.reads.length && pr.byTf ? pr : null
}
// ⚠️ No timeframe = no chart (a registration probe, a validation run): nothing is
// bound, so nothing is refused here; the clock columns fail closed as always.
const noChart = (tf) => tf === undefined || tf === null || tf === ''

function sentence(pr, tf, d) {
  const names = d.reads.map((r) => `\`${r.name}\``).join(', ')
  return d.unknownRung
    ? `this script reads the chart's own period (${names}), and this chart's timeframe \`${tf}\` `
      + 'is not one the translation holds a value for'
    : `this script was translated at the \`${pr.base}\` period and reads it (${names}): on this `
      + `\`${codeOf(tf)}\` chart those values differ, so it is not drawn off the other period's answer`
}

/** The refusal for plot `key` on `tf`, or null. A stamp naming its plots refuses
 *  only those (each on its own reads); an older stamp without `keys` refuses all. */
export function periodReadsRefusalFor(def, key, tf) {
  const pr = stampOf(def)
  if (!pr || noChart(tf)) return null
  let names = null
  if (Array.isArray(pr.keys)) {
    const k = pr.keys.find((x) => x && x.key === key)
    if (!k) return null
    names = k.names
  }
  const d = differingOn(pr, tf, names)
  return d ? sentence(pr, tf, d) : null
}

/** The refusal for the drawings on `tf`, or null — only when a period value was
 *  folded OUTSIDE the plots (the object pass); an older stamp says yes. */
export function periodReadsObjectRefusal(def, tf) {
  const pr = stampOf(def)
  if (!pr || noChart(tf) || pr.objects === false) return null
  const d = differingOn(pr, tf, null)
  return d ? sentence(pr, tf, d) : null
}

/** The guard name a refused column carries. */
export const PERIOD_READS_GUARD = 'bind:period-reads'
