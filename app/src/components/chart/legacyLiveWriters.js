// ── THE LEGACY LIVE WRITERS (P3-S2, BARSTORE-SPEC.md "P3 slices" S2) ──────────────────────────
// Every developing-bar writer of the LEGACY bar source lives here, out of StockChart:
//   A  livePrices tick effect (Finnhub / live-price quotes)        useLegacyWriterA
//   B  onRealtimeBar — the Massive push writer (+ useRealtimeBars) useLegacyPushWriterB
//   C  realtimeCandle registry (trade ticks)                        useLegacyRegistryWriterC
//   D  updateChart's post-setData seed / re-top                     liveAfterSetData (+ legacyPushRetop)
//   E  fast D/W/M candle on the bars-WS 1-min tick (+ legend tick)  useLegacyDailyTickE
//   F  custom-TF live developing bar                                useLegacyCustomTfF
//   +  the frozen-chart gap watchdog, the per-switch ref reset, the tf-switch push hold fold.
// Their state (liveBarRef, lastBarRef, lastBarSymRef, barsPushActiveRef, provisionalStaleRef,
// sessionOwnsDailyRef, gapHealAtRef, watchdogTriesRef, barStartVolRef) is written ONLY here.
//
// ⭐ ONE STRUCTURAL GATE. Each export is chosen ONCE, at module load, from the BARSTORE switch
// (chart/barStoreSwitch.js): legacy source → the writer; BarStore → an INERT stand-in with the
// same signature (a hook that calls no hook, a function that paints nothing). So under BARSTORE
// no legacy writer is even mounted — no subscription, no effect, no ref write — and the store's
// developing bar (snapshot.developing, the store's dev channel) is the ONLY live candle
// (StockChart `_storeDevPaintRef`, railed by engine/__tests__/r1StoreWriterCensus.test.js).
// The hook order cannot change between renders: the choice is a module constant.
//
// ⛔ DELETION: this whole module goes when the switch is removed (P3-S3), not before — the switch
// is OFF in production and these writers ARE production's live candle until the owner approves it.
//
// The bodies below are MOVED from StockChart.jsx unchanged (each hook takes the exact names it
// closed over, in one `ctx` object built at its call site; module-scope helpers ride on `ctx.H`).
import { useEffect, useCallback, useMemo, useState } from 'react'
import { BARSTORE } from './barStoreSwitch'
import useRealtimeBars from '../../hooks/useRealtimeBars'
import * as realtimeCandle from '../../lib/realtimeCandle'
import * as barsStreamManager from '../../lib/barsStreamManager'
import { mergePushBar, reconcileWithServerTail, foldPrice, mergeRegistryMinute, isCompleteOhlc, LIVE_PERIOD_SECONDS, provisionalOpen } from '../../lib/liveBarMerge'
import { toChartTime, fromChartTime, isRthBar, computeBarTime, barsSessionQuery, isOnSixtyMinGrid } from './barTime'
import { liveStreamSession } from './liveBuckets'
import { classifyLiveBar } from './liveBarClassify'
import { getSnapshot as getLivePriceStoreSnapshot } from '../../hooks/livePriceStore'
import { timingMark } from '../../utils/intradayTiming'
import { watchdogGapMs } from '../../utils/intradayTailPoll'

/** True when the legacy writers run (the BarStore switch is OFF). Read once, at module load. */
export const LEGACY_LIVE = !BARSTORE

// Fallback-writer arbitration (push NOT delivering): while the realtimeCandle registry
// (Writer C, trade ticks) has a tick this recent for the chart's symbol, it owns the
// intraday developing bar's same-bucket CLOSE and Writer A (livePrices) stands down for
// same-bucket updates — two feeds writing one close was the D2 flicker. A still opens new
// buckets (C never does on 5-60m) and takes over the moment C goes quiet.
const FALLBACK_REGISTRY_FRESH_MS = 3000
function _registryOwnsLiveClose(sym) {
  return Date.now() - realtimeCandle.getLastTickAt(sym) < FALLBACK_REGISTRY_FRESH_MS
}

/** The five NATIVE intraday codes push can engage on (Writer F's disjointness premise). */
function _realtimeTfEligibleFor(resolvedTf) {
  const realtimeTfEligible = ['1', '5', '15', '30', '60'].includes(resolvedTf)
  return realtimeTfEligible
}

// ── who reads the developing bar ON SCREEN ─────────────────────────────────────────────────────
/**
 * The developing bar every READER of StockChart sees (legend, MA overlay extension, session
 * chip, screenshot price, the live-tick sanity baseline): the legacy writers' refs, or — under
 * BARSTORE — the one ref the store's developing-bar paint writes. Chosen here, once.
 * @param {{tail: {current:any}, dev: {current:any}, sym: {current:any}}} legacy
 * @param {{current: any}} store   chart-shape developing bar `{time,open,high,low,close,volume,sym}`
 */
export function devOnScreenSource(legacy, store) {
  if (LEGACY_LIVE) {
    return { tail: () => legacy.tail.current, dev: () => legacy.dev.current, sym: () => legacy.sym.current }
  }
  return { tail: () => store.current, dev: () => store.current, sym: () => store.current?.sym ?? null }
}

// ── the frozen-chart watchdog ──────────────────────────────────────────────────────────────────
function useGapWatchdog(ctx) {
  const { sym, resolvedTf, isIntraday, barCount, _sessQ, livePricesRef, lastBarRef, gapHealAtRef, watchdogTriesRef, barsMutateRef } = ctx
  const { PERIOD_SECONDS } = ctx.H
  // ── Frozen-chart watchdog (independent of the live-bar writers) ──
  // Uses the existing livePricesRef (assigned each render below) — stale-closure-safe.
  // The live-bar writers only self-heal a stalled chart when they actually FIRE
  // (a push/Finnhub tick arrives AND isn't suppressed). But the exact reported bug
  // — "price keeps updating in the header + watchlist, yet the chart is frozen and
  // the tick isn't moving" — is a state where the developing-bar writer isn't
  // advancing the series while the live-price feed clearly IS live. The header/
  // watchlist price rides the /api/live-prices path (livePrices here), so when that
  // price is running MORE than ~2 intervals ahead of the chart's rendered tail, the
  // bars SWR poll has stalled (post-deploy SSE drop + visibility-gated refresh not
  // resuming). Force a throttled revalidation — mutate() fires even while interval
  // polling is paused, and the backend is authoritative + proven fresh, so the tail
  // catches up. Runs only for intraday; a same-session live price naturally sits
  // within a bar or two of the tail, so this never fires on a healthy chart.
  useEffect(() => {
    watchdogTriesRef.current = 0
    if (!sym || !isIntraday) return
    const id = setInterval(() => {
      try {
        const lp = livePricesRef.current?.[sym]
        const tail = lastBarRef.current
        if (!lp || !Number.isFinite(lp.updated_at) || !tail || !Number.isFinite(tail.time)) return
        const period = PERIOD_SECONDS[resolvedTf] || 300
        // tail.time is chart time (toChartTime of server unix seconds); lp.updated_at
        // is raw unix seconds — undo the shift to compare like-for-like.
        const tailServerSec = fromChartTime(tail.time)
        if (lp.updated_at - tailServerSec <= 2.5 * period) { watchdogTriesRef.current = 0; return }
        const nowMs = Date.now()
        // ⛔ BACKOFF, NOT A HAMMER (2026-09-28): 6 s, 12 s, 24 s, 48 s, then once a
        // minute while the chart stays behind; reset below when it catches up.
        if (nowMs - gapHealAtRef.current <= watchdogGapMs(watchdogTriesRef.current)) return
        gapHealAtRef.current = nowMs
        watchdogTriesRef.current += 1
        // Fetch the fresh FULL series directly (no `since`) and INJECT it into SWR's
        // cache via mutate(payload, {revalidate:false}). This deterministically drives
        // the `[data]` effect's non-delta REPLACE branch → setData → the tail advances,
        // instead of relying on mutate()'s revalidation actually re-firing the paused
        // poll. Bounded: throttled 6s, only while the chart is demonstrably behind the
        // live feed, and a no-op REPLACE once caught up (the price sits within 2.5
        // intervals of the tail again → this branch stops firing).
        const _sym = sym, _tf = resolvedTf
        fetch(`/api/bars/${encodeURIComponent(_sym)}?tf=${_tf}&bars=${barCount}${_sessQ}`)
          .then(r => (r.ok ? r.json() : null))
          .then(payload => {
            // Guard against a ticker/tf switch mid-fetch, and against a stale payload.
            if (!payload?.bars?.length) return
            if (sym !== _sym || resolvedTf !== _tf) return
            if (payload.ticker && payload.ticker !== String(_sym).toUpperCase()) return
            barsMutateRef.current?.(payload, { revalidate: false })
          })
          .catch(() => { /* transient — next tick retries */ })
      } catch { /* watchdog must never throw */ }
    }, 8000)
    return () => clearInterval(id)
  }, [sym, resolvedTf, isIntraday, barCount])
}

// ── the per-(sym, tf) reset of the writers' state ──────────────────────────────────────────────
function useLiveReset(ctx) {
  const { sym, resolvedTf, _barsTf, lastBarRef, lastBarSymRef, liveBarRef, liveBarSeriesRef, barStartVolRef, latestLiveRef } = ctx

  // Reset all live tracking refs on symbol or timeframe change.
  // CRITICAL: latestLiveRef must also be cleared — without it, a leftover live
  // tick from the previous ticker (e.g. AAPL price) gets re-applied to the new
  // ticker's first bar in the post-setData re-apply at the bottom of updateChart,
  // producing a wrong wick on the first candle of the new ticker.
  useEffect(() => {
    lastBarRef.current = null
    lastBarSymRef.current = null   // developing bar no longer belongs to any sym until updateChart re-seeds it
    liveBarRef.current = null
    liveBarSeriesRef.current = null
    barStartVolRef.current = 0
    latestLiveRef.current = null
  }, [sym, resolvedTf, _barsTf])
}

