// app/src/components/chart/engine/ast/languageCoverageDoors.measure.test.js
//
// ─── THE LANGUAGE-COVERAGE SCOREBOARD'S DOOR QUESTIONS: BOTH LANES, ASKED ────
//
// Run only by `tools/pine_coverage/run_language_probe.py` (and by hand, below). It
// is a MEASURE test: it changes no engine code, asserts no count, and writes what
// each lane's own door answered, for `tools/pine_coverage/language_coverage.py` to
// join to the Pine v6 reference.
//
// ⭐ IT ASKS THE DOORS. The two lanes are asked about the SAME source:
//   • HOST    — `memberPaneDefinition` then `installUserDefinitions`, the two doors a
//               member's paste goes through, with the flag state PRODUCTION runs
//               (objects-only pane ARMED, runtime pane DARK). The same `oneDoor` /
//               `isClean` the coverage census (`coverageMapDoorCensus.measure.test.js`)
//               uses, copied rather than imported because a measure file cannot be
//               imported without registering its tests.
//   • RUNTIME — `probeRuntimeProgram`, the runtime lane's own existing compile check
//               (the first gate `memberPaneDefinition::runtimeLaneDefinition` asks),
//               in its value build and in its own-drawings build (`objectsInRun`).
//               It reads no flag, so it answers whether or not the pane is armed.
// Nothing here decides what is supported; each row is what a door said.
//
// ⛔ A THROW IS A ROW, never swallowed, and `current.txt` names the input being asked
// so a process death is attributed to it by the driver.
//
// ─── THREE MODES, EACH OPT-IN BY ITS OWN ENV VARIABLE ────────────────────────
//   A  LANGUAGE_COVERAGE_INPUT (json [{key, path | source}]) + LANGUAGE_COVERAGE_OUT
//      (jsonl, appended, resumable): one row per input, both lanes.
//   B  LANGUAGE_COVERAGE_DOOR_RUNTIME_OUT (json): `doorCoverage.js::functionReachability`
//      with the runtime lane as the door, for the engine's declared functions: the
//      runtime twin of `coverageMapDoorCensus.measure.test.js`'s COVERAGE_DOOR_OUT
//      block, over the SAME probe calls and the SAME three spellings.
//   C  LANGUAGE_COVERAGE_CAPTURE_LANES_OUT (json): for every vendor capture on disk,
//      which lane the member door draws it with when the runtime pane is ON. A
//      runtime-on vendor verdict is evidence for the runtime lane only for a capture
//      the runtime lane drew; one the host lane drew says nothing about it.
//
//   cd app && LANGUAGE_COVERAGE_INPUT=<in.json> LANGUAGE_COVERAGE_OUT=<out.jsonl> \
//     node node_modules/vitest/vitest.mjs run \
//       src/components/chart/engine/ast/languageCoverageDoors.measure.test.js --maxWorkers=2
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import * as registry from '../nativeRegistry'
import { assessObjectLoss } from './objectLoss'
import { TABLE } from './parse'
import { functionReachability } from './doorCoverage'
import { probeRuntimeProgram } from '../runtime/runtimeColumns'
import { runtimePaneEnabled, __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../runtimePaneGate'
import { objectsOnlyPaneEnabled } from '../objectsOnlyPaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../runtimeKill'
import { loadCapture, VENDOR_DIR, REPO } from '../__tests__/vendorHarness/harness'

const INPUT = process.env.LANGUAGE_COVERAGE_INPUT
const OUT = process.env.LANGUAGE_COVERAGE_OUT
const DOOR_RT_OUT = process.env.LANGUAGE_COVERAGE_DOOR_RUNTIME_OUT
const LANES_OUT = process.env.LANGUAGE_COVERAGE_CAPTURE_LANES_OUT
const DEF_ID = 'u_language-coverage'
const LF = String.fromCharCode(10)

afterEach(() => { vi.unstubAllEnvs() })

const GATE = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
/** The flag NAMES are read off their gate modules, never typed. */
const flagOf = (src) => (src.match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const OBJECTS_ONLY_FLAG = flagOf(GATE('src/components/chart/engine/objectsOnlyPaneGate.js'))
const RUNTIME_FLAG = flagOf(GATE('src/components/chart/engine/runtimePaneGate.js'))

const short = (s, n = 220) => (s == null ? null : String(s).slice(0, n))
const lineText = (source, line) => {
  if (!Number.isInteger(line)) return null
  const t = String(source).split(/\r?\n/)[line - 1]
  return t == null ? null : short(t.trim(), 200)
}

// ─── THE HOST LANE: the production member door ──────────────────────────────
function oneDoor(source) {
  vi.stubEnv(OBJECTS_ONLY_FLAG, '1')   // production: ARMED
  vi.stubEnv(RUNTIME_FLAG, '')         // production: DARK
  // ⛔ the state the door is ASKED under, read back from the gates themselves, so every row can be checked
  const flags = { objectsOnly: objectsOnlyPaneEnabled(), runtime: runtimePaneEnabled() }
  let d
  try {
    d = memberPaneDefinition({ source, id: DEF_ID, name: 'language coverage' })
  } catch (err) {
    return { threw: short((err && err.message) || err), flags }
  } finally {
    vi.unstubAllEnvs()
  }
  const t = d.translation || {}
  const refusals = (t.refusals || []).map((r) => {
    const line = Number.isInteger(r.line) ? r.line : ((r.at && Number.isInteger(r.at.line)) ? r.at.line : null)
    return {
      guard: r.guard || null,
      line,
      token: r.token != null ? short(r.token, 80) : (r.at && r.at.token != null ? short(r.at.token, 80) : null),
      message: short(r.message, 240),
      text: lineText(source, line),
    }
  })
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
    flags,
    attached: !!d.ok,
    installed,
    installError,
    guard: d.guard || null,
    reason: d.ok ? null : short(d.reason),
    plots: (d.rows || []).length,
    drawsObjects: !!(d.definition && d.definition.objects),
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
    refusals,
  }
}

/** ⭐ "TRANSFERS FULLY" — the coverage census's predicate (`isClean`), unchanged:
 *  attached AND installed AND zero refusals AND the object program carried with
 *  nothing dropped or withheld AND no paint withheld. */
function isClean(r) {
  return !!r && !!r.attached && r.installed !== false
    && (r.refusals || []).length === 0
    && (r.lossVerdict === 'clean' || r.lossVerdict == null)
    && !r.withheldObjects && !(r.withheldPaints > 0)
}

// ─── THE RUNTIME LANE: its own compile check ────────────────────────────────
function runtimeAsk(source, opts) {
  try {
    const p = probeRuntimeProgram(source, opts)
    if (p.ok) {
      return {
        ok: true,
        outputs: (p.outputs || []).length,
        requests: Number(p.requests) || 0,
        naTests: Number(p.naTests) || 0,
        objectOps: Number(p.objectOps) || 0,
      }
    }
    const r = p.refusal || {}
    const line = Number.isInteger(r.line) ? r.line : null
    return {
      ok: false,
      guard: r.guard || null,
      line,
      token: r.token != null ? short(r.token, 80) : null,
      message: short(r.message, 240),
      text: lineText(source, line),
    }
  } catch (err) {
    return { ok: false, guard: 'probe:threw', line: null, token: null, message: short((err && err.message) || err) }
  }
}

/** The runtime lane's own refusal names ONE wall per ask. A refused line is neutralised the way the census peels
 *  the host lane (`coverageMapDoorCensus.measure.test.js`): a binding keeps its name as `x = 0.0`, anything else is
 *  blanked, and the lane is asked again, so a script's later walls are named too.
 *  ⚠️ Peeling edits the program: a later wall may be a consequence of an edit. The answers are used only to name an
 *  item a refusal's TOKEN carries, never to credit anything, and they are listed in order so a reader can see which
 *  wall came after which. */
const PEEL_CAP = 8
function bindingNameOf(line) {
  const hash = line.indexOf('//')
  const bare = hash >= 0 ? line.slice(0, hash) : line
  const m = bare.match(
    /^(\s*)(?:(?:var|varip)\s+)?(?:(?:float|int|bool|string|color|line|label|box|table)\s+)?([A-Za-z_]\w*)\s*:?=(?!=)/)
  return m ? { indent: m[1], name: m[2] } : null
}
function runtimePeel(source, first) {
  const steps = []
  const work = String(source).split(/\r?\n/)
  let cur = first
  for (let i = 0; i < PEEL_CAP; i += 1) {
    if (cur.ok || !Number.isInteger(cur.line) || cur.line < 1 || cur.line > work.length) break
    const b = bindingNameOf(work[cur.line - 1])
    const next = b ? `${b.indent}${b.name} = 0.0` : ''
    if (work[cur.line - 1] === next) break
    work[cur.line - 1] = next
    cur = runtimeAsk(work.join(LF))
    steps.push(cur)
  }
  return steps
}

/** The HOST lane's walls behind the first, peeled exactly as the census peels (`coverageMapDoorCensus.measure.test.js`):
 *  every refused line is neutralised and the production door is asked again. Only the refusals are kept, in order,
 *  and they are used to name an item by its TOKEN, never to credit anything. ⚠️ A later wall may be a consequence of
 *  an edit; a wall whose token is not a reference item names nothing. */
const HOST_PEEL_CAP = 6
function hostPeel(source, first) {
  const steps = []
  const work = String(source).split(/\r?\n/)
  let cur = first
  for (let i = 0; i < HOST_PEEL_CAP; i += 1) {
    if (cur.threw || cur.attached) break
    const lines = [...new Set((cur.refusals || []).map((x) => x.line).filter((n) => Number.isInteger(n) && n >= 1 && n <= work.length))]
    if (!lines.length) break
    let changed = false
    for (const n of lines) {
      const b = bindingNameOf(work[n - 1])
      const next = b ? `${b.indent}${b.name} = 0.0` : ''
      if (work[n - 1] !== next) { work[n - 1] = next; changed = true }
    }
    if (!changed) break
    cur = oneDoor(work.join(LF))
    steps.push({ attached: !!cur.attached, guard: cur.guard || null, threw: cur.threw || null,
      refusals: (cur.refusals || []).map((x) => ({ guard: x.guard, line: x.line, token: x.token, text: x.text })),
      unsupported: cur.unsupported || [], loopBlockedCalls: cur.loopBlockedCalls || [] })
  }
  return steps
}

const bothLanes = (source) => {
  const runtime = runtimeAsk(source)
  const h = oneDoor(source)
  const host = h.threw ? h : { ...h, clean: isClean(h) }
  return {
    host,
    hostPeel: host.attached || host.threw ? [] : hostPeel(source, host),
    runtime,
    runtimeOwn: runtimeAsk(source, { objectsInRun: true }),
    runtimePeel: runtime.ok ? [] : runtimePeel(source, runtime),
  }
}

// ─── MODE A: every input through both lanes ─────────────────────────────────
describe.skipIf(!(INPUT && OUT))('language coverage: inputs through both lanes (driven by run_language_probe.py)', () => {
  it('answers every input script with each lane own door', () => {
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
      const source = it.source != null ? String(it.source) : fs.readFileSync(it.path, 'utf8')
      const t0 = Date.now()
      let row
      try {
        row = bothLanes(source)
      } catch (err) {
        row = { threw: short((err && err.message) || err) }
      }
      fs.appendFileSync(OUT, `${JSON.stringify({ key: it.key, ms: Date.now() - t0, ...row })}${LF}`)
      n += 1
    }
    fs.writeFileSync(cur, '')
    // eslint-disable-next-line no-console
    console.log(`language coverage: ${n} new rows -> ${OUT}`)
    expect(items.length).toBeGreaterThan(0)
  }, 6 * 3600 * 1000)
})

