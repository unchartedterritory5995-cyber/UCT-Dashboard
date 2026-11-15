// ── ⛔ TIMEFRAME WORDS — a STRUCTURAL reading (2026-11-14, owner live test BUG C; AUDIT T2 on #1289, held-out probe 45) ────
//
// Live: "…change SPY to the 1-hour timeframe…" → chart.setTimeframe {"timeframe":"1h"} → args_schema → the whole turn refused.
// A fixed word list cannot cover how a timeframe is spelled ("15 minutes", "15 min", "5mins", "1-hour", "60 minutes"…), so a
// timeframe is READ BY ITS GRAMMAR: an optional number, then a unit, with a hyphen, a space or nothing between:
//     [number] [ -|space ] unit        units: m · min · mins · minute(s) · h · hr · hrs · hour(s) · d · day(s) · w · wk · week(s)
//                                      · mo · month(s)          and hourly · daily · weekly · monthly (no number: they imply 1)
// → minutes = n (m units) or n × 60 (h units); one day / week / month = D / W / M. The value is used ONLY if the arg's OWN
// enum holds it; anything else is left as said and the enum refuses it (never a default, never a guess):
//   "1m" is ambiguous (a minute or a month) → refused · "4 hours" → 240, not offered → refused · "2 weeks", "13min" → refused
//   a bare unit letter ("h", "m") → not read (the enum's own case-folding already takes "d" / "w" / "D")
// Applied BY SCHEMA to every timeframe enum arg (it holds D and W and a minute bucket), in the browser (capabilities.js
// coerceSchema) and — the SAME grammar, mirrored — on the server (turn.py _parse_timeframe in _coerce_schema). Parity is held
// by contract/timeframe.parity.json: a generated table this module writes and both test suites check.
//
// An action's own `coerce` words (e.g. widget.addCharts "default" → null) still apply first; the server keeps at most
// MAX_COERCE_WORDS of them per arg (turn.py), so the rail below stays for whatever words remain.
export const MAX_COERCE_WORDS = 48

const UNIT = {
  m: 'm', min: 'm', mins: 'm', minute: 'm', minutes: 'm',
  h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
  d: 'd', day: 'd', days: 'd',
  w: 'w', wk: 'w', week: 'w', weeks: 'w',
  mo: 'mo', month: 'mo', months: 'mo',
}
const LY = { hourly: 'h', daily: 'd', weekly: 'w', monthly: 'mo' }
const LETTER = new Set(['m', 'h', 'd', 'w', 'mo'])
const SHAPE = /^(\d{1,4})?\s*-?\s*([a-z]+)$/

/** Is this arg schema a TIMEFRAME enum (by its values, never by its name)? */
export function isTimeframeEnum(spec) {
  const vals = new Set((spec?.enum || []).filter(v => typeof v === 'string'))
  return ['D', 'W'].every(v => vals.has(v)) && ['1', '5', '15', '30', '60'].some(v => vals.has(v))
}

/** The canonical timeframe a string spells, if the arg's enum offers it — else null (left as said; the enum refuses it). */
export function parseTimeframe(v, enumVals) {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase().replace(/\s+/g, ' ')
  const m = SHAPE.exec(s)
  if (!m) return null
  let n = m[1] != null ? Number(m[1]) : null
  let unit = null
  if (m[2] in LY) {
    if (n != null) return null                                  // "2 daily" is not a timeframe
    unit = LY[m[2]]; n = 1
  } else if (m[2] in UNIT) {
    unit = UNIT[m[2]]
    if (n == null) {
      if (LETTER.has(m[2])) return null                          // a bare unit letter is not read here
      n = 1
    }
    if (m[2] === 'm' && n === 1) return null                     // "1m": a minute or a month — never guessed
  } else return null
  if (!n) return null
  const value = unit === 'm' ? String(n) : unit === 'h' ? String(n * 60) : n === 1 ? { d: 'D', w: 'W', mo: 'M' }[unit] : null
  return value != null && (enumVals || []).includes(value) ? value : null
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

// ── the parity table (contract/timeframe.parity.json): inputs × the manifest's timeframe enums → the reading ──
const NUMS = ['', '0', '1', '2', '4', '5', '05', '13', '15', '30', '45', '60', '90', '120', '240']
const SEPS = ['', ' ', '-']
const IRREGULAR = ['1m', '1M', 'hourly', 'Daily', 'WEEKLY', 'monthly', '2 daily', 'd1', 'h1', 'h', 'm', 'mo', '1mo', '60', 'D',
  'one hour', '1 hour chart', 'banana', '', '  15   min  ', '15 - min', '1.5h', '-1h', 'intraday', 'fortnightly', '1 hr', '4 hours']
export function parityInputs() {
  const units = [...Object.keys(UNIT), ...Object.keys(LY)]
  const out = new Set(IRREGULAR)
  for (const n of NUMS) for (const sep of SEPS) for (const u of units) {
    if (!n && sep) continue
    out.add(`${n}${sep}${u}`)
    out.add(`${n}${sep}${u}`.toUpperCase())
  }
  return [...out]
}
