// app/src/testing/rsPriceHost/rsPriceHarness.jsx
//
// ─── UCT RS split, U2 · the price-pane hosts, in a real browser ─────────────
//
// A dev-only probe (`rs-price-harness.html`, never built): the real StockChart,
// the real renderer, the RS line displayed ON PRICE (`placement.target: 'price'`
// on the stored instance, the "Display in" write), synthetic bars and a PRIMED RS
// envelope. What it shows is what U2 adds: the `RS 96` tag at the line's end, and
// the ranks strip on the price pane. `?w=390&h=844` sizes the card like a phone.
//
// ⛔ No backend is asked for anything this page draws. `/api/auth/preferences` is
// severed both ways (the pane harness's lock 3), bars are generated here, and the
// RS columns are primed into `serverCompute`'s cache before the chart mounts, so
// `computeFor`'s server branch is a cache hit and never fetches.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import StockChart from '../../components/StockChart'
import { AuthProvider } from '../../context/AuthContext'
import { VoiceProvider } from '../../context/VoiceContext'
import '../../index.css'
import { mergeChartSettings } from '../../components/chart/chartDefaults'
import * as registry from '../../components/chart/engine/nativeRegistry'
import { primeServerColumns, pickServerInputs } from '../../components/chart/engine/serverCompute'

const realFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  if (url.includes('/api/auth/preferences')) {
    return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
  }
  return realFetch(input, init)
}

const q = new URLSearchParams(location.search)
const W = Number(q.get('w')) || null
const H = Number(q.get('h')) || 770
const SYM = 'AAPL'
const TF = 'D'
const PLACE = q.get('place') === 'pane' ? 'pane' : 'price'

// ── synthetic AAPL-shaped daily bars: a year and a half of weekdays ──────────
function makeBars(n = 380) {
  const out = []
  let d = new Date(Date.UTC(2025, 4, 1))
  let px = 190
  let i = 0
  while (out.length < n) {
    d = new Date(d.getTime() + 86400000)
    const dow = d.getUTCDay()
    if (dow === 0 || dow === 6) continue
    i += 1
    const drift = 0.0009 + 0.002 * Math.sin(i / 37)
    const noise = Math.sin(i * 1.7) * 0.012 + Math.cos(i * 0.61) * 0.008
    const o = px
    px = px * (1 + drift + noise)
    const c = px
    const h = Math.max(o, c) * (1 + 0.006 + Math.abs(Math.sin(i * 2.3)) * 0.006)
    const l = Math.min(o, c) * (1 - 0.006 - Math.abs(Math.cos(i * 1.9)) * 0.006)
    out.push({ t: d.toISOString().slice(0, 10), o, h, l, c, v: Math.round(45e6 + 25e6 * Math.abs(Math.sin(i / 5))) })
  }
  return out
}
const bars = makeBars()

// ── the RS envelope: ratio to a synthetic benchmark, its 21-day average, above/below ──
function envelopeFor(def, stored) {
  const times = bars.map((b) => Number(b.t.replace(/-/g, '')))
  const bench = bars.map((_, i) => 100 * (1 + 0.0005 * i + 0.03 * Math.sin(i / 23)))
  const rs = bars.map((b, i) => b.c / bench[i])
  const ma = rs.map((_, i) => {
    if (i < 20) return null
    let s = 0
    for (let k = i - 20; k <= i; k++) s += rs[k]
    return s / 21
  })
  const above = rs.map((v, i) => (ma[i] === null ? null : (v >= ma[i] ? 1 : 0)))
  const columns = {}
  for (const key of registry.columnKeys(def)) columns[key] = bars.map(() => null)
  columns.rsLine = rs
  columns.rsMa = ma
  columns.rsAbove = above
  const inputs = pickServerInputs(def, registry.resolveInputs(def, stored))
  const rating = { ibd: 96, fast: 94, asof: bars.at(-1).t, m1: 91, m3: 97, m6: 95, m9: 93, m12: 88, source: 'row' }
  primeServerColumns(def.id, SYM, TF, inputs, { rev: def.compute.rev, times, columns, payload: { rating } })
}

const RS = registry.getDefinition('rsLine')
const STORED = {}
envelopeFor(RS, STORED)

const cs = mergeChartSettings({
  indicatorInstances: [{ instanceId: 'rs-1', defId: 'rsLine', inputs: STORED, hidden: false,
    ...(PLACE === 'price' ? { placement: { target: 'price' } } : {}) }],
})

function Harness() {
  return (
    <div style={{ width: W ? `${W}px` : '100%', height: `${H}px`, position: 'relative', margin: 0 }}>
      <StockChart
        sym={SYM}
        tf={TF}
        volumeSeparatePane
        blankVolume={false}
        barsOverride={bars}
        settingsOverride={cs}
        onSettingsPersist={() => {}}
        onWatermarkCommit={() => {}}
        lockWatermark
        alwaysShowLegend
        height={H}
      />
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
