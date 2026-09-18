// app/src/testing/vscale/vscaleHarness.jsx
//
// ─── THE PINCH, IN A REAL BROWSER ───────────────────────────────────────────
//
// ⭐⭐ WHY THIS EXISTS. The defect is INTERACTION-DEPENDENT: it appears only after
// a real drag on the right price scale, and only compounds across subsequent
// pans and wheel-zooms. A jsdom rail can model lightweight-charts' price scale
// (and `StockChart.verticalViewLock.test.jsx` does, to six decimal places) but a
// model of the renderer is still a model. This page removes it: real StockChart,
// real lightweight-charts, real canvas, real pointer events.
//
// ⛔ IT IS A PROBE, NOT A FEATURE. No app route imports it; `vite build` takes
// `index.html` as its only input, so it cannot ship. It reads geometry through
// `window.__uctChartDebug` — the read-only handle StockChart already publishes —
// rather than reaching into the component, so nothing here can change what it is
// measuring.
//
// ⛔⛔ AND IT CANNOT TOUCH MAIN TRADING, for the reason `pane-harness.html` gives
// at length: that row is one `chart_settings` preference on one user and there is
// no disposable copy of it. Three locks; the third wraps `fetch`.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import StockChart from '../../components/StockChart'
import { AuthProvider } from '../../context/AuthContext'
import { VoiceProvider } from '../../context/VoiceContext'
import '../../index.css'
import { mergeChartSettings } from '../../components/chart/chartDefaults'
import * as registry from '../../components/chart/engine/nativeRegistry'
import { addInstance, setInstanceDisplayTarget, setInstancePanePosition } from '../../components/chart/engine/instanceControls'
import { gesture, wheel, readScale, countLockWrites } from './gestureDriver'
import { setPaneOrder, PRICE_PANE, VOLUME_PANE } from '../../components/chart/engine/paneOrder'

// ─── LOCK 3 — THE PREFERENCE ENDPOINT IS SEVERED, BOTH WAYS ─────────────────
// Installed BEFORE React mounts. The READ is cut too: `settingsOverride` MERGES
// `indicatorInstances` by id, so with the member's real blob underneath, this page
// would be drawing THEIR indicators. See `paneHarness.jsx` for the measurement.
const BLOCKED = []

// ─── FRAME SHIM — ONLY WHEN THE TAB IS HIDDEN ───────────────────────────────
//
// ⚠️ A MINIMISED CHROME WINDOW REPORTS `visibilityState === 'hidden'` AND CHROME
// SUSPENDS `requestAnimationFrame` OUTRIGHT. StockChart schedules its view-lock
// capture on a rAF, so an automated pass against a hidden tab would be measuring a
// product whose capture path never runs — and would report a clean sheet for the
// wrong reason. The shim changes NOTHING about the product (it still calls rAF);
// it drives the frames from a MessageChannel tick, which Chrome does not throttle.
// Inert the moment the tab is actually visible.
if (typeof window !== 'undefined' && document.visibilityState === 'hidden' && !window.__vscaleRafShim) {
  window.__vscaleRafShim = true
  let nextId = 1
  const pending = new Map()
  window.requestAnimationFrame = (cb) => {
    const id = nextId++
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      if (!pending.delete(id)) return
      try { cb(performance.now()) } catch (e) { console.error('[vscale-harness] rAF callback threw', e) }
    }
    pending.set(id, ch)
    ch.port2.postMessage(0)
    return id
  }
  window.cancelAnimationFrame = (id) => { pending.delete(id) }
}

const realFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
  if (url.includes('/api/auth/preferences')) {
    if (method !== 'GET') {
      BLOCKED.push(`${method} ${url}`)
      // eslint-disable-next-line no-console
      console.error('[vscale-harness] REFUSED a preference write:', method, url, init && init.body)
    }
    return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
  }
  return realFetch(input, init)
}

const SYM = 'AAPL'
const TF = 'D'
const LOCK_KEY = 'vscale.harness.viewLock'

// ─── DETERMINISTIC BARS ─────────────────────────────────────────────────────
// Seeded, so two runs of the same gesture script produce the same numbers and a
// before/after comparison means something. No backend required.
const BARS = (() => {
  let seed = 20260918
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const out = []
  let c = 180
  for (let i = 0; i < 600; i++) {
    const t = new Date(Date.UTC(2023, 0, 3) + i * 86400000)
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue
    const o = c
    c = Math.max(20, o * (1 + (rnd() - 0.48) * 0.028))
    const h = Math.max(o, c) * (1 + rnd() * 0.012)
    const l = Math.min(o, c) * (1 - rnd() * 0.012)
    out.push({
      t: t.toISOString().slice(0, 10),
      o: +o.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), c: +c.toFixed(2),
      v: Math.round(2_000_000 + rnd() * 6_000_000),
    })
  }
  return out
})()

