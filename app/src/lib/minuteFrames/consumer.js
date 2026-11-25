// app/src/lib/minuteFrames/consumer.js — keeps a device current to the minute for EVERY symbol.
//
// Reads the universe minute frames stream-ingest publishes (api/services/minute_frame_publisher.py)
// through the edge (edge/bars-edge-router/live1m.js), applies them in sequence order to a rollup
// (rollup.js) that feeds a pluggable sink (the device store's append API, later). LAZY: nothing
// on a page's first open imports this module; `index.js` exposes a dynamic-import loader only.
//
// THE PROTOCOL (all GET, same origin, the member's edge cookie):
//   {base}/{YYYY-MM-DD}/head.json   newest seq published, newest seq inside today.bin
//   {base}/{YYYY-MM-DD}/{HHMM}.bin  one minute's frame (seq = minutes since 04:00 ET)
//   {base}/{YYYY-MM-DD}/today.bin   every frame of the day so far (refreshed every few minutes)
//
// IN ORDER, OR A GAP. Frames are applied strictly by seq. Before frame s is applied, every seq
// between the last applied one and s has been asked for; a seq that cannot be had is a GAP and
// the sink hears it (`sink.gap`), as it does for a frame the publisher marked INCOMPLETE (the
// vendor socket was down) and for a frame whose `prevSeq` says frames existed that this device
// never saw. A gap never stops the stream: the device stays current from the next minute, and
// the buckets that span the hole are PARTIAL until the device store repairs them.
//
// CATCH-UP. Opened mid-session, or back after a sleep: more than `maxMinuteFetches` behind, the
// consumer reads today.bin (one request) and replays its frames, then the minute files after it.
// Replaying the day's frames in order is exactly what a device that was live all day did, so
// the two end in the same state (rollup.test.js proves it).
//
// REFUSED IS A GAP, NOT A RETRY. A frame whose CRC holds but that this decoder cannot read (a flag bit it does
// not know, a section it cannot parse: codec FrameError.frame) is the publisher's own bytes, so asking again
// gets the same answer. It is applied as a GAP for its minute ('refused') and the stream goes on; before this a
// refused frame was asked for every 2 s, and in a catch-up the whole day file downloaded again each time.
// A frame that fails its CRC or is cut short (the bytes were damaged on the way) is still asked for again.
//
// THE SERVER'S DAILY ROWS (codec FLAG_DAILY). After the close a frame can carry the server's own day row per
// symbol. A publisher epoch's FIRST such frame carries every row, later ones only the rows that changed, so this
// device holds the server's rows exactly only when it applied that first frame and every frame after it. It
// knows a frame is its epoch's first only when it has every frame published before it: the first frame of a new
// epoch that follows an unbroken chain (a 'not-published' hole lost nothing). A not-received or link-mismatch gap,
// or a refused frame, may have lost rows: no trust until the next epoch's full set. The sink hears each section
// (`daily({ day, seq, minute, full, rows })`, `full`: it is that complete set) and, with every frame, whether its
// rows are now the server's (`frameDone({ ..., dailyOk })`).
//
// POLLS RESPECT VISIBILITY (CLAUDE.md speed rule 6): nothing is fetched while the app is hidden
// (`isVisible`, default lib/deskVisibility.isAppVisible); on becoming visible it catches up.
//
// ⭐ EVERY REQUEST AT LOW PRIORITY (2026-11-23, the live-session read of the device store). The feed shares the page's
// origin, so its requests (head.json, a minute file, and at a mid-session open today.bin, the whole day so far) share the
// connection with the chart's own: a switch's tail and its panes' columns. `priority: 'low'` (FEED_FETCH_PRIORITY) lets
// those go first. Each request keeps its cache mode (head.json `no-store`, the .bin files the default). The edge keys its
// cache on the path alone (edge/bars-edge-router/live1m.js), and a fetch that does not know the option ignores it
// (RequestInit is a dictionary).
//
// ⭐ TAIL ONLY (`tailOnly`, 2026-11-23: the bar store's page-side feed, data/barStore/minuteFeed.js). The device store
// wants the whole day (head.json, today.bin, a backlog of minute files). A reader that only keeps the copies it ALREADY
// holds current wants the newest minute and nothing else, so with `tailOnly` this consumer asks for ONE minute file a
// minute and never for head.json or today.bin (11-19 MB):
//   • the first step, a step after a pause (hidden, outside the caller's window) and a step after a minute it gave up
//     on all start again AT the minute now due. The minutes skipped are a GAP the sink hears when that frame is applied
//     (the same `applyChecked` as above: the format, the chain and the epoch are read by one piece of code);
//   • a minute file that is not there yet is asked again every `retryMs`, at most `tailRetries` times, then given up
//     (the next minute starts a new run).
// Off (the default), nothing here changes: the device store's consumer is the code above, as it was.

