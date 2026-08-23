// app/src/components/dashboard/sessionModel.js — pure session helpers shared by
// MarketClock and ChartMarketClock. Extracted 2026-08-22 from MarketStatusBar.jsx,
// a header strip that was built but never mounted and has since been deleted;
// these helpers were the only part of it anything imported.

export function sessionModel({ isOpen, isPremarket, isExtended }) {
  if (isOpen) return { label: 'MARKET OPEN', tone: 'open' }
  if (isPremarket) return { label: 'PRE-MARKET', tone: 'ext' }
  if (isExtended) return { label: 'AFTER-HOURS', tone: 'ext' }
  return { label: 'MARKET CLOSED', tone: 'closed' }
}

const _DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Orientation for a closed/pre/after-hours pill: when the regular session next
// opens. "Opens 9:30 AM ET" if that's later today, else names the next weekday
// ("Opens Mon 9:30 AM ET" on a weekend / Friday evening).
export function nextOpenHint() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  const mins = et.getHours() * 60 + et.getMinutes()
  const isWeekday = day >= 1 && day <= 5
  if (isWeekday && mins < 9 * 60 + 30) return 'Opens 9:30 AM ET'
  let d = day
  do { d = (d + 1) % 7 } while (d === 0 || d === 6)
  return `Opens ${_DAY[d]} 9:30 AM ET`
}
