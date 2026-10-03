// G-040 ruling 2 — what "Save to Notebook" freezes from the COT positioning rail.
//
// ⛔ A FROZEN SNAPSHOT OF ONE MARKET AT ONE REPORT WEEK — the week the rail is
// showing at the press (the latest report, or the week the member scrubbed to):
// for each trader group the net position, the week-over-week change and the
// 3-year COT Index; open interest; and the rail's contrarian-bias and crowding
// verdicts AS SHOWN. Read straight off the rail's own `composeWeek` output
// (`snap` + `read`), so the note holds the numbers the member read, not a second
// computation of them. Pure: `cotNotebookCapture.test.js` drives it directly.
import { GROUPS } from './cotRead'

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** @returns the capture, or null when the rail has nothing on screen. */
export function buildCotCapture({ symbol, name, snap, read }) {
  if (!symbol || !snap?.date || !snap?.groups || !read) return null
  const groups = {}
  for (const g of GROUPS) {
    const s = snap.groups[g.key] || {}
    groups[g.key] = { net: num(s.net), wow: num(s.wow), index: num(s.index) }
  }
  return {
    market: symbol,
    // The rail falls back to the code itself when it has no name; storing that
    // twice would print "ES (ES)".
    ...(name && name !== symbol ? { marketName: name } : {}),
    reportDate: snap.date,
    groups,
    openInterest: { value: num(snap.oi?.value), wow: num(snap.oi?.wow), index: num(snap.oi?.index) },
    bias: read.bias ? { label: read.bias.label, tone: read.bias.tone, strength: read.bias.strength || null } : null,
    crowding: read.crowding ? { label: read.crowding.label, tone: read.crowding.tone, index: num(read.crowding.index) } : null,
  }
}
