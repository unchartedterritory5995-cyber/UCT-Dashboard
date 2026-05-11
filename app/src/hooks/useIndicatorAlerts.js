// app/src/hooks/useIndicatorAlerts.js
// SWR hook + helpers for chart indicator alerts (RSI / MACD / BB / Stoch / Williams%R / CCI / MFI / Price-vs-MA).
// Talks to /api/indicator-alerts (see api/routers/indicator_alerts.py).
import useSWR, { mutate } from 'swr'
import { useAuth } from '../context/AuthContext'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { alerts: [] }))

const KEY = '/api/indicator-alerts'

export function useIndicatorAlerts() {
  const { user } = useAuth()
  const { data, error, isLoading } = useSWR(user ? KEY : null, fetcher, {
    refreshInterval: 30000,
    dedupingInterval: 10000,
  })
  const alerts = Array.isArray(data?.alerts) ? data.alerts : []
  return {
    alerts,
    isLoading: isLoading && !data && !error,
    refresh: () => mutate(KEY),
  }
}

export async function createIndicatorAlert(payload) {
  try {
    const r = await fetch(KEY, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (r.ok) {
      mutate(KEY)
      return await r.json()
    }
  } catch {
    // swallow; UI will reflect failure via SWR cache
  }
  return null
}

export async function deleteIndicatorAlert(id) {
  try {
    await fetch(`${KEY}/${id}`, { method: 'DELETE', credentials: 'include' })
    mutate(KEY)
  } catch {
    // ignore
  }
}

export async function toggleIndicatorAlert(id) {
  try {
    const r = await fetch(`${KEY}/${id}/toggle`, { method: 'POST', credentials: 'include' })
    mutate(KEY)
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}
