// The drill window's READING STRIP and HISTORY drawer: what the numbers say, in words.
//
// The answer comes from `GET /api/breadth-monitor/reading` (api/services/breadth_reading.py):
// the reading's percentile over the calibration window, the level + tone the Monitor cell is
// shaded with (the same rule), what the S&P did next after similar readings beside the same
// numbers over every session (the baseline), the five closest past days, and the context.
//
// Three states (owner, 2026-11-19: on an ordinary day the stats are mostly worthless):
//   notable  — the cell is shaded (Notable / Strong / Extreme): toned rank line, full History.
//   typical  — the middle 50%, unshaded: a quiet "Typical · 52nd percentile" line, a muted
//              History button, and a drawer that says the outcome matched an ordinary day.
//   quiet    — unshaded but outside the middle half (e.g. a low reading of a column only its
//              high end is shaded on): the rank in muted words, the History as for notable.

import { universeParam, universeLabel } from '../../monitorUniverses'

/** ⭐ ONE AUTHOR FOR THE KEY: the SWR key and the URL are this exact string. */
export function readingKey({ universe = 'uct', metric, date, value = null, per = null } = {}) {
  if (!metric || !date) return null
  let k = `/api/breadth-monitor/reading?metric=${encodeURIComponent(metric)}&date=${date}${universeParam(universe)}`
  // ⭐ The CELL's value is what is ranked (the sheet's number; for today's live cell the only
  // one there is). The history it is ranked against is the calibration's point-in-time series.
  if (Number.isFinite(value)) {
    k += `&value=${value}`
    if (Number.isFinite(per)) k += `&per=${per}`
  }
  return k
}

export function ordinal(n) {
  const v = Math.round(n)
  const s = v % 100
  if (s >= 11 && s <= 13) return `${v}th`
  return `${v}${({ 1: 'st', 2: 'nd', 3: 'rd' })[v % 10] || 'th'}`
}

/** "6%", "0.5%", "<0.1%" — a tail share, never "0%". */
export function fmtShare(x) {
  if (!Number.isFinite(x)) return '—'
  if (x < 0.1) return '<0.1%'
  if (x < 1) return `${x.toFixed(1)}%`
  return `${Math.max(1, Math.round(x))}%`
}

/** A signed S&P move, "+0.9%" / "-2.3%". */
export function fmtMove(x) {
  if (!Number.isFinite(x)) return '—'
  const r = Math.round(x * 10) / 10
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}${Math.abs(r).toFixed(1)}%`
}

export function fmtDate(d) {
  if (!d) return ''
  const [y, m, dd] = d.split('-').map(Number)
  return new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const sinceYear = (r) => (r?.window?.start ? r.window.start.slice(0, 4) : '')

/** The state a reading is in: 'notable' | 'typical' | 'quiet'. */
export function readingState(r) {
  if (!r?.ok) return null
  if (r.level >= 1) return 'notable'
  return r.typical ? 'typical' : 'quiet'
}

/**
 * The rank line under the big number.
 * @returns {{state, text, word, tone, marker, zone, faint, emphasis}|null}
 */
export function rankLine(r) {
  const state = readingState(r)
  if (!state) return null
  const year = sinceYear(r)
  const top = r.side === 'high'
  const pct = r.percentile
  // The track's shaded zone is the tail the reading's side would be shaded in (25% = Notable).
  const zone = top ? { from: 75, to: 100 } : { from: 0, to: 25 }
  const marker = Math.max(0, Math.min(100, pct))
  const times = r.beyond?.count ?? 0
  const years = r.window?.years ?? 0
  let text, word = null, tone = null, faint
  if (state === 'typical') {
    text = `Typical · ${ordinal(pct)} percentile since ${year}`
    faint = `In the middle half of ${r.window.sessions.toLocaleString('en-US')} sessions since ${year}`
  } else {
    text = `${top ? 'Top' : 'Bottom'} ${fmtShare(r.share)} since ${year}`
    if (state === 'notable') {
      word = r.level_word
      tone = r.tone
    } else {
      word = top ? 'Above typical' : 'Below typical'
    }
    const last = r.beyond?.last_date
    faint = last
      ? `Last this ${top ? 'high' : 'low'}: ${fmtDate(last)} · seen ${times.toLocaleString('en-US')} ${times === 1 ? 'time' : 'times'} in ${years} years`
      : `First time this ${top ? 'high' : 'low'} since ${year} · seen ${times.toLocaleString('en-US')} ${times === 1 ? 'time' : 'times'}`
  }
  return { state, text, word, tone, marker, zone, faint, emphasis: state !== 'typical' }
}

const HZ = ['5', '20', '60']

/** One row of the "What the S&P did next" table. */
function fwdRow(block) {
  return HZ.map(h => block?.[h] || { median: null, higher: null, n: 0 })
}

/** How a value compares with its 20-day average, in the column's own terms. */
export function vsAverage(r, fmt = String) {
  const v = r?.value
  let a = r?.context?.avg20
  if (!Number.isFinite(v) || !Number.isFinite(a)) return null
  // A count averages to a fraction; it prints as a whole number like the count itself.
  if (Number.isInteger(v)) a = Math.round(a)
  const diff = v - a
  const pts = /^pct_|^aaii_|naaim|uct_exposure|cnn_fear_greed/.test(r.metric || '')
  let head
  if (r.rank?.signed || a <= 0) head = `${diff >= 0 ? '+' : '-'}${fmt(Math.abs(diff))}`
  else if (pts) head = `${diff >= 0 ? '+' : '-'}${Math.abs(diff).toFixed(1)} pts`
  else head = `${diff >= 0 ? '+' : '-'}${Math.abs(Math.round((diff / a) * 100))}%`
  return { head, detail: `(${fmt(v)} vs ${fmt(a)})` }
}

export function streakText(r) {
  const s = r?.context?.streak
  if (!s) return null
  const where = s.side === 'middle' ? 'the middle half'
    : `the ${s.side === 'high' ? 'top' : 'bottom'} ${s.band}%`
  return s.days > 1 ? `${ordinal(s.days)} straight day in ${where}` : `1st day in ${where}`
}

/** Everything the History panel draws. */
export function historyModel(r, fmt = String) {
  const state = readingState(r)
  if (!state) return null
  const year = sinceYear(r)
  const sim = r.similar || {}
  const basis = sim.rule === 'band'
    ? `After the ${sim.n.toLocaleString('en-US')} sessions within ${sim.band_pts} percentile points of this reading since ${year}`
    : `After the ${sim.n.toLocaleString('en-US')} sessions closest to this reading since ${year}`
  return {
    state,
    basis,
    similar: fwdRow(r.forward?.similar),
    baseline: fwdRow(r.forward?.baseline),
    small: !!sim.small,
    smallNote: `Only ${(r.forward?.similar?.['5']?.n ?? 0).toLocaleString('en-US')} similar days, too few to lean on.`,
    seriesBasis: r.forward?.basis || 'S&P 500',
    typicalNote: 'Typical reading: what came next matched an ordinary day.',
    closest: (r.closest || []).map(c => ({
      date: c.date, label: fmtDate(c.date), value: Number.isFinite(c.value) ? fmt(c.value) : '—',
      next: fmtMove(c.fwd20),
    })),
    vsAvg: vsAverage(r, fmt),
    streak: streakText(r),
    last: r.beyond?.last_date ? fmtDate(r.beyond.last_date) : 'Not before this day',
    rankBasis: `${r.rank?.by === 'share' ? 'Share of the universe, ' : ''}all ${universeLabel(r.basis_universe)} sessions since ${year}`,
    year,
  }
}
