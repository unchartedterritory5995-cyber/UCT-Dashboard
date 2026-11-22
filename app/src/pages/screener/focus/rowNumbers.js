// The two numbers every Focus result row ends with, formatted in ONE place: ResultList's own
// row and the RS screens' row (RsResultRow) print the same price and the same change.
export const fmtPrice = v => (Number.isFinite(v) ? v.toFixed(2) : '—')
// One decimal, a real minus sign, and no sign at all on a change that rounds to zero.
export const fmtChg = v => {
  if (!Number.isFinite(v)) return '—'
  const r = Number(Math.abs(v).toFixed(1))
  const s = r.toFixed(1)
  return r === 0 ? `${s}%` : v > 0 ? `+${s}%` : `−${s}%`
}
