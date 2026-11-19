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
