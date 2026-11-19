// app/src/components/chart/engine/__tests__/hostFieldRegisterUntraced.test.js
//
// ─── ⭐⭐ FIELD REGISTER, STEP A (2026-11-19, coordinator ruling) — A DRAWING HELD IN A FIELD IS UNTRACED ──────────────
//
// `var z = Z.new(na)` keeps `z` (and its fields) across bars (Pine's `var`: initialised once, keeps its value). The host
// object program registered the field `z.lb` as a plain local and CLEARED it every bar, so `label.delete(z.lb)` read
// `na` and nothing was deleted: the member door served every label the script deleted (26 on these bars where
// TradingView keeps 1), counting nothing. Step A: a field register is untraced, so whatever acts through it is counted
// (`delete:target`, `update:target`) and the drawing is withheld by name.
//
// ─── ⭐⭐ FIELD REGISTER, STEP B (2026-11-19, coordinator ruling) — A FIELD TAKES ITS OWNER'S `var`-NESS ───────────────
//
// Under the ruling's conditions (`pineObjects.js::fieldOwnerVarness`: (i) a top-scope `var o = T.new(…)` / `o = T.new(…)`
// with the field's constructor argument `na` or absent, (a) its declared default `na` or absent, (b) not `varip`, (ii)
// never reassigned, (iii) never used as a value, (iv) no function or method of the script's own called, (c) no history
// read of the field) a field is exactly a handle of its owner's kind, and is served: a `var` owner's field keeps its
// label across bars (Pine's 1 label), a plain owner's starts every bar `na` (Pine's 26). Everything else stays untraced.
// Witnessed twice: Pine by hand on these bars, and the RUNTIME lane (the per-bar Pine VM), bar for bar.
// Product path: source -> memberPaneDefinition (host lane) -> hostObjectRun.
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'

import { memberPaneDefinition, __forceRuntimeLaneForTests } from '../../builder/memberPane/memberPaneDefinition'
import { hostObjectRun, hostObjectReaderOpts } from '../hostObjects'
import * as registry from '../nativeRegistry'
import { runtimeObjectsOf } from '../runtime/runtimeObjects'
import { computeRuntimeColumns } from '../runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from '../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../runtimeKill'

afterEach(() => { vi.unstubAllEnvs() })

const BARS = Array.from({ length: 40 }, (_, i) => {
  const o = 100 + i
  const c = i % 3 === 0 ? o - 1 : o + 1
  return { t: 1700000000 + i * 86400, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1 }
})
const UPS = BARS.filter((b) => b.c > b.o).length
const H = '//@version=6\nindicator("p", overlay = true)\n'
const T = `${H}type Z\n    label lb\n`
const UP = '\nif close > open\n'
const BODY = '    z.lb.delete()\n    z.lb := label.new(bar_index, high, "u")\n'

function served(source, id, bars = BARS) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const d = memberPaneDefinition({ source, id, name: 'field' })
  if (!d.ok || !d.definition.objects) return { ok: false, reason: d.reason || '' }
  const out = hostObjectRun(d.definition, bars, hostObjectReaderOpts({ tf: 'D', historyFromListing: true }))
  return { ok: true, live: out.run.live.length, objects: out.run.live }
}
const REMOVES = /removes drawings as it runs/

