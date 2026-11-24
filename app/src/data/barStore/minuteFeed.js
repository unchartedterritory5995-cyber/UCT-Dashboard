// app/src/data/barStore/minuteFeed.js — the universe minute feed INTO THE REGISTRY (2026-11-23, first slice).
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
// NOT IN THIS SLICE (each left exactly as it is today):
//   • extended-hours minutes (only regular-session minutes are fed, and nothing is polled outside the regular session);
//   • 5m-60m and D keys (no rollup here);
//   • the quiet-name stamp (`fedThrough`): a name that did not trade in the newest minute still reads "behind";
//   • a copy the server has not answered in this page's life (a saved, lake or device copy), a copy the store holds
//     for a full re-read, a windowed (replay) key, a key a chart is on (its own stream and requests keep it current);
//   • a key whose newest closed row is from an earlier session (the first minutes after the open, until its answer);
//   • the device store ON: this does not run at all then (minuteFeedSwitch.js).
//
// COST, ON: one GET a minute per PAGE (the minute file, `immutable` in the browser cache, so a second tab reads the
// first tab's copy), at low priority, only while the app is visible, the regular session is open AND THERE IS
// SOMETHING TO FEED: at least one idle regular 1m key is held (a row a list warmed, a chart the member left). No 1m
// chart anywhere, or only the one a chart is on: no request at all. The first such key starts the polls within
// WANT_RECHECK_MS, at the minute then due; the last one gone stops them at the next look (within a minute). Never head.json,
// never today.bin, never a backlog: back from hidden the run starts again at the minute now due, and every key whose
// walk stops at a minute that was missed is simply behind, as today. A member the edge refuses (401/403), or a feed that is not
// there, backs off (BOUNDED: see `_failed`) and nothing surfaces. OFF: this module is never loaded.

import { createMinuteFrameConsumer } from '../../lib/minuteFrames/consumer'
import { isRthBar } from '../../components/chart/barTime'
import { isAppVisible, onDeskHiddenChange } from '../../lib/deskVisibility'
import { cookieKillsChartSpeed } from '../../lib/chartSpeed'
import { inRegularSession } from '../deviceStore/fresh'
import { serverPrice } from '../deviceStore/price'
import { ACTION, parseKey } from './types'

/** The one timeframe this slice feeds. */
export const FEED_TF = '1'
/** Minutes of each held symbol kept. A copy further behind stops at the first minute dropped: the server's to heal. */
export const RING_MINUTES = 30
/** The appends of one frame give the thread back after this much work (a held 1m copy is up to 20,000 rows, and a
 *  list holds a hundred of them). */
export const DRAIN_SLICE_MS = 4
/** When a minute's frame is asked for, after the minute's end (the consumer's own default: the publisher builds it
 *  5 s after the minute ends), plus the consumer's 0-3 s jitter. */
