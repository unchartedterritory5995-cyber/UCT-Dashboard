/**
 * GlobalAddPositionProvider — mount once at the app root.
 *
 * Listens for the `uct:chart-contextmenu` CustomEvent that every
 * StockChart across the dashboard dispatches on right-click (when no
 * explicit onBarContextMenu handler is supplied).
 *
 * Shows the "+ Add to Portfolio" context menu. On click, opens
 * Journal 2.0's AddPositionModal with the clicked bar's symbol,
 * close price, and date prefilled. The flow is identical to the
 * right-click inside Journal 2.0's own ChartModal — same components,
 * same POST to /api/j2/positions — just globally available.
 *
 * Skipped silently when the user isn't authenticated.
 */

import { useCallback, useEffect, useState } from 'react'
import { useSWRConfig } from 'swr'
import { useAuth } from '../../context/AuthContext'
import useJ2Settings from './hooks/useJ2Settings'
import AddPositionModal from './components/AddPositionModal'
import ChartContextMenu from './components/ChartContextMenu'
import Toast from './components/Toast'
import { money } from '../../lib/journal-2-0'

async function postPosition(payload) {
  const res = await fetch('/api/j2/positions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    let msg = `${res.status}`
    try {
      const data = await res.json()
      if (data?.detail) msg = data.detail
    } catch { /* non-JSON body */ }
    throw new Error(msg)
  }
  return res.json()
}

export default function GlobalAddPositionProvider() {
  const { user, loading } = useAuth()
  const { settings } = useJ2Settings()
  const { mutate } = useSWRConfig()

  const [menu, setMenu] = useState(null)       // { clientX, clientY, sym, bar }
  const [prefill, setPrefill] = useState(null) // { symbol, entryPrice, entryDate }
  const [toast, setToast] = useState(null)

  // Listen for chart right-click events dispatched by StockChart.
  useEffect(() => {
    if (loading) return
    const onEvt = (e) => {
      // Skip when not logged in — no Journal 2.0 account to write into.
      if (!user) return
      const d = e.detail || {}
      if (!d.sym || !d.bar) return
      setMenu({
        clientX: d.clientX,
        clientY: d.clientY,
        sym: d.sym,
        bar: d.bar,
      })
    }
    window.addEventListener('uct:chart-contextmenu', onEvt)
    return () => window.removeEventListener('uct:chart-contextmenu', onEvt)
  }, [loading, user])

  const handleAddFromBar = useCallback(() => {
    if (!menu) return
    const d = new Date(Number(menu.bar.t) * 1000)
    setPrefill({
      symbol: menu.sym,
      entryPrice: menu.bar.c,
      entryDate: d.toISOString().slice(0, 10),
    })
  }, [menu])

  const handleCreate = useCallback(async (payload) => {
    await postPosition(payload)
    // Invalidate the SWR caches the Journal 2.0 tab depends on so the
    // row appears immediately if the user navigates to /journal.
    await mutate('/api/j2/positions')
    setToast({
      message: `Added ${payload.symbol} ${payload.side.toLowerCase()} — ${payload.shares} @ ${money(payload.entryPrice)}`,
      tone: 'success',
    })
  }, [mutate])

  // Nothing to render when logged out or auth still resolving.
  if (loading || !user) return null

  return (
    <>
      <ChartContextMenu
        open={!!menu}
        x={menu?.clientX || 0}
        y={menu?.clientY || 0}
        onReset={null}
        onAddToPortfolio={handleAddFromBar}
        onOpenSettings={null}
        onClose={() => setMenu(null)}
      />

      {prefill && settings && (
        <AddPositionModal
          settings={settings}
          prefill={prefill}
          onSave={handleCreate}
          onClose={() => setPrefill(null)}
        />
      )}

      <Toast
        message={toast?.message}
        tone={toast?.tone}
        onDismiss={() => setToast(null)}
      />
    </>
  )
}
