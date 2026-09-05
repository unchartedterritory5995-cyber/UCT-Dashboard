// app/src/components/dashboard/sessionModel.js — pure session helpers shared by
// MarketClock and ChartMarketClock. Extracted 2026-08-22 from MarketStatusBar.jsx,
// a header strip that was built but never mounted and has since been deleted;
// these helpers were the only part of it anything imported.
//
// `nextOpenHint()` is upgraded (S11 continuation) to read the real NYSE
// calendar via `marketClock.nextBoundary()` instead of a fixed "next
// weekday" guess — it now correctly skips a holiday (e.g. never says
// "Opens Mon" when Monday is itself a market holiday).

import { nextBoundary } from '../../lib/marketClock/marketClock'

export function sessionModel({ isOpen, isPremarket, isExtended }) {
  if (isOpen) return { label: 'MARKET OPEN', tone: 'open' }
  if (isPremarket) return { label: 'PRE-MARKET', tone: 'ext' }
  if (isExtended) return { label: 'AFTER-HOURS', tone: 'ext' }
  return { label: 'MARKET CLOSED', tone: 'closed' }
}

function _formatBoundaryAt(at) {
  const now = new Date()
  const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' })
  const time = at.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })
  const sameDay = dateFmt.format(at) === dateFmt.format(now)
  return sameDay ? `${time} ET` : `${dayFmt.format(at)} ${time} ET`
}

// Orientation for a closed/pre/after-hours pill: when the regular session
// next opens. "Opens 9:30 AM ET" if that's later today, else names the next
// trading day ("Opens Mon 9:30 AM ET") — a holiday or weekend in between is
// skipped by S11's own calendar, never guessed as "the next weekday."
export function nextOpenHint() {
  let probe = new Date()
  for (let i = 0; i < 20; i += 1) {
    const ev = nextBoundary(probe)
    if (!ev) break
    if (ev.kind === 'open') return `Opens ${_formatBoundaryAt(ev.at)}`
    probe = ev.at
  }
  return 'Opens soon'
}
