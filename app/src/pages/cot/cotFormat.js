// app/src/pages/cot/cotFormat.js — number/date formatting shared by the COT
// chart panes and the positioning rail. ONE copy; both surfaces import it.

/** "2025-11-07" → "11/7/2025" */
export function fmtDate(iso) {
  const [y, m, d] = iso.split('-')
  return `${parseInt(m)}/${parseInt(d)}/${y}`
}

/** Full integer with separators; negatives in accounting parentheses. */
export function fmtNum(v) {
  if (v == null) return ''
  const abs = Math.abs(Math.round(v)).toLocaleString()
  return v < 0 ? `(${abs})` : abs
}

/** 2,072,358 → "2.07M"; 10,560 → "11K"; 512 → "512" (sign preserved). */
export function fmtCompact(v) {
  if (v == null) return ''
  const abs = Math.abs(v)
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${Math.round(v / 1e3)}K`
  return String(Math.round(v))
}

/** Week-over-week change: "▲ 5K" / "▼ 5K"; zero or missing → "—". */
export function fmtSignedCompact(v) {
  if (v == null || v === 0) return '—'
  return `${v > 0 ? '▲' : '▼'} ${fmtCompact(Math.abs(v))}`
}

/** Net as a share of open interest: "−5.5%" / "+0.0%"; missing → "—". */
export function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  const s = Math.abs(v).toFixed(1)
  return v < 0 ? `−${s}%` : `+${s}%`
}
