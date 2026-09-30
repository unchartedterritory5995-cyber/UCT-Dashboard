// app/src/testing/economic/econUiHarness.jsx
//
// ─── THE ECONOMIC UI, THROUGH THE MEMBER'S REAL DOORS, IN A REAL BROWSER ─────
//
// ⭐ The REAL `ChartPane` (identity row + SymbolSearch + TF bar + StockChart +
// ChartSettingsModal → Indicators → ＋ Add Indicator), mounted exactly the way a
// ChartWidget EXTRA TAB mounts it: its own settings blob in `stored`, every write
// routed to `onStore` — so nothing here can reach the global `chart_settings`.
// `allowEconomic` is the one prop the /charts ChartWidget passes.
//
// ⛔ IT CANNOT WRITE A PREFERENCE: `window.fetch` answers `/api/auth/preferences`
// with `{}` and REFUSES any non-GET to it (the paneHarness lock). It never opens
// /charts and never talks to production — `/api` is the LOCAL acceptance server
// (`src/econHarness/econ_ui_local_server.py`) through `vite.config.econ-ui.mjs`.
//
// ?member=paid|free|anon (default paid) sets the `uct_session` cookie the local
// server's member table reads. ?sym=SPY|ECON:USCPI ?tf=D|W|M|5
// `window.__econUi` — state, setters and the chart's own debug read-outs.
//
// Dev-server only: `vite build` takes `index.html` as its single input.
/* eslint-disable react-refresh/only-export-components -- a dev-only page entry, never imported */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { AuthProvider } from '../../context/AuthContext'
import { VoiceProvider } from '../../context/VoiceContext'
import '../../index.css'
import ChartPane from '../../components/chart/pane/ChartPane'
import { mergeChartSettings } from '../../components/chart/chartDefaults'

const params = new URLSearchParams(location.search)
const MEMBER = params.get('member') || 'paid'
document.cookie = MEMBER === 'anon'
  ? 'uct_session=; Max-Age=0; path=/'
  : `uct_session=local-${MEMBER === 'free' ? 'free' : 'paid'}; path=/`

const BLOCKED = []
const REQUESTS = []
const realFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
  REQUESTS.push({ url, method, at: Math.round(performance.now()) })
  if (url.includes('/api/auth/preferences')) {
    if (method !== 'GET') BLOCKED.push(`${method} ${url}`)
    return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
  }
  return realFetch(input, init)
}

const CHART_ID = 'econ-ui-harness'

function Harness() {
  const [sym, setSym] = useState(params.get('sym') || 'SPY')
  const [tf, setTf] = useState(params.get('tf') || 'D')
  // ⭐ AN EXTRA TAB'S OWN BLOB (ChartWidget `activeStoredSettings`) — never global.
  const [stored, setStored] = useState(() => mergeChartSettings(JSON.stringify({})))
  const writes = useRef(0)
  const onStore = useCallback((next) => { writes.current += 1; setStored(next) }, [])
  const paneRef = useRef(null)

  useEffect(() => {
    window.__econUi = {
      get state() { return { sym, tf, stored, writes: writes.current, member: MEMBER } },
      setSym, setTf, setStored,
      openSettings: () => paneRef.current?.openSettings?.(),
      // StockChart keys its read-only debug handle by the chartId IT receives
      // (`main` when the pane does not forward one) — take whichever is mounted.
      debug: () => { const m = window.__uctChartDebug || {}; return m[CHART_ID] || m.main || Object.values(m)[0] || null },
      blocked: BLOCKED,
      requests: REQUESTS,
    }
  }, [sym, tf, stored])

  return (
    <div style={{ padding: 12, background: '#0b0d10', minHeight: '100vh', color: '#e6e8ec' }}>
      <div style={{ fontSize: 12, color: '#8a919e', marginBottom: 8, fontFamily: 'ui-monospace, monospace' }}
        data-testid="harness-head">
        econ-ui-harness · member={MEMBER} · sym={sym} · tf={tf} · LOCAL server only · host bars for SPY/QQQ are SYNTHETIC
      </div>
      <div style={{ width: 1360, height: 720, border: '1px solid #262a33', position: 'relative' }}>
        <ChartPane
          ref={paneRef}
          sym={sym}
          tf={tf}
          onSymbolChange={setSym}
          onTfChange={setTf}
          allowEconomic
          stored={stored}
          onStore={onStore}
          chartId={CHART_ID}
        />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <SWRConfig value={{ revalidateOnFocus: false, revalidateOnReconnect: false, dedupingInterval: 8000 }}>
      <AuthProvider>
        <VoiceProvider>
          <Harness />
        </VoiceProvider>
      </AuthProvider>
    </SWRConfig>
  </BrowserRouter>,
)
