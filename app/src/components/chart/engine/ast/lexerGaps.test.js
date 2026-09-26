// app/src/components/chart/engine/ast/lexerGaps.test.js
//
// ─── ⭐⭐ THE FRONT DOOR — WHERE A REAL SCRIPT DIES BEFORE ANYTHING RUNS ─────
//
// Three defects found by censusing the 266-script committed corpus through
// `buildRuntimeIr`. None is a missing capability; each is the engine's own front
// door refusing Pine that TradingView accepts and, in two cases, writes itself.
//
// ⚰️ AND THE THIRD IS WHY THE OTHER TWO TOOK SO LONG. A `PineRefusal` carries its
// position NESTED at `.at`; a `RuntimeRefusal` FLATTENS the same object into
// `line`/`column`/`token`. `buildRuntimeIr`'s `fail()` read only the flat form,
// so every `pine:*` refusal reaching this lane arrived with `line: null` — and
// the hunt for the offending character went through three confident wrong
// answers (a `™` in the licence header, a library `import`, a method call) before
// the missing position turned out to be the whole reason it was hard.
//
// ⛔ A refusal that cannot say WHERE is barely a refusal, and an instrument that
// cannot see a position will happily invent one.
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr } from './pineRuntimeFrontend'
import { translatePine } from './pine.js'

const BARS = Array.from({ length: 8 }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const H = '//@version=6\nindicator("t")\n'
const rt = (s) => buildRuntimeIr(H + s, { bars: BARS, inputs: {} })
const NBSP = String.fromCharCode(160)

describe('⭐⭐ a refusal says WHERE, whichever class it came from', () => {
  it('⛔ a LEXER refusal keeps its line, column and the character itself', () => {
    // A non-breaking space in code position — what a member gets for free by
    // pasting from a web page. The guard is right; the silence was not.
    const r = rt('x = 1' + NBSP + '\nplot(close)')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:character')
    expect(r.refusal.line).toBe(3)
    expect(r.refusal.column).toBeGreaterThan(0)
    expect(r.refusal.token).toBe(NBSP)
  })

  it('⛔ CONTROL: a RUNTIME refusal still carries its own position', () => {
    // Without this, "read `.at` instead" passes while breaking the class that
    // was already working — the two shapes have to BOTH survive.
    const r = rt('while close > 0\n    a = 1\nplot(close)')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:loop')
    expect(r.refusal.line).toBe(3)
    expect(r.refusal.column).toBe(1)
  })
})

describe('⭐ a string literal may span lines', () => {
  it('a wrapped tooltip sentence is ONE string, newline and all', () => {
    // 3 of 266 published scripts die on this, every one of them a long
    // `tooltip =` sentence wrapped across two lines.
    const r = rt('x = "aa\nbb"\nplot(close)')
    expect(r.ok).toBe(true)
  })

  it('⛔⛔ AND THE LINE COUNTER FOLLOWS IT — the expensive half', () => {
    // Consuming a newline without counting it shifts the reported line of every
    // refusal after it. That would trade a fix for 3 scripts against wrong
    // locations in all 266, which is far the worse defect — so the rail is on
    // the counter, not on the string.
    const r = rt('x = "aa\nbb\ncc"\nwhile close > 0\n    a = 1\nplot(close)')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:loop')
    // header 2 + the 3 lines the string spans = the `while` is line 6
    expect(r.refusal.line).toBe(6)
  })

  it('⛔ an unterminated string is still refused, at the quote that opened it', () => {
    const r = rt('x = "aa\nplot(close)')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:character')
    expect(r.refusal.line).toBe(3)
  })
})

describe('⭐ a dotted name may carry spaces around the dot', () => {
  it('`math .max` is the same name as `math.max`', () => {
    // 20 of 266 scripts carry a spaced dot. Pine accepts it; this lexer sent the
    // dot to punctuation, matched nothing, and blamed the character.
    const spaced = rt('x = math .max(1, 2)\nplot(close + x)')
    const tight = rt('x = math.max(1, 2)\nplot(close + x)')
    expect(tight.ok).toBe(true)
    expect(spaced.ok).toBe(true)
    // ⭐ THE SAME PROGRAM, not merely both accepted — every consumer downstream
    // resolves a namespace by string prefix, so the name must be normalised.
    expect(spaced.diagnostics.statements).toBe(tight.diagnostics.statements)
  })

  it('⛔⛔ A NEWLINE NEVER JOINS ONE — the direction that invents a name', () => {
    // Joining across a line break would glue a name to whatever the next line
    // starts with and produce a dotted name the author never wrote. Here `x` is
    // a complete statement and `.foo` begins a new one, so this must NOT lex as
    // `x.foo`; it must fail at the dot.
    const r = rt('x = close\nx\n.foo\nplot(close)')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:character')
    expect(r.refusal.token).toBe('.')
  })

  it('⛔ CONTROL: the host lane reads the spaced form too', () => {
    // The lexer is shared. A fix that only reached the runtime lane would leave
    // the production translator refusing the same 20 scripts.
    const host = translatePine(H + 'plot(math .max(close, open))', { strict: true })
    expect(host.ok).toBe(true)
  })
})
