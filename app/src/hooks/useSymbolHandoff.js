// ── ATOMIC SYMBOL HANDOFF ────────────────────────────────────────────────────
//
// ⛔⛔ THE DEFECT. Selecting B tore the canvas down before B's data existed, so
// every switch went A → BLACK → B. Measured on an idle machine: the teardown
// fires on 100% of switches, and the blank window is 16ms when B is already
// warm but 226ms for an hours-behind cache and 274ms cold — plainly visible.
//
// ⭐ THE FIX IS TO STOP SHOWING StockChart A SYMBOL IT CANNOT YET DRAW. If the
// chart keeps rendering A until B is ready, its own teardown never fires
// mid-switch, A stays coherent, and B arrives already paintable. No second
// chart, no snapshot, no overlay — one chart, shown one coherent symbol at a
// time.
//
//   A identity + A chart  →  prepare B off the visible path  →  atomic commit
//                         →  B identity + B current-enough chart
//
// ⛔ THERE IS STILL EXACTLY ONE SYMBOL AUTHORITY. The colour group remains the
// only writable symbol state; `displayedSym` is a RENDER LAG derived from it,
// never persisted, never written back, and it always converges on the request.
// Nothing reads it to decide what to fetch or what to save — it decides only
// what is on screen this frame.
//
// ⚠️ MIXED IDENTITY IS THE FAILURE MODE THIS EXISTS TO PREVENT, so the lag
// covers the WHOLE identity surface (header, company, quote, dock, holdings,
// legend) by being applied at the ChartWidget boundary — above every consumer —
// rather than inside the chart where half of them live outside its tree.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { settleAction, BURST_SETTLE_MS } from './useSymbolSettle'
import { groupJoin, groupLeave, groupReady, registerMember, settleClock, createSettleClock, decisionFor, subscribeDecisions, latestOnly } from './handoffGroups'
import { memPeek } from '../utils/barsMemCache'
import * as legacyPrefetch from '../utils/prefetchBars'
import * as storePrefetch from '../data/barStore/prefetch'
import { BARSTORE } from '../components/chart/barStoreSwitch'
import { viewCacheTf } from '../utils/viewSession'
import { isCurrentEnoughForPaint } from '../utils/marketSession'
import { isNativeTf, fetchTf } from '../components/chart/timeframes'
import { columnsReadyFor, whenColumnsReady, warmColumnsFor } from '../components/chart/engine/serverCompute'
import { deviceStoreEnabled } from '../data/deviceStore/switch'
import { deviceSource } from '../data/deviceStore/source'
import { noteDeviceSwitch, exposeDeviceDiag, deviceDiagOn } from '../data/deviceStore/diag'

const INTRADAY = new Set(['1', '5', '15', '30', '60'])
/** The longest a switch waits for its panes' server columns before it commits anyway. */
export const COLUMNS_WAIT_MS = 300

// ⭐ P3-S1: the handoff prepares through the SAME source the chart reads (chart/barStoreSwitch.js,
// read once at module load). Under BARSTORE: the store's facade (data/barStore/prefetch) — its
// prepare ensures THE key the chart subscribes to (no SWR preload: the chart reads the store),
// its peek is the store's status, and the held-set test reads the store (`peekBars`) instead of
// the mem cache alone.
const P = BARSTORE ? storePrefetch : legacyPrefetch
// ⭐ The on-device store (data/deviceStore, per-browser switch 'uct.deviceStore'): a CURRENT device copy paints at
// once (storePrefetch.devicePaints), not after the deep joins the switch otherwise waits for. The switch is ONE
// decision per page load (switch.js, review of #2537 M3): this read, the BarStore's and the diagnostics' below agree.
const DEVICE = BARSTORE && deviceStoreEnabled()
const devicePaints = (sym, tf, opts) => DEVICE && storePrefetch.devicePaints(sym, tf, opts)
/** The chart's own device refusal for the key (sym, tf) shows, NOW (prefetch.deviceHold), or null. Device store on only. */
const deviceHoldFor = (sym, tf, opts) => {
  if (!DEVICE) return null
  try { return storePrefetch.deviceHold?.(sym, tf, opts) ?? null } catch { return null }
}
// the worker's rule for a switch the device did not paint (diag.js); null source (the page's store is off): nothing loads
const deviceWhy = (sym, tf) => { const src = deviceSource(); return src ? src.why(sym, tf) : Promise.resolve('no-client') }
// ⭐ DIAGNOSTICS FOR A TESTER ONLY (review of #2537, L2: diag.deviceDiagOn): a record costs a worker lookup per switch
// the device did not paint, which no member on the default should pay. Read once per page load, like DEVICE.
const DIAG = DEVICE && deviceDiagOn()
if (DIAG) exposeDeviceDiag()
/**
 * ⭐ (2026-11-20, the owner's cold path) ROWS THAT COVER THE VIEW PAINT AT ONCE. A cold switch reproduced in
 * the owner's layout (D + 30m, four averages): every 30m handoff took the intraday prepare with the lake's
 * depth still due, and waited median 564 ms (p90 711) for it AFTER the server's 1,120 rows had landed
 * (~110 ms); the 30m chart showed the previous ticker that long. The daily side waited the deep join the
 * same way. A view needs its visible bars (~200 at the default zoom) plus the longest lookback the averages
 * use (200 bars) to draw exactly what the whole history would draw there; COVER_ROWS is that with a margin,
 * and the chart's render window (newest >= 600 rows) holds no more. So a held key with this many rows paints
 * now, and the depth joins behind the view (it moves no right-edge geometry; the first-paint rails hold it).
 */
