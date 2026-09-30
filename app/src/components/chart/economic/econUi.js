// app/src/components/chart/economic/econUi.js
//
// ─── WHAT A MEMBER READS ABOUT AN ECONOMIC SERIES ────────────────────────────
//
// ⭐ ONE PLACE FOR THE WORDS. The symbol search row, the Add Indicator row, the
// primary chart's bar-info strip and its status line all describe the same
// series; each reads its subtitle / period / release / currentness sentence from
// here, so two surfaces cannot disagree about what "USCPI" is or whether it is up
// to date.
//
// ⛔ NO JARGON AND NO FALSE CLAIMS. "Up to date" is printed ONLY when the backend
// said CURRENT (`economicCurrentness(...).claimsCurrent`) — HTTP 200 never implies
// it — and never on an as-of / historical view. A configured (agency-practice)
// release time says "(typical)"; an unknown time prints no time at all.
//
// Pure functions, no fetch, no React: safe for tests and for every lazy chunk.
import { frequencyOf, observationLabel, etDateOf } from '../engine/economicSource'
import { formatKeyOf, formatFundamentalValue } from '../engine/fundamentalFormat'
import { CURRENTNESS } from '../../../utils/marketSession'

export const FREQUENCY_LABEL = Object.freeze({
  D: 'Daily', W: 'Weekly', M: 'Monthly', Q: 'Quarterly', A: 'Annual', IRREG: 'As announced',
})

/** `meta.frequency` ('M', 'W (week ending Saturday)', 'IRREG') -> 'Monthly'. */
export function frequencyLabel(frequency) {
  const f = frequencyOf({ frequency })
  return f ? FREQUENCY_LABEL[f] : ''
}

// The agency's everyday name. A UCT-derived series keeps its own honest words
// ("UCT (derived from BLS)") — a calculation must say it is one.
const AGENCY_SHORT = Object.freeze({
  'U.S. Bureau of Labor Statistics': 'BLS',
  'U.S. Bureau of Economic Analysis': 'BEA',
  'U.S. Census Bureau': 'Census Bureau',
  'U.S. Department of Labor, ETA': 'Dept. of Labor',
  'U.S. Energy Information Administration': 'EIA',
  'Board of Governors of the Federal Reserve System': 'Federal Reserve',
  'Federal Reserve Bank of New York': 'NY Fed',
  'Federal Housing Finance Agency': 'FHFA',
  'U.S. Treasury, Bureau of the Fiscal Service': 'U.S. Treasury',
})
export function agencyShort(agency) {
  if (typeof agency !== 'string' || !agency.trim()) return ''
  const a = agency.trim()
  return AGENCY_SHORT[a] || a
}

const UNITS_LABEL = Object.freeze({
  index: 'Index', '%': 'Percent', pp: 'Percentage points', USD: 'U.S. dollars',
  'USD/gal': 'Dollars per gallon', bbl: 'Barrels', persons: 'Persons', count: 'Count', units: 'Units',
})
export function unitsLabel(display) {
  if (typeof display !== 'string' || !display.trim()) return ''
  return UNITS_LABEL[display.trim()] || display.trim()
}

/**
 * The facts a row needs, from EITHER shape: a catalogue row (`/api/econ/catalog`:
 * `source.agency`, `units.display`) or a search row (`/api/ticker-search`:
 * `agency`, `units` as the display string).
 */
export function econFacts(row) {
  if (!row || typeof row !== 'object') return null
  const symbol = String(row.symbol || String(row.ticker || '').replace(/^ECON:/i, '') || '').toUpperCase()
  if (!symbol) return null
  const agency = (row.source && row.source.agency) || row.agency || ''
  const units = row.units && typeof row.units === 'object' ? row.units.display : row.units
  const pres = row.presentation
  return {
    symbol,
    id: `ECON:${symbol}`,
    name: row.name || row.short_name || symbol,
    shortName: row.short_name || row.name || symbol,
    agency: agencyShort(agency),
    frequency: frequencyLabel(row.frequency),
    units: unitsLabel(units),
    category: row.category || '',
    style: typeof pres === 'string' ? pres : (pres && pres.style) || null,
  }
}

/** 'BLS · Monthly · Index' — the one subtitle every economic row wears. */
export function economicSubtitle(row) {
  const f = econFacts(row)
  if (!f) return ''
  return [f.agency, f.frequency, f.units].filter(Boolean).join(' · ')
}

// ─── dates ─────────────────────────────────────────────────────────────────

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'YYYY-MM-DD' -> 'Sep 11' (this year) / 'Sep 11, 2025' (another year). */
export function shortDate(iso, { nowIso = null } = {}) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const thisYear = Number(String(nowIso || new Date().toISOString()).slice(0, 4))
  return y === thisYear ? `${MON[m - 1]} ${d}` : `${MON[m - 1]} ${d}, ${y}`
}

/** '08:30' -> '8:30 AM'. */
export function clock12(hm) {
  if (typeof hm !== 'string' || !/^\d{2}:\d{2}$/.test(hm)) return ''
  let [h, mi] = hm.split(':').map(Number)
  const ap = h >= 12 ? 'PM' : 'AM'
  h %= 12
  if (h === 0) h = 12
  return `${h}:${String(mi).padStart(2, '0')} ${ap}`
}

