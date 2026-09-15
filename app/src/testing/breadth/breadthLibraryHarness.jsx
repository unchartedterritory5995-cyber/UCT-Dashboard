// app/src/testing/breadth/breadthLibraryHarness.jsx
//
// ─── THE BREADTH LIBRARY, IN A REAL BROWSER ─────────────────────────────────
//
// ⭐⭐ WHY THIS EXISTS. The unit suites assert the ranking and the row shape; they
// cannot show that a member typing "50 day" SEES the A50 family, metric first, with
// the universe as a quiet qualifier. This page mounts the REAL `useSymbolDiscovery`
// against the REAL `searchLibrary` and renders the REAL `DiscoveryResult`s.
//
// ⛔ FIXTURE-BACKED, AND IT SAYS SO ON SCREEN. The dev vite proxy points `/api` at
// `localhost:8000`, which is the MAIN CHECKOUT's backend — it predates the `library`
// block and cannot serve it, and restarting it is not this session's to do. So the
// breadth payload is served from the generated fixture and the banner states that,
// rather than letting a reader believe these rows came off a live backend.
//
// ⛔ AND IT CANNOT WRITE A PREFERENCE. `window.fetch` is wrapped to refuse any
// non-GET to `/api/auth/preferences` outright — the same lock `paneHarness.jsx`
// carries, for the same reason: this runs on the machine holding the frozen Main
// Trading row.
//
// Dev-server only: `vite build` takes `index.html` as its single input, so this
// entry never ships.
//
// Run:  npx vite      (from app/)
// Then: http://localhost:5173/breadth-harness.html

import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import CATALOG from '../../components/chart/__fixtures__/breadthLibraryRows.json'
import { searchLibrary, browseFamilies, availabilityOf } from '../../components/chart/breadthLibrary'
import { breadthResults, createFromResult, lastCreatedInstance } from '../../components/chart/discoveryCatalog'
import * as registry from '../../components/chart/engine/nativeRegistry'
import SourceField from '../../components/chart/SourceField'
import { presentedPlot } from '../../components/chart/engine/presentation'
import { OHLC_FAMILY, OHLC_REFUSAL, ohlcCapabilityOf }
  from '../../components/chart/engine/ohlcCapability'
import { parseSource, symbolSource } from '../../components/chart/engine/sourceRef'
import { signColorsForPlot } from '../../components/chart/engine/pool'