import {
  decodeFrame, todayInfo, todayFrames, inflateIfGzip, hhmmOfSeq, dailyRows, FrameError, NO_SEQ, SESSION_MINUTES,
  SESSION_START_MIN,
} from './codec'
import { createMinuteRollup } from './rollup'
import { etDateLabel, etMinuteOfDay } from '../../components/chart/barTime'
import { isAppVisible } from '../deskVisibility'

export const DEFAULT_BASE = '/api/hist/live1m/v1'
/** The feed's fetch priority (see the header): never ahead of the page's own requests. */
export const FEED_FETCH_PRIORITY = 'low'

class HttpError extends Error {
  constructor(status, url) { super(`${status} ${url}`); this.status = status }
}

/**
 * @param {object} o
 * @param {object} o.sink                  rollup sink (see rollup.js)
 * @param {string} [o.base]
 * @param {Function} [o.fetchImpl]         fetch(url, init) -> Response
 * @param {Function} [o.now]               ms clock
 * @param {Function} [o.isVisible]         () => boolean (default lib/deskVisibility.isAppVisible)
 * @param {object} [o.rollup]              options for createMinuteRollup
 * @param {number} [o.maxMinuteFetches]    behind by more than this -> read today.bin
 * @param {number} [o.pollDelayMs]         after a minute's end, when its frame is expected
 * @param {number} [o.jitterMs]            spread over this many ms (so a crowd does not land at once)
 * @param {number} [o.retryMs]             frame not there yet: ask again after this
 * @param {Function} [o.setTimer] / [o.clearTimer]
 * @param {number} [o.sliceMs]             the today.bin replay yields after this much work (loadToday)
 * @param {Function} [o.yieldTo]           () => Promise: how it yields (default: a 0 ms timer, a new task)
 * @param {Function} [o.elapsed]           a monotonic ms clock for the slices (default performance.now)
 * @param {boolean} [o.tailOnly]           follow the newest minute only: never head.json, never today.bin (see the header)
 * @param {number} [o.tailRetries]         tailOnly: asks again for a minute file that is not there yet, before giving it up
 * @param {number|Function} [o.recheckMs]  while `isVisible` says no: when to look again (default a minute; a function
 *                                         is asked each time, so a caller can look sooner for a reason it knows).
 *                                         A value that names no time (null): tailOnly looks again when the next
 *                                         minute file is DUE, so the first poll after a "not now" is never a minute late
 */
