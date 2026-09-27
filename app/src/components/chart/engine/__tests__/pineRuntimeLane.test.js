// app/src/components/chart/engine/__tests__/pineRuntimeLane.test.js
//
// ─── THE RUNTIME LANE'S MEMBER DOOR, AT THE ENGINE LAYER (2026-09-27) ────────
//
// What `engine/pineRuntimeLane.js` promises, one rail each:
//
//   · the flag is off unless it is exactly '1', and fails CLOSED on an unreadable env
//   · every host guard it answers for is PROVED by a script the host refuses with
//     that guard alone and this lane builds — and no vocabulary/ruling guard is in it
//   · a document's columns are the program's outputs, mapped, shifted and checked
//     against the rebuilt program (a stale map is a named error, never a wrong plot)
//   · a member's value reaches EVERY fold, window lengths included
//   · the colour channel and the output lines are opt-in: no other caller's build moves
//   · the host lane's presentation hand-off is opt-in and invisible to persistence
//   · the schema accepts a `pine` document and refuses a malformed one by name
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { pineRuntimeLaneEnabled } from '../pineRuntimeLaneGate'
import {
  RUNTIME_FALLBACK_GUARDS, isRuntimeFallbackGuard, runtimeLaneBuild, runtimeLaneColumns,
  runtimeLaneHandle,
} from '../pineRuntimeLane'
import { translatePine, REFUSALS } from '../ast/pine'
import { buildRuntimeIr } from '../ast/pineRuntimeFrontend'
import { runtimeClockOpts } from '../ast/pineRuntimeClock'
import { validateDefinition } from '../defSchema'

afterEach(() => { vi.unstubAllEnvs() })

const REPO = path.resolve(process.cwd(), '..')
const H = '//@version=5\nindicator("t")\n'
const N = 60
// ⛔ A MOVING SERIES, so a lane that read the wrong column cannot agree by accident.
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + i * 0.3,
  h: 103 + i * 0.3 + (i % 4),
  l: 97 + i * 0.3 - (i % 3),
  c: 100 + Math.sin(i / 2.1) * 6 + i * 0.3,
  v: 1000 + i * 7,
}))
const CTX = { tf: 'D', newestBarIsForming: false }

describe('the flag — `VITE_PINE_RUNTIME_LANE_ENABLED`', () => {
  it('is ON only for exactly "1"', () => {
    expect(pineRuntimeLaneEnabled({})).toBe(false)
    for (const v of ['', '0', 'true', 'yes', ' 1']) {
      expect(pineRuntimeLaneEnabled({ VITE_PINE_RUNTIME_LANE_ENABLED: v }), JSON.stringify(v)).toBe(false)
    }
    expect(pineRuntimeLaneEnabled({ VITE_PINE_RUNTIME_LANE_ENABLED: '1' })).toBe(true)
  })

  it('⛔ fails CLOSED on an env source that cannot be read', () => {
    const hostile = { get VITE_PINE_RUNTIME_LANE_ENABLED() { throw new Error('no env') } }
    expect(pineRuntimeLaneEnabled(hostile)).toBe(false)
    expect(pineRuntimeLaneEnabled(null)).toBe(false)
  })

  it('reads the build env when no source is passed', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    expect(pineRuntimeLaneEnabled()).toBe(true)
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '')
    expect(pineRuntimeLaneEnabled()).toBe(false)
  })
})

/** ⭐ ONE SCRIPT PER GUARD — the host refuses it with that guard and nothing else,
 *  and the runtime lane builds it. `pine:function-def` is proved on a real corpus
 *  script, which draws, so its build is asked with `ownsDrawing`. */
