// ─── ⭐⭐ SETTINGS PARITY (timeframe, Engine 77, #1831) — A TIMEFRAME INPUT IS A RUN-LANE SETTING ───
//
// `runtime/runtimeInputs.js::withTimeframeInputs` declares a runtime document's `input.timeframe` as an
// `enum` setting ON LOAD (never stored); `pineRuntimeFrontend.js::applyMemberDefault` puts a member's value
// where the author's default was, so the request's host reader reads it as it reads a literal timeframe and
// the request supply decides it with its own rules. Each rail has a control.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtimeColumns.js'
import {
  runtimeInputSpecsOf, withTimeframeInputs, runtimeInputValues, runtimeBuildInputs, TIMEFRAME_MENU, isTimeframeText,
  __serveEveryTimeframeSettingForTests, __resetTimeframeSettingForTests, movedTimeframeRefusal,
  TIMEFRAME_LOCKED_SENTENCE,
} from '../runtimeInputs.js'
import { fieldsForInstance } from '../../../indicatorRegistry.js'
import { stripParamInputs } from '../../paramInputs.js'
import { projectMemberDocument } from '../../memberDocumentProjection.js'
import { validateDefinition } from '../../defSchema.js'
import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAdmission } from '../../runtimeKill'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers(); __resetTimeframeSettingForTests() })

/** The flag NAMES are read off their gate modules, never typed (the corpus test's rule). */
const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')