export const COVER_ROWS = 600
const covers = (sym, tf, opts = {}) => BARSTORE && (storePrefetch.heldRows?.(sym, tf, opts) ?? 0) >= COVER_ROWS

// ⭐⭐ ONE FRAME FOR THE WHOLE GROUP (owner, hard rule, 2026-11-20). WHEN a member of a linked group shows a
// new symbol lives in ./handoffGroups.js: the key handler's DECISION (every member can show it now: one
// synchronous render, one commit) and, when it says no, the bounded ROUND (moved there unchanged, 2026-11-21).
// Re-exported under the names the round had here.
export { GROUP_SYNC_MS } from './handoffGroups'
export { __resetHandoffGroupsForTests as __resetGroupRoundsForTests } from './handoffGroups'
let _memberIds = 0

/** Does the chart's source already hold a D/W/M set for (sym, tf)? */
function holdsDailySet(sym, tf) {
  if (BARSTORE && storePrefetch.holdsBars(sym, tf)) return true   // count only: no legacy array per switch
  return !!memPeek(sym, viewCacheTf(tf))?.length
}

/** Is a bar series current enough to become the FIRST VISIBLE FRAME for (tf)?
 *  Daily and non-native codes are always eligible — the frontier arithmetic is
 *  intraday bucket maths, and a custom tf resolves through its native base. */
function seriesDisplayable(bars, tf) {
  if (!bars?.length) return false
  if (!INTRADAY.has(String(tf))) return true
  const lastT = bars[bars.length - 1]?.t
  if (typeof lastT !== 'number') return false
  return isCurrentEnoughForPaint(lastT, tf)
}

/** SYNCHRONOUS readiness — the fast path. A neighbour the warmer already
 *  promoted to the mem cache commits in the SAME tick, so a warm switch pays
 *  nothing for this coordinator (measured ~19ms TC, and that must not move). */
// `showExtended`: the PANE's extended-hours setting (the chart key of 60m depends on it). Under
// BARSTORE it selects the key through the facade's ONE view-key function (the chart's own);
// omitted → the view-global fallback (the legacy source keeps that rule).
export function peekDisplayable(sym, tf, { showExtended } = {}) {
  if (!sym || !tf) return false
  // Anything the handoff does not govern is displayable by definition.
  if (!isNativeTf(tf) || !INTRADAY.has(String(tf))) return true
  if (BARSTORE) return storePrefetch.peekDisplayable(sym, tf, { showExtended })   // the store's status: context | current
  // The key the chart in this view reads ('60e' = 60m on the extended clock grid).
  return seriesDisplayable(memPeek(sym, viewCacheTf(tf)), tf)
}

/** The pane's session option for (showExtended): a boolean, or a ref read now (see the hook's param). */
function sessOf(showExtended) {
  const ext = (showExtended && typeof showExtended === 'object') ? showExtended.current : showExtended
  return { showExtended: typeof ext === 'boolean' ? ext : undefined }
}

const DAILY_SYM = /^[A-Z0-9.^-]{1,12}$/i
/** Must a D/W/M switch hold the previous chart (the bounded daily prepare) before it can show `sym`?
 *  ⛔ D/W/M NEVER WAITS ON THE INTRADAY PREPARE, BUT IT MUST NOT BLANK EITHER. Measured on production: a daily
 *  symbol not yet in memory committed at once and tore the canvas down, 2 blank frames for a disk-cached name and
 *  6 (~100 ms) for one never seen, then repainted in the same place. So a daily symbol not already in memory is
 *  promoted (or fetched) first, and A stays whole meanwhile. A pseudo symbol (`$IDX:…`) has no bars lane.
 *  ⭐ ...AND A HELD SET PAINTS AT ONCE ONLY WHEN ITS DEEP HISTORY IS NOT STILL DUE (2026-11-19, owner: "about 200
 *  bars instantly and then the rest shortly after, definitely in 2 phases"): a shallow held set (the pack's ~300
 *  rows) whose deep history has not joined goes through the same bounded prepare, which waits for the join. */
function dailyHoldNeeded(sym, tf) {
  return isNativeTf(tf) && !INTRADAY.has(String(tf)) && DAILY_SYM.test(String(sym))
    && (!holdsDailySet(sym, tf) || (BARSTORE && storePrefetch.deepPending(sym, tf) && !devicePaints(sym, tf)))
}

