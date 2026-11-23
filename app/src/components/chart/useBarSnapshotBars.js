// ── BARSTORE CHART BARS (P3-S1, BARSTORE-SPEC.md "P3 slices") ─────────────────────
// The BarStore-backed twin of chart/useLegacyChartBars.js. StockChart picks ONE of the two at
// module load (chart/barStoreSwitch.js `BARSTORE`), so the hook order never changes; both take
// the SAME parameter object and return the SAME 24 bindings.
//
// ⭐ ONE SOURCE. Every bar comes from ONE snapshot (`useBarSnapshot(keyOf({sym, tf, session}))`):
// hydrate (mem → IDB), the network loop (≤ 1 request per key, the lane gate), the live feed and
// persistence are the store's (data/barStore). This hook never reads a cache, never builds a
// URL and never merges two bar sets — it only SELECTS what a snapshot may put on screen:
//
//   status        intraday frame                         live writers
//   empty         nothing (the skeleton)                 —
//   provisional   CONTEXT: the held history minus its    FROZEN (developing channel → null)
//                 last (cached-while-forming) candle
//   context       the snapshot (legacyBars)              live
//   current       the snapshot                           live
//   updating      the snapshot (badge: UPDATING)         live (frozen if the tail is > 8 h old)
//   unavailable   nothing; `data.no_data` (honest note)  —
//
//   D, local copy only (no server answer yet): painted only when the ONE daily paint authority
//   (`marketSession.dailyCachePaintVerdict`, savedAt = the record persist hydrated) says 'ok' —
//   the rule the legacy selector applied to its IDB / mem layers.
//
// The full legacy-selector → rule map (and what is intentionally dropped) is in the P3-S1 PR
// body and docs/architecture/barstore.md §P3-S1.
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, useSyncExternalStore } from 'react'
import { useBarSnapshot } from '../../data/barStore/useBarSnapshot'
import { useLatestCallback } from './latestCallback'
import { getBarStore } from '../../data/barStore/index'
import { legacyBars, legacyDevelopingOf, newestBarIsFormingOf } from '../../data/barStore/adapter'
import { prefetch as storePrefetch, viewKeyFor, LAKE_JOIN_WAIT_MS, deviceRefusalOf } from '../../data/barStore/prefetch'
import { keyOf, parseKey, STATUS, isDateTf, dateLabelToUnix } from '../../data/barStore/types'
import { isNativeTf, fetchTf, resampleSpec } from './timeframes'
import { resolveDailyTodaySeed, useCompareBars } from './useLegacyChartBars'
import { resample, resampleForSpec } from '../../utils/resampleBars'
import { dailyCachePaintVerdict, isDailyTodayBarStaleForPaint, expectedFormingBar } from '../../utils/marketSession'
import { createTailPollState, TAIL_CATCHUP_MAX_TRIES } from '../../utils/intradayTailPoll'
import { timingMark } from '../../utils/intradayTiming'
import { PREFETCH_WINDOWS, prefetchTargetBars } from '../../utils/historyPrepend'

/** How long a member rests on a symbol (after the background warm starts) before its other intraday
 *  timeframes' lake depth loads: a scan past a row never pays for it. */
export const LAKE_WARM_DWELL_MS = 2500

const INTRADAY = new Set(['1', '5', '15', '30', '60'])
const PRIOR_SESSION_S = 8 * 3600
const PAINTS = new Set([STATUS.CONTEXT, STATUS.CURRENT, STATUS.UPDATING])
/** How long a chart must rest on (symbol, timeframe) before its older history starts loading. */
export const DEEP_ARM_MS = 250
/** How often one older-history window is asked again after an error / a `filling` answer. */
export const DEEP_RETRIES = 3

/** The store key a chart reads, or null when it reads none (override, economic, no symbol).
 *  The key itself is the facade's ONE view-key function (prefetch.viewKeyFor), so a handoff
 *  prepare for this pane (same showExtended) names exactly this key. */
export function chartKeyFor({ sym, resolvedTf, showExtended, replayCutoff, hasOverride }) {
  if (!sym || !resolvedTf || hasOverride) return null
  const custom = !isNativeTf(resolvedTf)
  // Replay, INTRADAY: the window ENDING at the cutoff (`to=` its ET date; noon UTC is that ET date) —
  // an intraday set ending today holds only recent sessions, so an old cutoff needs its own window.
  // ⭐ D/W/M READ THE PLAIN KEY (2026-11-20). Its full-depth set already holds every bar up to any
  // cutoff, and StockChart cuts every bar after `replayCutoff`. The windowed key was a SECOND copy
  // of the same bars that no list warm held: each Breadth drill flip in replay waited on its own
  // 12,500-bar `to=` request (~1 s on production), and a Grid of them asked ~15 at once, which
  // stalled the web server for 6-12 s (measured on production). Replay now scans exactly like
  // the plain view.
  const to = (replayCutoff && !custom && !isDateTf(resolvedTf))
    ? dateLabelToUnix(String(replayCutoff).slice(0, 10)) + 43200 : null
  return viewKeyFor(sym, resolvedTf, { showExtended: !!showExtended, window: Number.isFinite(to) ? { to } : null })
}

