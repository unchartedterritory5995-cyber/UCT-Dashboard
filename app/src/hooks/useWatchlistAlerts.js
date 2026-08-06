import useSWR, { mutate as globalMutate } from 'swr'
import { useAuth } from '../context/AuthContext'

const fetcher = url => fetch(url).then(r => r.ok ? r.json() : [])

// The Alerts widget reads '/api/watchlist-alerts?active_only=false'; this hook (bell,
// chart menus, TickerActions) reads '/api/watchlist-alerts'. A create/delete from ANY
// caller must refresh EVERY watchlist-alerts cache — otherwise the Alerts widget won't
// show a chart-menu-created alert until a manual refresh. Revalidate by key prefix.
const ALERTS_WIDGET_KEY = '/api/watchlist-alerts?active_only=false'
const revalidateAllAlerts = () =>
  globalMutate(k => typeof k === 'string' && k.startsWith('/api/watchlist-alerts'))

export default function useWatchlistAlerts() {
  const { user } = useAuth()
  const { data } = useSWR(user ? '/api/watchlist-alerts' : null, fetcher, {
    refreshInterval: 30000,
    dedupingInterval: 10000,
  })

  const alerts = Array.isArray(data) ? data : []

  async function createAlert(sym, targetPrice, direction) {
    try {
      const res = await fetch('/api/watchlist-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sym, target_price: targetPrice, direction }),
      })
      const created = res.ok ? await res.json().catch(() => null) : null
      // Optimistically show it in the Alerts widget, then revalidate every alert cache.
      if (created?.id) {
        globalMutate(ALERTS_WIDGET_KEY,
          cur => (Array.isArray(cur) ? [created, ...cur] : cur), { revalidate: true })
      }
      revalidateAllAlerts()
    } catch { /* non-fatal */ }
  }

  async function deleteAlert(alertId) {
    try {
      await fetch(`/api/watchlist-alerts/${alertId}`, { method: 'DELETE' })
      globalMutate(ALERTS_WIDGET_KEY,
        cur => (Array.isArray(cur) ? cur.filter(a => a.id !== alertId) : cur), { revalidate: true })
      revalidateAllAlerts()
    } catch { /* non-fatal */ }
  }

  function getAlertsForSym(sym) {
    return alerts.filter(a => a.sym === sym?.toUpperCase() && a.is_active)
  }

  function hasAlert(sym) {
    return alerts.some(a => a.sym === sym?.toUpperCase() && a.is_active)
  }

  return { alerts, createAlert, deleteAlert, getAlertsForSym, hasAlert }
}
