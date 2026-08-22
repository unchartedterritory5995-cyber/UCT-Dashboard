// app/src/utils/feedFormat.js
//
// The catalyst-feed number grammar — ONE copy, read by the /charts News &
// Catalysts widget and the earnings modal's Catalysts section.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "2026-08-21" → "Aug 21, 2026". Anything unparseable is echoed, never thrown.
export function fmtDate(d) {
  if (!d) return ''
  const parts = String(d).slice(0, 10).split('-')
  const y = Number(parts[0]), m = Number(parts[1]), day = Number(parts[2])
  return (m >= 1 && m <= 12) ? `${MON[m - 1]} ${day}, ${y}` : String(d)
}

// 12 → "+12%", -3.46 → "-3.5%", junk → "".
export function fmtMove(mp) {
  const n = Number(mp)
  if (!Number.isFinite(n)) return ''
  return `${n >= 0 ? '+' : ''}${Number.isInteger(n) ? n : n.toFixed(1)}%`
}