// ── Writer A ───────────────────────────────────────────────────────────────────────────────────
function useWriterA(ctx) {
  const {
    sym, resolvedTf, livePrices, cs, replayMode, replayCutoffRef, _extendOverlaysLive, _liveSane, _timingIdRef,
    barStartVolRef, barsMutateRef, barsPushActiveRef, provisionalStaleRef, sessionOwnsDailyRef, gapHealAtRef,
    lastBarRef, lastBarSymRef, latestLiveRef, liveBarRef, liveTickRef, inExtWindowRef, sessionViewRef, showExtendedRef,
    candleSeriesRef, volumeSeriesRef, prevBarsRef, colorByNetChange, userCandleColors, boldCandles, modelBookLook, mbVolUp, mbVolDown,
  } = ctx
  const { _effLivePrice, isOhlcType, LIVE_TICK_FRESH_MS, BOLD_UP, BOLD_DOWN } = ctx.H
  const realtimeTfEligible = _realtimeTfEligibleFor(resolvedTf)
  // Real-time candle updates — tick-by-tick via WebSocket.
  // Detects bar period boundaries and creates NEW candles automatically.
  // Handles both OHLC types (candles/bars) and close-only types (line/area).
  useEffect(() => {
    const liveData = livePrices[sym]
    if (!liveData?.price) return
    // Skip live updates when replay mode is active — don't corrupt historical view.
    if (replayMode || replayCutoffRef.current) return   // replay/cutoff freezes the developing bar
    // HA bars depend on the full series history — skip tick-by-tick updates.
    // The chart still refreshes every 15s via SWR, which re-runs toHeikinAshi on
    // the full filteredBars array and calls setData() — accurate enough for HA.
    if (cs.heikinAshi) return
    // Writer A of the single-writer invariant (index @ barsPushActiveRef decl): when the
    // Massive push feed is authoritative, freeze this Finnhub tick writer ENTIRELY — no
    // series write AND no latestLiveRef update (the post-setData re-apply reads latestLiveRef;
    // a stale value there would repaint an old developing bar over the fresh push bar = the
    // 30s seam the plan review flagged).
    if (barsPushActiveRef.current) return
    // Freeze while a provisional stale-intraday cache is on screen — no live tick
    // may grow a phantom candle on the old tail before the full refetch swaps in.
    if (provisionalStaleRef.current) return
    // SYMBOL GUARD (intraday only — daily's Writer E has its own new-session guard):
    // lastBarRef/liveBarRef carry no symbol and a switch resets them via a DEFERRED
    // effect while this tick fires on its own clock, so a tick for the NEW sym could
    // fuse onto the PREVIOUS sym's same-bucket bar (the LRCX-O/H-on-ARM "close below
    // low" bug — a time-only guard can't tell two symbols' same 5m bucket apart). Only
    // fuse once lastBarRef is confirmed to own THIS sym.
    if (!['D', 'W', 'M'].includes(resolvedTf) && lastBarSymRef.current !== sym) return
    // NOTE: the D/W/M "defer the candle write to Writer E" early-return USED to sit
    // here — above the latestLiveRef update below. That stranded latestLiveRef at the
    // mount-time price on D/W/M (Writer A returned before ever updating it once Writer
    // E's tick went fresh), and Writer D's post-setData re-top then stamped that stale
    // price onto the daily candle every ~2s. The defer now runs AFTER latestLiveRef is
    // refreshed (search "defer the candle WRITE to Writer E" below).
    // Defensive: drop ticks with bad price BEFORE they touch liveBarRef.
    // Mirror of onRealtimeBar's guard. A single NaN / 0 / extreme price baked
    // into liveBarRef.current.high or .low persists across setData() refreshes
    // because the post-setData re-apply (~line 1170) trusts liveBarRef as the
    // authoritative developing-bar state. Without this guard the chart can
    // get stuck with a low of 0 (or extreme) until full page reload, dragging
    // EMA/SMA series into a V-shape collapse on intraday charts.
    const _p = _effLivePrice(liveData)
    // Single sanity chokepoint (see isSaneLivePrice): non-finite/<=0, or
    // >50% deviation from the last painted bar OR the poison-proof clean
    // server close. Mirror of the WS-bar path so they cannot diverge.
    if (!_liveSane(sym, _p)) return
    // ── GHOST-WICK GUARD (intraday, pre/post window) ──
    // It IS pre/post market by the ET clock, yet this snapshot carries no
    // extended session. That never means "the extended session ended" — it's a
    // poll where Massive returned an empty `lastTrade`, so the server's `price`
    // fell through to day.c / prevDay.c: the RTH or PRIOR close. isSaneLivePrice
    // can't catch it (a prior close is well within 50% of the live price), and
    // folding it into the developing pre-market candle is the reported bug — a
    // wick shooting down to the SAME price every few seconds with the axis tag
    // snapping to it, then both reverting on the next good poll. Dropped BEFORE
    // latestLiveRef so the post-setData re-top (writer D) can't repaint it from
    // there either. Bailing costs nothing: the next poll is ~2s away, and a
    // ticker with no extended print genuinely hasn't traded, so its bar
    // shouldn't move. (live_prices.py::_EXT_LAST now also re-serves the last
    // known ext print, so this should rarely fire — it's the belt to that
    // suspenders, and it holds if a future provider change reopens the hole.)
    if (!['D', 'W', 'M'].includes(resolvedTf) && inExtWindowRef.current && !liveData.ext_session) return
    // day_high / day_low can also arrive zero or stale during the first ticks
    // after market open. Treat 0 / negative / non-finite as "not provided" so
    // the bar's H/L don't snap to 0.
    const _dh = Number.isFinite(liveData.day_high) && liveData.day_high > 0 ? liveData.day_high : null
    const _dl = Number.isFinite(liveData.day_low) && liveData.day_low > 0 ? liveData.day_low : null
    const _do = Number.isFinite(liveData.day_open) && liveData.day_open > 0 ? liveData.day_open : null
    // prev_close is carried so the new-session classifier can recover a fresh
    // daily bar from the snapshot when the SSE stream is down (REST floor has
    // no updated_at) — last.close ≈ prev_close proves a new session is underway.
    const _pc = Number.isFinite(liveData.prev_close) && liveData.prev_close > 0 ? liveData.prev_close : null
    // Carry the live cumulative DAY volume — on D/W/M it IS the developing bar's
    // volume, and the re-top path (Writer D) below needs it to seed a client-created
    // "today" bar with a real figure instead of 0 (the "today's volume reads 0" bug
    // when the loaded bars still lag today's session).
    const _dv = Number.isFinite(liveData.volume) && liveData.volume > 0 ? liveData.volume : null
    latestLiveRef.current = { sym, price: _p, updated_at: liveData.updated_at,
      day_open: _do, day_high: _dh, day_low: _dl, prev_close: _pc, volume: _dv,
      ext_session: !!liveData.ext_session }
    // ── D/W/M: defer the candle WRITE to Writer E (the fast Massive 1-min tick) ──
    // Writer E owns the D/W/M developing candle; defer to it while its tick is fresh
    // so the two don't fight over the bar's close. CRITICAL: this runs AFTER the
    // latestLiveRef update above (not before it, as it once did) — latestLiveRef must
    // stay live because Writer D's post-setData re-top reads it. When it was stranded
    // at the mount-time price, Writer D stamped that stale close onto the daily candle
    // every ~2s (a live-volume-driven repaint) while Writer E corrected it: the "daily
    // snaps back to the price it showed at open every other tick" bug. Now only the
    // candle write is skipped; the ref tracks live, so Writer D re-tops with the
    // current price. Falls through to Writer A's own D/W/M write if Massive goes stale.
    if (!realtimeTfEligible) {
      const _ft = liveTickRef.current
      if (_ft && _ft.price != null && (Date.now() - _ft.ts) < LIVE_TICK_FRESH_MS) return
    }
    if (!candleSeriesRef.current || !lastBarRef.current) return
    if (['D', 'W', 'M'].includes(resolvedTf)) {
      // Writer A yields the D/W/M developing bar to the session-preview memo path
      // while it owns the bar (pre/post-market preview candle or frozen-at-4pm
      // regular candle). latestLiveRef stays updated above; only the candle write
      // is skipped so the two paths can't fight over the last bar's close/high/low.
      if (sessionOwnsDailyRef.current) return
      // Regular Hours mode: NEVER fold an extended-hours print into the daily
      // candle — even in the up-to-60s window after 4pm before useMarketOpen flips
      // isExtended (sessionFreezeActive gates off that laggy clock). ext_session is
      // a per-tick truth from the feed, and _effLivePrice already returned the ext
      // price into _p, so without this the post price seams the RTH candle.
      if (sessionViewRef.current === 'regular' && liveData.ext_session) return
    } else if (!showExtendedRef.current && liveData.ext_session) {
      // RTH-only intraday (EXT/RTH toggle off): same as Writer B — never fold a
      // pre/post-market print into the live intraday bar. (Writer A only reaches
      // intraday when the push feed isn't delivering; this is the fallback path.)
      return
    }
    const price = _p
    const last = lastBarRef.current
    const useOhlc = isOhlcType(cs.chartType)

    // Compute which bar period this tick belongs to.
    // CRITICAL: do NOT fall back to Date.now() — if a tick arrives without
    // updated_at (reconnect, stale cache, weekend straggler), wall-clock time
    // can land on a non-trading day and spawn a phantom Saturday/Sunday candle
    // next to Friday's real one. When the timestamp is missing, just keep
    // updating the last known bar in place.
    const tickSec = liveData.updated_at
    const live = latestLiveRef.current || {}
    const isIntradayTf = !['D', 'W', 'M'].includes(resolvedTf)
    // Single source of truth for the new-bar / update / skip decision (shared
    // with the post-setData re-apply below). For D/W/M it creates today's bar
    // from session OHLC even when the SSE stream is down and the tick carries
    // no timestamp (REST floor) — recovering the new session from the snapshot
    // (last.close ≈ prev_close) instead of fusing today's price onto a stale
    // prior-session candle (the "Frankenstein" bug, PAYO 2026-06-15). 'skip'
    // means a new D/W/M day with no confirmed session — leave yesterday alone.
    const decision = classifyLiveBar({
      tf: resolvedTf, last, live, tickSec, nowSec: Date.now() / 1000,
      session: liveStreamSession(showExtendedRef.current),
    })
    const barTime = decision.time != null ? decision.time : last.time
    // D2 arbitration: a fresh registry trade feed (Writer C) owns the same-bucket close.
    if (isIntradayTf && decision.kind === 'update' && _registryOwnsLiveClose(sym)) {
      // C paints the candle but never drags the MA overlays — keep doing that here, from
      // the close C owns, so the overlays still track the developing bar.
      try { _extendOverlaysLive(last.time, Number.isFinite(last.close) ? last.close : price) } catch { /* overlays not ready */ }
      return
    }

    try {
      if (decision.kind === 'skip') {
        // Intraday 'skip' from classifyLiveBar means the tick's bucket is PAST the
        // tail (its contiguity / REST-floor behind-guard fired) → the series has
        // stalled behind live (the stalled-SWR-poll freeze; same class Writer B
        // self-heals). Force a throttled SWR revalidation to pull the missing bars.
        // D/W/M 'skip' is an unconfirmed-session case (not a gap) — don't heal there.
        if (isIntradayTf) {
          const _nowMs = Date.now()
          if (_nowMs - gapHealAtRef.current > 4000) {
            gapHealAtRef.current = _nowMs
            try { barsMutateRef.current?.() } catch { /* mutate unbound mid-mount */ }
          }
        }
        return
      }
      if (decision.kind === 'new') {
        // ── NEW CANDLE ──
        const isDailyWeekly = !isIntradayTf
        // Daily/Weekly: use session OHLC. Intraday: use current tick as open (closest to actual first trade)
        const openPrice = (isDailyWeekly && live.day_open) ? live.day_open : price
        const highPrice = isDailyWeekly ? Math.max(live.day_high || openPrice, price) : price
        const lowPrice = isDailyWeekly ? Math.min((live.day_low && live.day_low > 0) ? live.day_low : openPrice, price) : price

        // Initialize tick-accurate tracking for this bar
        // T4 — forming bar active (writer A, the quote-synthesised path that owns
        // the candle while VITE_REALTIME_BARS is held at 0). Marked here too so the
        // instrument reports what members ACTUALLY get, not only the intended path.
        timingMark(_timingIdRef.current, 'T4', { formingAt: barTime })
        // If another writer (C, or D re-appending a bucket the poll hasn't seen yet) already
        // opened THIS bucket, fold into it — re-seeding o=h=l=price here SHRANK the new
        // candle's range to the current print (lastBarRef can lag liveBarRef by a bucket).
        const _lbA = liveBarRef.current
        const _keepA = isIntradayTf && _lbA && _lbA.time === barTime && isCompleteOhlc(_lbA)
        // Intraday: a quote is not the bucket's first trade, so the open we draw from it is
        // PROVISIONAL (lib/liveBarMerge I6) — the push seed / fetched bucket replaces it.
        liveBarRef.current = _keepA
          ? { ...foldPrice(_lbA, price, null, resolvedTf).bar }
          : isIntradayTf ? provisionalOpen(barTime, price)
          : { time: barTime, open: openPrice, high: highPrice, low: lowPrice, close: price }
        barStartVolRef.current = liveData.volume || 0
        // D/W/M: the developing bar spans the whole day, so the live cumulative DAY
        // volume IS its volume — seed it now instead of 0 (else "today's volume reads
        // 0" until a full volData setData catches up). Intraday: a new bucket really
        // starts near 0 (overlaying the day total is the phantom-volume-spike bug).
        const _newVol = _keepA ? (Number(_lbA.volume) || 0)
          : isDailyWeekly && Number.isFinite(liveData.volume) && liveData.volume > 0 ? liveData.volume : 0

        if (useOhlc) {
          candleSeriesRef.current.update(liveBarRef.current)
          lastBarRef.current = { ...liveBarRef.current, volume: _newVol }
        } else {
          candleSeriesRef.current.update({ time: barTime, value: price })
          lastBarRef.current = { ...liveBarRef.current, volume: _newVol }
        }
        if (_keepA) liveBarRef.current.volume = _newVol
        if (volumeSeriesRef.current) {
          // Full-opacity default color (matches closed bars + volData) — no lighter
          // "developing" tint. Intraday value is 0 (invisible until the next tick);
          // D/W/M carries the live day volume so the pane isn't a phantom zero bar.
          const _vUpN = userCandleColors ? (cs.volume.upColor || mbVolUp) : boldCandles ? mbVolUp : modelBookLook ? BOLD_UP : cs.volume.upColor
          volumeSeriesRef.current.update({ time: barTime, value: _newVol, color: _vUpN })
        }
        _extendOverlaysLive(barTime, price)
      } else {
        // ── SAME CANDLE (decision.kind === 'update') ──
        // The "new D/W/M day without confirmed session" case is now handled by
        // decision.kind === 'skip' above (returns early), so reaching here means
        // the tick genuinely belongs to the current last bar.

        // liveBarRef only describes THIS candle when its time matches — after a poll it
        // can legitimately sit one bucket AHEAD of lastBarRef (reconcileWithServerTail
        // keeps a bucket the server hasn't seen), and borrowing its H/L painted the next
        // bucket's range onto this one.
        const _lbU = (liveBarRef.current && liveBarRef.current.time === last.time) ? liveBarRef.current : null
        if (isIntradayTf) {
          // A held bucket newer than the series tail: this tick is for an OLDER bucket
          // (classifyLiveBar said 'update' to the tail) — never let it touch either.
          if (liveBarRef.current && liveBarRef.current.time > last.time) return
          // Bucket by the TRADE's time: a late print from the previous bucket (tick time
          // before this candle's start) is 'earlier' and must not snap the close back
          // or stretch the wick of the candle that's forming now.
          if (Number.isFinite(tickSec)) {
            const _fA = foldPrice(_lbU || last, price, toChartTime(tickSec), resolvedTf,
              liveStreamSession(showExtendedRef.current))
            if (_fA.kind !== 'update') return
          }
        }
        // Track in liveBarRef (survives setData wipes)
        if (_lbU) {
          // eslint-disable-next-line react-hooks/immutability -- moved verbatim (P3-S2): the held bar is mutated in place
          _lbU.high = Math.max(_lbU.high, price)
          _lbU.low = Math.min(_lbU.low, price)
          _lbU.close = price
        }

        const updated = {
          time: last.time,
          open: last.open,
          high: _lbU ? _lbU.high : Math.max(last.high, price),
          low: _lbU ? _lbU.low : Math.min(last.low, price),
          close: price,
        }
        if (useOhlc) {
          candleSeriesRef.current.update(updated)
        } else {
          candleSeriesRef.current.update({ time: last.time, value: price })
        }

        // Volume: intraday leaves the API-provided per-bar volume to stand (refreshes
        // every 15s; live delta calcs are unreliable). D/W/M, though, keeps the
        // developing bar's volume ticking from the live cumulative DAY volume so it
        // never sits frozen at 0 / a stale value when the loaded bars lag today's
        // session (the "today's volume reads 0" bug). Only grows (day volume is
        // monotonic), so a stale/degraded read can't shrink it.
        let _updVol = last.volume
        if (!isIntradayTf && Number.isFinite(liveData.volume) && liveData.volume > (last.volume || 0)) {
          _updVol = liveData.volume
          if (volumeSeriesRef.current) {
            const _prevC = colorByNetChange && prevBarsRef.current && prevBarsRef.current.length >= 2
              ? prevBarsRef.current[prevBarsRef.current.length - 2].c : null
            const _isUpU = _prevC != null ? (updated.close >= _prevC) : (updated.close >= updated.open)
            const _vUpU = userCandleColors ? (cs.volume.upColor || mbVolUp) : boldCandles ? mbVolUp : modelBookLook ? BOLD_UP : cs.volume.upColor
            const _vDownU = userCandleColors ? (cs.volume.downColor || mbVolDown) : boldCandles ? mbVolDown : modelBookLook ? BOLD_DOWN : cs.volume.downColor
            volumeSeriesRef.current.update({ time: updated.time, value: _updVol, color: _isUpU ? _vUpU : _vDownU })
          }
        }
        lastBarRef.current = { ...updated, volume: _updVol }
        _extendOverlaysLive(last.time, price)
      }
    } catch (e) {
      if (e?.message) console.warn('[StockChart] live update error:', e.message)
    }
  }, [livePrices, sym, resolvedTf, cs.chartType, replayMode, _extendOverlaysLive])
}

