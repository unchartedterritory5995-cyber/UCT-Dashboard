import FrozenList from './FrozenList'

/**
 * Themes journal renderer: the captured LEADERBOARD (owner-approved payload
 * freeze) — the visible theme ranking for one period with each theme's
 * return and top holdings as they stood. The taxonomy versions forward and
 * period returns have no as-of endpoint, so the payload is the only honest
 * record of that day's ranking. NOT the live ThemeTrackerPage (page-grade
 * renderer — the P2 disqualification).
 */
const PERIOD_LABEL = { '1d': 'Today', '1w': '1W', '1m': '1M', '3m': '3M', '1y': '1Y', ytd: 'YTD' }

export default function ThemesEmbed({ attrs, height = 320 }) {
  const params = attrs?.params || {}
  const period = PERIOD_LABEL[params.period] || params.period || ''
  return (
    <div style={{ height, overflow: 'hidden' }}>
      <FrozenList
        title={`Themes — ${period}`}
        subtitle={`${Array.isArray(params.rows) ? params.rows.length : 0} themes`}
        asOf={asOfText(attrs?.capturedAt)}
        rows={params.rows}
      />
    </div>
  )
}

function asOfText(capturedAt) {
  if (!capturedAt) return null
  const d = new Date(capturedAt)
  if (Number.isNaN(d.getTime())) return null
  return `as of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}
