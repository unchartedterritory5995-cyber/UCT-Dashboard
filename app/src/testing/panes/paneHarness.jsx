// app/src/testing/panes/paneHarness.jsx
//
// ─── P2.0d · PANE IDENTITY, IN A REAL BROWSER ───────────────────────────────
//
// ⭐⭐ WHY THIS EXISTS AT ALL. P2.0c is proven by 19,418 unit tests and by nine
// byte-exact parity suites — and the case that mattered most, *"two RSIs draw
// two lines in ONE pane"*, would have stayed green THROUGH the ruling that
// reversed it, because its mock answered `panes()` with a single frozen pane.
// The harness was upgraded, but a harness is still a model of the renderer. This
// page removes the model: real StockChart, real lightweight-charts, real DOM,
// real pane widgets, real bars off the running backend.
//
// ⛔ IT IS A PROBE, NOT A FEATURE. No app route imports it; `vite build` takes
// `index.html` as its only input, so it cannot ship. It drives the PRODUCT's own
// writers (`addInstance`, `setInstanceDisplayTarget`, `removeInstance`,
// `setInstancePanePosition`, `setInstanceInput`) rather than hand-editing a
// blob, so what it exercises is the path a member's click takes.
//
// ⛔⛔ AND IT CANNOT TOUCH MAIN TRADING. That row is one `chart_settings`
// preference on one user and there is no disposable copy of it
// (`uct-main-trading-frozen-fingerprint`). Three locks, listed in
// `pane-harness.html`; the third wraps `fetch` and refuses the write outright,
// precisely so the guarantee does not depend on StockChart behaving.

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
import {
  addInstance, removeInstance, setInstanceDisplayTarget, setInstancePanePosition,
  setInstanceInput,
} from '../../components/chart/engine/instanceControls'
import { instanceSource, symbolSource } from '../../components/chart/engine/sourceRef'
// ⭐ P2.3 — THE OPTION LIST THE SETTINGS MENU RENDERS, driven here against the
// real renderer. `ChartSettingsIndicators` calls exactly these two functions; a
// browser can prove what jsdom cannot, which is that the pane the member picks
// is the pane lightweight-charts actually draws into.
import { displayTargetOptions } from '../../components/chart/engine/displayTarget'
import {
  securityResults, breadthResults, createFromResult, CAPABILITY, lastCreatedInstance,
} from '../../components/chart/discoveryCatalog'
// ⭐ P2.2 — the REAL Add-to-Chart dialog, mounted here so the browser pass drives
// the member's own surface rather than the harness's buttons.
import IndicatorLibraryDialog from '../../components/chart/IndicatorLibraryDialog'
// ⭐ THE MEMBER'S MANAGEMENT SURFACE, ON THE ISOLATED BLOB (overnight, 2026-09-13).
// The library dialog is how a series gets ON the chart; this is where it is then
// named, restyled, moved and deleted — and the "Display in" menu, the missing-host
// state and the row labels all live here. Proving them in jsdom proves the markup;
// mounting the real modal proves the member's actual surface.
import ChartSettingsModal from '../../components/chart/ChartSettingsModal'
// ⭐ THE THIRD MEMBER SURFACE (UX pass, 2026-09-13). `BuilderSheet` has exactly
// one PRODUCT mount — `ChartToolbar` — and `BuilderSheet.test.jsx` parses THAT
// FILE's AST to keep it that way. This page is a dev-only probe that never ships
// (`vite build` takes `index.html` alone), so mounting one here adds no door a
// member can reach and breaks no rail; what it buys is the ability to look at
// the builder's three consumer contexts in a real browser.
import BuilderSheet from '../../components/chart/builder/BuilderSheet'
import * as engineRegistry from '../../components/chart/engine/nativeRegistry'