// ─── STEP B: SERVED, with Pine's labels ──────────────────────────────────────────────────────────────────────────────
// Pine by hand: a `var` owner keeps its field, so each up bar deletes the previous label: 1 label left (bar 38's). A
// plain owner is a new object every bar (its field `na`): nothing is deleted, every up bar's label stays.
const SERVED = {
  'the function form `label.delete(z.lb)` on a `var` owner (it drew 26 labels where Pine keeps 1)':
    { src: `${T}var z = Z.new(na)${UP}    label.delete(z.lb)\n    z.lb := label.new(bar_index, high, "u")\n`, pine: 1 },
  'the method form `z.lb.delete()` on a `var` owner': { src: `${T}var z = Z.new(na)${UP}${BODY}`, pine: 1 },
  'a nested field `z.a.lb` (each object on the path made by its own constructor)': {
    src: `${H}type A\n    label lb\ntype Z\n    A a\nvar z = Z.new(A.new(na))${UP}    label.delete(z.a.lb)\n`
      + '    z.a.lb := label.new(bar_index, high, "u")\n',
    pine: 1,
  },
  'a PLAIN owner `z = Z.new(na)`: a new object every bar, every up bar\'s label stays': { src: `${T}z = Z.new(na)${UP}${BODY}`, pine: UPS },
  'the typed spelling `var Z z = Z.new(na)`': { src: `${T}var Z z = Z.new(na)${UP}${BODY}`, pine: 1 },
  'a named argument `Z.new(lb = na)`': { src: `${T}var z = Z.new(lb = na)${UP}${BODY}`, pine: 1 },
  'no argument `Z.new()`': { src: `${T}var z = Z.new()${UP}${BODY}`, pine: 1 },
}
// served too, witnessed by the runtime lane alone (below)
const SERVED_RUNTIME = {
  'a setter on every bar through the field (`z.lb.set_text(…)`)': `${T}var z = Z.new(na)${UP}${BODY}z.lb.set_text(str.tostring(bar_index))\n`,
  'the delete inside a loop': `${T}var z = Z.new(na)${UP}    for i = 0 to 0\n        label.delete(z.lb)\n    z.lb := label.new(bar_index, high, "u")\n`,
  'a delete on other bars than the create': `${T}var z = Z.new(na)${UP}    z.lb := label.new(bar_index, high, "u")\nif bar_index % 4 == 0\n    label.delete(z.lb)\n`,
  'the handle emptied (`z.lb := na`) between creates': `${T}var z = Z.new(na)${UP}${BODY}if bar_index % 5 == 0\n    z.lb := na\n`,
}

describe('Step B: a field of a top-level owner takes the owner\'s `var`-ness, served with Pine\'s labels', () => {
  for (const [what, { src, pine }] of Object.entries(SERVED)) {
    it(what, () => {
      const got = served(src, 'u_fr_b')
      expect(got.ok, got.reason).toBe(true)
      expect(got.live).toBe(pine)
    })
  }
  it('the last up bar\'s label is the one a `var` owner keeps (bar 38, at its high)', () => {
    const got = served(SERVED['the method form `z.lb.delete()` on a `var` owner'].src, 'u_fr_b_which')
    expect(got.ok, got.reason).toBe(true)
    expect(got.objects.map((o) => o.props)).toEqual([{ x: 38, y: BARS[38].h, text: 'u' }])
  })
  it('CONTROL: a plain `var` handle is a register as before, served with the one label Pine keeps', () => {
    const got = served(`${H}var label lb = na${UP}    label.delete(lb)\n    lb := label.new(bar_index, high, "u")\n`, 'u_fr_ctl')
    expect(got.ok, got.reason).toBe(true)
    expect(got.live).toBe(1)
  })
})

// ─── STEP B: HOST LANE == RUNTIME LANE, BAR FOR BAR ──────────────────────────────────────────────────────────────────
// For every shape Step B serves, the host lane's labels at the close of EVERY bar (each prefix of the bars, run whole)
// equal the runtime lane's: the per-bar Pine VM, which keeps the object and its fields as Pine does.
describe('Step B parity: for every shape it serves, the host lane draws what the runtime lane draws, bar for bar', () => {
  beforeAll(() => { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() })
  afterAll(() => { __forceRuntimeLaneForTests(false); __resetRuntimeAllowList() })
  const picture = (live) => live.filter((o) => o.family === 'label')
    .map((o) => JSON.stringify({ createdBar: o.createdBar, props: Object.fromEntries(Object.entries(o.props).sort()) })).sort()
  function runtimeLabels(source, bars) {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    __forceRuntimeLaneForTests(true)
    try {
      const d = memberPaneDefinition({ source, id: 'u_fr_rt', name: 'field-rt' })
      if (!d.ok || d.definition.compute.kind !== 'runtime') return { ok: false, reason: d.reason || d.definition.compute.kind }
      const { installed, errors } = registry.installUserDefinitions([d.definition])
      if (!installed[0]) return { ok: false, reason: errors.join(' | ') }
      try {
        const ro = runtimeObjectsOf(computeRuntimeColumns(installed[0], bars, { tf: 'D', newestBarIsForming: false, historyFromListing: true }))
        return ro ? { ok: true, labels: picture(ro.live) } : { ok: false, reason: 'no run objects' }
      } finally { registry.uninstallUserDefinition(installed[0].id) }
    } finally { __forceRuntimeLaneForTests(false); vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '') }
  }
  const shapes = { ...Object.fromEntries(Object.entries(SERVED).map(([k, v]) => [k, v.src])), ...SERVED_RUNTIME }
  for (const [what, src] of Object.entries(shapes)) {
    it(what, () => {
      let compared = 0
      let drawn = 0
      for (let n = 1; n <= BARS.length; n += 1) {
        const bars = BARS.slice(0, n)
        const host = served(src, 'u_fr_par', bars)
        expect(host.ok, `bar ${n - 1}: ${host.reason}`).toBe(true)
        const rt = runtimeLabels(src, bars)
        expect(rt.ok, `bar ${n - 1}: ${rt.reason}`).toBe(true)
        expect(picture(host.objects), `bar ${n - 1}`).toEqual(rt.labels)
        compared += 1
        drawn += rt.labels.length
      }
      expect(compared).toBe(BARS.length)
      expect(drawn, 'a parity of two empty pictures proves nothing').toBeGreaterThan(0)
    })
  }
})

