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
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const REPO = path.resolve(process.cwd(), '..')
const CAP = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/vendor/harness/vw-call-site-history-rddt-1d-2026-10-01.json'), 'utf8'))
const BARS = CAP.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' }
const T9_SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

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
  // ⭐ W4 T10 — the state kernels are pane-only; the door answers what master answered
  // (`runtime:call-windowed-state`), the `false` flavour.
  t10_cum: ['x = close + k * 0\nv = ta.cum(x)\n', false],
  t10_pivot: ['x = high + k * 0\nv = ta.pivothigh(x, 3, 3)\n', false],
  t10_stoch: ['x = close + k * 0\nv = ta.stoch(x, high, low, 14)\n', false],
  t10_vwap: ['x = close + k * 0\nv = ta.vwap(x)\n', false],
  cv_int: ['', false, 'var int LEN = 5\nlen = input.int(LEN, "L")\n', 'v = ta.sma(close, len) + k * 0\n'],
  cv_float: ['', false, 'var float M = 2.0\nm = input.float(M, "M")\n', 'v = close * m + k * 0\n'],
  // ⭐ W4 T4 — a `?:` arm with per-call-site history (`ta.sma` in the arm taken when the
  // test reads state). A widened predicate (`armHistoryGuard`), so the door keeps master's
  // own refusal (`runtime:conditional-history`).
  arm_sma: ['x = close + k * 0\nv = x > open ? ta.sma(close, 5) : close\n', false],
  arm_change: ['x = close + k * 0\nv = x > open ? ta.change(close) : 0.0\n', false],
  // W4 T3: a session / timeframe text fixed before bar 0 (the chart's own timeframe through a
  // parameter, two texts joined with `+`, a `var` nothing reassigns). Widened predicates: the door
  // falls back to master's arms, which refuse a session clock whose arguments are not literals.
  sess_ownTf: ['', false, 'inS(r, s) => not na(time(r, s))\n', 'v = (inS(timeframe.period, "0930-1600:23456") ? 1 : 0) + k * 0\n'],
  sess_join: ['', false, 'inS(s) => not na(time(timeframe.period, s + ":23456"))\n', 'v = (inS("0930-1600") ? 1 : 0) + k * 0\n'],
  sess_var: ['', false, 'var string SESS = "0930-1600:23456"\n', 'v = (not na(time(timeframe.period, SESS)) ? 1 : 0) + k * 0\n'],
  // The same join as the argument of a C47 `switch` over a parameter: the door keeps master's refusal
  // (`runtime:block-value`), the pane picks the arm the joined text selects.
  sw_join: ['', false, 'ma(src, m) =>\n    switch m\n        "WMA" => ta.wma(src, 3)\n        "HMA" => ta.hma(src, 3)\n        => ta.sma(src, 3)\n', 'v = ma(close + k * 0, "W" + "MA")\n'],
  // ⭐ W4-T2 `simple` folding (a widened fold, so the door keeps master's refusal): a
  // reassignment under an invariant test, a never-reassigned `var`, arithmetic over an input.
  t2_if: ['', false, 'len = 10\nif timeframe.isintraday\n    len := 5\n', 'v = ta.sma(close + k * 0, len)\n'],
  t2_var: ['', false, 'var L = 7\n', 'v = ta.sma(close + k * 0, L)\n'],
  t2_arith: ['', false, 'n = input.int(4, "N")\n', 'v = ta.sma(close + k * 0, n + 2)\n'],
  // W4-T9 a frame local derived from a parameter bounds a loop's offset (a widened fold,
  // so the door keeps master's refusal).
  t9_local: ['', false, 'f(src, length) =>\n    periods = length - 1\n    s = 0.0\n    for j = 0 to periods\n        s += src[j]\n    s / length\n', 'v = f(close + k * 0, 3)\n'],
  // ⭐ W6-T6 — `for … in` (a new lowering on the runtime lane; the host object lane serves it
  // for drawing scripts): the door refuses it BY NAME until measure-pair proves the door's
  // output identical. Over a number list, a list its body pushes onto (the LIVE walk), and a
  // record list read through `x.f`.
  forin_sum: ['a = array.from(close, open)\ns = 0.0\nfor x in a\n    s += x\nv = s + k * 0\n', true],
  forin_live: ['a = array.from(close)\nn = 0\nfor [i, x] in a\n    if i < 3\n        array.push(a, x)\n    n += 1\nv = n + k * 0\n', true],
  // ⭐ W34-I6a — a `switch` arm wrapped onto a continuation line (indent not a multiple of
  // four). The pane joins it into one expression; the door does not join, so master's arm
  // check still sees a block under the arm and refuses BY NAME ("a value arm that ends in a
  // block … runtime pane only"), as master did.
  sw_wrap: ['m = bar_index % 2\nv = switch m\n    0 => close + k * 0\n     + open\n    => close - open\n', true],
  sw_wrap_nested: ['', true, 'f(c) =>\n    r = if c\n        close\n    else if not c\n        switch bar_index % 2\n            0 => close\n             + open\n            => high\n    else\n        low\n    r\n',
    'v = f(close > open) + k * 0\n'],
  forin_udt: ['', true, 'type P\n    float p\nvar ps = array.new<P>()\nif barstate.isfirst\n    array.push(ps, P.new(2))\n',
    's = 0.0\nfor q in ps\n    s += q.p\nv = s + close * 0 + k * 0\n'],
  // ⭐ W6-T9 — receiver types (overloads by receiver type, a chain off an element, a member on a
  // field's array). A widened dispatch (`receiverTypesServed`), so the door keeps master's own
  // refusals (`runtime:udt-method`, `pine:member`, `runtime:expression-statement`).
  t9_overload: ['', false, 'type A\n    float a = 1\ntype B\n    float b = 2\nmethod m(A x) =>\n    x.a\nmethod m(B x) =>\n    x.b\n',
    'v = A.new(close + k * 0).m() + B.new(2).m()\n'],
  t9_chain: ['', false, 'type Z\n    float s = 0\nvar zs = array.new<Z>()\nzs.push(Z.new(close))\n',
    'cp = zs.copy()\nv = cp.get(0).s + k * 0\n'],
  t9_field_coll: ['', false, 'type T\n    array<float> c\nvar t = T.new(array.new<float>())\n',
    't.c.unshift(close + k * 0)\nv = t.c.size() + k * 0\n'],
  // W6-T10: an `enum` and a comparison of its fields over state. No enum arm exists at the
  // door (the registry is empty there), so the door keeps master's own refusal of the line.
  enum_eq: ['', false, 'enum E\n    a\n    b = "B"\n', 'm = close + k * 0 > open ? E.a : E.b\nv = m == E.a ? 1 : 0\n'],
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

