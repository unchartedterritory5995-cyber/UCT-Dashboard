// app/src/components/chart/engine/runtime/__tests__/i6aN4BlockIndent.test.js
//
// ⭐⭐ I6a-N4 — AN OPENER WHOSE EVERY LINE BENEATH IS A WRAP HAS NO LOCAL BLOCK.
//
// THE RULE (Pine Script User Manual, "Script structure"): "A local block must be indented by a tab
// or four spaces." Under "Line wrapping": "each wrapped line after the first can use any indentation
// length _except_ multiples of four, because Pine uses four-space or tab indentations to define
// local code blocks." "Conditional structures": "The local blocks in conditional structures must be
// indented by four spaces or a tab."
//
// Master served `0 => switch k` with the inner arms at indent 9 or 6 (review W34-I6a, note N4), and
// `if c` / `      x := 1`, `for …` / `      s += …`: by the manual each of those lines is a wrap of the
// opener's line, so the opener has no block. Both lanes now refuse BY NAME (`pine:indent`), through
// the one check they share (`pine.js::refuseOffBlockIndent`). What TradingView prints for them is
// capture row I6A-N4-1 (`docs/pine/capture-queue-2026-11-07-i6a-n4.md`).
//
// Synthetic shapes only; no licence-held script text.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { translatePine, lexPine, blockStatements, refuseOffBlockIndent } from '../../ast/pine.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 3000
const BARS = (() => {
  let s = 777
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
  const out = []
  let c = 100
  for (let i = 0; i < N; i += 1) {
    const o = c + (rnd() - 0.5) * 2
    c = Math.max(1, o + (rnd() - 0.5) * 3)
    const h = Math.max(o, c) + rnd() * 1.5
    const l = Math.min(o, c) - rnd() * 1.5
    out.push({ t: 1600000000 + i * 86400, o, h, l, c, v: 1000 + Math.floor(rnd() * 500) })
  }
  return out
})()
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD = '//@version=5\nindicator("t")\n'

const build = (src, extra = {}) => buildRuntimeIr(src, { bars: BARS, inputs: {}, ...extra })
function run(src) {
  const built = build(src)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t),
  })
  return Array.from(r.outputs[0])
}
const same = (a, b) => {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < a.length; i += 1) {
    if (Number.isNaN(a[i])) expect(Number.isNaN(b[i]), `bar ${i}`).toBe(true)
    else expect(b[i], `bar ${i}`).toBe(a[i])
  }
}
const hostRefusal = (src) => {
  const t = translatePine(src, { strict: true })
  return t.refusal || (t.refusals || [])[0] || null
}
const NAMED = /`(switch|if|for|while|else)` has no local block: every line beneath it starts at an indent that is not a multiple of four \(the first at \d+\), and Pine reads such a line as a wrap of the line above/

// The nested switch, inner arms at `ind`.
const nested = (ind) => {
  const p = ' '.repeat(ind)
  return `${HEAD}m = bar_index % 2\nk = bar_index % 3\nv = switch m\n    0 => switch k\n${p}0 => close\n${p}=> low\n    => high\nplot(v)\n`
}

const REFUSED = {
  'nested switch, inner arms at 9 (N4)': [nested(9), 'switch', 9],
  'nested switch, inner arms at 6 (N4)': [nested(6), 'switch', 6],
  'nested switch, inner arms at 10': [nested(10), 'switch', 10],
  'nested switch, inner arms at 5 (one past the outer arm)': [nested(5), 'switch', 5],
  'top-level switch, arms at 6': [`${HEAD}k = bar_index % 3\nv = switch k\n      0 => close\n      => low\nplot(v)\n`, 'switch', 6],
  'top-level switch, arms at 2': [`${HEAD}k = bar_index % 3\nv = switch k\n  0 => close\n  => low\nplot(v)\n`, 'switch', 2],
  '`0 => if c` with its body at 9': [`${HEAD}m = bar_index % 2\nv = switch m\n    0 => if close > open\n         close\n    => high\nplot(v)\n`, 'if', 9],
  '`if` body at 6': [`${HEAD}v = 0.0\nif close > open\n      v := close\nplot(v)\n`, 'if', 6],
  '`if` nested in `if`, inner body at 6': [`${HEAD}v = 0.0\nif close > open\n    if high > low\n      v := close\nplot(v)\n`, 'if', 6],
  '`else` body at 6': [`${HEAD}v = 0.0\nif close > open\n    v := close\nelse\n      v := open\nplot(v)\n`, 'else', 6],
  '`for` body at 6': [`${HEAD}s = 0.0\nfor i = 0 to 2\n      s += close[i]\nplot(s)\n`, 'for', 6],
  // ⛔ a line inside brackets is not a block line, even at a multiple of four (the manual: "all code
  // between those characters _does not_ have any restriction on indentation length")
  '`if` body at 6 whose only indent-4 line is inside brackets': [`${HEAD}v = 0.0
if close > open
      v := math.max(close,
    open)
plot(v)
`, 'if', 6],
  '`while` body at 2': [`${HEAD}s = 0.0\ni = 0\nwhile i < 3\n  s += close[i]\n  i += 1\nplot(s)\n`, 'while', 2],
}

