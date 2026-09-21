// app/src/components/chart/engine/runtime/__tests__/objectEnums.test.js
//
// ─── ⭐⭐ PINE'S DRAWING VOCABULARY IS A SET OF STRING CONSTANTS ─────────────
//
// `size.tiny`, `position.top_right`, `text.align_left`, `line.style_dashed` —
// the words a script uses to say how something is drawn. `objectEnumValue` in
// `pine.js` has held the whole table all along; the runtime lane could not
// reach it, so every one of them read as
//
//     pine:builtin — "names something the engine grammar does not hold"
//
// about a vocabulary the engine does hold.
//
// ⚠️ IT ONLY EVER SURFACED THROUGH A FUNCTION. A top-level `sz = size.small` is
// not mutable and reads no slot, so it takes the `env` macro path and is never
// lowered at all — the gap is invisible there. Inside a function BODY it is
// lowered, and `getTextSize(s) => s == "tiny" ? size.tiny : size.small` is how
// a dashboard picks its text size. That asymmetry is why the fixtures below use
// both shapes: one of them cannot fail.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { objectEnumValue } from '../../ast/pine.js'

const head = '//@version=6\nindicator("t", overlay = true)\n'
const N = 4
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))

const build = (src) => buildRuntimeIr(head + src, {
  bars: BARS, inputs: {}, newestBarIsForming: false,
})
const why = (r) => (r.ok ? 'OK' : `[${r.refusal.guard}] ${r.refusal.message}`)

describe('⭐⭐ an object enum inside a function body', () => {
  it('⭐⭐ THE SHAPE THAT WAS BROKEN — a helper choosing a text size', () => {
    const r = build('f(string s) =>\n    s == "tiny" ? size.tiny : size.small\n'
      + 'sz = f("tiny")\nplot(close)\n')
    expect(r.ok, why(r)).toBe(true)
  })

  it('⭐ every family, not just `size`', () => {
    for (const name of ['size.large', 'position.bottom_left', 'text.align_right',
      'line.style_dashed', 'xloc.bar_time', 'yloc.abovebar', 'extend.both']) {
      const r = build(`f(bool b) =>\n    b ? ${name} : ${name}\nx = f(true)\nplot(close)\n`)
      expect(r.ok, `${name}: ${why(r)}`).toBe(true)
    }
  })

  it('⛔ CONTROL — the top-level form cannot fail, and is not the test', () => {
    // It takes the `env` macro path and is never lowered. Kept so nobody
    // "simplifies" the fixtures above into this one and loses the coverage.
    expect(build('sz = size.small\nplot(close)\n').ok).toBe(true)
  })

  it('⛔ ONE AUTHORITY — the table is pine.js\'s, read rather than copied', () => {
    // A second list in the runtime lane would drift from the one the object
    // pass uses to decide what a cell's `text_size` means.
    expect(objectEnumValue('size.tiny')).toBe('tiny')
    expect(objectEnumValue('position.top_right')).toBe('top_right')
    expect(objectEnumValue('label.style_label_down')).toBe('label_down')
    expect(objectEnumValue('not.an.enum')).toBeUndefined()
  })

  it('⛔ a name that is NOT an enum still refuses by name', () => {
    const r = build('f(bool b) =>\n    b ? size.enormous : size.small\nx = f(true)\nplot(close)\n')
    expect(r.ok).toBe(false)
  })

  it('⛔ AND A SHADOWING BINDING STILL WINS', () => {
    // A member may bind a name the enum table happens to hold; the binding is
    // what they meant, and the constant must not silently replace it.
    const r = build('f(float size) =>\n    size * 2\nplot(f(3.0))\n')
    expect(r.ok, why(r)).toBe(true)
  })
})
