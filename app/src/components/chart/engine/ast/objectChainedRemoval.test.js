// app/src/components/chart/engine/ast/objectChainedRemoval.test.js
//
// ⭐⭐ A REMOVAL ON A CHAINED ELEMENT — `x.pop().delete()`, `k._box.shift().delete()`,
// `array.remove(a, i).delete()`, `a.get(i).delete()` — inside a helper.
//
// ⚰️ The chained `.delete` lexes as a lone MEMBER token, so a helper whose only
// drawing step was written that way was "not a drawing function": never inlined,
// never refused, its removal gone with no op and no count. Measured on master:
// `ict-killzones-pivots-tfo`'s `del_kz(kz k)` (six `k._<field>.pop().delete()`).
//
// THE RULINGS (coordinator, 2026-11-08):
//  (a) MODELLED EXACTLY where the reference states it and the runtime can run it.
//      Pine v6 reference: `array.pop` "Removes the last element from an array and
//      returns its value"; `array.shift` the first; `array.remove` "...removing the
//      element with the specified index", returning it; the `delete` METHOD is
//      `<family>.delete(id)` with the element as `id` (`originalName`). A list this
//      program declared is a register it already executes (`poppedFrom`, C16) — so
//      a helper on it, including one that takes the list as a PARAMETER, is inlined
//      and served op-for-op as the top-level statement.
//  (b) REFUSED BY NAME, PER OBJECT, where it cannot run: a user type's FIELD has no
//      register here. The removal is named with its family (`box.delete`, read off
//      the `type` declaration) and every object of that family is WITHHELD and
//      counted (`content:lost`) — never drawn where TradingView deleted one — while
//      the script's other drawings keep serving. Never the whole script.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { translatePine } from './pine'
import { assessObjectLoss, objectLossNote, hiddenFamiliesSentence } from './objectLoss'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { collectionFamilies, chainedElementOf } from './objectFnInline'

const LF = String.fromCharCode(10)
const src = (lines) => ['//@version=5', 'indicator("t", overlay=true)', ...lines].join(LF)
const host = (lines) => translatePine(src(lines), { strict: true })
const shape = (t) => JSON.parse(JSON.stringify((t.objects && t.objects.ops) || [], (k, v) =>
  (k === 'line' || k === 'at' || k === 'tok' || k === 'column' || k === 'index' ? undefined : v)))
const door = (lines) => memberPaneDefinition({ source: src(lines), id: 'u_chain', name: 'chain' })

const A = ['var a = array.new_line()', 'array.push(a, line.new(bar_index - 5, low, bar_index, low))']
const U = ['type kz', '    array<box> _box', 'var k = kz.new(array.new_box())',
  'k._box.unshift(box.new(bar_index - 5, high, bar_index, low))']

afterEach(() => { vi.unstubAllEnvs() })

describe('⭐⭐ (a) SERVED EXACTLY — a declared list, the helper inlined', () => {
  for (const [name, stmt] of [
    ['pop', 'a.pop().delete()'],
    ['shift', 'a.shift().delete()'],
    ['remove', 'array.remove(a, 0).delete()'],
    ['get', 'a.get(0).delete()'],
  ]) {
    it(`\`${stmt}\` in a helper is the top-level statement, op for op`, () => {
      const top = host([...A, 'if a.size() > 3', `    ${stmt}`])
      const fn = host([...A, 'f() =>', '    if a.size() > 3', `        ${stmt}`, 'f()'])
      expect(fn.objects.ops.some((o) => o.k === 'delete'), name).toBe(true)
      expect(shape(fn)).toEqual(shape(top))
    })
  }

  it('⭐ the list as a PARAMETER — `f(x) => x.pop().delete()`, `f(a)` — was silent, now served', () => {
    const fn = host([...A, 'f(x) =>', '    if x.size() > 3', '        x.pop().delete()', 'f(a)'])
    const top = host([...A, 'if a.size() > 3', '    a.pop().delete()'])
    expect(fn.objects.ops.some((o) => o.k === 'delete')).toBe(true)
    expect(shape(fn)).toEqual(shape(top))
    expect(fn.objectDiagnostics.droppedOps).toBe(0)
  })
})