const TZ_ABBR = { 'America/New_York': 'ET', UTC: 'UTC' }

/**
 * `currentnessView.nextRelease` -> 'Oct 14, 8:30 AM ET' | 'Oct 14, 8:30 AM ET (typical)'
 * | 'Oct 14 (est.)' | 'Oct 14' | '' (unknown). ⛔ Never invents a time.
 */
export function nextReleaseText(nr, opts = {}) {
  if (!nr || !nr.date || nr.precision === 'unknown') return ''
  const day = shortDate(nr.date, opts)
  const tz = TZ_ABBR[nr.tz] || nr.tz || 'ET'
  const t = nr.time ? `${clock12(nr.time)} ${tz}` : ''
  switch (nr.precision) {
    case 'exact': return t ? `${day}, ${t}` : day
    case 'time_configured': return t ? `${day}, ${t} (typical)` : day
    case 'rule': return t ? `${day}, ~${t} (est.)` : `${day} (est.)`
    default: return day
  }
}

/**
 * The status line under an economic chart's legend.
 *   current          -> 'Up to date · next release Oct 14, 8:30 AM ET'
 *   updating         -> 'Update expected — checking'
 *   delayed          -> 'Delayed — the latest release has not arrived yet'
 *   unavailable      -> 'Source unavailable — showing the last good value'
 *   no_expectation   -> 'Not scheduled'   (UCT knows no upcoming release)
 *   historical view  -> 'Historical view (as of Sep 29, 2026)' — never 'up to date'
 * @returns {{tone: 'ok'|'wait'|'warn'|'muted', text: string}}
 */
export function economicStatusLine(view, opts = {}) {
  if (!view) return { tone: 'muted', text: '' }
  if (view.historical) {
    const d = Number.isFinite(view.asof) ? etDateOf(view.asof) : null
    return { tone: 'muted', text: d ? `Historical view (as of ${shortDate(d, { nowIso: '0000' })})` : 'Historical view' }
  }
  const next = nextReleaseText(view.nextRelease, opts)
  switch (view.state) {
    case CURRENTNESS.CURRENT:
      // ⛔ only the backend's CURRENT reaches here (`claimsCurrent`).
      if (!view.claimsCurrent) return { tone: 'muted', text: 'Not scheduled' }
      return { tone: 'ok', text: next ? `Up to date · next release ${next}` : 'Up to date' }
    case CURRENTNESS.UPDATING: return { tone: 'wait', text: 'Update expected — checking' }
    case CURRENTNESS.DELAYED: return { tone: 'warn', text: 'Delayed — the latest release has not arrived yet' }
    case CURRENTNESS.UNAVAILABLE: return { tone: 'warn', text: 'Source unavailable — showing the last good value' }
    default: return { tone: 'muted', text: next ? `Not scheduled · next release ${next}` : 'Not scheduled' }
  }
}

// ─── the readout under the crosshair ───────────────────────────────────────

/**
 * One observation, in a member's words:
 *   { value: '334.13', period: 'Aug 2026', released: 'released Sep 11',
 *     change: '+0.40', changePct: '+0.12%', up: true }
 * `prev` is the previous VALUED observation of the same series (for the change).
 */
export function observationReadout(point, prev, meta, opts = {}) {
  if (!point || !Number.isFinite(point.v)) return null
  const key = formatKeyOf(meta && meta.units)
  const fmt = (x) => (key ? formatFundamentalValue(x, key) : Number(x).toFixed(2))
  const freq = frequencyOf(meta)
  const t = Number.isFinite(point.tAvailable) ? point.tAvailable : point.t
  const released = Number.isFinite(t) ? `released ${shortDate(etDateOf(t), opts)}` : ''
  let change = null
  let changePct = null
  let up = null
  if (prev && Number.isFinite(prev.v)) {
    const dv = point.v - prev.v
    up = dv >= 0
    // ⭐ A CHANGE IN A RATE IS IN PERCENTAGE POINTS, never "%": 4.50% -> 4.25% is
    // "−0.25 pp", and a percent-of-a-percent is not printed at all.
    const fmtName = String(key || '').split('@')[0]
    const isRate = /^(pct|pp|bps)/.test(fmtName)
    const ppDigits = fmtName === 'pct1' ? 1 : 2
    const abs = /^pct/.test(fmtName) ? `${Math.abs(dv).toFixed(ppDigits)} pp`
      : (key ? formatFundamentalValue(Math.abs(dv), key) : Math.abs(dv).toFixed(2))
    change = `${up ? '+' : '−'}${String(abs).replace(/^-/, '')}`
    if (!isRate && prev.v !== 0) changePct = `${up ? '+' : '−'}${Math.abs((dv / Math.abs(prev.v)) * 100).toFixed(2)}%`
  }
  return {
    value: fmt(point.v),
    period: observationLabel(point, freq),
    released,
    change,
    changePct,
    up,
  }
}