// ── Writer B ───────────────────────────────────────────────────────────────────────────────────
/** @returns {Function} onRealtimeBar (the tf-switch hold fold replays held frames through it) */
function usePushWriterB(ctx) {
  const {
    sym, resolvedTf, filteredBars, showExtended, liveUpdates, cs, replayMode, replayCutoffRef, tfSwitchHoldRef, heldPushRef,
    _extendOverlaysLive, _liveSane, _timingIdRef, barsMutateRef, barsPushActiveRef, provisionalStaleRef, gapHealAtRef,
    lastBarRef, lastBarSymRef, liveBarRef, showExtendedRef, candleSeriesRef, volumeSeriesRef, prevBarsRef,
    colorByNetChange, userCandleColors, boldCandles, modelBookLook, mbVolUp, mbVolDown,
  } = ctx
  const { isOhlcType, PERIOD_SECONDS, BOLD_UP, BOLD_DOWN, _barsPushEnabled } = ctx.H
  // Real-time bar streaming (Phase 4) — Massive AM events.
  // 60-min was added 2026-05-22 once the backend rollup adopted the canonical
  // ET-anchored bucket function (bars_fetch.bucket_60_et_unix_seconds) — the
  // same one the REST resample uses — so WS bars and REST bars now align bit-
  // identically and can't drift across DST or the 9:30 RTH-open anchor.
  // Keep this list in sync with backend ROLLUP_TFS (api/services/bar_broadcaster.py)
  // and the tf allow-list in api/routers/stream.py:stream_bars.
  // Coexists with the tick-driven useEffect above:
  //  - Tick logic drives sub-second flicker on the current developing candle
  //  - AM events deliver authoritative just-closed minute bars (1m chart) or
  //    server-rolled partial bucket bars (5/15/30/60m charts)
  //  - When an AM bar matches liveBarRef/lastBarRef.time, we sync them so the
  //    next tick iteration doesn't overwrite the authoritative values
  const realtimeTfEligible = ['1', '5', '15', '30', '60'].includes(resolvedTf)

  const onRealtimeBar = useCallback((data) => {
    if (!candleSeriesRef.current) return
    // Never paint a live bar onto a historical replay (mirror of writers A + C). When
    // push is authoritative B is THE writer, so without this it would append a live
    // candle onto the replayed slice (review #4).
    if (replayMode || replayCutoffRef.current) return   // replay/cutoff freezes the developing bar
    // Defensive: a POOLED bars connection carries many (sym,tf) pairs. The pool
    // dispatches by key, but never apply a bar that isn't ours — cross-symbol
    // application (MSFT's OHLC on the AAPL series) is a data-doubt bug, so guard
    // here too (belt-and-suspenders against any future pool regression).
    if (data?.sym && String(data.sym).toUpperCase() !== String(sym).toUpperCase()) return
    if (data?.tf != null && String(data.tf) !== String(resolvedTf)) return
    // ⛔ A TIMEFRAME-SWITCH HOLD OWNS THE CANVAS. The series on screen is still the OUTGOING
    // tf's, and the developing-bar refs were reset for the new one — a push frame (the new
    // tf's subscribe seed often lands before REST) would be planted as a "new" bar on the
    // held old series (a 5m candle beside the 60m bar). Buffer the latest frame per bucket
    // for THIS series and fold it once the new tf's real paint lands (effect after updateChart).
    if (tfSwitchHoldRef.current) {
      if (data?.bar && Number.isFinite(data.bar.t)) {
        const k = `${sym}|${resolvedTf}`
        if (!heldPushRef.current || heldPushRef.current.key !== k) heldPushRef.current = { key: k, frames: new Map() }
        const fr = heldPushRef.current.frames
        fr.delete(data.bar.t); fr.set(data.bar.t, data)
        while (fr.size > 4) fr.delete(fr.keys().next().value)
      }
      return
    }
    // Writer B of the single-writer invariant (index @ barsPushActiveRef decl) — B IS the
    // push writer, so it paints ONLY when push is AUTHORITATIVE (delivering). In the transient
    // connected-but-not-yet-delivering window (the first bar; a flap near the recency boundary)
    // the Finnhub writers are still active, so painting here too would DUAL-WRITE the developing
    // bar (jitter on thin tickers). delivering is tracked independently by the pool, so this is a
    // clean one-bar handoff — Finnhub covers the transition bar, then B takes over.
    if (!barsPushActiveRef.current) return
    // Freeze while the provisional stale-intraday cache is on screen (see Writer A).
    if (provisionalStaleRef.current) return
    // SYMBOL GUARD (mirror of Writers A/C): lastBarRef/liveBarRef are re-seeded for the new
    // symbol only after its bars setData; until then they still describe the PREVIOUS
    // symbol's same-time bucket, and merging into it painted the old symbol's open/high/low
    // on the new chart. Wait for the series to own this sym.
    if (lastBarSymRef.current !== sym) return
    // Session the server aligned this frame to (60m only: RTH 9:30-aligned vs ETH clock
    // hours). A frame tagged for the OTHER mode is a straggler from before an RTH/ETH
    // toggle re-subscribed — its bucket times don't belong on this series.
    // Wire session from the 60m GRID policy, not the view (see barTime.liveStreamSession).
    const _barSession = liveStreamSession(showExtendedRef.current)
    // The server puts `session` on the MESSAGE (bar_broadcaster._msg); accept it on the
    // bar too in case that ever moves.
    const _frameSession = typeof data?.session === 'string' ? data.session
      : (typeof data?.bar?.session === 'string' ? data.bar.session : null)
    if (String(resolvedTf) === '60' && _frameSession != null
        && _frameSession.toLowerCase() !== _barSession) return
    // AM `t` is bucket-start in ms. Convert to seconds AND shift to chart time so
    // the time matches the rest of the chart series — REST bars stored via
    // setData(ohlcData) where ohlcData uses adjustTime(b.t) = toChartTime(b.t).
    // Without this offset, Phase 4 update() lands at a time that conflicts
    // with the series and is silently dropped by lightweight-charts.
    const tSec = toChartTime(Math.floor(data.bar.t / 1000))
    const useOhlc = isOhlcType(cs.chartType)

    // RTH-only intraday (EXT/RTH toolbar toggle = off): drop live pre/post-market
    // bars, the same 9:30–16:00 ET window sessionBars filters the FETCHED data to.
    // Without this the CURRENT extended session leaks onto an RTH-only chart via
    // the live push feed (past ext sessions are already filtered out of history).
    if (!showExtendedRef.current && !['D', 'W', 'M'].includes(resolvedTf)) {
      if (!isRthBar(Math.floor(data.bar.t / 1000))) return
    }

    // Defensive: skip bars with invalid OHLC. WS sources can occasionally
    // emit zero / NaN / nonsensical values at bar boundaries or during
    // reconnect; without this guard the chart paints a tall bar spanning
    // from 0 to the current price, throwing off auto-scale and producing
    // the "extreme thin vertical bar at right edge" rendering bug the user
    // has reported repeatedly across intraday charts (60min especially).
    const o = data.bar.o, h = data.bar.h, l = data.bar.l, c = data.bar.c
    const allFinitePositive = [o, h, l, c].every(v => Number.isFinite(v) && v > 0)
    if (!allFinitePositive || l > h) {
      return  // silently drop the bad bar — next tick will repaint correctly
    }
    // Single sanity chokepoint (see isSaneLivePrice) — same gate as the
    // snapshot-tick path so the two can never diverge (divergent inline
    // guards are exactly how the 100x phantom slipped through).
    if (!_liveSane(sym, c)) {
      return
    }

    // ── Contiguity guard (mirror of classifyLiveBar's intraday guard) ──
    // Writer B plants push bars by their OWN bucket time via series.update(). If the
    // on-screen tail (lastBarRef, seeded from the fetched series on every setData) is
    // MORE than one interval behind this push bar, the buckets in between are missing
    // — the REST/SWR series is stale or still loading (post-deploy cold start, a slow
    // ticker-switch, an in-flight full refetch). Planting here drops a LONE developing
    // candle detached from the stale tail: the reported "yesterday's full session +
    // one giant candle up to now" and "4-5 candles missing before the live one"
    // artifacts. classifyLiveBar already guards the Finnhub writers against exactly
    // this, but Writer B bypasses it — so replicate the guard here. SKIP; the
    // stale-tail full refetch (idbStaleIntraday, keyed off the same tail) fills the
    // gap, then push bars land contiguously. Intraday only — D/W/M new-session
    // handling differs (see classifyLiveBar). Also skips the legit overnight/weekend
    // session jump until the refetch lands the new session's earlier bars.
    if (!['D', 'W', 'M'].includes(resolvedTf)) {
      const _pbTail = lastBarRef.current
      const _periodB = PERIOD_SECONDS[resolvedTf] || 300
      if (_pbTail && Number.isFinite(_pbTail.time) && tSec - _pbTail.time > _periodB) {
        // Behind: the series tail lags this live push bar by >1 interval, so the
        // steady-state advance (the 30s SWR delta poll) has STALLED — e.g. a deploy
        // dropped every SSE and the visibility-gated refreshInterval never resumed,
        // freezing the chart at its load point (reported: half a watchlist stuck at
        // the same minute, tick not moving, across TSLA/NVDA/MU). Skipping alone
        // would keep it frozen forever (every push bar stays ahead of the stale
        // tail). Self-heal: force an immediate SWR revalidation (throttled) — mutate()
        // fires even while interval polling is paused, and the backend is
        // authoritative + proven fresh, so the refetch replaces/merges the missing
        // closed bars; once the tail catches up, push bars plant contiguously again.
        const _nowMs = Date.now()
        if (_nowMs - gapHealAtRef.current > 4000) {
          gapHealAtRef.current = _nowMs
          try { barsMutateRef.current?.() } catch { /* mutate unbound mid-mount */ }
        }
        return
      }
    }

    // Merge, don't overwrite: a Massive WS rollup for the CURRENT bucket may have only
    // accumulated since we subscribed (fresh ticker / tf switch), so its o/h/l can be a
    // partial slice of the bucket. Preserve the true OPEN and only EXTEND high/low from
    // the developing bar we already have (seeded from the fetched partial bar), so the
    // current candle keeps its full-so-far range instead of collapsing to the WS window.
    // Shared rules (lib/liveBarMerge.mergePushBar): open set once, H only rises / L only
    // falls, volume never decreases within the bucket, a server FINAL bar is the truth, a
    // late frame for an EARLIER bucket never repaints the live candle, and an out-of-order
    // frame (older trade_ts) can't move the close back.
    const _lbB = liveBarRef.current
    const _prevB = (_lbB && _lbB.time >= tSec) ? _lbB
      : (lastBarRef.current ? { ...lastBarRef.current, sym } : null)
    const _mB = mergePushBar(_prevB, { time: tSec, open: o, high: h, low: l, close: c, volume: Number(data.bar.v) || 0 }, {
      sym, final: data.bar.final === true, tradeTs: Number.isFinite(data.bar.trade_ts) ? data.bar.trade_ts : null,
      tf: resolvedTf, toChart: toChartTime, session: _barSession,
    })
    if (_mB.kind === 'correct') {
      // The server's late FINAL correction of an already-closed bucket (older t than the
      // developing bar). Replace THAT bar in place — update(bar, historicalUpdate=true),
      // LWC 5.1+ — and only when the series actually holds that time (a plain update()
      // with an older time throws). The developing candle and its refs are untouched.
      try {
        const _cb = _mB.bar
        const _series = candleSeriesRef.current
        const _has = typeof _series.data === 'function' && _series.data().some(p => p && p.time === _cb.time)
        if (!_has) return
        if (useOhlc) _series.update({ time: _cb.time, open: _cb.open, high: _cb.high, low: _cb.low, close: _cb.close }, true)
        else _series.update({ time: _cb.time, value: _cb.close }, true)
        const _vs = volumeSeriesRef.current
        if (_vs && typeof _vs.data === 'function' && _vs.data().some(p => p && p.time === _cb.time)) {
          const _prior = _vs.data().find(p => p && p.time === _cb.time)
          _vs.update({ ..._prior, time: _cb.time, value: _cb.volume }, true)
        }
        if (lastBarRef.current && lastBarRef.current.time === _cb.time) {
          lastBarRef.current = { time: _cb.time, open: _cb.open, high: _cb.high, low: _cb.low, close: _cb.close, volume: _cb.volume }
        }
      } catch { /* refused historical write — the next poll's setData carries the corrected bar */ }
      return
    }
    if (_mB.kind !== 'new' && _mB.kind !== 'update') return
    const _barB = _mB.bar
    const _oB = _barB.open, _hB = _barB.high, _lB = _barB.low, _cB = _barB.close, _vB = _barB.volume
    try {
      if (useOhlc) {
        candleSeriesRef.current.update({
          time: tSec,
          open: _oB, high: _hB, low: _lB, close: _cB,
        })
      } else {
        candleSeriesRef.current.update({ time: tSec, value: _cB })
      }
      if (volumeSeriesRef.current) {
        const _pb = prevBarsRef.current
        const _prevC = colorByNetChange && _pb && _pb.length >= 2 ? _pb[_pb.length - 2].c : null
        const _up = _prevC != null ? (_cB >= _prevC) : (_cB >= _oB)
        // Full-opacity default color (same derivation as volData) — the developing
        // bar matches the closed bars instead of a lighter tint.
        const _vUp = userCandleColors ? (cs.volume.upColor || mbVolUp) : boldCandles ? mbVolUp : modelBookLook ? BOLD_UP : cs.volume.upColor
        const _vDown = userCandleColors ? (cs.volume.downColor || mbVolDown) : boldCandles ? mbVolDown : modelBookLook ? BOLD_DOWN : cs.volume.downColor
        volumeSeriesRef.current.update({
          time: tSec,
          // The incoming push-bar's volume. (A phantom `_volB` shipped 2026-07-21
          // here — the surrounding try/catch swallowed the ReferenceError, which
          // silently killed writer B's volume update AND the liveBarRef/lastBarRef
          // advancement below it on every push tick.)
          // Never-decreasing within the bucket (D8): max(held, pushed).
          value: _vB,
          color: _up ? _vUp : _vDown,
        })
      }
      // B is the SOLE writer here (gated on barsPushActive above), so it OWNS these refs —
      // create-or-advance for THIS bar unconditionally, so at a bucket rollover they follow the
      // new bar even though the Finnhub writers are suppressed. Carry VOLUME on liveBarRef so the
      // post-setData re-top can restore it (else the developing bar shows ~30s-stale server
      // volume until the next AM push — a volume flicker every SWR poll, retro-audit #5).
      // T4 — forming bar active (writer B, the authoritative push path).
      timingMark(_timingIdRef.current, 'T4', { formingAt: tSec })
      liveBarRef.current = { ..._barB }
      lastBarRef.current = { time: tSec, open: _oB, high: _hB, low: _lB, close: _cB, volume: _vB }
      // Drag the MA overlays out to this developing bar (see _extendOverlaysLive).
      _extendOverlaysLive(tSec, _cB)
    } catch {
      // lightweight-charts throws if `time` regresses below the series' last bar.
      // Silently ignore — out-of-order frames are rare and self-correct on next bar.
    }
  }, [cs.chartType, sym, resolvedTf, replayMode, _extendOverlaysLive])

  const onRealtimeReconnect = useCallback((lastBarT) => {
    // On ANY (re)connect of the bars stream, ALSO revalidate the closed-bar SWR poll.
    // The `since` backfill below only patches the DEVELOPING candle (via onRealtimeBar);
    // the CLOSED bars come from the /api/bars SWR poll, which uses refreshWhenHidden:false
    // and does NOT auto-revalidate on an SSE reconnect (SWR's revalidateOnReconnect fires
    // only on navigator.onLine). So a backend restart — every deploy drops all SSE at once
    // — leaves the closed-bar series frozen at its load point until something kicks it (the
    // "frozen after deploy" class). mutate() fires even while interval polling is paused.
    // This is what makes a reconnect invisible for the chart, the way the price feed's 2s
    // poll already makes reconnects invisible for the header/watchlist price.
    try { barsMutateRef.current?.() } catch { /* mutate unbound mid-mount */ }
    // Gap-backfill on reconnect — uses the existing `since` param of /api/bars.
    // `since` filters with strict > (see _get_bars_since_response). Subtract 1ms
    // so the bar at lastBarT is INCLUDED — covers the case where a bar updated
    // during the disconnect window and we need its authoritative server value.
    if (lastBarT == null || !sym) return
    const sinceMs = Math.max(0, lastBarT - 1)
    fetch(`/api/bars/${encodeURIComponent(sym)}?tf=${encodeURIComponent(resolvedTf)}${barsSessionQuery(resolvedTf, showExtendedRef.current)}&since=${sinceMs}`)
      .then(r => r.ok ? r.json() : null)
      .then(payload => {
        if (!payload?.bars?.length) return
        for (const b of payload.bars) {
          // /api/bars returns t in unix SECONDS, but onRealtimeBar expects ms
          // (matching the AM event shape). Multiply by 1000 to reconcile.
          onRealtimeBar({ sym, tf: resolvedTf, bar: { t: b.t * 1000, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v } })
        }
      })
      .catch(e => {
        if (e?.message) console.warn('[StockChart] gap-backfill failed:', e.message)
      })
  }, [sym, resolvedTf, onRealtimeBar])

  // Reactivity for the canary flag: setting/clearing localStorage 'uct.barsPush.enabled'
  // takes effect on the next render with NO page reload (the plan's instant runtime
  // revert). 'storage' fires cross-tab; a same-tab write dispatches 'uct-barspush-change'.
  const [, _bumpPushGate] = useState(0)
  useEffect(() => {
    const onChange = (e) => {
      if (!e || e.key == null || e.key === 'uct.barsPush.enabled' || e.type === 'uct-barspush-change') {
        _bumpPushGate(n => n + 1)
      }
    }
    window.addEventListener('storage', onChange)
    window.addEventListener('uct-barspush-change', onChange)
    return () => {
      window.removeEventListener('storage', onChange)
      window.removeEventListener('uct-barspush-change', onChange)
    }
  }, [])

  // Whether THIS chart subscribes to the bars pool + paints push, per _barsPushEnabled()
  // (currently default-ON at 100% rollout; a browser opts out with localStorage
  // 'uct.barsPush.enabled'='0'). Gating the SUBSCRIPTION on it is what made the rollout %
  // the real cohort lever (review blocker #1). VITE_REALTIME_BARS is an additional
  // compile-time cohort gate inside the hook.
  // !cs.heikinAshi: HA needs the full-series toHeikinAshi() recompute (which the 15s SWR
  // refresh does), NOT incremental raw-OHLC push updates. Under HA the chart neither
  // subscribes nor suppresses Finnhub — writers A/C already `if (cs.heikinAshi) return`, and
  // without this push writer B would paint a RAW candle amid HA-smoothed bars (retro-audit bug).
  // Defensive 60m grid guard: the push stream buckets 60m TradingView-style (RTH 9:30,
  // 10:30 … ; ETH clock hours). If the FETCHED 60m series is still on another grid (the
  // legacy 9:30-then-10:00 REST resample), push bars would land BETWEEN fetched bars, so
  // don't opt in — the fallback writers keep the candle on the series' own buckets.
  const _sixtyOffGrid = useMemo(() => {
    if (resolvedTf !== '60' || !Array.isArray(filteredBars) || !filteredBars.length) return false
    // On-grid = a bucket start on the grid this view's stream session uses (half-day
    // aware: 13:00/14:00 post-close bars on a 13:00 close day are legitimately on it).
    for (let i = Math.max(0, filteredBars.length - 60); i < filteredBars.length; i++) {
      const t = filteredBars[i]?.t
      if (typeof t !== 'number') continue
      if (!isOnSixtyMinGrid(t, !!showExtended)) return true
    }
    return false
  }, [resolvedTf, filteredBars, showExtended])
  const _pushOptIn = _barsPushEnabled() && realtimeTfEligible && liveUpdates && !cs.heikinAshi && !_sixtyOffGrid
  const _barsPush = useRealtimeBars({
    symbol: _pushOptIn ? sym : null,
    tf: _pushOptIn ? resolvedTf : null,
    // 60m bucket alignment follows the chart's session mode (server: RTH 9:30-aligned,
    // ETH clock hours) so pushed buckets land on the fetched series' bucket times.
    session: liveStreamSession(showExtended),
    onBar: onRealtimeBar,
    onReconnect: onRealtimeReconnect,
  })
  // Single-writer gate: engage push ONLY when opted-in, AND the pool is actually
  // DELIVERING recent bars for this (sym,tf) — never suppress the Finnhub writers on a
  // merely-connected or silently-frozen feed (that would freeze the candle while ● LIVE
  // still shows). delivering is bar-recency-gated in barsStreamManager.
  // eslint-disable-next-line react-hooks/refs -- moved verbatim (P3-S2); the legacy single-writer flag is a per-render mirror
  barsPushActiveRef.current = _pushOptIn && _barsPush.delivering
  return onRealtimeBar
}

