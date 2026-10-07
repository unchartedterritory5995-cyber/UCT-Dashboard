/**
 * DRILL-BOARD FOCUS — LIVE HARNESS (dev-server only; see drill-focus-harness.html;
 * railed out of the build by createIndicatorHarnessAbsent.test.js).
 *
 * Mounts the REAL `BreadthDrillModal` — its board, the drill list and the real
 * ChartWidget — so Create Indicator can be opened in the exact context where
 * production showed the composer NOT receiving keyboard focus (typing moved the
 * list / chart symbol instead).
 *
 * ⛔ LOCKS: preference / layout writes are refused and recorded
 * (`window.__dfh.blocked()`); `/converse` is answered by the scripted model
 * stand-in (`scriptedReply`) — no paid model. Never touches Main Trading.
 */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../index.css'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../context/AuthContext'
import BreadthDrillModal from '../../pages/breadth/drill/BreadthDrillModal'
import { setCreateIndicatorFlag } from '../../components/chart/builder/studio/createIndicatorFlag'
import { scriptedReply } from '../createIndicator/scriptedConverse'

const BLOCKED = []
/** SLICE 2 — every /converse request that left the page (the scripted model
 *  stands in for the server, so a pre-flight refusal shows as NO entry here). */
const CONVERSE = []
const realFetch = window.fetch.bind(window)
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } })
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  const method = ((init && init.method) || 'GET').toUpperCase()
  if (url.includes('/api/auth/preferences') || url.includes('/api/charts/layouts') || url.includes('/api/charts-layouts')) {
    if (method !== 'GET') BLOCKED.push(`${method} ${url}`)
    return json({})
  }
  if (url.includes('/api/user-definitions/converse') && method === 'POST') {
    let body = {}
    try { body = JSON.parse((init && init.body) || '{}') } catch { /* */ }
    CONVERSE.push({ message: body.message, chart: body.chart || null })
    await new Promise((r) => setTimeout(r, 300))
    return json(scriptedReply(body.message, body.view))
  }
  return realFetch(input, init)
}
const ITEMS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'TSLA', 'GOOGL', 'AMD']
  .map((t, i) => ({ t, pct: -4 - i * 0.1 }))
// ONE object for the life of the page — the board re-seeds on a new `drill`
const DRILL = { date: '2026-10-06', label: 'Dn 4%+', live: true, asOf: null, url: 'x', items: ITEMS, error: null }

function Harness() {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    window.__dfh = {
      blocked: () => BLOCKED.slice(),
      converse: () => CONVERSE.slice(),
      flag: (on) => setCreateIndicatorFlag(on),
      reopen: () => { setOpen(false); setTimeout(() => setOpen(true), 50) },
    }
  }, [])
  return (
    <MemoryRouter>
      <AuthProvider>
        {open && (
          <BreadthDrillModal
            drill={DRILL}
            latestDate="2026-10-06"
            onRetry={() => {}}
            onClose={() => setOpen(false)}
          />
        )}
      </AuthProvider>
    </MemoryRouter>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)
