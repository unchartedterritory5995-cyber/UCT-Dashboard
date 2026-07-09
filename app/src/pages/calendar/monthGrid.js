// app/src/pages/calendar/monthGrid.js
// Pure helper — no React, no SWR, no side effects.
// buildMonthGrid(year, month, daysMap, activeSources) → rows
// Each row is an array of 5 cells (Mon–Fri).
// Leading/trailing cells from adjacent months have inMonth=false.

/**
 * @param {number} year
 * @param {number} month  1-based
 * @param {Object} daysMap  { 'YYYY-MM-DD': { bmo, amc, econ, fed } }
 * @param {string[]} _sources  (unused; mine-flag comes from entry.mine already set by Calendar.jsx)
 * @returns {Array<Array<{ds,dayNum,inMonth,isToday,syms,mineSyms,hasMacro}>>}
 */
export function buildMonthGrid(year, month, daysMap, _sources) {
  const todayStr = new Date().toISOString().slice(0, 10)

  // First day of month (0=Sun … 6=Sat → convert to Mon=0 index)
  const firstOfMonth = new Date(year, month - 1, 1)
  // JS getDay(): 0=Sun,1=Mon…6=Sat. We want Mon=0.
  const firstDow = (firstOfMonth.getDay() + 6) % 7  // Mon=0…Fri=4,Sat=5,Sun=6

  // Last day of month
  const lastDay = new Date(year, month, 0).getDate()

  // Build flat list of cells covering full grid (Mon–Fri only)
  const cells = []

  // Leading days from prev month (Mon–Fri only; skip Sat/Sun)
  if (firstDow > 0) {
    // Walk backwards from day-before first of month
    const prevMonthEnd = new Date(year, month - 1, 0) // last day of prev month
    const daysBack = firstDow // number of weekday slots to fill (already filtered Sat/Sun)
    // We need to find 'firstDow' weekday slots going backwards
    let count = 0
    let cursor = new Date(prevMonthEnd)
    const prevLeadDays = []
    while (count < firstDow) {
      const dow = cursor.getDay() // 0=Sun,6=Sat
      if (dow !== 0 && dow !== 6) {
        prevLeadDays.unshift(new Date(cursor))
        count++
      }
      cursor.setDate(cursor.getDate() - 1)
    }
    for (const d of prevLeadDays) {
      cells.push(_makeCell(d, false, todayStr, daysMap))
    }
  }

  // All weekdays in the current month
  for (let day = 1; day <= lastDay; day++) {
    const d = new Date(year, month - 1, day)
    const dow = d.getDay() // 0=Sun,6=Sat
    if (dow !== 0 && dow !== 6) {
      cells.push(_makeCell(d, true, todayStr, daysMap))
    }
  }

  // Trailing days from next month to fill the last row to 5
  const remainder = cells.length % 5
  if (remainder !== 0) {
    const trailing = 5 - remainder
    let nextDay = new Date(year, month, 1) // 1st of next month
    let added = 0
    while (added < trailing) {
      const dow = nextDay.getDay()
      if (dow !== 0 && dow !== 6) {
        cells.push(_makeCell(nextDay, false, todayStr, daysMap))
        added++
      }
      nextDay.setDate(nextDay.getDate() + 1)
    }
  }

  // Chunk into rows of 5
  const rows = []
  for (let i = 0; i < cells.length; i += 5) {
    rows.push(cells.slice(i, i + 5))
  }
  return rows
}

function _iso(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function _makeCell(d, inMonth, todayStr, daysMap) {
  const ds = _iso(d)
  const day = daysMap?.[ds] || {}
  const bmo = day.bmo || []
  const amc = day.amc || []
  const tbd = day.tbd || []   // session-unconfirmed reporters (never coerced into AMC)
  const all = [...bmo, ...amc, ...tbd]
  const syms = all.map(e => e.sym).filter(Boolean)
  const mineSyms = new Set(all.filter(e => e.mine).map(e => e.sym).filter(Boolean))
  // Per-timing symbol lists so the month cell can split BMO (top) / AMC (bottom).
  const bmoSyms = bmo.map(e => e.sym).filter(Boolean)
  const amcSyms = amc.map(e => e.sym).filter(Boolean)
  const tbdSyms = tbd.map(e => e.sym).filter(Boolean)
  const hasMacro = !!(day.econ?.some(e => e.is_key) || day.fed?.length)
  return {
    ds,
    dayNum: d.getDate(),
    inMonth,
    isToday: ds === todayStr,
    syms,
    bmoSyms,
    amcSyms,
    tbdSyms,
    mineSyms,
    hasMacro,
  }
}
