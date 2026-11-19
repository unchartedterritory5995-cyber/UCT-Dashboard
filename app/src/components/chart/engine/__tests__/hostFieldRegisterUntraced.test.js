// app/src/components/chart/engine/__tests__/hostFieldRegisterUntraced.test.js
//
// ─── ⭐⭐ FIELD REGISTER, STEP A (2026-11-19, coordinator ruling) — A DRAWING HELD IN A FIELD IS UNTRACED ──────────────
//
// `var z = Z.new(na)` keeps `z` (and its fields) across bars (Pine's `var`: initialised once, keeps its value). The host
// object program registered the field `z.lb` as a plain local and CLEARED it every bar, so `label.delete(z.lb)` read
// `na` and nothing was deleted: the member door served every label the script deleted (26 on these bars where
// TradingView keeps 1), counting nothing. Step A: a field register is untraced, so whatever acts through it is counted
// (`delete:target`, `update:target`) and the drawing is withheld by name. Step B (the field takes its owner's
// `var`-ness) will serve it again. Product path: source -> memberPaneDefinition (host lane) -> hostObjectRun.
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { hostObjectRun, hostObjectReaderOpts } from '../hostObjects'

afterEach(() => { vi.unstubAllEnvs() })

const BARS = Array.from({ length: 40 }, (_, i) => {
  const o = 100 + i
  const c = i % 3 === 0 ? o - 1 : o + 1
  return { t: 1700000000 + i * 86400, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1 }
})
const T = '//@version=6\nindicator("p", overlay = true)\ntype Z\n    label lb\n'
const UP = '\nif close > open\n'

function served(source, id) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const d = memberPaneDefinition({ source, id, name: 'field' })
  if (!d.ok || !d.definition.objects) return { ok: false, reason: d.reason || '' }
  const out = hostObjectRun(d.definition, BARS, hostObjectReaderOpts({ tf: 'D', historyFromListing: true }))
  return { ok: true, live: out.run.live.length }
}
const REMOVES = /removes drawings as it runs/

describe('a drawing held in a field of a `var` object is withheld by name, never drawn with what Pine deleted', () => {
  it('the function form `label.delete(z.lb)` (it drew 26 labels where Pine keeps 1)', () => {
    const got = served(`${T}var z = Z.new(na)${UP}    label.delete(z.lb)\n    z.lb := label.new(bar_index, high, "u")\n`, 'u_fr_fn')
    expect(got.ok).toBe(false)
    expect(got.reason).toMatch(REMOVES)
  })
  it('the method form `z.lb.delete()`', () => {
    const got = served(`${T}var z = Z.new(na)${UP}    z.lb.delete()\n    z.lb := label.new(bar_index, high, "u")\n`, 'u_fr_m')
    expect(got.ok).toBe(false)
    expect(got.reason).toMatch(REMOVES)
  })
  it('a nested field `z.a.lb`', () => {
    const src = '//@version=6\nindicator("p", overlay = true)\ntype A\n    label lb\ntype Z\n    A a\n'
      + `var z = Z.new(A.new(na))${UP}    label.delete(z.a.lb)\n    z.a.lb := label.new(bar_index, high, "u")\n`
    const got = served(src, 'u_fr_n')
    expect(got.ok).toBe(false)
  })
  it('CONTROL: a plain `var` handle is a register as before, served with the one label Pine keeps', () => {
    const got = served(`//@version=6\nindicator("p", overlay = true)\nvar label lb = na${UP}    label.delete(lb)\n    lb := label.new(bar_index, high, "u")\n`, 'u_fr_ctl')
    expect(got.ok, got.reason).toBe(true)
    expect(got.live).toBe(1)
  })
})

// ─── ⭐⭐ STEP A (b) — A FIELD WRITTEN BEFORE IT IS READ, IN THE SAME BAR, KEEPS ITS REGISTER ─────────────────────────
//
// Coordinator ruling (b), 2026-11-19: the per-bar clear of a field register is only OBSERVED by a read that runs before
// the bar writes the field. A field whose every read follows an unconditional write of it, earlier in the same
// statement list or an enclosing one, keeps its register (`pineObjects.js::dominatedFields`), so a correct picture is
// never taken away: `z.b := box.new(…)` then `box.set_bgcolor(z.b, color.red)` draws Pine's red box on every up bar
// (`ast/methodForm.test.js` G pins the ops). Anything the tokens cannot prove stays untraced, withheld by name.
const H = '//@version=6\nindicator("p", overlay = true)\n'
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
    const ups = BARS.filter((b) => b.c > b.o).length
    expect(got.live.length).toBe(ups)
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

describe('Step A (b): a read the tokens cannot prove follows a write stays untraced, withheld by name', () => {
  const UNPROVABLE = {
    'the write inside an `if`, the read after it':
      `${ZH}if close > open\n    z.lb := label.new(bar_index, high, "u")\nlabel.delete(z.lb)\n`,
    'the read inside a loop':
      `${ZH}if close > open\n    z.lb := label.new(bar_index, high, "u")\n    for i = 0 to 0\n        label.delete(z.lb)\n`,
    'the write inside a loop, the read after it':
      `${ZH}if close > open\n    for i = 0 to 0\n        z.lb := label.new(bar_index, high, "u")\n    label.delete(z.lb)\n`,
    'a function of the script\'s own called between the write and the read':
      `${H}type Z\n    label lb\nvar z = Z.new(na)\nf() => close > open\nif close > open\n    z.lb := label.new(bar_index, high, "u")\n    f()\n    label.delete(z.lb)\n`,
    'a method of the script\'s own called between the write and the read':
      `${H}type Z\n    label lb\nmethod touch(Z this) => this.lb\nvar z = Z.new(na)\nif close > open\n    z.lb := label.new(bar_index, high, "u")\n    z.touch()\n    label.delete(z.lb)\n`,
    'the owner reassigned between the write and the read':
      `${ZH}if close > open\n    z.lb := label.new(bar_index, high, "u")\n    z := Z.new(na)\n    label.delete(z.lb)\n`,
    'the owner used as a value (an alias)':
      `${ZH}a = z\nif close > open\n    z.lb := label.new(bar_index, high, "u")\n    label.delete(a.lb)\n    label.delete(z.lb)\n`,
  }
  for (const [what, src] of Object.entries(UNPROVABLE)) {
    it(what, () => {
      const got = served(src, 'u_fr_unprov')
      expect(got.ok, `served ${got.live} labels`).toBe(false)
      expect(got.reason).toMatch(REMOVES)
    })
  }
})
