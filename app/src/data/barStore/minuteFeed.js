// app/src/data/barStore/minuteFeed.js — the universe minute feed INTO THE REGISTRY (2026-11-23, first slice: 1m;
// 2026-11-24, second slice: 5m, 15m, 30m and the regular 60m, below).
//
// THE PROBLEM. A row a list warmed a minute ago holds the server's answer as of then. A minute boundary later that
// copy is one closed 1m bar behind the clock, `prefetch._behindClock` refuses it, and the switch asks the server
// before it paints: 80-200 ms with the old symbol on screen. No round trip fits a key press, so the copy has to be
// current BEFORE the press.
//
// WHAT THIS DOES. stream-ingest already publishes every symbol's closed 1m bar once a minute (the universe minute
// frame: api/services/minute_frame_publisher.py, served by the edge under /api/hist/live1m). The page reads that one
// file a minute and appends the minute that just closed to every REGULAR-SESSION 1-MINUTE key the registry already
// holds, as the reducer's existing PUSH_FINAL. `_behindClock` reads only the newest bar, so a fed copy is current at
// the next press by construction; nothing in the switch changes.
//
// ⛔ CONTIGUITY, THE ONE RULE THAT MAKES AN APPEND HONEST (strict, owner ruling 2026-11-23): A FRAME NEVER SHOWS A
// COPY MISSING A CLOSED BAR AS IF IT WERE CURRENT. The reducer cannot see a hole made by finals (its live-gap check
// runs only when a LIVE action opens a forming bucket), so the guard lives here, and it is one sentence:
//
//     the walk goes minute by minute from the copy's newest CLOSED row, and STOPS at the first minute the feed
//     holds no bar of this symbol for.
//
// No bar is never read as "the minute was empty": a complete frame without the symbol may be a quiet name, or a
// bar the vendor delivers late (it then rides a later frame as a LATE record, and the walk continues from it). A
// stopped key stays behind the clock exactly as today, the switch asks, and the server's answer (which says what
// that minute was) lets the feed carry on from its tail. Quiet names therefore are NOT kept current by this slice.
// Everything else that must not be appended is the same sentence, because its bars are simply NOT KEPT:
//   - a frame that never arrived here, that the publisher never wrote, or that the decoder refused: no bars;
//   - the own minute of a frame the publisher flagged INCOMPLETE (the vendor socket was down): dropped, though
//     the frame carried it (the consumer reports it as a gap: lib/minuteFrames/consumer.js, the device store's code);
//   - a minute before the key was held (only held symbols are read from a frame), or older than RING_MINUTES;
//   - a minute outside the regular session.
// A FORMING bar the copy holds (the server's partial bar of the minute it answered in) is closed by the feed's own
// bar for that minute, or the walk stops there like at any other minute without one: stepping past it would make
// the reducer close that stale partial bar as if it were complete.
//
// THE SERVER KEEPS THE LAST WORD. A fed row is a push FINAL: it ranks below a REST seal, never enters a sealed span,
// and carries as its revision the EARLIEST instant it can have been observed (the end of its minute; for a LATE or
// REPLACE record the start of the frame's minute). So an answer whose rows were written after that minute closed
// wins over it, an answer built BEFORE the minute closed (a partial bar still in flight) does not replace the closed
// bar with a partial one, and a REPLACE replaces what an earlier frame fed. (The server's `series_rev` is the series'
// LAST WRITE, not the answer's build time: an answer built later can still carry an older one. Its UNSEALED row for
// that minute then waits behind the fed bar, normally the same values from the same vendor bar; its SEALED row, 45 s
// after the minute, always wins. Rail F14b.)
//
// LATE AND REPLACE RECORDS, as the device store applies them: the rollup (lib/minuteFrames/rollup.js) hands every
// record to the sink as the 1m bar of ITS minute, an identical repeat dropped. A record for a minute at or before a
// key's newest closed row is offered to the reducer as a closed row (it replaces a fed row, fills a minute the copy
// lacks outside the sealed spans, and loses to the server's row). Prices are stored at the server's grain
// (deviceStore/price.js), so a fed bar is bit-identical to the row /api/bars answers.
//
// ⭐ 5m, 15m, 30m AND THE REGULAR 60m, FROM THE SAME MINUTES (second slice). The consumer's rollup
// (lib/minuteFrames/rollup.js: the device store's, pinned to the server's buckets, the 09:30 session grid of 60m and
// half days included) already folds each minute into those buckets. This applier takes the bucket it built and appends
// it to the held key of that timeframe as the same marked PUSH_FINAL, under THE SAME RULE ONE LEVEL UP:
//
//     a CLOSED bucket is appended only when EVERY one of its minutes is kept for the symbol (so each came through
//     the rule above), and it is the bucket right after the copy's newest closed one. Otherwise nothing is appended
//     and the key stays behind exactly as today.
//
// So a bucket with a quiet or late minute inside, one touched by a missed or INCOMPLETE frame, one that began before
// the symbol was held: not appended, and neither is any bucket after it (until the key's next answer).
// A BUCKET THE ROLLUP CAN NO LONGER VOUCH FOR (`stale`: a correction it could not settle exactly, typically a bad-print
// high or low removed; or a late minute too old for it to merge) is rebuilt here from the kept minutes themselves,
// which hold the corrected minute, and appended, or offered again as a correction when it was already appended
// (review of #2680, B2: left alone, a copy that reads current kept the bad high until its next answer).
// THE FORMING BUCKET IS NEVER SYNTHESIZED: a bucket whose last minute has not been applied is not whole, so nothing is
// offered for it. A fed 15m copy at 10:16 holds closed buckets through the one that ended at 10:15 and no forming bar
// (the chart's own stream or answer brings that, as for 1m); `_behindClock` accepts it, because its newest closed
// bucket is the clock's previous one. A forming bar the copy already holds (the server's) is left exactly as it is
// until its bucket is whole, then closed with the bucket's own values.
// WHAT THAT MEANS FOR A WARMED ROW: the bucket a copy was answered IN can be completed only if the symbol was already
// held when that bucket's first minute was published. A row warmed mid-bucket therefore stays behind at the next
// boundary, as today; its first press asks, and from the bucket of THAT answer on the key is fed for as long as it is
// held (rails H7, and minuteFeed.scanHigher.test.js for the numbers).
// THE NIGHT. The bucket after yesterday's last one does not start where that one ended, so the rule above alone would
// never append today's first bucket (a whole hour on 60m). It is appended when the server's own answer NAMED the
// forming bar the copy holds as its newest bar (`newestForming`) and that bar is the session's first regular bucket:
// the answer itself then says nothing lies between, provided it also says the server was proved current at or after
// the open (`verifiedThrough`). Only over the night: inside the session a bucket the server had
// no bar for is not proved empty (a late bar), so no bucket is ever stepped over there. A copy whose answer carried
// no forming bar (a symbol no stream is on) is not bridged and stays behind at the first boundary, as today.
//
// QUIET NAMES (`fedThrough`): NOT BUILT, AND NOT BUILDABLE FROM TODAY'S FRAMES. A frame's symbol table is exactly the
// symbols that have a record in it (api/services/minute_frames.encode_frame): no universe list, no heartbeat, nothing
// that says "this symbol had no trade in this minute". A symbol absent from a complete frame may be quiet or late,
// so no stamp can honestly call its copy current. What the publisher would have to add is written in the PR.
//
// NOT IN THIS SLICE (each left exactly as it is today):
//   • extended-hours minutes (only regular-session minutes are fed, and nothing is polled outside the regular session);
//   • D / W / M keys, and the extended 60m key (`60e`, the clock grid);
//   • a forming bar, for any timeframe;
//   • a copy the server has not answered in this page's life (a saved, lake or device copy), a copy the store holds
//     for a full re-read, a windowed (replay) key, a key a chart is on (its own stream and requests keep it current);
//   • a key whose newest closed row is from an earlier session (the first minutes after the open, until its answer);
//   • the device store's own copies: untouched (with it ON this reads the worker's download from the cache, below).
//
// COST, ON: one GET a minute per PAGE (the minute file, `immutable` in the browser cache, so a second tab reads the
// first tab's copy), at low priority, only while the app is visible, the regular session is open AND THERE IS
// SOMETHING TO FEED: at least one idle regular 1m / 5m / 15m / 30m / 60m key is held (a row a list warmed, a chart the
// member left). None anywhere, or only the one a chart is on: no request at all. The first such key starts the polls within
// WANT_RECHECK_MS, at the minute then due; the last one gone stops them at the next look (within a minute). Never head.json,
// never today.bin, never a backlog: back from hidden the run starts again at the minute now due, and every key whose
// walk stops at a minute that was missed is simply behind, as today. A member the edge refuses (401/403), or a feed that is not
// there, backs off (BOUNDED: see `_failed`) and nothing surfaces. OFF: this module is never loaded.

