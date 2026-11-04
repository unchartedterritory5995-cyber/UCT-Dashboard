// app/src/components/chart/engine/runtime/__tests__/objectDoorGate.test.js
//
// ⭐⭐⭐ THE OBJECT DOOR GATE (Phase 3 production audit, 2026-11-01).
//
// The C18 object runtime is LIVE for members with no runtime flag: `memberPaneDefinition`
// probes every translation with `runtimeColumns.js::probeObjectRuntime`, and a drawing script's
// values are read through `runtimeObjectValues` and drawn. Both build through
// `pineRuntimeFrontend.js::buildRuntimeIr` with `opts.objectDoor = true`, and every capability
// Phase 3 added after master 685b5e91d7 (WS-B's builtins over state, the clock calls, tuple
// built-ins, the int/float cast; WS-D's input kinds) asks `objectDoorRefuses` / `atObjectDoor`
// first, so the door builds exactly what master built. The dark runtime pane never sets it.
//
// This rail holds both halves on the audit's own probe shapes, over the RDDT 1D capture from its
// listing:
//   · THE DOOR: through memberPaneDefinition → objectReaderFor → evaluateObjects, each shape is
//     answered as master 685b5e91d7 answers it (pinned from the auditor's instrument run on
//     master: refused, no label drawn);
//   · THE PANE: the same value, plotted, IS built on the runtime-pane path;
//   · THE GATE: the same pane build with `objectDoor: true` refuses by name where the shape is a
//     new lowering (`runtime:object-door`).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { toRenderState } from '../../objectRenderState'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'

const REPO = path.resolve(process.cwd(), '..')
const CAP = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/vendor/harness/vw-call-site-history-rddt-1d-2026-10-01.json'), 'utf8'))
const BARS = CAP.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' }

afterEach(() => { vi.unstubAllEnvs() })

const H = '//@version=6\nindicator("P", overlay = true)\n'
const STATE = 'k = 0\nfor i = 0 to 1\n    k += 1\n'
const label = (expr) => `if barstate.islast\n    label.new(bar_index, high, str.tostring(${expr}))\n`

// name → [body computing `v` over runtime state, does the gate refuse it BY NAME at the door]
// (`false`: the WS-B change is a widened path, so the door falls back to master's arms, which
// refuse it with master's own reason.)
const SHAPES = {
  rsi: ['x = close * 2 - open + k * 0\nv = ta.rsi(x, 14)\n', true],
  hma: ['x = close * 2 - open + k * 0\nv = ta.hma(x, 9)\n', true],
  bb: ['x = close + k * 0\n[mid, v, lo] = ta.bb(x, 20, 2)\n', false],
  clock: ['t = time + k * 0\nv = dayofweek(t)\n', false],
  cast: ['x = close * 2 + k * 0\nv = int(math.max(1, nz(x)))\n', true],
  // ⭐ WS-D constant-var folding (gate review MEDIUM): an input default read from a `var`
  // nothing reassigns. Master refuses it (`runtime:input-state`); without the door gate on
  // `inputConsts` the door drew "146.05" / "299.06" here (reviewer's probes, RDDT 1D).
  cv_int: ['', false, 'var int LEN = 5\nlen = input.int(LEN, "L")\n', 'v = ta.sma(close, len) + k * 0\n'],
  cv_float: ['', false, 'var float M = 2.0\nm = input.float(M, "M")\n', 'v = close * m + k * 0\n'],
}
// [body, named] or ['', named, prelude (before the state loop), body]
const sourceOf = (shape, tail) => {
  const [body, , prelude = '', after = ''] = shape
  return H + prelude + STATE + body + after + tail
}

const doorRun = (src, bars = BARS, symbol = SYMBOL) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
  const built = memberPaneDefinition({ source: src, id: 'u_object-door-gate', name: 'P' })
  if (!built.ok) return { ok: false, labels: null }
  const def = built.definition
  const reader = objectReaderFor(def, bars, { inputs: undefined, tf: 'D', symbol,
    newestBarIsForming: false, historyFromListing: true })
  const run = evaluateObjects(reader.program, { barCount: bars.length, readNode: reader.readNode,
    readTime: reader.readTime, readUnknown: reader.readUnknown, offListing: reader.historyFromListing !== true })
  const state = toRenderState(run.live, { bars, tf: 'D', pineVersion: reader.program.pineVersion })
  return { ok: true, labels: (state.labels || []).map((l) => l.text) }
}

const paneBuild = (src, extra = {}) => buildRuntimeIr(src, {
  bars: BARS, inputs: {}, pane: true, basePeriod: 'D', tf: 'D', symbol: SYMBOL, ...runtimeClockOpts(false), ...extra,
})

describe('⭐⭐⭐ the object door builds what master 685b5e91d7 builds; the runtime pane keeps Phase 3', () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    const named = shape[1]
    it(`${name}: the door draws nothing new (master: refused, no label)`, () => {
      expect(doorRun(sourceOf(shape, label('v')))).toEqual({ ok: false, labels: null })
    })

    it(`${name}: the runtime pane builds it`, () => {
      const b = paneBuild(sourceOf(shape, 'plot(v)\n'))
      expect(b.ok, b.refusal && `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
    })

    it(`${name}: the same build at the object door ${named ? 'refuses BY NAME' : 'falls back to master'}`, () => {
      const b = paneBuild(sourceOf(shape, 'plot(v)\n'), { objectDoor: true })
      expect(b.ok).toBe(false)
      if (named) {
        expect(b.refusal.guard).toBe('runtime:object-door')
        expect(b.refusal.message).toMatch(/runtime pane only/)
      } else {
        expect(b.refusal.guard).not.toBe('runtime:object-door')
      }
    })
  }

  it('⭐ a check only the RUN can make keeps master\'s answer at the door too (runtimeObjectValues)', () => {
    // `time("W")` over state on BITSTAMP:BTCUSD daily bars. The compile check (no bars) passes in
    // both trees; with bars, the pane's WS-B clock sink declines it (`runtime:chart-clock`),
    // while master 685b5e91d7 serves it through the door and draws "1790640000000" (measured on
    // master with the auditor's instrument shape). The door must still draw master's label, so
    // this fails if `runtimeObjectValues` stops building at the door or the sink reaches it.
    const btcCap = JSON.parse(fs.readFileSync(
      path.join(REPO, 'tests/fixtures/vendor/harness/vw-time-tf-bitstamp-btcusd-1d-2026-09-30.json'), 'utf8'))
    const bars = btcCap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
    const sym = { ticker: 'BTCUSD', exchange: 'BITSTAMP' }
    const body = 'v = time("W") + k * 0\n'
    expect(doorRun(H + STATE + body + label('v'), bars, sym)).toEqual({ ok: true, labels: ['1790640000000'] })
    const pane = paneBuild(H + STATE + body + 'plot(v)\n', { bars, symbol: sym })
    expect(pane.ok).toBe(false)
    expect(pane.refusal.guard).toBe('runtime:chart-clock')
  })

  it('⛔ CONTROL — a shape master already served draws the same label through the door', () => {
    // `str.length(input.session(…))` over state: master drew "9" (the auditor's probe); the gate
    // keeps it, so the rail cannot pass by refusing everything at the door.
    const src = H + 'ss = input.session("0930-1600", "S")\n' + STATE + 'v = str.length(ss) + k * 0\n' + label('v')
    expect(doorRun(src)).toEqual({ ok: true, labels: ['9'] })
  })
})