// ⭐⭐ W4-T11 — the text builtins added after master 685b5e91d7 (str.substring, str.replace,
// str.tonumber, str.pos, str.format_time) ask `objectDoorRefuses` first, like every capability
// since. Over a MUTATING text (the runtime shape), the door keeps master's answer (refused, no
// label), the pane serves it, and the same pane build at the door refuses BY NAME. The control
// is `str.length` over the same text: master served it, the door still builds it.
describe('⭐⭐ W4-T11 text builtins are gated at the object door', () => {
  const TXT = 'string s = "!none"\nstring z = "!none"\nif close > open\n    s := "abcdef"\n    z := "12"\n'
  // name -> [a NUMBER over the text (plotted on the pane), the label text for the door run]
  const SHAPES_T = {
    substring: ['str.length(str.substring(s, 1, 3))', 'str.substring(s, 1, 3)'],
    substring2: ['str.length(str.substring(s, 1))', 'str.substring(s, 1)'],
    replace: ['str.length(str.replace(s, "b", "XX"))', 'str.replace(s, "b", "XX")'],
    replace4: ['str.length(str.replace(s, "b", "XX", 0))', 'str.replace(s, "b", "XX", 0)'],
    tonumber: ['str.tonumber(z)', 'str.tostring(str.tonumber(z))'],
    pos: ['str.pos(s, "c")', 'str.tostring(str.pos(s, "c"))'],
    format_time: ['str.format_time(1709985600000, "yyyy") == "2024" ? 1 : 0', 'str.format_time(1709985600000, "yyyy")'],
  }
  const asLabel = (expr) => H + TXT + 'if barstate.islast\n    label.new(bar_index, high, ' + expr + ')\n'
  const asPlot = (expr) => H + TXT + 'plot(' + expr + ')\n'
  for (const [name, [num, txt]] of Object.entries(SHAPES_T)) {
    it(`${name}: the door draws nothing new (master: refused, no label)`, () => {
      expect(doorRun(asLabel(txt))).toEqual({ ok: false, labels: null })
    })
    it(`${name}: the runtime pane builds it`, () => {
      const b = paneBuild(asPlot(num))
      expect(b.ok, b.refusal && `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
    })
    it(`${name}: the same build at the object door refuses BY NAME`, () => {
      const b = paneBuild(asPlot(num), { objectDoor: true })
      expect(b.ok).toBe(false)
      expect(b.refusal.guard).toBe('runtime:object-door')
      expect(b.refusal.message).toMatch(/runtime pane only/)
    })
  }
  it('CONTROL: str.length over the same text is master\'s and builds at the door', () => {
    const b = paneBuild(H + TXT + 'plot(str.length(s))\n', { objectDoor: true })
    expect(b.ok, b.refusal && `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
  })
})

// ⭐⭐ W6-T5 — the `array.*` members served after master c04bdbe2c1 (the W19-R2 port and the
// reference-formula members) are NOT held at the door (`pineRuntimeFrontend.js::heldArray`,
// the `false` flavour above): the same pane build at the door refuses with MASTER'S OWN guard
// and sentence (`runtime:array`, naming the member), the pane builds it, and the door draws
// exactly what master drew. measure-pair's C18 audit then shows the door byte-identical. MASTER_DOOR is pinned from master c04bdbe2c1 (this
// file's `doorRun`, run in a master worktree, 2026-11-06). ⚠️ Three of master's answers are
// the HOST object lane's, not this runtime's: for `fill`, `reverse` and `sort` it draws the
// label from the array as built, without the write (`586.915` is o+h+l+c, `144.14` is the
// open). That is master's live behaviour, pinned here so this lane cannot move it; it is
// reported in the W6-T5 evidence, not changed here.
// `array.median` / `array.stdev` were already BUILT by master at the door, so they are not
// gated at build; the door's run keeps master's answer (`collections.js::MASTER_AT_DOOR`),
// which `w6ArrayMembers.test.js` and `c18WhileAndLastBar.test.js` pin at the run level.
describe('⭐⭐ W6-T5 array members are gated at the object door', () => {
  const ARR = 'a = array.from(open, high, low, close)\nb = array.from(close, open, high, low)\n'
  const REFUSED = { ok: false, labels: null }
  const SHAPES_A = {
    fill: ['array.fill(a, close, 1, 3)\nv = array.sum(a)\n', { ok: true, labels: ['586.915'] }],
    insert: ['array.insert(a, 1, close)\nv = array.size(a) + array.get(a, 1)\n', REFUSED],
    reverse: ['array.reverse(a)\nv = array.get(a, 0)\n', { ok: true, labels: ['144.14'] }],
    lastindexof: ['v = array.lastindexof(a, close)\n', REFUSED],
    range: ['v = array.range(a)\n', REFUSED],
    abs: ['v = array.sum(array.abs(a))\n', REFUSED],
    join: ['s = array.from("x", "yz")\nv = str.length(array.join(s, "-"))\n', REFUSED],
    variance: ['v = array.variance(a)\n', REFUSED],
    covariance: ['v = array.covariance(a, b)\n', REFUSED],
    percentile_nearest_rank: ['v = array.percentile_nearest_rank(a, 50)\n', REFUSED],
    sort: ['array.sort(a)\nv = array.get(a, 0)\n', { ok: true, labels: ['144.14'] }],
    every: ['v = array.every(a) ? 1 : 0\n', REFUSED],
    some: ['v = array.some(a) ? 1 : 0\n', REFUSED],
  }
  for (const [name, [body, master]] of Object.entries(SHAPES_A)) {
    it(`${name}: the door draws what master drew`, () => {
      expect(doorRun(H + ARR + body + label('v'))).toEqual(master)
    })
    it(`${name}: the runtime pane builds it`, () => {
      const b = paneBuild(H + ARR + body + 'plot(v)\n')
      expect(b.ok, b.refusal && `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
    })
    it(`${name}: the same build at the object door refuses as master did (runtime:array, by name)`, () => {
      const b = paneBuild(H + ARR + body + 'plot(v)\n', { objectDoor: true })
      expect(b.ok).toBe(false)
      expect(b.refusal.guard).toBe('runtime:array')
      expect(b.refusal.message).toContain(`array.${name}`)
    })
    it(`${name}: the method form at the object door refuses as master did`, () => {
      const m = body.replace(new RegExp(`array\\.${name}\\((\\w+)(, )?`), (_, recv) => `${recv}.${name}(`)
      const b = paneBuild(H + ARR + m + 'plot(v)\n', { objectDoor: true })
      expect(m).not.toBe(body)
      expect(b.ok).toBe(false)
      expect(b.refusal.guard).toBe('runtime:array')
      expect(b.refusal.message).toContain(`array.${name}`)
    })
  }
  it('an UNREAD binding of a gated member refuses at the door where master refused it (holdsArray keeps master\'s answer)', () => {
    // Master counted an unheld `array.*` call as a collection binding, so it lowered the
    // initialiser and refused it even though nothing reads `v`. The pane, which holds the
    // member and knows it returns a number, builds it.
    const src = H + ARR + 'v = array.range(a)\nplot(close)\n'
    const door = paneBuild(src, { objectDoor: true })
    expect(door.ok).toBe(false)
    expect(door.refusal.guard).toBe('runtime:array')
    expect(door.refusal.message).toContain('array.range')
    expect(paneBuild(src).ok).toBe(true)
  })
  for (const name of ['median', 'stdev']) {
    it(`${name}: master built it at the door, and the door still builds it`, () => {
      const b = paneBuild(H + ARR + `v = array.${name}(a)\nplot(v)\n`, { objectDoor: true })
      expect(b.ok, b.refusal && `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
    })
    it(`${name}: the door draws what master drew (elements, empty, over state)`, () => {
      const none = { ok: true, labels: [] }
      expect(doorRun(H + ARR + `v = array.${name}(a)\n` + label('v'))).toEqual(none)
      expect(doorRun(H + `e = array.new_float()\nv = array.${name}(e)\n` + label('v'))).toEqual(none)
      expect(doorRun(H + STATE + 'x = array.from(close + k, open)\n' + `v = array.${name}(x)\n` + label('v'))).toEqual(none)
    })
  }
  it('CONTROL: array.sum over the same array is master\'s and draws through the door', () => {
    expect(doorRun(H + ARR + 'v = array.sum(a)\n' + label('v'))).toEqual({ ok: true, labels: ['586.915'] })
  })
})

// ⭐⭐ W6-T7 — every `matrix.*` member is served after master f9651f47ee and is NOT held at the
// door (`collections.js::DOOR_GATED_ARRAY` lists the whole family; `heldArray` answers false).
// Master refused the family at the door with `runtime:array` naming the FIRST call lowered,
// `matrix.new`, and drew nothing; MASTER_DOOR and the sentence are pinned from master
// f9651f47ee (this file's `doorRun` and `paneBuild`, run with master's four engine sources in
// place, 2026-11-06, `runs/w6-t7/door-master.json`). The pane builds every shape.
describe('⭐⭐ W6-T7 matrix members are gated at the object door', () => {
  const M = 'm = matrix.new<float>(2, 2, close)\nmatrix.set(m, 0, 1, open)\n'
  const MASTER_DOOR = { ok: false, labels: null }
  const MASTER_SENTENCE = 'a collection operation this lane does not implement — `matrix.*`, `map.*` or an '
    + '`array.*` member it lacks — `matrix.new`'
  const SHAPES_M = {
    get: 'v = matrix.get(m, 0, 1)\n',
    rows: 'v = matrix.rows(m)\n',
    columns: 'v = matrix.columns(m)\n',
    elements_count: 'v = matrix.elements_count(m)\n',
    row: 'v = array.get(matrix.row(m, 0), 1)\n',
    col: 'v = array.sum(matrix.col(m, 1))\n',
    add_row: 'matrix.add_row(m, 0, array.from(high, low))\nv = matrix.get(m, 0, 0)\n',
    add_col: 'matrix.add_col(m)\nv = matrix.columns(m)\n',
    remove_row: 'x = matrix.remove_row(m, 0)\nv = array.get(x, 1)\n',
    remove_col: 'x = matrix.remove_col(m, 0)\nv = matrix.columns(m)\n',
    fill: 'matrix.fill(m, high)\nv = matrix.get(m, 1, 1)\n',
    submatrix: 'v = matrix.rows(matrix.submatrix(m, 0, 1))\n',
    copy: 'v = matrix.get(matrix.copy(m), 0, 1)\n',
    min: 'v = matrix.min(m)\n',
    max: 'v = matrix.max(m)\n',
    avg: 'v = matrix.avg(m)\n',
    sum: 'v = matrix.get(matrix.sum(m, 1.5), 0, 0)\n',
    method: 'v = m.rows() + m.get(0, 1)\n',
  }
  for (const [name, body] of Object.entries(SHAPES_M)) {
    it(`${name}: the door draws what master drew (nothing: refused)`, () => {
      expect(doorRun(H + M + body + label('v'))).toEqual(MASTER_DOOR)
    })
    it(`${name}: the runtime pane builds it`, () => {
      const b = paneBuild(H + M + body + 'plot(v)\n')
      expect(b.ok, b.refusal && `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
    })
    it(`${name}: the same build at the object door refuses with master's guard and sentence`, () => {
      const b = paneBuild(H + M + body + 'plot(v)\n', { objectDoor: true })
      expect(b.ok).toBe(false)
      expect(b.refusal.guard).toBe('runtime:array')
      expect(b.refusal.message).toBe(MASTER_SENTENCE)
    })
  }
  it('CONTROL: an array member master held still draws through the door beside the matrix shapes', () => {
    expect(doorRun(H + 'a = array.from(open, high, low, close)\nv = array.sum(a)\n' + label('v')))
      .toEqual({ ok: true, labels: ['586.915'] })
  })
})

describe('W9-T1 the strategy broker is never reachable at the object door', () => {
  const SRC = ['//@version=5', 'strategy("t")', 'if bar_index == 3', '    strategy.entry("L", strategy.long)', 'plot(strategy.position_size)', ''].join(String.fromCharCode(10))
  it('the pane build with the broker on retries and builds; at the door it refuses pine:strategy-call as master does', () => {
    const pane = buildRuntimeIr(SRC, { bars: BARS, inputs: {}, symbol: SYMBOL, strategyBroker: true })
    expect(pane.ok).toBe(true)
    expect(pane.ir.broker).not.toBe(null)
    const door = buildRuntimeIr(SRC, { bars: BARS, inputs: {}, symbol: SYMBOL, strategyBroker: true, objectDoor: true })
    expect(door.ok).toBe(false)
    expect(door.refusal.guard).toBe('pine:strategy-call')
  })
})

// ⭐⭐ W6-T9 — ONE SHAPE PER DOOR SITE (review B1). Each site where W6-T9 changes what is built
// asks `receiverTypesServed` itself, and each is proved here alone: drop that one site's gate and
// the shape below changes at the door. Every answer is master's at the door (pinned 2026-11-06 by
// running master 81a4665a5a's front end on these shapes: refused with the same guard, or the same
// run). The pane serves each of them (`w6ReceiverTypes.test.js`).
describe('⭐⭐ W6-T9 receiver types keep master\'s answer at the object door, site by site', () => {
  const T9H = '//@version=6\nindicator("t")\n'
  const door = (body, extra = {}) => paneBuild(T9H + body, { objectDoor: true, ...extra })
  /** Build at the door and run every bar: the outputs, or the thrown stop. */
  const doorRun = (body, extra = {}) => {
    const b = door(body, extra)
    expect(b.ok, b.ok ? '' : `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
    const program = lowerIrProgram(b.ir, { historyFromListing: true })
    return () => execute(program, { bars: BARS.length, series: T9_SERIES, columns: program.columns,
      confirmed: true, barTimes: BARS.map((x) => x.t) })
  }
  const guardOf = (body, extra = {}) => {
    const b = door(body, extra)
    expect(b.ok, 'expected the door to refuse, as master does').toBe(false)
    return b.refusal
  }
  const FN_B = 'type B\n    float o = 0\nf_rt(float a) =>\n    B.new(a)\n'
  const SHADOW = 'type Foo\n    float x = 0\nmethod clear(Foo f) =>\n    f.x := 0\n    f.x\n'
    + 'var a = array.new_float()\na.push(close)\nif a.size() > 2\n    a.clear()\nplot(a.size())\n'

  it('`memberRecvUdt`: a field read off a function\'s result (`f_rt(close).o`) refuses `pine:member`', () => {
    expect(guardOf(`${FN_B}plot(f_rt(close).o)\n`).guard).toBe('pine:member')
  })
  it('`overloadRefusal`: two overloads on two record types refuse with master\'s sentence', () => {
    const r = guardOf('type A\n    float a = 1\ntype C\n    float c = 2\nmethod m(A x) =>\n    x.a\nmethod m(C x) =>\n    x.c\n'
      + 'plot(A.new().m() + C.new().m())\n')
    expect(r.guard).toBe('runtime:udt-method')
    expect(r.message).toMatch(/which this lane does not resolve/)
  })
  it('`isReceiverCall`: a drawing member read off an element refuses `pine:member` (the run draws)', () => {
    expect(guardOf('var bx = array.new_box()\nbx.unshift(box.new(bar_index, high, bar_index, low))\nplot(bx.get(0).get_bottom())\n',
      { objectsInRun: true }).guard).toBe('pine:member')
  })
  it('`receiverCallOf`: a collection member on a record\'s field, as a statement, refuses as master', () => {
    expect(guardOf('type T\n    array<float> c\nvar t = T.new(array.new<float>())\nt.c.push(close)\nplot(t.c.size())\n').guard)
      .toBe('runtime:expression-statement')
  })
  it('`receiverInitTy`: a field of a name bound to a function\'s result refuses `pine:builtin`', () => {
    expect(guardOf('type Hb\n    int l = 0\nmk(int a) =>\n    Hb.new(a)\nhb = mk(bar_index)\nplot(hb.l)\n').guard).toBe('pine:builtin')
  })
  it('`userMethodShadows`: master\'s untyped shadowing (`a.clear()` runs the script\'s `clear(Foo)` and stops)', () => {
    expect(doorRun(SHADOW)).toThrow(/user-defined type/)
  })
  it('`methodCallOf`: the same statement keeps master\'s binding of the method form (built, then stops)', () => {
    expect(doorRun(SHADOW.replace('    f.x := 0\n', ''))).toThrow(/user-defined type/)
  })
  it('the call arm: a single method on a record keeps master\'s binding and is SERVED at the door', () => {
    const r = doorRun('type A\n    float a = 1\nmethod m(A x) =>\n    x.a\nv = A.new(close)\nplot(v.m())\n')()
    expect(Array.from(r.outputs[0])).toEqual(BARS.map((b) => b.c))
  })
})

// ⭐⭐ W6-T8 — every `map.*` member is served after master f9651f47ee and is NOT held at the
// door (`collections.js::DOOR_GATED_ARRAY` lists the whole family; `heldArray` answers false).
// The host object lane holds no map either. MASTER_DOOR and MASTER_SENTENCE are pinned from
// master f9651f47ee (this file's `doorRun` and `paneBuild`, run with master's engine sources in
// place, 2026-11-06, `runs/w6-t8/door-master.txt`). The pane builds every shape.
describe('⭐⭐ W6-T8 map members are gated at the object door', () => {
  const MP = 'm = map.new<string, float>()\nm.put("b", close)\nmap.put(m, "a", open)\n'
  const MASTER_DOOR = { ok: false, labels: null }
  const MASTER_SENTENCE = 'a collection operation this lane does not implement — `matrix.*`, `map.*` or an '
    + '`array.*` member it lacks — `map.new`'
  const SHAPES_K = {
    get: 'v = map.get(m, "a")\n',
    size: 'v = map.size(m)\n',
    contains: 'v = map.contains(m, "b") ? 1 : 0\n',
    put: 'v = map.put(m, "b", high)\n',
    remove: 'v = map.remove(m, "a")\n',
    keys: 'v = array.size(map.keys(m))\n',
    values: 'v = array.sum(map.values(m))\n',
    copy: 'v = map.size(map.copy(m))\n',
    clear: 'map.clear(m)\nv = map.size(m)\n',
    put_all: 'm2 = map.new<string, float>()\nmap.put(m2, "z", low)\nmap.put_all(m, m2)\nv = map.size(m)\n',
    method: 'v = m.size() + m.get("b")\n',
  }
  for (const [name, body] of Object.entries(SHAPES_K)) {
    it(`${name}: the door draws what master drew (nothing: refused)`, () => {
      expect(doorRun(H + MP + body + label('v'))).toEqual(MASTER_DOOR)
    })
    it(`${name}: the runtime pane builds it`, () => {
      const b = paneBuild(H + MP + body + 'plot(v)\n')
      expect(b.ok, b.refusal && `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
    })
    it(`${name}: the same build at the object door refuses with master's guard and sentence`, () => {
      const b = paneBuild(H + MP + body + 'plot(v)\n', { objectDoor: true })
      expect(b.ok).toBe(false)
      expect(b.refusal.guard).toBe('runtime:array')
      expect(b.refusal.message).toBe(MASTER_SENTENCE)
    })
  }
  it('CONTROL: an array member master held still draws through the door beside the map shapes', () => {
    expect(doorRun(H + 'a = array.from(open, high, low, close)\nv = array.sum(a)\n' + label('v')))
      .toEqual({ ok: true, labels: ['586.915'] })
  })
})
