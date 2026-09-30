// ─── C9 — AN OBJECT OP READS A `var` AS IT STANDS AT THE OP'S OWN STATEMENT ─────
//
// Pine runs the script top to bottom once per bar. A `var` read by
// `line.new(pHH_bx, pHH_ox, …)` holds the value it ENDED the previous bar with,
// plus only the reassignments written ABOVE that line — the promotion
// `pHH_ox := cHH_o` written BELOW it has not run yet on this bar.
//
// ⚰️ MEASURED on `artemis-oscillator-pro` (NYSE:RDDT 1D capture, 2026-09-28): the
// object pass resolved every op against the END of the program, so each
// divergence line was drawn from the CURRENT pivot to itself (x1 == x2, y1 == y2)
// where TradingView draws it from the previous pivot — vendor line id 14 reads
// y1 96.90 → y2 91.18; ours read 91.18 → 91.18. The output loop had this rule
// already (`positionEnv`, 2026-09-28); the object pass is the mirror.
//
// The rule: an op collected under top-level statement T resolves each
// reassigned name against the env as it stands once T (a whole `if` chain
// included) has run — never the end of the program.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { interpret } from './interpret.js'

const NL = String.fromCharCode(10)
const src = (...lines) => ['//@version=6', 'indicator("t", overlay = true)', ...lines].join(NL)
const BUDGET = { maxNodes: 4096, maxLookback: 2000, maxSeriesRefs: 64 }

const program = (source) => {
  const t = translatePine(source, { strict: true })
  const ops = (t.objects && t.objects.ops) || []
  const trees = (t.objects && t.objects.trees) || []
  return { ops, trees, diag: t.objectDiagnostics || {} }
}
const createByText = (p, text) => p.ops.find((o) => o.k === 'create'
  && JSON.stringify(o.props && o.props.text).includes(text))
const yTreeOf = (p, text) => {
  const op = createByText(p, text)
  expect(op, `no create carrying ${text}`).toBeTruthy()
  const y = op.props.y
  expect(y && y.v, JSON.stringify(y)).toBe('tree')
  return p.trees[y.tree]
}

// 320 bars, up and down days alternating in an irregular pattern, so the
// "previous value" and the "current value" differ on most up bars.
const N = 320
const BARS = Array.from({ length: N }, (_, i) => {
  const up = (i * 7) % 5 < 3
  const base = 100 + ((i * 13) % 17)
  return { t: i, o: up ? base : base + 2, h: base + 3, l: base - 1, c: up ? base + 2 : base, v: 1000 }
})

/** Pine, replayed by hand: `p` at a line ABOVE `p := c` is the previous bar's
 *  final `p`; below it, this bar's. */
function replay() {
  const before = new Array(N).fill(NaN)
  const after = new Array(N).fill(NaN)
  let p = NaN
  for (let i = 0; i < N; i += 1) {
    const b = BARS[i]
    const c = b.c > b.o ? b.c : NaN
    before[i] = p
    if (!Number.isNaN(c)) p = c
    after[i] = p
  }
  return { before, after }
}

const SCRIPT = src(
  'var float p = na',
  'float c = na',
  'if close > open',
  '    c := close',
  'if close > open',
  '    label.new(bar_index, p, "before")',
  'if not na(c)',
  '    p := c',
  'if close > open',
  '    label.new(bar_index, p, "after")',
)

describe('an object op reads a `var` at its own statement', () => {
  it('⭐⭐ above the reassignment it reads the PREVIOUS bar\'s final value', () => {
    const p = program(SCRIPT)
    const tree = yTreeOf(p, 'before')
    // E[1]: the whole accumulator, one bar back
    expect(tree.type).toBe('offset')
    expect(tree.value).toBe(1)
    const col = interpret(tree, BARS, {}, BUDGET)
    const { before } = replay()
    let compared = 0
    for (let i = 260; i < N; i += 1) {
      if (!(BARS[i].c > BARS[i].o)) continue // the label runs on up bars only
      expect(col[i], `bar ${i}`).toBeCloseTo(before[i], 9)
      compared += 1
    }
    expect(compared).toBeGreaterThan(20)
  })

  it('CONTROL — below the reassignment it reads THIS bar\'s value', () => {
    const p = program(SCRIPT)
    const tree = yTreeOf(p, 'after')
    expect(tree.type).not.toBe('offset')
    const col = interpret(tree, BARS, {}, BUDGET)
    const { after } = replay()
    let compared = 0
    for (let i = 260; i < N; i += 1) {
      if (!(BARS[i].c > BARS[i].o)) continue
      expect(col[i], `bar ${i}`).toBeCloseTo(after[i], 9)
      compared += 1
    }
    expect(compared).toBeGreaterThan(20)
  })

  it('CONTROL — a reassignment earlier in the op\'s OWN block is seen', () => {
    // The env after the op's statement includes that statement's own writes,
    // so `p := close` then `label.new(…, p)` in one block reads `close`.
    const p = program(src(
      'var float p = na',
      'if close > open',
      '    p := close',
      '    label.new(bar_index, p, "same")',
      'if close < open',
      '    p := open',
    ))
    const tree = yTreeOf(p, 'same')
    const col = interpret(tree, BARS, {}, BUDGET)
    for (let i = 260; i < N; i += 1) {
      if (!(BARS[i].c > BARS[i].o)) continue
      expect(col[i], `bar ${i}`).toBeCloseTo(BARS[i].c, 9)
    }
  })

  it('⭐ the artemis shape: a line from the stored pivot to the current one', () => {
    // `line.new(prevX, prevY, bar_index, y)` above the promotion
    // `prevY := y` — the two ends must differ on a promotion bar.
    const p = program(src(
      'var float prevY = na',
      'var int prevX = na',
      'bool piv = close > open',
      'if piv and not na(prevY)',
      '    line.new(prevX, prevY, bar_index, close)',
      'if piv',
      '    prevY := close',
      '    prevX := bar_index',
    ))
    const line = p.ops.find((o) => o.k === 'create' && o.family === 'line')
    expect(line).toBeTruthy()
    const y1 = interpret(p.trees[line.props.y1.tree], BARS, {}, BUDGET)
    let differs = 0
    let prev = NaN
    for (let i = 0; i < N; i += 1) {
      const up = BARS[i].c > BARS[i].o
      if (i >= 260 && up) {
        expect(y1[i], `bar ${i}`).toBeCloseTo(prev, 9)
        if (y1[i] !== BARS[i].c) differs += 1
      }
      if (up) prev = BARS[i].c
    }
    expect(differs).toBeGreaterThan(5)
  })
})
