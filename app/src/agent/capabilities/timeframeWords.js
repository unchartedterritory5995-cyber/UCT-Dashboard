// ── ⛔ TIMEFRAME WORDS (2026-11-14, owner live test BUG C) ───────────────────────────────────────────────────────────────
//
// Live: "…change SPY to the 1-hour timeframe…" → the model wrote chart.setTimeframe {"timeframe":"1h"} → the server's
// normalize_args (turn.py, the manifest's own `coerce`) had no word for it on THAT action (widget.addCharts had one) →
// args_schema → "I couldn't fill in the details of one of the steps, so nothing was changed."
//
// ONE shared map of the words for a chart timeframe, attached BY SCHEMA (registerCapability → withTimeframeWords): every arg
// whose enum is a timeframe set — it holds D and W and a minute bucket — gets it, whatever the action is called, so a new
// action can't miss it. Only words whose value the arg's own enum holds are attached; an arg's own `coerce` words win. A word
// that is not in the map is never coerced: the arg's enum refuses it (never a default, never a guess).
// ("1m" is left out: a minute or a month — never guessed)
const WORDS = {
  daily: 'D', day: 'D', '1d': 'D', d1: 'D', '1day': 'D',
  weekly: 'W', week: 'W', '1w': 'W', '1wk': 'W',
  monthly: 'M', month: 'M', '1mo': 'M',
  hourly: '60', hour: '60', '1h': '60', '1hr': '60', '1 hour': '60', '1-hour': '60', '60m': '60', '60min': '60',
  '1min': '1', '1-minute': '1',
  '5m': '5', '5min': '5', '5-minute': '5',
  '15m': '15', '15min': '15', '15-minute': '15',
  '30m': '30', '30min': '30', '30-minute': '30',
}
// the server keeps at most MAX_COERCE_WORDS (turn.py: 48) words per arg, in order — an action's OWN words go first (below)
export const MAX_COERCE_WORDS = 48
export const TIMEFRAME_WORDS = Object.freeze({ ...WORDS })

/** Is this arg schema a TIMEFRAME enum (by its values, never by its name)? */
export function isTimeframeEnum(spec) {
  const vals = new Set((spec?.enum || []).filter(v => typeof v === 'string'))
  return ['D', 'W'].every(v => vals.has(v)) && ['1', '5', '15', '30', '60'].some(v => vals.has(v))
}

/** Every arg path of a closed args schema whose enum is a timeframe set (top level and nested object properties). */
export function timeframeArgPaths(args, prefix = '') {
  const out = []
  for (const [k, spec] of Object.entries(args?.properties || {})) {
    const path = prefix ? `${prefix}.${k}` : k
    if (isTimeframeEnum(spec)) out.push(path)
    if (spec?.type === 'object' || spec?.properties) out.push(...timeframeArgPaths(spec, path))
  }
  return out
}

const specAt = (args, path) => path.split('.').reduce((s, k) => s?.properties?.[k], args)

/** The capability with the shared timeframe words on every timeframe arg (its own coerce words kept, and winning). */
export function withTimeframeWords(cap) {
  const paths = timeframeArgPaths(cap?.args)
  if (!paths.length) return cap
  const coerce = { ...(cap.coerce || {}) }
  for (const path of paths) {
    const allowed = new Set(specAt(cap.args, path)?.enum || [])
    const shared = Object.fromEntries(Object.entries(TIMEFRAME_WORDS).filter(([, v]) => allowed.has(v)))
    const own = coerce[path] || {}
    coerce[path] = { ...own, ...Object.fromEntries(Object.entries(shared).filter(([w]) => !(w in own))) }
  }
  return { ...cap, coerce }
}