// ── Writer D (inside updateChart, after setData) ───────────────────────────────────────────────
/** Writer D's push re-top. THE BRANCH (not a guard): push owns the developing bar and no
 *  provisional stale cache is on screen (Writer D freeze). False ⇒ the caller's Finnhub branch. */
function legacyPushRetop(ctx) {
  const {
    liveBarRef, lastBarRef, barsPushActiveRef, provisionalStaleRef, cs, candleSeriesRef, volumeSeriesRef, prevBarsRef,
    colorByNetChange, userCandleColors, boldCandles, modelBookLook, mbVolUp, mbVolDown,
  } = ctx
  const { isOhlcType, BOLD_UP, BOLD_DOWN } = ctx.H
  if (!barsPushActiveRef.current || provisionalStaleRef.current) return false
  // Writer D of the single-writer invariant (index @ barsPushActiveRef decl) — a BRANCH,
  // not a guard: push authoritative → re-top with the PUSH-owned developing bar (liveBarRef,
  // maintained by onRealtimeBar), NOT the frozen Finnhub latestLiveRef. Without this
  // the ~30s-stale server developing bar from _applyData would seam every SWR poll
  // (review #7). Guard time-regress (server tail may be ahead of the last push bar).
  const lb = liveBarRef.current
  if (lb && lb.time != null && Number.isFinite(lb.close) && lb.close > 0) {
    try {
      // (P3-S2: one call — a ternary point instead of an if/else pair; same writes.)
      candleSeriesRef.current.update(isOhlcType(cs.chartType)
        ? { time: lb.time, open: lb.open, high: lb.high, low: lb.low, close: lb.close }
        : { time: lb.time, value: lb.close })
      // The series tail is now the live bar (same bucket, or one re-appended past the
      // fetched tail) — keep lastBarRef in step so B's contiguity/merge and A/C see it.
      if (!lastBarRef.current || lb.time >= lastBarRef.current.time) {
        lastBarRef.current = { time: lb.time, open: lb.open, high: lb.high, low: lb.low, close: lb.close,
          volume: Number.isFinite(lb.volume) ? lb.volume : (lastBarRef.current?.volume || 0) }
      }
      // Restore the push-owned volume too — else the volume bar shows ~30s-stale server
      // volume until the next AM push (a flicker every SWR poll, retro-audit #5).
      if (volumeSeriesRef.current && Number.isFinite(lb.volume)) {
        const _pbD = prevBarsRef.current
        const _prevCD = colorByNetChange && _pbD && _pbD.length >= 2 ? _pbD[_pbD.length - 2].c : null
        const _upD = _prevCD != null ? (lb.close >= _prevCD) : (lb.close >= lb.open)
        // Full-opacity default color (same derivation as volData) — no lighter tint.
        const _vUpD = userCandleColors ? (cs.volume.upColor || mbVolUp) : boldCandles ? mbVolUp : modelBookLook ? BOLD_UP : cs.volume.upColor
        const _vDownD = userCandleColors ? (cs.volume.downColor || mbVolDown) : boldCandles ? mbVolDown : modelBookLook ? BOLD_DOWN : cs.volume.downColor
        volumeSeriesRef.current.update({
          time: lb.time, value: lb.volume,
          color: _upD ? _vUpD : _vDownD,
        })
      }
    } catch { /* server tail newer than the last push bar — ignore, next push bar re-tops */ }
  }
  return true
}