export function createMinuteFrameConsumer({
  sink, base = DEFAULT_BASE, fetchImpl = (...a) => fetch(...a), now = () => Date.now(),
  isVisible = isAppVisible, rollup: rollupOpts = {}, maxMinuteFetches = 20, pollDelayMs = 7000,
  jitterMs = 3000, retryMs = 2000, setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t), random = Math.random,
  sliceMs = 8, yieldTo = () => new Promise((r) => setTimeout(r, 0)),
  elapsed = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  tailOnly = false, tailRetries = 3, recheckMs = 60_000,
} = {}) {
  const rollup = createMinuteRollup({ sink, ...rollupOpts })
  let day = null            // 'YYYY-MM-DD' being followed
  let lastSeq = null        // newest seq applied (null = none today)
  let timer = null
  let running = false
  let busy = null
  const st = { frames: 0, refused: 0, todayLoads: 0, bytes: 0, gaps: [], errors: 0, lastError: null, lastAppliedAt: 0 }
  /** The DAILY trust of the epoch being followed (see the header). */
  const dly = { epoch: null, knownStart: false, seen: false, ok: false }
  /** tailOnly: the seq being asked for and how often it was not there. */
  const tail = { want: null, tries: 0 }
  /** askMinute: the reads asked so far, one after the other. */
  let asking = Promise.resolve()

  const visible = () => {
    // A gate that THROWS: the device store's consumer goes on as it always did (its gate is only "is a tab visible").
    // tailOnly FAILS CLOSED (review of #2639, L2): there the caller's gate is also its kill switch, its session window
    // and its backoff, and a poll that goes because the gate broke is exactly what those exist to stop.
    if (typeof isVisible === 'function') { try { return isVisible() !== false } catch { return !tailOnly } }
    return true
  }

  async function getBytes(url, init) {
    const r = await fetchImpl(url, { credentials: 'same-origin', priority: FEED_FETCH_PRIORITY, ...init })
    if (!r.ok) throw new HttpError(r.status, url)
    const u8 = new Uint8Array(await r.arrayBuffer())
    st.bytes += u8.length
    return inflateIfGzip(u8)
  }

  async function getJson(url) {
    const r = await fetchImpl(url, { credentials: 'same-origin', cache: 'no-store', priority: FEED_FETCH_PRIORITY })
    if (!r.ok) throw new HttpError(r.status, url)
    return r.json()
  }

  function gap(fromSeq, toSeq, reason, minuteOf) {
    if (toSeq < fromSeq) return
    const info = { day, fromSeq, toSeq, reason }
    st.gaps.push(info)
    if (st.gaps.length > 50) st.gaps.shift()
    rollup.markGap(minuteOf(fromSeq), minuteOf(toSeq), info)
  }

  /** Apply one decoded frame (or a refused one: `{ refused: true, ...header }`) after checking it follows what
   *  this device holds. */
  function applyChecked(f, file = false) {
    const fd = `${Math.floor(f.day / 10000)}-${String(Math.floor(f.day / 100) % 100).padStart(2, '0')}-${String(f.day % 100).padStart(2, '0')}`
    if (fd !== day) startDay(fd)                                     // a frame of another day starts it
    if (lastSeq != null && f.seq <= lastSeq) return false            // already applied
    // seq -> unix minute on this frame's day (wall-clock minutes from 04:00; DST-safe within a day)
    const minuteOf = (s) => f.minute - (f.seq - s)
    const expectedFrom = lastSeq == null ? 0 : lastSeq + 1
    let broke = false              // frames were published that this device did not apply
    if (f.seq > expectedFrom) {
      // Missing seqs. Who missed them: the publisher (prevSeq below them, or none) or this device
      // (prevSeq inside the hole: frames existed that never arrived here). A gap either way.
      const reason = f.prevSeq === NO_SEQ || f.prevSeq < expectedFrom ? 'not-published' : 'not-received'
      broke = reason === 'not-received'
      gap(expectedFrom, f.seq - 1, lastSeq == null && f.prevSeq === NO_SEQ ? 'before-first-frame' : reason, minuteOf)
    } else if (f.prevSeq !== NO_SEQ && lastSeq != null && f.prevSeq !== lastSeq) {
      broke = true
      gap(Math.min(f.prevSeq, lastSeq) + 1, f.seq - 1, 'link-mismatch', minuteOf)
    }
    if (f.epoch !== dly.epoch) Object.assign(dly, { epoch: f.epoch, knownStart: !broke, seen: false, ok: false })
    else if (broke) { dly.knownStart = false; dly.ok = false }
    if (f.refused) {
      // the publisher's own bytes, unreadable here: its minute is a gap, and anything it carried is lost
      gap(f.seq, f.seq, 'refused', minuteOf)
      dly.knownStart = false
      dly.ok = false
      st.refused++
    } else {
      rollup.applyFrame(f)
      if (!f.complete) gap(f.seq, f.seq, 'incomplete', minuteOf)
      if (f.daily) {
        const full = !dly.seen && dly.knownStart
        if (full) dly.ok = true
        dly.seen = true
        sink.daily?.({ day, seq: f.seq, minute: f.minute, full, rows: dailyRows(f) })
      }
    }
    lastSeq = f.seq
    st.frames++
    st.lastAppliedAt = now()
    // withAv: the frame carried the vendor's accumulated day volume (FLAG_AV); the device store's forming
    // daily bar is painted only when every frame of the day did (deviceStore/forming.js). dailyOk: the DAILY
    // rows this device holds are the server's current ones (see the header).
    // file: this frame was read as ITS OWN minute file (a step, the catch-up's minute files), not replayed from
    // today.bin. Only such a minute is in the browser's HTTP cache under its own URL (lib/minuteFrames/applied.js).
    sink.frameDone?.({ day, seq: f.seq, minute: f.minute, withAv: !f.refused && !!f.withAv, dailyOk: dly.ok, file: file === true })
    return true
  }

  function startDay(d) {
    if (day === d) return
    day = d
    lastSeq = null
    rollup.reset()
    Object.assign(dly, { epoch: null, knownStart: false, seen: false, ok: false })
    st.gaps = []
    sink.reset?.({ day: d })
  }

  /** The seq whose frame should exist by `ms` (its minute ended pollDelayMs ago), or -1. */
  function dueSeq(ms) {
    const sec = Math.floor((ms - pollDelayMs) / 1000)
    const mod = etMinuteOfDay(sec)
    const s = mod - SESSION_START_MIN - 1          // the minute that just ENDED
    return Math.min(s, SESSION_MINUTES - 1)
  }

  async function loadToday(upTo) {
    const raw = await getBytes(`${base}/${day}/today.bin`)
    const info = todayInfo(raw)
    st.todayLoads++
    // ⭐ (2026-11-21, the cold switch) THE REPLAY YIELDS. A day file is up to 960 minutes of the whole universe;
    // applied in one go it held the worker for the whole replay, and every device read a switch made in that
    // time waited behind it. Now it gives the thread back every `sliceMs` of work (a read answers in between,
    // from the minutes applied so far: its `through` says how far that is).
    let t0 = elapsed()
    for (const f of todayFrames(raw, { refused: true })) {
      if (f.seq > upTo) break
      applyChecked(f)
      if (elapsed() - t0 >= sliceMs) { await yieldTo(); t0 = elapsed() }
    }
    return info.seq
  }

  /** Bring this device up to `head.seq`. */
  async function catchUp() {
    const d = etDateLabel(Math.floor(now() / 1000))
    startDay(d)
    let head
    try {
      head = await getJson(`${base}/${day}/head.json`)
    } catch (e) {
      if (e.status === 404) return { idle: true }       // nothing published today (yet)
      throw e
    }
    const target = head.seq
    if (target == null || (lastSeq != null && lastSeq >= target)) return { current: true }
    let from = lastSeq == null ? 0 : lastSeq + 1
    if (target - from + 1 > maxMinuteFetches && head.today_seq != null && head.today_seq >= from) {
      await loadToday(target)
      from = lastSeq == null ? 0 : lastSeq + 1
    }
    // Still far behind (no today file yet): only the newest minutes are fetched one by one; the
    // older ones become a gap when the first of these is applied (applyChecked).
    if (target - from + 1 > maxMinuteFetches) from = target - maxMinuteFetches + 1
    for (let s = from; s <= target; s++) {
      const f = await fetchFrame(s)
      if (f) applyChecked(f, true)  // a seq that is not there becomes a gap when the next one lands
    }
    return { current: lastSeq != null && lastSeq >= target }
  }

  /** One minute file, or null when it is not there; a frame refused for good comes back as
   *  `{ refused: true, error, ...header }` (applied as a gap, never asked for again). */
  async function fetchFrame(seq) {
    try {
      const raw = await getBytes(`${base}/${day}/${hhmmOfSeq(seq)}.bin`)
      return decodeFrame(raw)
    } catch (e) {
      if (e.status === 404) return null
      if (e instanceof FrameError && e.frame) return { refused: true, error: e.message, ...e.frame }
      throw e
    }
  }

  /** tailOnly (see the header): the minute now due, and nothing else. One behind is the steady state (the next
   *  file). Further behind, the run starts again at the due minute: never head.json, never today.bin, never a backlog. */
  async function stepTail() {
    const d = etDateLabel(Math.floor(now() / 1000))
    if (d !== day) startDay(d)
    const due = dueSeq(now())
    if (due < 0 || (lastSeq != null && lastSeq >= due)) return { current: true }
    const want = lastSeq != null && due - lastSeq === 1 ? lastSeq + 1 : due
    if (want !== tail.want) { tail.want = want; tail.tries = 0 }
    let f
    try {
      f = await fetchFrame(want)
    } catch (e) {
      // damaged bytes, a 5xx, the network: asked again like a minute that is not there, and given up the same way
      // (the tick's own retry has no bound: it is the device store's, which then reads head.json)
      if (++tail.tries > tailRetries) return { current: true }
      throw e
    }
    if (f) { applyChecked(f, true); return { current: true } }
    // not there yet: asked again a bounded number of times, then this minute is given up (the next one is a new run)
    return ++tail.tries <= tailRetries ? { retry: true } : { current: true }
  }

  /** The steady-state step: the next frame, directly (no head read) when it is due. */
  async function step() {
    if (tailOnly) return stepTail()
    const d = etDateLabel(Math.floor(now() / 1000))
    if (d !== day || lastSeq == null) return catchUp()
    const due = dueSeq(now())
    if (due < 0 || lastSeq >= due) return { current: true }
    if (due - lastSeq > 1) return catchUp()             // more than one behind: let head decide
    const f = await fetchFrame(lastSeq + 1)
    if (f) { applyChecked(f, true); return { current: true } }
    return { retry: true }
  }

  function schedule(ms) {
    if (!running) return
    if (timer) clearTimer(timer)
    timer = setTimer(tick, Math.max(0, ms))
  }

  function nextDelay(result) {
    if (result?.retry) return retryMs
    const t = now()
    const sec = Math.floor(t / 1000)
    const mod = etMinuteOfDay(sec)
    if (mod < SESSION_START_MIN || mod >= SESSION_START_MIN + SESSION_MINUTES + 1) {
      // Outside the 04:00-20:00 session: sleep until the first frame of the next one is due
      // (re-checked at least hourly, so a sleeping laptop or a DST night cannot oversleep it).
      const untilOpen = ((SESSION_START_MIN + 1 - mod + 1440) % 1440) * 60_000 - (t % 60_000)
      return Math.min(untilOpen, 3_600_000) + pollDelayMs + Math.floor(random() * jitterMs)
    }
    if (result?.idle) return 5 * 60_000 + Math.floor(random() * jitterMs)   // nothing published today yet
    if (tailOnly) {
      // The next file is due `pollDelayMs` after ITS minute ends, which is not always the end of the minute the clock
      // is in: a step taken in a minute's first seconds (the first one, a wake) applied the minute BEFORE the one that
      // just ended, and that one's file is due in a moment, not a minute from now. (From `pollDelayMs` into a minute
      // on, this is the line below.) Without it the run would skip a minute at every such step: a gap of its own making.
      return untilNextDue(t)
    }
    const nextMinuteEnd = (Math.floor(t / 60_000) + 1) * 60_000
    return nextMinuteEnd - t + pollDelayMs + Math.floor(random() * jitterMs)
  }

  /** tailOnly: ms from `t` until the next minute file is due (`pollDelayMs` after its minute ends), plus the jitter. */
  function untilNextDue(t) {
    const nextDue = (Math.floor((t - pollDelayMs) / 60_000) + 1) * 60_000 + pollDelayMs
    return nextDue - t + Math.floor(random() * jitterMs)
  }

  /** How long until the next look while `isVisible` says no (see `recheckMs`). A time the caller names is taken as it
   *  is. None named: tailOnly looks again when the next file is due (a wait of "a minute from now" made the session's
   *  first file, and the first after a pause, up to a minute late: review of #2639, L2); otherwise a minute. */
  function recheck() {
    let ms = recheckMs
    if (typeof recheckMs === 'function') { try { ms = recheckMs() } catch { ms = 60_000 } }
    if (Number.isFinite(ms) && ms > 0) return ms
    return tailOnly ? untilNextDue(now()) : 60_000
  }

  async function tick() {
    timer = null
    if (!running) return
    if (!visible()) { schedule(recheck()); return }
    let result = null
    try {
      busy = step()
      result = await busy
      st.lastError = null
    } catch (e) {
      st.errors++
      st.lastError = String(e?.message || e).slice(0, 160)
      result = { retry: e?.status == null || e.status >= 500 }
    } finally {
      busy = null
    }
    schedule(nextDelay(result))
  }

  return {
    rollup,
    /** Start following (idempotent). Catches up at once. */
    start() { if (running) return; running = true; schedule(0) },
    stop() { running = false; if (timer) clearTimer(timer); timer = null },
    /** Catch up now (e.g. the app became visible). Resolves when done. (tailOnly: the due minute, never a catch-up.) */
    async syncNow() { if (busy) await busy.catch(() => {}); return tailOnly ? stepTail() : catchUp() },
    /** Take the next step now instead of at its timer (the page is visible again). Nothing while a step is in flight
     *  or when stopped. */
    wake() { if (running && !busy) schedule(0) },
    /**
     * Read ONE minute file because the caller was TOLD it is there (data/barStore/minuteFeed.js with the device store
     * on: lib/minuteFrames/applied.js), and apply it through the same check as every other frame. No schedule, no
     * retry, no timer: a consumer used this way is never started. One read at a time, in the order asked. Resolves
     * { current: true } (applied, or already held), { missing: true } (a 404); rejects when the read failed (a cache-only
     * miss, a 5xx, damaged bytes).
     */
    askMinute(d, seq) {
      const run = asking.then(async () => {
        if (d !== day) startDay(d)
        if (lastSeq != null && seq <= lastSeq) return { current: true }
        const f = await fetchFrame(seq)
        if (!f) return { missing: true }
        applyChecked(f, true)
        return { current: true }
      })
      asking = run.catch(() => {})
      return run
    },
    /** Apply one already-decoded frame (tests, or a frame the device got another way). */
    applyFrame: (f) => applyChecked(f),
    status: () => ({ day, lastSeq, running, ...st, gaps: st.gaps.map((g) => ({ ...g })), rollup: rollup.stats() }),
    _step: step,
  }
}