describe('⭐ CONTROL — a declared list keeps its own reader', () => {
  it('`a.first().delete()` stays `array.first` (never re-read as a chained removal)', () => {
    const t = host([...A, 'if a.size() > 3', '    a.first().delete()'])
    expect(t.objectDiagnostics.unsupported).toEqual(['array.first'])
    expect(t.objectDiagnostics.removalWithheldFamilies).toBeUndefined()
  })
})

describe('⛔ (b) A USER TYPE\'S FIELD — refused by name, its family withheld, the rest served', () => {
  it('the family comes from the `type` declaration (`array<box> _box`, `line[] _l`)', () => {
    const t = host([...U, 'if k._box.size() > 3', '    k._box.pop().delete()', 'plot(close)'])
    expect(t.objectDiagnostics.unsupported).toContain('box.delete')
  })

  it('top level and inside a helper alike', () => {
    const t = host([...U, 'del(kz q) =>', '    if q._box.size() > 3', '        q._box.pop().delete()', 'del(k)', 'plot(close)'])
    expect(t.objectDiagnostics.unsupported).toContain('box.delete')
  })

  it('⭐ every box is withheld and counted; the line the script also draws is served', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const lines = [...U, 'var b0 = box.new(bar_index - 5, low, bar_index, high)',
      'var l0 = line.new(bar_index - 5, low, bar_index, low)',
      'del(kz q) =>', '    if q._box.size() > 3', '        q._box.pop().delete()', 'del(k)']
    const t = host(lines)
    expect(t.objectDiagnostics.removalWithheldFamilies).toEqual(['box'])
    const fams = new Set(t.objects.ops.filter((o) => o.k === 'create').map((o) => o.family))
    expect(fams.has('box')).toBe(false)
    expect(fams.has('line')).toBe(true)
    expect(t.objectDiagnostics.dropReasons['content:lost']).toBeGreaterThan(0)
    expect(assessObjectLoss(t).verdict).toBe('partial')
    expect(door(lines).ok, door(lines).reason).toBe(true)
  })

  it('⭐ a REFUSED helper (called inside an expression) reports the same withholding', () => {
    const t = host([...U, 'var l0 = line.new(bar_index - 5, low, bar_index, low)',
      'var b0 = box.new(bar_index - 5, low, bar_index, high)',
      'del(kz q) =>', '    if q._box.size() > 3', '        q._box.pop().delete()', '    1',
      'plot(close + del(k))'])
    expect(Object.keys(t.objectDiagnostics.dropReasons).some((k) => k.startsWith('fn:')),
      JSON.stringify(t.objectDiagnostics.dropReasons)).toBe(true)
    expect(t.objectDiagnostics.removalWithheldFamilies).toEqual(['box'])
    expect(assessObjectLoss(t).verdict).toBe('partial')
  })
})

