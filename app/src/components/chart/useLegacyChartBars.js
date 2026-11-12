// ── LEGACY CHART BARS (P3-S0, 2026-11-11) ──────────────────────────────────────
// StockChart's bar DATA region, moved here VERBATIM (pure move, zero behaviour change):
// the IndexedDB layer (idbBars state + load effect), the intraday tail fetcher, the bars /
// history / custom-base / compare SWRs, the merge + persist effects, the left-prepend history
// wiring and the `bars` selector. StockChart calls this hook at exactly the point the region
// used to begin, so React's hook order is unchanged.
// ⛔ Every input is a closure value StockChart owned; refs are passed BY OBJECT (never copied),
// and StockChart module helpers arrive as parameters (no circular import). The only module
// state moved with the region is the IDB first-paint timeout pair + `_browserHasCachedBars`,
// which nothing outside this region reads or writes.
// P3-S1 swaps this for the BarStore snapshot behind the BARSTORE switch (BARSTORE-SPEC.md).
// The React-Compiler lint rules below never analysed this code inside StockChart (that component
// is past the compiler's bail-out), so moving it verbatim surfaces findings that are not new.
/* eslint-disable react-hooks/purity, react-hooks/immutability */
import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import useSWR, { useSWRConfig, unstable_serialize } from 'swr'
import { fromChartTime, seriesCacheTf, barsSessionQuery, sixtyMinGridFor, isRthBar } from './barTime'
import { composeDevelopingTail } from './developingTail'
import { isNativeTf, fetchTf, resampleSpec } from './timeframes'
import { getTodayBar, todayPackUsable } from '../../lib/todayPackClient'
import { getExtSessionCached } from '../../utils/extSession'
import { getSnapshot as getLivePriceStoreSnapshot } from '../../hooks/livePriceStore'
import { _packStillIngesting, joinPendingBars } from '../../utils/prefetchBars'
import { isCompleteOhlc } from '../../lib/liveBarMerge'
import { idbGet, idbPut, mergeDelta, _closeMismatch, _findRecentBarByT, idbGetHistory } from '../../utils/barsIDB'
import { prependOlder, PREFETCH_WINDOWS, HISTORY_PREFETCH_TARGET_BARS, historyReachesTail, historyLagsTail } from '../../utils/historyPrepend'
import { memPeek, memPut, memPeekSavedAt } from '../../utils/barsMemCache'
import { timingMark } from '../../utils/intradayTiming'
import { classifyIntradayTail, isCacheCurrentForView, expectedFormingBar, isDailyTodayBarStaleForPaint, dailyCachePaintVerdict } from '../../utils/marketSession'
import { createTailPollState, nextTailPollMs, tailRetriesExhausted, intradayDedupMs } from '../../utils/intradayTailPoll'
import { resample, resampleForSpec } from '../../utils/resampleBars'
import { FIRST_PAINT_BARS, firstPaintBarsFor, spliceDeepLeftOfFresh } from '../../utils/barsBackfill'

// Cold-start first-paint safety valve: the longest the FIRST chart paint may wait on
// the local IndexedDB read before falling through to a full server fetch. A fresh
// browser mid-pack-ingest can stall idbGet for seconds (readwrite ingest serializes
// with our readonly get); this cap makes a new user paint from the ~1ms origin instead
// of a black screen. Warm browsers resolve idbGet in ~5ms and never reach it.
//
// 🔴 TWO timeouts, chosen by whether this browser has EVER returned cached bars
// (`_browserHasCachedBars`). The subtlety a real member HAR exposed (2026-08-20): a
// slow idbGet means the IDB is BUSY, which means it almost certainly HAS data (a
// populated cache under ingest/scan contention) — NOT that it's empty. An EMPTY
// browser's idbGet returns null in ~1ms and never trips a timeout. So the original
// flat 600ms fired in exactly the wrong case: it abandoned a member's full 23k-entry
// cache and full-fetched all 712 charts from the server, adding load that slowed
// idbGet further (a vicious loop) while his warm cache sat unused. Fix: once ANY
// idbGet on this browser has returned bars, we KNOW it has a pack — be patient
// (CACHED_MS) and let the local read win instead of hammering the origin. A browser
// that has never shown cached bars keeps the fast 600ms new-user path.
const _IDB_FIRST_PAINT_TIMEOUT_MS = 600
const _IDB_FIRST_PAINT_TIMEOUT_CACHED_MS = 4000
let _browserHasCachedBars = false

/** The comparison symbol's bars (an SWR of its own URL). P3-S1: BOTH bar sources call this one
 *  hook, so a compare overlay is identical under either switch value; P3-S3 moves it onto a store key. */
export function useCompareBars({ compareSymbol, resolvedTf, barCount, _gridQ, instFetcher }) {
  const compareSwrUrl = compareSymbol
    ? `/api/bars/${encodeURIComponent(compareSymbol.toUpperCase())}?tf=${resolvedTf}&bars=${barCount}${_gridQ}`
    : null
  const { data: compareData } = useSWR(compareSwrUrl, instFetcher, { dedupingInterval: 60_000, revalidateOnFocus: false })
  return compareData
}

/** The current-session daily seed (see `_resolveDailyTodaySeed` in the hook). Shared with
 *  chart/useBarSnapshotBars.js so both bar sources state today the same way (one owner). */
export function resolveDailyTodaySeed({ sym, resolvedTf, _developingBarISO, _effLivePrice, _liveSane }) {
  if (resolvedTf !== 'D') return null
  const _dev = _developingBarISO('D')
  if (!_dev) return null
  try {
    const _sess = getExtSessionCached()
    if (_sess && (_sess.session === 'pre' || _sess.session === 'post')) return null
  } catch { /* fall through — the per-source ext guards below still hold */ }
  // ⛔⛔ THE SANITY BASELINES MUST BE *THIS* SYMBOL'S (2026-11-11). This runs in the
  // render that first carries the new symbol, when `lastBarRef` / `lastServerCloseRef`
  // still hold the PREVIOUS ticker's close (the reset is an effect; the server close is
  // only replaced when the new symbol paints). So every switch between two names more
  // than 50% apart in price — META → GOOGL, NFLX → AMD, MU → INTC — rejected the new
  // name's own seed as a "phantom", refused its cache, and waited a round trip for
  // /api/bars: the "sometimes ~0.5 s even for liquid tickers" web report. A baseline
  // that belongs to another symbol is no baseline; fall back to this symbol's own
  // cached close (the IDB set for this key, else the mem cache), which still catches
  // the 100x phantom the guard exists for.
  // 1) Live-price store — the same `day.h`/`day.l` aggregate, at the freshest cadence
  //    UCT has (15s server TTL behind a 2s client poll), and it carries the vendor's
  //    own `observed_at` so the age we report is not a guess.
  try {
    const _snap = (typeof getLivePriceStoreSnapshot === 'function') ? getLivePriceStoreSnapshot()[sym] : null
    const _px = _snap ? _effLivePrice(_snap) : null
    if (_px && !_snap.ext_session && _liveSane(sym, _px)
        && _snap.day_open > 0 && _snap.day_high > 0 && _snap.day_low > 0) {
      const _obs = Number(_snap.observed_at)
      return {
        t: _dev,
        o: _snap.day_open,
        h: Math.max(_snap.day_high, _px),
        l: Math.min(_snap.day_low, _px),
        c: _px,
        src: 'live-store',
        ageMs: Number.isFinite(_obs) && _obs > 0 ? Math.max(0, Date.now() - _obs * 1000) : null,
      }
    }
  } catch { /* fall through to the pack */ }
  // 2) Today-pack — the whole-market projection of the same snapshot. Its own client
  //    enforces the seed ceiling; `todayPackUsable()` is that ceiling asked out loud.
  try {
    if (todayPackUsable()) {
      const _tb = getTodayBar(sym)
      if (_tb && _liveSane(sym, _tb.c)) {
        return { t: _dev, o: _tb.o, h: _tb.h, l: _tb.l, c: _tb.c, src: 'today-pack', ageMs: null }
      }
    }
  } catch { /* no seed */ }
  return null
}