describe('⭐⭐ I6a-N4 an opener with no line at a block indent is refused BY NAME on both lanes', () => {
  for (const [name, [src, word, ind]] of Object.entries(REFUSED)) {
    it(`⛔ ${name}`, () => {
      const rt = build(src)
      expect(rt.ok, 'runtime lane served it').toBe(false)
      expect(rt.refusal.guard).toBe('pine:indent')
      expect(rt.refusal.message).toMatch(NAMED)
      expect(rt.refusal.message).toContain(`\`${word}\` has no local block`)
      expect(rt.refusal.message).toContain(`(the first at ${ind})`)
      const h = hostRefusal(src)
      expect(h, 'host lane served it').not.toBe(null)
      expect(h.guard).toBe('pine:indent')
      // ⭐ the lanes agree: one check, one sentence
      expect(h.message).toBe(rt.refusal.message)
    })
  }

  it('⛔ at the C18 object door too (an over-serve is wrong at every door)', () => {
    const r = build(nested(9), { objectDoor: true })
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:indent')
  })

  it('⭐ the refusal points at the first wrapped line', () => {
    const r = build(nested(9))
    expect(r.refusal.line).toBe(7)
  })
})

describe('⭐⭐ I6a-N4 what still serves, exactly as before', () => {
  it('⭐ CONTROL — a nested switch at block indents serves and equals its ternary', () => {
    const ref = `${HEAD}m = bar_index % 2\nk = bar_index % 3\nv = m == 0 ? (k == 0 ? close : low) : high\nplot(v)\n`
    const got = run(nested(8))
    expect(new Set(got.map((x) => Math.round(x * 1e6))).size).toBeGreaterThan(100)
    same(run(ref), got)
  })

  it('⭐ an inner arm whose value wraps (W34-I6a) still serves and equals its one-line form', () => {
    const src = (wrap) => `${HEAD}m = bar_index % 2\nk = bar_index % 3\nv = switch m\n    0 => switch k\n        0 => close${wrap ? '\n         + open' : ' + open'}\n        => low\n    => high\nplot(v)\n`
    same(run(src(false)), run(src(true)))
  })

  it('⭐ a deeper line at a multiple of four (inner arms at 12) is unchanged: it serves', () => {
    same(run(nested(8)), run(nested(12)))
  })

  it('⭐ a function whose value wraps at indent 6 (the published ternary-chain shape) serves on both lanes', () => {
    const wrapped = `${HEAD}f(x) =>\n      x > open ? x :\n      x < low ? low : open\nplot(f(close))\n`
    const inline = `${HEAD}f(x) => x > open ? x : x < low ? low : open\nplot(f(close))\n`
    same(run(inline), run(wrapped))
    expect(translatePine(wrapped, { strict: true }).ok).toBe(true)
  })

  it('⭐ a wrapped condition above a real block is not this refusal (some line IS at a block indent)', () => {
    const src = `${HEAD}v = 0.0\nif close > open\n      and high > low\n    v := close\nplot(v)\n`
    const rt = build(src)
    expect(rt.ok ? null : rt.refusal.guard).not.toBe('pine:indent')
    const h = hostRefusal(src)
    expect(h ? h.guard : null).not.toBe('pine:indent')
  })

  it('⭐ a top-level wrapped expression and an `if` body at 4 serve on both lanes', () => {
    const wrap = `${HEAD}v = close +\n      open\nplot(v)\n`
    const one = `${HEAD}v = close + open\nplot(v)\n`
    same(run(one), run(wrap))
    expect(translatePine(wrap, { strict: true }).ok).toBe(true)
    const blk = `${HEAD}v = 0.0\nif close > open\n    v := close\nplot(v)\n`
    expect(build(blk).ok).toBe(true)
    expect(translatePine(blk, { strict: true }).ok).toBe(true)
  })

  it('⭐ a bracket held open across a deeper line is not a block line', () => {
    const src = `${HEAD}v = 0.0\nif close > open\n    v := math.max(close,\n      open)\nplot(v)\n`
    expect(build(src).ok).toBe(true)
  })
})

describe('⛔ I6a-N4 over-refusal guard: no committed corpus script reaches the check', () => {
  // ⛔ No `existsSync` guard: a corpus gate that passes with no corpus cannot fail.
  const ROOTS = ['../corpus', '../tests/fixtures'].map((r) => path.resolve(process.cwd(), r))
  const walk = (d, out) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (e.name.endsWith('.pine')) out.push(p)
    }
    return out
  }
  it('⭐ every committed .pine script passes `refuseOffBlockIndent`', () => {
    const files = ROOTS.flatMap((r) => walk(r, []))
    expect(files.length).toBeGreaterThan(400)
    const hit = []
    let read = 0
    for (const f of files) {
      let lx
      let st
      try { lx = lexPine(fs.readFileSync(f, 'utf8')); st = blockStatements(lx.tokens, lx.indents, 0) } catch { continue }
      read += 1
      try { refuseOffBlockIndent(st, lx.indents) } catch (e) { hit.push(`${path.basename(f)}: ${e.message}`) }
    }
    expect(read).toBeGreaterThan(400)
    expect(hit).toEqual([])
  })
})

describe('⭐ I6a-N4 the capture probes say what our engine answers today', () => {
  const PROBES = path.resolve(process.cwd(), '../tools/visual_conformance/probes')
  const read = (f) => fs.readFileSync(path.join(PROBES, f), 'utf8')
  it('⭐ refused `pine:indent` on both lanes: switch at 9, switch at 6, `if` at 6, `if` at a tab plus 2', () => {
    for (const f of ['i6a-n4-switch-9.pine', 'i6a-n4-switch-6.pine', 'i6a-n4-if-6.pine', 'i6a-n4-if-tab2.pine']) {
      const r = build(read(f))
      expect(r.ok, f).toBe(false)
      expect(r.refusal.guard, f).toBe('pine:indent')
      expect(hostRefusal(read(f)).guard, f).toBe('pine:indent')
    }
  })
  it('⭐ served on the runtime lane, and equal: the control at 8 and the unchanged shape at 12', () => {
    same(run(read('i6a-n4-control-8.pine')), run(read('i6a-n4-switch-12.pine')))
  })
})