// ─── LOCK 3 — THE PREFERENCE ENDPOINT IS SEVERED, BOTH WAYS ─────────────────
//
// Installed BEFORE React mounts, so nothing can slip through during the first
// paint.
//
// ⛔ THE **READ** IS CUT TOO, and that is not paranoia — it is a correctness
// requirement this page discovered the hard way. `settingsOverride` is NOT a
// wholesale replacement for the instance list: `mergeSettingsOverride`
// (`instanceShape.js:97`) merges `indicatorInstances` BY `instanceId`, on purpose,
// so a grid cell's partial patch cannot delete instances it did not mention. It
// follows that an override can ADD and EDIT instances but can never REMOVE the
// base's — so with the member's real blob underneath, this page would have been
// drawing THEIR indicators (measured: the first boot rendered RSI(28) and MA(5)
// that the harness had not created, while its own instance count read 0).
//
// Cutting the GET makes `csBase` the pure default blob, which is what makes the
// isolation total rather than partial. Writes are refused separately and loudly,
// because a silent 403 and a silent 200 look the same from here.
const BLOCKED = []
const realFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
  if (url.includes('/api/auth/preferences')) {
    if (method !== 'GET') {
      const note = `${method} ${url}`
      BLOCKED.push(note)
      // eslint-disable-next-line no-console
      console.error('[pane-harness] REFUSED a preference write:', note, init && init.body)
    }
    // An empty preference set, for reads and refused writes alike.
    return Promise.resolve(new Response('{}', {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
  }
  return realFetch(input, init)
}

const LEGEND_PARAM = new URLSearchParams(location.search).get('legend')
const SYM = 'AAPL'
const TF = 'D'

/** Every live instance, flattened for the readout. */
const instancesOf = (cs) => (Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : [])
  .filter((i) => i && !i.deleted)

/** The renderer's own answer: which pane is each series in, right now. */
/** Three Price drawings at known prices — a trendline, a horizontal and a
 *  rectangle. `window.__paneHarness.drawingPrices` records what they were drawn
 *  at so a browser pass can check they still read the same after a reorder. */
const DRAWING_FIXTURES = [
  { id: 'd-trend', type: 'trendline', color: '#dcbb5e', width: 2,
    points: [{ time: '2026-07-01', price: 300 }, { time: '2026-09-01', price: 330 }] },
  { id: 'd-hline', type: 'horizontal', color: '#ff00ff', width: 3,
    points: [{ time: '2026-07-01', price: 310 }] },
  { id: 'd-rect', type: 'rect', color: '#00ffff', width: 2,
    points: [{ time: '2026-07-15', price: 295 }, { time: '2026-08-15', price: 320 }] },
]

function readPanes(container) {
  // The chart API is not exposed on the DOM, so the pane rectangles are read the
  // way a user sees them — the pane widgets lightweight-charts lays out. Their
  // ORDER in the DOM is their stack order.
  const rows = [...container.querySelectorAll('td.tv-lightweight-charts__pane, .tv-lightweight-charts table tr')]
  return rows.length
}

/**
 * ⭐⭐ EVERY PANE'S OWN CANVAS, MEASURED SEPARATELY — the helper that exists
 * because the obvious query is WRONG.
 *
 * ⚰️ MEASURED 2026-09-13: a colour check written as
 * `document.querySelector('canvas')` reads the PRICE pane and reports zero of a
 * secondary's colour while that secondary's pane is full of it. Every pane is
 * its own canvas; a global first-canvas query answers a different question and
 * answers it confidently.
 *
 * ⛔ DEV-ONLY, AND IT STAYS THAT WAY. `vite build` takes `index.html` alone, so
 * nothing here ships; the product needs no pane-pixel reader.
 *
 * @param {(r:number,g:number,b:number)=>string|null} classify  name a pixel, or null
 * @returns per-pane `{top, height, counts}` in stack order, the time axis last
 */
function readPaneColors(classify) {
  const seen = new Map()
  for (const c of document.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect()
    // The price-axis gutter is its own canvas at the same top; the pane's own
    // canvas is the wide one, and two are stacked per pane (grid + series).
    if (r.width < 300) continue
    const key = Math.round(r.top)
    if (seen.has(key)) continue
    const counts = {}
    let painted = 0
    try {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      for (let p = 0; p < d.length; p += 4) {
        if (d[p + 3] < 40) continue
        painted += 1
        const name = classify(d[p], d[p + 1], d[p + 2])
        if (name) counts[name] = (counts[name] || 0) + 1
      }
    } catch { continue }
    seen.set(key, { top: key, height: Math.round(r.height), painted, counts })
  }
  return [...seen.values()].sort((a, b) => a.top - b.top)
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
      <span style={{ minWidth: 118, color: '#8b93a1' }}>{label}</span>
      {children}
    </div>
  )
}

const btn = {
  background: '#1d2027', color: '#dfe3ea', border: '1px solid #333a45',
  borderRadius: 3, padding: '3px 8px', font: 'inherit', cursor: 'pointer',
}

function Harness() {
  const [bars, setBars] = useState(null)
  const [barsErr, setBarsErr] = useState(null)
  const [cs, setCs] = useState(() => mergeChartSettings({}))
  const [log, setLog] = useState([])
  const [probe, setProbe] = useState(null)
  const [saved, setSaved] = useState(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** `null` when closed, otherwise the consumer the sheet is being opened FOR. */
  const [builderFor, setBuilderFor] = useState(null)
  const hostRef = useRef(null)

  const say = useCallback((s) => {
    setLog((l) => [`${new Date().toISOString().slice(11, 23)}  ${s}`, ...l].slice(0, 220))
  }, [])

  // Real bars off the running backend. No auth on /api/bars, and a failure here
  // is reported rather than silently substituted — a harness drawing fixture
  // data while claiming to be live is the failure mode this whole phase is about.
  useEffect(() => {
    let dead = false
    realFetch(`/api/bars/${SYM}?tf=${TF}&bars=400`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { if (!dead) setBars(Array.isArray(j.bars) ? j.bars : []) })
      .catch((e) => { if (!dead) setBarsErr(String(e)) })
    return () => { dead = true }
  }, [])

  // ⭐ LOCK 2. Every settings write StockChart makes lands HERE instead of the
  // global preference. This is also what makes the harness honest: the blob it
  // renders from is the blob the product just produced.
  const onSettingsPersist = useCallback((next) => {
    setCs(next)
    say(`persist intercepted → ${instancesOf(next).length} instances`)
  }, [say])

  const write = useCallback((fn, what) => {
    setCs((prev) => {
      const next = fn(prev)
      if (next === prev) { say(`REFUSED: ${what}`); return prev }
      say(`${what}`)
      return next
    })
  }, [say])

  // ── the scenarios, each driven through the product's own writers ──
  const addRsiOwnPane = useCallback(() => {
    write((c) => {
      const withRsi = addInstance(c, 'rsi', registry)
      const minted = instancesOf(withRsi).at(-1)
      if (!minted) return c
      // RSI already declares `pane`; the add carries the definition's default, so
      // no target write is needed. Give each copy a distinct period so the two
      // lines are visually separable.
      const n = instancesOf(withRsi).filter((i) => i.defId === 'rsi').length
      return setInstanceInput(withRsi, minted.instanceId, 'period', [14, 7, 21, 5][n - 1] ?? 14, registry)
    }, 'add RSI → own pane')
  }, [write])

  const addMa = useCallback((target, source) => {
    write((c) => {
      const withMa = addInstance(c, 'movingAverage', registry)
      // ⛔ SET DIFFERENCE, NOT POSITION. `.at(-1)` was MEASURED WRONG here the
      // moment a direct series was on the chart first: the list did not end with
      // the instance this call minted, so the source and the target landed on
      // SOMEBODY ELSE and the MA silently kept `close`. Exactly the trap
      // `createDirectSeries` documents; the same helper answers it.
      const minted = lastCreatedInstance(c, withMa)
      if (!minted) return c
      let next = withMa
      if (source) next = setInstanceInput(next, minted.instanceId, 'source', source, registry)
      if (target) next = setInstanceDisplayTarget(next, minted.instanceId, target, registry)
      return next
    }, `add MA → ${target || 'default'}${source ? ` (source ${source})` : ''}`)
  }, [write])

  // ─── P2.1 · THE CATALOGUE PATH ────────────────────────────────────────────
  //
  // ⭐⭐ THESE GO THROUGH `createFromResult`, NOT THROUGH A SHORTCUT. The point of
  // the live pass is to prove that a DISCOVERY RESULT — the shape the facade
  // emits from a real `/api/ticker-search` or `/api/breadth-symbols` row —
  // becomes a plotted series. Calling `addInstance` directly here would prove the
  // engine works and say nothing about the phase.
  const addCatalogue = useCallback((res, what) => {
    if (!res) { say(`no result for ${what}`); return }
    if (res.capability === CAPABILITY.UNSUPPORTED) {
      say(`REFUSED (${res.capabilityReason}): ${what}`)
      return
    }
    write((c) => createFromResult(c, res, registry), `catalogue add ${what} (${res.kind})`)
  }, [write, say])

  const addSecurity = useCallback((ticker, name, type) => {
    // The literal row shape `api/routers/ticker_search.py` returns.
    const [res] = securityResults([{ ticker, name, type, exchange: 'X', entity_id: 1 }],
      { tf: TF, bars: 400 })
    addCatalogue(res, ticker)
  }, [addCatalogue])

  const addBreadth = useCallback((symbol, name) => {
    // The literal row shape `/api/breadth-symbols` returns.
    const [res] = breadthResults([{ symbol, name, group: 'ma', group_label: 'Moving averages' }],
      { tf: TF, bars: 400 })
    addCatalogue(res, symbol)
  }, [addCatalogue])

  /**
   * A NAMESPACED Breadth Library row — universe × metric, signed, histogram.
   *
   * ⭐ THE ROW SHAPE `breadth_symbols.py` EMITS FOR THE LIBRARY, verbatim, so the
   * naming and presentation chains are exercised exactly as production would.
   * The local dev backend serves only the legacy UCT symbols, and `US:NETHL` is
   * the one identity that proves BOTH of this pass's rules at once: a universe is
   * not a name, and a signed histogram has two colours.
   *
   * ⚠️ ITS BARS ARE NOT SERVED HERE (the Library artifact is dark), so the series
   * has no line — which is fine and is the point: naming, the editor's capability
   * gate and the micro-rail are all settings-driven and fully observable without
   * one.
   */
  const addLibraryBreadth = useCallback(() => {
    const [res] = breadthResults([{
      universe: 'us', universe_label: 'US', metric: 'net_new_high_low', code: 'NETHL',
      symbol: 'US:NETHL', name: 'Net New 52-Week Highs-Lows', short_name: 'Net H-L',
      group: 'highs_lows', group_label: 'Highs / Lows', unit: 'count',
      domain: 'signed', presentation: 'histogram', legacy: false,
    }], { tf: TF, bars: 400 })
    addCatalogue(res, 'US:NETHL')
  }, [addCatalogue])

  const maFollowing = useCallback((hostId) => {
    // A follower does NOT get an explicit target: reading another instance's
    // output is what makes its home derive to that instance's pane. Writing a
    // target here would be testing the override, not the derivation.
    addMa(null, instanceSource(hostId, 'rsi'))
  }, [addMa])

  // ⛔ PHASE A HAS NO MEMBER-FACING CANDLES, SO THIS IS THE ONLY DOOR. It writes
  // the presentation shape the engine already resolves (`presentation.plots[key]
  // .style`) directly into the page's own blob — no product control, no catalogue
  // row, nothing persisted anywhere a member could reach. It exists so the engine
  // capability can be looked at in a real renderer before the product exposes it.
  const setStyle = useCallback((id, style) => {
    write((c) => ({
      ...c,
      indicatorInstances: (c.indicatorInstances || []).map((i) => (
        i && i.instanceId === id
          ? { ...i, presentation: { ...(i.presentation || {}),
            plots: { ...((i.presentation || {}).plots || {}), value: { style } } } }
          : i
      )),
    }), `${id} → style ${style}`)
  }, [write])

  const setTarget = useCallback((id, t) => {
    write((c) => setInstanceDisplayTarget(c, id, t, registry), `${id} → ${t}`)
  }, [write])

  const setPos = useCallback((id, p) => {
    write((c) => setInstancePanePosition(c, id, p, registry), `${id} → position ${p}`)
  }, [write])

  const drop = useCallback((id) => {
    write((c) => removeInstance(c, id, registry), `delete ${id}`)
  }, [write])

  const reset = useCallback(() => { setCs(mergeChartSettings({})); say('reset to defaults') }, [say])

  // ── TEST 7: reconstruct. Serialise, drop the chart, rebuild from the string.
  const save = useCallback(() => {
    const s = JSON.stringify(cs)
    setSaved(s)
    say(`saved blob (${s.length} bytes)`)
  }, [cs, say])

  const reload = useCallback(() => {
    if (!saved) return
    setCs(null)                                     // unmount the chart entirely
    setTimeout(() => {
      setCs(mergeChartSettings(JSON.parse(saved)))  // …and rebuild through the migrator
      say('reconstructed from the saved blob')
    }, 60)
  }, [saved, say])

  // ⭐ READ-ONLY STATE SEAM FOR THE PROBE. Dev-only page; writes nothing, touches
  // no renderer state. Exists so a measurement can compare CANONICAL intent
  // (`cs.paneSizes`, `cs.paneOrder`) against the PHYSICAL stack in one sample —
  // the comparison every pane defect so far has turned on.
  useEffect(() => {
    window.__pane = {
      cs: () => cs,
      rows: () => [...(hostRef.current?.querySelectorAll('tr') || [])].map((tr) => {
        const b = tr.getBoundingClientRect()
        return { h: Math.round(b.height), top: Math.round(b.top), sep: tr.children.length === 1 }
      }),
    }
  })

  // ── the renderer's own answer, read off the live chart ──
  const readBack = useCallback(() => {
    const el = hostRef.current
    if (!el) return
    const paneEls = [...el.querySelectorAll('td[data-pane-index], .tv-lightweight-charts tr')]
    const canvases = [...el.querySelectorAll('canvas')]
    const legends = [...el.querySelectorAll('[data-pane-legend]')].map((n) => ({
      host: n.dataset.paneLegend, text: (n.textContent || '').trim().slice(0, 60),
    }))
    setProbe({ paneEls: paneEls.length, canvases: canvases.length, legends, at: Date.now() })
    say(`probe: ${legends.length} pane legends [${legends.map((l) => l.host).join(', ')}]`)
  }, [say])

  const live = cs ? instancesOf(cs) : []
  const rsis = live.filter((i) => i.defId === 'rsi')
  const mas = live.filter((i) => i.defId === 'movingAverage')

  // ⭐ IDENTITY-STABLE, because `settingsOverride` is a memo dep on StockChart's
  // side. A fresh object every render would re-merge the blob every paint and
  // make every measurement below a measurement of thrash.
  const override = useMemo(() => cs, [cs])

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 6 }}>
        <b style={{ color: '#7dabf5' }}>P2.0d — pane identity, live</b>
        <span style={{ color: '#8b93a1' }}>
          {SYM} {TF} · {bars ? `${bars.length} real bars` : barsErr ? `BARS FAILED: ${barsErr}` : 'loading bars…'}
        </span>
        <span style={{ color: BLOCKED.length ? '#ef8a86' : '#63c993' }}>
          preference writes refused: {BLOCKED.length}
        </span>
      </div>

      <Row label="scenarios">
        <button style={btn} onClick={addRsiOwnPane}>+ RSI (own pane)</button>
        <button style={btn} onClick={() => addMa('price')}>+ MA → Price</button>
        <button style={btn} onClick={() => addMa('pane')}>+ MA → Own pane</button>
        {/* §24 — the Phase 1 seam, unchanged by pane identity: a SYMBOL source. */}
        <button style={btn} onClick={() => addMa('pane', symbolSource('QQQ', 'close'))}>+ MA(QQQ) → pane</button>
        <button style={btn} onClick={() => addMa('pane', symbolSource('UCTA50', 'close'))}>+ MA(UCTA50) → pane</button>
      </Row>

      <Row label="P2.1 catalogue">
        <button style={btn} onClick={() => addSecurity('QQQ', 'Invesco QQQ Trust', 'etf')}>QQQ</button>
        <button style={btn} onClick={() => addSecurity('SPY', 'SPDR S&P 500 ETF Trust', 'etf')}>SPY</button>
        <button style={btn} onClick={() => addBreadth('UCTA50', '% of Stocks Above 50-Day MA')}>UCTA50</button>
        <button style={btn} onClick={() => addSecurity('NVDA', 'NVIDIA Corp', 'stock')}>NVDA</button>
        <button style={btn} onClick={addLibraryBreadth}>US:NETHL (signed)</button>
        {rsis.map((r) => (
          <button key={r.instanceId} style={btn} onClick={() => maFollowing(r.instanceId)}>
            + MA following {r.instanceId}
          </button>
        ))}
      </Row>

      <Row label="Add to Chart">
        <button style={{ ...btn, background: '#1d5fbf', borderColor: '#1d5fbf', color: '#fff' }}
          onClick={() => setLibraryOpen(true)}>＋ Add to Chart…</button>
        <button style={btn} onClick={() => setSettingsOpen(true)}>⚙ Chart Settings…</button>
        {['indicator', 'condition', 'infoValue'].map((k) => (
          <button key={k} style={btn} onClick={() => setBuilderFor(k)}>ƒ {k}</button>
        ))}
        <span style={{ color: '#8b93a1' }}>the real dialogs</span>
      </Row>

      <Row label="state">
        <button style={btn} onClick={readBack}>probe renderer</button>
        <button style={btn} onClick={save}>save blob</button>
        <button style={btn} onClick={reload} disabled={!saved}>reconstruct</button>
        <button style={btn} onClick={reset}>reset</button>
      </Row>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 340, maxWidth: 380 }}>
          <div style={{ color: '#8b93a1', margin: '6px 0 3px' }}>instances</div>
          {live.map((i) => (
            <div key={i.instanceId} style={{ marginBottom: 3, paddingBottom: 3, borderBottom: '1px solid #23272e' }}>
              <div>
                <b>{i.instanceId}</b>
                <span style={{ color: '#8b93a1' }}> {i.defId}</span>
                {i.inputs && i.inputs.period != null ? <span style={{ color: '#e0a94f' }}> p{i.inputs.period}</span> : null}
              </div>
              <div style={{ color: '#8b93a1', fontSize: 11.5 }}>
                target={String((i.placement && i.placement.target) ?? '—')} pos={String((i.placement && i.placement.position) ?? '—')}
                {i.inputs && typeof i.inputs.source === 'string' ? ` src=${i.inputs.source}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                {/* ⭐ P2.3 — THE MEMBER'S DESTINATION MENU, same generator, same
                    writer. An empty list means the definition has nowhere else to
                    go (a plain price overlay), and renders nothing — exactly as
                    the settings tab does. */}
                <select
                  style={{ ...btn, minWidth: 130 }}
                  aria-label={`${i.instanceId} display in`}
                  value={displayTargetOptions(i, cs, registry.getDefinition)
                    .some((o) => o.value === (i.placement?.target ?? ''))
                    ? i.placement.target : ''}
                  onChange={(e) => e.target.value && setTarget(i.instanceId, e.target.value)}
                >
                  <option value="">display in…</option>
                  {displayTargetOptions(i, cs, registry.getDefinition)
                    .map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {i.defId === 'dataSeries' ? (
                  <button style={btn} onClick={() => setStyle(i.instanceId,
                    (i.presentation?.plots?.value?.style === 'candles') ? 'line' : 'candles')}>
                    {i.presentation?.plots?.value?.style === 'candles' ? 'line' : 'candles'}
                  </button>
                ) : null}
                <button style={btn} onClick={() => setPos(i.instanceId, 'above')}>above</button>
                <button style={btn} onClick={() => setPos(i.instanceId, 'below')}>below</button>
                <button style={btn} onClick={() => drop(i.instanceId)}>delete</button>
              </div>
            </div>
          ))}
          {probe ? (
            <div style={{ marginTop: 6, color: '#63c993' }}>
              <div>canvases {probe.canvases} · pane legends {probe.legends.length}</div>
              {probe.legends.map((l, n) => (
                <div key={n} style={{ color: '#dfe3ea' }}>· <b>{l.host}</b> — {l.text}</div>
              ))}
            </div>
          ) : null}
          <div style={{ marginTop: 6, color: '#8b93a1', maxHeight: 220, overflow: 'auto' }}>
            {log.map((l, n) => <div key={n}>{l}</div>)}
          </div>
        </div>

        <div
          ref={hostRef}
          id="chart-host"
          style={{ flex: 1, height: 720, minWidth: 520, border: '1px solid #2a2f38', position: 'relative' }}
        >
          {cs && bars ? (
            <StockChart
              sym={SYM}
              tf={TF}
              /* ⚰️⚰️ MIRRORS PRODUCTION, AND ITS ABSENCE HID A WHOLE REGIME.
                 `ChartPane` and `GridChartCell` both pass this unconditionally, so
                 every production chart has a SEPARATE volume pane. Without it this
                 page ran a 2-pane BANDED-volume chart — so every pane-ordering and
                 pane-sizing pass proved here was proving the wrong topology, and
                 the 3-pane regime the live 2026-09-15 failures live in was
                 unreachable from the harness at all. */
              volumeSeparatePane
              blankVolume={false}
              /* ⭐ DRAWINGS, SO PANE ORDERING CAN BE PROVED AGAINST THEM. Price
                 drawings resolve their pane from the CANDLE SERIES, so the
                 question a reordered chart asks is whether they follow Price or
                 stay at the top of the canvas. Fixed fixtures at known prices:
                 anything that moves when a pane moves is a defect. Dev-only —
                 `vite build` takes `index.html` alone, so this ships nowhere. */
              annotations={DRAWING_FIXTURES}
              annotationsVisible
              barsOverride={bars}
              settingsOverride={override}
              onSettingsPersist={onSettingsPersist}
              onWatermarkCommit={() => {}}
              lockWatermark
              alwaysShowLegend
              /* ⭐ `?legend=vertical` / `?legend=horizontal` PUTS THE WORKSPACE
                 LEGEND ON THIS PAGE. Without it `verticalLegend` is false and
                 the chart renders its inline OHLC row, so the stacked table and
                 the flat strip — two of the three legend layouts a member can
                 actually choose — were unreachable here and could only be
                 verified on a real workspace. Chart Settings → Header picks
                 BETWEEN the two once this is on. */
              verticalLegend={LEGEND_PARAM !== null}
              /* ⚰️ THE LOOKBACK BAR, BECAUSE IT WAS THE SECOND REGRESSION AND
                 THIS PAGE COULD NOT SHOW IT. `showRangeSelector` defaults to
                 false, so the 3M/6M/YTD/1Y/5Y/Origin strip never rendered here
                 and the one surface that must NOT move when panes are reordered
                 was the one surface the harness could not prove. It is
                 WORKSPACE-owned: bottom-left of the whole stack, directly above
                 the date scale, at every pane order. */
              showRangeSelector
            />
          ) : (
            <div style={{ padding: 12, color: '#8b93a1' }}>
              {barsErr ? `bars failed: ${barsErr}` : 'waiting…'}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 8, color: '#8b93a1' }}>
        instances: {live.length} · RSI {rsis.length} · MA {mas.length}
      </div>

      {/* ⭐ THE MEMBER'S OWN SURFACE, ON THE ISOLATED BLOB. `onChange` is the same
          writer the chart's own host uses; it lands in page state, so the dialog
          cannot reach a preference any more than the rest of this page can. */}
      <IndicatorLibraryDialog
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        settings={cs || mergeChartSettings({})}
        onChange={(next) => { setCs(next); say(`library add → ${instancesOf(next).length} instances`) }}
        registry={engineRegistry}
      />

      {/* ⛔ THE SAME `onChange` THE LIBRARY USES — page state, never a preference.
          Lock 3 severs `/api/auth/preferences` in both directions, so this modal
          cannot reach Main Trading any more than the rest of the page can. */}
      <ChartSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        /* ⚠️ MIRRORS `pane/ChartPane.jsx:960`, WHICH IS THE ONLY OTHER MOUNT.
           Without it `paneMap` and `movePane` ask the SETTINGS-ONLY volume
           predicate, decide the separate volume pane is a band, and this page
           reproduces a defect production does not have. */
        volumeOpts={{ volumeSeparatePane: true, blankVolume: false }}
        settings={cs || mergeChartSettings({})}
        onChange={(next) => { setCs(next); say('settings write') }}
        onCreateFormula={() => { setSettingsOpen(false); setBuilderFor('indicator') }}
      />

      {builderFor ? (
        <BuilderSheet
          open
          consumerKind={builderFor}
          onClose={() => setBuilderFor(null)}
          settings={cs || mergeChartSettings({})}
          onChange={(next) => { setCs(next); say('builder write') }}
          onAuthored={(r) => { say(`authored ${builderFor}: ${JSON.stringify(r).slice(0, 80)}`); setBuilderFor(null) }}
          onSaved={() => { say('builder saved'); setBuilderFor(null) }}
          bars={bars}
          sym={SYM}
          tf={TF}
        />
      ) : null}
    </div>
  )
}

// ⭐ THE APP'S OWN PROVIDER STACK, NOT A SET OF DOUBLES. StockChart reaches
// `useAuth` through `PatternSidePanel` and SWR through `usePreferences`; standing
// in fakes for either would make this page a test of the fakes. Router, SWR,
// Auth and Voice are exactly what `App.jsx` wraps the chart in — and the member's
// real session is allowed to load, because reading preferences is safe and
// `settingsOverride` replaces the blob wholesale before anything renders.
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

// Kept out of the component so an accidental edit cannot make it a render-time
// read; exported for a console poke during a session.
window.__paneHarness = { readPanes, readPaneColors, BLOCKED, DRAWING_FIXTURES }