/** updateChart's post-candle-setData step: seed the held developing bar from the fetched tail,
 *  re-top it (push / Finnhub), and re-append a live bucket the poll has not seen yet. */
function legacyAfterSetData(ctx) {
  const {
    sym, resolvedTf, filteredBars, isIntraday, adjustTime, livePrices, cs, _liveSane, respNewestTRef,
    lastBarRef, lastBarSymRef, liveBarRef, liveBarSeriesRef, latestLiveRef, barsPushActiveRef, provisionalStaleRef,
    sessionOwnsDailyRef, sessionViewRef, showExtendedRef, candleSeriesRef, volumeSeriesRef,
    userCandleColors, boldCandles, modelBookLook, mbVolUp, mbVolDown,
  } = ctx
  const { _effLivePrice, isOhlcType, BOLD_UP, BOLD_DOWN } = ctx.H
  // Store the last bar for live updates
  if (filteredBars.length) {
    const last = filteredBars[filteredBars.length - 1]
    // Use adjustTime so lastBarRef.time matches the chart series + computeBarTime
    lastBarRef.current = { time: adjustTime(last.t), open: last.o, high: last.h, low: last.l, close: last.c, volume: last.v || 0 }
    // 🔴 DAILY cross-ticker guard. liveBarRef (the ref Writer D re-tops from after
    // setData) is re-seeded per-sym ONLY for intraday below (`!['D','W','M']`), and two
    // stocks' "today" daily bars share the SAME timestamp — so a time-based staleness
    // check can't tell them apart. On a fast switch, a new user's chart could keep the
    // PREVIOUS ticker's developing bar and let Writer D stamp its price onto this chart:
    // the "$3 bar on a $100 stock" that breaks the y-scale and blacks out the chart.
    // When the SYMBOL changed (lastBarSymRef still holds the prior sym / null), clear a
    // stale D/W/M liveBarRef so Writer D re-tops from lastBarRef — just seeded to THIS
    // sym above — instead. Same-sym polls (lastBarSymRef === sym) keep the live bar, so
    // the developing-candle machinery is untouched. Intraday is already guarded (the
    // per-sym re-seed below + Writer A's lastBarSymRef check).
    if (['D', 'W', 'M'].includes(resolvedTf) && lastBarSymRef.current !== sym) {
      liveBarRef.current = null
    }
    // filteredBars is gated to the CURRENT sym (idbReady/_netMatches/memPeek(sym)), so
    // the bar we just seeded owns `sym` — tag it. The live-overlay consumers refuse to
    // fuse when this != their sym (the cross-ticker developing-bar contamination guard).
    const _lbOwnerSym = lastBarSymRef.current   // who the held developing bar belonged to
    lastBarSymRef.current = sym
    // ⛔ THE HELD DEVELOPING BAR BELONGS TO ONE SERIES (sym + tf), NOT JUST ONE SYMBOL.
    // The reset effect below the writers is PASSIVE, so on a timeframe switch this seed
    // runs first while liveBarRef still holds the OUTGOING tf's developing bar. Same sym,
    // so every sym guard passed, and reconcile kept it as "one bucket ahead" — the old
    // tf's candle (e.g. a 15m 12:45 bar, off the 30m grid) was re-topped onto the new
    // tf's series: a bogus extra right-edge candle that shifted the frame and vanished on
    // the next setData. A bar held for another series is no bar at all here.
    if (liveBarSeriesRef.current !== `${sym}|${resolvedTf}`) liveBarRef.current = null
    liveBarSeriesRef.current = `${sym}|${resolvedTf}`
    // (The live-tick sanity baseline `lastServerCloseRef` is set by updateChart itself, for
    // both bar sources, right before this step.)
    // Seed/merge liveBarRef (the ref the push re-top / Writer D re-applies from) with
    // the FETCHED partial bar's FULL open+high+low. Without this, the re-top re-paints
    // the developing bar from a WS rollup that only accumulated since we subscribed,
    // collapsing the current candle to the "since you opened it" window — the reported
    // "bar shows correct data for a moment, then loses it until ~10s after close" bug.
    // Intraday only.
    if (!['D', 'W', 'M'].includes(resolvedTf)) {
      const _lt = adjustTime(last.t)
      const _lb = liveBarRef.current
      // lib/liveBarMerge.reconcileWithServerTail — the same rules as the comment below,
      // PLUS: a developing bar ONE bucket past the fetched tail (the live writer opened it,
      // the poll hasn't ingested it) is KEPT and re-appended by the re-top, never replaced
      // by the closed server bar. Replacing it blanked the new candle on every poll in a
      // bucket's first ~30s and then re-opened it at o=h=l=current price (the "new candle
      // glitches / its low disappears" report). Volume = max(server, live), never down.
      const _rec = reconcileWithServerTail(_lb ? { ..._lb, sym: _lb.sym ?? _lbOwnerSym } : null,
        { time: _lt, open: last.o, high: last.h, low: last.l, close: last.c, volume: last.v || 0 },
        { sym, periodSec: LIVE_PERIOD_SECONDS[resolvedTf] || 300,
          nowChart: toChartTime(Date.now() / 1000), tf: resolvedTf,
          session: liveStreamSession(showExtendedRef.current),
          // I8: the only poll-side proof a bucket is sealed — the SAME response holds a later
          // bucket (e.g. a post-close bar the RTH view filters out). Never the clock.
          serverHasLater: Number.isFinite(respNewestTRef.current) && toChartTime(respNewestTRef.current) > _lt })
      {
        // Reconcile the developing bar's H/L against the server bucket, PRESERVING
        // the accumulated live high/low. The live push feed IS the real-time tape
        // (Massive WS) and is now ghost-FILTERED at the source — T-tick prints pass
        // trade_conditions.classify (odd-lot / out-of-sequence / derivatively-priced
        // dropped) and A per-second aggregates no longer fold H/L at all — so the
        // accumulated _lb.high/_lb.low can be trusted. The server REST bucket LAGS the
        // WS by seconds, so trusting it over the live feed is backwards:
        //   Previously this did `Math.max(last.h, _lb.close)` (drop to the server high
        //   bounded by the live close) to heal ghost wicks. But once ghosts are filtered
        //   upstream that only DROPS a REAL fast wick the server hasn't ingested yet —
        //   and Writer D/B re-extend it from the push bar on the very next tick, so the
        //   real high FLICKERS on/off every ~2s reconcile cycle (the reported bug: a wick
        //   the price genuinely traded to, blinking while the candle is developing, then
        //   stable once it closes). Take the max/min of BOTH so a real live extension
        //   stays put and a server correction (higher/lower) is still respected.
        liveBarRef.current = _rec.bar
      }
    }
  }

  // For the Finnhub re-top below: prefer the frozen tick for THIS ticker; on a
  // ticker switch (latestLiveRef was just reset to null) seed from the
  // synchronously-available shared live cache (livePrices[sym]) so the developing
  // candle paints at the TRUE current price on the FIRST frame instead of the
  // stale server close that otherwise snapped ~1s later when the first tick
  // arrived. Cold/uncached ticker → null → prior ~1s behaviour, no regression.
  // Sane-price guard mirrors Writers A/B (baseline = the just-refreshed server close).
  let _retopLive = (latestLiveRef.current?.sym === sym && latestLiveRef.current?.price)
    ? latestLiveRef.current
    : null
  if (!_retopLive && !barsPushActiveRef.current) {
    // livePrices (the hook) is filtered to THIS chart's subscription, which on a
    // switch hasn't registered the new sym yet → empty on the switch frame. The
    // livePriceStore GLOBAL snapshot holds every ticker any widget tracks
    // (watchlist / movers / themes), synchronously → seed from it as a fallback.
    const _cached = livePrices[sym] || getLivePriceStoreSnapshot()[sym]
    const _cachedPx = _effLivePrice(_cached)
    if (_cachedPx && _liveSane(sym, _cachedPx)) {
      _retopLive = {
        sym, price: _cachedPx, updated_at: _cached.updated_at,
        day_open: _cached.day_open, day_high: _cached.day_high,
        day_low: _cached.day_low, prev_close: _cached.prev_close,
        volume: Number.isFinite(_cached.volume) && _cached.volume > 0 ? _cached.volume : null,
        ext_session: !!_cached.ext_session,
      }
    }
  }

  // Writer D freeze: while a provisional stale-intraday cache is on screen, apply NO
  // live developing bar over the old tail — null the Finnhub re-top and skip the push
  // branch below. The forced full refetch swaps in fresh bars, then writers resume.
  if (provisionalStaleRef.current) _retopLive = null

  // Re-apply the live developing bar immediately after setData() to prevent snap-back —
  // setData() overwrites with API data (stale by seconds/minutes).
  // Writer D's push re-top (`legacyPushRetop`) owns its branch condition
  // `barsPushActiveRef.current && !provisionalStaleRef.current` and returns whether it was
  // taken; the Finnhub re-top is the else branch, as before.
  if (legacyPushRetop(ctx)) {
    // re-topped from the push developing bar
  } else if (_retopLive?.price && lastBarRef.current
             && !(['D', 'W', 'M'].includes(resolvedTf)
                  && (sessionOwnsDailyRef.current
                      || (sessionViewRef.current === 'regular' && _retopLive.ext_session)))
             && !(!['D', 'W', 'M'].includes(resolvedTf)
                  && !showExtendedRef.current && _retopLive.ext_session)) {
    // Skip the D/W/M re-top while session preview owns the bar (the memo-driven
    // setData above already painted the synthetic/frozen candle) OR when a
    // Regular-Hours daily chart got an extended-hours print (same lag-independent
    // guard as Writer A). Also skip an RTH-only INTRADAY re-top of an ext print
    // (Writers B/C already drop the live ext bar; don't let the re-top re-add it).
    const lp = _retopLive.price
    const tickSec = _retopLive.updated_at
    const last = lastBarRef.current
    const isIntradayTf = !['D', 'W', 'M'].includes(resolvedTf)
    const liveSnap = _retopLive
    // Same shared classifier as the tick effect — start today's bar from the
    // snapshot even on the REST floor (no updated_at), never fuse onto a stale
    // prior-session candle. 'skip' = new D/W/M day, session unconfirmed.
    const decision = classifyLiveBar({
      tf: resolvedTf, last, live: liveSnap, tickSec, nowSec: Date.now() / 1000,
      session: liveStreamSession(showExtendedRef.current),
    })
    const barTime = decision.time != null ? decision.time : last.time

    // Use liveBarRef if available — it has tick-accurate high/low that survives setData()
    const lb = liveBarRef.current

    // 🔴 THIS RE-TOP CAN TAKE THE WHOLE PAGE DOWN, AND ON 2026-09-09 IT DID.
    // `last` is `lastBarRef.current`, i.e. what we BELIEVE the series' newest bar
    // is; the series itself is the only thing that knows. When live breadth went
    // dark that morning the UCTA* daily serve stopped appending its developing
    // candle, so the refetch's tail went BACKWARDS (2026-09-09 → 2026-09-08) while
    // the plotted series kept the newer bar. LWC refuses a backwards `update` by
    // THROWING ("Cannot update oldest data"), this effect has no catch, and the
    // throw unwound into React's commit — ErrorBoundary, black /charts, and a crash
    // loop that survived reloads because the layout re-mounted the same widget.
    // (`[object Object]` in that message is the tell: breadth bars carry STRING
    // dates, which LWC reads as BusinessDay.)
    //
    // A refused update is not corruption — LWC just declines the write, and the
    // next poll re-tops correctly. So it must never be fatal. Every sibling writer
    // already reasons this way (the push re-top just above, the registry tick, the
    // indicator series); this branch was the one that didn't.
    try {
    if (decision.kind === 'new') {
      const isDW = !isIntradayTf
      // A NEW bucket must NOT inherit O/H/L from liveBarRef — that's the PREVIOUS
      // bar (decision.kind==='new' ⇒ lb.time !== barTime). Fusing lb.low gave a
      // freshly-opened intraday candle the prior candle's low (the "current candle's
      // low extends to the last candle" glitch on a 5m switch, seeded by the stale
      // provisional tail in liveBarRef). Gate the fusion on a bucket-time match, so a
      // new intraday bar starts clean from the tick — matching Writers A + B.
      const _lbSame = lb && lb.time === barTime
      const openPrice = (isDW && liveSnap.day_open) ? liveSnap.day_open : (_lbSame ? lb.open : lp)
      const highPrice = isDW ? Math.max(liveSnap.day_high || openPrice, lp) : (_lbSame ? Math.max(lb.high, lp) : lp)
      const lowPrice = isDW ? Math.min((liveSnap.day_low && liveSnap.day_low > 0) ? liveSnap.day_low : openPrice, lp) : (_lbSame ? Math.min(lb.low, lp) : lp)
      const newBar = { time: barTime, open: openPrice, high: highPrice, low: lowPrice, close: lp }
      if (isOhlcType(cs.chartType)) {
        candleSeriesRef.current.update(newBar)
      } else {
        candleSeriesRef.current.update({ time: barTime, value: lp })
      }
      liveBarRef.current = { ...newBar }
      // D/W/M: seed the client-created "today" bar with the live cumulative DAY
      // volume (it IS this bar's volume) so the readout + pane don't show 0 while
      // the loaded bars still lag today's session. Intraday starts near 0.
      const _newVolD = isDW && Number.isFinite(liveSnap.volume) && liveSnap.volume > 0 ? liveSnap.volume : 0
      lastBarRef.current = { ...newBar, volume: _newVolD }
      if (isDW && _newVolD > 0 && volumeSeriesRef.current) {
        const _isUpN = openPrice != null && lp >= openPrice
        const _vUpN2 = userCandleColors ? (cs.volume.upColor || mbVolUp) : boldCandles ? mbVolUp : modelBookLook ? BOLD_UP : cs.volume.upColor
        const _vDownN2 = userCandleColors ? (cs.volume.downColor || mbVolDown) : boldCandles ? mbVolDown : modelBookLook ? BOLD_DOWN : cs.volume.downColor
        volumeSeriesRef.current.update({ time: barTime, value: _newVolD, color: _isUpN ? _vUpN2 : _vDownN2 })
      }
    } else if (decision.kind === 'skip') {
      // New day for D/W/M but no confirmed session — don't corrupt yesterday's bar
    } else if (isIntradayTf && lb && lb.time > last.time && isCompleteOhlc(lb)) {
      // The held live bucket is AHEAD of the fetched tail (reconcileWithServerTail kept
      // it) and this tick is stamped for an older bucket. Re-append the live bucket
      // exactly as it stood — never fold the stale tick into it, and never paint its
      // range onto the closed tail (which is the server's truth after setData).
      if (isOhlcType(cs.chartType)) {
        candleSeriesRef.current.update({ time: lb.time, open: lb.open, high: lb.high, low: lb.low, close: lb.close })
      } else {
        candleSeriesRef.current.update({ time: lb.time, value: lb.close })
      }
      lastBarRef.current = { time: lb.time, open: lb.open, high: lb.high, low: lb.low, close: lb.close,
        volume: Number(lb.volume) || 0 }
    } else {
      // Same bar — restore tick-tracked high/low from liveBarRef, ONLY when liveBarRef
      // is this same bar (time match).
      const _lbD = lb && lb.time === last.time ? lb : null
      const high = _lbD ? Math.max(_lbD.high, lp) : Math.max(last.high, lp)
      const low = _lbD ? Math.min(_lbD.low, lp) : Math.min(last.low, lp)
      last.high = high
      last.low = low
      last.close = lp
      if (_lbD) { _lbD.high = high; _lbD.low = low; _lbD.close = lp }
      if (isOhlcType(cs.chartType)) {
        candleSeriesRef.current.update({ time: last.time, open: last.open, high, low, close: lp })
      } else {
        candleSeriesRef.current.update({ time: last.time, value: lp })
      }
    }
    } catch (e) {
      // The series tail is ahead of what we hold — leave it standing and let the
      // next refetch/tick re-top it. Anything else is genuinely unexpected: say so
      // once, but still don't take the page down with it.
      if (e?.message && !/oldest data/i.test(e.message)) {
        console.warn('[StockChart] live re-top update error:', e.message)
      }
    }
  }

  // Fallback safety net: a live bucket AHEAD of the fetched tail (kept by
  // reconcileWithServerTail) that no branch above re-appended — e.g. no live tick to
  // re-top from yet. setData just wiped it off the series; put it back as it stood so
  // the new candle never vanishes between the poll and the next tick. Contiguous only
  // (one period), matching classifyLiveBar's guard.
  {
    const _lbN = liveBarRef.current
    const _tailN = lastBarRef.current
    if (isIntraday && !barsPushActiveRef.current && !provisionalStaleRef.current
        && _lbN && _tailN && _lbN.time > _tailN.time
        && _lbN.time - _tailN.time <= (LIVE_PERIOD_SECONDS[resolvedTf] || 300)
        && isCompleteOhlc(_lbN) && candleSeriesRef.current) {
      try {
        // (P3-S2: one call — a ternary point instead of an if/else pair; same writes.)
        candleSeriesRef.current.update(isOhlcType(cs.chartType)
          ? { time: _lbN.time, open: _lbN.open, high: _lbN.high, low: _lbN.low, close: _lbN.close }
          : { time: _lbN.time, value: _lbN.close })
        lastBarRef.current = { time: _lbN.time, open: _lbN.open, high: _lbN.high, low: _lbN.low, close: _lbN.close,
          volume: Number(_lbN.volume) || 0 }
      } catch { /* series tail moved — next tick re-tops */ }
    }
  }
}