// ─── MODE B: THE ENGINE'S DECLARED FUNCTIONS, ASKED OF THE RUNTIME LANE ─────
// `doorCoverage.js::functionReachability`, unchanged, handed the runtime lane as
// the Pine door: it builds the SAME call for each declared function and tries the
// SAME three spellings (bare, `ta.`, `math.`). The adapter turns the lane's
// answer into the shape `classify` reads; a refusal keeps the lane's own guard.
const asRuntimeDoor = (src) => {
  const p = runtimeAsk(src)
  if (p.ok) return { outputs: [{ formula: 'runtime' }] }
  return { outputs: [], refusal: { guard: p.guard } }
}
describe.skipIf(!DOOR_RT_OUT)('engine table through the RUNTIME lane (doorCoverage probe, runtime door)', () => {
  it('writes one row per declared engine function', () => {
    const rows = functionReachability({ pine: asRuntimeDoor }, TABLE)
    fs.writeFileSync(DOOR_RT_OUT, `${JSON.stringify(rows.map((r) => ({
      name: r.name, call: r.call, lane: 'runtime', pine: r.pine && r.pine.status, guard: (r.pine && r.pine.guard) || null,
    })), null, 1)}${LF}`)
    expect(rows.length).toBe(Object.keys(TABLE.functions).length)
  })
})

