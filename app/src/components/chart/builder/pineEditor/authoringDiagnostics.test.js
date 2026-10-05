// A1 — the Pine Editor's problems list is the MEMBER DOOR's verdict, verbatim,
// with positions, stamped with the text it was measured on.
import { describe, it, expect } from 'vitest'
import { memberPaneDefinition } from '../memberPane/memberPaneDefinition'
import { authoringDiagnostics, offsetOf } from './authoringDiagnostics'

const OK = '//@version=5\nindicator("x")\nlen = input.int(14, "Len")\nplot(ta.rsi(close, len))'
const UNKNOWN_FN = '//@version=5\nindicator("x")\nplot(ta.foo(close, 14))'
const UNDEFINED = '//@version=5\nindicator("x")\nplot(zzz + 1)'
const SYNTAX = '//@version=5\nindicator("x")\nplot(ta.rsi(close, 14)'

const build = (s) => memberPaneDefinition({ source: s, id: 'u_member-pane' })

describe('authoringDiagnostics — the door\'s verdict as a list', () => {
  it('an empty buffer is "empty", with nothing to apply', () => {
    expect(authoringDiagnostics(null, '')).toMatchObject({ state: 'empty', items: [], saveable: false })
    expect(authoringDiagnostics(build('   '), '   ').state).toBe('empty')
  })

  it('a script the door builds is ok and saveable, with no error items', () => {
    const r = authoringDiagnostics(build(OK), OK)
    expect(r.state).toBe('ok')
    expect(r.saveable).toBe(true)
    expect(r.items.filter((i) => i.severity === 'error')).toEqual([])
    expect(r.primary).toBe(null)
    expect(r.drawn).toBeGreaterThan(0)
  })

  it.each([
    ['an unknown function', UNKNOWN_FN, 'pine:function', 3, 6, 'ta.foo'],
    ['an undefined name', UNDEFINED, 'pine:undefined', 3, 6, 'zzz'],
    ['an unclosed call', SYNTAX, 'pine:statement', 3, 22, ')'],
  ])('⭐ %s: one error at the exact line/column/token, sentence VERBATIM', (_n, src, guard, line, column, token) => {
    const built = build(src)
    expect(built.ok).toBe(false)
    const r = authoringDiagnostics(built, src)
    expect(r.state).toBe('refused')
    expect(r.saveable).toBe(false)
    const errs = r.items.filter((i) => i.severity === 'error')
    // ⛔ DE-DUPLICATED: the translator reports the same refusal as `refusal`,
    // in `refusals[]` and on the output row — the member reads it ONCE.
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ guard, line, column, token })
    // ⛔ VERBATIM — the translator's own words, derived, never typed here.
    expect(errs[0].message).toBe(built.translation.refusal.message)
    expect(r.primary).toBe(errs[0])
  })

  it('⛔ EVERY item is stamped with the text it was measured on', () => {
    const r = authoringDiagnostics(build(UNKNOWN_FN), UNKNOWN_FN)
    expect(r.items.length).toBeGreaterThan(0)
    for (const it of r.items) expect(it.source).toBe(UNKNOWN_FN)
  })

  it('⛔ a refusal with no position still shows — the gate\'s own sentence, whole-script', () => {
    const built = { ok: false, reason: 'this script declares nothing a chart can draw', guard: null,
      translation: { ok: true, outputs: [], refusal: null, refusals: [] } }
    const r = authoringDiagnostics(built, 'x')
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ severity: 'error', line: null, column: null,
      message: 'this script declares nothing a chart can draw' })
    expect(r.primary).toBe(null)
  })

  it('⛔ a refused build with no sentence anywhere is never an empty red list', () => {
    const r = authoringDiagnostics({ ok: false, reason: '', translation: null }, 'x')
    expect(r.state).toBe('refused')
    expect(r.items.filter((i) => i.severity === 'error')).toHaveLength(1)
  })

  it('a refused output row on a script the door ACCEPTED is a warning, not an error', () => {
    const built = {
      ok: true, saveable: true, notes: [{ name: 'n', note: 'a disclosure' }],
      definition: { plots: [{ key: 'a' }, { key: 'b', hidden: true }] },
      translation: { outputs: [{ refusal: null }, { refusal: { guard: 'g', message: 'not drawn', line: 9, column: 2 } }] },
    }
    const r = authoringDiagnostics(built, 'src')
    expect(r.state).toBe('ok')
    expect(r.items.map((i) => i.severity)).toEqual(['warning', 'info'])
    expect(r.primary).toMatchObject({ line: 9 })
    expect(r.drawn).toBe(1)
  })

  it('orders errors by line, positionless last', () => {
    const built = { ok: false, reason: 'whole', translation: { refusals: [
      { message: 'b', line: 7, column: 1 }, { message: 'a', line: 2, column: 4 },
    ] } }
    const r = authoringDiagnostics(built, 'src')
    expect(r.items.map((i) => i.message)).toEqual(['a', 'b', 'whole'])
  })

  it('a saveable:false document is ok but cannot be applied', () => {
    const r = authoringDiagnostics({ ok: true, saveable: false, definition: { plots: [] }, translation: {} }, 's')
    expect(r.state).toBe('ok')
    expect(r.saveable).toBe(false)
  })

  it('reads the PANE door\'s translation (host lane, strict), not the screener\'s', () => {
    expect(build(OK).translation.mode).toBe('host')
  })
})

describe('offsetOf — 1-based line/column to an offset', () => {
  const text = 'ab\ncdef\n\nxyz'
  it.each([
    [1, 1, 0], [1, 2, 1], [2, 1, 3], [2, 4, 6], [3, 1, 8], [4, 3, 11],
    [2, 99, 7], [99, 1, text.length], [0, 1, 0],
  ])('line %i column %i -> %i', (l, c, want) => {
    expect(offsetOf(text, l, c)).toBe(want)
  })
})