/** Weekday ISO dates from 2026-01-05 (a Monday), `n` sessions. */
function weekdays(n, from = '2026-01-05') {
  const out = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < n) {
    const w = d.getUTCDay()
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const CHART = weekdays(40).map((t, i) => {
  const c = 100 + i + (i % 3) * 0.5
  return { t, o: c - 0.25, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const ctxOf = (runtimeInputs) => ({
  tf: 'D', newestBarIsForming: false, historyFromListing: true,
  symbol: { ticker: 'RDDT', exchange: 'NYSE' },
  ...(runtimeInputs ? { runtimeInputs } : {}),
})
const SCRIPT = (tfDefault, extra = '') => '//@version=5\nindicator("tf setting")\n'
  + `tf = input.timeframe("${tfDefault}", "Alt Timeframe"${extra})\n`
  + 'plot(request.security(syminfo.tickerid, tf, close))\n'
const runtimeDoc = (source) => ({
  id: 'tfset', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:tfset', outputs: { a: 0 }, source },
})
/** One run of `def` with the member's values `given` handed the way the chart hands them. */
const run = (def, given) => {
  const values = runtimeInputValues(def, given)
  return computeRuntimeColumns(def, CHART, ctxOf(Object.keys(values).length ? values : undefined))
}
const refusalOf = (fn) => {
  try { fn(); return null } catch (err) { return { guard: err && (err.guard || err.code), message: String(err && err.message) } }
}
const col = (out) => Array.from(out.a, (v) => (Number.isNaN(v) ? null : v))

describe('the setting, declared on load (never minted, never stored)', () => {
  const def = withTimeframeInputs(runtimeDoc(SCRIPT('1D')))
  const spec = (def.inputs || []).find((s) => s.key === 'tf')

  it("a runtime document's `input.timeframe` is an enum over TradingView's menu, at the author's default", () => {
    expect(spec).toMatchObject({ key: 'tf', type: 'enum', default: '1D', label: 'Alt Timeframe', timeframe: true, fromTimeframe: true })
    expect(spec.options.map((p) => p[0])).toEqual(TIMEFRAME_MENU.map((p) => p[0]))
    expect(spec.options).toContainEqual(['1W', '1 week'])
  })

  it("the author's `options = […]` are the menu, and only they", () => {
    const d = withTimeframeInputs(runtimeDoc(SCRIPT('W', ', options = ["D", "W", "M"]')))
    expect(d.inputs.find((s) => s.key === 'tf').options).toEqual([['D', 'D'], ['W', 'W'], ['M', 'M']])
  })

  it("the chart's own timeframe (`''`) is the first entry, named as TradingView names it", () => {
    const d = withTimeframeInputs(runtimeDoc(SCRIPT('')))
    const s = d.inputs.find((x) => x.key === 'tf')
    expect(s.default).toBe('')
    expect(s.options[0]).toEqual(['', 'Chart'])
  })

  it('a default that is not a timeframe written as text declares nothing (CONTROL: the reader says no)', () => {
    expect(isTimeframeText('1W')).toBe(true)
    expect(isTimeframeText('weekly')).toBe(false)
    const d = withTimeframeInputs(runtimeDoc('//@version=5\nindicator("x")\ntf = input.timeframe(timeframe.period)\nplot(close)\n'))
    expect((d.inputs || []).some((s) => s.key === 'tf')).toBe(false)
  })

  it('what the door MINTS is unchanged: the minting reader still skips it, by name', () => {
    const minted = runtimeInputSpecsOf(SCRIPT('1D'))
    expect(minted.specs.some((s) => s.key === 'tf')).toBe(false)
    expect(minted.skipped.find((s) => s.key === 'tf').reason).toMatch(/timeframe setting changes which bars/)
  })

  it('a save takes it off (`stripParamInputs`), so the stored document is byte-identical', () => {
    // a minted runtime document carries its settings array (here one the minting reader declared)
    const stored = { ...runtimeDoc(SCRIPT('1D')), inputs: [{ key: 'len', type: 'int', default: 14, label: 'Length' }] }
    const loaded = withTimeframeInputs(stored)
    expect(loaded.inputs.map((s) => s.key)).toEqual(['len', 'tf'])
    expect(JSON.stringify(stripParamInputs(loaded))).toBe(JSON.stringify(stored))
    // CONTROL: without the strip the loaded document is NOT the stored one
    expect(JSON.stringify(loaded)).not.toBe(JSON.stringify(stored))
  })

  it('a host document declares nothing (the run lane only)', () => {
    const host = { id: 'h', compute: { kind: 'ast', ast: { type: 'num', value: 1 }, source: SCRIPT('1D') } }
    expect(withTimeframeInputs(host)).toBe(host)
  })

  it('the member door projects it on install, and only there', () => {
    __permitRuntimePaneForTests()
    __resetRuntimeAdmission()
    __allowEveryRuntimeScriptForTests()
    const src = fs.readFileSync(path.resolve(process.cwd(), '../corpus/committed/pa-zigzag-fibonacci-fan__2001.pine'), 'utf8')
    const minted = memberPaneDefinition({ source: src, id: 'u_tfset', name: 'tf' })
    expect(minted.ok).toBe(true)
    expect(minted.definition.inputs.some((s) => s.key === 'tf' || s.fromTimeframe)).toBe(false)
    expect(minted.definition.compute.kind).toBe('runtime')
    const projected = projectMemberDocument(minted.definition)
    expect(projected.inputs.find((s) => s.key === 'tf')).toMatchObject({ default: '1D', fromTimeframe: true })
    // the schema accepts the projected setting (an enum of [value, label] pairs on a runtime document)
    expect(validateDefinition(projected).ok, JSON.stringify(validateDefinition(projected).errors)).toBe(true)
  })
})

describe('while no evidence admits a move, the setting is READ-ONLY at its default, with one line', () => {
  it('every settings surface gets the field inert, with the sentence as its reason and its visible tip', () => {
    const def = withTimeframeInputs(runtimeDoc(SCRIPT('1D')))
    const spec = def.inputs.find((s) => s.key === 'tf')
    expect(spec.locked).toBe(TIMEFRAME_LOCKED_SENTENCE)
    expect(TIMEFRAME_LOCKED_SENTENCE).toBe("Changing this script's timeframe isn't available yet: our weekly and monthly "
      + "results for it don't match TradingView yet.")
    const field = fieldsForInstance(def, { instanceId: 'i1', inputs: {} }).all.find((f) => f.key === 'tf')
    expect(field).toMatchObject({ type: 'select', disabled: TIMEFRAME_LOCKED_SENTENCE, tooltip: TIMEFRAME_LOCKED_SENTENCE })
    expect(fieldsForInstance(def, { instanceId: 'i1', inputs: {} }).values.tf).toBe('1D')
  })

  it('CONTROL: once the evidence gate opens (the harness seam here), the same setting is a live menu', () => {
    __serveEveryTimeframeSettingForTests()
    const def = withTimeframeInputs(runtimeDoc(SCRIPT('1D')))
    expect(def.inputs.find((s) => s.key === 'tf').locked).toBeUndefined()
    expect(fieldsForInstance(def, { instanceId: 'i1', inputs: {} }).all.find((f) => f.key === 'tf').disabled).toBeUndefined()
  })
})

describe('a member who moves it is refused by name, and the default still draws (no evidence admits a move yet)', () => {
  it('moved to 1W on a member surface: refused by name, never drawn', () => {
    const why = refusalOf(() => run(withTimeframeInputs(runtimeDoc(SCRIPT('1D'))), { tf: '1W' }))
    expect(why).not.toBe(null)
    expect(why.message).toContain(movedTimeframeRefusal('tf', '1W'))
  })

  it('handed as a plain value only, the same refusal', () => {
    const why = refusalOf(() => computeRuntimeColumns(runtimeDoc(SCRIPT('1D')), CHART, ctxOf({ tf: '1M' })))
    expect(why && why.message).toContain(movedTimeframeRefusal('tf', '1M'))
  })

  it("CONTROL: the author's default handed back is no move, and draws", () => {
    expect(col(computeRuntimeColumns(runtimeDoc(SCRIPT('1D')), CHART, ctxOf({ tf: '1D' })))).toEqual(CHART.map((b) => b.c))
    expect(col(run(withTimeframeInputs(runtimeDoc(SCRIPT('1D'))), {}))).toEqual(CHART.map((b) => b.c))
  })
})

describe('the run reads the member\'s timeframe exactly as it reads the same timeframe written in the source', () => {
  // the runtime-on harness lane's own switch: the mechanism the evidence would admit
  beforeEach(() => { __serveEveryTimeframeSettingForTests() })
  it('at the default nothing is handed, and the run is the author\'s (CONTROL)', () => {
    const def = withTimeframeInputs(runtimeDoc(SCRIPT('1D')))
    expect(runtimeInputValues(def, { tf: '1D' })).toEqual({})
    expect(col(run(def, { tf: '1D' }))).toEqual(col(computeRuntimeColumns(runtimeDoc(SCRIPT('1D')), CHART, ctxOf())))
    expect(col(run(def, {}))).toEqual(CHART.map((b) => b.c))
  })

  it('moved to 1W: the weekly merge, value for value the script with "1W" written as its default', () => {
    const moved = col(run(withTimeframeInputs(runtimeDoc(SCRIPT('1D'))), { tf: '1W' }))
    resetRuntimeSessions()
    const literal = col(computeRuntimeColumns(runtimeDoc(SCRIPT('1W')), CHART, ctxOf()))
    expect(moved).toEqual(literal)
    expect(moved).not.toEqual(CHART.map((b) => b.c))   // CONTROL: the merge is not the chart's own close
  })

  it('moved to 1M: the monthly merge, as written in the source', () => {
    const moved = col(run(withTimeframeInputs(runtimeDoc(SCRIPT('1D'))), { tf: '1M' }))
    resetRuntimeSessions()
    expect(moved).toEqual(col(computeRuntimeColumns(runtimeDoc(SCRIPT('1M')), CHART, ctxOf())))
  })

  it('handed as a plain value only (a caller with no declared inputs, the server service), it is the same run', () => {
    const def = withTimeframeInputs(runtimeDoc(SCRIPT('1D')))
    const viaDefaults = col(run(def, { tf: '1W' }))
    resetRuntimeSessions()
    const bare = runtimeDoc(SCRIPT('1D'))
    expect(runtimeBuildInputs(bare, { tf: '1W' }).inputDefaults).toEqual({})
    expect(col(computeRuntimeColumns(bare, CHART, ctxOf({ tf: '1W' })))).toEqual(viaDefaults)
  })
})

describe('a timeframe the supply does not serve is refused by name, with the supply\'s own sentence', () => {
  beforeEach(() => { __serveEveryTimeframeSettingForTests() })
  it('60 on a daily chart (below it): refused, never drawn at the default', () => {
    const why = refusalOf(() => run(withTimeframeInputs(runtimeDoc(SCRIPT('1D'))), { tf: '60' }))
    expect(why).not.toBe(null)
    // the same refusal the script gets with "60" written in the source
    resetRuntimeSessions()
    const literal = refusalOf(() => computeRuntimeColumns(runtimeDoc(SCRIPT('60')), CHART, ctxOf()))
    expect(literal).not.toBe(null)
    expect(why.message).toBe(literal.message)
  })

  it('text that is not a timeframe is refused by name (`runtime:statement`)', () => {
    const def = withTimeframeInputs(runtimeDoc(SCRIPT('1D')))
    const why = refusalOf(() => computeRuntimeColumns(def, CHART, ctxOf({ tf: 'weekly' })))
    expect(why).not.toBe(null)
    expect(why.message).toMatch(/not a timeframe written as text/)
  })
})

/** A USE of the seam: an import that names it, or a call of it. */
const SEAM_USE = /import\s*\{[^}]*\b__serveEveryTimeframeSettingForTests\b[^}]*\}|\b__serveEveryTimeframeSettingForTests\s*\(/

describe('the runtime-on lane\'s moved-timeframe grant is a test seam only', () => {
  it('no member surface imports `__serveEveryTimeframeSettingForTests`', () => {
    const root = path.resolve(process.cwd(), 'src')
    const hits = []
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue }
        if (!/\.(js|jsx|mjs)$/.test(e.name) || /\.test\.(js|jsx)$/.test(e.name) || p.includes(`${path.sep}__tests__${path.sep}`)) continue
        if (e.name === 'runtimeInputs.js') continue
        // an IMPORT or a CALL is a use; a sentence naming the seam (the engine ledger's) is not
        if (SEAM_USE.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p))
      }
    }
    walk(root)
    expect(hits).toEqual([])
    // CONTROL: the pattern says yes to a use and no to a mention
    expect(SEAM_USE.test("import { __serveEveryTimeframeSettingForTests } from './runtime/runtimeInputs.js'")).toBe(true)
    expect(SEAM_USE.test('  __serveEveryTimeframeSettingForTests()')).toBe(true)
    expect(SEAM_USE.test('the harness lane alone grades it (`__serveEveryTimeframeSettingForTests`)')).toBe(false)
    // CONTROL: the walk reads files (the harness lane, a test file, is where the grant lives)
    expect(fs.readFileSync(path.join(root, 'components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js'), 'utf8'))
      .toContain('__serveEveryTimeframeSettingForTests')
  })
})