/** ⭐ ONE PAINT, THE WHOLE CHART (2026-11-17, owner: "a good chunk, then the rest a quick blink later"). A held
 *  key paints at once only when the lake's whole depth is not still due for it (or the device's copy, or rows
 *  that cover the view, paint it); otherwise the intraday prepare waits for that join. */
function paintsWholeNow(sym, tf, sess) {
  return peekDisplayable(sym, tf, sess)
    && !(BARSTORE && INTRADAY.has(String(tf)) && storePrefetch.lakePending(sym, fetchTf(tf), sess)
      && !devicePaints(sym, fetchTf(tf), sess) && !covers(sym, fetchTf(tf), sess))
}

/** How a switch to `sym` can be shown, decided synchronously (pure: reads the caches, starts nothing):
 *   'econ'       an economic series (`ECON:USCPI`): no bars lane, the chart loads it itself; shown at once
 *   'daily-hold' a D/W/M set to promote or join first (dailyHoldNeeded): the bounded daily prepare
 *   'now'        displayable and whole (or a code this coordinator does not govern): shown once its panes'
 *                server columns have landed (COLUMNS_WAIT_MS)
 *   'prepare'    the intraday prepare, then shown on what it reports */
function sameTaskRoute(sym, tf, sess) {
  if (/^ECON:/i.test(String(sym))) return 'econ'
  if (dailyHoldNeeded(sym, tf)) return 'daily-hold'
  if (paintsWholeNow(sym, tf, sess)) return 'now'
  // ⛔ THE INTRADAY PREPARE IS FOR INTRADAY ONLY. A custom code (2m, 45m...) fetches its own base, which this
  // coordinator has no view of, and passes straight through.
  if (!isNativeTf(tf) || !INTRADAY.has(String(tf))) return 'now'
  return 'prepare'
}

/** ⭐ DIAGNOSTICS (a tester's page only: DIAG, the device store on AND diag.deviceDiagOn): ONE record per switch, at
 *  its commit, of what the first frame is built
 *  from and, when it is not the device copy, which rule refused it (data/deviceStore/diag.js). Read by no
 *  decision; a failure here never costs the switch. */
function noteDeviceFor(sym, tf, sess, outcome, pre = null, gate) {
  if (!DIAG) return
  try {
    const intraday = INTRADAY.has(String(tf))
    const vtf = intraday ? fetchTf(tf) : tf
    const v = storePrefetch.deviceVerdict(sym, vtf, intraday ? sess : {})
    // queue: the device client's reads in flight at this commit (a held arrow's backlog, if any)
    let queue = null
    try { queue = deviceSource()?.inFlight?.() ?? null } catch { queue = null }
    // `gate` (2026-11-23): the key handler's decision for this chart: null = it could show it in the key task;
    // 'settle' | 'route:daily-hold' | 'route:prepare' | 'columns' = the gate it failed (decisionGateFor); 'unasked' = an
    // earlier chart of the group failed first, so this one was not asked
    const rec = noteDeviceSwitch({ sym, tf: String(tf), at: performance.now(), outcome, painted: v.held, reason: v.reason, why: null, queue, pre, gate })
    if (v.held !== 'device') deviceWhy(sym, vtf).then((w) => { rec.why = w }, () => { rec.why = 'error' })
  } catch { /* diagnostics only */ }
}

/** ⭐ DIAGNOSTICS (2026-11-21): the device rule's answer for this chart's key NOW, while no server answer holds it
 *  (null once one does, and without DIAG). A switch that waited commits after the server answered, and
 *  its record's own verdict then reads 'held:rest' whatever kept the device copy from painting in the meantime
 *  (devgates 2026-11-21: 107 of 116 typed and 70-row records said only that). The last answer seen here is the record's `pre`. */
function deviceRuleBeforeAnswer(sym, tf, sess) {
  if (!DIAG) return null
  try {
    const intraday = INTRADAY.has(String(tf))
    const v = storePrefetch.deviceVerdict(sym, intraday ? fetchTf(tf) : tf, intraday ? sess : {})
    return v && v.held !== 'rest' && v.held !== 'server' ? v.reason : null
  } catch { return null }
}

/** ⭐ CAN THIS CHART SHOW `sym` IN THIS TASK (the key handler's decision, handoffGroups.decideGroupShow)? The same
 *  rules the effect below applies, in the same order: the settle rule says apply, and the switch would commit at
 *  once (an economic series; or displayable and whole with its panes' columns landed). Pure.
 *  ⭐ (2026-11-23, review of #2624 2d) ONE ANSWER THAT NAMES THE RULE THAT SAID NO: null when the chart can show `sym`
 *  in this task; else 'no-symbol' | 'settle' | 'route:daily-hold' | 'route:prepare' | 'columns'. The member's canShowNow
 *  is this answer being null (the same checks in the same order as before); a tester's device diagnostics record it
 *  per switch (`gate`), so a measurement can say which member and which gate sent a group down the round. */
