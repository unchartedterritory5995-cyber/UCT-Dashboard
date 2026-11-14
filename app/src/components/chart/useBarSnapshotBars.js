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
import { useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from 'react'
import { useBarSnapshot } from '../../data/barStore/useBarSnapshot'
import { getBarStore } from '../../data/barStore/index'
import { legacyBars, legacyDevelopingOf } from '../../data/barStore/adapter'
import { prefetch as storePrefetch, viewKeyFor } from '../../data/barStore/prefetch'
import { keyOf, STATUS, isDateTf, dateLabelToUnix } from '../../data/barStore/types'
import { isNativeTf, fetchTf, resampleSpec } from './timeframes'
import { resolveDailyTodaySeed, useCompareBars } from './useLegacyChartBars'
import { resample, resampleForSpec } from '../../utils/resampleBars'
import { dailyCachePaintVerdict, isDailyTodayBarStaleForPaint, expectedFormingBar } from '../../utils/marketSession'
import { createTailPollState, TAIL_CATCHUP_MAX_TRIES } from '../../utils/intradayTailPoll'
import { timingMark } from '../../utils/intradayTiming'
import { PREFETCH_WINDOWS, HISTORY_PREFETCH_TARGET_BARS } from '../../utils/historyPrepend'

const INTRADAY = new Set(['1', '5', '15', '30', '60'])
const PRIOR_SESSION_S = 8 * 3600
const PAINTS = new Set([STATUS.CONTEXT, STATUS.CURRENT, STATUS.UPDATING])

/** The store key a chart reads, or null when it reads none (override, economic, no symbol).
 *  The key itself is the facade's ONE view-key function (prefetch.viewKeyFor), so a handoff
 *  prepare for this pane (same showExtended) names exactly this key. */
export function chartKeyFor({ sym, resolvedTf, showExtended, replayCutoff, hasOverride }) {
  if (!sym || !resolvedTf || hasOverride) return null
  const custom = !isNativeTf(resolvedTf)
  // Replay: the window ENDING at the cutoff (`to=` its ET date; noon UTC is that ET date).
  const to = (replayCutoff && !custom) ? dateLabelToUnix(String(replayCutoff).slice(0, 10)) + 43200 : null
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
  _gridQ, instFetcher, _pinnedFull, _overlayActive, barCount, _intradayDeepArmed,
  _setIntradayDeepArmed, axisWidthRatchetRef, barsMutateRef, _timingIdRef, activeTfRef,
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
  const _resolveDailyTodaySeed = () => resolveDailyTodaySeed({ sym, resolvedTf, _developingBarISO, _effLivePrice, _liveSane })
  const _dailyTodaySeed = resolvedTf === 'D' ? _resolveDailyTodaySeed() : null
  const _dailyLocalRefused = resolvedTf === 'D' && _localOnly && !!all?.length && (
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

  let chosen = null
  if (_overrideArr) chosen = barsOverride
  else if (barsOverridePending || _econId) chosen = null
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
  const _answered = useSyncExternalStore(
    useCallback((cb) => (key ? store.network.subscribeAnswered(key, cb) : () => {}), [store, key]),
    () => (key ? store.network.answered(key) : false),
    () => false,
  )
  const _edgeProvisional = !!snap && (_localLayer ? !_localTailComplete
    : (chosen == null || (snap.restSeen && status !== STATUS.CURRENT && status !== STATUS.CONTEXT)))
  const _tfSwitchHold = isIntraday && !_isCustomTf && !_hasOverride && !replayCutoff
    && !!snap && !_answered && _edgeProvisional
    && !!_onScr && _onScr.sym === sym && _onScr.ext === showExtended && _onScr.tf !== resolvedTf
  tfSwitchHoldRef.current = _tfSwitchHold
  const bars = _tfSwitchHold ? null : chosen

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
  const mutate = useCallback(() => {
    if (key) { try { store.network.kick(key) } catch { /* not subscribed yet */ } }
    return Promise.resolve(undefined)
  }, [key, store])
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
  const _loadOlder = useCallback((background) => {
    const r = _histRef.current
    if (!r?.on || !r.key) return Promise.resolve(null)
    return store.scrollBack(r.key, { priority: background ? 'background' : 'urgent' }).then((res) => {
      if (!res || _histRef.current?.key !== r.key) return null
      const added = (res.added || 0) > 0
      return { ...res, added, exhausted: !!(res.empty || res.refused || (res.ok && !added)), retryAfterMs: null }
    }, () => null)
  }, [store])
  useEffect(() => {
    if (!_intradayDeepBackfillEnabled()) return undefined
    if (!isIntraday || !sym || _isCustomTf) return undefined
    if (_intradayDeepArmed) return undefined
    const id = setTimeout(() => _setIntradayDeepArmed(true), 900)
    return () => clearTimeout(id)
  }, [sym, resolvedTf, isIntraday, _isCustomTf, _intradayDeepArmed])  // eslint-disable-line react-hooks/exhaustive-deps
  const _histHasBase = !!snap && (snap.bars.length > 0 || !!snap.developing)
  useEffect(() => {
    if (!_histPrependOn || !_intradayDeepArmed || !_histHasBase || !key) return undefined
    // Grid cells (backgroundWarm=false) load windows only when SCROLLED (the 2026-05-24 herd).
    if (!backgroundWarm && !deepWarm) return undefined
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < PREFETCH_WINDOWS && !cancelled; i++) {
        if ((store.peek(key)?.depth || 0) >= HISTORY_PREFETCH_TARGET_BARS) break
        const res = await _loadOlder(true)
        if (!res || !res.added || res.exhausted) break
      }
    })()
    return () => { cancelled = true }
  }, [_histPrependOn, _intradayDeepArmed, _histHasBase, key, _loadOlder, backgroundWarm, deepWarm])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── background warm of the other timeframes: store prefetches at background rank ──
  useEffect(() => {
    if (!sym || !backgroundWarm || _hasOverride) return undefined
    const ORDER = breadthSeries ? ['D', 'W', 'M'] : ['D', '5', '60', '30', '15', 'W', 'M', '1']
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
    const id = setTimeout(() => {
      const keys = []
      for (const tf of ORDER) {
        if (tf === resolvedTf || tf === activeTfRef.current) continue
        try { keys.push(keyOf({ sym, tf, session: _session })) } catch { /* not a bars symbol */ }
      }
      storePrefetch(keys, { priority: 'background', warm: true, signal: ac?.signal ?? null })
    }, _intradaySmoothSwitchEnabled() ? 1600 : 600)
    return () => { clearTimeout(id); try { ac?.abort() } catch { /* ignore */ } }
  }, [sym, backgroundWarm])  // eslint-disable-line react-hooks/exhaustive-deps

  return {
    bars, data, error, mutate, isValidating, compareData, idbReadyForRef, idbBarsRef,
    dailyRepairTodayRef, paintSymRef, _tailCatchupRef, _lastTailStatusRef, _histMutateRef,
    _resolveDailyTodaySeed, _isCustomTf, _hasOverride, _customBaseIntraday, _intradayLike,
    _histPrependOn, _loadOlder, _symU, _idbBasisMismatch: false, _staleContext, _tfSwitchHold,
  }
}
