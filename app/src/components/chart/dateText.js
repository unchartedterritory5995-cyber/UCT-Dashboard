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