// ─── MODE C: WHICH LANE DRAWS EACH VENDOR CAPTURE, RUNTIME PANE ON ──────────
function walkJson(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkJson(p, out)
    else if (e.name.endsWith('.json')) out.push(p)
  }
  return out.sort()
}
describe.skipIf(!LANES_OUT)('vendor captures: the lane the member door draws each with, runtime pane ON', () => {
  it('writes one row per capture', () => {
    vi.stubEnv(OBJECTS_ONLY_FLAG, '1')
    vi.stubEnv(RUNTIME_FLAG, '1')
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    expect(runtimePaneEnabled(), 'the runtime pane must be OPEN for this mode').toBe(true)
    const rows = []
    for (const f of walkJson(VENDOR_DIR)) {
      const loaded = loadCapture(f)
      const source = loaded.capture && loaded.capture.source && loaded.capture.source.text
      if (!source) { rows.push({ file: loaded.file, format: loaded.format, lane: null, why: 'no source text' }); continue }
      let lane = null
      let declined = null
      let guard = null
      try {
        const d = memberPaneDefinition({ source, id: 'u_language-coverage-lane', name: 'lane probe' })
        lane = d.ok ? (d.lane || 'host') : null
        declined = d.runtimeDeclined ? d.runtimeDeclined.code : null
        guard = d.guard || null
      } catch (err) {
        guard = `threw:${short((err && err.message) || err, 80)}`
      }
      rows.push({ file: loaded.file, format: loaded.format, lane, declined, guard })
    }
    fs.writeFileSync(LANES_OUT, `${JSON.stringify({ repo: path.basename(REPO), rows }, null, 1)}${LF}`)
    expect(rows.length).toBeGreaterThan(0)
  }, 3600 * 1000)
})