// ─── STEP B: EACH DISQUALIFIER LEAVES THE FIELD UNTRACED, WITHHELD BY NAME ───────────────────────────────────────────
describe('Step B: a field whose owner fails a condition stays untraced, withheld by name', () => {
  const WITHHELD = {
    '(i) the owner declared inside a block, not the literal top scope':
      `${T}if bar_index >= 0\n    var z = Z.new(na)\n    if close > open\n        z.lb.delete()\n        z.lb := label.new(bar_index, high, "u")\n`,
    '(i) the field\'s constructor argument is not `na`':
      `${T}var label first = label.new(bar_index, low, "s")\nvar z = Z.new(first)${UP}${BODY}`,
    '(a) the field\'s declared default is not `na` (whether Pine accepts it or not, the guard holds)':
      `${H}type Z\n    label lb = label.new(0, 0, "d")\nvar z = Z.new()${UP}${BODY}`,
    '(b) a `varip` owner': `${T}varip z = Z.new(na)${UP}${BODY}`,
    '(ii) the owner reassigned (`z := Z.new(na)`)': `${T}var z = Z.new(na)${UP}${BODY}if bar_index == 20\n    z := Z.new(na)\n`,
    '(iii) the owner used as a value: an alias `a = z`': `${T}var z = Z.new(na)\na = z${UP}${BODY}`,
    '(iii) the owner used as a value: an argument `zs.push(z)`': `${T}var z = Z.new(na)\nvar zs = array.new<Z>()\nzs.push(z)${UP}${BODY}`,
    '(iii) the owner used as a value: its copy `z.copy()`': `${T}var z = Z.new(na)\nc = z.copy()${UP}${BODY}`,
    '(iv) a function of the script\'s own called': `${T}f() => close > open\nvar z = Z.new(na)\nif f()\n${BODY}`,
    '(iv) a method of the script\'s own called (on a value, not on the owner)':
      `${T}method twice(float x) => x * 2\nvar z = Z.new(na)\nv = close.twice()${UP}${BODY}`,
    '(c) a history-indexed read of the field `z.lb[1]`':
      `${T}var z = Z.new(na)${UP}    label.delete(z.lb[1])\n    z.lb := label.new(bar_index, high, "u")\n`,
    'a write to the field this program does not carry (`z.lb := spare`)':
      `${T}var label spare = na\nvar z = Z.new(na)${UP}${BODY}if bar_index == 30\n    z.lb := spare\n`,
  }
  for (const [what, src] of Object.entries(WITHHELD)) {
    it(what, () => {
      const got = served(src, 'u_fr_b_ctl')
      expect(got.ok, `served ${got.live} labels`).toBe(false)
      expect(got.reason).toMatch(REMOVES)
    })
  }
})

// ─── ⭐⭐ STEP A (b) — A FIELD WRITTEN BEFORE IT IS READ, IN THE SAME BAR, KEEPS ITS REGISTER ─────────────────────────
//
// Coordinator ruling (b), 2026-11-19: the per-bar clear of a field register is only OBSERVED by a read that runs before
// the bar writes the field. A field whose every read follows an unconditional write of it, earlier in the same
// statement list or an enclosing one, keeps its register (`pineObjects.js::dominatedFields`), so a correct picture is
// never taken away: `z.b := box.new(…)` then `box.set_bgcolor(z.b, color.red)` draws Pine's red box on every up bar
// (`ast/methodForm.test.js` G pins the ops). Anything the tokens cannot prove stays untraced, withheld by name.
const ZH = `${H}type Z\n    label lb\nvar z = Z.new(na)\n`
function liveProps(source, id) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const d = memberPaneDefinition({ source, id, name: 'field' })
  if (!d.ok || !d.definition.objects) return { ok: false, reason: d.reason || '' }
  const out = hostObjectRun(d.definition, BARS, hostObjectReaderOpts({ tf: 'D', historyFromListing: true }))
  return { ok: true, live: out.run.live }
}

