// app/src/components/chart/dateText.js
//
// ⭐ THE ONE PARSER OF A TYPED DATE (review of #2987, N1). The chart's date box (ChartDateNav: Enter and the calendar's
// "Go to a date"), its digit-by-digit warm (chart/dateWarm.js) and any later reader of the draft (lane C's PR 2.2) read
// a typed M/D/YYYY through this function, so the warm always names the date Enter will go to.

/**
 * M/D/YYYY (the masked form; `-` or `.` also separate; a 2-digit year is 20YY). Returns UTC-midnight ms, or null.
 * A day past its month's end rolls into the next (2/30/2006 is 3/2/2006), as the date box always has.
 * @param {string} txt
 * @param {{whole?: boolean}} [o] `whole`: a DRAFT still being typed: a 3-digit year is not a date yet ("3/14/200" may
 *   become 2006), so only a 2- or 4-digit year parses
 * @returns {number|null}
 */
export function parseDate(txt, { whole = false } = {}) {
  if (!txt) return null
  const s = String(txt).trim()
  const mm = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (!mm) return null
  if (whole && mm[3].length === 3) return null
  let m = +mm[1], d = +mm[2], y = +mm[3]
  if (!y || !m || !d) return null
  if (y < 100) y += 2000
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return Date.UTC(y, m - 1, d)
}

/**
 * ⭐ THE ONE MASK OF A TYPED DATE (owner, 2026-11-28): both date boxes (the chart's ChartDateNav and the Breadth Monitor's
 * BreadthDateNav) format what the member types through this. Month and day take 2 digits only when the first two form a
 * valid value ("15..." -> 1/5, "12..." -> 12/...); the trailing year takes up to 4.
 * ⭐ A TYPED "/" (or "-" / ".") ENDS THE FIELD IT FOLLOWS. ⚰️ The mask used to strip every separator and re-infer them from the
 * digits, so "6/2/2023" became 6/22/023 and "1/2/2024" became 12/20/24, and the jump went to the wrong day or nowhere.
 * Digits alone keep the inference unchanged.
 * @param {string} raw
 * @returns {string}
 */
export function maskMDY(raw) {
  const ds = []
  const cuts = new Set()
  for (const ch of String(raw || '')) {
    if (ch >= '0' && ch <= '9') { if (ds.length < 8) ds.push(ch) } else if (ch === '/' || ch === '-' || ch === '.') cuts.add(ds.length)
  }
  const d = ds.join('')
  if (!d) return ''
  const endAt = (start, len) => { for (let p = start + 1; p < start + len; p += 1) if (cuts.has(p)) return p - start; return len }
  let i = 0
  let mlen
  if (d[0] === '0') mlen = 2
  else if (d[0] === '1') mlen = (d.length > 1 && '012'.includes(d[1])) ? 2 : 1
  else mlen = 1
  mlen = endAt(0, mlen)
  const month = d.slice(0, mlen); i = mlen
  if (i >= d.length) return cuts.has(i) ? `${month}/` : month
  let dlen
  if (d[i] === '0' || d[i] === '1' || d[i] === '2') dlen = 2
  else if (d[i] === '3') dlen = (d.length > i + 1 && '01'.includes(d[i + 1])) ? 2 : 1
  else dlen = 1
  dlen = endAt(i, dlen)
  const day = d.slice(i, i + dlen); i += dlen
  if (i >= d.length) return cuts.has(i) && day.length ? `${month}/${day}/` : `${month}/${day}`
  return `${month}/${day}/${d.slice(i, i + 4)}`
}
