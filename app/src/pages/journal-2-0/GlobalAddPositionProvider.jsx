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
import useJ2SelectedAccount from './hooks/useJ2SelectedAccount'
import AddPositionModal from './components/AddPositionModal'
import ChartContextMenu from '../../components/chart/ChartContextMenu'
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
  const { accountId, accounts } = useJ2SelectedAccount()
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
        getScreenshotBlob: d.getScreenshotBlob,
        sections: Array.isArray(d.sections) ? d.sections : [],
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
      // Pass bar OHLC so AddPositionModal can compute chart-aware stops
      // (bar_low_high mode uses the clicked bar's low/high directly).
      barLow: menu.bar.l,
      barHigh: menu.bar.h,
    })
  }, [menu])

  const handleSaveToNotebook = useCallback(async () => {
    if (!menu) return
    const ticker = menu.sym
    const today = new Date().toISOString().slice(0, 10)

    // Capture the chart screenshot up front (synchronous-ish; needs canvas
    // pixels before we navigate away). If anything fails, fall through
    // without a hero — note still gets created.
    let heroBlob = null
    if (typeof menu.getScreenshotBlob === 'function') {
      try {
        heroBlob = await menu.getScreenshotBlob()
      } catch (e) {
        console.warn('chart screenshot failed', e)
      }
    }

    try {
      const res = await fetch('/api/j2/notes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: ticker ? `${ticker} — ${today}` : `Note — ${today}`,
          ticker: ticker || null,
        }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const body = await res.json()
      const noteId = body.note.id

      // Upload hero in parallel-ish with the navigate. If it fails, the
      // note still exists — user can upload a hero manually.
      if (heroBlob) {
        try {
          const fd = new FormData()
          fd.append('file', heroBlob, `${ticker || 'chart'}-${today}.png`)
          await fetch(`/api/j2/notes/${noteId}/hero`, {
            method: 'POST', credentials: 'include', body: fd,
          })
        } catch (e) {
          console.warn('hero upload failed', e)
        }
      }

      window.location.href = `/journal?j2tab=notebook&note=${noteId}`
    } catch (e) {
      setToast({ message: `Could not create note: ${e.message || e}`, tone: 'error' })
    }
  }, [menu])

  const handleCreate = useCallback(async (payload) => {
    const acctId = payload.accountId || accountId || accounts[0]?.id || null
    await postPosition({ ...payload, accountId: acctId })
    await mutate('/api/j2/positions')
    const acctName = accounts.find((a) => a.id === acctId)?.name
    setToast({
      message: `Added ${payload.symbol} ${payload.side.toLowerCase()} to ${acctName || 'account'}`,
      tone: 'success',
    })
  }, [mutate, accountId, accounts])

  // Nothing to render when logged out or auth still resolving.
  if (loading || !user) return null

  // Compose the menu: chart region sections (from StockChart) → portfolio
  // actions (owned here) → the common view section (reset / settings).
  const regionSections = (menu?.sections || []).filter((s) => s.id !== 'view')
  const viewSections = (menu?.sections || []).filter((s) => s.id === 'view')
  const portfolioSection = {
    id: 'portfolio',
    items: [
      { id: 'add', label: '+ Add to Portfolio', primary: true, onSelect: handleAddFromBar },
      { id: 'note', label: '📓 Save to Notebook', onSelect: handleSaveToNotebook },
    ],
  }
  const menuSections = [...regionSections, portfolioSection, ...viewSections]

  return (
    <>
      <ChartContextMenu
        open={!!menu}
        x={menu?.clientX || 0}
        y={menu?.clientY || 0}
        sections={menuSections}
        onClose={() => setMenu(null)}
      />

      {prefill && settings && (
        <AddPositionModal
          settings={settings}
          prefill={prefill}
          onSave={handleCreate}
          onClose={() => setPrefill(null)}
          accountName={accounts.find((a) => a.id === accountId)?.name || accounts[0]?.name}
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