const btn = {
  background: '#1d2027', color: '#dfe3ea', border: '1px solid #333a45',
  borderRadius: 3, padding: '3px 8px', font: 'inherit', cursor: 'pointer', marginRight: 4,
}

function Harness() {
  const [cs, setCs] = useState(() => mergeChartSettings({}))
  const [topology, setTopology] = useState('price-volume')
  const [volSeparate, setVolSeparate] = useState(true)
  const [log, setLog] = useState([])
  // ⭐ THE PRODUCT'S OWN RESET, not a re-implementation. `ChartPane` passes this
  // prop in production and the menu it builds carries `resetView`; holding the
  // latest detail here is what lets the browser pass press the real button.
  const menuRef = useRef(null)
  const [rows, setRows] = useState([])
  const writesRef = useRef(0)
  const hostRef = useRef(null)

  const say = useCallback((s) => {
    setLog((l) => [`${new Date().toISOString().slice(11, 23)}  ${s}`, ...l].slice(0, 120))
  }, [])

  // ⭐ LOCK 2 — every settings write the product makes lands HERE.
  const onSettingsPersist = useCallback((next) => {
    writesRef.current += 1
    setCs(next)
    say(`persist intercepted (#${writesRef.current})`)
  }, [say])

  // ─── the pane topologies the fix has to hold in ───────────────────────────
  const override = useMemo(() => {
    let next = cs
    if (topology === 'rsi-below') {
      next = addInstance(next, 'rsi', registry)
    } else if (topology === 'above-price') {
      // ⭐ A PANE **ABOVE** PRICE — the regime in which "pane 0" stopped meaning
      // "Price", and the one every price-scale geometry defect has hidden in.
      // `setPaneOrder` is the product's ONE writer for the arrangement; the
      // per-instance door is what names WHICH copy is being moved.
      next = addInstance(next, 'rsi', registry)
      const minted = (next.indicatorInstances || []).filter((i) => i && !i.deleted).at(-1)
      if (minted) {
        next = setInstanceDisplayTarget(next, minted.instanceId, 'pane', registry)
        next = setInstancePanePosition(next, minted.instanceId, 'above', registry)
        next = setPaneOrder(next, [minted.instanceId, PRICE_PANE, VOLUME_PANE])
      }
    }
    return next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cs, topology])

  // ─── the measurement ──────────────────────────────────────────────────────
  const read = useCallback(() => {
    const dbg = window.__uctChartDebug && window.__uctChartDebug.main
    if (!dbg) return null
    const g = dbg.priceGeometry ? dbg.priceGeometry() : null
    const vr = dbg.visibleRange ? dbg.visibleRange() : null
    if (!g) return null
    // The CANDLE BAND, in pixels of Price's own pane: what the member means by
    // "the chart got smaller".
    let band = null
    if (vr && dbg.priceToY) {
      const s = Math.max(0, Math.floor(vr.from)), e = Math.min(BARS.length - 1, Math.ceil(vr.to))
      let hi = -Infinity, lo = Infinity
      for (let i = s; i <= e; i++) { const b = BARS[i]; if (!b) continue; if (b.h > hi) hi = b.h; if (b.l < lo) lo = b.l }
      if (hi > lo) {
        const yHi = dbg.priceToY(hi), yLo = dbg.priceToY(lo)
        if (yHi != null && yLo != null && g.paneHeight) {
          band = { yHi: +yHi.toFixed(1), yLo: +yLo.toFixed(1), occPct: +(((yLo - yHi) / g.paneHeight) * 100).toFixed(2) }
        }
      }
    }
    return { ...g, visibleRange: vr ? { from: +vr.from.toFixed(2), to: +vr.to.toFixed(2) } : null, band,
      storedLock: (() => { try { return JSON.parse(localStorage.getItem(LOCK_KEY)) } catch { return null } })(),
      prefWrites: writesRef.current }
  }, [])

  const capture = useCallback((op) => {
    const r = read()
    setRows((rs) => [...rs, { op, ...r }].slice(-80))
    return r
  }, [read])

  useEffect(() => {
    countLockWrites()
    const T = []
    const cap = (op) => { const s = readScale(); T.push({ op, ...s }); return s }
    // ⭐ THE GESTURE COORDINATES, IN CSS PIXELS. The price AXIS column is the
    // right ~76px of the host; everything left of it is plot.
    const axisX = () => {
      const r = hostRef.current ? hostRef.current.getBoundingClientRect() : null
      return r ? r.right - 30 : 0
    }
    const midY = () => {
      const r = hostRef.current ? hostRef.current.getBoundingClientRect() : null
      return r ? r.top + 220 : 0
    }
    const plotX = (f) => {
      const r = hostRef.current ? hostRef.current.getBoundingClientRect() : null
      return r ? r.left + r.width * f : 0
    }
    window.__vscale = {
      read, capture,
      rows: () => rows,
      clear: () => setRows([]),
      blockedPreferenceWrites: () => BLOCKED.slice(),
      prefWrites: () => writesRef.current,
      lockWrites: () => window.__vscaleLsWrites,
      bars: BARS,
      lockKey: LOCK_KEY,
      host: () => hostRef.current,
      // ── the scripted matrix ────────────────────────────────────────────────
      gesture, wheel, readScale, scale: () => readScale(),
      trace: () => T, clearTrace: () => { T.length = 0 },
      cap,
      /** Drag the RIGHT PRICE SCALE. dy<0 drags up, dy>0 drags down. */
      dragAxis: (dy) => gesture(axisX(), midY(), axisX(), midY() + dy, 10),
      /** Pan the plot left (into history) or right. */
      panLeft: () => gesture(plotX(0.72), midY(), plotX(0.72) - 110, midY(), 10),
      panRight: () => gesture(plotX(0.28), midY(), plotX(0.28) + 110, midY(), 10),
      zoomIn: () => wheel(plotX(0.5), midY(), -120),
      zoomOut: () => wheel(plotX(0.5), midY(), 120),
      /** The product's own Reset view, as the right-click menu calls it. */
      contextMenu: () => menuRef.current,
      resetView: () => { const m = menuRef.current; if (m && m.resetView) { m.resetView(); return true } return false },
    }
  }, [read, capture, rows])

  const cols = ['op', 'occPct', 'scaleMargins', 'paneIndex', 'paneHeight', 'visibleRange', 'pin', 'lockTop']
  const cell = (r, k) => {
    if (k === 'op') return r.op
    if (k === 'occPct') return r.band ? `${r.band.occPct}%` : '—'
    if (k === 'scaleMargins') return r.scaleMargins ? `${r.scaleMargins.top} / ${r.scaleMargins.bottom}` : '—'
    if (k === 'paneIndex') return r.paneIndex ?? '—'
    if (k === 'paneHeight') return r.paneHeight ?? '—'
    if (k === 'visibleRange') return r.visibleRange ? `${r.visibleRange.from}→${r.visibleRange.to}` : '—'
    if (k === 'pin') return r.manualPin ? `${r.manualPin.minValue?.toFixed(1)}–${r.manualPin.maxValue?.toFixed(1)}` : '—'
    if (k === 'lockTop') return r.viewLock && r.viewLock.top != null ? `${r.viewLock.top} / ${r.viewLock.bottom}` : '—'
    return '—'
  }

  return (
    <div>
      <div style={{ marginBottom: 6 }}>
        <b>vertical-scale harness</b> · {SYM} {TF} · {BARS.length} synthetic bars ·
        {' '}preference writes intercepted: {writesRef.current} · refused: {BLOCKED.length}
      </div>
      <div style={{ marginBottom: 6 }}>
        {['price-only', 'price-volume', 'rsi-below', 'above-price'].map((t) => (
          <button key={t} style={{ ...btn, outline: topology === t ? '1px solid #5b8dd9' : 'none' }}
            onClick={() => setTopology(t)}>{t}</button>
        ))}
        <button style={btn} onClick={() => setVolSeparate((v) => !v)}>
          volume: {volSeparate ? 'separate pane' : 'banded'}
        </button>
        <button style={btn} onClick={() => { setRows([]); say('trace cleared') }}>clear trace</button>
        <button style={btn} onClick={() => capture('manual')}>capture</button>
        <button style={btn} onClick={() => { localStorage.removeItem(LOCK_KEY); say('stored lock removed') }}>
          drop stored lock
        </button>
      </div>

      <div ref={hostRef} id="chart-host"
        style={{ height: 560, border: '1px solid #2a2f38', position: 'relative' }}>
        <StockChart
          sym={SYM}
          tf={TF}
          chartId="main"
          barsOverride={BARS}
          settingsOverride={override}
          onSettingsPersist={onSettingsPersist}
          volumeSeparatePane={volSeparate}
          blankVolume={false}
          /* The workspace regime: this is the ONLY one that carries a view lock. */
          carryDragPlacement
          keepPresentOnSymbolChange
          viewLockKey={LOCK_KEY}
          onBarContextMenu={(d) => { menuRef.current = d }}
          alwaysShowLegend
          lockWatermark
          onWatermarkCommit={() => {}}
        />
      </div>

      <div style={{ marginTop: 8, maxHeight: 220, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr>{cols.map((c) => (
            <th key={c} style={{ textAlign: 'left', padding: '2px 8px', color: '#8b93a1', borderBottom: '1px solid #2a2f38' }}>{c}</th>
          ))}</tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>{cols.map((c) => (
              <td key={c} style={{ padding: '1px 8px', whiteSpace: 'nowrap' }}>{cell(r, c)}</td>
            ))}</tr>
          ))}</tbody>
        </table>
      </div>

      <div style={{ marginTop: 6, maxHeight: 120, overflow: 'auto', color: '#8b93a1' }}>
        {log.map((l, i) => <div key={i}>{l}</div>)}
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