describe('Step A (b): a field read after a write of it in the same bar keeps its register', () => {
  it('`z.b := box.new(…)` then `box.set_bgcolor(z.b, color.red)`: every up bar\'s box is drawn, red', () => {
    const src = `${H}type Zone\n    box b\nvar Zone z = Zone.new(na)${UP}    z.b := box.new(bar_index - 2, high, bar_index, low)\n`
      + '    box.set_bgcolor(z.b, color.red)\n'
    const got = liveProps(src, 'u_fr_dom_box')
    expect(got.ok, got.reason).toBe(true)
    expect(got.live.length).toBe(UPS)
    // the colour `box.set_bgcolor(…, color.red)` paints, read off the same program on a plain `var` handle
    const ctl = liveProps(`${H}var box b = na${UP}    b := box.new(bar_index - 2, high, bar_index, low)\n    box.set_bgcolor(b, color.red)\n`, 'u_fr_dom_ctl')
    expect(ctl.ok, ctl.reason).toBe(true)
    const red = ctl.live[0] && ctl.live[0].props.bgcolor
    expect(red).toBeTruthy()
    expect(got.live.every((o) => o.props.bgcolor === red), JSON.stringify(got.live.map((o) => o.props.bgcolor))).toBe(true)
  })
  it('the method form `z.lb.set_text("x")` after `z.lb := label.new(…)`: served with its text', () => {
    const got = liveProps(`${ZH}if close > open\n    z.lb := label.new(bar_index, high, "u")\n    z.lb.set_text("x")\n`, 'u_fr_dom_m')
    expect(got.ok, got.reason).toBe(true)
    expect(got.live.length).toBeGreaterThan(0)
    expect(got.live.every((o) => o.props.text === 'x')).toBe(true)
  })
})

// ⭐ Step B serves several of these shapes on a `var` owner (its register is then a `var` handle's, and the parity rail
// above witnesses it). These rails are about (b) ALONE, so their owner is `varip`, which Step B never serves ((b) of the
// Step B ruling): only a proof of domination could keep its field's register, and none of these has one.
const ZVIP = `${H}type Z\n    label lb\nvarip z = Z.new(na)\n`
describe('Step A (b): a read the tokens cannot prove follows a write stays untraced, withheld by name', () => {
  const UNPROVABLE = {
    'the write inside an `if`, the read after it':
      `${ZVIP}if close > open\n    z.lb := label.new(bar_index, high, "u")\nlabel.delete(z.lb)\n`,
    'the read inside a loop':
      `${ZVIP}if close > open\n    z.lb := label.new(bar_index, high, "u")\n    for i = 0 to 0\n        label.delete(z.lb)\n`,
    'the write inside a loop, the read after it':
      `${ZVIP}if close > open\n    for i = 0 to 0\n        z.lb := label.new(bar_index, high, "u")\n    label.delete(z.lb)\n`,
    'a function of the script\'s own called between the write and the read':
      `${H}type Z\n    label lb\nvarip z = Z.new(na)\nf() => close > open\nif close > open\n    z.lb := label.new(bar_index, high, "u")\n    f()\n    label.delete(z.lb)\n`,
    'a method of the script\'s own called between the write and the read':
      `${H}type Z\n    label lb\nmethod touch(Z this) => this.lb\nvarip z = Z.new(na)\nif close > open\n    z.lb := label.new(bar_index, high, "u")\n    z.touch()\n    label.delete(z.lb)\n`,
    'the owner reassigned between the write and the read':
      `${ZVIP}if close > open\n    z.lb := label.new(bar_index, high, "u")\n    z := Z.new(na)\n    label.delete(z.lb)\n`,
    'the owner used as a value (an alias)':
      `${ZVIP}a = z\nif close > open\n    z.lb := label.new(bar_index, high, "u")\n    label.delete(a.lb)\n    label.delete(z.lb)\n`,
  }
  for (const [what, src] of Object.entries(UNPROVABLE)) {
    it(what, () => {
      const got = served(src, 'u_fr_unprov')
      expect(got.ok, `served ${got.live} labels`).toBe(false)
      expect(got.reason).toMatch(REMOVES)
    })
  }
})
