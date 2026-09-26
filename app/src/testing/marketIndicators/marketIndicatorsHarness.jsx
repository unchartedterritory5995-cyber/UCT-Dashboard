// app/src/testing/marketIndicators/marketIndicatorsHarness.jsx
//
// ─── THE MARKET INDICATORS LIBRARY, IN A REAL BROWSER ───────────────────────
//
// ⭐⭐ WHY THIS EXISTS. The suites assert the registry, the naming rules, the
// derivation and the bar shape. None of them can show that a member typing
// `McClellan` SEES the oscillator and the summation, clicks one, and gets a chart.
// This page mounts the REAL `/api/market-indicators` catalogue, the REAL server-side
// search and the REAL `/api/bars` route — no fixtures on the paths under test.
//
// ⛔ AND IT CANNOT WRITE A PREFERENCE. `window.fetch` refuses any non-GET to
// `/api/auth/preferences` outright — the same lock `paneHarness.jsx` and
// `breadthLibraryHarness.jsx` carry, for the same reason: this runs on the machine
// holding the frozen Main Trading row, and a harness that can touch it is a harness
// that will eventually touch it.
//
// ⛔ IT ALSO NEVER OPENS `/charts`. That surface writes the global `chart_settings`
// blob; this page renders a chart canvas directly and owns no stored state at all.
//
// Dev-server only: `vite build` takes `index.html` as its single input, so this entry
// never ships.
//
// Run:  npx vite            (from app/, with a backend on :8000)
// Then: http://localhost:5173/market-indicators-harness.html

import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createChart, LineSeries } from 'lightweight-charts'
// ⛔ ONE fetcher for every JSON read here. `utils/jsonFetcher.test.js` sweeps
// app/src for a `fetch(...).then(r => r.json())` that never checked `ok`, and this
// file was the one NEW offender: a 402 answers JSON, its {detail} body is truthy,
// so every `!data` guard downstream is skipped and an error renders as data.
// jsonFetcher throws on non-OK, which routes such a response into the `.catch`
// each site already carries -- a state this harness actually shows.
import jsonFetcher from '../../utils/jsonFetcher'

// ─── lock: no preference write can leave this page ──────────────────────────
const _fetch = window.fetch.bind(window)
const BLOCKED = []
window.__miHarnessBlocked = BLOCKED            // readable from the console, for proof
window.fetch = (url, opts = {}) => {
  const u = String(url || '')
  const method = String(opts.method || 'GET').toUpperCase()
  if (u.includes('/api/auth/preferences') && method !== 'GET') {
    BLOCKED.push({ url: u, method })
    return Promise.resolve(new Response('{"blocked":true}', { status: 403 }))
  }
  return _fetch(url, opts)
}

const FAMILY_ORDER = ['mcclellan', 'breadth', 'sentiment', 'volatility']

function useCatalogue() {
  const [state, setState] = useState({ loading: true, rows: [], dormant: [], error: null })
  useEffect(() => {
    jsonFetcher('/api/market-indicators')
      .then(d => setState({ loading: false, rows: d.rows || [], dormant: d.dormant || [], error: null }))
      .catch(e => setState({ loading: false, rows: [], dormant: [], error: String(e) }))
  }, [])
  return state
}

/** A real chart of one canonical series, straight off `/api/bars`. */
function SeriesChart({ row }) {
  const ref = React.useRef(null)
  const [meta, setMeta] = useState(null)
  useEffect(() => {
    if (!ref.current || !row) return undefined
    const el = ref.current
    el.innerHTML = ''
    const chart = createChart(el, {
      width: el.clientWidth, height: 340,
      layout: { background: { color: '#0e1014' }, textColor: '#9aa4b2' },
      grid: { vertLines: { color: '#191d24' }, horzLines: { color: '#191d24' } },
      rightPriceScale: { borderColor: '#242a33' },
      timeScale: { borderColor: '#242a33' },
    })
    // ⚠️ A LINE, NOT CANDLES — and not as a style choice. `ohlc_capable` is false for
    // everything but a real-OHLC Cboe index, because a derived indicator and a weekly
    // survey have one value per period and a candle over a synthesised o=h=l=c would
    // be a shape nobody measured.
    const s = chart.addSeries(LineSeries, {
      color: row.family === 'volatility' ? '#4fb3c4' : '#d9a43c',
      lineWidth: 2, priceLineVisible: false,
    })
    let dead = false
    jsonFetcher(`/api/bars/${encodeURIComponent(row.symbol)}?tf=D&bars=5000`)
      .then(d => {
        if (dead) return
        const bars = (d.bars || []).map(b => ({ time: b.t, value: b.c }))
        s.setData(bars)
        chart.timeScale().fitContent()
        setMeta({
          points: bars.length,
          first: bars[0]?.time, last: bars[bars.length - 1]?.time,
          lastValue: bars[bars.length - 1]?.value,
          tKind: typeof (d.bars || [])[0]?.t,
        })
      })
      .catch(() => { if (!dead) setMeta({ points: 0 }) })
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }))
    ro.observe(el)
    return () => { dead = true; ro.disconnect(); chart.remove() }
  }, [row && row.id])

  if (!row) return <div style={{ padding: 24, color: '#6b7684' }}>Pick a series.</div>
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 17, fontWeight: 600 }}>{row.display}</div>
        <code style={{ color: '#4fb3c4' }}>{row.symbol}</code>
        <span style={{ color: '#6b7684', fontSize: 12 }}>
          id {row.id} · {row.family_label} · {row.frequency} · {row.presentation}
          {row.ohlc_capable ? ' · OHLC' : ' · no real OHLC → line only'}
        </span>
      </div>
      <div ref={ref} style={{ width: '100%', height: 340 }} />
      {meta && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#9aa4b2', fontFamily: 'ui-monospace' }}>
          {meta.points} bars · {meta.first} .. {meta.last} · last {meta.lastValue}
          {' · '}t is a <b style={{ color: meta.tKind === 'string' ? '#5fc08c' : '#e27676' }}>
            {meta.tKind === 'string' ? 'ISO day string' : String(meta.tKind)}
          </b>
        </div>
      )}
      <details style={{ marginTop: 10, fontSize: 12, color: '#9aa4b2' }}>
        <summary style={{ cursor: 'pointer' }}>methodology · provenance · licensing</summary>
        <p><b>Methodology</b> — {row.methodology}</p>
        <p><b>Observation</b> — {row.observation_semantics}</p>
        <p><b>Knowledge</b> — {row.knowledge_semantics}</p>
        <p><b>Provenance</b> — {row.provenance}</p>
        <p><b>Source / licensing</b> — {row.source_owner}. {row.licensing}</p>
      </details>
    </div>
  )
}