function decisionGateFor(sym, tf, sess, st, settle) {
  if (!sym || !tf) return 'no-symbol'
  if (st && st.debounceMs > 0 && settleAction({ now: settle.now, lastRequestAt: settle.lastRequestAt, lastAppliedAt: settle.lastAppliedAt, warm: !!st.isWarm?.(sym) }) !== 'apply') return 'settle'
  const route = sameTaskRoute(sym, tf, sess)
  if (route === 'econ') return null
  if (route !== 'now') return `route:${route}`
  return columnsReadyFor(sym, tf) ? null : 'columns'
}

/** ⭐ (2026-11-21, the cold switch) START THIS CHART'S DEVICE READ for `sym` now (the key press: handoffGroups
 *  primeGroup), on the key its switch will read (the intraday fetch key and session, or the D/W/M key). */
function primeDeviceFor(sym, tf, sess) {
  if (!DEVICE || !sym || !tf || !isNativeTf(tf) || /^ECON:/i.test(String(sym))) return undefined
  const intraday = INTRADAY.has(String(tf))
  try { return storePrefetch.deviceWarm(sym, intraday ? fetchTf(tf) : tf, intraday ? sess : {}) } catch { return undefined }
}

/** ⭐ (2026-11-21, the cold switch) Wake `cb` on each change of the entry (sym, tf) shows, instead of polling it
 *  every POLL_MS; null under the legacy source (no store to watch: the caller polls). */
// ⛔ DEVICE STORE ON ONLY (2026-11-21, to ship in the chart train): with the device store off, every waiter keeps
// today's POLL_MS poll, so this branch changes NOTHING for a member without it (cold gates 1, 3 and 4 are device-only
// by construction: the prime returns at !DEVICE; the worker and its minute replay only run with the store on).
const watchEntry = (sym, tf, opts, cb) => {
  if (!BARSTORE || !DEVICE) return null
  try { return storePrefetch.watch?.(sym, tf, opts, cb) || null } catch { return null }
}

const NO_SUBSCRIPTION = () => () => {}
const NO_DECISION = () => null

/**
 * Returns the symbol the chart should actually DISPLAY.
 *
 * Commits `requestedSym` the instant current-enough data for it exists; until
 * then it keeps returning the previous symbol so the visible chart stays whole.
 *
 * @param requestedSym the colour group's symbol — the one authority
 * @param tf           the timeframe the chart is showing
 * @param enabled      false → pass the request straight through (no lag at all)
 * @param showExtended the pane's extended-hours setting (the 60m key depends on it): a boolean,
 *                     or a ref read when a switch starts (a host that resolves its settings
 *                     after this hook runs); omitted → the view-global fallback
 * @param group        the linked group's key (handoffGroups.chartGroupKey), or null
 * @param scope        the board whose setGroupSym DECIDES (its groupSymsStore), or null: a chart with a scope is a
 *                     member of the key handler's decision; without one it takes the round alone (today's path)
 */
