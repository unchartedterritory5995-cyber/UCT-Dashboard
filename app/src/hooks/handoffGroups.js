// app/src/hooks/handoffGroups.js
//
// ⭐⭐ ONE SWITCH PIPELINE FOR A LINKED GROUP (2026-11-21). Every chart of a colour group shows a new symbol in
// the SAME frame (owner, hard rule). This module owns WHEN a member shows it, through one of two triggers:
//
//   1. THE DECISION, in the key handler. The board's setGroupSym calls decideGroupShow() before it writes the
//      group symbol. When EVERY registered member can show the symbol in this task (its rows displayable and
//      whole, its panes' columns landed, the settle rule says now), the decision is published in the same
//      batch as the symbol, and the members take it in ONE synchronous render: one commit, one frame, by
//      construction. No passive effect, no poll, no group round, no second render.
//   2. THE ROUND, the fallback (a cold, deferred or mixed switch: today's path). Each member's handoff decides
//      when ITS chart is ready; a ready member waits for its siblings that asked for the same symbol, and the
//      last one ready shows them all in one task. Bounded by GROUP_SYNC_MS.
//
// A member shows through its own function in both: the React path sets its displayed symbol; the imperative
// switch's controller (docs/charts/imperative-switch-design.md) paints the chart itself and answers 'applied'.
//
// ⛔ ZERO IMPORTS: the board imports this to decide, so it must cost the board nothing but this file.
// ⛔ A DECISION NEVER GUESSES. One member that cannot show the symbol now (or that throws while answering)
// means no decision at all, and every member takes the round. A strict all-or-nothing test is what keeps the
// group in one frame: a partial decision would show the ready ones now and the rest a round later.

/** The group key of a colour, 'charts:A': the ONE place it is spelled (ChartWidget and the board both use it). */
export const chartGroupKey = (color) => (color ? `charts:${color}` : null)

// ── the members ─────────────────────────────────────────────────────────────────────────────────────────────
// scope (an object: the board's groupSymsStore) -> group -> Map<id, member>. A member with no scope is never
// registered and never decided (a host whose setGroupSym does not decide: the drill, the terminal).
const _members = new WeakMap()
const _groupsOf = (scope) => { let g = _members.get(scope); if (!g) { g = new Map(); _members.set(scope, g) } return g }

/**
 * Register a chart as a member of (scope, group), for the life of its handoff.
 *   member.canShowNow(sym, settle) -> a truthy token (yes: it can show `sym` whole in THIS task) or falsy (no).
 *     SYNCHRONOUS and side-effect free; a throw is a no. `settle` = { now, lastRequestAt, lastAppliedAt }, ONE
 *     snapshot of the group's settle clock for this request (see settleClock).
 *   member.showDecided(sym, decision, token) -> 'applied' when the member painted the symbol itself (the
 *     imperative switch); anything else, or a throw, and the member adopts the decision in its next render.
 *   member.tf() -> the timeframe it shows now (recorded in the decision; a member whose timeframe has moved by
 *     its render does not adopt the decision).
 */
export function registerMember(scope, group, id, member) {
  if (!scope || !group) return () => {}
  const groups = _groupsOf(scope)
  let m = groups.get(group)
  if (!m) { m = new Map(); groups.set(group, m) }
  m.set(id, member)
  return () => {
    const cur = _groupsOf(scope).get(group)
    if (cur && cur.get(id) === member) { cur.delete(id); if (!cur.size) _groupsOf(scope).delete(group) }
  }
}

// ── the settle clock: the settle rule's state per group, shared by the decision and the round ───────────────
/**
 * A clock of the settle rule (useSymbolSettle.settleAction). `request(sym, now)` notes a request and returns the
 * state BEFORE it ({ lastRequestAt, lastAppliedAt }); for the same symbol again (a sibling, or the round after
 * the decision said no) it returns that same snapshot, so every member of one request classifies it alike.
 * `applied(now)` notes that a request was acted on.
 */
export function createSettleClock() {
  let sym, snap = null, lastRequestAt = -Infinity, lastAppliedAt = -Infinity
  return {
    request(s, now) {
      if (snap && s === sym) return snap
      snap = { lastRequestAt, lastAppliedAt }
      lastRequestAt = now
      sym = s
      return snap
    },
    applied(now) { lastAppliedAt = now },
  }
}
const _clocks = new WeakMap()   // scope -> Map<group, clock>
/** The group's settle clock (a scope and a group), or null for a member that has none (it keeps its own). */
export function settleClock(scope, group) {
  if (!scope || !group) return null
  let m = _clocks.get(scope)
  if (!m) { m = new Map(); _clocks.set(scope, m) }
  let c = m.get(group)
  if (!c) { c = createSettleClock(); m.set(group, c) }
  return c
}

// ── the decision ───────────────────────────────────────────────────────────────────────────────────────────
/** ⛔ A DECISION IS FOR ITS OWN REQUEST. The members take it in the render the symbol arrives in (the same task);
 *  a decision still standing later could be adopted by a request that came back to that symbol through a writer
 *  that does not decide (a layout restore), on rows that may have left memory since. So it lapses after this
 *  long, SILENTLY: no member re-renders for a lapse (a chart that already took it has nothing to change). */
export const DECISION_TTL_MS = 1000
const _decisions = new WeakMap()   // scope -> Map<group, decision>
const _subs = new Set()
let _seq = 0
const _emit = () => { for (const fn of [..._subs]) fn() }
const _decisionsOf = (scope) => { let m = _decisions.get(scope); if (!m) { m = new Map(); _decisions.set(scope, m) } return m }