/** updateChart's post-VOLUME-setData step (the roll-gap volume re-top). */
function legacyAfterVolumeSetData(ctx) {
  const { liveBarRef, volData, cs, volumeSeriesRef, userCandleColors, boldCandles, modelBookLook, mbVolUp } = ctx
  const { BOLD_UP } = ctx.H
  // Re-top the developing VOLUME bar to the live bucket, mirroring the candle
  // re-top above. On a settings change updateChart re-runs and this setData reverts
  // the volume series to volData; when a bucket has rolled LIVE but SWR hasn't
  // refetched yet, volData's last bar is the PREVIOUS (full, often HVC-gold) bucket,
  // so it renders as the current bar — the reported "volume bar shoots up then
  // reverts" spike. Only fires during that roll-gap (live bar strictly newer than
  // volData's last). Push tracks liveBarRef.volume; the Finnhub/REST path has no live
  // volume, so it paints ~0 until the next fetch fills it (Writer A's new-bar default).
  {
    const _lb = liveBarRef.current
    const _vLast = volData.length ? volData[volData.length - 1] : null
    if (_lb?.time != null && _vLast && _lb.time > _vLast.time) {
      const _vUpN = userCandleColors ? (cs.volume.upColor || mbVolUp) : boldCandles ? mbVolUp : modelBookLook ? BOLD_UP : cs.volume.upColor
      const _vVal = Number.isFinite(_lb.volume) ? _lb.volume : 0
      try { volumeSeriesRef.current.update({ time: _lb.time, value: _vVal, color: _vUpN }) } catch { /* time regressed / disposed */ }
    }
  }
}