const GUARD_PROOFS = {
  'pine:state': { source: H + 'var float s = 0.0\ns := s + close\nplot(s)\n' },
  'pine:reassign': { source: H + 'float s = 0.0\nfor i = 0 to 3\n    s := s + close[i]\nplot(s)\n' },
  'pine:block': { source: H + 'x = switch\n    close > open => 1\n    => 0\nplot(x)\n' },
  'pine:collection': { source: H + 'a = array.new_float(0)\narray.push(a, close)\nplot(array.get(a, 0))\n' },
  'pine:type': { source: H + 'type P\n    float v\np = P.new(close)\nplot(p.v)\n' },
  'pine:function-def': {
    source: fs.readFileSync(path.join(REPO, 'corpus/committed/trendlines__43QQg9nDN0.pine'), 'utf8'),
    ownsDrawing: true,
  },
}

describe('⭐⭐ the fallback guard set is PROVED, member by member', () => {
  it('every member has a proof, and every proof is a member', () => {
    expect(Object.keys(GUARD_PROOFS).sort()).toEqual([...RUNTIME_FALLBACK_GUARDS].sort())
  })

  it.each(Object.entries(GUARD_PROOFS))('%s — the host refuses it with that guard alone, and this lane builds it',
    (guard, proof) => {
      vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
      const t = translatePine(proof.source, { strict: true })
      expect(t.ok).toBe(false)
      expect([...new Set((t.refusals || []).map((r) => r.guard))]).toEqual([guard])
      const b = runtimeLaneBuild(proof.source, { ownsDrawing: !!proof.ownsDrawing })
      expect(b.ok, JSON.stringify(b.refusal)).toBe(true)
    })

  it('⛔ every member is a real host guard, and no vocabulary or ruling guard is one', () => {
    for (const g of RUNTIME_FALLBACK_GUARDS) expect(REFUSALS, g).toHaveProperty(g)
    // A ruling guard records that nobody has ruled what a name MEANS here; the
    // runtime lane must never be a way around it.
    const RULINGS = ['pine:function', 'pine:builtin', 'pine:arity', 'pine:role-order', 'pine:window',
      'pine:window-dependent', 'pine:input-kind', 'pine:request', 'pine:text-value', 'pine:colour-value',
      'pine:module', 'pine:declaration-strategy', 'pine:objects-only', 'pine:no-output',
      'pine:object-removal-lost', 'pine:plot-offset']
    for (const g of RULINGS) expect(isRuntimeFallbackGuard(g), g).toBe(false)
    expect(isRuntimeFallbackGuard(undefined)).toBe(false)
  })

  it('⛔ CONTROL — a script this lane builds and the host refuses on a RULING is not admitted', () => {
    // `support-and-resistance` refuses `pine:role-order` on the host lane and BUILDS
    // here (measured 2026-09-27). The set is what keeps it out.
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    const src = fs.readFileSync(path.join(REPO, 'corpus/committed/support-and-resistance__UgNPprOr8h.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.refusal.guard).toBe('pine:role-order')
    expect(runtimeLaneBuild(src).ok).toBe(true)
    expect(isRuntimeFallbackGuard(t.refusal.guard)).toBe(false)
  })
})

/** A minimal hand-made `pine` document — the adapter reads nothing else. */
function docOf(source, columns, extra = {}) {
  return {
    id: 'u_member-pane-t',
    compute: {
      kind: 'pine', fn: runtimeLaneHandle(source), rev: 1, source,
      lane: { plotColours: true, ownsDrawing: false }, columns, ...extra,
    },
  }
}

describe('⭐ a document\'s columns are the rebuilt program\'s outputs', () => {
  it('a running total is the cumulative sum of the closes — computed here independently', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    const src = H + 'var float s = 0.0\ns := s + close\nplot(s)\n'
    const { columns, errors } = runtimeLaneColumns(docOf(src, { value: { output: 0, call: 'plot', line: 5 } }), BARS, {}, CTX)
    expect(errors).toEqual({})
    let acc = 0
    BARS.forEach((b, i) => { acc += b.c; expect(columns.value[i]).toBeCloseTo(acc, 9) })
  })

  it('a positive displacement re-indexes the finished column, first N bars `na`', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    const src = H + 'var float s = 0.0\ns := s + close\nplot(s)\n'
    const base = runtimeLaneColumns(docOf(src, { value: { output: 0, call: 'plot', line: 5 } }), BARS, {}, CTX)
    const shifted = runtimeLaneColumns(docOf(src, { value: { output: 0, call: 'plot', line: 5, shift: 3 } }), BARS, {}, CTX)
    for (let i = 0; i < 3; i += 1) expect(Number.isNaN(shifted.columns.value[i])).toBe(true)
    for (let i = 3; i < N; i += 1) expect(shifted.columns.value[i]).toBe(base.columns.value[i - 3])
  })

  it('⛔ a saved map that no longer matches the program is a NAMED error, never another plot\'s series', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    const src = H + 'plot(close)\nplot(open)\n'
    const wrongCall = runtimeLaneColumns(docOf(src, { value: { output: 0, call: 'plotshape', line: 3 } }), BARS, {}, CTX)
    expect(wrongCall.columns).toEqual({})
    expect(wrongCall.errors.value.guard).toBe('runtime-door:shape')
    const wrongLine = runtimeLaneColumns(docOf(src, { value: { output: 1, call: 'plot', line: 3 } }), BARS, {}, CTX)
    expect(wrongLine.errors.value.guard).toBe('runtime-door:shape')
    // control: the right map reads the right series
    const right = runtimeLaneColumns(docOf(src, { value: { output: 1, call: 'plot', line: 4 } }), BARS, {}, CTX)
    expect(right.errors).toEqual({})
    expect(Array.from(right.columns.value)).toEqual(BARS.map((b) => b.o))
  })

  it('a program the rebuild refuses is a named error on EVERY key', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    const src = H + 'plot(fixnan(close))\n'
    const r = runtimeLaneColumns(docOf(src, { value: { output: 0, call: 'plot' }, out2: { output: 1, call: 'plot' } }), BARS, {}, CTX)
    expect(r.columns).toEqual({})
    expect(r.errors.value.guard).toBe('pine:na')
    expect(r.errors.out2.guard).toBe('pine:na')
  })
})