/**
 * THE TRIGGER. Called by the board's setGroupSym BEFORE it writes the group symbol (a real change only).
 * true: every registered member answered yes (all answers are taken before the first showDecided runs); each
 * member's showDecided ran in this task, and the decision { sym, seq, tfs: {id: tf}, applied: {id: true} } is
 * published. false: the group's decision is cleared and its members take the round.
 */
export function decideGroupShow(scope, group, sym, { now = Date.now() } = {}) {
  if (!scope || !group || !sym) return false
  const members = _groupsOf(scope).get(group)
  const decisions = _decisionsOf(scope)
  const prev = decisions.get(group) || null
  const clear = () => { if (prev) { decisions.delete(group); _emit() } return false }
  if (!members || !members.size) return clear()
  const clock = settleClock(scope, group)
  const snap = clock.request(sym, now)
  const settle = { now, lastRequestAt: snap.lastRequestAt, lastAppliedAt: snap.lastAppliedAt }
  const entries = [...members.entries()]
  const tokens = []
  for (const [, m] of entries) {
    let token = null
    try { token = m.canShowNow(sym, settle) } catch { token = null }
    if (!token) return clear()
    tokens.push(token)
  }
  clock.applied(now)
  const decision = { sym, seq: ++_seq, tfs: {}, applied: {} }
  entries.forEach(([id, m], i) => {
    try { decision.tfs[id] = String(m.tf()) } catch { decision.tfs[id] = null }
    let r
    try { r = m.showDecided(sym, decision, tokens[i]) } catch { r = undefined }
    if (r === 'applied') decision.applied[id] = true
  })
  decisions.set(group, decision)
  _emit()
  setTimeout(() => { if (decisions.get(group) === decision) decisions.delete(group) }, DECISION_TTL_MS)
  return true
}

/** The group's current decision (a useSyncExternalStore snapshot: the same object until the next publish). */
export function decisionFor(scope, group) {
  if (!scope || !group) return null
  const m = _decisions.get(scope)
  return (m && m.get(group)) || null
}
export function subscribeDecisions(fn) { _subs.add(fn); return () => { _subs.delete(fn) } }

// ── the round (the fallback; moved unchanged from useSymbolHandoff, 2026-11-20) ───────────────────────────────
/**
 * ⭐⭐ ONE FRAME FOR THE WHOLE GROUP, WHEN THE DECISION SAID NO. Each chart's handoff decides when ITS chart is
 * ready; a chart that is ready waits for its siblings that asked for the same symbol, and the last one to be
 * ready shows them all in one synchronous pass (one React render, one frame). Bounded: once GROUP_SYNC_MS has
 * passed since the first sibling was ready, the ready ones are shown and each straggler shows itself when it is
 * ready, so nothing hangs on a slow sibling.
 *  - A member is a chart of the group whose request moved to `sym` and is not showing it yet; it joins in a
 *    LAYOUT effect, so every sibling of one commit has joined before any of them can be ready.
 *  - A chart leaving the round (a newer symbol, unmounted) never holds the others.
 *  - No group (a host that passes none): the chart shows itself, as before.
 *  - `show` is called with { sym, tf }: the symbol and the timeframe the member had when it became ready.
 */
export const GROUP_SYNC_MS = 150
const _rounds = new Map()   // group -> { sym, members: Map<id, {ready, show, tf}>, timer, expired }
function _flushRound(group, round) {
  if (round.timer) { clearTimeout(round.timer); round.timer = null }
  const ready = [...round.members.entries()].filter(([, m]) => m.ready)
  for (const [id, m] of ready) { round.members.delete(id); try { m.show({ sym: round.sym, tf: m.tf }) } catch { /* one member never blocks the rest */ } }
  if (!round.members.size && _rounds.get(group) === round) _rounds.delete(group)
}
export function groupJoin(group, sym, id) {
  let round = _rounds.get(group)
  if (!round || round.sym !== sym) {
    if (round?.timer) clearTimeout(round.timer)
    round = { sym, members: new Map(), timer: null, expired: false }
    _rounds.set(group, round)
  }
  if (!round.members.has(id)) round.members.set(id, { ready: false, show: null, tf: null })
}
export function groupLeave(group, sym, id) {
  const round = _rounds.get(group)
  if (!round || round.sym !== sym || !round.members.delete(id)) return
  if (!round.members.size) { if (round.timer) clearTimeout(round.timer); _rounds.delete(group); return }
  // the siblings left may all be ready now
  if ([...round.members.values()].every((m) => m.ready)) _flushRound(group, round)
}
export function groupReady(group, sym, id, show, tf = null) {
  const round = group ? _rounds.get(group) : null
  const m = round && round.sym === sym ? round.members.get(id) : null
  if (!m) { show({ sym, tf }); return }                // no group, or not a member of this round: show now
  m.ready = true; m.show = show; m.tf = tf
  if (round.expired) { _flushRound(group, round); return }
  if ([...round.members.values()].every((x) => x.ready)) { _flushRound(group, round); return }
  if (!round.timer) {
    round.timer = setTimeout(() => {
      round.timer = null
      round.expired = true
      _flushRound(group, round)
    }, GROUP_SYNC_MS)
  }
}

/** @internal tests: forget every round and decision (members unregister through their own cleanup). */
export function __resetHandoffGroupsForTests() {
  for (const r of _rounds.values()) if (r.timer) clearTimeout(r.timer)
  _rounds.clear()
  _seq = 0
}
/** @internal tests: forget one board's decisions and settle clocks. */
export function __resetScopeForTests(scope) { _decisions.delete(scope); _clocks.delete(scope); _members.delete(scope) }