import { createMinuteFrameConsumer } from '../../lib/minuteFrames/consumer'
import { MINUTE_APPLIED_CHANNEL, readAppliedSignal } from '../../lib/minuteFrames/applied'
import { bucketOf } from '../../lib/minuteFrames/rollup'
import { isRthBar } from '../../components/chart/barTime'
import { isAppVisible, onDeskHiddenChange } from '../../lib/deskVisibility'
import { cookieKillsChartSpeed } from '../../lib/chartSpeed'
import { inRegularSession } from '../deviceStore/fresh'
import { serverPrice } from '../deviceStore/price'
import { ACTION, parseKey } from './types'

/** The timeframe the frames carry. */
export const FEED_TF = '1'
/** The timeframes fed: the regular 1m key and, from the buckets the consumer's rollup builds of its minutes, 5m, 15m,
 *  30m and the regular-session 60m. (The extended 60m key, `60e`, and D are not: see the header.) */
export const FEED_TFS = Object.freeze(['1', '5', '15', '30', '60'])
const HIGHER_TFS = new Set(FEED_TFS.filter((tf) => tf !== FEED_TF))
/** Minutes of each held symbol kept: one whole 60m bucket and a margin. A copy further behind stops at the first
 *  minute dropped: the server's to heal. */
export const RING_MINUTES = 75
/** The consumer's rollup as this feed needs it (ONE place: the page feed and its rails use it): the fed timeframes,
 *  only for symbols a fed key is held for, keeping each symbol's minutes for as long as the feed does, so a correction
 *  anywhere inside a 60m bucket is still settled exactly (the rollup's default keeps 15); and forgetting a symbol
 *  once none of its fed keys is held (`forgetRefused`: the held keys change all day, and the rollup would otherwise keep
 *  every symbol ever held until the day's reset; review of #2680). */
