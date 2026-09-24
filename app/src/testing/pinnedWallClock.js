// app/src/testing/pinnedWallClock.js
//
// ─── PIN THE WALL CLOCK TO A STATED INSTANT — SHIFTED, NOT FROZEN ─────────────
//
// For a render harness whose subject reads `new Date()` / `Date.now()` to decide
// what SESSION WINDOW it is in (RTH · after the bell · pre-open · weekend), the
// wall clock is an INPUT, and an input nobody sets is set by whoever happens to run
// the suite. `pinWallClock(iso)` makes it explicit: from the call onward every
// `new Date()` and `Date.now()` — in the test AND in the product code it renders —
// answers as if the run had started at `iso`, and keeps ADVANCING from there at
// real speed.
//
// ⛔ WHY NOT `vi.useFakeTimers` + `vi.setSystemTime`: that FREEZES the clock, and a
// harness that polls `while (Date.now() < deadline) await tick()` never advances —
// it hangs until the test timeout. `shouldAdvanceTime` moves it in 20 ms steps,
// which quantises every latency the harness measures and lets a cache paint and a
// network resolution land in the same bucket and be misordered. A shifted real
// clock has neither problem: exact, monotonic, and `setTimeout`/`rAF` untouched.
//
// ⚰️ The case it was written for: `dailyFirstPaintAcceptance.test.jsx` was
// committed at 14:26 ET (inside RTH) and green there, and went red every day from
// 16:00 ET, because after the bell the product DEFERS a today-dated daily cache to
// the sealed close by design (`isDailyTodayCloseProvisionalForPaint`, a663b0d67).
// The suite's claim "correct in any session window" was never true; the window is
// now stated. Measured 2026-09-24: real clock 18:12 ET -> 3 red · pinned 14:26 ET
// on the same tree -> 18/18 · pinned 18:12 ET on the author's own day -> same 3 red.
//
// ⚠️ Instances stay REAL `Date`s (shared prototype), so `instanceof Date`,
// `toLocaleString`, arithmetic and JSON all behave. `Date.parse` / `Date.UTC` are
// passed through untouched — only the ZERO-ARGUMENT constructor and `Date.now()`
// are shifted, because those are the only two reads of "now".

const PIN_MARK = '__uctPinnedWallClock'

/**
 * @param {string} targetIso  the instant "now" should read as, e.g. '2026-09-22T18:26:00Z'
 * @returns {{ shiftMs: number, retarget: (iso: string) => number, restore: () => void }}
 *   `retarget(iso)` moves the pin (same mechanism, no restore/re-pin dance) and
 *   returns the new shift; `restore()` puts the real `Date` back.
 */
export function pinWallClock(targetIso) {
  if (globalThis.Date && globalThis.Date[PIN_MARK]) {
    throw new Error('pinWallClock: the wall clock is already pinned — retarget() or restore() first')
  }
  const RealDate = globalThis.Date
  const parsed = new RealDate(targetIso).getTime()
  if (!Number.isFinite(parsed)) throw new Error(`pinWallClock: not an instant: ${String(targetIso)}`)
  let shift = parsed - RealDate.now()

  function PinnedDate(...args) {
    if (!new.target) return new RealDate(RealDate.now() + shift).toString()
    return args.length === 0 ? new RealDate(RealDate.now() + shift) : new RealDate(...args)
  }
  PinnedDate.prototype = RealDate.prototype
  PinnedDate.now = () => RealDate.now() + shift
  PinnedDate.parse = RealDate.parse
  PinnedDate.UTC = RealDate.UTC
  PinnedDate[PIN_MARK] = true
  Object.setPrototypeOf(PinnedDate, RealDate)

  const install = (D) => {
    globalThis.Date = D
    if (typeof window !== 'undefined' && window && window.Date !== D) window.Date = D
  }
  install(PinnedDate)

  return {
    get shiftMs() { return shift },
    retarget(iso) {
      const t = new RealDate(iso).getTime()
      if (!Number.isFinite(t)) throw new Error(`pinWallClock.retarget: not an instant: ${String(iso)}`)
      shift = t - RealDate.now()
      return shift
    },
    restore() { install(RealDate) },
  }
}

/** ET wall-clock text for a log line, e.g. 'Tue 09/22 14:26' — so a run SAYS which window it is in. */
export function wallClockET(d = new Date()) {
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York', weekday: 'short', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(/,/g, '')   // 'Tue, 09/22, 18:12' → 'Tue 09/22 18:12' (the rail caught the single-replace)
}