export function useLegacyChartBars({
  sym, resolvedTf, _barsTf, _econId, showExtended, isIntraday, dedupMs, breadthSeries, replayCutoff,
  compareSymbol, backgroundWarm, deepWarm, barsOverride, barsOverridePending, _liveSane, _sessQ,
  _gridQ, instFetcher, fetchDepth, _fpBars, _fullTarget, _pinnedFull, _deepFirstPaint, _overlayActive,
  barCount, _depthKey, _fpDwellReady, _setFpDwellReady, _intradayDeepArmed, _setIntradayDeepArmed,
  axisWidthRatchetRef, _sinceBaseRef, _loadSeqRef, barsMutateRef, _timingIdRef, activeTfRef,
  _onScreenSrcRef, _switchSrcRef, lastBarRef, lastBarSymRef, tfSwitchHoldRef, provisionalStaleRef,
  _IDB_TAIL_WAIT_MS, _barsHistorySplitEnabled, _correctFirstPaintEnabled, _developingBarISO,
  _effLivePrice, _etPeriodStartISO, _firstPaintEdgeEnabled, _historyLoader,
  _intradayDeepBackfillEnabled, _intradaySmoothSwitchEnabled, _persistHistorySoon, barsSwrOnErrorRetry,
  fetcher,
}) {
  // ── IndexedDB layer — instant renders on repeat visits ────────────────────
  // On every sym/tf change: read IDB (~0 ms) BEFORE firing SWR.
  // idbSinceRef holds the last cached `t` value as a ref (not state) so
  // the SWR URL is stable after the first fire — prevents the double-fetch
  // that would occur if `since` were state and changed after IDB resolved.
  //
  // CRITICAL: idbReadyForRef tracks WHICH sym+tf the IDB state currently
  // belongs to. State updates (setIdbLoaded etc.) are async; on a sym/tf
  // change the FIRST render after the click still sees stale idbLoaded=true
  // and stale idbSinceRef from the previous ticker. Without this gate,
  // swrUrl would be computed as `/api/bars/NEW?since=<OLD's lastT>`, the
  // backend returns an empty delta, mergeDelta(OLD_bars, []) = OLD_bars,
  // and we idbPut(NEW, OLD_bars) — corrupting IDB so NEW chart shows OLD
  // ticker's data forever. This is the "blended" data bug.
  const [idbBars, setIdbBars]   = useState(null)
  const [idbLoaded, setIdbLoaded] = useState(false)
  const idbSinceRef     = useRef(null)
  const idbSavedAtRef   = useRef(null)  // epoch ms this browser wrote the IDB entry (recency, not source time)
  // True only while the candle series is showing a CACHED today bar that our own
  // recency gate calls stale. The in-place repair is scoped to exactly that; see the
  // assignment site below for why an unscoped repair is wrong.
  const dailyRepairTodayRef = useRef(false)
  const idbReadyForRef  = useRef(null)  // string `${sym}_${tf}` once IDB load completes
  // Always-current mirror of idbBars. The SWR-merge effect keys on [data] and would
  // otherwise read a STALE closured idbBars: when the shallow full set resolves right
  // after a deep IDB paint, the closure can still be pre-deep → the deep-preserve check
  // misfires and truncates (the "deep flashes then reloads" bug). Declared BEFORE the
  // merge effect so within any single commit this sync runs first.
  const idbBarsRef = useRef(null)
  useEffect(() => { idbBarsRef.current = idbBars }, [idbBars])
  // Fix 2 dwell timer: arm the first-paint edge deep fetch ~150ms after the sym/tf settles, so a
  // fast scroll-through never fires it. Early-returns when Fix 2 is off → no state churn, dark-safe.
  useEffect(() => {
    if (!sym || !resolvedTf) return undefined
    if (!_firstPaintEdgeEnabled()) return undefined
    const _t = setTimeout(() => _setFpDwellReady(true), 150)
    return () => clearTimeout(_t)
  }, [sym, resolvedTf])
  // TEMP DIAGNOSTIC (window.__uctBarsDebug) — the sym this chart last PAINTED, so
  // updateChart can log ticker transitions. Captures the "random chart appears for
  // a blip then goes away when switching to BLZE with a 2nd widget" report: a blip
  // shows up as an unexpected paint-sym transition sequence (e.g. A -> X -> BLZE).
  const paintSymRef = useRef(null)
  // Where a cached intraday series has an interior hole (barsIDB `repairFromT`): the next
  // `since=` starts THERE so the hole is re-asked instead of the cache being discarded.
  const idbRepairFromRef = useRef(null)
  // ⭐⭐ (2026-11-10) THE IDB READ STARTS IN RENDER, ONCE PER (sym, tf). The tail fetch
  // below no longer waits for the IDB effect to land (it ran after paint, and the gate
  // could hold the request up to 4 s on a busy browser): it starts on the first render
  // and, when the mem cache cannot seed `since`, races THIS same read for a few ms. The
  // effect consumes the same promise, so there is still exactly one IDB read per load.
  const _idbReadRef = useRef(null)
  {
    const _rk = `${sym}_${_barsTf}`
    if (sym && resolvedTf && !_econId && _idbReadRef.current?.key !== _rk) {
      _idbReadRef.current = { key: _rk, p: idbGet(sym, _barsTf) }
    }
  }

  useEffect(() => {
    if (!sym || !resolvedTf) return
    setIdbBars(null)
    setIdbLoaded(false)
    idbSinceRef.current = null
    idbSavedAtRef.current = null
    idbRepairFromRef.current = null
    idbReadyForRef.current = null  // synchronous — invalidates the gate immediately
    axisWidthRatchetRef.current = 0  // new sym/tf → let the axis column re-fit once
    const key = `${sym}_${_barsTf}`
    // ⛔ An economic series is never cached in the bars IndexedDB (nor read from it).
    if (_econId) { idbReadyForRef.current = key; setIdbLoaded(true); return undefined }
    let settled = false
    // 🔴 COLD-START UNBLOCK (new-user first paint). `swrUrl` is gated on idbGet
    // resolving so it can compute the correct `?since=<idb tail>` delta. But on a
    // FRESH browser the pack's big readwrite ingest serializes with our readonly
    // idbGet, so the local read can STALL for seconds — and while it does, swrUrl is
    // null, no server fetch fires, and the chart sits BLACK/"loading" even though the
    // origin would answer in ~1ms. A warm browser never sees this (idbGet resolves in
    // ~5ms), which is why scanning is flawless for returning users and broken for a
    // first-timer. Guarantee the first paint NEVER waits more than a beat on local
    // storage: if idbGet hasn't resolved by _IDB_FIRST_PAINT_TIMEOUT_MS, open the
    // swrUrl gate with NO cached tail → swrUrl fires a FULL server fetch immediately
    // (no `since`, so it's correct). A late idbGet still reconciles when it lands
    // (the _idbFresh / longer-series merge below picks the better set). This makes
    // "log on → instant from the fast server" true for new users, pack or no pack.
    // Patient once we KNOW this browser has a cache (see _browserHasCachedBars): a
    // slow idbGet on a populated browser means "busy, has data — wait for it", NOT
    // "empty — bypass to the server". Only a browser that has never shown cached bars
    // keeps the fast new-user path.
    // ⛔ …EXCEPT WHILE THE FIRST PACK INGEST RUNS (2026-10-18). That ingest holds IndexedDB
    // for over a minute on a first visit, and the first cached hit (a hot-pack name) flips
    // `_browserHasCachedBars`, so every later ticker waited the full 4 s: measured on
    // production, a fresh browser's click on a screener row painted in 0.7-1.8 s with no
    // server request at all, and a screenshot caught "Loading chart…" at 4 s. While the pack
    // is still ingesting, "busy" means the ingest, not "has data": keep the short wait.
    const _patient = _browserHasCachedBars && !_packStillIngesting()
    const _t = setTimeout(() => {
      if (settled) return
      idbReadyForRef.current = key   // open the gate; idbBars stays null → full fetch
      setIdbLoaded(true)
    }, _patient ? _IDB_FIRST_PAINT_TIMEOUT_CACHED_MS : _IDB_FIRST_PAINT_TIMEOUT_MS)
    const _read = (_idbReadRef.current?.key === key) ? _idbReadRef.current.p : idbGet(sym, _barsTf)
    let _gone = false   // this (sym, tf) was left: a late read must not stamp the NEW key's state
    _read.then(entry => {
      settled = true; clearTimeout(_t)
      if (_gone) return
      // ⛔ A tail that already landed for THIS key (a `since=` seeded from the mem cache
      // can beat the IDB read) is NEWER than the entry: fold the entry UNDER it instead
      // of replacing it, or the chart would step back to the older cached tail.
      const _cur = (idbReadyForRef.current === key && idbBarsRef.current?.length) ? idbBarsRef.current : null
      const _memBase = (_sinceBaseRef.current?.key === key && _sinceBaseRef.current.seq === _loadSeqRef.current)
        ? _sinceBaseRef.current.bars : null
      if (_cur) {
        const _m = entry?.bars?.length ? mergeDelta(entry.bars, _cur) : _cur
        if (_m !== _cur) { idbBarsRef.current = _m; setIdbBars(_m) }
        idbSinceRef.current = _m[_m.length - 1]?.t ?? idbSinceRef.current
        if (entry?.bars?.length) _browserHasCachedBars = true
      } else if (entry?.bars?.length) {
        // A mem base used for an in-flight `since=` is folded in too, so the delta the
        // server returns lands on a series that reaches the tail it was asked from.
        const _bars = _memBase?.length ? mergeDelta(entry.bars, _memBase) : entry.bars
        setIdbBars(_bars)
        idbSinceRef.current = _bars[_bars.length - 1]?.t ?? entry.lastT ?? null
        idbRepairFromRef.current = (typeof entry.repairFromT === 'number') ? entry.repairFromT : null
        // WHEN this browser received the set. The bars carry no source timestamp, so
        // this is the strongest honest recency signal a cached daily tail has — and it
        // errs safe (real age is always >= this). It is what lets the daily gate tell
        // "has today" apart from "today is current".
        idbSavedAtRef.current = Number.isFinite(entry.savedAt) ? entry.savedAt : null
        _browserHasCachedBars = true   // this browser has a pack → be patient from now on
      }
      idbReadyForRef.current = key
      setIdbLoaded(true)
    }).catch(() => { settled = true; clearTimeout(_t); if (_gone) return; idbReadyForRef.current = key; setIdbLoaded(true) })
    return () => { settled = true; _gone = true; clearTimeout(_t) }
  }, [sym, resolvedTf, _barsTf, _econId])

  // SWR URL: only set if IDB state is for the CURRENT sym+tf. Stale idbLoaded
  // from a previous ticker (before the IDB effect runs) is rejected by the ref
  // check, preventing the cross-ticker mergeDelta corruption described above.
  //
  // For Daily/Weekly/Monthly: ALWAYS full-fetch (no `since`). Payloads are
  // ~16KB which is trivial, and any prior IDB entry might contain stale
  // intraday-snapshot OHLC for past days that delta-fetches (server filter
  // is strict `>` so older bars never re-request) cannot heal. With no
  // `since`, server returns full set, the merge branch evaluates delta=false
  // and OVERWRITES the IDB bars array with authoritative server values —
  // healing every prior-day stale bar in one shot. Symptom this fixes:
  // dashboard chart shows wrong H/C for past days (intraday peeks frozen
  // into IDB at whatever moment the user first opened the chart that day).
  //
  // For intraday: keep delta-fetch (payloads can be 400KB+ at 5000 bars)
  // but back off `since` by one second so the boundary bar gets re-fetched.
  // mergeDelta deduplicates by timestamp; fresh server value wins.
  // A cached intraday series whose newest bar is >~23h old is missing at
  // least the most recent session. The `since`-delta CAN heal it (server
  // is authoritative), but a rapid sym/tf flip drops the delta (the
  // sameSymTf race below) leaving the stale cache rendered with a live-
  // price "spike" bar fused onto week-old history — the exact artifact
  // seen in production on 5min. Force a full (no-`since`) refetch so the
  // response REPLACES idbBars with authoritative data (identical to the
  // technique already used for D/W/M above), and don't paint the stale
  // series meanwhile (brief spinner beats a wrong chart). 23h errs toward
  // full-fetch; only cost is one larger payload for already-fresh weekend
  // data — correctness over bandwidth.
  // Threshold is tf-proportional (was a flat 23h). 23h only caught a MISSING
  // SESSION, but an INTRA-session stale cache (missing the last few bars, e.g.
  // a prewarmed entry that aged, or a stale-cache revisit) slipped through as
  // a DELTA — and the initial delta on load races/drops (the "missing candles
  // until the next 30s poll" stall), leaving a gap that reads as a detached
  // developing candle floating to the right of the fetched tail. A stale tail
  // now forces a full (no-`since`) refetch that REPLACES the data (bypasses the
  // flaky delta-merge) so it fills in ~300ms, not 30s — AND (via `_idbFresh`
  // below, which keys off this flag) suppresses painting the stale IDB copy
  // first, so there's no gap-flash before the network lands.
  //
  // 3× the tf interval, not 6× (and no 20-min floor): during RTH the newest
  // COMPLETE bar sits ~1-2 intervals behind "now" (the current bucket is still
  // developing), so 3× clears that fresh window without false positives, yet
  // catches a real gap of even a single missing bar. The old 6×/20-min floor let
  // a 1-min chart's tail sit up to 20 MIN behind before refetching — the visible
  // gap-on-load / gap-on-tf-switch bug. Small ≤1-bar gaps still delta (cheap).
  // Session/weekend/holiday-aware (mirrors idbStaleDaily), so a pre-seeded intraday
  // pack whose tail is the last CLOSED session paints INSTANTLY as _idbFresh (today's
  // bars fill via the live feed + the since-fetch below), while a series still missing
  // the CURRENT session's recent closed bars refetches. Replaces the old flat
  // max(3*tf,180s) age gate that treated every prior-session tail as stale (which is
  // why the intraday pack could never paint as primary).
  // ⭐⭐ THREE-WAY, NOT TWO. `classifyIntradayTail` separates a cache that is merely
  // BEHIND (sound history, short tail — the 10:00 tail at 13:17) from one that is
  // GAPPED (missing a whole closed session, so its continuity cannot be vouched for).
  // Only the gapped case may discard history. A behind cache keeps its bars, paints
  // them as the PRIMARY layer, and fetches only the gap via `since=` — which is the
  // whole point of an authoritative session tail: never re-download thousands of
  // bars to recover today's last twenty.
  const _intradayTail = isIntraday && typeof idbSinceRef.current === 'number'
    ? classifyIntradayTail(idbSinceRef.current, resolvedTf)
    : null
  const idbStaleIntraday = _intradayTail === 'gapped'
  // ⛔⛔ SOUND-AS-A-REPAIR-BASE IS NOT ELIGIBLE-TO-DISPLAY, AND TREATING THEM AS
  // ONE QUESTION IS WHAT PUT 10:00 ON SCREEN AT 15:55 (owner report: MU near the
  // close, chart rendered through ~10:00, caught up half a second later).
  // `_intradayTail === 'behind'` correctly keeps the cache and correctly asks for
  // only the gap via `since=` — both of those stay exactly as they are. What it
  // must NOT also mean is "show this to the member as the present session".
  //
  //   repair base  → _intradayTail !== 'gapped'      (drives `since=`, untouched)
  //   displayable  → isCurrentEnoughForPaint(...)    (drives the first frame)
  //
  // ⭐ MEASURED, NOT ASSERTED: with this gate absent the harness records a 23 ms
  // first paint that is 38 five-minute buckets stale, 19/19 switches — i.e. the
  // best-looking number in the run was the defect.
  // ⭐ (W-L 2026-11-11) ONE CONTRACT: `isCacheCurrentForView` — the same call the warmers
  // (prefetchBars) make — judged on the tail THIS VIEW DRAWS. 'fresh' by the repair
  // classifier is no longer an exemption: on an extended view pre-market, or an RTH view
  // whose cache ends in pre-market bars, a 'fresh' raw tail is not what is on screen.
  const _idbNotCurrent = isIntraday && typeof idbSinceRef.current === 'number'
    && _intradayTail !== 'gapped'
    && !isCacheCurrentForView(idbReadyForRef.current === `${sym}_${_barsTf}` ? idbBars : null,
      idbSinceRef.current, resolvedTf, { session: showExtended ? 'extended' : 'rth' })
  // Daily staleness gate — the analog of idbStaleIntraday for tf='D'. Without it
  // a symbol switch during RTH paints a daily cache that's missing the last few
  // sessions (each ticker's IDB is only as fresh as the last time it was viewed),
  // then the forced full refetch swaps in the current days ~1-2s later — the
  // "chart loads to Friday's close on a Tuesday afternoon" flash. The daily tail
  // is an ISO 'YYYY-MM-DD' string; reject it if it's older than the most recent
  // ET session that should be present. Weekend/pre-open aware (a rare holiday
  // only costs a brief spinner, never stale data).
  // Uses the PAINT gate (open-anchored during RTH), NOT isDailyTailStale
  // (close-anchored): /api/bars now server-includes today's developing daily bar,
  // so a cache whose tail is only the last CLOSED session (yesterday) is stale mid-
  // session — painting it provisionally frames yesterday, then the today-inclusive
  // network response adds a bar and re-anchors (the "current candle loads one bar
  // right then pops left" shift). Marking it stale skips the provisional so the
  // network's today-inclusive set paints directly, framed correctly. See
  // marketSession.isDailyTailStaleForPaint.
  // Two reasons an IDB daily tail is not safe to instant-paint: (1) it's missing a
  // session (isDailyTailStaleForPaint — the yesterday-during-RTH shift), or (2) it's
  // a TODAY tail whose cached CLOSE is provisional now that the session has closed
  // (isDailyTodayCloseProvisionalForPaint — the "loads a mid-session price then snaps
  // to the real close" after-hours flicker). Either way, defer to the network's
  // sealed set so the first frame is correct.
  // ── THE CURRENT-SESSION SEED, RESOLVED ONCE ────────────────────────────────
  // Today's developing daily bar as the freshest LOCAL source can state it, or null.
  // Two consumers read this and they must agree: the paint-authority verdict below
  // (which asks "can today be supplied without the network?") and the ohlcData seed
  // (which actually places it). One function, so they cannot drift.
  //
  // ⛔ PROVENANCE ONLY — NOTHING IS DERIVED, EXTRAPOLATED OR HEURISTIC. Every field
  // comes from a provider `day` aggregate that some door already serves; the live
  // store is preferred purely because it is the FRESHEST copy of that same aggregate
  // (a 2s poll against the pack's 90s seed ceiling), not because it knows more.
  // ⛔ REGULAR SESSION ONLY, both doors. Outside RTH the daily candle is settled at
  // the 4pm close and an extended print must not move it.
  const _resolveDailyTodaySeed = () => resolveDailyTodaySeed({ sym, resolvedTf, _developingBarISO, _effLivePrice, _liveSane })
  const _dailyTodaySeed = _resolveDailyTodaySeed()

  // ── THE DAILY PAINT AUTHORITY ──────────────────────────────────────────────
  // ⭐ ONE VERDICT, COMPOSED OF THE PREDICATES THAT ALREADY EXIST. Whether a CACHED
  // daily set may be the first thing the member sees is asked here and nowhere else,
  // so no performance flag can answer it by accident (which is exactly what
  // `_splitDeepUsable && _fpEdge` was doing).
  //
  //   CACHE USEFULNESS != PAINT AUTHORITY.
  //
  // A set that fails here is still perfectly good DEPTH and REPAIR input — it just
  // may not be the first frame. Returns 'ok' or the reason it is refused (the reason
  // is what the harness reads, so a refusal can never be mistaken for a missing paint).
  // The rules themselves live in ONE place, `marketSession.dailyCachePaintVerdict` (the
  // type-to-search warm asks the same function), with their rationale:
  //   breadth → paints its sealed history unless > 1 session behind (2026-10-10)
  //   provisional-close → a today set written mid-session, after the bell
  //   too-far-behind → missing more than today: repair first, never insert at the edge
  //   no-local-today / today-stale → paintable only with a REAL local today bar (seed)
  const _dailyCacheVerdict = (tailISO, savedAtMs) => {
    if (resolvedTf !== 'D') return 'ok'
    return dailyCachePaintVerdict(tailISO, savedAtMs, { hasSeed: !!_dailyTodaySeed, breadth: !!breadthSeries })
  }

  // Three ways a cached daily tail is not fit to be the FIRST frame:
  //   (1) it is missing a session            — isDailyTailStaleForPaint
  //   (2) its today CLOSE is provisional     — isDailyTodayCloseProvisionalForPaint (after the close)
  //   (3) its today bar is simply OLD        — isDailyTodayBarStaleForPaint (during RTH)
  // (3) is the one that was missing. A tail dated today is never "missing a session",
  // so a bar written at 10:05 painted unchallenged at 14:00 with four-hour-old H/L/C
  // and /api/bars corrected it in front of the member. HAS TODAY is not TODAY IS
  // CURRENT, and this is where the difference is stated.
  const _idbDailyVerdict = _dailyCacheVerdict(idbSinceRef.current, idbSavedAtRef.current)
  const idbStaleDaily = resolvedTf === 'D'
    && typeof idbSinceRef.current === 'string'
    && _idbDailyVerdict !== 'ok'
  // VALUE-SANITY gate for the instant daily paint (complements the timestamp gate
  // above). A cached daily bar can be internally corrupt — right DATE, wrong OHLC:
  // e.g. a stale ~$32 open persisted in IDB while the stock trades ~$21 (the 8/19
  // readout anomaly — a fake "monthly-look" 33→21 candle). idbStaleDaily only
  // inspects the tail's date, so such a bar reads fresh and paints instantly until
  // the healing full refetch (REPLACE) lands. Reject an IDB daily series whose LAST
  // bar breaks OHLC ordering, or whose open sits implausibly far (>50%) from its
  // close, and fall through to the refetch instead of flashing the corrupt candle.
  // Daily only + last bar only (cheap, and the only bar the live writer seeds from).
  const _idbDailyLastInsane = resolvedTf === 'D' && Array.isArray(idbBars) && idbBars.length > 0
    && (() => {
      const b = idbBars[idbBars.length - 1]; if (!b) return false
      const o = +(b.o ?? b.open), h = +(b.h ?? b.high), l = +(b.l ?? b.low), c = +(b.c ?? b.close)
      if (![o, h, l, c].every(Number.isFinite) || o <= 0 || h <= 0 || l <= 0 || c <= 0) return true
      if (h < Math.max(o, c) - 1e-9 || l > Math.min(o, c) + 1e-9) return true   // OHLC ordering broken
      if (Math.abs(o - c) / c > 0.5) return true                               // open >50% off close = phantom
      return false
    })()
  const _memTailStaleDaily = (arr, savedAtMs) => {
    if (resolvedTf !== 'D' || !Array.isArray(arr) || !arr.length) return false
    return _dailyCacheVerdict(arr[arr.length - 1]?.t, savedAtMs) !== 'ok'
  }
  let _sinceParam = null
  // ⭐ 'behind' NOW TAKES THE TAIL PATH TOO (it used to force a full refetch).
  // `get_bars_since` returns EVERY row past the threshold, not just the newest, so
  // one small request carries the entire 10:00 → 13:15 gap. Only 'gapped' refetches
  // in full, because a `since=` delta says nothing about bars BEFORE the tail.
  // (2026-11-10) Read from the refs AT CALL TIME so the tail fetcher below can ask it
  // when a poll fires, not only when a render happened. A cache with an interior hole
  // (`repairFromT`) asks from the hole, so the hole is re-requested, never discarded.
  const _sinceFromIdbNow = () => {
    const t = idbSinceRef.current
    if (typeof t !== 'number' || classifyIntradayTail(t, resolvedTf) === 'gapped') return null
    const rf = idbRepairFromRef.current
    return Math.max(0, (typeof rf === 'number' ? Math.min(rf, t) : t) - 1)
  }
  if (isIntraday && typeof idbSinceRef.current === 'number'
      && (_intradayTail === 'fresh' || _intradayTail === 'behind')) {
    _sinceParam = _sinceFromIdbNow()
  }
  const _primaryForceFull = fetchDepth > _fpBars || _pinnedFull
  // Viewport-first backfill: once we've bumped PAST the shallow first-paint depth
  // (any progressive step, not only the full target), drop `since` so the server
  // returns the full (older) range. `since` only returns the newer tail, which
  // would never load the deep history the user panned to see — so a progressive
  // intermediate depth MUST also full-fetch or it would delta-fetch nothing. The
  // bar count grows and the existing same-ticker re-anchor holds the view steady.
  if (fetchDepth > _fpBars || _pinnedFull) _sinceParam = null
  // Custom (non-native) timeframe → the native path fetches nothing; the isolated
  // custom SWR below fetches the base + resamples. Declared here so swrUrl can defer.
  const _isCustomTf = !!sym && !isNativeTf(resolvedTf)
  const _customBaseTf = _isCustomTf ? fetchTf(resolvedTf) : null
  const _customSpec = useMemo(() => (_isCustomTf ? resampleSpec(resolvedTf) : null), [_isCustomTf, resolvedTf])
  // barsOverride (Model Book uploaded data) short-circuits all fetching.
  const _overrideArr = Array.isArray(barsOverride) && barsOverride.length > 0
  // ⛔ AN ECONOMIC PRIMARY NEVER REACHES THE BARS LANE — loaded, loading, denied or
  // missing alike (`/api/bars/ECON:*` is an explicit 404 server-side anyway).
  const _hasOverride = _overrideArr || barsOverridePending || _econId
  // Replay mode: fetch the bars ENDING AT the cutoff (server serves this pre-cutoff
  // window fast from SQLite) instead of the full 'ending today' set — which for an old
  // cutoff is a big, slow fetch that paints nothing until it lands (the "chart stuck on
  // the previous ticker" bug). `to` implies a full window (no `since`).
  const _toParam = replayCutoff && !_isCustomTf ? replayCutoff : null
  // Phase 5 split-fetch: for a STANDARD native D/W/M chart, cap the /api/bars fetch to the
  // live tail (~first-paint depth) and pull the DEEP sealed history from the edge-cacheable
  // /api/bars-history endpoint instead. First paint is unchanged (the tail); only the older
  // history a user pans to is offloaded from the origin to the CDN edge. Excludes replay
  // (`to`), custom TFs, overrides, and pinned/entryDate charts (they need one full fetch).
  const _splitOn = _barsHistorySplitEnabled() && !!sym && !isIntraday && !_isCustomTf
    && !_hasOverride && !replayCutoff && !_pinnedFull
    && (resolvedTf === 'D' || resolvedTf === 'W' || resolvedTf === 'M')
  const _primaryBars = _splitOn ? Math.min(barCount, FIRST_PAINT_BARS) : barCount
  // Fix 2 (first-paint edge, gated dark): fire the edge deep-history fetch on FIRST PAINT for a
  // standalone backgroundWarm D/W/M chart whose IDB is NOT already deep — a cold browser's
  // first-ever view then shows full sealed history from the 2ms edge, no pan required. A
  // warm-deep browser renders full history via _splitDeepUsable (Fix 1) with no edge fetch, so
  // skip it there. _deepFirstPaint already scopes to backgroundWarm standalone D/W/M (grid cells
  // pass backgroundWarm=false → excluded → viewport-first preserved). At PCT=0 this is false.
  const _idbAlreadyDeep = idbBars?.length > _fpBars
  const _fpEdge = _firstPaintEdgeEnabled()
  const _histFirstPaint = _splitOn && _deepFirstPaint && !_idbAlreadyDeep && _fpDwellReady && _fpEdge
  // Deep sealed history from the edge — after the user pans PAST the first-paint tail
  // (fetchDepth grows), OR on first paint when _histFirstPaint (Fix 2) is enabled.
  const _histFire = _splitOn && idbLoaded && idbReadyForRef.current === `${sym}_${_barsTf}`
    && (fetchDepth > _fpBars || _histFirstPaint)
  // Standardize the history URL: always the FULL sealed depth (`_fullTarget`, fixed per tf)
  // + `d=<last sealed date>` derived from the bars we already hold. Fixed URL = every user +
  // the pre-warm sweep hit the SAME cache object (globally warm via Cache Reserve); the date
  // makes it immutable + self-refreshing. Falls back to no `d` (short cache) if we can't yet
  // read a sealed bar — still correct, just not immutable for that one request.
  let _histSealedDate = ''
  if (_histFire) {
    const _cut = _etPeriodStartISO(resolvedTf)
    if (_cut && Array.isArray(idbBars) && idbBars.length) {
      for (let i = idbBars.length - 1; i >= 0; i--) {
        const _t = idbBars[i]?.t
        if (typeof _t === 'string' && _t.length === 10 && _t < _cut) { _histSealedDate = _t; break }
      }
    }
    // Fix 2 cold fallback: a cold browser has no idbBars to derive the sealed date from. `d` is a
    // cache KEY only (the server always returns its current sealed set regardless), so a miss just
    // short-caches the same correct data. For DAILY, the barspack build session (localStorage
    // 'barspack.version', ISO "YYYY-MM-DD") equals the server's last_sealed on any day after the
    // pack built → the cold first paint STILL hits the globally pre-warmed immutable edge object.
    // W/M dating differs from a daily session, so leave d empty there (short cache) rather than
    // pass a guaranteed mismatch. Gated by _histFirstPaint → inert at PCT=0.
    if (!_histSealedDate && _histFirstPaint && resolvedTf === 'D' && _cut) {
      try {
        const _pv = localStorage.getItem('barspack.version')
        if (typeof _pv === 'string' && _pv.length === 10 && _pv < _cut) _histSealedDate = _pv
      } catch { /* ignore */ }
    }
  }
  const histUrl = _histFire
    ? `/api/bars-history/${encodeURIComponent(sym)}?tf=${resolvedTf}&bars=${_fullTarget}${_histSealedDate ? `&d=${_histSealedDate}` : ''}`
    : null
  // ── THE INTRADAY TAIL KEY (2026-11-10) ─────────────────────────────────────────
  // ⛔⛔ `since` IS NOT PART OF THE KEY ANY MORE. With `&since=<tail>` in the URL, every
  // merge that advanced the tail changed the key, and a new SWR key is an immediate
  // fetch: one EXTRA request per new bar on top of the poll, plus a `data === undefined`
  // render on every key flip. The key is now (base URL, load number) and `since` is
  // decided by `_tailFetcher` when the request actually starts — from the IDB state if
  // it has landed, else from the mem cache, else from a SHORT race against the IDB read
  // already in flight. Exactly one request per poll; no request ever waits on IDB for
  // more than `_IDB_TAIL_WAIT_MS`; and no `idbLoaded` gate, so the network starts on
  // the first render instead of after the IDB effect.
  // ⭐ WHY A LOAD NUMBER. Each visit gets a fresh key, so a revisit can never be handed
  // the previous visit's (stale) response from the SWR cache as if it were this one, and
  // the old entry is dropped from the cache when the load ends (no growth over a scan).
  // Scroll-back (`bars=` grows) is a new base → its FIRST fetch is full, every poll after
  // it is `since=` again (`_tailFullDoneRef`), instead of re-downloading 9k-32k bars.
  const _tailKeyed = isIntraday && !!sym && _toParam == null && !_hasOverride && !_isCustomTf
  const _primaryBase = `/api/bars/${encodeURIComponent(sym || '')}?tf=${resolvedTf}&bars=${_primaryBars}${_sessQ}`
  const _tailReqRef = useRef(null)
  _tailReqRef.current = {
    key: `${sym}_${_barsTf}`, sym, tf: resolvedTf, ck: _barsTf, base: _primaryBase,
    forceFull: _primaryForceFull, sinceFromIdb: _sinceFromIdbNow,
  }
  const _tailFullDoneRef = useRef(null)
  const _tailFetcher = useCallback(async (k) => {
    const base = Array.isArray(k) ? k[0] : k
    const seq = Array.isArray(k) ? k[1] : null
    const req = _tailReqRef.current
    const _left = () => {
      const r = _tailReqRef.current
      return seq !== _loadSeqRef.current || !r || r.key !== req.key || r.base !== base
    }
    const _canceled = () => { const ce = new Error('switch-aborted'); ce.canceled = true; return ce }
    // A key that is no longer this chart's load never reaches the network.
    if (!req || _left()) throw _canceled()
    let since = null
    if (!(req.forceFull && _tailFullDoneRef.current !== base)) {
      if (idbReadyForRef.current === req.key) {
        since = req.sinceFromIdb()
      } else {
        // IDB for this key has not landed. Seed from the mem cache, else race the read.
        let seed = null
        const mem = memPeek(req.sym, req.ck)
        const mt = mem?.length ? mem[mem.length - 1]?.t : null
        if (typeof mt === 'number' && classifyIntradayTail(mt, req.tf) !== 'gapped') {
          seed = { bars: mem, t: mt, rf: null }
        } else {
          const rd = _idbReadRef.current?.key === req.key ? _idbReadRef.current.p : null
          const entry = rd ? await Promise.race([rd.catch(() => null),
            new Promise((r) => setTimeout(() => r(null), _IDB_TAIL_WAIT_MS))]) : null
          if (entry?.bars?.length && typeof entry.lastT === 'number'
              && classifyIntradayTail(entry.lastT, req.tf) !== 'gapped') {
            seed = { bars: entry.bars, t: entry.lastT, rf: typeof entry.repairFromT === 'number' ? entry.repairFromT : null }
          }
        }
        // ⛔ RE-CHECK AFTER THE AWAIT: on a fast A→B scan the A request must not fire,
        // and on A→B→A it must not overwrite the NEW A load's base with an older one.
        if (_left()) throw _canceled()
        if (idbReadyForRef.current === req.key) since = req.sinceFromIdb()   // landed meanwhile
        else if (seed) {
          since = Math.max(0, (seed.rf != null ? Math.min(seed.rf, seed.t) : seed.t) - 1)
          _sinceBaseRef.current = { key: req.key, seq, bars: seed.bars }
        }
      }
    }
    const url = since != null ? `${base}&since=${encodeURIComponent(String(since))}` : base
    // A cold open whose exact URL an urgent/intent warm is already fetching joins it.
    // (W-L 2026-11-11) …or, for a tail, the scan warm's in-flight `since=` twin. A joined
    // background warm may be shed (503 warm-shed) where this request would not: fall back.
    const joined = joinPendingBars(url)
    const _own = () => instFetcher(url, { sym: req.sym, tf: req.tf, seq })
    const json = joined ? await joined.catch(_own) : await _own()
    if (json && !json.delta) _tailFullDoneRef.current = base
    return json
  }, [instFetcher])
  const _tailKey = _tailKeyed ? [_primaryBase, _loadSeqRef.current] : null
  const { cache: _swrCache } = useSWRConfig()
  const _prevTailKeyRef = useRef(null)
  useEffect(() => {
    const prev = _prevTailKeyRef.current
    _prevTailKeyRef.current = _tailKey
    if (prev && (!_tailKey || prev[0] !== _tailKey[0] || prev[1] !== _tailKey[1])) {
      try { _swrCache.delete(unstable_serialize(prev)) } catch { /* best-effort */ }
    }
  }, [_tailKey?.[0], _tailKey?.[1]])  // eslint-disable-line react-hooks/exhaustive-deps
  const swrUrl = (_hasOverride || _isCustomTf)
    ? null
    : _tailKeyed
    ? _tailKey
    : ((sym && idbLoaded && idbReadyForRef.current === `${sym}_${_barsTf}`)
        ? (_toParam != null
            ? `/api/bars/${encodeURIComponent(sym)}?tf=${resolvedTf}&bars=${_primaryBars}${_sessQ}&to=${encodeURIComponent(_toParam)}`
            : `/api/bars/${encodeURIComponent(sym)}?tf=${resolvedTf}&bars=${_primaryBars}${_sessQ}${_sinceParam != null ? `&since=${encodeURIComponent(String(_sinceParam))}` : ''}`)
        : null)

  // Self-healing poll cadence: with no refreshInterval, the chart was frozen
  // at first-fetch data until the component unmounted. That trapped users on
  // partial sessions (the noon-cutoff symptom), masked silent WS drops, and
  // missed server-side bar corrections. 30s intraday is comfortably under
  // any one-tf threshold yet long enough that the in-flight request rate stays
  // bounded even with many charts open. D/W/M evolve slowly — 5min is enough.
  // refreshWhenHidden:false stops backgrounded tabs from burning ticks.
  // Replay mode is FROZEN historical data — polling it re-fetches the (large) window
  // every 30s and blanks/repaints the chart mid-load (the "5m replay flickers" bug), so
  // don't poll while a cutoff is set. The static `?to=` window never changes.
  // ⭐⭐ A PROVISIONAL TAIL GETS A TINY, DETERMINISTIC LIFETIME — NOT 30 SECONDS.
  // Two paths can put a behind-the-market tail on screen: `_idbProvisional` (a
  // known-stale cache painted deliberately for an instant first frame) and a server
  // payload shed at `_bounded_delta`'s deadline. Both are the right trade for
  // LATENCY and both are wrong to leave sitting: at 13:00 a 10:00 tail waited a full
  // 30 s poll to catch up, which is the reported symptom ("chart ends around 10 AM,
  // later catches up") and the reason fast first paint must never be reported as a
  // fast chart.
  //
  // ⭐ THE STALENESS TEST IS THE CLIENT'S EXISTING ONE. `isIntradayTailStale` already
  // owns "is this tail behind its session" (weekend/holiday/half-day aware), so this
  // reads it rather than re-deriving a second answer that could disagree with the
  // one gating `since=` two hundred lines above.
  //
  // ⛔ BOUNDED, because an illiquid symbol that genuinely has not printed looks
  // identical to one we failed to fetch. Without the cap a quiet ticker would fast-
  // poll forever — a self-inflicted load storm on exactly the names the origin is
  // slowest for. Five tries ≈ 7.5 s of catch-up, then back to the normal cadence;
  // the counter resets on a fresh tail and on any symbol/timeframe change.
  // ⭐ The pacing is ONE module (`utils/intradayTailPoll`) so its rails test the real
  // policy, not a copy. 2026-09-28: it also honours the server's `tail_status` —
  // an UNVERIFIED answer (repair shed/failed) keeps the catch-up going even when the
  // client's own classifier has no objection — and its Retry-After.
  const _tailCatchupRef = useRef(createTailPollState())
  // The server's latest verdict for THIS chart, readable before useSWR returns (the
  // dedupe window above must be decided when a request starts).
  const _lastTailStatusRef = useRef(null)
  // The retry counter lives in a ref and advances inside SWR's timer, which renders
  // nothing — so UPDATING → DELAYED (and back) would never reach the screen. Bump a
  // render exactly when the budget flips.
  const [, _bumpTailBudget] = useState(0)
  const _intradayPollMs = useCallback((latest) => {
    const key = `${sym}_${_barsTf}`
    const _wasSpent = tailRetriesExhausted(_tailCatchupRef.current, key)
    // The tail ACTUALLY ON SCREEN: a `since=` response carries only the delta (and
    // is empty when nothing is new), so the merged cache tail is the honest reading.
    const rows = latest?.bars
    const respT = Array.isArray(rows) && rows.length ? rows[rows.length - 1]?.t : null
    const idbT = idbSinceRef.current
    const tailT = Math.max(
      typeof respT === 'number' ? respT : 0,
      typeof idbT === 'number' ? idbT : 0,
    )
    const _ms = nextTailPollMs(_tailCatchupRef.current, key, {
      tailT, tf: resolvedTf,
      tailStatus: latest?.tail_status ?? null,
      retryAfterSec: latest?.retry_after ?? null,
    })
    if (tailRetriesExhausted(_tailCatchupRef.current, key) !== _wasSpent) _bumpTailBudget(n => n + 1)
    return _ms
  }, [sym, resolvedTf])
  const refreshInterval = replayCutoff ? 0 : (isIntraday ? _intradayPollMs : 300_000)
  const { data, error, mutate, isValidating } = useSWR(
    swrUrl,
    _tailKeyed ? _tailFetcher : instFetcher,
    {
      // ⭐ Narrowed only while an intraday tail repair is active (see intradayDedupMs):
      // a 15 s dedupe silently swallowed every 1.5 s catch-up try.
      dedupingInterval: isIntraday
        ? intradayDedupMs({ tailClass: _intradayTail, tailStatus: _lastTailStatusRef.current })
        : dedupMs,
      revalidateOnFocus: false,
      refreshInterval,
      refreshWhenHidden: false,
      onErrorRetry: barsSwrOnErrorRetry,
    }
  )
  // Expose the latest mutate() to the live-bar writers (stale-closure-safe) so the
  // contiguity-guard self-heal can force an immediate revalidation. mutate() fires
  // even when refreshInterval polling is paused (hidden/popped-out window), which is
  // exactly the stall it recovers from.
  barsMutateRef.current = mutate

  // ── Phase 5: deep SEALED history from the CDN edge (/api/bars-history) ──
  // Static within the session (sealed bars don't change intraday), so no refreshInterval —
  // the primary /api/bars tail SWR above owns freshness + the live bar. Fires only on a deep
  // pan (histUrl is null on first paint), and is edge-served (never hits the origin on a HIT).
  const _histMutateRef = useRef(null)
  const { data: histData, mutate: _histMutate } = useSWR(histUrl, instFetcher, {
    dedupingInterval: 60_000,
    revalidateOnFocus: false,
    refreshInterval: 0,
    refreshWhenHidden: false,
    onErrorRetry: barsSwrOnErrorRetry,
  })
  _histMutateRef.current = _histMutate

  // ── Custom timeframe: fetch the NATIVE base, resample client-side ──
  // (_isCustomTf / _customBaseTf / _customSpec are declared ABOVE the native SWR so
  // it can null itself out for a custom TF; the fetch + resample happen here.)
  const _customBaseIntraday = ['1', '5', '15', '30', '60'].includes(_customBaseTf)
  // Pull a generous base window so the resampled series has enough bars to fill the view.
  const _customBaseBars = _customBaseIntraday ? 5000 : 6000
  const customSwrUrl = _isCustomTf
    ? `/api/bars/${encodeURIComponent(sym)}?tf=${_customBaseTf}&bars=${_customBaseBars}`
    : null
  const { data: customBaseData } = useSWR(customSwrUrl, instFetcher, {
    dedupingInterval: dedupMs,
    revalidateOnFocus: false,
    refreshInterval: _customBaseIntraday ? 30_000 : 300_000,
    refreshWhenHidden: false,
    onErrorRetry: barsSwrOnErrorRetry,
  })
  const customBars = useMemo(
    () => (_isCustomTf && customBaseData?.bars?.length ? resampleForSpec(customBaseData.bars, _customSpec) : null),
    [_isCustomTf, customBaseData, _customSpec],
  )
  // "Intraday-like": native intraday OR a custom TF resampled from an intraday base.
  // Drives the RTH (extended-hours) filter + session shading so custom minute/hour
  // charts hide pre/post market on Regular Hours and shade it on Extended — exactly
  // like the native intraday codes. (The native single-writer live path stays gated
  // on `isIntraday` alone; custom TFs get their own live writer below.)
  const _intradayLike = isIntraday || (_isCustomTf && _customBaseIntraday)

  // ── Comparison symbol SWR fetch ── (useCompareBars, shared with useBarSnapshotBars)
  const compareData = useCompareBars({ compareSymbol, resolvedTf, barCount, _gridQ, instFetcher })

  // ── Intraday deep history = LEFT-PREPEND windows (2026-11-11, utils/historyPrepend.js) ──
  // ⛔ Replaces the one-shot `bars=3000` deep pull AND the scroll-back `setFetchDepth` x8
  // whole-series re-download: both asked `/api/bars?bars=N`, whose deep branch answers from
  // what SQLite already holds (production 2026-11-11: no added depth on 60m for 14 of 21
  // names). Every deeper bar now arrives as "the N bars before my oldest bar"
  // (`&to=<ET date of oldest>`), merged by `prependOlder` — older bars only, so the newest
  // bar, the developing candle and the tail poll's bars are never touched (the right edge
  // cannot move) and `fetchDepth` never grows (the poll stays a `since=` delta).
  // Order after the ~900 ms dwell: (1) the persisted `@hist` segment from IDB (no network),
  // (2) background windows up to HISTORY_PREFETCH_TARGET_BARS, (3) further windows as the
  // visible left edge comes within LOOKAHEAD_SCREENS of the oldest bar (effect next to the
  // pan-backfill). Gate kept from the old deep pull: `_intradayDeepBackfillEnabled` (the
  // existing 100% flag) — it is the instant revert, no new flag.
  const _histPrependOn = isIntraday && !_isCustomTf && _intradayDeepBackfillEnabled()
    && !_hasOverride && !replayCutoff && !_pinnedFull && !_overlayActive && !!sym
  const _histLoadRef = useRef(null)
  _histLoadRef.current = { on: _histPrependOn, key: _depthKey, sym, tf: resolvedTf, ck: _barsTf, sessQ: _sessQ }
  // A window belongs to THIS chart's (sym, tf): leaving it (or unmounting) aborts the
  // request, which frees its connection and fetch slot at once.
  const _histAbortRef = useRef(null)
  useEffect(() => {
    const ctl = new AbortController()
    _histAbortRef.current = ctl
    return () => { try { ctl.abort() } catch { /* ignore */ } }
  }, [sym, _barsTf])
  // Merge one window into THIS chart's series (same cross-ticker guard as every bars merge).
  const _applyOlderRef = useRef(null)
  _applyOlderRef.current = (key, win, { persist = true } = {}) => {
    if (idbReadyForRef.current !== key || _histLoadRef.current?.key !== key) return false
    const cur = idbBarsRef.current
    const merged = prependOlder(cur, win)
    if (merged === cur) return false
    idbBarsRef.current = merged
    setIdbBars(merged)
    memPut(sym, _barsTf, merged)
    if (persist) _persistHistorySoon(sym, _barsTf, merged)
    return true
  }
  const _loadOlder = useCallback((background, attempt = 0) => {
    const r = _histLoadRef.current
    if (!r?.on || idbReadyForRef.current !== r.key) return Promise.resolve(null)
    const oldestT = idbBarsRef.current?.[0]?.t
    if (typeof oldestT !== 'number') return Promise.resolve(null)
    return _historyLoader.loadOlder(r.key, { sym: r.sym, tf: r.tf, sessQ: r.sessQ, oldestT, background, signal: _histAbortRef.current?.signal })
      .then((res) => {
        if (!res || _histLoadRef.current?.key !== r.key) return null
        const added = res.bars?.length ? _applyOlderRef.current(r.key, res.bars) : false
        // `filling` / warming: the server is fetching the older stretch — ask again once it lands.
        if (res.retryAfterMs && !res.canceled && attempt < 3) {
          setTimeout(() => { if (_histLoadRef.current?.key === r.key) _loadOlder(background, attempt + 1) }, res.retryAfterMs)
        }
        return { ...res, added }
      })
  }, [])

  // Persist to IDB and merge delta when SWR returns.
  useEffect(() => {
    if (!data?.bars || !sym || !resolvedTf) return
    // T1 — stable history available. T3 — the authoritative session tail has landed,
    // recorded ONLY once the merged tail actually reaches the market: a response that
    // arrives still behind has not delivered the tail, and marking T3 on arrival
    // would be the exact latency-without-freshness lie this instrument exists to stop.
    if (_timingIdRef.current) {
      const _rows = data.bars
      const _tail = _rows.length ? _rows[_rows.length - 1]?.t : null
      timingMark(_timingIdRef.current, 'T1', {
        historyEnd: _tail,
        cache: (idbBars?.length ? 'client-warm' : 'cold'),
      })
      const _merged = typeof idbSinceRef.current === 'number' ? idbSinceRef.current : _tail
      if (typeof _merged === 'number' && classifyIntradayTail(_merged, resolvedTf) === 'fresh') {
        timingMark(_timingIdRef.current, 'T3', { tailEnd: _merged })
      }
    }
    // Guard against stale closure: if sym changed between fetch-start and resolve,
    // the server's `ticker` field reveals the mismatch — skip to avoid storing
    // e.g. AAPL bars under MSFT when the user switches tickers rapidly.
    if (data.ticker && data.ticker !== sym.toUpperCase()) return
    // ⛔ A 60m answer on the OTHER grid (a server without `session=eth` support, or a
    // straggler from before an RTH/ETH toggle) never merges into this key's series.
    if (resolvedTf === '60' && ((data.session === 'eth') !== (_barsTf === '60e'))) return
    // Belt-and-suspenders: only merge if idbBars is known to belong to this sym+tf.
    // Without this, a delta response could merge with leftover bars from another
    // ticker still sitting in idbBars state (the cross-ticker race).
    const sameSymTf = idbReadyForRef.current === `${sym}_${_barsTf}`
    // TEMP DIAGNOSTIC (enable in DevTools: window.__uctBarsDebug = true) — traces
    // the delta-sync path to find the "missing candles until ~10s later" stall on
    // a stale-cache revisit. Logs the since sent, the delta response, the cached
    // tail, and the merge outcome. Remove once the gap-fill delay is root-caused.
    const _dbg = typeof window !== 'undefined' && window.__uctBarsDebug
    if (_dbg) console.log('[bars-delta]', sym, resolvedTf,
      '| resp:', { delta: data.delta, n: data.bars.length, firstT: data.bars[0]?.t, lastT: data.bars[data.bars.length - 1]?.t },
      '| idb:', { n: idbBars?.length ?? 0, lastT: idbBars?.[idbBars.length - 1]?.t },
      '| sinceRef:', idbSinceRef.current, '| sameSymTf:', sameSymTf)
    // ⭐ (2026-11-10) A `since=` seeded from the MEM cache can land before the IDB read:
    // merge it onto the base it was asked from, and make that the IDB state for this key
    // (the late IDB read folds UNDER it — see the IDB effect).
    const _sb = _sinceBaseRef.current
    if (data.delta && !(idbBars?.length && sameSymTf) && _sb?.key === `${sym}_${_barsTf}`
        && _sb.seq === _loadSeqRef.current && _sb.bars?.length) {
      const merged = (_deltaMergedRef.current?.data === data) ? _deltaMergedRef.current.bars : mergeDelta(_sb.bars, data.bars)
      idbBarsRef.current = merged
      setIdbBars(merged)
      idbSinceRef.current = merged[merged.length - 1]?.t ?? idbSinceRef.current
      idbSavedAtRef.current = Date.now()
      idbRepairFromRef.current = null
      idbReadyForRef.current = `${sym}_${_barsTf}`
      setIdbLoaded(true)
      idbPut(sym, _barsTf, merged)
      memPut(sym, _barsTf, merged)
      return
    }
    if (data.delta && idbBars?.length && sameSymTf) {
      // The hole (if any) has now been asked for; polls go back to `since=<tail>`.
      idbRepairFromRef.current = null
      const merged = (_deltaMergedRef.current?.data === data && _deltaMergedRef.current.base === idbBars)
        ? _deltaMergedRef.current.bars : mergeDelta(idbBars, data.bars)
      // refreshInterval flicker guard: when the 30s poll returns no new bars
      // and no overlapping-timestamp updates (the common case during low-vol
      // hours), the merged array is referentially+structurally identical to
      // idbBars. Skipping setIdbBars + idbPut here keeps updateChart's setData
      // from firing — no 1-frame "blank → restored" gap on every poll.
      const lastIdb = idbBars[idbBars.length - 1]
      const lastMerged = merged[merged.length - 1]
      const sameLength = merged.length === idbBars.length
      const sameTail = lastIdb && lastMerged
        && lastIdb.t === lastMerged.t
        && lastIdb.c === lastMerged.c
        && lastIdb.h === lastMerged.h
        && lastIdb.l === lastMerged.l
        && lastIdb.v === lastMerged.v
      if (sameLength && sameTail) {
        if (_dbg) console.log('[bars-delta]', sym, resolvedTf, '=> SKIPPED (delta added nothing new; gap NOT filled)')
        return  // nothing changed — don't repaint
      }
      if (_dbg) console.log('[bars-delta]', sym, resolvedTf, `=> MERGED ${idbBars.length} -> ${merged.length}`)
      setIdbBars(merged)
      if (merged.length) idbSinceRef.current = merged[merged.length - 1].t
      // The set was just healed FROM THE SERVER, so its recency is NOW — not whenever
      // this browser first wrote the entry. Without this re-stamp the daily
      // intra-session age gate would keep calling a freshly-merged set stale and the
      // chart would drop its own deep history one commit after healing it.
      idbSavedAtRef.current = Date.now()
      idbPut(sym, _barsTf, merged)
      memPut(sym, _barsTf, merged)
    } else if (!data.delta && data.bars.length) {
      // If IDB already holds a DEEPER history than this (shallow, recent) full set —
      // e.g. the Custom-Period-Sort deep prefetch pre-warmed the full pre-2024 tail —
      // don't truncate it back to the first-paint window. mergeDelta keeps the deep
      // bars and lets the fresh server bars WIN on the overlapping recent tail (same
      // healing as a replace, minus the truncation), so scrolling into deep history
      // is instant instead of paying a cold deep fetch. Only when the fresh set is a
      // recent SUFFIX of the deeper one (same sym/tf, starts at/after the deep start).
      // Read the authoritative CURRENT idb bars from the ref, not the [data]-closured
      // state (which can lag a just-committed deep IDB paint and cause the truncation).
      const curIdb = idbBarsRef.current
      // `>=`, not `>`. A full daily refetch returns the most-recent N bars, so when the
      // cache already holds N bars ending one session back the fresh set is the SAME
      // LENGTH but SLID: replacing drops the oldest bar, which moves every logical index
      // down by one and translates the whole chart right by a bar the instant the tail
      // lands. The suffix guard on the next line is what makes a merge valid, and it is
      // just as true at equal length — the server still wins every overlapping bar, we
      // simply stop throwing away the one on the left.
      const deeperInIdb = sameSymTf && curIdb?.length >= data.bars.length
        && data.bars[0] && curIdb[0] && data.bars[0].t >= curIdb[0].t
      const next = deeperInIdb ? mergeDelta(curIdb, data.bars) : data.bars
      if (_dbg) console.log('[bars-delta]', sym, resolvedTf,
        deeperInIdb ? `=> KEPT DEEP (${curIdb.length}) + healed tail (${data.bars.length})` : `=> REPLACED (full) with ${data.bars.length}`)
      idbBarsRef.current = next        // keep the mirror current for any same-tick re-run
      setIdbBars(next)
      idbSinceRef.current = next[next.length - 1]?.t ?? null
      idbSavedAtRef.current = Date.now()        // healed from the server — see above
      idbPut(sym, _barsTf, next)
      memPut(sym, _barsTf, next)
    }
  }, [data])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Phase 5 split-fetch: fold the edge-served DEEP SEALED history into idbBars ──
  // The /api/bars tail (recent + today + live) is merged by the effect above; this prepends
  // the older sealed bars a user panned to, fetched from the CDN edge instead of the origin.
  // Same cross-ticker guards as the tail path. mergeDelta(deepSealed, currentTail) keeps the
  // fresher tail winning on the overlap (today + live close) while filling the older range.
  useEffect(() => {
    if (!histData?.bars?.length || !sym || !resolvedTf) return
    if (!histData.sealed) return                                   // only the sealed endpoint's shape
    if (histData.ticker && histData.ticker !== sym.toUpperCase()) return   // stale-closure guard
    if (idbReadyForRef.current !== `${sym}_${_barsTf}`) return  // cross-ticker guard
    const cur = idbBarsRef.current
    // Fix 2 cold-tail paint: when the /api/bars tail is slow or HUNG (a cold-server long-tail
    // ticker — XXII/KORU-class microcaps + thin ETFs can stall the tail 20s+), the deep SEALED
    // history from the edge has already arrived but the chart stayed BLANK because the render +
    // merge both waited for the tail. Seed idbBars straight from the sealed history so the chart
    // paints its full past (through the last sealed day) instantly; the [data] effect above then
    // heals the recent tail + today's live bar when /api/bars finally lands (deeperInIdb keeps the
    // deep, wins the overlap). idbBars is in the deps, so once the tail establishes idbBars this
    // re-runs and mergeDelta reconciles. Only reachable via the Fix 2 first-paint histData (gated),
    // so inert at PCT=0.
    if (!cur?.length) {
      idbBarsRef.current = histData.bars
      setIdbBars(histData.bars)
      // ⛔ STATE THE TAIL. This branch used to publish bars WITHOUT publishing what
      // they end at, and the daily paint authority reads exactly that ref — an unset
      // tail reads as "no daily verdict to make", which would have let this sealed
      // set (which ends at the last SEALED day, i.e. yesterday during RTH) onto the
      // screen unexamined. That is the stale-paint bypass reopening through a second
      // door. The set is genuinely fresh FROM THE SERVER, so the recency stamp is now.
      idbSinceRef.current = histData.bars[histData.bars.length - 1]?.t ?? null
      idbSavedAtRef.current = Date.now()
      idbPut(sym, _barsTf, histData.bars)
      memPut(sym, _barsTf, histData.bars)
      return
    }
    const merged = mergeDelta(histData.bars, cur)
    if (merged.length === cur.length) return                       // no older bars added — nothing to repaint (idempotent on re-run)
    idbBarsRef.current = merged
    setIdbBars(merged)
    // A history merge only PREPENDS, so the tail is unchanged — but state it anyway
    // rather than leaving the ref to be right by accident.
    idbSinceRef.current = merged[merged.length - 1]?.t ?? idbSinceRef.current
    idbPut(sym, _barsTf, merged)
    memPut(sym, _barsTf, merged)
  }, [histData, idbBars])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Phase 3' Part 3: arm the intraday deep-backfill ~900ms after the sym/tf settles ──
  // Quick ticker-flips (scanning every 1-2s) never fire the deep fetch — only a name you dwell on
  // deepens. Reset synchronously on sym/tf change via the _depthKey block above. Skipped once idb
  // is already deep so a re-render doesn't re-arm a satisfied backfill.
  useEffect(() => {
    if (!_intradayDeepBackfillEnabled()) return undefined
    if (!isIntraday || !sym || _isCustomTf) return undefined
    if (_intradayDeepArmed) return undefined
    // (No "already deep" skip: the armed step first reads the persisted history and stops on
    // its own at HISTORY_PREFETCH_TARGET_BARS, so arming a deep series costs nothing.)
    const id = setTimeout(() => _setIntradayDeepArmed(true), 900)
    return () => clearTimeout(id)
  }, [sym, resolvedTf, isIntraday, _isCustomTf, _intradayDeepArmed])

  // ── Deep history after the dwell: persisted segment first, then background windows ──
  // Needs a series to prepend to (`idbBars` set for THIS key — the first network answer sets
  // it on a cold open), so it re-checks when that lands. Cancelled on sym/tf change.
  const _histHasBase = idbLoaded && idbReadyForRef.current === _depthKey && (idbBars?.length || 0) > 0
  useEffect(() => {
    if (!_histPrependOn || !_intradayDeepArmed || !_histHasBase) return undefined
    const key = _depthKey
    let cancelled = false
    ;(async () => {
      let hist = null
      try { hist = await idbGetHistory(sym, _barsTf) } catch { hist = null }   // best-effort, like every IDB read
      if (cancelled || idbReadyForRef.current !== key) return
      if (hist && historyReachesTail(hist, idbBarsRef.current)) {
        // Re-persist only when the tail is about to outrun the segment (historyLagsTail).
        _applyOlderRef.current(key, hist, { persist: false })
        if (historyLagsTail(hist[hist.length - 1]?.t, idbBarsRef.current)) _persistHistorySoon(sym, _barsTf, idbBarsRef.current)
      }
      // ⛔ NETWORK prefetch only on a chart that warms in the background (the focused /
      // standalone chart). Grid cells (`backgroundWarm=false`) still hydrate their persisted
      // segment above and load windows when SCROLLED, but a 16-cell open must not fire
      // 16 × PREFETCH_WINDOWS provider-backed `to=` asks (the 2026-05-24 herd class).
      if (!backgroundWarm && !deepWarm) return      // a maximized cell (deepWarm) prefetches too
      for (let i = 0; i < PREFETCH_WINDOWS && !cancelled; i++) {
        if ((idbBarsRef.current?.length || 0) >= HISTORY_PREFETCH_TARGET_BARS) break
        const res = await _loadOlder(true)
        if (!res || !res.added || res.exhausted || res.retryAfterMs) break
      }
    })()
    return () => { cancelled = true }
  }, [_histPrependOn, _intradayDeepArmed, _histHasBase, sym, _barsTf, _loadOlder, backgroundWarm, deepWarm])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Background prefetch — all other timeframes when sym changes ───────────
  // After the primary chart loads, fetch every other TF into IDB so switching
  // timeframes is instant. Fetches run STRICTLY SEQUENTIAL (one at a time,
  // wait for previous to finish before starting next) — fixed-delay staggering
  // doesn't work because some TFs are slow (e.g. VIX 1min ≈ 7s due to yfinance
  // fallback) and end up overlapping anyway. Sequential = backend sees exactly
  // 1 prefetch in flight per chart at a time.
  //
  // Order: the COMMONLY-clicked TFs first — Daily then 5min (the two the user
  // scans on) so those switches are instant, then the rest of intraday, then the
  // rarely-clicked W/M/1. (5min used to be 7th → clicking it before the chain
  // reached it was a cold fetch = the "only 5min lags" report.)
  useEffect(() => {
    if (!sym || !backgroundWarm) return
    // ⭐ (2026-10-10) a breadth series is D/W/M only — the server collapses every intraday tf
    // to D, so warming '5'..'1' was ~5 extra full-history requests per open for nothing.
    const ORDER = breadthSeries ? ['D', 'W', 'M'] : ['D', '5', '60', '30', '15', 'W', 'M', '1']
    const tfs   = ORDER.filter(t => t !== resolvedTf)
    let cancelled = false
    // Rapid-switch flood fix (Phase 3', gated): each switch speculatively warms ALL other TFs
    // (~8 /api/bars each, many 17-25s COLD for non-pack intraday), and the in-flight fetch was
    // NOT aborted on switch — the `cancelled` flag only stops the NEXT iteration. So fast scanning
    // left a pile of 17-25s zombie fetches clogging the ~6 connection slots, queuing the VISIBLE
    // chart's own fetch behind them (the rapid-switch lag, measured live: 37 fetches / 9 in-flight
    // from 5 switches). (1) Abort in-flight prefetches on switch → free the slots immediately.
    // (2) A longer dwell → a fast scan fires ZERO speculative prefetches (only the visible fetch);
    // settling on a ticker warms the rest.
    const _smooth = _intradaySmoothSwitchEnabled()
    // (2026-11-10) Always abortable: a switch frees the warm's connection + slot at once.
    const _ac = (typeof AbortController !== 'undefined') ? new AbortController() : null

    async function runSequential() {
      // Dwell so the primary chart's fetch goes out alone first; longer under smooth-switch so a
      // fast scan-through never starts the speculative all-TF chain (cancelled + aborted first).
      await new Promise(r => setTimeout(r, _smooth ? 1600 : 600))
      if (cancelled) return  // user may have switched tickers during the sleep
      for (const tf of tfs) {
        if (cancelled) return
        try {
          // The timeframe now ON SCREEN is the chart's own fetch — never warm it in parallel.
          if (tf === activeTfRef.current) continue
          const _ckTf = seriesCacheTf(tf, showExtended)   // this view's cache key for tf
          const entry = await idbGet(sym, _ckTf)
          // ⭐ (2026-11-10) ONE classifier for every cache decision. Intraday: a FRESH
          // entry (within one bucket of the frontier) is skipped; a BEHIND one is repaired
          // with `since=` (every row past the tail — tiny); only a GAPPED/absent one
          // refetches the window. The old private rule (3×tf age → FULL refetch, else
          // `since=<lastT>` with no -1, else skip anything saved < 4 h ago) re-downloaded
          // sound history, dropped the boundary bar's update, and skipped a 3-hour-stale
          // entry because it had been WRITTEN recently.
          const _isIntra = !['D', 'W', 'M'].includes(tf)
          const _cls = (_isIntra && entry?.bars?.length && typeof entry.lastT === 'number')
            ? classifyIntradayTail(entry.lastT, tf) : null
          if (_isIntra) {
            if (_cls === 'fresh') continue
          } else {
            // D/W: 24 h; M: 4 h — unchanged.
            const maxAge = (['D', 'W'].includes(tf) ? 86400 : 14400) * 1000
            if (entry?.bars?.length && Date.now() - (entry.savedAt || 0) < maxAge) continue
          }
          // Per-tf first-paint budget — the SAME count the chart will request for
          // this tf (session-aware), or this warm writes a cache key the chart never reads.
          const bc    = firstPaintBarsFor(tf, showExtended)  // viewport-first; backfill loads deep history on pan
          const _from = (_cls === 'behind' || _cls === 'fresh')
            ? (typeof entry.repairFromT === 'number' ? Math.min(entry.repairFromT, entry.lastT) : entry.lastT)
            : null
          const since = _from != null ? Math.max(0, _from - 1) : null
          // &warm=1: this all-TF chain is SPECULATIVE (warming timeframes the user
          // isn't viewing), so it MUST shed under load. Without it, at MARKET OPEN
          // these fire cold intraday PROVIDER fetches that saturate the threadpool and
          // 503-starve the daily chart the user is actually looking at (the 9:30 flood,
          // 2026-09-01). With it, a busy server sheds them fast (a cache-hit warm still
          // serves — the server checks the cache first); switching to a TF for real is
          // a non-warm fetch that always serves.
          const url   = `/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${bc}${barsSessionQuery(tf, showExtended)}${since != null ? `&since=${encodeURIComponent(String(since))}` : ''}&warm=1`
          // Through the SHARED slot gate, as BACKGROUND traffic: it only takes a slot while
          // BARS_BG_RESERVE stay free for the visible chart, and never ahead of it.
          let d
          try {
            d = await fetcher(url, _ac ? _ac.signal : undefined, { background: true })
          } catch (e) {
            if (e?.canceled || cancelled) return
            continue
          }
          if (cancelled || !d?.bars?.length) continue
          const next = (d.delta && entry?.bars?.length) ? mergeDelta(entry.bars, d.bars) : d.bars
          if (tf === '60' && ((d.session === 'eth') !== (_ckTf === '60e'))) continue   // wrong grid for this key
          idbPut(sym, _ckTf, next)
          memPut(sym, _ckTf, next)   // warm the sync mem cache too → instant TF switch
        } catch {
          // Single-TF failures shouldn't kill the whole prefetch chain.
        }
      }
    }
    runSequential()

    return () => { cancelled = true; if (_ac) { try { _ac.abort() } catch { /* ignore */ } } }
  }, [sym, backgroundWarm])  // eslint-disable-line react-hooks/exhaustive-deps

  // Bars: IDB renders instantly; full SWR data replaces it when available.
  // BUT never paint a stale intraday IDB series — that's what fuses a
  // live-price spike onto week-old history. When stale we force a full
  // refetch (no `since`, above) and show a brief spinner until it lands.
  //
  // Cross-ticker guard: on a sym switch, setIdbBars(null) only lands NEXT
  // render, and a stale-closure `data` may still describe the OLD ticker — so
  // for one render the naive selector would serve the previous stock's candles
  // (the "random candles flashing" on flip). Gate IDB on idbReadyForRef and
  // network on data.ticker so a mismatched render yields null (clean blank +
  // updateChart clears the series) instead of the wrong stock.
  const _symU = sym ? sym.toUpperCase() : ''
  const _netMatches = data?.bars?.length && (!data.ticker || data.ticker === _symU)
    // …and on THIS view's 60m grid: an answer without `session: 'eth'` (an older server,
    // a straggler) is never painted as the clock-grid series, nor the reverse.
    && !(resolvedTf === '60' && ((data.session === 'eth') !== (_barsTf === '60e')))
  // SPLIT / RE-BASIS heal (render path). The pack importer already drops a stale
  // wrong-basis IDB entry when the authoritative tail disagrees (_closeMismatch in
  // _importBatch), but a chart that paints straight from IDB BEFORE any pack re-ingest
  // has no such guard — so a serve-time re-adjustment (a split, or a stale-server heal
  // like the 2026-08-31 bars.db resync) shows the OLD basis: internally consistent and
  // current-dated (so idbStaleDaily/_idbDailyLastInsane both miss it), yet 2x+ off the
  // fresh server — the SOXL "$293 IDB vs $111 live" blank. Compare the newest CLOSED
  // network bar to the IDB bar on that SAME date: a past session's close only moves on
  // a re-adjustment, never on normal trading, and a closed (not developing) bar avoids
  // an intraday-move false positive. On a mismatch, treat IDB as poisoned → render the
  // fresh network (via _idbFresh=false below) and purge the entry (effect) so the next
  // fetch is a clean FULL refetch, not a `since=` delta merged onto the wrong basis.
  const _netClosed = (_netMatches && data.bars.length >= 2) ? data.bars[data.bars.length - 2] : null
  const _idbBasisMismatch = resolvedTf === 'D' && !!_netClosed && idbBars?.length > 0
    && _closeMismatch(_findRecentBarByT(idbBars, _netClosed.t), _netClosed)
  // A `since=` answer that actually carries rows past the cached tail (the merge
  // effect will advance the chart), vs one that cannot cure it.
  const _deltaAdvancesTail = !!(data?.delta && Array.isArray(data.bars)
    && typeof idbSinceRef.current === 'number'
    && data.bars.some(b => typeof b?.t === 'number' && b.t > idbSinceRef.current))
  const _idbHistoryContext = (idbBars?.length && idbReadyForRef.current === `${sym}_${_barsTf}`)
    ? idbBars : null
  // ⭐ (2026-11-10) THE DELTA IS MERGED IN RENDER, NOT ONE COMMIT LATER. A `since=` answer
  // that advances a held-back (not-current) cache used to yield `null` here and wait for
  // the merge effect — the BLANK frame between "stale" and "correct". Merge it now onto
  // the base it was asked from (IDB state, or the mem base of a pre-IDB request); the merge
  // effect then adopts this exact array, so the canvas is set once.
  const _deltaBase = (idbBars?.length && idbReadyForRef.current === `${sym}_${_barsTf}`)
    ? idbBars
    : ((_sinceBaseRef.current?.key === `${sym}_${_barsTf}` && _sinceBaseRef.current.seq === _loadSeqRef.current)
        ? _sinceBaseRef.current.bars : null)
  const _deltaMerged = useMemo(
    () => ((_netMatches && data?.delta && _deltaBase?.length) ? mergeDelta(_deltaBase, data.bars) : null),
    [_netMatches, data, _deltaBase],
  )
  const _deltaMergedRef = useRef(null)
  _deltaMergedRef.current = _deltaMerged ? { data, base: _deltaBase, bars: _deltaMerged } : null
  const _idbFresh = idbBars?.length && idbReadyForRef.current === `${sym}_${_barsTf}` && !idbStaleIntraday && !idbStaleDaily && !_idbDailyLastInsane && !_idbBasisMismatch && !_idbNotCurrent
  // SPLIT-FETCH deep render. When split-fetch is on, `data.bars` is a fresh SHORT tail
  // (capped to FIRST_PAINT_BARS via _primaryBars) and idbBars is the DEEP sealed+tail
  // merge. The daily STALENESS gates in _idbFresh — chiefly idbStaleDaily, which flags a
  // today-dated tail as "provisional" every weekday after 16:00 ET — would discard that
  // deep history and truncate the chart to the ~600-bar tail (the exact reason split-fetch
  // was disabled 2026-09-02: "stops at 2024"). Those gates guard against painting a STALE
  // cache, but here the fresh data.bars tail heals idbBars on the overlap (server wins),
  // so staleness is moot. Keep only the CORRECTNESS gates — the ready key, basis match,
  // and last-bar sanity — because a wrong-basis or corrupt deep history CANNOT be healed
  // by merging just the recent tail. Split-gated, so split OFF = identical to before.
  const _splitDeepUsable = _splitOn && idbBars?.length > 0
    && idbReadyForRef.current === `${sym}_${_barsTf}`
    && !_idbDailyLastInsane && !_idbBasisMismatch
  // ⛔ AND THE PAINTABLE HALF, WHICH IS A DIFFERENT QUESTION. `_splitDeepUsable` is a
  // USEFULNESS verdict — identity, basis, value sanity — and it says nothing about
  // currency, because DEPTH does not go stale. It was nonetheless standing in for a
  // freshness check at the two render arms below, with `_fpEdge` (a performance flag)
  // as its only companion: that is how a multi-session-old tail became a member's
  // first frame and then translated the frame when the missing sessions merged in.
  // The optimisation flag still chooses the STRATEGY; the daily authority decides
  // whether the data has earned the screen.
  const _splitDeepPaintable = _splitDeepUsable && !idbStaleDaily
  // Provisional stale-intraday paint: cached bars for THE CURRENT sym+tf that are
  // too stale to trust as live (idbStaleIntraday) are normally suppressed to avoid
  // fusing a live-price spike onto an old tail — but that left an intraday sym-switch
  // showing a 2-3s spinner while the forced full refetch lands, when Daily paints its
  // cache instantly. So we DO paint them, but only as the LAST-RESORT layer (real
  // net/mem/agg bars always win above it) AND we FREEZE the live-bar writers while
  // this layer is the one on screen (provisionalStaleRef below), so no phantom
  // developing candle can grow on the stale tail before authoritative bars swap in.
  const _idbProvisionalRaw = (idbStaleIntraday && idbBars?.length
    && idbReadyForRef.current === `${sym}_${_barsTf}`) ? idbBars : null
  // Part 2 (gated): drop the single frozen-partial developing tail so the provisional first
  // paint is never a misleading candle — the forced full refetch fills the correct current tail.
  // Keep >1 bar (never blank the chart); inert at PCT=0.
  const _idbProvisional = (_idbProvisionalRaw && _idbProvisionalRaw.length > 1 && _correctFirstPaintEnabled())
    ? _idbProvisionalRaw.slice(0, -1)
    : _idbProvisionalRaw
  // A2/A1: synchronous in-memory hit for THIS exact sym+tf. Used only as the
  // last fallback (when net+IDB haven't resolved for the current key yet) so a
  // warm switch paints on the first frame instead of flashing the loading
  // overlay. Keyed to the current sym+tf → cannot show another ticker's data.
  const _memBarsRaw = (!_overrideArr && !barsOverridePending) ? memPeek(sym, _barsTf) : null
  // Don't fall back to a stale daily mem entry either (prefetch's _memPromoteFresh
  // always promotes D/W/M, so mem can hold a multi-session-old daily just like IDB).
  // ⛔⛔ (2026-11-10) AND AN INTRADAY MEM ENTRY OBEYS THE SAME PAINT RULE AS IDB. It had
  // no currentness check at all, so a scan back onto a name cached at 10:00 painted the
  // 10:00 tail at 15:55 as the current chart (then a null frame, then the repair). It may
  // be the first frame only when it is a sound base (not gapped) AND within one expected
  // bucket of the frontier — `isCurrentEnoughForPaint`, the rule `_idbNotCurrent` uses.
  // A refused entry still seeds `since=` (see `_tailFetcher`), so the repair is one small
  // request and lands as a complete, current frame.
  const _memIntradayRefused = isIntraday && Array.isArray(_memBarsRaw) && _memBarsRaw.length > 0
    && (() => {
      const t = _memBarsRaw[_memBarsRaw.length - 1]?.t
      return !isCacheCurrentForView(_memBarsRaw, t, resolvedTf, { session: showExtended ? 'extended' : 'rth' })
    })()
  const _memBars = (_memTailStaleDaily(_memBarsRaw, memPeekSavedAt(sym, resolvedTf)) || _memIntradayRefused) ? null : _memBarsRaw
  // A mem entry that is a SOUND base (not gapped) even if it is not current.
  const _memSound = isIntraday && Array.isArray(_memBarsRaw) && _memBarsRaw.length > 0
    && typeof _memBarsRaw[_memBarsRaw.length - 1]?.t === 'number'
    && classifyIntradayTail(_memBarsRaw[_memBarsRaw.length - 1].t, resolvedTf) !== 'gapped'
  // ⭐⭐ STALE-BUT-SOUND HISTORY PAINTS AT ONCE — AS CONTEXT, NEVER AS CURRENT (2026-11-10).
  // A cache that is merely BEHIND (not gapped) is correct history that stops early. Holding
  // it back left the chart blank for a round trip on every such switch (thin names on every
  // open). It is now drawn immediately, minus its last candle (the one that was still
  // forming when it was cached, so its H/L/C are not final), with the live writers FROZEN
  // (`provisionalStaleRef` below) so no developing candle grows on it, and the currentness
  // badge — derived from the tail on screen — reads UPDATING, never LIVE. The `since=`
  // delta that is already in flight then advances the right edge in ONE setData.
  const _staleSrc = (isIntraday && !_isCustomTf && !_hasOverride && !replayCutoff)
    ? ((_idbNotCurrent && _idbHistoryContext) ? _idbHistoryContext
      : ((_memIntradayRefused && _memSound) ? _memBarsRaw : null))
    : null
  const _staleContext = useMemo(
    () => (_staleSrc?.length > 1 ? _staleSrc.slice(0, -1) : (_staleSrc?.length ? _staleSrc : null)),
    [_staleSrc],
  )
  // Phase-A A4: optimistic same-frame TF switch. Switching to Weekly/Monthly on a
  // ticker whose Daily is already in the sync mem cache normally still costs a
  // full /api/bars round-trip (skeleton flash) for the W/M payload. Instead,
  // synthesize W/M from the cached Daily and paint it on the FIRST frame; the
  // normal SWR fetch then replaces it with authoritative server bars. The
  // resampler mirrors the server's ISO-Friday / 1st-of-month bucketing exactly
  // (cross-checked bar-for-bar vs prod), so the swap is seamless for the visible
  // range. Only as the LAST fallback — real net/IDB/mem W/M data always wins — so
  // this paints ONLY during the brief load window. Memoized on the Daily array
  // identity so it doesn't churn updateChart every render.
  const _dailyForAgg = (!_overrideArr && !barsOverridePending
                        && (resolvedTf === 'W' || resolvedTf === 'M'))
    ? memPeek(sym, 'D')
    : null
  const _aggBars = useMemo(
    () => (_dailyForAgg ? resample(_dailyForAgg, 'D', resolvedTf) : null),
    [_dailyForAgg, resolvedTf],
  )
  // ⛔⛔ THE SERVER HAS ANSWERED: DRAW THE DEEP HISTORY, WITH THE SERVER'S WINDOW ON THE
  // RIGHT. When the paint authority refuses the cache (`_splitDeepPaintable` false —
  // chiefly 'provisional-close', true for every today-dated tail from the bell to
  // midnight ET) the arm below used to fall straight to `data.bars`: the 600-bar split
  // tail. Deep history was fetched, merged and persisted, then never drawn — every
  // daily chart "began" 600 sessions back each weekday evening and Origin framed there
  // (2026-09-28; the 2026-09-02 "stops at 2024" bug through a new door).
  // The authority's concern is a STALE TAIL on screen. `spliceDeepLeftOfFresh` takes
  // from the cache only bars OLDER than the server window, so the tail is the server's
  // verbatim and that concern cannot arise. Usefulness (`_splitDeepUsable`: identity,
  // basis, value sanity) still gates it — a wrong-basis deep set is never spliced.
  // Only reached where the arm previously drew `data.bars`; every other outcome is
  // unchanged, and the pre-server arm keeps its refusal untouched.
  // ⛔ BUT NOT THE LAST-BAR PRICE SANITY. `_idbDailyLastInsane` judges the cache's LAST
  // bar as a stock price (positive, open within 50% of close) because that bar would be
  // the first frame's tail. The splice never draws it — the tail is the server's — and
  // the rule is wrong for a value series: NASDAQ:NETHL / MCO close below zero and a
  // %-above-MA can double in a session, so every such day dropped the deep history and
  // the chart "began" at the 600-bar window (May 2024, 2026-10-07).
  const _splitDeepSpliceable = _splitOn && idbBars?.length > 0
    && idbReadyForRef.current === `${sym}_${_barsTf}`
    && !_idbBasisMismatch
  const _splitDeepBehindFresh = useMemo(
    () => ((_netMatches && !data.delta && _splitDeepSpliceable && !(_idbFresh || _splitDeepPaintable))
      ? spliceDeepLeftOfFresh(idbBars, data.bars) : null),
    [_netMatches, data, idbBars, _splitDeepSpliceable, _idbFresh, _splitDeepPaintable],
  )
  const _barsChosen = _isCustomTf
    ? customBars   // custom TF: the resampled base bars (null until the base loads)
    : _overrideArr
    ? barsOverride
    : (barsOverridePending
        ? null  // override expected but not here yet → render nothing (spinner), don't fall back to provider data
        : ((_netMatches && !data.delta)
            // Server returned a full (non-delta) set. Normally render it — it's the
            // authoritative heal. BUT if fresh IDB holds a strictly DEEPER history than
            // this (shallow first-paint) fetch, render THAT: otherwise a deep-warmed
            // chart flashes its full history from IDB, then this shallow fetch truncates
            // it back to ~600 bars until the dwell-warm re-fetches deep (the "cuts off
            // pre-2024 then reloads" flicker). The merge effect still heals idbBars's
            // recent tail from data.bars (server wins on overlap), so this stays correct.
            // …and only when that deeper set is itself PAINTABLE. A deep-but-stale set
            // would otherwise win on length alone and put its old tail on screen; the
            // merge effect heals it one commit later and the deep history then arrives
            // as a LEFT-side prepend, which moves no right-edge geometry at all.
            ? (((_idbFresh || _splitDeepPaintable) && idbBars.length > data.bars.length) ? idbBars : (_splitDeepBehindFresh || data.bars))
            : ((_idbFresh || (_splitDeepPaintable && _fpEdge))
                // Fix 2 cold-tail: paint the deep SEALED history the moment it arrives, even while
                // the /api/bars tail is still pending/hung — turns a cold-ticker 20s blank into an
                // instant full chart (today's bar fills in when the tail lands). Gated → inert at PCT=0.
                ? idbBars
                : (_idbNotCurrent && data?.delta
                    // ⛔ A DELTA IS NOT A CHART. With the IDB layer held back for
                    // being stale, the next arm would hand `data.bars` to the
                    // canvas — and under `since=` that is ONLY the gap rows (~38
                    // of them), so suppressing a stale frame would have produced a
                    // broken 38-bar one instead. Yield null and wait: the merge
                    // effect below folds this delta into idbBars, refreshes
                    // idbSinceRef, and the very next render classifies 'fresh' and
                    // paints the COMPLETE, CURRENT series.
                    // ⛔⛔ …UNLESS THE DELTA CANNOT CURE IT (2026-09-28). When the server
                    // could not repair the tail (shed / failed — `tail_status:
                    // 'unverified'`), the delta carries nothing past our tail, the
                    // merge is a no-op, and waiting for "the next render" waits
                    // forever on a BLANK chart. The authority has now answered and
                    // the answer is "not yet", so the history is shown as CONTEXT —
                    // the currentness state (UPDATING / DELAYED) says it is not
                    // current, and the LIVE badge cannot light. Stale history may
                    // paint; it may never pass as current.
                    ? (_deltaAdvancesTail ? (_deltaMerged || _staleContext || null) : _idbHistoryContext)
                    : (_netMatches
                        // A delta is never a chart on its own: draw it merged onto its base.
                        // (The non-delta answer is the first arm above.)
                        ? (_deltaMerged || (data.delta ? (_memBars?.length ? _memBars : (_staleContext || null)) : data.bars))
                        : (_memBars?.length
                            ? _memBars
                            : (_aggBars?.length ? _aggBars : (_idbProvisional
                                // The request FAILED and stale history is all there is: show it as
                                // context (the currentness badge reads UPDATING/DELAYED, never LIVE)
                                // rather than a "Failed to load" over usable bars.
                                || _staleContext
                                || ((error && isIntraday) ? (_idbHistoryContext || (_memSound ? _memBarsRaw : null) || null) : null)))))))))
  // ⭐ RIGHT EDGE COMPLETE FROM MEMORY (W-O 2026-11-11 — chart/developingTail.js). A LOCAL
  // layer (mem / IDB / behind-cache context) ends where it was cached: its last bar was still
  // forming then, and buckets after it are missing. On a timeframe switch the timeframe the
  // member was JUST on is in memory, current, with its live developing bar — rebuild every
  // missing/partial target bucket from it (or from a current finer mem entry), so the FIRST
  // frame is complete through now: the developing bar has its true bucket-to-date O/H/L/C
  // (no wick-less candle) and the series already ends at the developing bucket (the framing
  // anchor is final at first paint — no right-edge insertion when the network lands).
  // Network answers are never touched (the server is the authority once it has answered).
  // The outgoing timeframe's on-screen series (+ its live developing bar), captured ONCE on the
  // render that switches timeframe. Invalidation: it belongs to (sym, view, target tf) only —
  // a symbol/view change or the next timeframe switch replaces it, and every use re-proves it
  // is current (composeDevelopingTail refuses a source that does not reach the forming bucket).
  const _switchSourceFor = (s0, tf0, ext0) => {
    const on = _onScreenSrcRef.current
    const cur = _switchSrcRef.current
    if (on && on.sym === s0 && on.ext === ext0 && on.tf !== tf0 && !(cur && cur.forTf === tf0 && cur.from === on)) {
      let bars0 = on.bars
      const lb = lastBarRef.current
      const lt = (lb && lastBarSymRef.current === s0 && Number.isFinite(lb.time)) ? fromChartTime(lb.time) : null
      const tail = bars0[bars0.length - 1]
      if (lt != null && isCompleteOhlc(lb) && tail && lt >= tail.t) {
        const live = { t: lt, o: lb.open, h: lb.high, l: lb.low, c: lb.close, v: Number(lb.volume) || 0 }
        bars0 = lt === tail.t ? bars0.slice(0, -1).concat([{ ...live, v: Math.max(live.v, Number(tail.v) || 0) }]) : bars0.concat([live])
      }
      _switchSrcRef.current = { forTf: tf0, sym: s0, ext: ext0, from: on, src: { tf: on.tf, bars: bars0 } }
    }
    const sw = _switchSrcRef.current
    return (sw && sw.forTf === tf0 && sw.sym === s0 && sw.ext === ext0) ? sw.src : null
  }
  // Invalidation (F3): once the server has answered THIS key the switch is over — the source is
  // retired (kept as a tombstone on the same `from` so it is not re-captured from that frame).
  {
    const sw = _switchSrcRef.current
    if (sw && sw.src && sw.forTf === resolvedTf && data && (!data.ticker || data.ticker === _symU)) {
      _switchSrcRef.current = { ...sw, src: null }
    }
  }
  const _localLayer = !!_barsChosen && isIntraday && !_isCustomTf && !_hasOverride && !replayCutoff
    && (_barsChosen === _memBars || _barsChosen === _staleContext || _barsChosen === idbBars
      || _barsChosen === _idbProvisional || _barsChosen === _idbHistoryContext || _barsChosen === _memBarsRaw)
  const _switchSrc = _localLayer ? _switchSourceFor(sym, resolvedTf, showExtended) : null
  const _memSrc1 = _localLayer && Number(resolvedTf) > 1 ? memPeek(sym, '1') : null
  const _memSrc5 = _localLayer && Number(resolvedTf) > 5 ? memPeek(sym, '5') : null
  const _memSrc15 = _localLayer && Number(resolvedTf) > 15 ? memPeek(sym, '15') : null
  const _memSrc30 = _localLayer && Number(resolvedTf) > 30 ? memPeek(sym, '30') : null
  const _composedBars = useMemo(() => {
    if (!_localLayer) return null
    const session = showExtended ? 'extended' : 'rth'
    const nowMs = Date.now()
    if (expectedFormingBar(resolvedTf, nowMs, { session }) == null) return null   // nothing forming → nothing to complete
    const rth = (b) => !showExtended ? isRthBar(b.t) : true
    const sources = []
    if (_switchSrc) sources.push(_switchSrc)
    for (const [f, m] of [['1', _memSrc1], ['5', _memSrc5], ['15', _memSrc15], ['30', _memSrc30]]) {
      if (Array.isArray(m) && m.length) sources.push({ tf: f, bars: showExtended ? m : m.filter(rth) })
    }
    if (!sources.length) return null
    const out = composeDevelopingTail(_barsChosen, resolvedTf, sources, {
      nowSec: nowMs / 1000, grid: resolvedTf === '60' ? sixtyMinGridFor(session) : 'session',
    })
    return out === _barsChosen ? null : out
  }, [_localLayer, _barsChosen, _switchSrc, _memSrc1, _memSrc5, _memSrc15, _memSrc30, resolvedTf, showExtended])  // eslint-disable-line react-hooks/exhaustive-deps
  // ⭐ A TIMEFRAME SWITCH NEVER PAINTS AN INCOMPLETE RIGHT EDGE (TC2000 rule). When the local
  // layer could not be completed from memory (switching to a FINER tf: the developing bucket's
  // open/high/low exist only on the server), the first frame of the new tf would be a cache
  // whose right edge is missing or partial — then the network answer inserts/reshapes it and
  // the frame jumps. Keep the PREVIOUS timeframe's frame on screen instead until the server
  // answers (no skeleton: `_tfSwitchHold`), so the first new-tf frame is complete and final.
  // Only a same-symbol, same-view timeframe switch with a frame already on screen holds; a
  // symbol switch keeps the instant context paint, and an error releases the hold.
  const _onScr = _onScreenSrcRef.current
  // Hold ONLY when the local tail is provably incomplete (F1b): it does not reach the bucket
  // forming now, or it was saved before that bucket began (its developing bar is missing). A
  // cache that holds the forming bucket and was written during it paints at once, as before.
  const _localTailComplete = (() => {
    if (!_localLayer) return true
    const forming = expectedFormingBar(resolvedTf, Date.now(), { session: showExtended ? 'extended' : 'rth' })
    if (forming == null) return true
    const lt = _barsChosen[_barsChosen.length - 1]?.t
    if (typeof lt !== 'number' || lt < forming) return false
    const savedAt = (_barsChosen === _memBars || _barsChosen === _memBarsRaw) ? memPeekSavedAt(sym, _barsTf)
      : (_barsChosen === idbBars ? idbSavedAtRef.current : null)
    return Number.isFinite(savedAt) && savedAt / 1000 >= forming
  })()
  // `!data`: only until the server has answered THIS key (any answer — even an empty delta —
  // ends the hold, so it can never outlive the request).
  // Also when there is NOTHING local for the new tf: the previous frame stays rather than a
  // black chart for the round trip (review F1).
  const _tfSwitchHold = isIntraday && !_isCustomTf && !_hasOverride && !replayCutoff && !error && !data
    && (_barsChosen == null || (_localLayer && !_composedBars && !_localTailComplete))
    && !!_onScr && _onScr.sym === sym && _onScr.ext === showExtended && _onScr.tf !== resolvedTf
  tfSwitchHoldRef.current = _tfSwitchHold
  const bars = _tfSwitchHold ? null : (_composedBars || _barsChosen)
  // ── SCOPE OF THE STALE-TODAY REPAIR ────────────────────────────────────────
  // ⚰️ THE REPAIR WAS UNCONDITIONAL, AND THAT WALKED THE CLOSE BACKWARDS. It rewrites
  // today's slot from the freshest LOCAL source and runs on every evaluation of the
  // candle memo — including after /api/bars has landed. A pack up to its 90s ceiling
  // is then OLDER than the served bar, so re-stamping from it dragged an already
  // authoritative close back in time (measured: served 220.5 → repainted 220.1).
  //
  // The repair exists for ONE situation: a CACHED today bar that our own recency gate
  // calls stale, which the gate only admitted to the screen BECAUSE a seed could
  // repair it. Once the server's own set is what we are painting, the served bar is
  // by definition fresher than any local seed and must be left alone. Identity is the
  // exact test for which arm won, and the savedAt term self-cancels the moment a
  // server heal re-stamps the cache.
  dailyRepairTodayRef.current = resolvedTf === 'D' && !!bars
    && (bars === idbBars || bars === _memBars)
    && isDailyTodayBarStaleForPaint(idbSinceRef.current, idbSavedAtRef.current)

  // The live-bar writers consult this to freeze until a CURRENT-session payload
  // replaces the data — BUT only when the stale tail is from a PRIOR session
  // (>8h old: overnight / weekend / multi-day), which is the "fuse a live spike
  // onto old history" danger this gate exists for. A SAME-SESSION tail that's
  // merely >15min stale is safely EXTENDED by a live tick (isSaneLivePrice already
  // rejects a wrong price), so freezing there just left the price permanently stuck
  // with the feed connected until a timeframe flip (owner report: 5m loads only to
  // 3:15pm, LIVE badge green but price frozen). Same-session → keep ticking so the
  // developing candle advances.
  // Freeze the live-bar writers whenever the intraday series ON SCREEN ends on a
  // PRIOR-SESSION tail (>8h old) — regardless of whether that tail came from the
  // IDB provisional layer OR a stale NETWORK response the backend served before
  // today's bars landed. The old form keyed off `!_netMatches`, so the freeze
  // dropped the instant ANY network payload matched — even a stale one whose
  // newest bar is yesterday's close — and a live tick then fused a giant
  // developing candle onto that stale tail (the QQQ "yesterday's full session +
  // one huge candle up to now" / SPCX "only yesterday" reports). Keying purely on
  // the chosen `bars` tail age keeps the freeze on until a CURRENT-session payload
  // replaces it (the forced full refetch), then writers resume. 8h is well above
  // same-session staleness (a normal developing tail is ≤ a couple intervals old),
  // so an active RTH chart is never falsely frozen; only a missing-session tail is.
  const _barsTailT = (Array.isArray(bars) && bars.length)
    ? (typeof bars[bars.length - 1]?.t === 'number' ? bars[bars.length - 1].t : null)
    : null
  const _barsTailSecs = (typeof _barsTailT === 'number') ? (Date.now() / 1000 - _barsTailT) : 0
  provisionalStaleRef.current = isIntraday && ((_barsTailT != null && _barsTailSecs > 8 * 3600)
    // …and while stale-but-sound CONTEXT is what is on screen (see `_staleContext`).
    || (!!bars && bars === _staleContext))
  return {
    bars, data, error, mutate, isValidating, compareData, idbReadyForRef, idbBarsRef,
    dailyRepairTodayRef, paintSymRef, _tailCatchupRef, _lastTailStatusRef, _histMutateRef,
    _resolveDailyTodaySeed, _isCustomTf, _hasOverride, _customBaseIntraday, _intradayLike,
    _histPrependOn, _loadOlder, _symU, _idbBasisMismatch, _staleContext, _tfSwitchHold,
  }
}