// ─── ⛔ SELF-CHECK: THE INSTRUMENT CAN TELL ACCEPTED FROM REFUSED, IN BOTH LANES ──
// Cheap (two scripts, a few door calls) and run in every ordinary suite. A probe
// runner that answered "accepted" for everything, or "refused" for everything,
// would make the whole scoreboard read flat; each outcome is shown to occur.
const GOOD = ['//@version=6', 'indicator("lang check")', 'plot(ta.sma(close, 14))'].join(LF)
const BAD = ['//@version=6', 'indicator("lang check")', 'plot(language_check_no_such.function(close))'].join(LF)
// the census's own lane self-check script: the host lane refuses a mutable `var` carried through a block, the
// runtime lane draws it (coverageMapDoorCensus.measure.test.js SELF_CHECK_SOURCE)
const RUNTIME_ONLY = ['//@version=5', "indicator('lane self-check')", 'var float acc = 0.0', 'if close > open',
  '    acc := acc + 1', 'plot(acc)'].join(LF)

describe('⛔ language-coverage instrument: it can fail', () => {
  it('a known-good script is accepted by the host lane and the runtime lane', () => {
    const r = bothLanes(GOOD)
    expect(r.host.attached, JSON.stringify(r.host).slice(0, 400)).toBe(true)
    expect(r.host.clean).toBe(true)
    expect(r.runtime.ok, JSON.stringify(r.runtime).slice(0, 400)).toBe(true)
  })

  it('RED: an unknown function is refused by BOTH lanes, each with a named guard', () => {
    const r = bothLanes(BAD)
    expect(r.host.attached).toBe(false)
    expect(r.host.clean).toBe(false)
    expect((r.host.refusals || []).length + (r.host.guard ? 1 : 0)).toBeGreaterThan(0)
    expect(r.runtime.ok).toBe(false)
    // measured 2026-11-02: the runtime lane shares the Pine front end, so an unknown name is `pine:builtin` there too
    expect(r.runtime.guard, JSON.stringify(r.runtime).slice(0, 400)).toMatch(/^(pine|runtime):/)
  })

  it('the runtime peel names a second wall behind the first, and nothing behind an accepted script', () => {
    const TWO = ['//@version=6', 'indicator("lang check")', 'a = language_check_no_such.one(close)',
      'b = language_check_no_such.two(close)', 'plot(a + b)'].join(LF)
    const r = bothLanes(TWO)
    expect(r.runtime.ok).toBe(false)
    expect(r.runtimePeel.length).toBeGreaterThan(0)
    expect(bothLanes(GOOD).runtimePeel).toEqual([])
    expect(bothLanes(GOOD).hostPeel).toEqual([])
    expect(Array.isArray(r.hostPeel)).toBe(true)
  })

  it('the runtime-twin adapter keeps the lane guard and reports reachable for an accepted call', () => {
    expect(asRuntimeDoor(GOOD)).toEqual({ outputs: [{ formula: 'runtime' }] })
    const bad = asRuntimeDoor(BAD)
    expect(bad.outputs).toEqual([])
    expect(bad.refusal.guard).toMatch(/^(pine|runtime):/)
  })

  it('the host door is asked with the runtime pane DARK and the objects-only pane ARMED, and says so', () => {
    const h = oneDoor(GOOD)
    expect(h.flags).toEqual({ objectsOnly: true, runtime: false })
  })

  it('the host door stays the host door even when the process has the runtime pane OPEN', () => {
    vi.stubEnv(OBJECTS_ONLY_FLAG, '1')
    vi.stubEnv(RUNTIME_FLAG, '1')
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    try {
      // control: with the pane open the member door really does hand this script to the runtime lane
      const open = memberPaneDefinition({ source: RUNTIME_ONLY, id: DEF_ID, name: 'control' })
      const gated = open.runtimeDeclined && ['runtime:not-yet-graded', 'runtime:killed'].includes(open.runtimeDeclined.code)
      expect(open.lane === 'runtime' || (!!open.runtimeDeclined && !gated), JSON.stringify(open.runtimeDeclined || open.lane)).toBe(true)
      // the instrument must not see that: oneDoor re-stubs the production flag state around its own call
      const h = oneDoor(RUNTIME_ONLY)
      expect(h.flags).toEqual({ objectsOnly: true, runtime: false })
      expect(h.attached, JSON.stringify(h).slice(0, 300)).toBe(false)
      expect(h.lane).toBe(null)
    } finally {
      vi.unstubAllEnvs()
      __resetRuntimePanePermission()
      __resetRuntimeAllowList()
    }
  })

  it('isClean is the census predicate: attached, installed, no refusal, nothing dropped or withheld', () => {
    const clean = { attached: true, installed: true, refusals: [], lossVerdict: 'clean', withheldObjects: false, withheldPaints: 0 }
    expect(isClean(clean)).toBe(true)
    expect(isClean({ ...clean, lossVerdict: null })).toBe(true)
    expect(isClean({ ...clean, attached: false })).toBe(false)
    expect(isClean({ ...clean, installed: false })).toBe(false)
    expect(isClean({ ...clean, refusals: [{ guard: 'pine:block' }] })).toBe(false)
    expect(isClean({ ...clean, lossVerdict: 'dropped' })).toBe(false)
    expect(isClean({ ...clean, withheldObjects: true })).toBe(false)
    expect(isClean({ ...clean, withheldPaints: 1 })).toBe(false)
    expect(isClean(null)).toBe(false)
  })
})