export default function useSymbolHandoff(requestedSym, tf, { enabled = true, showExtended, group = null, settle = null, scope = null } = {}) {
  // Seed with the request so a FIRST mount never lags — there is no previous
  // chart to protect, and lagging here would be a blank chart on page load.
  const [displayedSym, setDisplayedSym] = useState(requestedSym)
  // the settle rule's state (see the effect): read from a ref, so a new `settle` object never re-runs it
  const settleRef = useRef(settle)
  settleRef.current = settle
  // the settle rule's clock: the GROUP's (one per request, shared with the key handler's decision), or this
  // chart's own when it is not a member of a deciding board
  const localClockRef = useRef(null)
  if (!localClockRef.current) localClockRef.current = createSettleClock()
  const memberIdRef = useRef(0)
  if (!memberIdRef.current) memberIdRef.current = ++_memberIds
  const scoped = !!(scope && group && enabled)

  // ⭐⭐ ONE SYNCHRONOUS PASS FROM THE KEYDOWN (2026-11-21). The board's setGroupSym asks every member of the group
  // whether it can show the symbol in this task (canShowNow); when every one can, the decision is published in the
  // same batch as the symbol and each chart ADOPTS it here, in the render the symbol arrives in: React re-runs this
  // component at once (a render-phase update of its own state, nothing is committed between), so the group's
  // charts take the symbol in ONE synchronous render and ONE commit. No passive effect, no poll, no round, no
  // second render. A member whose own switch path painted it ('applied': the imperative switch) does not adopt.
  // ⛔ Only a decision made for THIS request (its symbol, a fresh one: handoffGroups.DECISION_TTL_MS) and one this
  // chart was asked for. ⛔⛔ ALL OR NOTHING: no condition here may differ between the group's charts, or one of
  // them takes the symbol and its sibling does not, which is the mixed frame this exists to prevent. A timeframe
  // that moved in the same event is therefore NOT a reason to refuse it (it was, and the rail caught a mixed frame):
  // that chart switches timeframe as it would on its own, with the chart's own loading state for the new one.
  const decision = useSyncExternalStore(scoped ? subscribeDecisions : NO_SUBSCRIPTION, scoped ? () => decisionFor(scope, group) : NO_DECISION)
  const memberId = memberIdRef.current
  if (decision && scoped && requestedSym && tf && requestedSym !== displayedSym && decision.sym === requestedSym
      && memberId in decision.tfs && !decision.applied[memberId]) {
    setDisplayedSym(requestedSym)
  }
  // the member's view, for canShowNow: written each commit, read by the key handler (never during a render)
  const viewRef = useRef({ tf, showExtended })
  // this chart's device read in the key press, LATEST-ONLY (handoffGroups.latestOnly): a held arrow never queues
  // a read per row it passes
  const primeRef = useRef(null)
  if (!primeRef.current) primeRef.current = latestOnly((sym) => primeDeviceFor(sym, viewRef.current.tf, sessOf(viewRef.current.showExtended)))
  // the decision's answer for this chart, by symbol (diagnostics: the record's `gate`)
  const gateRef = useRef(null)
  useLayoutEffect(() => { viewRef.current = { tf, showExtended } })
  useLayoutEffect(() => {
    if (!scoped) return undefined
    return registerMember(scope, group, memberIdRef.current, {
      tf: () => viewRef.current.tf,
      prime: (sym) => primeRef.current(sym),
      canShowNow: (sym, settleNow) => {
        const gate = decisionGateFor(sym, viewRef.current.tf, sessOf(viewRef.current.showExtended), settleRef.current, settleNow)
        gateRef.current = { sym, gate }
        return gate === null
      },
      showDecided: (sym) => {
        lastOutcomeRef.current = null   // the synchronous warm path, as the effect's same-tick commit records it
        noteDeviceFor(sym, viewRef.current.tf, sessOf(viewRef.current.showExtended), null, null, null)
      },
    })
  }, [scoped, scope, group])

  // ⭐⭐ ONE FRAME FOR THE GROUP, WHEN THE DECISION SAID NO: join the round for the requested symbol in the LAYOUT
  // phase (see GROUP_SYNC_MS), so every sibling of this commit is a member before any of them can be ready.
  useLayoutEffect(() => {
    if (!group || !enabled || !requestedSym || !tf || requestedSym === displayedSym) return undefined
    const id = memberIdRef.current
    groupJoin(group, requestedSym, id)
    return () => groupLeave(group, requestedSym, id)
  }, [group, enabled, requestedSym, tf, displayedSym])

  // ⛔ LATEST REQUEST WINS, AND A CANCELLED PREPARE MUST NEVER LATE-COMMIT.
  // Scanning A→B→C→D outruns any single prepare, so every async resolution is
  // checked against the generation that started it. Without this, B's slow IDB
  // read could land after D was requested and commit B over D — a wrong-symbol
  // frame, which is the exact class the whole handoff exists to prevent.
  const genRef = useRef(0)
  // How the last commit was reached, for the harness + tests to classify a
  // DEGRADED handoff separately from a successful one. Diagnostic only — no
  // rendering decision reads it.
  const lastOutcomeRef = useRef(null)
  // ⛔⛔ (2026-11-21, the held key) A REQUEST THAT IS LEFT NEVER SHOWS. Every answer below is checked against the
  // generation that started it, but a generation only ended when the NEXT request RAN, and inside a burst the next
  // request waits BURST_SETTLE_MS before it runs (or never runs: a newer key replaces it). So a superseded request
  // stayed current that long, and a late answer of it (its panes' columns landing) showed it, alone, over the newer
  // one. It ends HERE, in the commit that leaves it: a layout cleanup, so before any late answer can run.
  useLayoutEffect(() => () => { genRef.current += 1 }, [requestedSym, tf, enabled, group])

  useEffect(() => {
    // Disabled / nothing requested: pass straight through, same tick. The
    // synchronous setState is the bypass working correctly, not a cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!enabled || !requestedSym || !tf) { setDisplayedSym(requestedSym); return undefined }
    if (requestedSym === displayedSym) return undefined

    // ⭐ (2026-11-20, the trace) THE SETTLE IS DECIDED HERE, IN THE SAME PASS (it was useSymbolSettle, a layout
    // effect above this hook whose setState forced one more synchronous pass of every chart widget per switch).
    // A request after a quiet spell (> QUIET_MS) prepares now; one inside a burst prepares now only when its
    // rows are warm and the last applied one is BURST_SETTLE_MS old, otherwise after BURST_SETTLE_MS (a newer
    // request replaces it: this effect's cleanup). Exactly useSymbolSettle.settleAction's rule.
    // ⭐ (2026-11-21) Its state is the GROUP's clock when this chart is a member of a deciding board: one snapshot
    // per request, shared with the key handler's decision and every sibling, so they all classify it alike.
    const st = settleRef.current
    const clock = (scoped && settleClock(scope, group)) || localClockRef.current
    if (st && st.debounceMs > 0) {
      const now = Date.now()
      const snap = clock.request(requestedSym, now)
      const action = settleAction({ now, lastRequestAt: snap.lastRequestAt, lastAppliedAt: snap.lastAppliedAt, warm: !!st.isWarm?.(requestedSym) })
      if (action === 'defer') {
        let inner
        const t = setTimeout(() => { clock.applied(Date.now()); inner = run() }, BURST_SETTLE_MS)
        return () => { clearTimeout(t); if (typeof inner === 'function') inner() }
      }
      clock.applied(now)
    }
    return run()

    function run() {
      const gen = ++genRef.current
      const startedAt = Date.now()
      const sess = sessOf(showExtended)
      // the chart is ready: it is SHOWN with its group (groupReady), or alone when it has none
      let shown = false
      const show = () => { if (genRef.current === gen) { shown = true; stopHold(); setDisplayedSym(requestedSym) } }
      // ⛔⛔ THE CHART'S OWN REFUSAL, ASKED AT THE MOMENT OF SHOWING (review of #2558, P4-M1). Every route below decides on
      // what the store holds NOW and shows the chart LATER: after its panes' columns (COLUMNS_WAIT_MS), after the intraday
      // prepare's lake join, after its group's last member. A bucket that ends in between makes the chart refuse the device
      // copy this switch accepted (useBarSnapshotBars: short of its current bucket), and the chart has not shown that key
      // yet, so nothing exempts it: A -> blank -> B, with no bars request even left on the 'now' route. So the round asks
      // here (`holds`, prefetch.deviceHold: the chart's rule, its key, its clock) right before it shows this chart, and a
      // copy the chart would refuse is not shown: A stays, B's bars request leaves now (prefetch.askForDisplay), and the
      // switch waits on the entry for the answer or a newer device copy, then is ready again. Bounded by the intraday
      // prepare's hang guard (HANDOFF_HANG_MS from the switch): past it the chart shows its own loading state, as before.
      // In a linked group the round holds EVERY member while one holds (handoffGroups _flushRound): one frame, or none.
      // With the device store off `holds` is null and nothing here runs (deviceHoldFor answers null without a device copy).
      let forced = false
      let holdStop = null
      const holdCtl = DEVICE && typeof AbortController !== 'undefined' ? new AbortController() : null
      function stopHold() { const h = holdStop; holdStop = null; if (h) h() }
      const refusedNow = () => !forced && genRef.current === gen && !!deviceHoldFor(requestedSym, tf, sess)
      const hold = () => {
        if (holdStop) return
        try { storePrefetch.askForDisplay?.(requestedSym, tf, { ...sess, signal: holdCtl?.signal ?? null }) } catch { /* the chart asks */ }
        const wake = () => {
          if (!holdStop || genRef.current !== gen) return
          if (refusedNow() || !holdStop) return   // (the look may re-read the device and land the switch inside it)
          stopHold()
          commitNow()
        }
        const unwatch = watchEntry(requestedSym, fetchTf(tf), sess, wake)
        const poll = unwatch ? null : setInterval(wake, POLL_MS)
        const guard = setTimeout(() => {
          if (!holdStop || genRef.current !== gen) return
          stopHold()
          forced = true
          lastOutcomeRef.current = 'hang'
          commitNow()
        }, Math.max(0, startedAt + HANDOFF_HANG_MS - Date.now()))
        holdStop = () => { if (unwatch) unwatch(); if (poll) clearInterval(poll); clearTimeout(guard) }
      }
      const holds = DEVICE ? () => { if (!refusedNow()) return false; hold(); return true } : null
      const commitNow = () => { if (genRef.current === gen) groupReady(group, requestedSym, memberIdRef.current, show, String(tf), holds) }
      // what this switch leaves behind when it is left (a newer symbol, unmount) or done: no waiter, and a hold's request
      // aborted unless the chart was shown (then the chart owns that request)
      const leaveHold = () => { stopHold(); if (!shown) { try { holdCtl?.abort() } catch { /* ignore */ } } }
      // ⭐ ONE PAINT, PANES INCLUDED (2026-11-17): every path below commits through here, and B is
      // shown only once the server columns its panes draw have landed (serverCompute.columnsReadyFor),
      // waiting at most COLUMNS_WAIT_MS. Landed (or stored in this browser) commits in the same tick.
      // one device diagnostics record per switch, at its commit (noteDeviceFor)
      let noted = false
      // `pre`: the device rule's last answer while this switch waited with no server answer on the key
      // (deviceRuleBeforeAnswer); asked wherever the switch itself asks the rule, never on a timer of its own
      let pre = null
      const seePre = () => { const r = deviceRuleBeforeAnswer(requestedSym, tf, sess); if (r) pre = r }
      const noteDevice = () => {
        if (noted) return
        noted = true
        const g = gateRef.current
        noteDeviceFor(requestedSym, tf, sess, lastOutcomeRef.current, pre, scoped ? (g && g.sym === requestedSym ? g.gate : 'unasked') : undefined)
      }
      const commit = () => {
        if (genRef.current !== gen) return
        noteDevice()
        if (columnsReadyFor(requestedSym, tf)) { commitNow(); return }
        whenColumnsReady(requestedSym, tf, COLUMNS_WAIT_MS).then(commitNow, commitNow)
      }

      // ⛔ AN ECONOMIC SERIES (`ECON:USCPI`) IS NOT A BARS SYMBOL: nothing to prepare
      // or prefetch through the bars lane (it would 404) — the chart loads it from
      // /api/econ itself, so the request commits straight through.
      const route = sameTaskRoute(requestedSym, tf, sess)
      if (route === 'econ') { commitNow(); return leaveHold }

      // The panes' server columns leave NOW, beside the bars (the prepare below, or the daily one), so
      // the commit's bounded wait (COLUMNS_WAIT_MS) covers only what is left of them.
      warmColumnsFor(requestedSym, tf)

      // FAST PATH — synchronous, same tick, no scheduling latency added.
      // ⛔ THE SYNCHRONOUS setState IS THE POINT, NOT AN OVERSIGHT. A neighbour the
      // warmer already promoted to mem is displayable RIGHT NOW; deferring its
      // commit to a later tick would convert the measured ~19ms warm switch into a
      // scheduling round-trip, which is precisely the regression this coordinator
      // must not cause. One extra render on a switch the member asked for is the
      // cheap half of that trade.
      // The D/W/M hold (dailyHoldNeeded): promote or join the set first, bounded: past DAILY_HOLD_MAX_MS the
      // chart gets the symbol and shows its own loading state.
      if (route === 'daily-hold') {
        let live = true
        const land = (outcome) => {
          if (!live || genRef.current !== gen) return
          lastOutcomeRef.current = outcome
          commit()
        }
        // Aborted on any exit: a newer symbol, or past the bound, where the chart owns the fetch.
        const ctl = new AbortController()
        P.prepareDailyForDisplay(requestedSym, tf, { signal: ctl.signal }).then(land, () => land('error'))
        const bound = setTimeout(() => land('hold-timeout'), DAILY_HOLD_MAX_MS)
        // the device's copy lands in ~1 ms (one worker read): paint it the moment it does; and the tail ANSWER's
        // rows the moment they cover the view (COVER_ROWS), whatever the deep join is still doing. ⛔ An answer
        // of this key's life, never a saved copy alone: a copy from an earlier day is behind, and the chart
        // refuses to paint it (useBarSnapshotBars, dailyCachePaintVerdict), so committing on it would show a
        // loading chart instead of A.
        // ⭐ (2026-11-21) with the device store on: woken by prefetch.watch (the device copy landing, the tail's
        // answer being noted), never a poll; off, the POLL_MS poll as before (watchEntry)
        let devTimer = null
        let unwatch = null
        // ⛔ ONE STOP, SAFE TO CALL AGAIN: a look at the entry can wake the watcher INSIDE it (the device rule
        // re-reads the device), and that nested wake lands the switch and stops watching first
        const stopWatch = () => { const u = unwatch; unwatch = null; if (u) u() }
        const ready = () => {
          if (!live) return true
          seePre()
          if (devicePaints(requestedSym, tf)) { land('device'); return true }
          if (covers(requestedSym, tf, { answered: true })) { land('covered'); return true }
          return false
        }
        if (DEVICE || BARSTORE) {
          unwatch = watchEntry(requestedSym, tf, {}, () => { if (unwatch && ready()) stopWatch() })
          if (unwatch) { if (ready()) stopWatch() } else {
            const devPoll = () => { devTimer = null; if (!ready()) devTimer = setTimeout(devPoll, POLL_MS) }
            devTimer = setTimeout(devPoll, 0)
          }
        }
        return () => { live = false; clearTimeout(bound); if (devTimer) clearTimeout(devTimer); stopWatch(); ctl.abort(); leaveHold() }
      }

      // displayable and whole (paintsWholeNow), or a code this coordinator does not govern: commit now. The
      // prepare below otherwise waits for the lake's join (bounded, prefetch LAKE_JOIN_WAIT_MS) and the chart's
      // first frame holds it. The warms join it before Enter, so this is the rare case.
      if (route === 'now') { commit(); return leaveHold }

      let alive = true
      // PREPARE, AND COMMIT ON WHAT IT REPORTS — never on a stopwatch.
      //
      // ⛔⛔ THE PREVIOUS VERSION COMMITTED AFTER A FLAT 600ms REGARDLESS. That
      // handed StockChart a symbol with no data, fired the empty-bars teardown,
      // and put B's header over a black canvas — the original defect, postponed.
      // A timeout is not a result, so it can no longer stand in for one.
      //
      //   current / authoritative → a real chart exists → COMMIT (success)
      //   nodata / error          → COMMIT, but DEGRADED: the member clicked and
      //                             must not be silently pinned to the old chart;
      //                             the chart then shows its own honest state.
      //
      // ⭐ 'authoritative' is the halted / illiquid symbol: we asked with `since=`
      // and the server has nothing newer, so its cache IS the frontier. Without
      // this the handoff would wait forever for a bar that will never print.
      // The prepare is ABORTED when this request is LEFT before it committed (a newer symbol /
      // unmount): the store's prepare owns its key, so the abort really cancels its request (the
      // legacy prepare ignores it). Once committed the chart owns the key — never aborted then.
      const prepCtl = typeof AbortController !== 'undefined' ? new AbortController() : null
      let committed = false
      const commitHere = () => { committed = true; commit() }
      P.prefetchBarsToIDB([requestedSym], fetchTf(tf), { priority: true, immediate: true, ...sess })
      P.prepareForDisplay(requestedSym, fetchTf(tf), { signal: prepCtl?.signal ?? null, ...sess }).then((outcome) => {
        if (!alive || genRef.current !== gen) return   // a newer request owns the screen
        lastOutcomeRef.current = outcome
        commitHere()
      }).catch(() => { if (alive && genRef.current === gen) commitHere() })

      // A poll alongside it, because the ±6 neighbour warmer may repair this
      // symbol from the shared queue before our own prepare resolves — committing
      // the moment the cache is good is strictly better than waiting for our
      // request to come back.
      // ⭐ (2026-11-21) with the device store on it is woken by prefetch.watch (a repair, a device copy, the
      // answer), never a POLL_MS poll; off (and under the legacy source) it keeps the poll (watchEntry).
      let timer = null
      let unwatchI = null
      const stopWatchI = () => { const u = unwatchI; unwatchI = null; if (u) u() }   // (safe to call again: see stopWatch)
      const tick = () => {
        if (!alive || genRef.current !== gen) return
        seePre()
        if (paintsWholeNow(requestedSym, tf, sess)) { commitHere(); return }
        timer = setTimeout(tick, POLL_MS)
      }
      seePre()   // (the route was just decided on this entry: what the device rule said of it then)
      unwatchI = watchEntry(requestedSym, fetchTf(tf), sess, () => {
        if (!unwatchI || !alive || genRef.current !== gen || committed) return
        seePre()
        if (paintsWholeNow(requestedSym, tf, sess)) { stopWatchI(); commitHere() }
      })
      if (!unwatchI) timer = setTimeout(tick, POLL_MS)

      // ⚠️ THE BACKSTOP IS A HANG GUARD, NOT A RESULT. `prepareForDisplay` resolves
      // on success AND on failure, so the only way to reach this is a request that
      // never settles at all. Committing is still the least-bad answer — a member
      // staring at the previous symbol forever is worse than a chart that says it
      // is loading — but it is recorded as degraded, exactly like 'error'.
      const deadline = setTimeout(() => {
        if (!alive || genRef.current !== gen || forced) return
        lastOutcomeRef.current = 'hang'
        forced = true      // (a hold's own guard fires at the same bound: never a second hold after it)
        stopHold()
        commitHere()
      }, HANDOFF_HANG_MS)

      return () => { alive = false; if (timer) clearTimeout(timer); stopWatchI(); clearTimeout(deadline); if (!committed) { try { prepCtl?.abort() } catch { /* ignore */ } } leaveHold() }
      // ⚠️ `displayedSym` IS A DEPENDENCY, NOT A REF READ DURING RENDER. Reading a
      // ref while rendering is unsafe under concurrent rendering (and the lint rule
      // says so). Depending on it re-runs this effect exactly once after a commit,
      // where the first guard immediately returns — so the extra pass costs one
      // comparison and correctly tears down the finished prepare.
    }
  }, [requestedSym, tf, enabled, displayedSym, showExtended, group, scope, scoped])

  return displayedSym
}

/** @internal test/harness seam: how the most recent commit was reached
 *  ('current' | 'authoritative' | 'nodata' | 'error' | 'hang' | null for the
 *  synchronous warm path). A harness must not count a degraded commit as a
 *  successful handoff, so it has to be able to tell them apart. */
export function lastHandoffOutcome(ref) { return ref?.current ?? null }

// Fast enough that a repair landing between ticks is not perceptible, slow
// enough that a long prepare costs a handful of cache reads, not hundreds.
const POLL_MS = 25
// How long a daily symbol not yet in memory may hold the previous chart.
export const DAILY_HOLD_MAX_MS = 400
// ⚠️ A HANG GUARD, NOT A LATENCY BUDGET. `prepareForDisplay` settles on success
// and on failure, so this only fires when a request never settles at all.
// Deliberately generous: firing it early would race a slow-but-healthy prepare
// and reintroduce the blind commit it exists to prevent.
const HANDOFF_HANG_MS = 4000
