// ─── AN OBJECT WHOSE TEXT THIS CHART CANNOT KNOW IS WITHHELD, NEVER DRAWN BLANK ──
//
// Owner rule (2026-09-28): our chart draws exactly what TradingView draws, and
// never draws something wrong. Found when `time_close` became readable (C8) and
// `poor-man039s-volume-profile`'s 40 labels started converting: every one of them
// is created with `""` and given its text by `label.set_text(rowN_label,
// rowN_text)`, where `rowN_text` is built by `rowN_text := rowN_text + "#"` in a
// `for`. TradingView shows `####…`; this chart would have shown 40 empty labels.
//
// Two rules, each with its control:
//   1. a lost setter that writes an object's TEXT withholds that object — the
//      create is dropped as `content:lost`, and every later step on it as
//      `content:withheld` — so the member's "N of M" counts it and nothing blank
//      is drawn. A setter whose text IS readable leaves the object drawn.
//   2. a block local the reassignment overrule condemned (a `:=` the fold never
//      consumed) is refused in the object pass too. The pass used to read the
//      walk's per-statement record, taken before the overrule, and so drew
//      `row0_text`'s initial `""` (and put sonarlab's boxes at `bar_index[0]`).
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

const NL = String.fromCharCode(10)
const src = (...lines) => ['//@version=5', 'indicator("t", overlay = true)', ...lines].join(NL)
const program = (source) => {
  const t = translatePine(source, { strict: true })
  return { ops: (t.objects && t.objects.ops) || [], diag: t.objectDiagnostics || {} }
}
const all = (ops) => ops.flatMap((o) => (o.k === 'loop' ? [o, ...all(o.body)] : [o]))
const creates = (ops) => all(ops).filter((o) => o.k === 'create')

const LOOP_TEXT = [
  'if barstate.islast',
  '    t = ""',
  '    for i = 0 to 3',
  '        t := t + "#"',
  '    label.set_text(lb, t)',
]

describe('rule 1 — a lost text setter withholds its object', () => {
  it('the label is not drawn, and the create and its setters are counted', () => {
    const { ops, diag } = program(src(
      'var line ln = line.new(bar_index, high, bar_index + 1, high)',
      'var label lb = label.new(bar_index, close, "")',
      'if barstate.islast',
      '    line.set_y1(ln, low)',
      '    label.set_y(lb, low)',
      ...LOOP_TEXT,
    ))
    expect(creates(ops).map((o) => o.family)).toEqual(['line'])
    expect(diag.dropReasons['content:lost']).toBe(1)
    expect(diag.dropReasons['content:withheld']).toBe(1)
    expect(diag.droppedOps).toBeLessThanOrEqual(diag.attemptedOps)
    // Nothing left in the program acts on a register no carried create fills.
    const filled = new Set(creates(ops).map((o) => o.into))
    const updates = all(ops).filter((o) => o.k === 'update')
    expect(updates.length).toBeGreaterThan(0)
    for (const u of updates) expect(filled.has(u.target.id), JSON.stringify(u.target)).toBe(true)
  })

  it('CONTROL — a readable text setter leaves the label drawn, with that text', () => {
    const { ops, diag } = program(src(
      'var label lb = label.new(bar_index, close, "")',
      'if barstate.islast',
      '    label.set_text(lb, "hello")',
    ))
    expect(creates(ops).map((o) => o.family)).toEqual(['label'])
    expect(diag.dropReasons['content:lost']).toBeUndefined()
    const setText = all(ops).find((o) => o.k === 'update' && o.props.text)
    expect(JSON.stringify(setText.props.text)).toContain('hello')
  })

  it('CONTROL — a lost setter of a NON-text property withholds nothing', () => {
    const { ops, diag } = program(src(
      'var label lb = label.new(bar_index, close, "x")',
      'if barstate.islast',
      '    c = color.red',
      '    for i = 0 to 3',
      '        c := color.blue',
      '    label.set_color(lb, c)',
    ))
    expect(creates(ops).map((o) => o.family)).toEqual(['label'])
    expect(diag.dropReasons['content:lost']).toBeUndefined()
  })
})

describe('rule 2 — the reassignment overrule holds in a block scope', () => {
  it('a text built in an unreadable loop is refused at create, not drawn as its initial ""', () => {
    const { ops, diag } = program(src(
      'if barstate.islast',
      '    t = ""',
      '    for i = 0 to 3',
      '        t := t + "#"',
      '    label.new(bar_index, close, t)',
    ))
    expect(creates(ops)).toEqual([])
    expect(diag.dropReasons['create:label']).toBe(1)
  })

  it('CONTROL — a block local nobody reassigns still reads', () => {
    const { ops } = program(src(
      'if barstate.islast',
      '    t = "fixed"',
      '    label.new(bar_index, close, t)',
    ))
    expect(creates(ops)).toHaveLength(1)
    expect(JSON.stringify(creates(ops)[0].props.text)).toContain('fixed')
  })
})
