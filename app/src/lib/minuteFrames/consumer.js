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

import {
  decodeFrame, todayInfo, todayFrames, inflateIfGzip, hhmmOfSeq, dailyRows, FrameError, NO_SEQ, SESSION_MINUTES,
  SESSION_START_MIN,
} from './codec'
import { createMinuteRollup } from './rollup'
import { etDateLabel, etMinuteOfDay } from '../../components/chart/barTime'
import { isAppVisible } from '../deskVisibility'

export const DEFAULT_BASE = '/api/hist/live1m/v1'

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
 */
export function createMinuteFrameConsumer({
  sink, base = DEFAULT_BASE, fetchImpl = (...a) => fetch(...a), now = () => Date.now(),
  isVisible = isAppVisible, rollup: rollupOpts = {}, maxMinuteFetches = 20, pollDelayMs = 7000,
  jitterMs = 3000, retryMs = 2000, setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t), random = Math.random,
  sliceMs = 8, yieldTo = () => new Promise((r) => setTimeout(r, 0)),
  elapsed = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
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

  const visible = () => {
    if (typeof isVisible === 'function') { try { return isVisible() !== false } catch { return true } }
    return true
  }

  async function getBytes(url, init) {
    const r = await fetchImpl(url, { credentials: 'same-origin', ...init })
    if (!r.ok) throw new HttpError(r.status, url)
    const u8 = new Uint8Array(await r.arrayBuffer())
    st.bytes += u8.length
    return inflateIfGzip(u8)
  }

  async function getJson(url) {
    const r = await fetchImpl(url, { credentials: 'same-origin', cache: 'no-store' })
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
  function applyChecked(f) {
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
    sink.frameDone?.({ day, seq: f.seq, minute: f.minute, withAv: !f.refused && !!f.withAv, dailyOk: dly.ok })
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
      if (f) applyChecked(f)        // a seq that is not there becomes a gap when the next one lands
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

  /** The steady-state step: the next frame, directly (no head read) when it is due. */
  async function step() {
    const d = etDateLabel(Math.floor(now() / 1000))
    if (d !== day || lastSeq == null) return catchUp()
    const due = dueSeq(now())
    if (due < 0 || lastSeq >= due) return { current: true }
    if (due - lastSeq > 1) return catchUp()             // more than one behind: let head decide
    const f = await fetchFrame(lastSeq + 1)
    if (f) { applyChecked(f); return { current: true } }
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
    const nextMinuteEnd = (Math.floor(t / 60_000) + 1) * 60_000
    return nextMinuteEnd - t + pollDelayMs + Math.floor(random() * jitterMs)
  }

  async function tick() {
    timer = null
    if (!running) return
    if (!visible()) { schedule(60_000); return }
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
    /** Catch up now (e.g. the app became visible). Resolves when done. */
    async syncNow() { if (busy) await busy.catch(() => {}); return catchUp() },
    /** Apply one already-decoded frame (tests, or a frame the device got another way). */
    applyFrame: (f) => applyChecked(f),
    status: () => ({ day, lastSeq, running, ...st, gaps: st.gaps.map((g) => ({ ...g })), rollup: rollup.stats() }),
    _step: step,
  }
}
