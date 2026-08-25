/**
 * Session picker for the NH/NL scanner + H/L Pulse: "Live" plus any archived past
 * sessions the accumulator has stored (yesterday's regular hours, etc.), so a user
 * can review a completed session and toggle back to live.
 */
import useMobileSWR from '../../../hooks/useMobileSWR'

const fetcher = (u) =>
  fetch(u, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null)

const WLABEL = { pre: 'Pre-Market', rth: 'Regular', post: 'Post-Market' }

function fmtDate(d) {
  try {
    const [y, m, dd] = d.split('-').map(Number)
    return new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return d }
}

// Dropdown options: Live first, then archived sessions (newest first from the API).
export function useNhnlSessions() {
  const { data } = useMobileSWR('/api/nhnl/sessions', fetcher, {
    refreshInterval: 60000, dedupingInterval: 30000, revalidateOnFocus: false,
  })
  const sessions = data?.sessions || []
  return [
    { value: 'live', label: 'Live' },
    ...sessions.map(s => ({ value: `${s.date}:${s.window}`, label: `${fmtDate(s.date)} · ${WLABEL[s.window] || s.window}` })),
  ]
}

// A selection ('live' or 'YYYY-MM-DD:window') → the query suffix for /live and /series.
export function sessionQuery(sel) {
  if (!sel || sel === 'live') return ''
  const [date, window] = sel.split(':')
  return `&date=${date}&session=${window}`
}

export function isHistorical(sel) {
  return !!sel && sel !== 'live'
}