// ── the tf-switch push hold fold (runs after the updateChart effect) ───────────────────────────
function useHeldPushFold(ctx) {
  const { sym, resolvedTf, filteredBars, updateChart, _tfSwitchHold, heldPushRef, onRealtimeBar } = ctx
  // Fold push frames buffered during a timeframe-switch hold (see onRealtimeBar) onto the new
  // tf's first real paint — the subscribe seed is never lost. Runs after the updateChart effect
  // above (same commit), so the developing-bar refs are already seeded from the painted series.
  useEffect(() => {
    if (_tfSwitchHold) return
    const h = heldPushRef.current
    if (!h) return
    heldPushRef.current = null
    if (h.key !== `${sym}|${resolvedTf}` || !filteredBars?.length) return
    for (const d of [...h.frames.values()].sort((a, b) => a.bar.t - b.bar.t)) {
      try { onRealtimeBar(d) } catch { /* a refused frame — the next push / poll carries it */ }
    }
  }, [updateChart, _tfSwitchHold])  // eslint-disable-line react-hooks/exhaustive-deps
}

// ── Writer F ───────────────────────────────────────────────────────────────────────────────────
function useCustomTfF(ctx) {
  const { _isCustomTf, _customBaseIntraday, filteredBars, livePrices, sym, adjustTime, showExtended, cs, candleSeriesRef } = ctx
  // ── Writer F of the single-writer invariant (index @ barsPushActiveRef decl):
  // custom-TF live developing bar ──
  // Custom intraday TFs skip the native single-writer machinery (that's keyed on the
  // 8 native codes), so their candle+quote would freeze. Give them a lightweight live
  // writer: fold the live price into the last visible candle every tick. Runs AFTER
  // updateChart so it wins over the 30s setData; native TFs untouched (_isCustomTf).
  // ⚠️ IT CONSULTS NEITHER barsPushActiveRef NOR provisionalStaleRef, AND THAT IS
  // CORRECT — both are gated on the five NATIVE intraday codes (`realtimeTfEligible`
  // inside `_pushOptIn`; `isIntraday &&` on provisionalStaleRef), so both are
  // structurally false whenever this effect runs. It went unindexed until 2026-08-07;
  // `engine/__tests__/singleWriterIndex.test.js` now derives it and pins that premise.
  useEffect(() => {
    if (!_isCustomTf || !_customBaseIntraday || cs.heikinAshi) return   // HA shows transformed bars, not raw
    const series = candleSeriesRef.current
    if (!series || !filteredBars?.length) return
    const last = filteredBars[filteredBars.length - 1]
    if (typeof last.t !== 'number') return
    const lp = sym ? livePrices[sym] : null
    const px = lp && Number.isFinite(lp.price) && lp.price > 0 ? lp.price : null
    if (px == null) return
    // In Regular Hours, don't fold a pre/post print into the frozen RTH close.
    if (!showExtended) {
      if (!isRthBar(Math.floor(Date.now() / 1000))) return
    }
    const time = adjustTime(last.t)
    try {
      series.update({ time, open: last.o, high: Math.max(+last.h, px), low: Math.min(+last.l, px), close: px })
    } catch { /* time regressed / series mid-swap */ }
  }, [_isCustomTf, _customBaseIntraday, filteredBars, livePrices, sym, adjustTime, showExtended, cs.heikinAshi])
}

// ── Writer E (+ the fast legend tick) ──────────────────────────────────────────────────────────
function useDailyTickE(ctx) {
  const {
    liveUpdates, sym, cs, _liveSane, resolvedTfRef, liveTickRef, barsPushActiveRef, sessionOwnsDailyRef, sessionViewRef,
    candleSeriesRef, lastBarRef,
  } = ctx
  const { isOhlcType } = ctx.H
  // Live legend ticking. Two pieces, deliberately split so the legend tracks the
  // fast Massive feed (like the theme tracker) WITHOUT re-rendering the whole
  // chart per tick (that storm froze the UI — do NOT reintroduce it):
  //   1. A direct bars-WS subscription writes the newest tick to liveTickRef —
  //      a REF, so ticks cause NO re-render.
  //   2. A BOUNDED ~4/sec timer re-renders just the legend from that ref.
  useEffect(() => {
    if (!liveUpdates || !sym) return undefined
    // Newest bar time seen on this subscription. The pooled stream (protocol v2) can
    // deliver a FINAL correction for an already-closed minute AFTER the next minute
    // has started; that older frame must never move the legend price or this
    // developing candle back to a stale close.
    let _newestT = -Infinity
    const unsub = barsStreamManager.subscribe(sym, '1', {
      onBar: (data) => {
        const _t = data?.bar?.t
        if (Number.isFinite(_t)) {
          if (_t < _newestT) return
          _newestT = _t
        }
        const c = data?.bar?.c ?? data?.trade?.p
        if (!Number.isFinite(c)) return
        liveTickRef.current = { price: c, ts: Date.now() }
        // ── Writer E of the single-writer invariant (index @ barsPushActiveRef decl):
        // fast developing candle for D/W/M ──
        // The Massive PUSH feed (writer B) streams intraday rollups only, so on
        // D/W/M the developing candle otherwise crawls on the slow Finnhub feed.
        // Paint it imperatively here from the fast 1-min tick so the candle + the
        // right-edge price label tick as fast as the legend/theme tracker — NO
        // React re-render (same series.update() path). Guards mirror the other
        // writers: daily+ only, never fight writer B (intraday), skip HA.
        const tf = resolvedTfRef.current
        const isDailyPlus = tf === 'D' || tf === 'W' || tf === 'M'
        if (!isDailyPlus || cs.heikinAshi || barsPushActiveRef.current) return
        // Session-preview owns the D/W/M bar (Include-mode preview candle or the
        // Regular-mode frozen-at-4pm candle) — don't let this fast tick fight it.
        if (sessionOwnsDailyRef.current) return
        // Regular Hours: never fold a pre/post-market tick into the RTH daily
        // candle — even in the up-to-60s window before useMarketOpen flips (which
        // sessionOwnsDailyRef keys off). This tick is live, so wall-clock ET is an
        // accurate, lag-independent session check. (Writer E was the path still
        // seaming post-market onto the daily candle after Writers A/D were gated.)
        if (sessionViewRef.current === 'regular') {
          if (!isRthBar(Math.floor(Date.now() / 1000))) return
        }
        const series = candleSeriesRef.current
        const last = lastBarRef.current
        if (!series || !last) return
        // NEW-SESSION GUARD (writer E is otherwise NOT date-aware — writers A/D
        // compute today via classifyLiveBar, but A defers to E while the 1-min
        // feed is fresh). If the loaded series still ends at a PRIOR session/period
        // — e.g. a closed-only pack/cache painted during RTH before the initial
        // fetch adds today's bar — NEVER fold this tick into that prior bar: that
        // is the "Frankenstein candle" (today's price on yesterday's candle). Bail;
        // the initial SWR fetch (Massive daily agg carries today's developing bar)
        // re-seeds lastBarRef to today via setData, then this writer resumes on the
        // current session. computeBarTime returns the ET day (D) / Friday (W) /
        // 1st-of-month (M) key, directly comparable to last.time.
        if (computeBarTime(tf, Math.floor(Date.now() / 1000)) !== last.time) return
        if (!_liveSane(sym, c)) return
        const updated = {
          time: last.time,
          open: last.open,
          high: Math.max(last.high, c),
          low: Math.min(last.low, c),
          close: c,
        }
        try {
          if (isOhlcType(cs.chartType)) series.update(updated)
          else series.update({ time: last.time, value: c })
        } catch { /* out of range mid-load */ }
        lastBarRef.current = { ...updated, volume: last.volume }
      },
    })
    return () => { try { unsub() } catch { /* already gone */ } liveTickRef.current = null }
  }, [liveUpdates, sym, cs.heikinAshi, cs.chartType])
}