// ─── lock 1: no preference write can leave this page ────────────────────────
const _fetch = window.fetch.bind(window)
const BLOCKED = []
window.__breadthHarnessBlocked = BLOCKED   // readable from the console, for proof
window.fetch = (url, opts = {}) => {
  const u = String(url || '')
  const method = String(opts.method || 'GET').toUpperCase()
  if (u.includes('/api/auth/preferences') && method !== 'GET') {
    BLOCKED.push(`${method} ${u}`)
    console.error('%cREFUSED preference write from the harness: ' + method + ' ' + u,
                  'color:#ff6b6b;font-weight:bold')
    // ⛔ 200 WITH AN EMPTY OBJECT, NOT 204. `new Response('{}', {status: 204})`
    // THROWS — 204 is a null-body status — so the lock refused the write and then
    // blew up in the caller's face instead of answering it. Browser proof caught
    // this; `paneHarness.jsx` already had it right, and this now matches.
    return Promise.resolve(new Response('{}', {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
  }
  // ⭐ THE ONE ROUTE THE REAL CONTROL FETCHES, ANSWERED FROM THE FIXTURE. Mounting
  // `SourceField` for real means `useBreadthSymbols` makes its once-per-session call;
  // the dev proxy would send it to the main checkout's `:8000`, which predates the
  // `library` block. Serving the generated catalogue here is what lets the PRODUCT
  // control — not a copy of it — be the thing on screen.
  if (u.includes('/api/breadth-symbols')) {
    return Promise.resolve(new Response(JSON.stringify(FIXTURE_PAYLOAD), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
  }
  return _fetch(url, opts)
}

// ⭐⭐ THE PUBLICATION FLIP, AS A URL PARAM. `?publish=us` is this page's stand-in
// for `BREADTH_LIBRARY_UNIVERSES=us`, and it is a RELOAD rather than a React toggle on
// purpose: `useBreadthSymbols` caches its payload module-wide for the session, which is
// exactly how a real deploy-time flag behaves — existing clients keep the old answer
// until they reload. A live toggle would prove something the product does not do.
//
// ⛔ THE FIXTURE IS FILTERED THE WAY THE SERVER FILTERS. `published_symbol_rows()`
// emits the 44 legacy UCT rows first and unconditionally, then each published PIT
// universe's V1 rows. Nothing here invents a row the server would not send.
const PUBLISHED = (() => {
  const raw = new URLSearchParams(location.search).get('publish') || ''
  const want = new Set(raw.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))
  return want
})()

const legacyRows = CATALOG.rows.filter((r) => r.legacy)
const publishedRows = [
  ...legacyRows,
  ...CATALOG.rows.filter((r) => !r.legacy && PUBLISHED.has(r.universe)),
]

/** The shape `/api/breadth-symbols` answers with, at THIS publication setting. */
const FIXTURE_PAYLOAD = {
  symbols: publishedRows.map((r) => ({
    symbol: r.symbol, metric: r.metric, name: r.name,
    group: r.group, group_label: r.group_label,
    ...(r.legacy ? {} : { universe: r.universe, universe_label: r.universe_label }),
  })),
  groups: CATALOG.families || [],
  library: {
    rows: publishedRows, families: CATALOG.families,
    universes: (CATALOG.universes || []).filter(
      (u) => u.id === 'uct' || PUBLISHED.has(u.id)),
    metric_order: CATALOG.metric_order,
  },
}

const LIB = {
  rows: publishedRows,
  families: CATALOG.families,
  universes: CATALOG.universes,
  metricOrder: new Map(CATALOG.metric_order.map((m, i) => [m, i])),
}

const QUERIES = ['50 day', 'above 50', 'A50', 'new lows', 'high low',
                 'NASDAQ breadth', '200 day', 'NASDAQ:A50', 'US:NETHL',
                 'NASDAQ:AAPL', 'FOO:BAR']

const S = {
  page: { padding: '14px 16px', maxWidth: 1180, margin: '0 auto' },
  h: { font: '600 13px/1.3 ui-sans-serif,system-ui', letterSpacing: '.02em',
       color: '#c8cbd2', margin: '18px 0 8px', textTransform: 'uppercase' },
  banner: { background: '#1a1410', border: '1px solid #4a3a1e', color: '#d9b877',
            padding: '8px 10px', borderRadius: 6, marginBottom: 14, fontSize: 12 },
  input: { width: 320, padding: '7px 10px', background: '#15181d',
           border: '1px solid #2a2f37', color: '#e6e8ec', borderRadius: 6,
           font: '13px ui-sans-serif,system-ui', outline: 'none' },
  chipRow: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 14px' },
  chip: { padding: '3px 9px', background: '#191d23', border: '1px solid #2a2f37',
          borderRadius: 999, cursor: 'pointer', fontSize: 12, color: '#aeb4bf' },
  chipOn: { background: '#2a2413', borderColor: '#6b5a22', color: '#e8cf87' },
  row: { display: 'grid', gridTemplateColumns: '1fr 74px 120px 78px',
         gap: 10, alignItems: 'center', padding: '7px 10px',
         borderBottom: '1px solid #1c2027' },
  name: { color: '#e6e8ec', fontSize: 13 },
  uni: { color: '#e8cf87', fontSize: 11, fontWeight: 600, letterSpacing: '.04em' },
  sym: { color: '#6e7684', fontSize: 11, fontFamily: 'ui-monospace,Menlo,monospace' },
  fam: { color: '#6e7684', fontSize: 11 },
  empty: { color: '#6e7684', fontSize: 12, padding: '10px 0' },
}

function Results({ q }) {
  const rows = useMemo(
    () => breadthResults(searchLibrary(LIB.rows, q, { limit: 24, metricOrder: LIB.metricOrder })),
    [q],
  )
  if (!q) return <div style={S.empty}>type a query…</div>
  if (!rows.length) {
    return <div style={S.empty} data-testid="empty">
      no Breadth Library match for “{q}” — a colon does not make something breadth
    </div>
  }
  return (
    <div data-testid="results">
      {rows.map((r) => (
        <div key={r.key} style={S.row} data-testid="result">
          {/* ⭐ `lead` / `sub`, NOT a layout this page chose for itself. The whole
              point of the proof is that the PRODUCT's fields read metric-first; a
              harness that rendered `r.name` because it knows breadth is breadth
              would prove only that this file can be written correctly. */}
          <div style={S.name} data-testid="lead">{r.lead}</div>
          <div style={S.uni} data-testid="sub">{r.sub}</div>
          {/* SYMBOL is available, secondary. */}
          <div style={S.sym}>{r.id}</div>
          <div style={S.fam}>{r.category}</div>
        </div>
      ))}
    </div>
  )
}

function Browse() {
  const fams = useMemo(() => browseFamilies(LIB.rows), [])
  return (
    <div data-testid="browse">
      {fams.map((f) => (
        <div key={f.id} style={{ marginBottom: 12 }}>
          <div style={{ ...S.h, margin: '10px 0 4px' }}>{f.label}</div>
          {f.metrics.slice(0, 4).map((m) => (
            <div key={m.metric} style={S.row}>
              <div style={S.name}>{m.name}</div>
              <div style={S.uni}>
                {m.universes.map((u) => u.label).join(' · ')}
              </div>
              <div style={S.sym}>{m.presentation}/{m.domain}</div>
              <div style={S.fam}>{m.unit}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** The same metric across four universes, added through the canonical path. */
function ComparePane() {
  const built = useMemo(() => {
    const rows = LIB.rows.filter((r) => r.metric === 'pct_above_50sma')
    let cs = { indicatorInstances: [] }
    const out = []
    for (const row of rows) {
      const [res] = breadthResults([row])
      const before = cs
      cs = createFromResult(cs, res, registry)
      const inst = lastCreatedInstance(before, cs)
      out.push({ label: inst?.display?.name || res.shortName,
                 source: inst?.inputs?.source, name: res.name })
    }
    return out
  }, [])
  if (!built.length) {
    return <div style={S.empty} data-testid="compare-unavailable">
      nothing published for this metric at this setting
    </div>
  }
  return (
    <div data-testid="compare">
      <div style={{ ...S.name, marginBottom: 6 }}>{built[0]?.name}</div>
      {built.map((b) => (
        <div key={b.source} style={S.row}>
          <div style={S.uni}>{b.label}</div>
          <div style={S.sym} data-testid="cmp-source">{b.source}</div>
          <div />
          <div />
        </div>
      ))}
    </div>
  )
}

/** NETHL's presentation, resolved through the real chain, with no ticker branch. */
function Nethl() {
  const info = useMemo(() => {
    const row = LIB.rows.find((r) => r.metric === 'net_new_high_low')
    // ⛔ ABSENT AT THE DEFAULT SETTING IS THE CORRECT PRODUCT STATE, not a crash.
    // UCT never published a Net New High-Low symbol, so with UCT alone published
    // there is no NETHL identity to draw. Rendering "not published" is the honest
    // answer; picking another universe's row would be the fabrication this whole
    // project exists to refuse.
    if (!row) return null
    const [res] = breadthResults([row])
    const cs = createFromResult({ indicatorInstances: [] }, res, registry)
    const inst = lastCreatedInstance({ indicatorInstances: [] }, cs)
    const plot = presentedPlot({ key: 'value', style: 'line', color: '#4f9cf9' }, inst)
    return { res, inst, plot, sign: signColorsForPlot(plot) }
  }, [])
  const vals = [500, 164, 13, 0, -7, -99, -663]
  const max = 663
  if (!info) {
    return <div style={S.empty} data-testid="nethl-unavailable">
      Net New High-Low is not published at this setting — UCT has no NETHL symbol,
      and no other universe is enabled. Nothing is substituted.
    </div>
  }
  return (
    <div data-testid="nethl">
      <div style={S.row}>
        <div style={S.name}>{info.res.name}</div>
        <div style={S.uni}>{info.res.shortName}</div>
        <div style={S.sym}>{info.res.id}</div>
        <div style={S.fam}>{info.plot.style} · {info.plot.colorMode}</div>
      </div>
      {/* A zero baseline that MEANS something: bars grow up and down from it. */}
      <div style={{ display: 'flex', alignItems: 'center', height: 120,
                    marginTop: 12, gap: 14, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 60,
                      borderTop: '1px dashed #3a4049' }} />
        {vals.map((v) => (
          <div key={v} style={{ width: 46, textAlign: 'center', position: 'relative',
                                height: 120 }}>
            <div
              data-testid="bar"
              data-value={v}
              style={{
                position: 'absolute', left: 12, width: 22,
                top: v >= 0 ? 60 - (Math.abs(v) / max) * 55 : 60,
                height: Math.max(1, (Math.abs(v) / max) * 55),
                background: v >= 0 ? info.sign.up : info.sign.down,
              }}
            />
            <div style={{ position: 'absolute', top: 124, left: 0, right: 0,
                          fontSize: 10, color: '#6e7684' }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * ⭐⭐ THE PRODUCT CONTROL, MOUNTED — not a re-implementation of it.
 *
 * Everything above renders the library through the real ranking but through THIS
 * page's markup. This section mounts `SourceField`, the control an instance's
 * `source` input is actually edited with, so what is on screen is the reading order
 * a member gets. It is also the surface that was WRONG until the browser proof:
 * it leads with the result's strong half, and for breadth that used to be the
 * universe badge — `NASDAQ · % of Stocks Above 50-Day MA`, the address in bold.
 */
function RealPicker() {
  const [value, setValue] = useState('close')
  const settings = { indicatorInstances: [] }
  const row = { instanceId: 'inst:dataSeries:1', label: 'Data Series' }
  const field = { label: 'Source' }
  // ⛔ The SECURITY half answers empty: this page proves the breadth lane, and a
  // live ticker search would make the result depend on a backend that is not the
  // subject. Breadth is served from the fixture above.
  const fetcher = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) })
  return (
    <div data-testid="real-picker">
      <div style={{ ...S.sym, marginBottom: 8 }}>stored value: {value}</div>
      <SourceField
        row={row}
        field={field}
        value={value}
        settings={settings}
        registry={registry}
        fetcher={fetcher}
        onPick={setValue}
      />
    </div>
  )
}

/** The publication switch, and what it changes. */
function PublicationBar() {
  const opts = [
    ['', 'DEFAULT — UCT only'],
    ['us', 'TEST: US enabled'],
    ['us,nasdaq,nyse', 'TEST: all three'],
  ]
  const cur = new URLSearchParams(location.search).get('publish') || ''
  return (
    <div style={{ ...S.chipRow, margin: '0 0 14px' }} data-testid="pubbar">
      {opts.map(([v, label]) => (
        <a key={v} href={`?publish=${v}`}
           data-testid={`pub-${v || 'none'}`}
           style={{ ...S.chip, ...(v === cur ? S.chipOn : null), textDecoration: 'none' }}>
          {label}
        </a>
      ))}
      <span style={{ ...S.sym, alignSelf: 'center', marginLeft: 8 }}>
        published: {publishedRows.length} identities
        {' · '}universes: {['uct', ...PUBLISHED].join(', ')}
      </span>
    </div>
  )
}

/**
 * ⭐⭐ FAMILY AND CANDLE CAPABILITY, decided by the PAYLOAD rather than by a branch.
 *
 * This is the BL-013 consequence made visible: the family map is built from the
 * `symbols` array exactly as `useBreadthSymbols` builds it, and `ohlcCapabilityOf` is
 * handed that map. A published breadth identity must read BREADTH and must be REFUSED
 * candles — for what it MEANS, not for a missing field, because the bars below carry
 * a complete o/h/l/c and would render a tidy, misleading candlestick.
 */
function FamilyPane() {
  const rows = useMemo(() => {
    const map = new Map(FIXTURE_PAYLOAD.symbols.map(
      (r) => [String(r.symbol).toUpperCase(), r]))
    const familyOf = (sym) => (map.has(String(sym || '').toUpperCase())
      ? OHLC_FAMILY.BREADTH : OHLC_FAMILY.SECURITY)
    const def = registry.getDefinition('dataSeries')
    // The shape the server really builds: o = yesterday's value, wick from the pair.
    const bars = { bars: [{ t: '2015-03-10', o: 47.2, h: 47.9, l: 47.2, c: 47.9, v: 0 },
                          { t: '2015-03-11', o: 47.9, h: 47.9, l: 46.1, c: 46.1, v: 0 }] }
    return ['UCTA50', 'US:A50', 'US:NETHL', 'NASDAQ:A50', 'AAPL', 'NASDAQ:AAPL']
      .map((sym) => {
        const parsed = parseSource(symbolSource(sym, 'close'))
        const cap = ohlcCapabilityOf(def, parsed, bars, familyOf)
        return { sym, family: familyOf(sym), ok: cap.ok, reason: cap.reason }
      })
  }, [])
  return (
    <div data-testid="family">
      {rows.map((r) => (
        <div key={r.sym} style={S.row} data-testid="family-row" data-sym={r.sym}>
          <div style={S.name}>{r.sym}</div>
          <div style={{ ...S.uni, color: r.family === 'breadth' ? '#e8cf87' : '#6e7684' }}
               data-testid="family-val">{r.family}</div>
          <div style={{ ...S.sym, color: r.ok ? '#df4646' : '#2faf68' }}
               data-testid="candles">{r.ok ? 'CANDLES OK' : 'candles refused'}</div>
          <div style={S.fam}>{r.reason || ''}</div>
        </div>
      ))}
    </div>
  )
}

function Harness() {
  const [q, setQ] = useState('50 day')
  const uct = availabilityOf(LIB.universes, 'uct')
  const us = availabilityOf(LIB.universes, 'us')
  return (
    <div style={S.page}>
      <div style={{ ...S.banner, color: '#d9b877' }}>
        FIXTURE-BACKED DEV HARNESS. Rows come from
        <code> __fixtures__/breadthLibraryRows.json</code> (generated from
        <code> breadth_symbols.library_catalog</code> with every universe published),
        NOT from a live backend — the dev proxy points at the main checkout's
        <code> :8000</code>, which predates the <code>library</code> payload.
        Preference writes are refused by this page.
        <div style={{ marginTop: 4, color: '#8a9099' }}>
          availability — uct: {uct ? uct.state : 'unknown'} · us: {us ? us.state : 'unknown'}
          {'  '}(states are READ from the payload, never invented)
        </div>
      </div>

      <PublicationBar />

      <div style={S.h}>Family &amp; candle capability — decided by the payload</div>
      <FamilyPane />

      <div style={S.h}>Search — metric first, universe second</div>
      <input
        style={S.input}
        value={q}
        data-testid="q"
        placeholder="try: 50 day / new lows / NASDAQ breadth"
        onChange={(e) => setQ(e.target.value)}
      />
      <div style={S.chipRow}>
        {QUERIES.map((s) => (
          <button
            type="button"
            key={s}
            data-testid={`chip-${s}`}
            style={{ ...S.chip, ...(s === q ? S.chipOn : null) }}
            onClick={() => setQ(s)}
          >{s}</button>
        ))}
      </div>
      <Results q={q} />

      <div style={S.h}>The REAL source picker — choose “Search symbol…”, type “50 day”</div>
      <RealPicker />

      <div style={S.h}>Net New High-Low — signed histogram, meaningful zero</div>
      <Nethl />

      <div style={S.h}>One metric, four universes — added through the canonical path</div>
      <ComparePane />

      <div style={S.h}>Browse by family</div>
      <Browse />
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)