describe('⭐⭐ a member\'s value reaches EVERY fold — the window length too', () => {
  it('`len = 5` from the knob computes what a script written with 5 computes', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    // `nz` because an RMA is `na` through its warm-up and `na` poisons a running total.
    const withInput = H + 'len = input.int(3, "Length")\nvar float s = 0.0\ns := s + nz(ta.rma(close, len))\nplot(s)\n'
    const literal = H + 'len = 5\nvar float s = 0.0\ns := s + nz(ta.rma(close, len))\nplot(s)\n'
    const spec = { value: { output: 0, call: 'plot', line: 6 } }
    const knob = runtimeLaneColumns(docOf(withInput, spec, { inputs: { pine_len: 'len' } }), BARS, { pine_len: 5 }, CTX)
    const five = runtimeLaneColumns(docOf(literal, spec), BARS, {}, CTX)
    const dflt = runtimeLaneColumns(docOf(withInput, spec, { inputs: { pine_len: 'len' } }), BARS, {}, CTX)
    expect(knob.errors).toEqual({})
    expect(Array.from(knob.columns.value)).toEqual(Array.from(five.columns.value))
    // control: the knob MOVED something — the default (3) is a different series
    expect(Array.from(dflt.columns.value)).not.toEqual(Array.from(five.columns.value))
  })

  it('a bool knob reaches the program as the number Pine folds it to', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    const src = H + 'show = input.bool(true, "Show")\nvar float s = 0.0\ns := s + 1\nplot(show ? s : na)\n'
    const spec = { value: { output: 0, call: 'plot', line: 6 } }
    const on = runtimeLaneColumns(docOf(src, spec, { inputs: { pine_show: 'show' } }), BARS, { pine_show: true }, CTX)
    const off = runtimeLaneColumns(docOf(src, spec, { inputs: { pine_show: 'show' } }), BARS, { pine_show: false }, CTX)
    expect(on.columns.value[N - 1]).toBe(N)
    expect(Number.isNaN(off.columns.value[N - 1])).toBe(true)
  })

  it('⛔ WITHOUT the option the frozen rule still holds for every other caller', () => {
    // `history.test.js` owns the frozen default; this proves the option is what moves it.
    const src = H + 'n = input.int(2)\nvar float x = 0.0\nx := x + close\nplot(x[n])\n'
    const frozen = buildRuntimeIr(src, { ...runtimeClockOpts(false), bars: BARS, inputs: { n: 4 } })
    const live = buildRuntimeIr(src, { ...runtimeClockOpts(false), bars: BARS, inputs: { n: 4 }, inputsReachEveryFold: true })
    const depth = (b) => Math.max(...b.ir.history.map((h) => h.depth || h.maxOffset || 0))
    expect(frozen.ok && live.ok).toBe(true)
    expect(depth(live)).toBeGreaterThan(depth(frozen))
  })
})