// ── Writer C ───────────────────────────────────────────────────────────────────────────────────
function useRegistryWriterC(ctx) {
  const {
    sym, resolvedTf, replayMode, replayCutoffRef, cs, _liveSane, barsPushActiveRef, provisionalStaleRef,
    lastBarRef, lastBarSymRef, liveBarRef, showExtendedRef, candleSeriesRef, volumeSeriesRef, prevBarsRef,
    colorByNetChange, userCandleColors, boldCandles, modelBookLook, mbVolUp, mbVolDown,
  } = ctx
  const { isOhlcType, BOLD_UP, BOLD_DOWN } = ctx.H
  // ── Tick-by-tick developing-candle update via realtimeCandle registry ──
  // (Plan 4 / Goal 3) — drive series.update() on every SSE tick instead of
  // waiting for the 2s REST poll cycle. Coexists with the REST-driven live-
  // price effect above (line ~851) as a SAFETY FALLBACK; both paths write to
  // the same series and the latest write wins. SSE will dominate when the
  // stream is connected (target: tick-to-pixel <200ms); REST keeps the chart
  // alive when SSE drops or for tickers not in the WS subscription set.
  //
  // The registry stores tf="1" only (built from raw ticks). For:
  //   - resolvedTf="1": use registry candle directly.
  //   - resolvedTf in {5,15,30,60}: use the registry's latest tick price to
  //     update the developing bar tracked in liveBarRef (set by the REST/AM
  //     paths). We extend h/l and update close, mirroring the same logic the
  //     REST effect uses, but firing at SSE cadence.
  useEffect(() => {
    if (!sym) return
    if (!candleSeriesRef.current) return
    if (replayMode || replayCutoffRef.current) return   // replay/cutoff freezes the developing bar
    if (cs.heikinAshi) return
    const isIntradayTf = ['1', '5', '15', '30', '60'].includes(resolvedTf)
    if (!isIntradayTf) return

    const useOhlc = isOhlcType(cs.chartType)

    const update = () => {
      if (!candleSeriesRef.current) return
      // Writer C of the single-writer invariant (index @ barsPushActiveRef decl): the
      // Finnhub-fed registry is suppressed when the Massive push feed is the authoritative
      // developing-bar writer (onRealtimeBar owns it).
      if (barsPushActiveRef.current) return
      // Freeze while the provisional stale-intraday cache is on screen (see Writer A).
      if (provisionalStaleRef.current) return
      const candle = realtimeCandle.getCandle(sym, '1')
      if (!candle) return
      const price = candle.c
      if (!Number.isFinite(price) || price <= 0) return
      // RTH-only intraday (EXT/RTH toggle off): don't paint a pre/post-market
      // developing bar, matching sessionBars' 9:30–16:00 ET fetch filter.
      if (!showExtendedRef.current) {
        if (!isRthBar(candle.t)) return
      }
      // Sanity bound vs THIS symbol's closes — the shared chokepoint (it was an inline copy
      // that read whatever close the previous symbol left behind).
      if (!_liveSane(sym, price)) return

      try {
        if (resolvedTf === '1') {
          // Registry's 1m candle IS the developing bar. Apply it directly,
          // but offset to ET like all other series timestamps.
          const tSec = toChartTime(candle.t)
          // Never apply a BACKWARDS update. The SSE tick feed and the 30s REST/SWR
          // poll have different latencies, so at a minute rollover the registry can
          // momentarily lag the series' newest bar; a stale/lagged tick applied at an
          // older time throws LWC "Cannot update oldest data" (once/minute console
          // spam) and is lost anyway. Skip it — equal time updates in place, newer
          // appends a legit new bar. (The deeper single-writer fix is Phase C.)
          // SYMBOL GUARD (mirror of the 5-60m branch): never fuse onto another sym's bar.
          if (lastBarSymRef.current !== sym) return
          const _lastT = lastBarRef.current?.time
          if (typeof _lastT === 'number' && tSec < _lastT) return
          // Forward-contiguity guard (mirror of classifyLiveBar / Writer B): don't
          // plant a 1m bar MORE than one interval past the tail — the minutes in
          // between are missing (stale/loading series), and a detached bar is the
          // "gap before the live candle" artifact. Skip; the refetch fills the gap.
          if (typeof _lastT === 'number' && tSec - _lastT > 60) return
          // MERGE the registry minute into what we already hold for it (lib/liveBarMerge):
          // the registry only counts ticks since we subscribed, so overwriting O/H/L wholesale
          // shrank the fetched range; and a bar_close-shaped candle with no o/h/l must never
          // reach series.update() (D1: the closed minute painted blank).
          const _knownC = (liveBarRef.current && liveBarRef.current.time === tSec) ? liveBarRef.current
            : (lastBarRef.current && lastBarRef.current.time === tSec) ? lastBarRef.current : null
          const _mC = mergeRegistryMinute(_knownC, { ...candle, time: tSec })
          if (!_mC) return
          if (useOhlc) {
            candleSeriesRef.current.update({
              time: tSec,
              open: _mC.open,
              high: _mC.high,
              low: _mC.low,
              close: _mC.close,
            })
          } else {
            candleSeriesRef.current.update({ time: tSec, value: candle.c })
          }
          if (volumeSeriesRef.current) {
            // match the candle palette (same derivation as volData) so the
            // developing bar's volume color matches the historical bars
            const _vUp = userCandleColors ? (cs.volume.upColor || mbVolUp) : boldCandles ? mbVolUp : modelBookLook ? BOLD_UP : cs.volume.upColor
            const _vDown = userCandleColors ? (cs.volume.downColor || mbVolDown) : boldCandles ? mbVolDown : modelBookLook ? BOLD_DOWN : cs.volume.downColor
            const _pbC = prevBarsRef.current
            const _prevCC = colorByNetChange && _pbC && _pbC.length >= 2 ? _pbC[_pbC.length - 2].c : null
            const _upC = _prevCC != null ? (candle.c >= _prevCC) : (candle.c >= candle.o)
            // Same reset hazard as the push writer: the registry candle only counts
            // ticks seen since we subscribed, so on a fresh symbol/TF it restarts near
            // 0 mid-bucket. Floor it at the true volume we already hold for this same
            // bucket (fetched partial / last server refresh) — never paint LESS than
            // what has demonstrably already traded.
            volumeSeriesRef.current.update({
              time: tSec,
              value: _mC.volume,
              color: _upC ? _vUp : _vDown,
            })
          }
          // Sync trackers so the other writers stay consistent — INCLUDING when this tick
          // opened a new minute (tSec past the tail): leaving lastBarRef on the old minute
          // let Writer A re-open the same minute at o=h=l=price, shrinking it.
          liveBarRef.current = { ..._mC }
          lastBarRef.current = { ..._mC }
        } else {
          // 5/15/30/60 — registry only has 1m bars, so use its latest price
          // to extend the developing bar's h/l and update close. Bar's `t`
          // comes from liveBarRef (set by REST/AM paths).
          const lb = liveBarRef.current
          const last = lastBarRef.current
          if (!lb || !last || lb.time !== last.time) return
          // SYMBOL GUARD: the refs carry no symbol and a switch resets them via a
          // deferred effect while this registry tick fires on its own clock — so an ARM
          // tick could fuse onto LRCX's same-bucket bar. Only fuse when the developing
          // bar is confirmed to own THIS sym (5/15/30/60 is intraday; daily is elsewhere).
          if (lastBarSymRef.current !== sym) return
          // D3: bucket the registry candle by ITS OWN minute (candle.t), not "whatever bar is
          // developing now" — a tick from the NEXT bucket fused into the old candle, and a late
          // tick from the previous bucket stretched the new one. Only fold a same-bucket print.
          const _fC = foldPrice(lb, price, toChartTime(candle.t), resolvedTf, liveStreamSession(showExtendedRef.current))
          if (_fC.kind !== 'update') return
          const newHigh = _fC.bar.high
          const newLow = _fC.bar.low
          liveBarRef.current = _fC.bar
          const updated = {
            time: last.time,
            open: last.open,
            high: newHigh,
            low: newLow,
            close: price,
          }
          if (useOhlc) {
            candleSeriesRef.current.update(updated)
          } else {
            candleSeriesRef.current.update({ time: last.time, value: price })
          }
          lastBarRef.current = { ...updated, volume: last.volume }
        }
      } catch (e) {
        // "Cannot update oldest data" is the benign rollover race guarded above (the
        // candle is never corrupted — LWC just refuses the backwards write). Don't
        // spam the console for it; surface any other, genuinely unexpected error.
        if (e?.message && !/oldest data/i.test(e.message)) {
          console.warn('[StockChart] registry tick update error:', e.message)
        }
      }
    }

    // Fire once on subscribe in case a tick already landed before mount,
    // then subscribe to future ticks.
    update()
    const unsub = realtimeCandle.subscribe(sym, update)
    return unsub
  }, [sym, resolvedTf, replayMode, cs.heikinAshi, cs.chartType, cs.volume.upColor, cs.volume.downColor])
}

// ── THE GATE ───────────────────────────────────────────────────────────────────────────────────
// Under BARSTORE every export is inert. A hook stand-in calls no hook (so the call site's hook
// order is the same constant set on every render of the page).
const _inertHook = () => undefined

export const useLegacyGapWatchdog = LEGACY_LIVE ? useGapWatchdog : _inertHook
export const useLegacyLiveReset = LEGACY_LIVE ? useLiveReset : _inertHook
export const useLegacyWriterA = LEGACY_LIVE ? useWriterA : _inertHook
export const useLegacyPushWriterB = LEGACY_LIVE ? usePushWriterB : _inertHook
export const useLegacyHeldPushFold = LEGACY_LIVE ? useHeldPushFold : _inertHook
export const useLegacyCustomTfF = LEGACY_LIVE ? useCustomTfF : _inertHook
export const useLegacyDailyTickE = LEGACY_LIVE ? useDailyTickE : _inertHook
export const useLegacyRegistryWriterC = LEGACY_LIVE ? useRegistryWriterC : _inertHook

/**
 * updateChart, right after the candle setData: the legacy seed + re-top, or — under BARSTORE —
 * the store's developing-bar paint (`paintStore(true)`: re-top from snapshot.developing).
 */
export const liveAfterSetData = LEGACY_LIVE
  ? (ctx) => { legacyAfterSetData(ctx) }
  : (ctx, paintStore) => { paintStore?.(true) }
/** updateChart, right after the volume setData (the store paint re-tops candle + volume). */
export const liveAfterVolumeSetData = LEGACY_LIVE
  ? (ctx) => { legacyAfterVolumeSetData(ctx) }
  : (ctx, paintStore) => { paintStore?.(true) }

/** Test-only: the gated exports' identity, for the R1 census (inert under BARSTORE). */
export const __inertHook = _inertHook
