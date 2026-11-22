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
// ⭐ U7 (RS split): `?avg=1` turns the slim RS Line's Show average on, `?red=1` its
// Red-day highs (both stored on the instance, as a member's switch would be).
const AVG = q.get('avg') === '1'
const RED = q.get('red') === '1'

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
    // ⭐ U7: price pulls back ~5% while the benchmark sells off harder (bars
    // 338–350, see `envelopeFor`), so an RS new high lands under the price high.
    const shock = i >= 338 && i <= 350 ? -0.0045 : 0
    const drift = 0.0009 + 0.002 * Math.sin(i / 37) + shock
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
  // ⭐ U7: a benchmark sell-off late in the series (bars 338–352, inside the default
  // view), so the RS line makes new highs while price sits under its own high: the
  // gold before-price dot, and a red-day high (the benchmark down 0.5% or more).
  const dip = (i) => (i >= 338 && i <= 352 ? 1 - 0.09 * Math.min(1, (i - 337) / 6) : 1)
  const bench = bars.map((_, i) => 100 * (1 + 0.0005 * i + 0.03 * Math.sin(i / 23)) * dip(i))
  const rs = bars.map((b, i) => b.c / bench[i])
  const ma = rs.map((_, i) => {
    if (i < 20) return null
    let s = 0
    for (let k = i - 20; k <= i; k++) s += rs[k]
    return s / 21
  })
  const above = rs.map((v, i) => (ma[i] === null ? null : (v >= ma[i] ? 1 : 0)))
  // ⭐ U7: the dots, by the server's own rules (`relative_strength.py`): an RS new
  // high is a close at or above the highest RS of the prior `lookback` bars (ties
  // count); before price when the close is still more than 2% under its own
  // lookback high; on a red day when the benchmark closed down 0.5% or more.
  const LOOKBACK = 252
  const dotNH = rs.map(() => null)
  const dotNHbeforePx = rs.map(() => null)
  const dotNHred = rs.map(() => null)
  for (let i = 20; i < rs.length; i++) {
    const from = Math.max(0, i - LOOKBACK)
    let rsMax = -Infinity
    let pxMax = -Infinity
    for (let k = from; k < i; k++) { rsMax = Math.max(rsMax, rs[k]); pxMax = Math.max(pxMax, bars[k].c) }
    if (rs[i] >= rsMax) {
      dotNH[i] = rs[i]
      if (bars[i].c < pxMax * 0.98) dotNHbeforePx[i] = rs[i]
      if (bench[i] / bench[i - 1] - 1 <= -0.005) dotNHred[i] = rs[i]
    }
  }
  const columns = {}
  for (const key of registry.columnKeys(def)) columns[key] = bars.map(() => null)
  columns.rsLine = rs
  columns.rsMa = ma
  columns.rsAbove = above
  columns.dotNH = dotNH
  columns.dotNHbeforePx = dotNHbeforePx
  // As the server does: the red-day column is blank unless Red-day highs is on.
  columns.dotNHred = stored.showRedDay ? dotNHred : dotNHred.map(() => null)
  const inputs = pickServerInputs(def, registry.resolveInputs(def, stored))
  const rating = { ibd: 96, fast: 94, asof: bars.at(-1).t, m1: 91, m3: 97, m6: 95, m9: 93, m12: 88, source: 'row' }
  primeServerColumns(def.id, SYM, TF, inputs, { rev: def.compute.rev, times, columns, payload: { rating } })
}

const RS = registry.getDefinition('rsLine')
const STORED = { ...(AVG ? { showAverage: true } : {}), ...(RED ? { showRedDay: true } : {}) }
envelopeFor(RS, STORED)

// The target is stored EXPLICITLY either way: under the slim definition (U7,
// `VITE_RS_SPLIT_ENABLED=1`) price is already the default, and `?place=pane` is
// the "Display in → Own pane" write; under v5 it is the other way round.
const cs = mergeChartSettings({
  indicatorInstances: [{ instanceId: 'rs-1', defId: 'rsLine', inputs: STORED, hidden: false,
    placement: { target: PLACE, targetExplicit: true } }],
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