describe('⭐ the frontend options are opt-in — no other caller\'s build moves', () => {
  const src = H + 'var float c = 0.0\nc := close > open ? c + 1 : c - 1\nplot(c, color = c > 0 ? color.green : color.red)\n'

  it('`plotColours` adds a colour output for the plot, and only when asked', () => {
    const plain = buildRuntimeIr(src, { ...runtimeClockOpts(false), bars: BARS })
    const coloured = buildRuntimeIr(src, { ...runtimeClockOpts(false), bars: BARS, plotColours: true })
    expect(plain.ir.outputs.map((o) => o.call)).toEqual(['plot'])
    expect(coloured.ir.outputs.map((o) => o.call)).toEqual(['plot', 'plotcolor'])
    expect(coloured.ir.outputs[1].of).toBe(0)
  })

  it('every output carries the line its statement stands on', () => {
    const b = buildRuntimeIr(H + 'plot(close)\n\nplot(open)\n', { ...runtimeClockOpts(false), bars: BARS })
    expect(b.ir.outputs.map((o) => o.line)).toEqual([3, 5])
  })

  it('`collectInputs` names the inputs the program READS, bool spelling included', () => {
    // ⚠️ `show ? f(len) : na` folds away at `show = false` and never reads `len` —
    // a measured limit of collecting what the program READS: an input that only a
    // branch dead at the defaults reads is not offered. So `len` is read here
    // unconditionally.
    const s = H + 'len = input.int(14, "Length")\nshow = input(false, "Show")\nunused = input(7)\nplot(ta.sma(close, len) * (show ? 1 : 2))\n'
    const b = buildRuntimeIr(s, { ...runtimeClockOpts(false), bars: BARS, collectInputs: true })
    const byName = new Map(b.inputParams.map((p) => [p.sourceName, p]))
    expect(byName.get('len')).toMatchObject({ type: 'int', default: 14, title: 'Length' })
    expect(byName.get('show')).toMatchObject({ type: 'bool', default: 0 })
    expect(byName.has('unused')).toBe(false)
    expect(buildRuntimeIr(s, { ...runtimeClockOpts(false), bars: BARS }).inputParams).toBeUndefined()
  })
})

describe('⭐ the host lane\'s presentation hand-off (`drawPresentation`)', () => {
  const src = H + 'var float s = 0.0\ns := s + close\nplot(s, "Total", color = color.orange, linewidth = 3)\nplot(close, "Close")\n'

  it('is absent unless asked for', () => {
    const t = translatePine(src, { strict: true })
    for (const o of t.outputs) expect(Object.prototype.hasOwnProperty.call(o, '_drawPresentation')).toBe(false)
  })

  it('rides a REFUSED row and a translated one alike, and never reaches JSON', () => {
    const t = translatePine(src, { strict: true, drawPresentation: true })
    const [refused, ok] = t.outputs
    expect(refused.refusal.guard).toBe('pine:state')
    expect(refused._drawPresentation).toMatchObject({ title: 'Total', presentation: { color: '#FF9800', width: 3 } })
    expect(ok._drawPresentation).toMatchObject({ title: 'Close' })
    expect(JSON.stringify(t.outputs)).not.toContain('_drawPresentation')
    expect(Object.keys(refused)).not.toContain('_drawPresentation')
  })
})