export const POLL_DELAY_MS = 7000
/** With nothing to feed (no idle regular 1m key held) the feed looks again this often: a registry read, no request. */
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
  /** sym -> { key, bars: Map<minute, row>, redo: Set<minute> }: one per held regular 1m key. `bars` = the minutes
   *  KEPT for it (see the header: what is not kept cannot be walked). */
  const syms = new Map()
  /** Map<sym, key> of the 1m keys held while the frame in hand is applied (read once per frame). */
  let held = null
  /** The records of the frame in hand: [sym, minute, bar] (filed at its frameDone, when its minute is known). */
  let pend = []
  /** The newest minute a gap reported for the frame in hand covers (null: none). */
  let gapTo = null
  /** The minute of the newest frame applied (null: none): how far a walk may go. */
  let through = null
  let stopped = false
  let busy = false
  let dirty = false
  let done = Promise.resolve()
  const stats = { frames: 0, breaks: 0, appended: 0, corrected: 0, rejected: 0 }

  /** The regular 1m keys the registry holds (those `only` accepts, when given), as Map<sym, key>. */
  function _heldNow(only = null) {
    const m = new Map()
    for (const key of registry.keys()) {
      if (!key.endsWith(`_${FEED_TF}`)) continue      // (a windowed key ends in its `@to=`; parseKey has the last word)
      const p = parseKey(key)
      if (p && p.tf === FEED_TF && !p.window && (!only || only(key))) m.set(p.sym, key)
    }
    return m
  }

  /** Is the closed row at `t` held (looked for from the tail: a fed minute is always near it)? */
  function _hasRow(s, t) {
    const b = s.bars
    let i = b.length - 1
    while (i >= 0 && b[i].t > t) i--
    return i >= 0 && b[i].t === t
  }

  function _offer(key, sym, row, rev = row.rev) {
    return registry.feed(key, {
      type: ACTION.PUSH_FINAL,
      event: { sym, tf: FEED_TF, t: row.t, o: row.o, h: row.h, l: row.l, c: row.c, v: row.v, rev },
    })
  }

  /** Bring ONE held key forward, from what the ring and the chain hold now (idempotent: it reads the copy). */
  function _feedKey(sym, st) {
    const key = st.key
    let s = registry.peek(key)
    // Only a copy the SERVER answered in this page's life (`restSeen`: never a saved copy, the lake's or the device's
    // rows alone), that the store does not itself hold for a full re-read (`needsFull`: its history or its price basis
    // changed, or it has a hole a delta cannot reach), and that no chart is on. Everything else is left exactly as it
    // is (see the header). One clause per rule, each proved by its own mutant (a rule stated twice cannot be).
    if (!s || !s.restSeen || s.needsFull || !s.bars.length || isActive(key)) {
      st.redo.clear()
      return
    }
    // 1) minutes at or before the newest closed row (a LATE or REPLACE record, or a minute the answer already
    //    carried): offered as closed rows; the reducer's rank decides (a server row and a sealed span always win).
    const lastT = s.bars[s.bars.length - 1].t
    for (const m of st.redo) {
      if (m * 60 > lastT) continue
      const row = st.bars.get(m)
      if (!row) continue
      const next = _offer(key, sym, row)
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
      // A FORMING bar is a partial observation of its minute, whatever instant it is stamped with; the feed's bar is
      // that minute CLOSED. So the closed bar outranks a forming bar the copy holds for the same minute (review of
      // #2639, L1): stamped at or after the fed revision (a late seal, a clock that runs ahead), the reducer would
      // otherwise close the bucket with the PARTIAL values and rank the feed's bar below them.
      const dev = s.developing
      const rev = dev && dev.t === row.t && Number.isFinite(dev.rev) && dev.rev >= row.rev ? dev.rev + 1 : row.rev
      const next = _offer(key, sym, row, rev)
      // the minute must now be a closed row, with no forming bar left at or before it; anything else (the reducer
      // refused it: a sealed span, a foreign identity) ends this key's feed until its next answer
      if (!next || !_hasRow(next, row.t) || (next.developing && next.developing.t <= row.t)) { stats.rejected++; return }
      if (next !== s) stats.appended++
      s = next
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
          try { _feedKey(sym, st) } catch { /* one key never stops the rest */ }
          if (elapsed() - t0 >= sliceMs) { await yieldTo(); t0 = elapsed() }
        }
      }
    } finally { busy = false }
  }

  /** The rollup's sink (lib/minuteFrames/rollup.js header), fed by the consumer one frame at a time. */
  const sink = {
    upsert(sym, tf, bar) {
      if (tf === FEED_TF && bar && Number.isFinite(bar.t)) pend.push([sym, bar.t / 60, bar])
    },
    /** Minutes this page lacks: a missing frame, an INCOMPLETE one, a refused one, a broken link. */
    gap(info) {
      const to = info?.toMinute
      if (Number.isFinite(to)) gapTo = gapTo == null ? to : Math.max(gapTo, to)
      else gapTo = Infinity
    },
    /** A new trading day: nothing of yesterday is contiguous with it. */
    reset() {
      syms.clear(); held = null; pend = []; gapTo = null; through = null
    },
    /** One frame is applied: keep its records (the header says which), bring the held keys forward. */
    frameDone(info) {
      const M = info?.minute
      if (stopped || !Number.isFinite(M)) { pend = []; held = null; gapTo = null; return }
      // this frame's OWN minute is a gap (INCOMPLETE; a refused frame carries nothing): its own bars are not kept
      const unusable = gapTo != null && gapTo >= M
      if (gapTo != null && stats.frames > 0) stats.breaks++     // (diagnostics only: the first frame always follows a gap)
      gapTo = null
      if (!held) held = _heldNow()                              // (a frame with no accepted record never asked)
      for (const [sym, key] of held) {
        const st = syms.get(sym)
        if (st) st.key = key
        else syms.set(sym, { key, bars: new Map(), redo: new Set() })
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
        st.redo.add(minute)
      }
      pend = []
      through = M
      const floor = M - RING_MINUTES                            // NOT KEPT: anything older than RING_MINUTES
      for (const st of syms.values()) for (const k of st.bars.keys()) if (k < floor) st.bars.delete(k)
      stats.frames++
      _pump()
    },
  }

  return {
    sink,
    /** The rollup's `accept`: only the symbols of held regular 1m keys cost anything (a frame is 8,500 records). */
    accept(sym) {
      if (!held) held = _heldNow()
      return held.has(sym)
    },
    /** Is there anything to feed: a regular 1m key that is held and that no chart is on? (The page's gate asks before
     *  every poll: with none, a frame would be downloaded for nothing.) */
    wanted: () => _heldNow((key) => !isActive(key)).size > 0,
    /** Resolves when the appends of every frame applied so far are done (tests). */
    settled: () => done,
    stop() { stopped = true; syms.clear(); pend = []; held = null },
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
 * @param {object} [o.consumerOpts] / [o.feederOpts]   tests
 */
export function createPageMinuteFeed({
  store, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), visible = isAppVisible, killed = _killedNow,
  inSession = inRegularSession, onVisible = _onVisible, consumerOpts = {}, feederOpts = {},
} = {}) {
  const feeder = createMinuteFeeder({
    registry: store.registry, isActive: (key) => !!store.isActive?.(key), ...feederOpts,
  })
  const pollDelayMs = consumerOpts.pollDelayMs ?? POLL_DELAY_MS
  /** The backoff: answers in a row that were not a frame, pauses in a row, and until when the feed is paused. */
  const back = { fails: 0, pauses: 0, until: 0 }
  const st = { requests: 0, answered: 0, refused: 0, stopped: null, waiting: false }
  let consumer = null
  let offVisible = null

  /**
   * ⛔ BOUNDED, AND QUIET. An answer that is not a frame (the minute is not out, the edge is down, the network failed)
   * counts; FAIL_LIMIT in a row (one whole minute of asking) pause the feed for FAIL_PAUSE_MS, then twice that, up to
   * MAX_PAUSE_MS. A REFUSAL (401/403: the member is not entitled, or the edge cookie is gone) pauses at once, for
   * REFUSED_PAUSE_MS, doubling the same way: at most a handful of requests a session, and nothing is shown. While
   * paused every key is behind exactly as today. One frame clears it all.
   */
  function _failed(refused) {
    back.fails++
    if (!refused && back.fails < FAIL_LIMIT) return
    back.fails = 0
    back.pauses++
    back.until = now() + Math.min(MAX_PAUSE_MS, (refused ? REFUSED_PAUSE_MS : FAIL_PAUSE_MS) * 2 ** (back.pauses - 1))
  }

  async function watchedFetch(url, init) {
    st.requests++
    let r
    try { r = await fetchImpl(url, init) } catch (e) { _failed(false); throw e }
    if (r.ok) { st.answered++; back.fails = 0; back.pauses = 0; back.until = 0 }
    else if (r.status === 401 || r.status === 403) { st.refused++; _failed(true) }
    else _failed(false)
    return r
  }

  const api = {
    feeder,
    /** May a poll go now? The consumer asks before every step (its `isVisible`); false = look again later: when the
     *  next minute file is due (hidden, outside the session, paused: so the first poll after it is never a minute
     *  late), or after WANT_RECHECK_MS when the only reason is that there is nothing to feed yet. A throw from
     *  anything it reads counts as "no" (the consumer's tail mode fails closed). */
    gate() {
      st.waiting = false
      if (st.stopped) return false
      if (killed()) { api.stop('killed'); return false }        // the server's kill, on a page left open: for good
      const t = now()
      if (t < back.until) return false
      if (!visible()) return false
      // regular session only: the minute now due (it ended `pollDelayMs` ago) must be a regular-session minute
      if (!inSession(t - pollDelayMs - 60_000)) return false
      // ...and only while there is something to feed (the header: COST). Last, so `waiting` means exactly that.
      if (!feeder.wanted()) { st.waiting = true; return false }
      return true
    },
    start() {
      if (consumer || st.stopped) return
      consumer = createMinuteFrameConsumer({
        sink: feeder.sink, fetchImpl: watchedFetch, now, isVisible: api.gate,
        tailOnly: true, tailRetries: TAIL_RETRIES, pollDelayMs,
        recheckMs: () => (st.waiting ? WANT_RECHECK_MS : null),
        rollup: { tfs: [FEED_TF], accept: feeder.accept },
        ...consumerOpts,
      })
      offVisible = onVisible(() => { if (!st.stopped && visible()) consumer?.wake() })
      consumer.start()
    },
    stop(reason = 'stopped') {
      if (st.stopped) return
      st.stopped = reason
      try { consumer?.stop() } catch { /* ignore */ }
      try { offVisible?.() } catch { /* ignore */ }
      offVisible = null
      feeder.stop()
    },
    running: () => !!consumer && !st.stopped,
    /** Numbers only (a measurement harness reads them: window.__uctMinuteFeed.status()). */
    status: () => {
      const c = consumer?.status?.()
      return {
        running: !!consumer && !st.stopped, stopped: st.stopped, requests: st.requests, answered: st.answered,
        refused: st.refused, pausedUntil: back.until, pauses: back.pauses, waiting: st.waiting,
        lastSeq: c?.lastSeq ?? null, lastAppliedAt: c?.lastAppliedAt ?? 0, bytes: c?.bytes ?? 0, ...feeder.stats(),
      }
    },
  }
  return api
}