describe('r2 — a user `method delete(T)` and the member note', () => {
  const M = ['type T', '    int x = 0', 'method delete(T this) =>', '    this.x := 1', '    this.x']
  it('M6: on a field the declaration names as drawings, the built-in is refused by name, not dropped', () => {
    const top = host([...M, ...U, 'if k._box.size() > 3', '    k._box.pop().delete()', 'plot(close)'])
    expect(top.objectDiagnostics.unsupported).toContain('box.delete')
    const fn = host([...M, ...U, 'del(kz q) =>', '    if q._box.size() > 3', '        q._box.pop().delete()', 'del(k)', 'plot(close)'])
    expect(fn.objectDiagnostics.unsupported).toContain('box.delete')
  })
  it('M6: a REFUSED helper doing the same still withholds the family', () => {
    const t = host([...M, ...U, 'var l0 = line.new(bar_index - 5, low, bar_index, low)',
      'del(kz q) =>', '    if q._box.size() > 3', '        q._box.pop().delete()', '    1', 'plot(close + del(k))'])
    expect(Object.keys(t.objectDiagnostics.dropReasons).some((k) => k.startsWith('fn:'))).toBe(true)
    expect(t.objectDiagnostics.removalWithheldFamilies).toEqual(['box'])
  })
  it("⭐ control: on a field of the USER's type the user's method is what runs — not refused", () => {
    const t = host([...M, 'type W', '    array<T> _ts', 'var w = W.new(array.new<T>())',
      'if w._ts.size() > 3', '    w._ts.pop().delete()', 'plot(close)'])
    expect(t.objectDiagnostics.unsupported).toEqual([])
  })
  it('the note names a family withheld whole', () => {
    const lines = [...U, 'var l0 = line.new(bar_index - 5, low, bar_index, low)',
      'del(kz q) =>', '    if q._box.size() > 3', '        q._box.pop().delete()', 'del(k)']
    const loss = assessObjectLoss(host(lines))
    expect(loss.hiddenFamilies).toEqual(['box'])
    expect(objectLossNote(loss).note).toContain("No box is shown: the script keeps some of them where this "
      + "chart can't follow yet (in a list or in a field of its own type), so which ones TradingView would "
      + "show, and where, can't be known.")
    expect(objectLossNote(loss).note).not.toMatch(/keeps them in a list/)
    expect(hiddenFamiliesSentence(['box', 'label', 'line'])).toMatch(/^No box, label or line is shown: /)
  })
  it('⭐ a family still drawn is not called hidden', () => {
    const loss = assessObjectLoss(host([...U, 'var b0 = box.new(bar_index - 5, low, bar_index, high)', 'plot(close)']))
    expect(loss.hiddenFamilies).toBeUndefined()
  })
})

describe('⭐ the readers', () => {
  it('`collectionFamilies` reads top-level lists and flattened `type` fields; a clash is null', () => {
    const tk = (kind, value, extra = {}) => ({ kind, value, line: 1, ...extra })
    const h = { isPunct: (t, v) => !!t && t.kind === 'punct' && t.value === v,
      findTop: (t, fn) => t.findIndex(fn) }
    const fams = collectionFamilies([
      { header: [tk('ident', 'type'), tk('ident', 'kz'), tk('ident', 'array', { typeArgs: ['box'] }), tk('ident', '_box'),
        tk('ident', 'line'), tk('punct', '['), tk('punct', ']'), tk('ident', '_hi')] },
      { header: [tk('ident', 'type'), tk('ident', 'zz'), tk('ident', 'label'), tk('punct', '['), tk('punct', ']'), tk('ident', '_hi')] },
      { header: [tk('ident', 'var'), tk('ident', 'a'), tk('punct', '='), tk('ident', 'array.new_label'), tk('punct', '('), tk('punct', ')')] },
    ], h)
    expect(fams.get('._box')).toBe('box')
    expect(fams.get('._hi')).toBe(null)
    expect(fams.get('a')).toBe('label')
  })

  it('`chainedElementOf` names the list behind `.pop()`/`array.shift(x)`, never another call', () => {
    const tk = (kind, value, extra = {}) => ({ kind, value, line: 1, ...extra })
    const P = (v) => tk('punct', v)
    const fams = new Map([['._box', 'box'], ['a', 'line']])
    expect(chainedElementOf([tk('ident', 'k._box.pop'), P('('), P(')'), P('.'), tk('ident', 'delete', { member: true })], 4, fams))
      .toEqual({ coll: 'k._box', method: 'pop', family: 'box' })
    expect(chainedElementOf([tk('ident', 'array.shift'), P('('), tk('ident', 'a'), P(')'), P('.'), tk('ident', 'delete', { member: true })], 5, fams))
      .toEqual({ coll: 'a', method: 'shift', family: 'line' })
    expect(chainedElementOf([tk('ident', 'b.copy'), P('('), P(')'), P('.'), tk('ident', 'delete', { member: true })], 4, fams)).toBe(null)
  })
})