function App() {
  const cat = useCatalogue()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState(null)
  const [picked, setPicked] = useState(null)

  useEffect(() => {
    if (!q.trim()) { setHits(null); return undefined }
    let dead = false
    const id = setTimeout(() => {
      jsonFetcher(`/api/market-indicators/search?q=${encodeURIComponent(q)}&limit=40`)
        .then(d => { if (!dead) setHits(d.results || []) })
        .catch(() => { if (!dead) setHits([]) })
    }, 150)
    return () => { dead = true; clearTimeout(id) }
  }, [q])

  const grouped = useMemo(() => {
    const rows = hits || cat.rows
    const by = new Map()
    for (const r of rows) {
      if (!by.has(r.family)) by.set(r.family, [])
      by.get(r.family).push(r)
    }
    return FAMILY_ORDER.filter(f => by.has(f)).map(f => [f, by.get(f)])
      .concat([...by.keys()].filter(f => !FAMILY_ORDER.includes(f)).map(f => [f, by.get(f)]))
  }, [hits, cat.rows])

  useEffect(() => {
    if (!picked && cat.rows.length) setPicked(cat.rows.find(r => r.id === 'US:MCO') || cat.rows[0])
  }, [cat.rows, picked])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px minmax(0,1fr)', gap: 24, padding: 20 }}>
      <div>
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search — try: McClellan · 50 day · NAAIM · VIX · NASI · UCTA50"
          style={{
            width: '100%', padding: '9px 11px', background: '#151a20', color: '#e6e8ec',
            border: '1px solid #242a33', borderRadius: 4, fontSize: 13, marginBottom: 12,
          }} />
        {cat.error && <div style={{ color: '#e27676' }}>catalogue error: {cat.error}</div>}
        {cat.loading && <div style={{ color: '#6b7684' }}>loading…</div>}
        {grouped.map(([fam, rows]) => (
          <div key={fam} style={{ marginBottom: 14 }}>
            <div style={{
              fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase',
              color: '#6b7684', marginBottom: 5,
            }}>{rows[0].family_label} · {rows.length}</div>
            {rows.map(r => (
              <button key={r.id} onClick={() => setPicked(r)} style={{
                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                padding: '6px 8px', marginBottom: 2, borderRadius: 3, fontSize: 12.5,
                background: picked && picked.id === r.id ? '#1b2a30' : 'transparent',
                color: '#cfd6de', border: '1px solid transparent',
              }}>
                <div>{r.display}</div>
                <code style={{ color: '#6b7684', fontSize: 11 }}>{r.symbol}</code>
              </button>
            ))}
          </div>
        ))}
        {hits && hits.length === 0 && <div style={{ color: '#6b7684' }}>no matches</div>}

        <div style={{ marginTop: 18, borderTop: '1px solid #242a33', paddingTop: 10 }}>
          <div style={{
            fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8a6a2a',
          }}>Dormant · {cat.dormant.length} · not servable, not discoverable</div>
          {cat.dormant.map(d => (
            <div key={d.id} style={{ fontSize: 11.5, color: '#6b7684', marginTop: 6 }}>
              <code style={{ color: '#8a6a2a' }}>{d.symbol}</code> {d.display}
              <div style={{ fontSize: 10.5, opacity: 0.8 }}>{d.blocked_on}</div>
            </div>
          ))}
        </div>
      </div>
      <SeriesChart row={picked} />
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