describe('⛔ the install door runs a `pine` document only on an armed build', () => {
  it('refuses it with the "cannot run" sentence when the flag is off, and admits it when on', async () => {
    const { validateUserDefinitions } = await import('../nativeRegistry')
    const doc = {
      schemaVersion: 1, id: 'u_member-pane-install', version: 1,
      compute: { kind: 'pine', fn: 'pine:0000abcd', rev: 1, source: H + 'plot(close)\n',
        columns: { value: { output: 0, call: 'plot', line: 3 } } },
      meta: { name: 'T', shortName: 'T', category: 'Custom', description: '', tags: ['custom'],
        tier: 'premium', repaint: 'non-repainting', freshness: 'live' },
      placement: { target: 'pane', pane: { height: 0.25 } },
      inputs: [],
      plots: [{ key: 'value', label: 'v', style: 'line', color: '#2962FF' }],
    }
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '')
    const off = validateUserDefinitions([doc])
    expect(off.defs).toEqual([])
    expect(off.errors.join('\n')).toMatch(/cannot run it/)
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    const armed = validateUserDefinitions([doc])
    expect(armed.errors).toEqual([])
    expect(armed.defs.map((d) => d.id)).toEqual(['u_member-pane-install'])
  })
})

describe('the schema — a `pine` document', () => {
  const good = () => ({
    schemaVersion: 1,
    id: 'u_member-pane-schema',
    version: 1,
    compute: {
      kind: 'pine', fn: 'pine:0000abcd', rev: 1, source: H + 'plot(close)\n',
      columns: { value: { output: 0, call: 'plot', line: 3 }, out2: { output: 1, call: 'plotcolor', line: 3 } },
      inputs: { pine_len: 'len' },
    },
    meta: { name: 'T', shortName: 'T', category: 'Custom', description: '', tags: ['custom'],
      tier: 'premium', repaint: 'non-repainting', freshness: 'live' },
    placement: { target: 'pane', pane: { height: 0.25 } },
    inputs: [{ key: 'pine_len', type: 'int', label: 'len', default: 14 }],
    plots: [
      { key: 'value', label: 'v', style: 'line', color: '#2962FF', colorMode: 'rgba:out2' },
      { key: 'out2', label: '', style: 'line', color: '#2962FF', hidden: true },
    ],
  })

  it('is well-formed', () => {
    const r = validateDefinition(good())
    expect(r.errors || []).toEqual([])
    expect(r.ok).toBe(true)
  })

  it.each([
    ['no source', (d) => { delete d.compute.source }, 'compute.source'],
    ['no columns', (d) => { d.compute.columns = {} }, 'compute.columns'],
    ['a bad column spec', (d) => { d.compute.columns.value = { output: -1 } }, 'compute.columns.value'],
    ['a negative shift', (d) => { d.compute.columns.value.shift = -2 }, 'shift'],
    ['a plot with no column', (d) => { delete d.compute.columns.out2 }, 'no entry in compute.columns'],
    ['a column with no plot', (d) => { d.compute.columns.out9 = { output: 2, call: 'plot' } }, 'names no data-bearing plot'],
    ['an input key nothing declares', (d) => { d.compute.inputs = { pine_x: 'x' } }, 'compute.inputs.pine_x'],
    ['an rgba colour mode naming no column', (d) => { d.plots[0].colorMode = 'rgba:nope' }, 'references column'],
  ])('refuses %s, by name', (_, mutate, needle) => {
    const d = good()
    mutate(d)
    const r = validateDefinition(d)
    expect(r.ok).toBe(false)
    expect(r.errors.join('\n')).toContain(needle)
  })
})