export const feedRollup = (feeder) => ({ tfs: [...FEED_TFS], accept: feeder.accept, recentMinutes: RING_MINUTES, forgetRefused: true })
/** The appends of one frame give the thread back after this much work (a held 1m copy is up to 20,000 rows, and a
 *  list holds a hundred of them). */
export const DRAIN_SLICE_MS = 4
/** When a minute's frame is asked for, after the minute's end (the consumer's own default: the publisher builds it
 *  5 s after the minute ends), plus the consumer's 0-3 s jitter. */
export const POLL_DELAY_MS = 7000
/**
 * ⭐ WITH THE DEVICE STORE ON (`cacheOnly`): THE PAGE NEVER DOWNLOADS A MINUTE FILE, AND READS IT ONCE, WHEN TOLD.
 * The device store's worker downloads each minute file (the same URL, built by the same consumer) 7-10 s after the
 * minute ends, and the edge answers it `private, max-age=86400, immutable`, so the browser's HTTP cache holds it for
 * every tab of the site. The page asks with `cache: 'only-if-cached'` (and the `mode: 'same-origin'` that mode
 * requires): by the Fetch standard such a request is answered from the cache or fails; it cannot reach the network.
 * WHEN: the worker tells every page the moment it has applied a minute it read as its own file
 * (lib/minuteFrames/applied.js, a BroadcastChannel). The page then reads that one file. It keeps NO schedule of its
 * own in this mode: no timer, no polling, so in steady state no look comes too early (each one that did was a failed
 * request in the browser's console). A read that misses all the same (the cache was cleared, DevTools "Disable
 * cache") is looked for ONCE more after CACHE_RETRY_MS, then the minute is given up like any other and the strict walk
 * stops there; two misses pause the feed (the backoff below).
 * If nobody tells (the worker is not downloading: no seed yet, a seed the split guard refuses, the store stopped on
 * this page; a leader tab still on a build without the message; no BroadcastChannel), the page reads nothing and
 * every key is behind exactly as today.
 */
export const CACHE_RETRY_MS = 500
export const CACHE_RETRIES = 1
/** With nothing to feed (no idle fed key held) the feed looks again this often: a registry read, no request. */
export const WANT_RECHECK_MS = 5_000
/** A minute file that is not there yet is asked again this many times (every 2 s), then given up. */
export const TAIL_RETRIES = 3
/** Answers in a row that were not a frame before the feed pauses (one whole minute: the ask and its retries). */
export const FAIL_LIMIT = TAIL_RETRIES + 1
/** The first pause after FAIL_LIMIT failures; each further one doubles, up to MAX_PAUSE_MS. */
export const FAIL_PAUSE_MS = 2 * 60_000
/** The first pause after the edge REFUSED the member (401/403); doubles the same way. */
export const REFUSED_PAUSE_MS = 10 * 60_000
export const MAX_PAUSE_MS = 60 * 60_000

const _perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * THE APPLIER: the sink of the minute-frame rollup, and the contiguity rule (see the header). Pure but for the
 * registry it feeds.
 * @param {object} o
 * @param {object} o.registry                  the BarStore's registry (`keys`, `peek`, `feed`)
 * @param {(key:string) => boolean} [o.isActive]  is a chart on this key (BarStore `isActive`)? Such a key is not fed.
 * @param {number} [o.sliceMs] / [o.yieldTo] / [o.elapsed]   the time slicing of one frame's appends
 */
