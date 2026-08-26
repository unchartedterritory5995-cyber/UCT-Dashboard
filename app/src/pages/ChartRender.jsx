// app/src/pages/ChartRender.jsx — headless, token-gated chart export page.
//
// Renders the REAL StockChart widget full-bleed for a single ticker with the
// entry/stop/target price lines drawn, wrapped in the branded header/footer
// (matches chartScreenshot.js composeScreenshot). A headless browser (the
// Morning Wire → Substack renderer) navigates here and screenshots #chart-export
// → the newsletter's leader chart.
//
// ⚠️ THAT RENDERER DOES NOT READ `window.__chartReady`. It waits on its own
// canvas-size predicate plus a 1,600 ms settle, inside a 34 s timeout
// (`morning-wire/substack/chartwidget.py` — `_READY_JS`, `SETTLE_MS`); `grep -rn
// "__chartReady" <morning-wire>` returns zero hits. This comment used to say it
// was a consumer, and the claim was load-bearing in three other documents: it
// was cited as the reason the flag's 3.5 s floor may never shrink. The floor is
// kept anyway — as a conservative no-regression measure — but the reason is
// "later is always safe", not "something else depends on it".
//
// Public route (no AuthGuard). /api/bars is public, so no session is needed.
// A ?token= (checked against VITE_CHART_RENDER_TOKEN) blocks casual abuse.
//
// ─── ALSO: this route is the CHART PARITY GATE surface (Phase B1, Task 7) ────
//
// `tools/chart_parity.py` drives this page to prove a migrated indicator renders
// pixel-identically to the legacy one. Three things here are load-bearing for
// that and must not be "simplified" away:
//
//   1. `window.__chartReady` — the harness waits on it. It must stay FALSE until
//      settings AND (in fixed-bars mode) the bar fixture have landed, or a
//      screenshot can be taken mid-theme and the gate goes intermittently red.
//   2. `#chart-export` — the harness screenshots that ELEMENT, not the page.
//      (`window.__chartBarsReady` — set by StockChart's first-bars latch — is
//      the Discord renderer's precondition for BOTH of its ready branches: a
//      chart with no bars holds still just like a finished one.)
//   3. `?fixedbars=` + `?indicators=` + `?instances=` + `?userdefs=` — see the
//      param block below.
//      Live bars make two runs differ, which is the whole reason the repo had no
//      diffing before. `?instances=` is what lets ONE build render the same
//      indicator two ways (legacy vs engine) so the parity diff measures the
//      MIGRATION and not the difference between two builds.
//
// Adding a new *always-on* dynamic element inside #chart-export (a clock, a
// "last updated", a random tip) breaks the gate for every case at once. If you
// need one, freeze it under `?fixedbars=` like the footer stamp already is.
//
// None of it changes this page's existing behaviour: with neither param present
// the route resolves exactly as before, which is what keeps the Sunday Scans /
// Substack renderer out of the blast radius.

