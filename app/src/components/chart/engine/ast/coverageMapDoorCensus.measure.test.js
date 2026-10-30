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

const INPUT = process.env.COVERAGE_INPUT
const OUT = process.env.COVERAGE_OUT
const RUN = !!(INPUT && OUT)
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

function oneDoor(source) {
  let d
  try {
    d = memberPaneDefinition({ source, id: DEF_ID, name: 'coverage' })
  } catch (err) {
    return { threw: short((err && err.message) || err) }
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
    unsupported: diag.unsupported || [],
    outOfScope: diag.outOfScope || [],
    loopBlockedCalls: diag.loopBlockedCalls || [],
    notes: (d.notes || []).map((n) => (n && n.name) || null).filter(Boolean),
    refusals,
  }
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

function census(source, cap) {
  const work = source.split(/\r?\n/)
  const steps = []
  let stuck = null
  for (let step = 0; step < cap; step += 1) {
    const r = oneDoor(work.join(LF))
    // the line text each refusal names, read off the CURRENT program
    for (const ref of r.refusals || []) {
      ref.text = ref.line && work[ref.line - 1] != null ? short(work[ref.line - 1].trim(), 200) : null
    }
    steps.push(r)
    if (r.threw) { stuck = 'threw'; break }
    if (r.attached) break
    const lines = [...new Set((r.refusals || []).map((x) => x.line).filter((n) => n && n <= work.length))]
    if (!lines.length) { stuck = (r.refusals[0] && r.refusals[0].guard) || r.guard || 'no-line'; break }
    let changed = false
    for (const n of lines) {
      const b = bindingNameOf(work[n - 1])
      const next = b ? `${b.indent}${b.name} = 0.0` : ''
      if (work[n - 1] !== next) { work[n - 1] = next; changed = true }
    }
    if (!changed) { stuck = 'no-progress'; break }
  }
  const first = steps[0] || {}
  const last = steps[steps.length - 1] || {}
  return {
    attached: !!first.attached && first.installed !== false,
    clean: isClean(first),
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
    for (const it of items) {
      if (done.has(it.key)) continue
      fs.writeFileSync(cur, it.key)
      vi.stubEnv(OBJECTS_ONLY_FLAG, '1')   // production: ARMED
      vi.stubEnv(RUNTIME_FLAG, '')         // production: DARK
      const source = fs.readFileSync(it.path, 'utf8')
      const t0 = Date.now()
      let row
      try {
        row = census(source, it.cap || 8)
      } catch (err) {
        row = { attached: false, clean: false, stuck: 'threw', steps: [{ threw: short((err && err.message) || err) }] }
      }
      vi.unstubAllEnvs()
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
      fs.appendFileSync(OUT, `${JSON.stringify({ key: it.key, ms: Date.now() - t0, ...row })}\n`)
      n += 1
    }
    fs.writeFileSync(cur, '')
    console.log(`coverage census: ${n} new rows -> ${OUT}`)
    expect(items.length).toBeGreaterThan(0)
  }, 6 * 3600 * 1000)
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