export function createMinuteFeeder({
  registry, isActive = () => false,
  sliceMs = DRAIN_SLICE_MS, yieldTo = () => new Promise((r) => setTimeout(r, 0)), elapsed = _perfNow,
} = {}) {
  if (!registry || typeof registry.feed !== 'function') throw new Error('minuteFeed needs a registry with feed()')
  /** sym -> { keys, bars, redo, hi, bad, redoHi }: one per symbol a fed key is held for.
   *    keys   Map<tf, key>            its held fed keys
   *    bars   Map<minute, row>        the minutes KEPT for it (see the header: what is not kept cannot be walked)
   *    redo   Set<minute>             minutes (re)stated since its 1m key was last brought forward
   *    hi     Map<tf, Map<t, row>>    the rollup's buckets of those minutes, as it last stated them
   *    bad    Map<tf, Map<t, rev>>    buckets the rollup no longer vouches for, with the revision of that report
   *    redoHi Map<tf, Set<t>>         buckets (re)stated since that timeframe's key was last brought forward */
  const syms = new Map()
  /** Map<sym, Map<tf, key>> of the fed keys held while the frame in hand is applied (read once per frame). */
  let held = null
  /** The records of the frame in hand: [sym, minute, bar] (filed at its frameDone, when its minute is known)... */
  let pend = []
  /** ...and what the rollup said of its buckets while applying it: [sym, tf, bar], and [sym, tf, t] (stale). */
  let pendHi = []
  let pendStale = []
  /** The newest minute a gap reported for the frame in hand covers (null: none). */
  let gapTo = null
  /** The minute of the newest frame applied (null: none): how far a walk may go. */
  let through = null
  let stopped = false
  let busy = false
  let dirty = false
  let done = Promise.resolve()
  const stats = { frames: 0, breaks: 0, appended: 0, corrected: 0, rejected: 0 }

  /** The fed keys the registry holds (those `only` accepts, when given), as Map<sym, Map<tf, key>>: a regular
   *  1m / 5m / 15m / 30m / 60m key. Never a windowed (replay) one, never the extended 60m key (`60e`: another grid). */
  function _heldNow(only = null) {
    const m = new Map()
    for (const key of registry.keys()) {
      const p = parseKey(key)
      if (!p || p.window || p.cacheTf !== p.tf || !FEED_TFS.includes(p.tf)) continue
      if (only && !only(key)) continue
      let keys = m.get(p.sym)
      if (!keys) { keys = new Map(); m.set(p.sym, keys) }
      keys.set(p.tf, key)
    }
    return m
  }
  const _of = (map, k, make) => { let x = map.get(k); if (!x) { x = make(); map.set(k, x) } return x }

  /** Is the closed row at `t` held (looked for from the tail: a fed minute is always near it)? */
  function _hasRow(s, t) {
    const b = s.bars
    let i = b.length - 1
    while (i >= 0 && b[i].t > t) i--
    return i >= 0 && b[i].t === t
  }

  function _offer(key, sym, tf, row, rev = row.rev) {
    return registry.feed(key, {
      type: ACTION.PUSH_FINAL,
      // marked as the feed's: the reducer clears "the newest bar is forming" for THIS final only, never for a live
      // stream's final on a chart's own key (reducer.applyPush)
      fromFeed: true,
      event: { sym, tf, t: row.t, o: row.o, h: row.h, l: row.l, c: row.c, v: row.v, rev },
    })
  }

  /** The copy of `key`, when it may be fed: only one the SERVER answered in this page's life (`restSeen`: never a
   *  saved copy, the lake's or the device's rows alone), that the store does not itself hold for a full re-read
   *  (`needsFull`: its history or its price basis changed, or it has a hole a delta cannot reach), and that no chart is
   *  on. Everything else is left exactly as it is (see the header). One clause per rule, each proved by its own mutant
   *  (a rule stated twice cannot be), and EVERY timeframe goes through this one gate. */
  function _copy(key) {
    const s = registry.peek(key)
    return s && s.restSeen && !s.needsFull && s.bars.length && !isActive(key) ? s : null
  }

  /** Append `row` as the next closed row of the copy `s`. Returns the copy after it, or null when the store did not
   *  take it (a sealed span, a foreign identity): that ends this key's feed until its next answer. */
  function _append(key, sym, tf, s, row) {
    // A FORMING bar is a partial observation of its bucket, whatever instant it is stamped with; the feed's bar is
    // that bucket CLOSED. So the closed bar outranks a forming bar the copy holds for the same bucket (review of
    // #2639, L1): stamped at or after the fed revision (a late seal, a clock that runs ahead), the reducer would
    // otherwise close the bucket with the PARTIAL values and rank the feed's bar below them.
    const dev = s.developing
    const rev = dev && dev.t === row.t && Number.isFinite(dev.rev) && dev.rev >= row.rev ? dev.rev + 1 : row.rev
    const next = _offer(key, sym, tf, row, rev)
    // the bar must now be a closed row, with no forming bar left at or before it
    if (!next || !_hasRow(next, row.t) || (next.developing && next.developing.t <= row.t)) { stats.rejected++; return null }
    if (next !== s) stats.appended++
    return next
  }

  /** The bucket of `tf` starting at `t`, WHEN IT MAY BE APPENDED (the header): every one of its minutes is kept for the
   *  symbol. A bucket whose last minute has not been applied is therefore never whole: the forming bucket is never
   *  offered. Its values are the rollup's. Only for a bucket the rollup reported it can no longer vouch for are they
   *  built here, from the kept minutes (already at the server's grain): open of the first, close of the last, the
   *  highest high, the lowest low, the volumes summed, as the rollup itself folds them. */
  function _whole(st, tf, t) {
    const end = bucketOf(t, tf)[1]
    for (let m = t / 60; m < end / 60; m++) if (!st.bars.has(m)) return null
    const row = st.hi.get(tf)?.get(t) ?? null
    const staleAt = st.bad.get(tf)?.get(t)
    if (staleAt == null) return row
    const first = st.bars.get(t / 60)
    const b = { t, o: first.o, h: first.h, l: first.l, c: first.c, v: 0, rev: Math.max(staleAt, row ? row.rev : 0) }
    for (let m = t / 60; m < end / 60; m++) {
      const x = st.bars.get(m)
      if (x.h > b.h) b.h = x.h
      if (x.l < b.l) b.l = x.l
      b.c = x.c
      b.v += x.v
    }
    return b
  }

  /** Bring ONE held 5m / 15m / 30m / 60m key forward, bucket by bucket (idempotent: it reads the copy). */
  function _feedHigher(sym, st, tf, key) {
    const redo = st.redoHi.get(tf)
    let s = _copy(key)
    if (!s) { redo?.clear(); return }
    // 1) a bucket at or before the newest closed row that the rollup stated again (a LATE or REPLACE minute inside
    //    it, or one the answer already carried): offered as a closed row when it is whole; the reducer's rank decides
    //    (a server row and a sealed span always win).
    if (redo) {
      const lastT = s.bars[s.bars.length - 1].t
      for (const t of redo) {
        if (t > lastT) continue
        const row = _whole(st, tf, t)
        if (!row) continue
        const next = _offer(key, sym, tf, row)
        if (next && next !== s) { stats.corrected++; s = next }
      }
      redo.clear()
    }
    // 2) THE WALK, one level up: the bucket right after the newest closed one, only when it is WHOLE; else stop.
    while (s) {
      const dev = s.developing
      const nf = s.newestForming
      // THE NIGHT (the header): the forming bar the server's answer named as its newest bar, at the session's first
      // regular bucket, IS the next bucket
      // ...when that answer also says the server was proved current at or after the open (`verifiedThrough`): 5m-30m
      // rows are shared with the extended view, and a store that lagged at 09:30 could have left a pre-market bucket
      // out of the answer (review of #2680, N2). An answer that does not say is not bridged.
      const atOpen = dev && nf && nf.forming === true && nf.t === dev.t && isRthBar(dev.t) && !isRthBar(dev.t - 60)
        && s.verifiedThrough >= dev.t
      const row = _whole(st, tf, atOpen ? dev.t : bucketOf(s.bars[s.bars.length - 1].t, tf)[1])
      if (!row) return
      s = _append(key, sym, tf, s, row)
    }
  }

  /** Bring every held key of ONE symbol forward. */
  function _feedSym(sym, st) {
    for (const [tf, key] of st.keys) {
      try { if (tf === FEED_TF) _feedKey(sym, st, key); else _feedHigher(sym, st, tf, key) } catch { /* one key never stops the rest */ }
    }
  }

  /** Bring ONE held 1m key forward, from what is kept now (idempotent: it reads the copy). */
  function _feedKey(sym, st, key) {
    let s = _copy(key)
    if (!s) { st.redo.clear(); return }
    // 1) minutes at or before the newest closed row (a LATE or REPLACE record, or a minute the answer already
    //    carried): offered as closed rows; the reducer's rank decides (a server row and a sealed span always win).
    const lastT = s.bars[s.bars.length - 1].t
    for (const m of st.redo) {
      if (m * 60 > lastT) continue
      const row = st.bars.get(m)
      if (!row) continue
      const next = _offer(key, sym, FEED_TF, row)
      if (next && next !== s) { stats.corrected++; s = next }
    }
    st.redo.clear()
    // 2) THE WALK (CONTIGUITY, the header): minute by minute from the newest closed row, and it STOPS at the first
    //    minute no bar is kept for. Never stepped over: no bar cannot prove the minute was empty.
    if (through == null) return
    s = registry.peek(key)
    if (!s || !s.bars.length) return
    for (let m = s.bars[s.bars.length - 1].t / 60 + 1; m <= through; m++) {
      const row = st.bars.get(m)
      if (!row) return
      s = _append(key, sym, FEED_TF, s, row)
      if (!s) return
    }
  }

  /** Feed every held key, giving the thread back every `sliceMs` (a press that lands meanwhile on a key not reached
   *  yet finds it behind and asks, as today). One pump at a time; a frame that lands during it runs it once more. */
  function _pump() {
    dirty = true
    if (busy) return
    busy = true            // (a flag, not the promise: a pump that never pauses ends before its promise is even stored)
    done = _drain()
  }
  async function _drain() {
    try {
      while (dirty && !stopped) {
        dirty = false
        let t0 = elapsed()
        for (const [sym, st] of [...syms]) {
          if (stopped) return
          if (syms.get(sym) !== st) continue                    // the key left the registry during a pause
          _feedSym(sym, st)
          if (elapsed() - t0 >= sliceMs) { await yieldTo(); t0 = elapsed() }
        }
      }
    } finally { busy = false }
  }

  /** The rollup's sink (lib/minuteFrames/rollup.js header), fed by the consumer one frame at a time. */
  const sink = {
    upsert(sym, tf, bar) {
      if (!bar || !Number.isFinite(bar.t)) return
      if (tf === FEED_TF) pend.push([sym, bar.t / 60, bar])
      else if (HIGHER_TFS.has(tf)) pendHi.push([sym, tf, bar])
    },
    /** The rollup can no longer vouch for that bucket (a correction it could not settle exactly). */
    stale(sym, tf, t) {
      if (HIGHER_TFS.has(tf)) pendStale.push([sym, tf, t])
    },
    /** Minutes this page lacks: a missing frame, an INCOMPLETE one, a refused one, a broken link. */
    gap(info) {
      const to = info?.toMinute
      if (Number.isFinite(to)) gapTo = gapTo == null ? to : Math.max(gapTo, to)
      else gapTo = Infinity
    },
    /** A new trading day: nothing of yesterday is contiguous with it. */
    reset() {
      syms.clear(); held = null; pend = []; pendHi = []; pendStale = []; gapTo = null; through = null
    },
    /** One frame is applied: keep its records (the header says which), bring the held keys forward. */
    frameDone(info) {
      const M = info?.minute
      if (stopped || !Number.isFinite(M)) { pend = []; pendHi = []; pendStale = []; held = null; gapTo = null; return }
      // this frame's OWN minute is a gap (INCOMPLETE; a refused frame carries nothing): its own bars are not kept
      const unusable = gapTo != null && gapTo >= M
      if (gapTo != null && stats.frames > 0) stats.breaks++     // (diagnostics only: the first frame always follows a gap)
      gapTo = null
      if (!held) held = _heldNow()                              // (a frame with no accepted record never asked)
      for (const [sym, keys] of held) {
        const st = syms.get(sym)
        if (st) st.keys = keys
        else syms.set(sym, { keys, bars: new Map(), redo: new Set(), hi: new Map(), bad: new Map(), redoHi: new Map() })
      }
      for (const sym of [...syms.keys()]) if (!held.has(sym)) syms.delete(sym)
      held = null
      for (const [sym, minute, bar] of pend) {
        const st = syms.get(sym)
        if (!st) continue
        if (!isRthBar(minute * 60)) continue                    // NOT KEPT: a minute outside the regular session
        if (unusable && minute === M) continue                  // NOT KEPT: the own minute of an INCOMPLETE frame
        st.bars.set(minute, {
          t: minute * 60, o: serverPrice(bar.o), h: serverPrice(bar.h), l: serverPrice(bar.l), c: serverPrice(bar.c), v: bar.v,
          // the earliest instant this bar can have been observed (the header): the end of its own minute, or for a
          // record that rode a LATER frame the start of that frame's minute
          rev: Math.max(minute + 1, M) * 60_000,
        })
        if (st.keys.has(FEED_TF)) st.redo.add(minute)
      }
      pend = []
      // the rollup's buckets as of this frame, at the server's grain like the minutes. A bucket's revision is the
      // earliest instant it can have been observed whole: its own end, or for one a later frame stated again (a LATE
      // or REPLACE minute inside it) the start of that frame's minute.
      const seenAt = (t, tf) => Math.max(bucketOf(t, tf)[1] / 60, M) * 60_000
      for (const [sym, tf, bar] of pendHi) {
        const st = syms.get(sym)
        if (!st) continue
        _of(st.hi, tf, () => new Map()).set(bar.t, {
          t: bar.t, o: serverPrice(bar.o), h: serverPrice(bar.h), l: serverPrice(bar.l), c: serverPrice(bar.c), v: bar.v,
          rev: seenAt(bar.t, tf),
        })
        if (st.keys.has(tf)) _of(st.redoHi, tf, () => new Set()).add(bar.t)
      }
      // ...and the buckets it can no longer vouch for: rebuilt from the kept minutes (`_whole`) and offered again, at
      // this frame's revision, whether or not the rollup restated them (a late minute too old for it to merge is not)
      for (const [sym, tf, t] of pendStale) {
        const st = syms.get(sym)
        if (!st) continue
        _of(st.bad, tf, () => new Map()).set(t, seenAt(t, tf))
        if (st.keys.has(tf)) _of(st.redoHi, tf, () => new Set()).add(t)
      }
      pendHi = []
      pendStale = []
      through = M
      const floor = M - RING_MINUTES                            // NOT KEPT: anything older than RING_MINUTES
      for (const st of syms.values()) {
        for (const k of st.bars.keys()) if (k < floor) st.bars.delete(k)
        for (const m of st.hi.values()) for (const t of m.keys()) if (t < floor * 60) m.delete(t)
        for (const b of st.bad.values()) for (const t of b.keys()) if (t < floor * 60) b.delete(t)
      }
      stats.frames++
      _pump()
    },
  }

  return {
    sink,
    /** The rollup's `accept`: only the symbols of held fed keys cost anything (a frame is 8,500 records). */
    accept(sym) {
      if (!held) held = _heldNow()
      return held.has(sym)
    },
    /** Is there anything to feed: a regular 1m / 5m / 15m / 30m / 60m key that is held and that no chart is on? (The
     *  page's gate asks before every poll: with none, a frame would be downloaded for nothing.) */
    wanted: () => _heldNow((key) => !isActive(key)).size > 0,
    /** Resolves when the appends of every frame applied so far are done (tests). */
    settled: () => done,
    stop() { stopped = true; syms.clear(); pend = []; pendHi = []; pendStale = []; held = null },
    stats: () => ({ ...stats, symbols: syms.size, through }),
  }
}

