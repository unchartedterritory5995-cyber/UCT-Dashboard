// app/src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js
//
// ─── THE COVERAGE-MAP DOOR CENSUS: every sample script through the MEMBER DOOR ──
//
// Run only by `tools/pine_coverage/run_census.py` (it restarts this file until the
// whole input list is answered, because one script can kill the process).
//
// ⭐ IT ASKS THE DOOR. Each script goes through `memberPaneDefinition` then
// `installUserDefinitions` — the two doors a member's paste goes through
// (`enterMemberDoor` in the vendor harness's `ourSide.js`) — with the flag state
// PRODUCTION runs: objects-only pane ARMED, runtime pane DARK. Nothing here
// decides what is supported; it records what the door answered.
//
// ⭐ IT PEELS THROUGH THE SAME DOOR. A refused script's refused LINES are
// neutralised (a binding keeps its name as `x = 0.0`, anything else is blanked —
// the rule `peelToBuilding.js` measured) and the door is asked again, up to CAP
// times, so a script's walls are its whole wall list and not just the first.
// ⚠️ Peeling edits the program: a later wall may be a consequence of an edit.
// The wall list is an estimate of ORDER, never a work ticket. A refusal with no
// line (a whole-program guard: strategy, library, import) cannot be peeled and
// is recorded as `stuck`.
//
// ⛔ A THROW IS A ROW, NEVER SWALLOWED, and `current.txt` names the script being
// translated so a process death is attributed to it by the driver.
//
// Env: COVERAGE_INPUT (json [{key, path, cap}]), COVERAGE_OUT (jsonl, appended).
//
// ⭐⭐ TWO LANES (Phase 3, WS-0; `tools/pine_coverage/runtime_lane.mjs`). Unset (or
// COVERAGE_RUNTIME_ON=0) is the PRODUCTION lane above, with its step-0 runtime
// counterfactual. COVERAGE_RUNTIME_ON=1 (`run_census.py --runtime-on`) measures the
// RUNTIME-ON lane: the runtime pane switched on at EVERY peel step, as a permitted
// member with every script graded (an upper bound: the server's allowlist is not
// applied). Each step then records the runtime lane's own decline
// (`runtimeDeclined`) and the probe's refusal (`rtProbe`: guard, line, token), and
// the peel neutralises the line the RUNTIME lane refused, so a wall list is the
// runtime lane's walls rather than the host's.
// ⛔ Every row names its lane (`lane`), and the run REFUSES to finish when the lane
// it measured is not the one it was asked for (`assertLaneMeasured`).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import * as registry from '../nativeRegistry'
import { assessObjectLoss } from './objectLoss'
import { TABLE, parseFormula } from './parse'
import { translatePine } from './pine'
import { functionReachability } from './doorCoverage'
import { probeRuntimeProgram } from '../runtime/runtimeColumns'
import { valueBuildDefersToDrawing } from '../../builder/memberPane/runtimeObjectsDoor'
import { runtimePaneEnabled, __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../runtimeKill'
import {
  CENSUS_RUNTIME_ENV, LANE_PRODUCTION, LANE_RUNTIME_ON, requestedLane, assertLaneMeasured, isGateDecline,
} from '../../../../../../tools/pine_coverage/runtime_lane.mjs'
import { peelStatement } from '../../../../../../tools/pine_coverage/census_peel.mjs'
import { loadCapture } from '../__tests__/vendorHarness/harness.js'
import { toProductBars } from '../__tests__/vendorHarness/ourSide.js'
import { hostObjectRun, hostObjectReaderOpts } from '../runHalfObjectRail.js'
import { OTHER_SYMBOL_REFUSAL, staticallyUnservable } from '../otherSymbols'
import { foldNotesForOutput } from './parse'

const INPUT = process.env.COVERAGE_INPUT
const OUT = process.env.COVERAGE_OUT
const RUN = !!(INPUT && OUT)
// ⛔ read strictly: a typo throws at collection rather than measuring the other lane
const LANE = requestedLane(process.env[CENSUS_RUNTIME_ENV], CENSUS_RUNTIME_ENV) || LANE_PRODUCTION
const RT_ON = LANE === LANE_RUNTIME_ON
const DEF_ID = 'u_member-pane-coverage'
const LF = String.fromCharCode(10)

afterEach(() => { vi.unstubAllEnvs() })

const GATE = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
/** The flag NAMES are read off their gate modules, never typed. */
const flagOf = (src) => (src.match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const OBJECTS_ONLY_FLAG = RUN ? flagOf(GATE('src/components/chart/engine/objectsOnlyPaneGate.js')) : null
const RUNTIME_FLAG = RUN ? flagOf(GATE('src/components/chart/engine/runtimePaneGate.js')) : null

function bindingNameOf(line) {
  const hash = line.indexOf('//')
  const bare = hash >= 0 ? line.slice(0, hash) : line
  const m = bare.match(
    /^(\s*)(?:(?:var|varip)\s+)?(?:(?:float|int|bool|string|color|line|label|box|table)\s+)?([A-Za-z_]\w*)\s*:?=(?!=)/)
  return m ? { indent: m[1], name: m[2] } : null
}

const short = (s, n = 220) => (s == null ? null : String(s).slice(0, n))

/** The runtime lane's own refusal behind a decline: the probe the door ran
 *  (`memberPaneDefinition::runtimeLaneDefinition`), asked again for its POSITION,
 *  which the door's `runtimeDeclined` ({code, why}) does not carry. `agrees` says
 *  whether the probe's guard is the code the door declined with.
 *
 *  ⭐ THE DOOR'S SECOND BUILD (W4 T0). A value build that refuses at `runtime:object-op`
 *  (a drawing the host object program did not take) is explained by the DRAWING build,
 *  `probeRuntimeProgram(source, {objectsInRun: true})`, and the door declines with THAT
 *  build's guard (`runtimeObjectsDoor.js::runtimeOwnObjectsOf`). Asking only the value
 *  build named `runtime:object-op` for 79 steps of the 2026-11-02 map where the door's
 *  own decline was something else (2 of 79 agreed); the line it names is then the
 *  value build's, not the wall's. Same rule, same constant: one authority. */
function runtimeProbeOf(source, declined) {
  try {
    let p = probeRuntimeProgram(source)
    if (!p.ok && valueBuildDefersToDrawing((p.refusal || {}).guard)) {
      p = probeRuntimeProgram(source, { objectsInRun: true })
    }
    if (p.ok) return null
    const r = p.refusal || {}
    return {
      guard: r.guard || null,
      line: Number.isInteger(r.line) ? r.line : null,
      token: r.token != null ? short(r.token, 80) : null,
      message: short(r.message, 240),
      agrees: !!declined && (r.guard || null) === declined.code,
    }
  } catch (err) {
    return { guard: 'probe:threw', line: null, token: null, message: short((err && err.message) || err), agrees: false }
  }
}

/** Did the door's answer come from the runtime lane (drawn by it, or declined by it)?
 *  ⛔ A decline by the allowlist / kill list is the GATE answering, never the lane. */
const gatedRuntime = (r) => !!r && !!r.runtimeDeclined && isGateDecline(r.runtimeDeclined.code)
const reachedRuntime = (r) => !!r && (r.lane === 'runtime' || (!!r.runtimeDeclined && !gatedRuntime(r)))

/** ⭐ W3W4-T0 — THE GUARD BEHIND EACH DROPPED OBJECT OP, IDENTIFIERS ONLY. `dropReasons` counts
 *  ops by KIND (`guard:create`, `create:line`, `cell:text`); the translation also holds the
 *  sentence behind them (`guardRefusals`, `createDropWhy`, `cellTextWhy`). Each is cut to
 *  `<op>@<line>: <guard>[ <subject>]` (the message text, which can quote a script, is dropped),
 *  so the census row can say WHICH host guard dropped an op without carrying prose.
 *  `op` is `create:<family>` for a create, `cell:text` for a cell text, the op kind otherwise. */
export function dropHeads(diag) {
  const d = diag || {}
  const out = []
  for (const e of d.guardRefusals || []) out.push(short(String(e), 120))
  for (const e of d.createDropWhy || []) {
    const m = /^create (\w+)@([\d?]+) [^:]*: (\S+)/.exec(String(e))
    if (m) out.push(`create:${m[1]}@${m[2]}: ${m[3] === 'no' ? 'unrecorded' : m[3]}`)
  }
  for (const e of d.cellTextWhy || []) {
    const m = /^cell@([\d?]+): (\S+)/.exec(String(e))
    if (m) out.push(`cell:text@${m[1]}: ${m[2] === 'no' ? 'unrecorded' : m[2]}`)
  }
  return [...new Set(out)].slice(0, 60)
}

function oneDoor(source, { runtimeDetail = RT_ON, bound = false } = {}) {
  let d
  try {
    d = memberPaneDefinition({ source, id: DEF_ID, name: 'coverage' })
  } catch (err) {
    return { threw: short((err && err.message) || err) }
  }
  // ⭐ ENGINE 55 — step 0 only (`census`): the bound check's blockers, before install.
  let boundWhy = null
  if (bound && d.ok) {
    try { boundWhy = boundBlockers(d) } catch (err) { boundWhy = [`bound-threw:${short((err && err.message) || err, 80)}`] }
  }
  const t = d.translation || {}
  const refusals = (t.refusals || []).map((r) => ({
    guard: r.guard || null,
    // the refusal VALUE shape (`pine.js::refusalValue`): flat line/token, no `at`
    line: Number.isInteger(r.line) ? r.line : ((r.at && Number.isInteger(r.at.line)) ? r.at.line : null),
    token: r.token != null ? short(r.token, 80) : (r.at && r.at.token != null ? short(r.at.token, 80) : null),
    message: short(r.message, 240),
  }))
  let loss = null
  try { loss = assessObjectLoss(t) } catch { loss = null }
  const diag = t.objectDiagnostics || {}
  let installed = null
  let installError = null
  if (d.ok) {
    try {
      const r = registry.installUserDefinitions([d.definition])
      installed = r.installed.length > 0
      if (!installed) installError = short((r.errors || []).join(' | '))
    } catch (err) {
      installed = false
      installError = short((err && err.message) || err)
    } finally {
      try { registry.uninstallUserDefinition(DEF_ID) } catch { /* nothing installed */ }
    }
  }
  return {
    attached: !!d.ok,
    installed,
    installError,
    guard: d.guard || null,
    reason: d.ok ? null : short(d.reason),
    plots: (d.rows || []).length,
    drawsObjects: !!(d.definition && d.definition.objects),
    // an object program the translation built that the pane did NOT carry
    withheldObjects: !!(d.ok && t.objects && (t.objects.ops || []).length && !(d.definition && d.definition.objects)),
    withheldPaints: (((t.presentation || {}).paints) || []).filter((p) => p && p.withheld).length,
    lane: d.lane || (d.ok ? 'host' : null),
    lossVerdict: loss ? loss.verdict : null,
    droppedOps: diag.droppedOps || 0,
    attemptedOps: diag.attemptedOps || 0,
    dropReasons: diag.dropReasons || {},
    dropHeads: dropHeads(diag),
    unsupported: diag.unsupported || [],
    outOfScope: diag.outOfScope || [],
    loopBlockedCalls: diag.loopBlockedCalls || [],
    notes: (d.notes || []).map((n) => (n && n.name) || null).filter(Boolean),
    refusals,
    ...(boundWhy ? { boundWhy } : {}),
    ...(runtimeDetail ? {
      runtimeDeclined: d.runtimeDeclined ? { code: d.runtimeDeclined.code, why: short(d.runtimeDeclined.why, 300) } : null,
      rtProbe: d.runtimeDeclined ? runtimeProbeOf(source, d.runtimeDeclined) : null,
    } : {}),
  }
}

// ─── ⭐⭐ ENGINE 55 — THE BOUND CHECK: "FULLY DRAWN" ASKED OF A BIND, NOT ONLY OF A DOOR ──
// ⚰️ `isClean` (below) judges the DOOR's answer: attached, zero refusals, nothing dropped. It
// never binds. Three silent shapes passed it: a plot that reads another symbol no bind can serve
// (McClellan's bare `ADVN`, an all-`na` line), a table whose cells read a value the bind could
// not compute (K-clustering, `withheldUnknown`), and a semantic-difference fold. `cleanBound`
// asks ONE bind of the attached definition on a reference series — the RDDT 1D capture bars —
// and requires: no column error, no object op withheld as unknown (and nothing named
// not-computable), no other-symbol refusal the spelling alone decides, and no fold note.
// ⭐ BOTH NUMBERS ARE KEPT: `clean` (static, comparable with every earlier map) and
// `cleanBound`. ⛔ A refusal that depends on OUR STORE (a listing not held, no bars in hand) is
// not counted: the census supplies no secondary bars, and a member's chart does.
const BOUND_REFERENCE = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness/k-clustering-rddt-1d-2026-09-28.json')
const BOUND_CTX = Object.freeze({
  tf: 'D', symbol: Object.freeze({ ticker: 'RDDT', exchange: 'NYSE' }), newestBarIsForming: false, historyFromListing: true,
})
/** The other-symbol refusal codes a SPELLING decides (no store, no bars, no chart state). */
const SPELLING_DECIDED = new Set([OTHER_SYMBOL_REFUSAL.UNSPELLED, OTHER_SYMBOL_REFUSAL.VENUE_UNREADABLE,
  OTHER_SYMBOL_REFUSAL.VENUE_UNCONFIRMED])
const STORE_DEPENDENT = new Set([OTHER_SYMBOL_REFUSAL.NOT_HELD, OTHER_SYMBOL_REFUSAL.NO_BARS,
  OTHER_SYMBOL_REFUSAL.EXCHANGE_UNCONFIRMED, OTHER_SYMBOL_REFUSAL.VENUE_MISMATCH, OTHER_SYMBOL_REFUSAL.BARE,
  OTHER_SYMBOL_REFUSAL.CHART_PREFIX, OTHER_SYMBOL_REFUSAL.FRAMED])
let boundBars = null
function referenceBars() {
  if (!boundBars) boundBars = toProductBars(loadCapture(BOUND_REFERENCE).capture)
  return boundBars
}

/** ⭐⭐ ENGINE 55 (coordinator, s6-bugs-1114) — THE DARK-PLOT TEST. The reference bars start at
 *  the listing (`history.startsAtBar0`), so the same definition is also bound OFF the listing
 *  (`historyFromListing: false`, the replay a chart that does not reach the listing computes). A plot
 *  is DARK — the script is not fully drawn — when, on the listing, it draws no bar at all, or draws
 *  fewer of the bars the off-listing replay draws. ⚰️ The builtin Supertrend drew 0 bars from the
 *  listing against 255 off it (a NaN seed latched in its ratchet) and the census counted it clean.
 *  The engine bug is NOT fixed here (a later engine); the census is only made honest about it. */
function darkPlots(def, bars, ctx, listingCols) {
  if (!ctx || ctx.historyFromListing !== true) return []
  let off = null
  try {
    off = registry.computeFor(def, bars, undefined, { ...ctx, historyFromListing: false })
  } catch { off = null }
  if (!off || typeof off.then === 'function') return []
  const errs = registry.columnErrors(listingCols) || {}
  const out = []
  for (const p of (def.plots || [])) {
    if (!p || p.style === 'hlines' || typeof p.key !== 'string') continue
    if (Object.prototype.hasOwnProperty.call(errs, p.key)) continue   // already a column error
    const on = listingCols[p.key]
    const of = off[p.key]
    if (!on || typeof on.length !== 'number') continue
    let onDrawn = 0
    let offDrawn = 0
    let onWhereOff = 0
    for (let i = 0; i < on.length; i++) {
      const a = Number.isFinite(on[i])
      const b = of && Number.isFinite(of[i])
      if (a) onDrawn += 1
      if (b) { offDrawn += 1; if (a) onWhereOff += 1 }
    }
    if (onDrawn === 0) out.push(`dark-plot:${p.key}:listing 0 / off-listing ${offDrawn}`)
    else if (onWhereOff < offDrawn) out.push(`dark-plot:${p.key}:listing ${onWhereOff} of the off-listing ${offDrawn}`)
  }
  return out
}

/** Why ONE bind of an attached member-door definition is not fully drawn: `[]` = it is.
 *  Exported for the rail below (`cleanBound` can fail). */
export function boundBlockers(d, bars = referenceBars(), ctx = BOUND_CTX) {
  const out = []
  if (!d || !d.ok || !d.definition) return ['not-attached']
  const def = d.definition
  const t = d.translation || {}
  for (const o of t.outputs || []) {
    // ⚠️ `baseTimeframeFolds` (a daily request read as the chart's own daily bars) is the
    // identity on a DAILY bind — measured (C49) and withheld by name on any other chart —
    // so on this daily reference it differs from nothing; every other fold note counts.
    for (const n of foldNotesForOutput(o)) {
      if (n.name === 'baseTimeframeFolds' && ctx.tf === 'D') continue
      out.push(`fold:${n.name}`)
    }
  }
  for (const r of (def.meta && def.meta.otherSymbols) || []) {
    for (const v of r.spellings || []) {
      const s = staticallyUnservable(r.ticker, v)
      if (s) out.push(`other-symbol:${s.code}:${r.ticker}`)
    }
  }
  let cols = null
  try {
    cols = registry.computeFor(def, bars, undefined, ctx)
  } catch (err) {
    out.push(`compute-threw:${short((err && err.message) || err, 80)}`)
  }
  if (cols && typeof cols.then !== 'function') {
    for (const [key, e] of Object.entries(registry.columnErrors(cols) || {})) {
      const guard = (e && (e.guard || e.status)) || 'error'
      if (STORE_DEPENDENT.has(guard)) continue
      out.push(`column-error:${key}:${guard}`)
    }
    const other = registry.otherSymbolReport(cols)
    for (const r of (other && other.refused) || []) {
      if (SPELLING_DECIDED.has(r.code)) out.push(`other-symbol:${r.code}:${r.ticker}`)
    }
    for (const w of darkPlots(def, bars, ctx, cols)) out.push(w)
  } else if (cols) {
    out.push('compute-async')
  }
  if (def.objects) {
    try {
      const host = hostObjectRun(def, bars, hostObjectReaderOpts(ctx, undefined))
      const run = host && host.run
      if (run) {
        if (run.stats && run.stats.withheldUnknown) out.push(`objects:withheld-unknown:${run.stats.withheldUnknown}`)
        if (run.withheldBy && run.withheldBy['objects:not-computable']) out.push('objects:not-computable')
      }
    } catch (err) {
      out.push(`objects-threw:${short((err && err.message) || err, 80)}`)
    }
  }
  return [...new Set(out)]
}

/** ⭐ "TRANSFERS FULLY" — the coverage map's headline predicate, in one place.
 *  Attached by the member door AND installed AND zero refusals AND the object
 *  program carried with nothing dropped or withheld AND no paint withheld. */
function isClean(r) {
  return !!r && !!r.attached && r.installed !== false
    && (r.refusals || []).length === 0
    && (r.lossVerdict === 'clean' || r.lossVerdict == null)
    && !r.withheldObjects && !(r.withheldPaints > 0)
}

function census(source, cap, { rtOn = RT_ON } = {}) {
  const work = source.split(/\r?\n/)
  const steps = []
  let stuck = null
  for (let step = 0; step < cap; step += 1) {
    const r = oneDoor(work.join(LF), { runtimeDetail: rtOn, bound: step === 0 })
    // the line text each refusal names, read off the CURRENT program
    for (const ref of r.refusals || []) {
      ref.text = ref.line && work[ref.line - 1] != null ? short(work[ref.line - 1].trim(), 200) : null
    }
    if (r.rtProbe && r.rtProbe.line) {
      r.rtProbe.text = work[r.rtProbe.line - 1] != null ? short(work[r.rtProbe.line - 1].trim(), 200) : null
    }
    steps.push(r)
    if (r.threw) { stuck = 'threw'; break }
    if (r.attached) break
    // ⭐ RUNTIME-ON: peel the line the RUNTIME lane refused; a decline with no line
    // (a budget, a request, an output-map disagreement) cannot be peeled.
    if (rtOn && r.runtimeDeclined && !(r.rtProbe && r.rtProbe.line)) { stuck = r.runtimeDeclined.code; break }
    const lines = rtOn && r.rtProbe && r.rtProbe.line && r.rtProbe.line <= work.length ? [r.rtProbe.line]
      : [...new Set((r.refusals || []).map((x) => x.line).filter((n) => n && n <= work.length))]
    if (!lines.length) { stuck = (r.refusals[0] && r.refusals[0].guard) || r.guard || 'no-line'; break }
    // ⭐ THE UNIT IS THE LOGICAL STATEMENT (W4 T0, `census_peel.mjs`): the refused line,
    // its continuation lines and, under a header, its body. Overwriting ONE physical
    // line left the rest of a multi-line call behind for the door to refuse as
    // `pine:statement`; that wall was counted 76 times and is real on 6 scripts.
    let changed = false
    const snapshot = work.join(LF)   // every span is read off the program the door REFUSED
    for (const n of lines) {
      if (peelStatement(work, n, bindingNameOf, snapshot)) changed = true
    }
    if (!changed) { stuck = 'no-progress'; break }
  }
  const first = steps[0] || {}
  const last = steps[steps.length - 1] || {}
  return {
    attached: !!first.attached && first.installed !== false,
    clean: isClean(first),
    // ⭐ ENGINE 55 — the BOUND predicate (`boundBlockers`), beside the static one.
    cleanBound: isClean(first) && Array.isArray(first.boundWhy) && first.boundWhy.length === 0,
    reachedAfterPeel: !!last.attached,
    peelSteps: steps.length - 1,
    stuck,
    steps,
  }
}

describe.skipIf(!RUN)('coverage-map door census (driven by run_census.py)', () => {
  it('answers every input script through the member door', () => {
    expect(OBJECTS_ONLY_FLAG, 'objects-only flag name unreadable').toMatch(/^VITE_/)
    expect(RUNTIME_FLAG, 'runtime flag name unreadable').toMatch(/^VITE_/)
    const items = JSON.parse(fs.readFileSync(INPUT, 'utf8'))
    const done = new Set()
    if (fs.existsSync(OUT)) {
      for (const l of fs.readFileSync(OUT, 'utf8').split(/\n/)) {
        if (!l.trim()) continue
        try { done.add(JSON.parse(l).key) } catch { /* torn tail line */ }
      }
    }
    const cur = path.join(path.dirname(OUT), 'current.txt')
    let n = 0
    // ⭐ what the door actually did, over every step of every new row
    const ev = { gateOpen: false, gateClosed: false, reachedRuntime: 0, hostRefused: 0, gated: 0 }
    for (const it of items) {
      if (done.has(it.key)) continue
      vi.stubEnv(OBJECTS_ONLY_FLAG, '1')   // production: ARMED
      vi.stubEnv(RUNTIME_FLAG, RT_ON ? '1' : '')   // production: DARK; runtime-on: ON
      if (RT_ON) {
        // ⛔ explicit, not inherited from test-setup's beforeEach: this lane must
        // not depend on a hook another file could change
        __permitRuntimePaneForTests()
        __allowEveryRuntimeScriptForTests()
      }
      const open = runtimePaneEnabled()
      if (open) ev.gateOpen = true
      else ev.gateClosed = true
      // ⛔ PER SCRIPT, BEFORE ITS ROW IS WRITTEN: the gate must be the lane's
      assertLaneMeasured({ requested: LANE, gateOpen: open, reachedRuntime: open ? 1 : 0, hostRefused: 0,
        what: `coverage census (${it.key})` })
      // ⛔ named AFTER the gate check: a wrong lane is the run's fault, never a
      // script's, so the driver must not record it as the script that killed it
      fs.writeFileSync(cur, it.key)
      const source = fs.readFileSync(it.path, 'utf8')
      const t0 = Date.now()
      let row
      try {
        row = census(source, it.cap || 8)
      } catch (err) {
        row = { attached: false, clean: false, stuck: 'threw', steps: [{ threw: short((err && err.message) || err) }] }
      }
      vi.unstubAllEnvs()
      for (const st of row.steps || []) {
        if (reachedRuntime(st)) ev.reachedRuntime += 1
        if (gatedRuntime(st)) ev.gated += 1
        if (!st.threw && !st.attached) ev.hostRefused += 1
      }
      // ⭐ THE COUNTERFACTUAL, NOT PRODUCTION: the same door with the DARK runtime
      // pane switched on, step 0 only. It measures what arming that flag would
      // add; it is never counted in the headline.
      vi.stubEnv(OBJECTS_ONLY_FLAG, '1')
      vi.stubEnv(RUNTIME_FLAG, '1')
      try {
        const rt = oneDoor(source)
        row.runtime = { attached: !!rt.attached && rt.installed !== false, clean: isClean(rt), lane: rt.lane || null,
          guard: rt.guard || null, threw: rt.threw || null, refusalGuards: [...new Set((rt.refusals || []).map((x) => x.guard))] }
      } catch (err) {
        row.runtime = { attached: false, clean: false, threw: short((err && err.message) || err) }
      }
      vi.unstubAllEnvs()
      fs.appendFileSync(OUT, `${JSON.stringify({ key: it.key, lane: LANE, ms: Date.now() - t0, ...row })}\n`)
      n += 1
    }
    fs.writeFileSync(cur, '')
    console.log(`coverage census: ${n} new rows -> ${OUT}`)
    if (n > 0) {
      // ⛔ THE AGGREGATE: a runtime-on run in which no step reached the runtime lane.
      // Recorded beside the rows (`lane.jsonl`, one line per pass) because the rows
      // are already written: `run_census.py` refuses the census when any pass failed.
      let line
      let error = null
      try {
        line = assertLaneMeasured({ requested: LANE, gateOpen: ev.gateOpen && !ev.gateClosed,
          reachedRuntime: ev.reachedRuntime, hostRefused: ev.hostRefused, gated: ev.gated, what: 'coverage census' })
      } catch (err) {
        error = err
        line = String(err.message)
      }
      fs.appendFileSync(path.join(path.dirname(OUT), 'lane.jsonl'),
        `${JSON.stringify({ requested: LANE, ok: !error, line, rows: n, ...ev })}
`)
      console.log(line)
      if (error) throw error
    }
    expect(items.length).toBeGreaterThan(0)
  }, 6 * 3600 * 1000)
})

// ─── ⛔ SELF-CHECK: THE LANE RAIL CAN FAIL ────────────────────────────────────
// Runs in the ordinary suite (cheap: one script, a few door calls). It proves the
// two ways a "runtime-on" census can lie are each CAUGHT: the pane left dark by a
// missing per-member permission (exactly how the vendor harness measured the dark
// pane through env vars), and the build flag left off. And that the honest lane
// passes, so the rail is not a rail that always throws.
const SELF_CHECK_SOURCE = [
  '//@version=5',
  "indicator('lane self-check')",
  'var float acc = 0.0',
  'if close > open',
  '    acc := acc + 1',
  'plot(acc)',
].join(LF)

function laneEvidence(source) {
  const r = oneDoor(source, { runtimeDetail: true })
  return {
    gateOpen: runtimePaneEnabled(),
    reachedRuntime: reachedRuntime(r) ? 1 : 0,
    gated: gatedRuntime(r) ? 1 : 0,
    hostRefused: r.attached && r.lane !== 'runtime' ? 0 : 1,
    r,
  }
}

describe('⛔ runtime-on lane rail: it can fail', () => {
  const objectsFlag = () => flagOf(GATE('src/components/chart/engine/objectsOnlyPaneGate.js'))
  const runtimeFlag = () => flagOf(GATE('src/components/chart/engine/runtimePaneGate.js'))

  it('the self-check script reaches the runtime lane when the pane is really on', () => {
    vi.stubEnv(objectsFlag(), '1')
    vi.stubEnv(runtimeFlag(), '1')
    const { r, ...ev } = laneEvidence(SELF_CHECK_SOURCE)
    expect(ev.gateOpen).toBe(true)
    expect(ev.reachedRuntime, JSON.stringify(r).slice(0, 400)).toBe(1)
    expect(assertLaneMeasured({ requested: LANE_RUNTIME_ON, ...ev, what: 'self-check' })).toMatch(/^LANE MEASURED: runtime-on/)
    // and the production lane, asked of the same evidence, refuses it
    expect(() => assertLaneMeasured({ requested: LANE_PRODUCTION, ...ev, what: 'self-check' }))
      .toThrow(/PRODUCTION LANE WAS REQUESTED/)
  })

  it('RED: flag on but no per-member permission (the collection-time trap) -> runtime-on refused', () => {
    vi.stubEnv(objectsFlag(), '1')
    vi.stubEnv(runtimeFlag(), '1')
    __resetRuntimePanePermission()
    const { r, ...ev } = laneEvidence(SELF_CHECK_SOURCE)
    expect(ev.gateOpen).toBe(false)
    expect(ev.reachedRuntime, JSON.stringify(r).slice(0, 400)).toBe(0)
    expect(() => assertLaneMeasured({ requested: LANE_RUNTIME_ON, ...ev, what: 'self-check' })).toThrow(/RUNTIME PANE IS DARK/)
  })

  it('RED: pane on, permitted, but the starter allowlist not overridden -> runtime-on refused', () => {
    vi.stubEnv(objectsFlag(), '1')
    vi.stubEnv(runtimeFlag(), '1')
    __resetRuntimeAllowList()
    const { r, ...ev } = laneEvidence(SELF_CHECK_SOURCE)
    expect(ev.gateOpen).toBe(true)
    expect(ev.gated, JSON.stringify(r).slice(0, 400)).toBe(1)
    expect(ev.reachedRuntime).toBe(0)
    expect(() => assertLaneMeasured({ requested: LANE_RUNTIME_ON, ...ev, what: 'self-check' })).toThrow(/ALLOWLIST OR KILL LIST/)
  })

  it('RED: gate reported open but the lane never answered -> runtime-on refused', () => {
    expect(() => assertLaneMeasured({ requested: LANE_RUNTIME_ON, gateOpen: true, reachedRuntime: 0, hostRefused: 3, what: 'self-check' }))
      .toThrow(/NEVER EXERCISED/)
  })

  it('RED: flag off (production) -> runtime-on refused, production accepted', () => {
    vi.stubEnv(objectsFlag(), '1')
    vi.stubEnv(runtimeFlag(), '')
    const { r, ...ev } = laneEvidence(SELF_CHECK_SOURCE)
    expect(ev.reachedRuntime, JSON.stringify(r).slice(0, 400)).toBe(0)
    expect(() => assertLaneMeasured({ requested: LANE_RUNTIME_ON, ...ev, what: 'self-check' })).toThrow(/RUNTIME PANE IS DARK/)
    expect(assertLaneMeasured({ requested: LANE_PRODUCTION, ...ev, what: 'self-check' })).toMatch(/^LANE MEASURED: production/)
  })

  it('a mode variable is read strictly', () => {
    expect(requestedLane(undefined)).toBe(null)
    expect(requestedLane('')).toBe(null)
    expect(requestedLane('1')).toBe(LANE_RUNTIME_ON)
    expect(requestedLane('0')).toBe(LANE_PRODUCTION)
    expect(() => requestedLane('true', CENSUS_RUNTIME_ENV)).toThrow(/COVERAGE_RUNTIME_ON/)
  })
})

// ─── ⛔ W4 T0 — THE INSTRUMENT'S TWO ARTEFACTS, EACH WITH A FIXTURE THAT SHOWS IT ─────
// W4-BREAKDOWN section 0: the top runtime-lane wall (`pine:statement`, 76 touches) was
// real on 6 scripts, and `runtime:object-op` (35) was the wrong probe's answer. Each
// fixture is a SYNTHETIC script (never a licence-held one) whose census row, with the
// old behaviour, carried the artefact. Ordinary suite, a few door calls each.
const FIXTURE_HEAD = ['//@version=5', "indicator('t0 fixture', overlay=true)"]

function underLane(rtOn, fn) {
  vi.stubEnv(flagOf(GATE('src/components/chart/engine/objectsOnlyPaneGate.js')), '1')
  vi.stubEnv(flagOf(GATE('src/components/chart/engine/runtimePaneGate.js')), rtOn ? '1' : '')
  if (rtOn) {
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
  }
  return fn()
}

/** What a step names as its wall, the way `coverage_map.py::runtime_walls_of` reads it
 *  (runtime-on: the decline's code when the probe disagrees with it). */
function wallOfStep(st, rtOn) {
  if (st.attached) return null
  if (!rtOn) return (st.refusals[0] && st.refusals[0].guard) || st.guard
  const pr = st.rtProbe || {}
  const rd = st.runtimeDeclined || {}
  return (pr.agrees ? pr.guard : rd.code || pr.guard) || (st.refusals[0] && st.refusals[0].guard) || st.guard
}

describe('W4 T0: the census peel removes a LOGICAL statement, not one physical line', () => {
  // A call wrapped over lines: the refusal names the call's first line, the old peel
  // blanked that line only, and the continuation (`     close)`) was refused next as
  // `pine:statement` -- a wall the member never wrote.
  const MULTI_LINE_CALL = [...FIXTURE_HEAD,
    'arr = array.new_float(0)',
    'array.push(arr,',
    '     close)',
    'v = array.get(arr,',
    '     0)',
    'plot(close + v)',
  ].join(LF)

  it('a multi-line call: the old wall (pine:statement) is gone and the next REAL wall appears', () => {
    const row = underLane(false, () => census(MULTI_LINE_CALL, 8, { rtOn: false }))
    const walls = row.steps.map((st) => wallOfStep(st, false))
    expect(walls, JSON.stringify(walls)).not.toContain('pine:statement')
    // the two real collection walls, one per statement, then the script attaches
    expect(walls.filter(Boolean)).toEqual(['pine:collection', 'pine:collection'])
    expect(row.reachedAfterPeel).toBe(true)
  })

  it('a block with a body: the header and its body go together (no orphaned body)', () => {
    // runtime-on: `for … in` is the lane's own wall; the body line under it must not
    // survive to be refused as a statement of its own
    const src = [...FIXTURE_HEAD,
      'x = 0.0',
      'for [i, v] in array.from(1.0, 2.0)',
      '    x += v',
      '    x += 1',
      'plot(close + x)',
    ].join(LF)
    const row = underLane(true, () => census(src, 8, { rtOn: true }))
    const walls = row.steps.map((st) => wallOfStep(st, true))
    expect(walls[0], JSON.stringify(walls)).toBe('runtime:loop')
    expect(walls.filter(Boolean).slice(1), JSON.stringify(walls)).not.toContain('pine:statement')
    expect(walls.filter(Boolean).slice(1), JSON.stringify(walls)).not.toContain('runtime:statement')
    expect(row.reachedAfterPeel).toBe(true)
  })

  it('a function whose only statement is refused: the emptied function goes (no empty body)', () => {
    // (train, W4-T0 x W4-T15: `log.*` is SERVED on the runtime lane since W4-T15, so the refused
    // statement here is now `ticker.new(…)`, a builtin the runtime lane still refuses as `pine:builtin`)
    // that statement is the runtime lane's wall; blanking it alone left `note(a) =>` with a
    // body of no statements, which the next door call refused as `runtime:function`
    const src = [...FIXTURE_HEAD,
      'arr = array.new_float(0)',   // the host lane refuses a collection; the runtime lane takes it
      'array.push(arr, close)',
      'note(a) =>',
      '    ticker.new("NASDAQ", "AAPL")',
      'note(close)',
      'v = array.get(arr, 0)',
      'plot(close + v)',
    ].join(LF)
    const row = underLane(true, () => census(src, 8, { rtOn: true }))
    const walls = row.steps.map((st) => wallOfStep(st, true))
    expect(walls[0], JSON.stringify(walls)).toBe('pine:builtin')
    const rest = walls.filter(Boolean).slice(1)
    for (const w of ['pine:statement', 'runtime:statement', 'runtime:function']) expect(rest, JSON.stringify(walls)).not.toContain(w)
    expect(row.reachedAfterPeel).toBe(true)
  })

  it('an if whose branch is refused takes its else with it (no else without an if)', () => {
    const src = [...FIXTURE_HEAD,
      'arr = array.new_float(0)',   // the host lane refuses a collection; the runtime lane takes it
      'array.push(arr, close)',
      'if close > open',
      '    ticker.new("NASDAQ", "AAPL")',
      'else',
      '    ticker.new("NYSE", "IBM")',
      'v = array.get(arr, 0)',
      'plot(close + v)',
    ].join(LF)
    const row = underLane(true, () => census(src, 8, { rtOn: true }))
    const walls = row.steps.map((st) => wallOfStep(st, true))
    expect(row.reachedAfterPeel, JSON.stringify(walls)).toBe(true)
    // ONE peel removes the whole if/else: the else's own refused call is never a second wall
    expect(row.peelSteps, JSON.stringify(walls)).toBe(1)
  })
})

describe('W4 T0: the runtime probe asks the build the door asked (objects in the run)', () => {
  // The door's value build refuses a drawing at `runtime:object-op`; the DRAWING build
  // explains it. Here the drawing build's own refusal is `runtime:conditional-history`
  // (a `ta.*` assigned in an `if`, read by `line.new`), and the host lane refused the
  // unknown function first so the runtime lane was consulted.
  const OBJECT_OP = [...FIXTURE_HEAD,
    'var float lo = na',
    'if close > open',
    '    lo := ta.sma(close, 3)',
    'ln = line.new(bar_index, lo, bar_index + 1, lo)',
    'plot(math.nosuch(close))',
  ].join(LF)

  it('the probe agrees with the door and does not call a drawing wall runtime:object-op', () => {
    const row = underLane(true, () => census(OBJECT_OP, 1, { rtOn: true }))
    const st = row.steps[0]
    expect(st.runtimeDeclined && st.runtimeDeclined.code, JSON.stringify(st.runtimeDeclined)).toBe('runtime:conditional-history')
    expect(st.rtProbe.guard).toBe('runtime:conditional-history')
    expect(st.rtProbe.agrees).toBe(true)
  })
})

// ─── THE ENGINE'S OWN DECLARED FUNCTIONS, ASKED THROUGH THE PINE DOOR ──────
// `doorCoverage.js`'s probe, unchanged (its header says why it asks rather than
// greps). Written out so the coverage map can say which ENGINE functions the
// Pine door does not reach: that is the `door-unreachable` evidence for names
// the engine declares. Env: COVERAGE_DOOR_OUT (json).
const DOOR_OUT = process.env.COVERAGE_DOOR_OUT
describe.skipIf(!DOOR_OUT)('engine table through the Pine door (doorCoverage probe)', () => {
  it('writes one row per declared engine function', () => {
    const rows = functionReachability({
      native: (src) => ({ result: parseFormula(src) }),
      pine: translatePine,
    })
    fs.writeFileSync(DOOR_OUT, `${JSON.stringify(rows.map((r) => ({
      name: r.name, call: r.call, native: r.native && r.native.status,
      pine: r.pine && r.pine.status, guard: (r.pine && r.pine.guard) || null,
    })), null, 1)}${LF}`)
    expect(rows.length).toBe(Object.keys(TABLE.functions).length)
  })
})

// ─── ⭐ W3W4-T0 — THE GUARD BEHIND A DROPPED OBJECT OP REACHES THE CENSUS ROW ──────────
describe('W3W4-T0: dropHeads', () => {
  it('cuts each why sentence to <op>@<line>: <guard>, with no message text', () => {
    const heads = dropHeads({
      guardRefusals: ['create@9: pine:state `acc`'],
      createDropWhy: ['create line@12 slot x: pine:collection array never created', 'create label@3 t: no refusal recorded'],
      cellTextWhy: ['cell@5: pine:text-value the text is a computed value'],
    })
    expect(heads).toEqual([
      'create@9: pine:state `acc`', 'create:line@12: pine:collection', 'create:label@3: unrecorded', 'cell:text@5: pine:text-value',
    ])
    expect(heads.join(' ')).not.toMatch(/array never created|computed value/)
    expect(dropHeads(undefined)).toEqual([])
  })

  it('a refused step with dropped ops carries counters and heads on its census row', () => {
    const src = [...FIXTURE_HEAD, 'f() =>', '    var int n = 0', '    n += 1', '    n',
      'if barstate.islast', '    label.new(bar_index, high, str.tostring(f()))'].join(LF)
    const r = oneDoor(src, { runtimeDetail: false })
    expect(typeof r.attemptedOps).toBe('number')
    expect(Array.isArray(r.dropHeads)).toBe(true)
    // consistent: every head names a guard, and a drop with reasons has the counter behind it
    for (const h of r.dropHeads) expect(h).toMatch(/^[\w:.-]+@[\d?]+: \S+/)
    if (Object.keys(r.dropReasons).length) expect(r.droppedOps).toBeGreaterThan(0)
  })
})

// ─── ⛔ ENGINE 55 — THE BOUND CHECK CAN FAIL (ordinary suite, a few door calls) ──────────
// `cleanBound` adds ONE bind to "fully drawn". Each blocker it names has a script here that
// trips it, a control that does not, and the store-dependent case it must NOT count.
describe('⛔ engine 55 — the census bound check (`boundBlockers`) can fail', () => {
  const head = ['//@version=5', "indicator('e55 bound', overlay=true)"]
  const doorOf = (lines) => underLane(false, () => memberPaneDefinition({ source: [...head, ...lines].join(LF), id: DEF_ID, name: 'b' }))

  it('⛔ a DARK plot (the builtin Supertrend from the listing: 0 bars against the off-listing replay) is a blocker', () => {
    const d = doorOf(['[st, dir] = ta.supertrend(3, 10)', 'plot(st)'])
    expect(d.ok).toBe(true)
    const why = boundBlockers(d)
    expect(why.some((w) => /^dark-plot:[^:]+:listing 0 \/ off-listing [1-9]\d*$/.test(w)), why.join(' | ')).toBe(true)
  })

  it('a plain plot binds clean (the control)', () => {
    const d = doorOf(['plot(ta.sma(close, 5))'])
    expect(d.ok).toBe(true)
    expect(boundBlockers(d)).toEqual([])
  })

  it('a venue TradingView was never measured answering (spelling-decided) is a blocker', () => {
    const d = doorOf(['plot(request.security("NYSEARCA:SPY", timeframe.period, close))', 'plot(close)'])
    expect(d.ok).toBe(true)
    expect(boundBlockers(d).join(' ')).toMatch(/other-symbol:venue-unconfirmed/)
  })

  it('a listing our store may hold (store-dependent: no bars in the census) is NOT counted', () => {
    const d = doorOf(['plot(request.security("AMEX:SPY", timeframe.period, close))'])
    expect(d.ok).toBe(true)
    expect(boundBlockers(d)).toEqual([])
  })

  it('a drawing step withheld as unknown (K-clustering\'s partly drawn table) is a blocker', () => {
    const cap = JSON.parse(fs.readFileSync(BOUND_REFERENCE, 'utf8'))
    const d = underLane(false, () => memberPaneDefinition({ source: cap.source.text, id: DEF_ID, name: 'kc' }))
    expect(d.ok).toBe(true)
    const why = boundBlockers(d)
    expect(why.some((w) => w.startsWith('objects:withheld-unknown:'))).toBe(true)
    expect(why).toContain('objects:not-computable')
  })
})