/**
 * THE developing bar a view paints (P3-S2): snapshot.developing in the legacy shape `{t,o,h,l,c,v}`
 * plus its `devRev`, or null (no server answer yet / nothing forming / the view is frozen).
 * A CUSTOM timeframe gets its own forming bucket: the native developing bar folded with the
 * native rows of the same custom bucket (`resampleForSpec`, the base path's own resampler; its
 * bucket key is ≤ every member's `t`, so the members are the base's tail from that key on).
 * @param {object|null} s      the snapshot carrying the developing bar
 * @param {object|null} base   the base snapshot of the same key (its rows: the legacyBars memo)
 * @param {{frozen?: boolean, spec?: object|null}} [view]
 */
export function viewDevelopingOf(s, base, view = {}) {
  if (!s?.restSeen || view?.frozen) return null
  const d = legacyDevelopingOf(s)
  if (!d) return null
  if (!view?.spec) return { ...d, devRev: s.devRev }
  const k = resampleForSpec([d], view.spec)?.[0]?.t
  if (k == null) return null
  const rows = base ? legacyBars(base) : []
  const before = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a < b : String(a) < String(b))
  let i = rows.length
  while (i > 0 && !before(rows[i - 1].t, k)) i--
  const members = rows.slice(i).filter((r) => before(r.t, d.t))
  const out = resampleForSpec([...members, d], view.spec)
  const last = out?.length ? out[out.length - 1] : null
  return last ? { t: last.t, o: last.o, h: last.h, l: last.l, c: last.c, v: last.v, devRev: s.devRev } : null
}

/** Daily value sanity of a LOCAL copy's last bar (the legacy `_idbDailyLastInsane`). */
function lastDailyBarInsane(arr) {
  const b = arr?.length ? arr[arr.length - 1] : null
  if (!b) return false
  const o = +b.o, h = +b.h, l = +b.l, c = +b.c
  if (![o, h, l, c].every(Number.isFinite) || o <= 0 || h <= 0 || l <= 0 || c <= 0) return true
  if (h < Math.max(o, c) - 1e-9 || l > Math.min(o, c) + 1e-9) return true
  return Math.abs(o - c) / c > 0.5
}