function _killedNow() {
  try { return typeof document !== 'undefined' && cookieKillsChartSpeed(document.cookie) } catch { return false }
}

/** Call `cb` when the app may have become visible (the tab, or the desktop desk). Returns the unsubscribe. */
function _onVisible(cb) {
  let offDesk = null
  try { offDesk = onDeskHiddenChange(() => cb()) } catch { /* none */ }
  try { if (typeof document !== 'undefined') document.addEventListener('visibilitychange', cb) } catch { /* none */ }
  return () => {
    try { offDesk?.() } catch { /* gone */ }
    try { if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', cb) } catch { /* none */ }
  }
}

/**
 * THE PAGE'S FEED: the shared minute-frame consumer in its tail-only mode, feeding the applier above, behind the gate
 * that decides whether a poll may go at all (see the header: COST).
 * @param {object} o
 * @param {object} o.store              the BarStore (`registry`, `isActive`)
 * @param {Function} [o.fetchImpl]      fetch(url, init)
 * @param {Function} [o.now]            ms clock
 * @param {Function} [o.visible]        is the app visible (lib/deskVisibility.isAppVisible)?
 * @param {Function} [o.killed]         has the server killed the chart speed switches NOW (a fresh cookie read)?
 * @param {Function} [o.inSession]      is the regular session open at `ms` (deviceStore/fresh.inRegularSession)?
 * @param {Function} [o.onVisible]      (cb) => unsubscribe: when the app may have become visible
 * @param {boolean} [o.cacheOnly]       the device store is on: read the browser's copy only, never the network, and
 *                                      only when the device store's worker says a minute is there (above)
 * @param {Function} [o.makeChannel]    (name) => BroadcastChannel-like | null (cacheOnly: where the worker tells)
 * @param {Function} [o.setTimer] / [o.clearTimer]   cacheOnly: the one retry after a miss
 * @param {object} [o.consumerOpts] / [o.feederOpts]   tests
 */
export function createPageMinuteFeed({
  store, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), visible = isAppVisible, killed = _killedNow,
  inSession = inRegularSession, onVisible = _onVisible, cacheOnly = false, consumerOpts = {}, feederOpts = {},
  makeChannel = (name) => (typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h),
} = {}) {
  const feeder = createMinuteFeeder({
    registry: store.registry, isActive: (key) => !!store.isActive?.(key), ...feederOpts,
  })
  const pollDelayMs = consumerOpts.pollDelayMs ?? POLL_DELAY_MS
  const retries = cacheOnly ? CACHE_RETRIES : TAIL_RETRIES
  /** Answers in a row that were not a frame before the feed pauses: one whole minute of asking (the ask and its retries). */
  const failLimit = retries + 1
  /** The backoff: answers in a row that were not a frame, pauses in a row, and until when the feed is paused. */
  const back = { fails: 0, pauses: 0, until: 0 }
  const st = { requests: 0, answered: 0, refused: 0, stopped: null, waiting: false, told: 0 }
  let consumer = null
  let offVisible = null
  let channel = null         // cacheOnly: where the device store's worker tells (lib/minuteFrames/applied.js)
  let retryTimer = null      // cacheOnly: the one look after a miss
  let reading = Promise.resolve()

  /**
   * ⛔ BOUNDED, AND QUIET. An answer that is not a frame (the minute is not out, the edge is down, the network failed)
   * counts; FAIL_LIMIT in a row (one whole minute of asking) pause the feed for FAIL_PAUSE_MS, then twice that, up to
   * MAX_PAUSE_MS. A REFUSAL (401/403: the member is not entitled, or the edge cookie is gone) pauses at once, for
   * REFUSED_PAUSE_MS, doubling the same way: at most a handful of requests a session, and nothing is shown. While
   * paused every key is behind exactly as today. One frame clears it all.
   */
  function _failed(refused) {
    back.fails++
    if (!refused && back.fails < failLimit) return
    back.fails = 0
    back.pauses++
    back.until = now() + Math.min(MAX_PAUSE_MS, (refused ? REFUSED_PAUSE_MS : FAIL_PAUSE_MS) * 2 ** (back.pauses - 1))
  }

  async function watchedFetch(url, init) {
    st.requests++
    let r
    // ⛔ cacheOnly: the browser may answer this from its HTTP cache or not at all (see CACHE_RETRY_MS)
    const req = cacheOnly ? { ...init, cache: 'only-if-cached', mode: 'same-origin' } : init
    try { r = await fetchImpl(url, req) } catch (e) { _failed(false); throw e }
    if (r.ok) { st.answered++; back.fails = 0; back.pauses = 0; back.until = 0 }
    else if (r.status === 401 || r.status === 403) { st.refused++; _failed(true) }
    else _failed(false)
    return r
  }

  /** cacheOnly: read ONE minute file from the cache; after a miss, once more, then the minute is given up. */
  function _read(sig, left) {
    reading = consumer.askMinute(sig.day, sig.seq).then((r) => r?.current === true, () => false).then((got) => {
      if (got || left <= 0 || st.stopped) return
      retryTimer = setTimer(() => { retryTimer = null; if (!st.stopped) _read(sig, left - 1) }, CACHE_RETRY_MS)
    })
  }

  /** cacheOnly: the device store's worker says a minute file is in the cache. Read it, if a poll may go now; a minute
   *  told while it may not (hidden, outside the session, paused, nothing to feed) is skipped, and the walk stops there. */
  function _told(msg) {
    const sig = readAppliedSignal(msg)
    if (!sig || !consumer) return
    st.told++
    let ok = false
    try { ok = api.gate(sig.minute * 60_000) } catch { ok = false }   // the gate fails closed here too
    if (!ok) return
    if (retryTimer != null) { clearTimer(retryTimer); retryTimer = null }   // a newer minute: the older one is given up
    _read(sig, CACHE_RETRIES)
  }

  const api = {
    feeder,
    /** May a poll go now? The consumer asks before every step (its `isVisible`); false = look again later: when the
     *  next minute file is due (hidden, outside the session, paused: so the first poll after it is never a minute
     *  late), or after WANT_RECHECK_MS when the only reason is that there is nothing to feed yet. A throw from
     *  anything it reads counts as "no" (the consumer's tail mode fails closed). */
    gate(minuteMs = null) {
      st.waiting = false
      if (st.stopped) return false
      if (killed()) { api.stop('killed'); return false }        // the server's kill, on a page left open: for good
      const t = now()
      if (t < back.until) return false
      if (!visible()) return false
      // regular session only: the minute now due (it ended `pollDelayMs` ago), or the minute the caller names (the
      // one the device store's worker just told of), must be a regular-session minute
      if (!inSession(minuteMs ?? t - pollDelayMs - 60_000)) return false
      // ...and only while there is something to feed (the header: COST). Last, so `waiting` means exactly that.
      if (!feeder.wanted()) { st.waiting = true; return false }
      return true
    },
    start() {
      if (consumer || st.stopped) return
      consumer = createMinuteFrameConsumer({
        sink: feeder.sink, fetchImpl: watchedFetch, now, isVisible: api.gate,
        tailOnly: true, tailRetries: retries, pollDelayMs,
        recheckMs: () => (st.waiting ? WANT_RECHECK_MS : null),
        rollup: feedRollup(feeder),
        ...consumerOpts,
      })
      if (cacheOnly) {
        // TOLD when to read (the device store's worker): the consumer is never started, so it keeps no schedule
        try { channel = makeChannel(MINUTE_APPLIED_CHANNEL) } catch { channel = null }
        if (channel) channel.onmessage = (e) => _told(e?.data)
        return
      }
      offVisible = onVisible(() => { if (!st.stopped && visible()) consumer?.wake() })
      consumer.start()
    },
    stop(reason = 'stopped') {
      if (st.stopped) return
      st.stopped = reason
      try { consumer?.stop() } catch { /* ignore */ }
      try { offVisible?.() } catch { /* ignore */ }
      offVisible = null
      if (retryTimer != null) { try { clearTimer(retryTimer) } catch { /* ignore */ } retryTimer = null }
      try { if (channel) { channel.onmessage = null; channel.close() } } catch { /* ignore */ }
      channel = null
      feeder.stop()
    },
    /** cacheOnly: resolves when the read a message started has settled (tests). */
    settledRead: () => reading,
    running: () => !!consumer && !st.stopped,
    /** Numbers only (a measurement harness reads them: window.__uctMinuteFeed.status()). */
    status: () => {
      const c = consumer?.status?.()
      return {
        running: !!consumer && !st.stopped, stopped: st.stopped, cacheOnly, requests: st.requests, answered: st.answered,
        told: st.told, listening: !!channel,
        refused: st.refused, pausedUntil: back.until, pauses: back.pauses, waiting: st.waiting,
        lastSeq: c?.lastSeq ?? null, lastAppliedAt: c?.lastAppliedAt ?? 0, bytes: c?.bytes ?? 0, ...feeder.stats(),
      }
    },
  }
  return api
}