import { useEffect, useMemo, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

// Comparison-line colours, in order of the ?compare= list (distinct from every house MA colour).
const COMPARE_COLORS = ['#38bdf8', '#f472b6', '#a3e635']
import StockChart, { SESSION_EXT_COLOR } from '../components/StockChart'
import { mergeSettingsOverride, PRESETS, CHART_DEFAULTS } from '../components/chart/chartDefaults'
import { currentPaneManifest } from '../components/chart/engine/paneLayout'
import { paneHeightAlerts } from '../components/chart/engine/binder'
import { installUserDefinitions } from '../components/chart/engine/nativeRegistry'
import uctLogo from '../components/intro/assets/compass-mark.png'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''

const TF_LABEL = { '1': '1 min', '5': '5 min', '15': '15 min', '30': '30 min', '60': '1 hr', D: 'Daily', W: 'Weekly', M: 'Monthly' }

// Height of the optional `?stats=` strip; the caller adds it to `?h=`.
export const STATS_STRIP_H = 28

const fmtNum = (v) => {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const x = Number(v); const a = Math.abs(x)
  if (a >= 1e9) return `${(x / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(x / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(x / 1e3).toFixed(0)}K`
  return x.toFixed(2)
}
const fmtPct = (v) => (v == null || !Number.isFinite(Number(v))) ? '—' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`
const dirColor = (v, fallback) => (v == null || !Number.isFinite(Number(v))) ? fallback : (Number(v) >= 0 ? '#22c55e' : '#ef4444')

/** One-line price-action / volume strip under the header. Pure layout: every
 *  number arrives pre-computed in `?stats=` (see `statsParam`). Missing keys
 *  print as an em dash rather than dropping the cell, so the strip's shape is
 *  stable from ticker to ticker. */
function StatsStrip({ stats, bg, text }) {
  const L = { color: '#9aa08f', fontSize: 11, letterSpacing: '0.3px' }
  const V = { color: text, fontWeight: 600, fontSize: 12, marginLeft: 4 }
  const Cell = ({ label, value, color }) => (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', marginRight: 14 }}>
      <span style={L}>{label}</span><span style={{ ...V, color: color || V.color }}>{value}</span>
    </span>
  )
  const rvol = stats.rvol
  return (
    <div data-testid="stats-strip" style={{ height: STATS_STRIP_H, background: bg, display: 'flex', alignItems: 'center', padding: '0 16px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
      <Cell label="O" value={fmtNum(stats.open)} />
      <Cell label="H" value={fmtNum(stats.high)} />
      <Cell label="L" value={fmtNum(stats.low)} />
      <Cell label="C" value={fmtNum(stats.close)} />
      <Cell label="Day" value={fmtPct(stats.day_pct)} color={dirColor(stats.day_pct, text)} />
      <Cell label="Gap" value={fmtPct(stats.gap_pct)} color={dirColor(stats.gap_pct, text)} />
      <Cell label="52w H" value={`${fmtNum(stats.hi_52w)} (${fmtPct(stats.from_52w_high_pct)})`} />
      <Cell label="52w L" value={fmtNum(stats.lo_52w)} />
      <Cell label="Vol" value={fmtNum(stats.volume)} />
      <Cell label="Avg50" value={fmtNum(stats.avg_vol_50)} />
      <Cell label="RVOL" value={rvol == null ? '—' : `${Number(rvol).toFixed(2)}x`} color={rvol != null && Number(rvol) >= 1.5 ? '#c9a84c' : undefined} />
      <Cell label="$Vol" value={fmtNum(stats.dollar_vol)} />
      <Cell label="ADR" value={stats.adr_pct == null ? '—' : `${Number(stats.adr_pct).toFixed(1)}%`} />
    </div>
  )
}

/** base64url → JSON, so a whole blob survives a URL untouched. Returns
 *  `undefined` on anything malformed: a bad param must not blank the chart — it
 *  degrades to "no override", and the harness catches the miss because the diff
 *  is then non-zero. */
function decodeB64UrlJson(raw) {
  if (!raw) return undefined
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const bin = atob(padded)
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return undefined
  }
}

/** `?indicators=` — a PARTIAL chart_settings OBJECT. */
function decodeSettingsParam(raw) {
  const parsed = decodeB64UrlJson(raw)
  return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null
}

/** `?instances=` — an ARRAY of engine indicator instances. */
function decodeInstancesParam(raw) {
  const parsed = decodeB64UrlJson(raw)
  return (Array.isArray(parsed) && parsed.length) ? parsed : null
}

/** `?userdefs=` — an ARRAY of USER DEFINITION documents (Phase D Task 16).
 *
 *  ⭐ WHY THE PARITY ROUTE NEEDS ITS OWN DOOR AT ALL. In the product a chart
 *  gets user definitions from `useInstalledUserDefinitions`, which fetches
 *  `/api/user-definitions` — and under `?fixedbars=` this page short-circuits
 *  EVERY `/api/` call to a 503 on purpose, so the gate can run against a bare
 *  `vite dev` with no backend and so a live server cannot move a stored
 *  baseline. A hermetic capture therefore cannot fetch a definition, which is
 *  exactly why Task 11's case could not be made to draw and reported 0 changed
 *  pixels with AND without its own perturbation.
 *
 *  ⛔ IT IS NOT A SECOND VALIDATOR AND NOT A BACK DOOR INTO THE REGISTRY. The
 *  documents go through `installUserDefinitions`, the same door the product
 *  caller uses, which runs every gate (`defSchema`, the `supportedKinds`
 *  filter, one-data-plot, the budget, the repaint badge in both directions) and
 *  refuses a shipped id. A malformed or invalid definition installs NOTHING
 *  here, exactly as it installs nothing for a user — which is what makes the
 *  negative parity control mean something. */
function decodeUserDefsParam(raw) {
  const parsed = decodeB64UrlJson(raw)
  return (Array.isArray(parsed) && parsed.length) ? parsed : null
}

// ─── Hermetic mode (fixed-bars parity captures only) ─────────────────────────
// With `?fixedbars=` the page must render the SAME pixels on every run, on any
// machine, forever. Bars come from the committed fixture, but the page still
// reaches for /api/ticker-meta (watermark sector/industry), /api/auth/preferences
// (chart_settings) and /api/r/chart-settings — every one of which is a live value
// that can differ between the baseline capture and the candidate capture and show
// up as a "regression" that is really just the server having changed its mind.
//
// So in fixed-bars mode every /api/ call is short-circuited to a 503 with an empty
// JSON body. Each of those call sites already treats a non-ok response as "no data"
// (`r.ok ? r.json() : null`, or SWR's error path), so the page settles on schema
// defaults + whatever `?indicators=` pins — which is exactly the state a parity
// case is supposed to describe. It also means the gate runs against a bare
// `vite dev` with no backend at all.
//
// The patch is process-wide and one-way, so it is installed ONLY when
// `?fixedbars=` is present: a headless capture never navigates anywhere else,
// but a human who did would find /api dead until reload.
let _hermeticInstalled = false
function installHermeticFetch() {
  if (_hermeticInstalled || typeof window === 'undefined' || !window.fetch) return
  _hermeticInstalled = true
  const real = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = String(typeof input === 'string' ? input : (input?.url || input || ''))
    if (url.includes('/api/')) {
      return Promise.resolve(new Response('{}', {
        status: 503,
        statusText: 'parity-hermetic',
        headers: { 'Content-Type': 'application/json' },
      }))
    }
    return real(input, init)
  }
}

export default function ChartRender() {
  const [sp] = useSearchParams()
  const sym = (sp.get('sym') || '').toUpperCase()
  const tf = sp.get('tf') || 'D'
  const company = sp.get('company') || ''
  const price = parseFloat(sp.get('price') || '0')
  const chg = parseFloat(sp.get('chg') || '')
  const w = Math.min(2000, Math.max(600, parseInt(sp.get('w') || '1200', 10)))
  const h = Math.min(1200, Math.max(400, parseInt(sp.get('h') || '620', 10)))
  const token = sp.get('token') || ''
  // Export-only view controls. Absent = today's behavior exactly.
  //   ?bars=N  widen the default zoom (hourly defaults to 65, which spans only
  //            ~4 days once pre/post-market candles are counted)
  //   ?ext=0   REGULAR HOURS ONLY - drops the pre/post shading bands AND the
  //            pre/post candles. The headless page has no saved chart settings,
  //            so it silently inherited `extendedHoursShading ?? true`.
  //   ?priceline=0  drop the dashed LAST-PRICE line (and the volume value line).
  //            A parity-determinism control, and the only one of its kind — see
  //            the note next to `hidePriceLine` below for the measurement that
  //            put it here. Absent = today's behavior exactly.
  const barsOverride = (() => { const v = parseInt(sp.get('bars') || '', 10); return Number.isFinite(v) && v > 0 ? Math.min(1200, v) : null })()
  // ?breadth=1&bname=<metric name> — a UCT breadth pseudo-ticker (UCTA50 …). The
  // caller (the Discord bot) resolved the record server-side and stamps it here,
  // so this page paints exactly what ChartPane paints for breadth without a
  // catalog fetch that could race the capture: symbol + metric name watermark,
  // the single canvas-contrasting line ink (StockChart `breadthLine`, a no-op
  // unless the chart type is 'line' - the bot sends chartType 'line' for breadth
  // unless the member chose a style), and a blank volume pane (vol is 0 for a %).
  const breadthParam = sp.get('breadth') === '1'
  const breadthName = breadthParam ? (sp.get('bname') || '').slice(0, 80) : ''
  // ?to=YYYY-MM-DD — the Discord chart's "Earlier" panning: hide every bar
  // after that day and frame the window ending there (StockChart replayCutoff;
  // the bars API serves a pre-cutoff window fast). Absent = live, unchanged.
  const toParam = (() => { const v = sp.get('to') || ''; return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null })()
  const extParam = sp.get('ext')
  const forceExt = extParam === null ? null : !(extParam === '0' || extParam === 'false')
  const priceLineParam = sp.get('priceline')
  const hidePriceLine = priceLineParam === '0' || priceLineParam === 'false'
  //   ?stats=<base64url JSON>  a compact price-action / volume strip under the
  //            header (Discord /chart). The NUMBERS are computed server-side
  //            (api/services/discord_chart_render.compute_stats — one authority);
  //            this page only lays them out. Absent = today's behavior exactly,
  //            which keeps the Sunday Scans / Substack renderer untouched.
  const statsParam = useMemo(() => {
    const parsed = decodeB64UrlJson(sp.get('stats'))
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null
  }, [sp])

  // ── Parity-gate params (see the header comment) ────────────────────────────
  //   ?indicators=<base64url JSON>  a PARTIAL chart_settings blob, deep-merged
  //            over whatever settings this page already resolved. This is how a
  //            parity case says "BB on, period 20, this exact colour" without a
  //            logged-in session or a stored preference anywhere.
  //   ?fixedbars=<name>  render the committed bar fixture at
  //            src/pages/parityBars/<name>.json instead of fetching live data,
  //            and go hermetic (no /api/ at all). Live bars move between the
  //            baseline capture and the candidate capture, so without this the
  //            diff measures the tape, not the code.
  //   ?instances=<base64url JSON array>  the ENGINE's indicator instances. ONE
  //            param says "draw these through the engine".
  //            It is a param of its OWN rather than more keys inside
  //            `?indicators=` deliberately: a parity case should have to say
  //            "draw these, through the engine" as one indivisible thing rather
  //            than assembling it out of separate settings keys.
  //            ⭐ B5 TASK 4 — IT USED TO SET A SECOND KEY AND NO LONGER DOES.
  //            This render also wrote `engineEnabled: true` here, and this was the
  //            ONLY place in shipped source that ever wrote the flag `true` — the
  //            headless parity/newsletter route, on a URL param no user can reach.
  //            The flag is deleted (`docs/decisions/2026-08-04-engine-enabled-
  //            deleted.md`), so `?instances=` now merges instances alone, which is
  //            what it always meant. The route's behaviour is unchanged: an
  //            instance of a FLIPPED definition has been drawn regardless of the
  //            flag since Flip B, and all four are flipped.
  const indicatorsParam = useMemo(() => decodeSettingsParam(sp.get('indicators')), [sp])
  // ?preset=oled — one of the app's own theme presets (chartDefaults.PRESETS),
  // applied as its DELTA from CHART_DEFAULTS so it restyles without wiping the
  // owner's unrelated settings; an explicit ?indicators= still wins on top.
  const presetParam = sp.get('preset') || ''
  const presetDelta = useMemo(() => {
    const preset = Object.prototype.hasOwnProperty.call(PRESETS, presetParam) ? PRESETS[presetParam] : null
    if (!preset || !preset.settings) return null
    const delta = {}
    for (const [k, v] of Object.entries(preset.settings)) {
      if (k === 'preset') continue
      if (JSON.stringify(v) !== JSON.stringify(CHART_DEFAULTS[k])) delta[k] = v
    }
    delta.preset = presetParam
    return delta
  }, [presetParam])
  const instancesParam = useMemo(() => decodeInstancesParam(sp.get('instances')), [sp])
  //   ?userdefs=<base64url JSON array>  USER DEFINITION DOCUMENTS, installed into
  //            the registry before `StockChart` below renders. ⛔ A `useMemo`, NOT
  //            a `useEffect`: this parent must have installed them before the
  //            child's first repaint resolves its instances, and an effect runs
  //            after that render — the "works on the second paint only" defect.
  //            React renders parents before children, so a memo here is ordered
  //            ahead of every lookup the chart makes.
  const userDefsParam = useMemo(() => decodeUserDefsParam(sp.get('userdefs')), [sp])
  const userDefsInstall = useMemo(
    () => (userDefsParam ? installUserDefinitions(userDefsParam) : { installed: [], errors: [] }),
    [userDefsParam],
  )
  // Sanitised: this value indexes a dynamic import, so it may only ever name a
  // file, never traverse to one.
  const fixedBars = (sp.get('fixedbars') || '').replace(/[^A-Za-z0-9_-]/g, '')
  if (fixedBars) installHermeticFetch()

  const lvl = (k) => { const v = parseFloat(sp.get(k) || ''); return Number.isFinite(v) && v > 0 ? v : null }
  const entry = lvl('entry'), stop = lvl('stop'), t1 = lvl('t1'), t2 = lvl('t2')

  // ?exttag=post:764.97 — the extended-hours print as the orange Pre/Post chip
  // on the right axis, exactly the tag the Charts widget draws from the live
  // feed. This page is logged out and static (liveUpdates=false), so the bot
  // resolves the quote server-side (massive.get_batch_rich_snapshots, the same
  // source) and hands it over; chip only, no line, never a candle.
  const extTag = (() => {
    const v = sp.get('exttag') || ''
    const mm = /^(pre|post):(\d+(?:\.\d+)?)$/.exec(v)
    if (!mm) return null
    const px = parseFloat(mm[2])
    return Number.isFinite(px) && px > 0 ? { session: mm[1], price: px } : null
  })()

  const priceLines = useMemo(() => {
    const L = []
    if (extTag) L.push({ price: extTag.price, color: SESSION_EXT_COLOR, lineWidth: 1, lineStyle: 0,
      axisLabelVisible: true, lineVisible: false, title: extTag.session === 'post' ? 'Post' : 'Pre' })
    if (entry) L.push({ price: entry, color: '#3cb868', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Entry' })
    if (stop) L.push({ price: stop, color: '#e74c3c', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Stop' })
    if (t1) L.push({ price: t1, color: '#c9a84c', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'T1' })
    if (t2) L.push({ price: t2, color: '#c9a84c', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'T2' })
    return L
  }, [entry, stop, t1, t2, extTag?.session, extTag?.price])

  // The owner's saved chart settings.
  //
  // This page runs LOGGED OUT, so it has no session and never saw his
  // `chart_settings` — it silently rendered the schema defaults. He runs a light
  // theme; every Sunday Scans chart came out near-black (rgb(14,15,13)), which
  // is why the newsletter charts never looked like the ones he exports from the
  // app himself. Same shape as the extendedHoursShading bug this route already
  // had: a headless page inherits `?? default` for everything nobody passes it.
  //
  // Fetched (not a URL param) so the caller needs to know nothing about chart
  // settings — the Friday job's URL is unchanged and every future theme edit
  // reaches the newsletter with no pipeline change.
  const [ownerSettings, setOwnerSettings] = useState(null)
  const [settingsSettled, setSettingsSettled] = useState(false)
  useEffect(() => {
    let alive = true
    const done = (v) => { if (alive) { setOwnerSettings(v); setSettingsSettled(true) } }
    // A parity case pins its OWN settings and must not inherit his live theme —
    // otherwise every stored baseline silently expires the next time he changes
    // a colour in Settings.
    if (fixedBars) { done(null); return () => { alive = false } }
    fetch(`/api/r/chart-settings?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => done(j?.chart_settings || null))
      // Fails OPEN to today's defaults: a settings lookup must never cost him
      // the chart itself.
      .catch(() => done(null))
    return () => { alive = false }
  }, [token, fixedBars])

  // Identity-stable: settingsOverride is a memo dep on StockChart.
  // Precedence: schema defaults < owner blob < ?indicators=. mergeSettingsOverride
  // is the same deep-merge the multi-chart grid uses for per-cell overrides, so
  // `{indicators: {bb: {enabled: true}}}` turns BB on without erasing the rest of
  // the indicators section.
  //
  // `?instances=` lands LAST and as its own merge step. `mergeSettingsOverride`
  // merges `indicatorInstances` by instanceId (never wholesale), so this adds the
  // engine's instances without disturbing anything the settings blob said.
  // `?compare=SPY,QQQ` (Discord /chart compare:) - up to three symbols drawn the
  // way the Charts widget draws comparisons: %-rebased lines with their own
  // coloured labels on the right (StockChart `comparisonSymbols`, scaleMode
  // 'new'). Replaces any saved comparison wholesale: a bot chart never inherits
  // whatever the owner last compared on his own screen.
  const compareParam = sp.get('compare') || ''
  const compareSyms = useMemo(
    () => Array.from(new Set(compareParam.split(',').map(s => s.trim().toUpperCase())
      .filter(s => /^[A-Z0-9.^-]{1,12}$/.test(s)))).slice(0, 3),
    [compareParam],
  )
  const compareOverride = useMemo(() => (compareSyms.length
    ? { comparisonSymbols: compareSyms.map((sym, i) => ({ sym, color: COMPARE_COLORS[i % COMPARE_COLORS.length], enabled: true, scaleMode: 'new' })) }
    : null), [compareSyms])

  const csOverride = useMemo(() => {
    if (!ownerSettings && !indicatorsParam && !instancesParam && !presetDelta && !compareOverride) return null
    let out = ownerSettings
    if (presetDelta) out = mergeSettingsOverride(out || {}, presetDelta)
    if (compareOverride) out = mergeSettingsOverride(out || {}, compareOverride)
    if (indicatorsParam) out = mergeSettingsOverride(out || {}, indicatorsParam)
    if (instancesParam) {
      // ⚠️ `engineEnabled: true` stood beside this key until B5 Task 4. It was the
      // one write of the flag anywhere in shipped source; deleting it is what makes
      // `scanAppSrc(/engineEnabled/)` empty in `engineEnabledMigration.test.js`.
      out = mergeSettingsOverride(out || {}, {
        indicatorInstances: instancesParam,
      })
    }
    return out
  }, [ownerSettings, presetDelta, indicatorsParam, instancesParam, compareOverride])

  // The committed bar fixture. Dynamic import (not fetch) so it needs no static
  // route and costs the normal bundle nothing — Vite splits it into its own chunk
  // that only a ?fixedbars= load ever pulls.
  const [fixtureBars, setFixtureBars] = useState(null)
  const [fixtureSettled, setFixtureSettled] = useState(!fixedBars)
  useEffect(() => {
    if (!fixedBars) { setFixtureBars(null); setFixtureSettled(true); return undefined }
    let alive = true
    setFixtureSettled(false)
    import(`./parityBars/${fixedBars}.json`)
      .then((m) => {
        if (!alive) return
        const b = (m?.default?.bars || m?.bars)
        setFixtureBars(Array.isArray(b) && b.length ? b : null)
        setFixtureSettled(true)
      })
      .catch(() => { if (alive) { setFixtureBars(null); setFixtureSettled(true) } })
    return () => { alive = false }
  }, [fixedBars])

  // Company / price / change, when the caller did not supply them.
  //
  // The manual export's header reads "SPY (State Street SPDR S&P 500 ETF Trust)
  // D $747.03 +0.72%" because composeScreenshot has the live chart's own state
  // to hand. The Sunday Scan pipeline passes only sym+tf, so the same header
  // rendered as a bare "SPY Daily" - the two charts sat side by side in one
  // issue with different headers.
  //
  // Fetched HERE rather than threaded through the pipeline: render_many's specs
  // are (sym, tf) tuples, and widening that plumbing to carry presentation data
  // would put newsletter-formatting concerns inside the renderer's call
  // signature. The page already knows how to ask for its own facts.
  const [meta, setMeta] = useState({ company: '', price: null, chg: null })
  useEffect(() => {
    if (!sym) return undefined
    let alive = true
    const want = { company: company || '', price: price > 0 ? price : null, chg: Number.isFinite(chg) ? chg : null }
    if (want.company && want.price != null && want.chg != null) { setMeta(want); return undefined }
    // Fixed-bars mode reads the header straight off the fixture. Two runs of the
    // same case therefore print the same price and the same change, which a live
    // /api/bars lookup would not.
    if (fixedBars) {
      if (!fixtureSettled) return undefined
      const last = fixtureBars?.length ? fixtureBars[fixtureBars.length - 1] : null
      const prev = fixtureBars?.length > 1 ? fixtureBars[fixtureBars.length - 2] : null
      const c = last?.c, pc = prev?.c
      setMeta({
        company: want.company,
        price: want.price != null ? want.price : (Number.isFinite(c) ? c : null),
        chg: want.chg != null ? want.chg
          : (Number.isFinite(c) && Number.isFinite(pc) && pc ? ((c - pc) / pc) * 100 : null),
      })
      return undefined
    }
    Promise.allSettled([
      want.company ? Promise.resolve(null) : fetch(`/api/ticker-meta/${encodeURIComponent(sym)}`).then((r) => (r.ok ? r.json() : null)),
      (want.price != null && want.chg != null)
        ? Promise.resolve(null)
        : fetch(`/api/bars/${encodeURIComponent(sym)}?tf=D&bars=2`).then((r) => (r.ok ? r.json() : null)),
    ]).then(([m, b]) => {
      if (!alive) return
      const bars = b?.value?.bars || b?.value || []
      const last = Array.isArray(bars) && bars.length ? bars[bars.length - 1] : null
      const prev = Array.isArray(bars) && bars.length > 1 ? bars[bars.length - 2] : null
      const c = last?.c ?? last?.close
      const pc = prev?.c ?? prev?.close
      setMeta({
        company: want.company || m?.value?.name || m?.value?.company || '',
        price: want.price != null ? want.price : (Number.isFinite(c) ? c : null),
        chg: want.chg != null ? want.chg
          : (Number.isFinite(c) && Number.isFinite(pc) && pc ? ((c - pc) / pc) * 100 : null),
      })
    })
    return () => { alive = false }
  }, [sym, company, price, chg, fixedBars, fixtureSettled, fixtureBars])

  // ── Signal readiness — PIXEL STABILITY, not a stopwatch ────────────────────
  //
  // Gated on the settings landing first — otherwise the screenshot can be taken
  // while the chart is still wearing the default theme, and the fix would land
  // intermittently (the worst kind of "it works on my machine"). The bar fixture
  // is gated for the same reason: until it lands StockChart is showing a spinner,
  // and a parity baseline of a spinner passes forever.
  //
  // ⚠️ THIS USED TO BE A BARE `setTimeout(…, 3500)`, AND THAT IS NOT A READINESS
  // SIGNAL. It said "3.5 seconds have passed", not "the chart has stopped
  // moving", so every parity number ever produced through this page — including
  // all of the zeros — was measured against a clock. Worth fixing on its own.
  //
  // ⛔ IT WAS NOT, HOWEVER, THE CAUSE OF THE 24-PIXEL ARTEFACT this comment used
  // to blame it for. That diagnosis ("the busier side settled its price range one
  // frame after the screenshot") was refuted by re-measurement: the 24 px
  // reproduce with `--instances-side none` (legacy vs legacy, no engine on either
  // side), both render states appear on BOTH sides at the same rate, and every
  // capture was proven pixel-stable. The real cause is a BISTABLE rasterisation
  // of the dashed last-price line drawn by the CANDLE series — one row, ~24
  // columns, alternating the candle down-colour with the background at a ~2%
  // blend — which is what `?priceline=0` (see `hidePriceLine` below) removes.
  // The full account is in `docs/runbooks/chart-parity-gate.md`.
  //
  // So the flag now waits for the CANVASES INSIDE `#chart-export` to hold still:
  // their pixels are hashed on a sampling interval and the flag flips only after
  // STABLE_SAMPLES consecutive identical hashes.
  //
  // 🔒 IT CAN ONLY EVER FIRE LATER THAN IT USED TO, NEVER EARLIER. The 3,500 ms
  // floor is kept verbatim, and stability is an ADDITIONAL condition on top of
  // it — a conservative no-regression measure. (NOT, as this comment used to say,
  // because the Morning Wire → Substack renderer consumes the flag. It does not;
  // see the file header.) The ceiling stops a chart that never settles (an
  // animation, a live tick) from hanging a capture forever; when it is hit,
  // `__chartReadyReason` says so and the harness records it. The harness ALSO
  // double-captures and requires byte-equal pixels, so this is the belt and that
  // is the braces — deliberately independent.
  //
  // Reading the canvas does not change what is rendered: `getImageData` is a
  // read, and nothing here touches chart state.
  // ── `window.__chartBarsReady` — did the chart get its BARS? ───────────────
  // `__chartReady` means "pixels held still"; an EMPTY chart holds still too,
  // and the Discord renderer's canvas signature is satisfied by the header +
  // watermark alone. Twice on 2026-08-25 a 5-minute render was captured while
  // its 5,000-bar fetch was still in flight (7-20 s cold) and shipped blank.
  // StockChart's own first-bars latch (`onBarsReady`, once per mount, also on
  // a fatal error so the pixel judge still gets its turn) flips this; the
  // renderer refuses to call a frame ready until it is true.
  // Reset DURING render, not in an effect: a child's mount effect runs before
  // the parent's, so an effect here would wipe a latch StockChart had already
  // flipped. The write is idempotent per (sym, tf) and this page is a one-shot
  // export, so the render-time side effect is the correct order, not a shortcut.
  // With `?compare=`, the overlays are a SECOND fetch StockChart makes on its
  // own; the first-bars latch says nothing about them. Measured 2026-08-25: a
  // compare render captured on the base latch alone showed the % scale and no
  // lines. So readiness = base bars AND (no comparisons OR overlays drawn).
  const barsKey = `${sym}|${tf}|${compareSyms.join(',')}`
  const barsKeyRef = useRef(null)
  const readyPartsRef = useRef({ bars: false, comparisons: false })
  if (barsKeyRef.current !== barsKey) {
    barsKeyRef.current = barsKey
    readyPartsRef.current = { bars: false, comparisons: false }
    window.__chartBarsReady = false
  }
  const publishBarsReady = () => {
    const r = readyPartsRef.current
    window.__chartBarsReady = r.bars && (compareSyms.length === 0 || r.comparisons)
  }
  const onBarsReady = () => { readyPartsRef.current.bars = true; publishBarsReady() }
  const onComparisonsReady = () => { readyPartsRef.current.comparisons = true; publishBarsReady() }

  useEffect(() => {
    window.__chartReady = false
    window.__chartReadyMs = null
    window.__chartReadyReason = null
    window.__chartReadyFrames = null
    if (!settingsSettled || !fixtureSettled) return undefined

    const FLOOR_MS = 3500      // unchanged from the timer this replaced
    const CEILING_MS = 20000   // never hang a capture on a chart that won't settle
    const SAMPLE_MS = 120
    const STABLE_SAMPLES = 4   // 4 identical samples ⇒ ~360ms of held-still canvas

    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    let cancelled = false
    let timer = 0
    let prev = null
    let stable = 0

    const finish = (reason) => {
      if (cancelled) return
      window.__chartReadyMs = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)
      window.__chartReadyReason = reason
      window.__chartReadyFrames = stable
      window.__chartReady = true
    }

    // A cheap 32-bit rolling hash over every canvas's pixels. Full walk, no
    // stride: the artefact this exists to catch is ONE SCANLINE of a dashed
    // line, and a stride wide enough to be cheap is wide enough to step over it.
    const sample = () => {
      const root = document.getElementById('chart-export')
      if (!root) return null
      const canvases = root.querySelectorAll('canvas')
      if (!canvases.length) return null
      let h = 0x811c9dc5
      // How many canvases actually GAVE us pixels. A signature built only out of
      // widths and heights is a hash of nothing that never changes — it would
      // read as "stable" forever and reproduce the stopwatch with extra steps.
      // Returning null instead makes "unreadable" ride the ceiling, which is the
      // fail-toward-waiting direction.
      let read = 0
      for (const c of canvases) {
        h = (h ^ c.width) >>> 0; h = Math.imul(h, 0x01000193) >>> 0
        h = (h ^ c.height) >>> 0; h = Math.imul(h, 0x01000193) >>> 0
        let ctx2d
        try { ctx2d = c.getContext('2d') } catch { ctx2d = null }
        if (!ctx2d || !c.width || !c.height) continue
        let data
        try { data = ctx2d.getImageData(0, 0, c.width, c.height).data } catch { return null }
        read += 1
        for (let i = 0; i < data.length; i++) {
          h = (h ^ data[i]) >>> 0
          h = Math.imul(h, 0x01000193) >>> 0
        }
      }
      return read ? (h >>> 0) : null
    }

    const tick = () => {
      if (cancelled) return
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
      const elapsed = now - t0
      const sig = sample()
      // `null` = nothing to sample yet (no canvas, or a tainted/absent 2D
      // context). Treat it as "not stable" rather than as a value, so a page
      // that never gives us pixels rides the ceiling instead of declaring
      // itself ready on a hash of nothing.
      if (sig !== null && prev !== null && sig === prev) stable += 1
      else stable = sig === null ? 0 : 1
      prev = sig

      if (elapsed >= FLOOR_MS && sig !== null && stable >= STABLE_SAMPLES) { finish('stable'); return }
      if (elapsed >= CEILING_MS) { finish('ceiling'); return }
      timer = setTimeout(tick, SAMPLE_MS)
    }
    timer = setTimeout(tick, SAMPLE_MS)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [sym, tf, settingsSettled, fixtureSettled])

  // ── `window.__paneManifest` — the parity harness's structural read ─────────
  //
  // `tools/chart_parity.py::read_manifest` evaluates `window.__paneManifest ??
  // null` after `__chartReady`, diffs A against B as JSON, and puts the result in
  // `report.json`. It is the plan's discriminator #3: a change that moves pixels
  // but not the manifest, or the manifest but not the pixels, is a regression by
  // definition — one of the two is lying.
  //
  // PUBLISHED ONLY IN FIXED-BARS MODE, for the same reason the footer clock is
  // frozen there: an always-on global on the export path is a thing the gate has
  // to be told to ignore, and a thing nobody remembers to tell it. `?fixedbars=`
  // is already the "this render is being measured" switch.
  //
  // ⚠️ A GETTER, NOT A VALUE, and that is load-bearing twice over. The manifest
  // describes what the RENDERER built, so it cannot be computed before the chart
  // exists — and this page never learns when that is: `StockChart` keeps its
  // `IChartApi` in a ref and exposes it through no prop, no ref and no callback.
  // A getter sidesteps the ordering entirely: the harness reads it after
  // `__chartReady`, and the read is what builds the answer.
  //
  // ⚠️ IT READS `null` UNTIL A CHART REGISTERS ITSELF (`paneLayout`'s
  // `registerManifestChart`), which is one line inside StockChart's create branch
  // and belongs to the task that owns that file. `null` is the CONTRACTED value
  // for "this page published no manifest" — the harness records it with a stated
  // reason and skips the A/B diff rather than raising at run 13 of 20.
  useEffect(() => {
    if (!fixedBars) return undefined
    Object.defineProperty(window, '__paneManifest', {
      configurable: true,
      get: () => currentPaneManifest(),
    })
    // ⭐ AND THE HEIGHT ALERTS, FOR THE SAME REASON AND WITH A SHARPER ONE.
    // `binder.paneHeightAlerts()` counts every pane-height disagreement between
    // the layout and the renderer that SURVIVED its own re-apply — a real,
    // deliberately non-throwing condition (a blank chart beats a 1-px drift)
    // whose only output was a `console.warn` nobody collects. That made it the
    // last B5 residue: a check with no reader.
    //
    // The parity gate is the reader that can act on it. A capture with a live
    // alert is a capture whose panes are NOT the geometry `computePaneLayout`
    // computed, so its pixels are not comparable to an `expect` measured when
    // they were — the same class of precondition as `FontNotSettledError`, and
    // like it, it never sees a pixel count. Getter for the same ordering reason
    // as the manifest: nothing here knows when a chart exists.
    Object.defineProperty(window, '__paneHeightAlerts', {
      configurable: true,
      get: () => paneHeightAlerts(),
    })
    return () => {
      try { delete window.__paneManifest } catch { /* non-configurable */ }
      try { delete window.__paneHeightAlerts } catch { /* non-configurable */ }
    }
  }, [fixedBars])

  // ── `window.__userDefinitions` — did `?userdefs=` actually install? ─────────
  //
  // ⛔ A NON-VACUITY READ, NOT A CONVENIENCE. A capture that installed NOTHING
  // and a capture that installed a definition the chart then failed to draw
  // produce the same picture — two panes and no series — and the whole reason
  // Task 11 refused to report its zero is that a zero with no discriminator is
  // not a measurement. The harness records `{installed, errors}` beside the pane
  // manifest, so "the definition was refused" and "the definition installed and
  // the renderer ignored it" can never again be read off the same image.
  //
  // Published only in fixed-bars mode, for the same reason the manifest is: an
  // always-on global on the export path is a thing the gate has to be told to
  // ignore, and a thing nobody remembers to tell it.
  useEffect(() => {
    if (!fixedBars) return undefined
    Object.defineProperty(window, '__userDefinitions', {
      configurable: true,
      get: () => ({
        installed: userDefsInstall.installed.map((d) => d && d.id),
        errors: userDefsInstall.errors,
      }),
    })
    return () => {
      try { delete window.__userDefinitions } catch { /* non-configurable */ }
    }
  }, [fixedBars, userDefsInstall])

  if (TOKEN && token !== TOKEN) return <div style={{ color: '#e74c3c', padding: 20 }}>unauthorized</div>
  if (!sym) return <div style={{ color: '#888', padding: 20 }}>no symbol</div>

  // 40px header + 20px footer (+ the optional stats strip, whose height the
  // caller adds to ?h= so the chart canvas keeps the house proportions).
  const chartH = h - 60 - (statsParam ? STATS_STRIP_H : 0)

  // Chrome follows the chart's own canvas colour, exactly as composeScreenshot
  // does ("fill EVERYTHING with the chart's own background... so the header/
  // footer blend seamlessly"). Hardcoding #0a0a0a/#161616 was invisible while
  // the export was always dark; the moment the owner's light theme arrives, a
  // near-black header strip over a cream chart reads as a broken image.
  // Reads the MERGED blob, not the owner's alone, so a parity case that pins a
  // background gets matching chrome instead of a near-black strip over it.
  const pageBg = csOverride?.background || '#0a0a0a'
  const chromeBg = csOverride?.background || '#161616'
  const chromeText = csOverride?.textColor || '#888'

  return (
    <div style={{ background: pageBg, minHeight: '100vh' }}>
      {/* Hide the floating drawing toolbar overlay in the export (it's not part
          of the real composeScreenshot canvas capture). */}
      <style>{`#chart-export [class*="toolbar" i],
        #chart-export [class*="scaleToggle" i],
        #chart-export [class*="resetView" i],
        #chart-export [class*="homeBtn" i],
        /* alwaysShowLegend seeds BOTH legends from the latest bar. The volume
           strip is wanted; the OHLC/MA one is not - composeScreenshot drops it
           (commit "drop the OHLC/MA legend"), so showing it here would put an
           element in the newsletter charts that the hand-made ones never carry.
           Matched on the class PREFIX: CSS modules hash these names, so
           [class*="legend"] is the only form that survives the build - and it
           must not also catch volLegend, hence the explicit re-show below. */
        #chart-export [class*="legend" i]{display:none !important}
        #chart-export [class*="volLegend" i]{display:flex !important}
        #chart-export{font-family:'Instrument Sans',-apple-system,Segoe UI,sans-serif}`}</style>
      <div id="chart-export" style={{ width: w, background: pageBg }}>
        <div style={{ height: 40, background: chromeBg, display: 'flex', alignItems: 'center', padding: '0 16px', color: chromeText, fontSize: 14, position: 'relative' }}>
          <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 18 }}>{sym}</span>
          {meta.company && <span style={{ marginLeft: 8, color: '#9aa08f', fontSize: 13 }}>({meta.company})</span>}
          {compareSyms.length > 0 && (
            <span data-testid="compare-tag" style={{ marginLeft: 10, fontSize: 13, color: chromeText }}>
              vs {compareSyms.map((cs, i) => (
                <span key={cs} style={{ color: COMPARE_COLORS[i % COMPARE_COLORS.length], fontWeight: 600 }}>{i ? ' · ' : ''}{cs}</span>
              ))}
            </span>
          )}
          {/* RAW code ('D'), not 'Daily' - composeScreenshot draws opts.tf
              verbatim, and these two headers sit in the same issue. */}
          <span style={{ marginLeft: 12 }}>{tf}</span>
          {/* NOT hardcoded #fff — white on a cream canvas is an invisible price. */}
          {meta.price != null && <span style={{ marginLeft: 12, color: chromeText, fontWeight: 600 }}>${meta.price.toFixed(2)}</span>}
          {meta.chg != null && <span style={{ marginLeft: 8, color: meta.chg >= 0 ? '#22c55e' : '#ef4444' }}>{meta.chg >= 0 ? '+' : ''}{meta.chg.toFixed(2)}%</span>}
          <span style={{ position: 'absolute', left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, pointerEvents: 'none' }}>
            <img src={uctLogo} alt="" style={{ height: 18, opacity: 0.95 }} />
            <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 13, letterSpacing: '0.6px' }}>UCT INTELLIGENCE</span>
          </span>
        </div>
        {statsParam && <StatsStrip stats={statsParam} bg={chromeBg} text={chromeText} />}
        {/* volInSeparatePane = volumeSeparatePane || cs.volume.separatePane.
            His SAVED separatePane is false, but the workspace widget passes the
            PROP, so his live chart — and every chart he exports by hand — puts
            volume in its own pane. This page passed neither and drew it overlaid
            on the price grid. The prop also gates showVolLegend, which is why
            the "$ Vol / Avg 50D" strip was missing from newsletter charts. */}
        <div style={{ width: w, height: chartH }}>
          <StockChart
            sym={sym}
            tf={tf}
            height={`${chartH}px`}
            priceLines={priceLines}
            visibleBarsOverride={barsOverride}
            onBarsReady={onBarsReady}
            onComparisonsReady={onComparisonsReady}
            {...(toParam ? { replayCutoff: toParam } : {})}
            {...(breadthParam ? { breadthLine: true, blankVolume: true, watermark: sym, watermarkName: breadthName || undefined } : {})}
            forceExtendedHours={forceExt}
            settingsOverride={csOverride}
            barsOverride={fixtureBars}
            barsOverridePending={!!fixedBars && !fixtureSettled}
            // ⚠️ MEASURED NONDETERMINISM, NOT A PREFERENCE. Over 40 runs of
            // `engine_rsi_toggle_off` (2026-08-02) the DASHED LAST-PRICE LINE
            // rasterised into one of exactly TWO states — 24 px on one row,
            // y=265, at ~12 dash boundaries — and it did so INDEPENDENTLY on
            // both sides (5/40 on the legacy side, 7/40 on the engine side),
            // uncorrelated with settle time. Every capture was proven
            // pixel-stable first (2 shots, both sides, all 80), so this is not
            // capture timing and not an A-vs-B asymmetry: it is Chromium
            // rasterising the same dashed line two ways at that geometry. The
            // line is drawn by the CANDLE series, so it is not part of any
            // indicator migration and no case measures it. `?priceline=0`
            // removes it from the one case that lands on the unstable geometry —
            // the same treatment the footer's wall-clock stamp already gets, and
            // NOT a tolerance: that case must still be 0 on every run.
            hidePriceLine={hidePriceLine}
            volumeSeparatePane
            alwaysShowLegend
            liveUpdates={false}
          />
        </div>
        <div style={{ height: 20, background: chromeBg, display: 'flex', alignItems: 'center', padding: '0 16px', color: chromeText, fontSize: 10 }}>
          {/* Traders read ET — a "03:20 UTC" stamp on a 7:35am letter reads broken.
              FROZEN in fixed-bars mode: a wall-clock stamp inside #chart-export
              changes every minute, so it alone would make two captures of an
              unchanged chart differ. This is the one dynamic element in the
              export, and it is why the parity gate needs a mode at all rather
              than just a fixture. */}
          <span>
            {fixedBars
              ? `parity fixture · ${fixedBars}`
              : `${new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/New_York', month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit',
              }).format(new Date())} ET`}
          </span>
          <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
