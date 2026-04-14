import useSWR from 'swr'
import { useAuth } from '../context/AuthContext'

const fetcher = url => fetch(url).then(r => r.ok ? r.json() : [])

export default function useWatchlistAlerts() {
  const { user } = useAuth()
  const { data, mutate } = useSWR(user ? '/api/watchlist-alerts' : null, fetcher, {
    refreshInterval: 30000,
    dedupingInterval: 10000,
  })

  const alerts = Array.isArray(data) ? data : []

  async function createAlert(sym, targetPrice, direction) {
    try {
      await fetch('/api/watchlist-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sym, target_price: targetPrice, direction }),
      })
      mutate()
    } catch {}
  }

  async function deleteAlert(alertId) {
    try {
      await fetch(`/api/watchlist-alerts/${alertId}`, { method: 'DELETE' })
      mutate()
    } catch {}
  }

  function getAlertsForSym(sym) {
    return alerts.filter(a => a.sym === sym?.toUpperCase() && a.is_active)
  }

  function hasAlert(sym) {
    return alerts.some(a => a.sym === sym?.toUpperCase() && a.is_active)
  }

  return { alerts, createAlert, deleteAlert, getAlertsForSym, hasAlert }
}