export function useBarSnapshotBars({
  sym, resolvedTf, _barsTf, _econId, showExtended, isIntraday, breadthSeries, replayCutoff,
  compareSymbol, backgroundWarm, deepWarm, barsOverride, barsOverridePending, _liveSane,
  // (`_intradayDeepArmed` / `_setIntradayDeepArmed` are the legacy source's; this one arms by deadline, below)
  _gridQ, instFetcher, _pinnedFull, _overlayActive, barCount,
  axisWidthRatchetRef, barsMutateRef, _timingIdRef, activeTfRef,
  _onScreenSrcRef, tfSwitchHoldRef, _developingBarISO, _effLivePrice,
  _intradayDeepBackfillEnabled, _intradaySmoothSwitchEnabled,
  // P3-S1 review fix 1 — the developing bar's OWN channel (StockChart's refs; the legacy hook
  // ignores them): `_storeDevRef` holds the newest developing bar (legacy shape), and
  // `_storeDevPaintRef.current()` paints it with series.update() (Writer D's re-top).
  _storeDevRef, _storeDevPaintRef,
}) {
  const store = getBarStore()
  const _symU = sym ? sym.toUpperCase() : ''
  const _isCustomTf = !!sym && !isNativeTf(resolvedTf)
  const _customBaseTf = _isCustomTf ? fetchTf(resolvedTf) : null
  const _customSpec = useMemo(() => (_isCustomTf ? resampleSpec(resolvedTf) : null), [_isCustomTf, resolvedTf])
  const _customBaseIntraday = INTRADAY.has(String(_customBaseTf))
  const _intradayLike = isIntraday || (_isCustomTf && _customBaseIntraday)
  const _overrideArr = Array.isArray(barsOverride) && barsOverride.length > 0
  const _hasOverride = _overrideArr || barsOverridePending || _econId
  const _session = showExtended ? 'eth' : 'rth'

  // ── THE ONE SUBSCRIPTION ──────────────────────────────────────────────────────
  const key = chartKeyFor({ sym, resolvedTf, showExtended, replayCutoff, hasOverride: _hasOverride })
  // The first request's depth is the depth wanted when the key was first read; a deeper ask
  // later (a daily pan, Origin) is an `ensure` below — never a re-subscription, which would
  // restart the key's whole life cycle.
  const _wantDepth = _isCustomTf ? (_customBaseIntraday ? 5000 : 6000) : barCount
  const _subDepth = useMemo(() => _wantDepth, [key])  // eslint-disable-line react-hooks/exhaustive-deps
  // ⭐ THE BASE SNAPSHOT (wake 'base', the registry's split notify): this hook — and so the whole
  // StockChart render, legacyBars' O(n) copy, the custom-tf resample, setData of candles /
  // volume / indicators — runs on BASE changes only (closed rows, seal, identity, status). A
  // push frame / tick that moves only the developing bar (devRev) never re-renders the chart;
  // it is painted by the developing-bar channel below with series.update().
  const snap = useBarSnapshot(key, { depth: _subDepth, session: _session, priority: 'visible', store, wake: 'base' })
  useEffect(() => {
    if (!key || isIntraday || !snap?.restSeen) return
    if (_wantDepth > (snap.depth || 0) && snap.status !== STATUS.UNAVAILABLE) {
      store.ensure(key, { depth: _wantDepth, priority: 'visible', session: _session })
    }
  }, [key, _wantDepth, snap?.restSeen])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── what the snapshot holds, legacy shape (sealed + developing; adapter.legacyBars) ──
  const all = snap ? legacyBars(snap) : null
  const _localOnly = !!snap && !snap.restSeen
  const status = snap?.status ?? STATUS.EMPTY
  const savedAt = key ? (store.persist?.savedAtOf?.(key) ?? null) : null
  const tailT = all?.length ? all[all.length - 1].t : null

  // ── the daily paint authority for a LOCAL copy ───────────────────────────────
  // ⛔ (2026-11-20) STABLE, as are `mutate` below: StockChart's closures hold what this hook returns, and a
  // function made in this render points at this render's context, which holds `snap` (and through it the
  // store's bars and the legacy copy). Every old StockChart render a closure chain kept alive reached its
  // own old snapshot this way (StockChart.closureChains.test.jsx). One function for the hook's life, calling
  // the newest implementation, reaches only the current render.
  const _resolveDailyTodaySeed = useLatestCallback(() => resolveDailyTodaySeed({ sym, resolvedTf, _developingBarISO, _effLivePrice, _liveSane }))
  const _dailyTodaySeed = resolvedTf === 'D' ? _resolveDailyTodaySeed() : null
  // ⭐ REPLAY ON A PAST DAY NEEDS NO CURRENT TAIL (2026-11-20). The verdict below asks "is this
  // copy's right edge current?", which during a session a copy from the last close never is — so
  // a replay chart waited on its own request for bars it would cut off anyway (StockChart hides
  // every bar after `replayCutoff`). A copy that reaches the cutoff day holds everything shown.
  const _replayCovered = !!replayCutoff && typeof tailT === 'string'
    && tailT.slice(0, 10) >= String(replayCutoff).slice(0, 10)
  const _dailyLocalRefused = resolvedTf === 'D' && _localOnly && !!all?.length && !_replayCovered && (
    dailyCachePaintVerdict(tailT, savedAt, { hasSeed: !!_dailyTodaySeed, breadth: !!breadthSeries }) !== 'ok'
    || lastDailyBarInsane(all))

  // ── stale-but-sound history: CONTEXT, minus its last (cached-while-forming) candle ──
  const _staleSrc = (isIntraday && !_isCustomTf && status === STATUS.PROVISIONAL && all?.length) ? all : null
  const _staleContext = useMemo(
    () => (_staleSrc ? (_staleSrc.length > 1 ? _staleSrc.slice(0, -1) : _staleSrc) : null),
    [_staleSrc],
  )
  // ── custom timeframe: a memoized resample of the NATIVE base key (Writer F's input) ──
  const _customBars = useMemo(
    () => ((_isCustomTf && all?.length && status !== STATUS.PROVISIONAL) ? resampleForSpec(all, _customSpec) : null),
    [_isCustomTf, all, status, _customSpec],
  )
  // ── W/M while its own key is empty: the same-frame resample of the held DAILY snapshot ──
  const _dSnap = (!_hasOverride && (resolvedTf === 'W' || resolvedTf === 'M') && sym && !all?.length)
    ? store.peek(keyOf({ sym, tf: 'D' })) : null
  const _aggBars = useMemo(() => {
    const d = _dSnap ? legacyBars(_dSnap) : null
    return d?.length ? resample(d, 'D', resolvedTf) : null
  }, [_dSnap, resolvedTf])
  // ⛔ THE DEVICE'S ONE REFUSAL HERE TOO (review of #2554, P3-M2). A chart's FIRST MOUNT (a new widget, a grid cell, the
  // phone workspace) and a same-symbol timeframe change are decided here, not at the switch's doors, and here the status
  // alone let a device copy paint that the switch refuses: short of its current bucket (a rolled bucket, a 1m copy
  // missing the minute that just closed), an extended view of a shared key (no pre-market bars in it), a stale copy. A
  // refused copy is not chosen: a first mount shows the loading state it shows with no local copy, and a timeframe
  // change holds the previous timeframe until the new key is answered (`_edgeProvisional`). A chart that has already
  // SHOWN this key's device copy in this view is never blanked by it: the answer replaces it. D / W / M keep the daily
  // paint authority above (a device D copy holds official rows only). `deviceRows` is set only by a device copy: with the
  // store off the first test is false and nothing below it runs.
  const _devicePaintedRef = useRef(null)
  const _deviceView = snap?.deviceRows === true && key ? `${key}|${showExtended ? 'eth' : 'rth'}` : null
  const _deviceRefused = snap?.deviceRows === true && _intradayLike && !_hasOverride && !replayCutoff
    && _devicePaintedRef.current !== _deviceView
    // eslint-disable-next-line react-hooks/purity
    && !!deviceRefusalOf(snap, { extended: !!showExtended, through: store.persist?.deviceThroughOf?.(key) ?? null, nowMs: Date.now() })
  let chosen = null
  if (_overrideArr) chosen = barsOverride
  else if (barsOverridePending || _econId) chosen = null
  else if (_deviceRefused) chosen = null
  else if (_isCustomTf) chosen = _customBars
  else if (all?.length) {
    if (isDateTf(resolvedTf)) chosen = _dailyLocalRefused ? null : all
    else if (status === STATUS.PROVISIONAL) chosen = _staleContext
    else if (PAINTS.has(status)) chosen = all
  } else if (_aggBars?.length) chosen = _aggBars

  // ── the timeframe-switch hold (TC2000 rule): never a provably incomplete right edge ──
  const _onScr = _onScreenSrcRef.current
  const _localLayer = !!chosen && isIntraday && !_isCustomTf && !_hasOverride && !replayCutoff && _localOnly
  const _localTailComplete = (() => {
    if (!_localLayer) return true
    // Wall-clock read in render ON PURPOSE: "is the forming bucket in this copy" is a question
    // about now (the legacy selector asked it the same way); the status tick re-renders it.
    // eslint-disable-next-line react-hooks/purity
    const forming = expectedFormingBar(resolvedTf, Date.now(), { session: showExtended ? 'extended' : 'rth' })
    if (forming == null) return true
    const lt = chosen[chosen.length - 1]?.t
    if (typeof lt !== 'number' || lt < forming) return false
    return Number.isFinite(savedAt) && savedAt / 1000 >= forming
  })()
  // ⭐ "THE SERVER HAS SPOKEN" MEANS IN THIS LIFE OF THE KEY (network.answered), never merely
  // "the snapshot holds a server answer / an error". An entry outlives its subscribers (registry
  // LRU): a key warmed (or whose warm was shed → `error`) yesterday or an hour ago still carries
  // that answer, frozen — no live feed, no poll kept it. 2026-11-13 NVDA 5m → 1m: such a snapshot
  // ended the hold at once and painted a PRIOR-SESSION right edge (legend "NOV 12 15:18") until
  // the chart's own request answered. So the hold ends only on this life's answer, or on a right
  // edge the store itself calls current (status context | current — and a local copy only when its
  // forming bucket is in it, `_localTailComplete`).
  const _isTfSwitch = isIntraday && !_isCustomTf && !_hasOverride && !replayCutoff
    && !!_onScr && _onScr.sym === sym && _onScr.ext === showExtended && _onScr.tf !== resolvedTf
  // ⭐ (2026-11-20) …READ AT EVERY RENDER, SUBSCRIBED ONLY WHILE A TIMEFRAME SWITCH CAN HOLD ON IT. `_answered` decides
  // nothing else (`_tfSwitchHold` below), yet its subscription re-rendered the whole chart when the new key's first
  // answer landed on EVERY symbol switch, a render that changed nothing on screen (`StockChart.switchStateRenders.test`).
  // Off a timeframe switch the hook reads the store's value as it renders and is not woken by it.
  const _answered = useSyncExternalStore(
    useCallback((cb) => (key && _isTfSwitch ? store.network.subscribeAnswered(key, cb) : () => {}), [store, key, _isTfSwitch]),
    () => (key ? store.network.answered(key) : false),
    () => false,
  )
  const _edgeProvisional = !!snap && (_localLayer ? !_localTailComplete
    : (chosen == null || (snap.restSeen && status !== STATUS.CURRENT && status !== STATUS.CONTEXT)))
  // ⭐ ONE PAINT ON A TIMEFRAME SWITCH TOO (2026-11-18). The symbol handoff already waits (bounded)
  // for the lake's whole depth before it commits (#1774, prefetch LAKE_JOIN_WAIT_MS); a timeframe
  // button did not, so 1h/30m/5m painted the server's few hundred bars and then grew in steps for
  // ~1-1.8 s (measured on production: 1h AAPL 475 -> 3,884 -> 6,950 -> 10,261 bars). While the lake's
  // depth is still due for the new key (store.lakePending: in flight or never asked), the previous
  // timeframe stays on screen for at most LAKE_JOIN_WAIT_MS from the switch; then whatever is held
  // paints. A key the lake does not carry, or one already deep, never waits.
  const _lakeSwitchRef = useRef({ key: null, t0: 0 })
  if (!_isTfSwitch) {
    // a later switch to the same key is a new switch with its own bound (review of #1795)
    if (_lakeSwitchRef.current.key !== null) _lakeSwitchRef.current = { key: null, t0: 0, done: false }
  } else if (_lakeSwitchRef.current.key !== key) {
    // eslint-disable-next-line react-hooks/purity
    _lakeSwitchRef.current = { key, t0: Date.now(), done: false }
  }
  const [, _setLakeTick] = useState(0)
  const _lakeDue = _isTfSwitch && !!key && _lakeSwitchRef.current.key === key
    && !_lakeSwitchRef.current.done && !!store.lakePending?.(key)
  // eslint-disable-next-line react-hooks/purity
  const _lakeAge = Date.now() - _lakeSwitchRef.current.t0
  // a clock that stepped backwards reads as expired, and the timer below ends the hold whatever the
  // clock says, so the bound holds on any clock (review of #1795)
  const _lakeHold = _lakeDue && _lakeAge >= 0 && _lakeAge < LAKE_JOIN_WAIT_MS
  useEffect(() => {
    if (!_lakeHold) return undefined
    let alive = true
    const wake = () => { if (alive) _setLakeTick((n) => n + 1) }
    const left = Math.max(0, LAKE_JOIN_WAIT_MS - (Date.now() - _lakeSwitchRef.current.t0))
    const sw = _lakeSwitchRef.current
    const id = setTimeout(() => { sw.done = true; wake() }, left + 1)
    Promise.resolve().then(() => store.lakeSeed?.(key)).catch(() => {}).then(wake)
    return () => { alive = false; clearTimeout(id) }
  }, [_lakeHold, key, store])
  const _tfSwitchHold = _isTfSwitch && !!snap && ((!_answered && _edgeProvisional) || _lakeHold)
  tfSwitchHoldRef.current = _tfSwitchHold
  const bars = _tfSwitchHold ? null : chosen
  // (what this chart has SHOWN of a device copy, per key and view: see `_deviceRefused`). ⛔ Written after the commit, never
  // during the render (review of #2558, P4-L1): a render React throws away (a transition something else suspends, an
  // interrupted render) would otherwise mark a view as shown that never was, and the next render, possibly after the bucket
  // ended, would paint a copy the rule refuses.
  const _shownDeviceView = bars?.length && snap?.deviceRows === true ? _deviceView : null
  useLayoutEffect(() => { if (_shownDeviceView) _devicePaintedRef.current = _shownDeviceView }, [_shownDeviceView])

  // ── `data` / `error`: the server's answer as the legacy SWR surfaced it ─────────
  const data = useMemo(() => {
    if (!snap) return undefined
    if (snap.error === 'no_data' && !snap.bars.length && !snap.developing) {
      return { ticker: snap.sym, tf: snap.tf, bars: [], no_data: true }
    }
    if (!snap.restSeen) return undefined
    const rows = legacyBars(snap)
    const dev = snap.developing ? rows[rows.length - 1] : null
    return {
      ticker: snap.sym, tf: snap.tf, bars: rows, delta: false,
      session: _session, grid: snap.grid ?? null, cache_key: snap.cacheKey ?? null,
      tail_status: snap.tailStatus ?? null,
      verified_through: snap.verifiedThrough ?? null,
      complete_through: snap.completeThrough ?? null,
      // THE developing bar (store-merged: server developing + push frames + tick fallback).
      // Writer D re-tops from exactly this (StockChart updateChart, BARSTORE branch).
      developing: dev ? { t: dev.t, o: dev.o, h: dev.h, l: dev.l, c: dev.c, v: dev.v } : null,
      // ⭐⭐ (2026-11-18) the route's tri-state for the newest row, as the legacy source hands it (StockChart reads
      // `data.newest_bar_is_forming` into every run's context); null = unknown. ⚰️ Absent here, every chart on
      // this source told its strategies "unknown" at every hour, so a closed newest bar was read as forming.
      newest_bar_is_forming: newestBarIsFormingOf(snap),
    }
  }, [snap])  // eslint-disable-line react-hooks/exhaustive-deps
  const error = useMemo(() => {
    const e = snap?.error
    if (!e || e === 'no_data') return undefined
    const err = new Error(String(e))
    err.warming = e === 'warming'
    err.status = /^\d{3}$/.test(String(e)) ? Number(e) : null
    return err
  }, [snap?.error])

  // ── mutate / isValidating: the store's own loop ────────────────────────────────
  // A revalidate is a KICK of the key's single slot (≤ 1 request per key). A payload handed in
  // (the frozen-chart watchdog's own full fetch) is NOT merged here: the store's next answer
  // is the one merge path (reducer), so the kick is what heals it.
  const mutate = useLatestCallback(() => {
    if (key) { try { store.network.kick(key) } catch { /* not subscribed yet */ } }
    return Promise.resolve(undefined)
  })
  barsMutateRef.current = mutate
  const isValidating = key ? store.network.inflight(key) > 0 : false
  const _histMutateRef = useRef(null)
  _histMutateRef.current = mutate

  // ── compare: the same SWR hook the legacy source uses (P3-S3 moves it to a store key) ──
  const compareData = useCompareBars({ compareSymbol, resolvedTf, barCount, _gridQ, instFetcher })

  // ── refs the chart reads ───────────────────────────────────────────────────────
  const idbReadyForRef = useRef(null)
  const idbBarsRef = useRef(null)
  idbReadyForRef.current = all?.length ? key : null
  idbBarsRef.current = all?.length ? all : null
  const dailyRepairTodayRef = useRef(false)
  dailyRepairTodayRef.current = resolvedTf === 'D' && !!bars && bars === all && _localOnly
    && isDailyTodayBarStaleForPaint(tailT, savedAt)
  const paintSymRef = useRef(null)
  // ⭐ DELAYED = THE STORE'S CATCH-UP BUDGET SPENT. The store owns the budget (network.js
  // nextTailPollMs, per key); `network.tailExhausted` exposes "spent" and a flip re-renders this
  // hook. It is mapped onto the legacy state the badge reads (`tailRetriesExhausted(state,
  // <the chart's series key>)`) — the badge's rule is unchanged, only its input is the store's.
  // The state carries THE store key (keyOf: the same `${SYM}_${cacheTf}` string the chart's
  // idbReadyForRef carries and StockChart compares against) — never a second key builder.
  const _tailSpent = useSyncExternalStore(
    useCallback((cb) => (key ? store.network.subscribeTailBudget(key, cb) : () => {}), [store, key]),
    () => (key ? store.network.tailExhausted(key) : false),
    () => false,
  )
  const _tailCatchupRef = useRef(null)
  if (_tailCatchupRef.current == null) _tailCatchupRef.current = createTailPollState()
  _tailCatchupRef.current.key = key ?? ''
  _tailCatchupRef.current.tries = _tailSpent ? TAIL_CATCHUP_MAX_TRIES : 0
  const _lastTailStatusRef = useRef(null)

  // ── THE DEVELOPING-BAR CHANNEL (devRev) ────────────────────────────────────────
  // The newest developing bar of THIS key, never older than the one the base snapshot holds:
  // a render takes the base's when it is at least as new (devRev), the channel takes every
  // later one — coalesced by the registry to one call per animation frame — and paints it at
  // once through `_storeDevPaintRef` (series.update). It paints only onto the base it belongs
  // to (same baseRev): a base change re-renders, setData()s and re-tops from this ref anyway.
  // ⛔ THE LIVE FREEZE, FROM THE SNAPSHOT: CONTEXT (status provisional) is on screen, or the tail
  // on screen is from a PRIOR session (> 8 h) — no developing bar is painted onto it. P3-S2: the
  // freeze is the developing channel yielding NULL (the store paint then paints nothing); the
  // legacy `provisionalStaleRef` belongs to the legacy writers and is not written here.
  const _barsTailT = (Array.isArray(bars) && bars.length && typeof bars[bars.length - 1]?.t === 'number')
    ? bars[bars.length - 1].t : null
  // eslint-disable-next-line react-hooks/purity -- the tail's age is a wall-clock question (as legacy)
  const _devFrozen = isIntraday && ((_barsTailT != null && (Date.now() / 1000 - _barsTailT) > PRIOR_SESSION_S)
    || (!!bars && bars === _staleContext))
  // What the channel callback needs from this render (the view's freeze and custom spec).
  const _devViewRef = useRef(null)
  _devViewRef.current = { frozen: _devFrozen, spec: _isCustomTf ? _customSpec : null }

  const _devHeldRef = useRef({ key: null, devRev: -1 })
  const _baseSnapRef = useRef(null)
  _baseSnapRef.current = snap
  if (_storeDevRef) {
    // Review fix (a): the base snapshot's developing bar can be OLDER than the store's newest for
    // the same base — a dev flush that arrived while this render's base was still pending was
    // dropped by the channel (baseRev mismatch). So the render takes the store's CURRENT snapshot
    // whenever it belongs to the same base (same baseRev), else the base's own.
    const live = key ? store.getSnapshot(key) : null
    const src = (live && snap && live.key === snap.key && live.baseRev === snap.baseRev && live.devRev >= snap.devRev) ? live : snap
    const h = _devHeldRef.current
    if (h.key !== key || !src || src.devRev >= h.devRev) {
      _devHeldRef.current = { key, devRev: src?.devRev ?? -1 }
      _storeDevRef.current = viewDevelopingOf(src, snap, _devViewRef.current)
    }
  }
  const _heldDevRev = _devHeldRef.current.devRev
  useEffect(() => {
    if (!key || !_storeDevRef) return undefined
    return store.subscribeDeveloping(key, (s) => {
      const base = _baseSnapRef.current
      // A flush for a base this hook has not rendered yet is left to that render (fix (a) above).
      if (!base || base.key !== key || s.key !== key || s.baseRev !== base.baseRev || !s.restSeen) return
      const h = _devHeldRef.current
      if (h.key === key && s.devRev <= h.devRev) return
      _devHeldRef.current = { key, devRev: s.devRev }
      _storeDevRef.current = viewDevelopingOf(s, base, _devViewRef.current)
      try { _storeDevPaintRef?.current?.() } catch { /* a paint failure never breaks the feed */ }
    })
  }, [key, store])  // eslint-disable-line react-hooks/exhaustive-deps
  // A render that advanced the developing bar (fix (a)) paints it, even when no setData follows
  // (the paint refuses a stale / foreign series and an older frame by itself).
  useEffect(() => {
    if (!_storeDevRef || !key) return
    try { _storeDevPaintRef?.current?.() } catch { /* a paint failure never breaks the render */ }
  }, [key, _heldDevRev, _devFrozen])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── per-key housekeeping ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!sym || !resolvedTf) return
    axisWidthRatchetRef.current = 0   // new sym/tf → let the axis column re-fit once
  }, [sym, resolvedTf, _barsTf, _econId])  // eslint-disable-line react-hooks/exhaustive-deps
  // T1 (history from the server) / T3 (the tail reached the market), once per timing id.
  const _marksRef = useRef({ t1: null, t3: null })
  useEffect(() => {
    const id = _timingIdRef.current
    if (!id || !snap?.restSeen) return
    const tail = all?.length ? all[all.length - 1].t : null
    if (_marksRef.current.t1 !== id) {
      _marksRef.current.t1 = id
      timingMark(id, 'T1', { historyEnd: tail, cache: snap.source === 'rest' ? 'store' : 'client-warm' })
    }
    if (_marksRef.current.t3 !== id && (snap.status === STATUS.CURRENT || snap.status === STATUS.CONTEXT)) {
      _marksRef.current.t3 = id
      timingMark(id, 'T3', { tailEnd: tail })
    }
  }, [snap])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── intraday deep history: LEFT windows through the store's scroll-back ─────────
  const _histPrependOn = isIntraday && !_isCustomTf && _intradayDeepBackfillEnabled()
    && !_hasOverride && !replayCutoff && !_pinnedFull && !_overlayActive && !!sym
  const _histRef = useRef(null)
  _histRef.current = { on: _histPrependOn, key }
  // `dwell`: a window for the chart the member is RESTING on (the armed loop below). It goes at
  // `grid` rank: ahead of every list warm, and never behind the bars-pack ingest hold that
  // `background` waits on (a fresh profile ingests for a minute or more, and the chart on screen
  // stayed shallow all that time). A scroll-driven window stays `urgent`.
  const _loadOlder = useCallback((background, { dwell = false, bars } = {}) => {
    const r = _histRef.current
    if (!r?.on || !r.key) return Promise.resolve(null)
    const priority = dwell ? 'grid' : (background ? 'background' : 'urgent')
    return store.scrollBack(r.key, { priority, ...(bars ? { bars } : {}) }).then((res) => {
      if (!res || _histRef.current?.key !== r.key) return null
      const added = (res.added || 0) > 0
      // A `filling` answer is the server still fetching that window: not exhausted, ask again.
      const filling = !!res.filling
      return {
        ...res, added, filling,
        exhausted: !filling && !!(res.empty || res.refused || (res.ok && !added)),
        retryAfterMs: filling ? (res.retryAfterMs || 3000) : (res.retryAfterMs ?? null),
      }
    }, () => null)
  }, [store])
  // ⭐ 250 ms (was 900): the wait exists so a held key or a fast scan never starts a window per
  // row. A held key steps every ~40 ms and a deliberate tap-scan every ~700 ms; 250 ms still
  // skips the first and lets the chart a member stops on fill 650 ms sooner.
  // ⭐⭐ (2026-11-20) THE WAIT IS A DEADLINE, NOT A STATE. It was `_intradayDeepArmed`, StockChart state flipped true
  // 250 ms after each intraday switch (and back to false at the next one, in StockChart's render): two renders of the
  // whole chart per switch whose only consumer is the effect below. The deadline is noted when the symbol or the
  // timeframe changes, and the effect waits out what is left of it; leaving the row first cancels the wait (the
  // effect's cleanup), as clearing the timer did. (The legacy source still arms through the state.)
  const _deepArmRef = useRef({ k: null, at: 0 })
  useEffect(() => {
    _deepArmRef.current = { k: `${sym}|${resolvedTf}`, at: Date.now() + DEEP_ARM_MS }
  }, [sym, resolvedTf])
  const _histHasBase = !!snap && (snap.bars.length > 0 || !!snap.developing)
  useEffect(() => {
    if (!_intradayDeepBackfillEnabled()) return undefined
    if (!isIntraday || !sym || _isCustomTf) return undefined
    if (!_histPrependOn || !_histHasBase || !key) return undefined
    // Grid cells (backgroundWarm=false) load windows only when SCROLLED (the 2026-05-24 herd).
    if (!backgroundWarm && !deepWarm) return undefined
    let cancelled = false
    let waitId = null
    const wait = (ms) => new Promise((resolve) => { waitId = setTimeout(resolve, ms) })
    const arm = _deepArmRef.current
    const armLeft = arm.k === `${sym}|${resolvedTf}` ? Math.max(0, arm.at - Date.now()) : DEEP_ARM_MS
    ;(async () => {
      if (armLeft > 0) await wait(armLeft)
      if (cancelled) return
      let tries = 0
      for (let i = 0; i < PREFETCH_WINDOWS && !cancelled;) {
        // deeper where the lake carries the key (historyPrepend.prefetchTargetBars)
        if ((store.peek(key)?.depth || 0) >= prefetchTargetBars(!!store.lakeCarries?.(key), parseKey(key)?.tf)) break
        const res = await _loadOlder(true, { dwell: true })
        if (cancelled) break
        // A failed or still-filling window is asked again (at most DEEP_RETRIES times per
        // window, the legacy loader's count), never taken as "this symbol has no more history".
        if (!res || res.error || res.filling) {
          if (++tries > DEEP_RETRIES) break
          await wait(Math.min(Math.max(res?.retryAfterMs || 1500, 500), 5000))
          if (res?.added) { i++; tries = 0 }   // a filling window that DID add rows counts
          continue
        }
        if (!res.added || res.exhausted) break
        i++; tries = 0
      }
    })()
    return () => { cancelled = true; if (waitId != null) clearTimeout(waitId) }
  }, [_histPrependOn, _histHasBase, key, _loadOlder, backgroundWarm, deepWarm, sym, resolvedTf, isIntraday, _isCustomTf])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── background warm of the other timeframes: store prefetches at background rank ──
  useEffect(() => {
    if (!sym || !backgroundWarm || _hasOverride) return undefined
    const ORDER = breadthSeries ? ['D', 'W', 'M'] : ['D', '5', '60', '30', '15', 'W', 'M', '1']
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
    let left = false
    let lakeId = null
    const id = setTimeout(() => {
      const keys = []
      for (const tf of ORDER) {
        if (tf === resolvedTf || tf === activeTfRef.current) continue
        try { keys.push(keyOf({ sym, tf, session: _session })) } catch { /* not a bars symbol */ }
      }
      storePrefetch(keys, { priority: 'background', warm: true, signal: ac?.signal ?? null })
      // ⭐ ...and the lake's whole depth for the intraday ones a member flips to (2026-11-18), so a
      // later timeframe click finds it held and paints at once (the hold above never waits). Only on a
      // symbol the member STAYS on (a scan never pays ~100k rows a row), one key at a time, stopping
      // when the member leaves (review of #1795: a scan stacked loads for symbols already left).
      // network.lakeSeed skips a key already deep; the pieces come from the HTTP cache after the first time.
      const lakeKeys = (isIntraday ? keys : []).filter((k) => {   // a member on daily is not flipping intraday
        const tf = parseKey(k)?.tf
        try { return (tf === '5' || tf === '30' || tf === '60') && !!store.lakeCarries?.(k) } catch { return false }
      })
      if (!lakeKeys.length) return
      lakeId = setTimeout(async () => {
        for (const k of lakeKeys) {
          if (left) return
          try { await store.lakeSeed?.(k) } catch { /* a warm only */ }
        }
      }, LAKE_WARM_DWELL_MS)
    }, _intradaySmoothSwitchEnabled() ? 1600 : 600)
    return () => {
      left = true; clearTimeout(id); if (lakeId != null) clearTimeout(lakeId)
      try { ac?.abort() } catch { /* ignore */ }
    }
  }, [sym, backgroundWarm])  // eslint-disable-line react-hooks/exhaustive-deps

  return {
    bars, data, error, mutate, isValidating, compareData, idbReadyForRef, idbBarsRef,
    dailyRepairTodayRef, paintSymRef, _tailCatchupRef, _lastTailStatusRef, _histMutateRef,
    _resolveDailyTodaySeed, _isCustomTf, _hasOverride, _customBaseIntraday, _intradayLike,
    _histPrependOn, _loadOlder, _symU, _idbBasisMismatch: false, _staleContext, _tfSwitchHold,
  }
}
