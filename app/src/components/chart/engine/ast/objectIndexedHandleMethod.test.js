// app/src/components/chart/engine/ast/objectIndexedHandleMethod.test.js
//
// ⭐⭐ `l[1].delete()` IS `line.delete(l[1])` — A METHOD ON A VALUE RECEIVER.
//
// ⚰️ Found by the STRAT-COLOR review (2026-11-08), pre-existing on master: the
// method form on a history-referenced drawing handle produced NO op and NO
// count, tainted or not. The removal vanished and the member's chart kept every
// object the author deleted. Siblings with the same hole: `l[1].set_xy1(…)`,
// `(c ? a : b).delete()`, and any of them inside a user function (the chained
// segment lexes as a lone MEMBER token, so the function was "not a drawing
// function" and was never inlined).
//
// THE RULING, per form:
//  • SERVED — `l[n].<m>(…)` on a DECLARED handle of line/label/box/table/
//    linefill. The v6 reference lists the METHOD `delete` with `originalName`
//    `line.delete` and `thisType` `series line` (`id.delete()` IS
//    `<ns>.delete(id)`), and its own `input.string` / `input.time` examples write
//    `label.delete(l[1])` (the id the variable held on the previous bar). So it is
//    lowered to EXACTLY the name form's op — the parity rail below compares the
//    two ops whole — and the name form's own rails (`objectHandleHistory.test.js`)
//    already carry `{r:'reg', back:n}` through the runtime.
//  • REFUSED BY NAME — a ternary receiver: lowered to the name form too, which
//    does not resolve the target and drops it as `delete:target` (identical to
//    `line.delete(c ? a : b)`); a receiver whose family the tokens cannot name is
//    `object.<method>` in `unsupported`, classified a removal / a lost setter.
//  • UNCHANGED — plain `l.delete()` and `a.get(i).delete()`.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'
import { evaluateObjects } from '../objectRuntime'
import { assessObjectLoss, classifyReaderName, LOSS } from './objectLoss'
import { onValueReceiver } from './objectFnInline'

const LF = String.fromCharCode(10)
const host = (lines) => translatePine(['//@version=5', 'indicator("t", overlay=true)', ...lines].join(LF),
  { strict: true })

/** Every op with the source position stripped — what the program DOES. */
const shape = (t) => JSON.parse(JSON.stringify((t.objects && t.objects.ops) || [], (k, v) =>
  (k === 'line' || k === 'at' || k === 'tok' || k === 'column' || k === 'index' ? undefined : v)))

/** Drive a program whose trees are all bar-index / literal arithmetic. */
function run(t, bars = 30) {
  const trees = t.objects.trees
  const ev = (n, bar) => {
    if (!n) return NaN
    if (n.type === 'num') return n.value
    if (n.type === 'series') return n.name === 'barindex' ? bar : 100 + bar
    if (n.type === 'op') {
      const a = (n.args || []).map((x) => ev(x, bar))
      if (n.name === '+') return a[0] + a[1]
      if (n.name === '-') return a[0] - a[1]
    }
    return NaN
  }
  return evaluateObjects(t.objects, {
    barCount: bars, readNode: (i, bar) => ev(trees[i], bar), readTime: (i) => i,
  })
}

const LINE = 'l = line.new(bar_index - 5, low, bar_index, low)'
const CREATES = {
  line: LINE,
  label: 'l = label.new(bar_index, low, "x")',
  box: 'l = box.new(bar_index - 5, high, bar_index, low)',
}

describe('⭐⭐ SERVED — `l[n].<method>()` on a declared handle is the name form', () => {
  for (const [fam, create] of Object.entries(CREATES)) {
    it(`${fam}: \`l[1].delete()\` emits exactly \`${fam}.delete(l[1])\`'s ops`, () => {
      const m = host([create, 'l[1].delete()'])
      const n = host([create, `${fam}.delete(l[1])`])
      const del = m.objects.ops.find((o) => o.k === 'delete')
      expect(del, JSON.stringify(m.objectDiagnostics)).toBeTruthy()
      expect(del.target).toMatchObject({ r: 'reg', back: 1 })
      expect(shape(m)).toEqual(shape(n))
      expect(m.objectDiagnostics.droppedOps).toBe(0)
    })
  }

  it('table: `t[1].delete()` is `table.delete(t[1])`', () => {
    const c = 'var t = table.new(position.top_right, 2, 2)'
    expect(shape(host([c, 't[1].delete()']))).toEqual(shape(host([c, 'table.delete(t[1])'])))
    expect(host([c, 't[1].delete()']).objects.ops.some((o) => o.k === 'delete')).toBe(true)
  })

  it('linefill: `f[1].delete()` is `linefill.delete(f[1])`', () => {
    const c = ['a = line.new(bar_index - 5, low, bar_index, low)',
      'b = line.new(bar_index - 5, high, bar_index, high)', 'f = linefill.new(a, b, color.red)']
    expect(shape(host([...c, 'f[1].delete()']))).toEqual(shape(host([...c, 'linefill.delete(f[1])'])))
    expect(host([...c, 'f[1].delete()']).objects.ops.some((o) => o.k === 'delete')).toBe(true)
  })

  it('`l[2].delete()` reads two bars back, as `line.delete(l[2])` does', () => {
    expect(shape(host([LINE, 'l[2].delete()']))).toEqual(shape(host([LINE, 'line.delete(l[2])'])))
  })

  it('a setter: `l[1].set_xy1(…)` is `line.set_xy1(l[1], …)`', () => {
    const m = host([LINE, 'l[1].set_xy1(bar_index, high)'])
    expect(m.objects.ops.find((o) => o.k === 'update')).toBeTruthy()
    expect(shape(m)).toEqual(shape(host([LINE, 'line.set_xy1(l[1], bar_index, high)'])))
  })

  it('⭐ and the RUNTIME keeps exactly one line — yesterday\'s is deleted every bar', () => {
    const r = run(host([LINE, 'l[1].delete()']))
    expect(r.status).toBe('ok')
    expect(r.live.filter((o) => o.family === 'line').length).toBe(1)
    expect(r.stats.created).toBe(30)
    expect(r.stats.deleted).toBe(29)
  })

  it('inside a carried loop it is the name form there too', () => {
    const body = (s) => [LINE, 'for i = 0 to 2', `    ${s}`]
    expect(shape(host(body('l[1].delete()')))).toEqual(shape(host(body('line.delete(l[1])'))))
  })
})

describe('⭐⭐ SERVED — the same statement inside a user function', () => {
  it('an unconditional helper deleting `l[1]` inlines, as the name form does', () => {
    const fn = (s) => [LINE, 'f() =>', `    ${s}`, 'f()']
    const m = host(fn('l[1].delete()'))
    expect(m.objects.ops.some((o) => o.k === 'delete')).toBe(true)
    expect(shape(m)).toEqual(shape(host(fn('line.delete(l[1])'))))
  })

  it('a parameter\'s history: `x[1].delete()` with `f(l)` called every bar', () => {
    const fn = (s) => [LINE, 'f(x) =>', `    ${s}`, 'f(l)']
    expect(shape(host(fn('x[1].delete()')))).toEqual(shape(host(fn('line.delete(x[1])'))))
    expect(host(fn('x[1].delete()')).objects.ops.some((o) => o.k === 'delete')).toBe(true)
  })

  it('a helper whose only step is `(c ? a : b).delete()` is inlined and refused by name', () => {
    const t = host(['var a = line.new(bar_index - 5, low, bar_index, low)',
      'var b = line.new(bar_index - 5, high, bar_index, high)', 'f() =>', '    (close > open ? a : b).delete()', 'f()'])
    expect(t.objectDiagnostics.dropReasons['delete:target']).toBe(1)
  })

  it('⛔ `onValueReceiver` reads a history or parenthesised receiver, never a chained CALL', () => {
    const tk = (kind, value, extra = {}) => ({ kind, value, line: 1, ...extra })
    const P = (v) => tk('punct', v)
    const I = (v, member = false) => tk('ident', v, member ? { member: true } : {})
    // l [ 1 ] . delete
    expect(onValueReceiver([I('l'), P('['), tk('number', 1), P(']'), P('.'), I('delete', true)], 5)).toBe(true)
    // ( a ) . delete
    expect(onValueReceiver([P('('), I('a'), P(')'), P('.'), I('delete', true)], 4)).toBe(true)
    // k._box . pop ( ) . delete  — a chained CALL
    expect(onValueReceiver([I('k._box'), P('.'), I('pop', true), P('('), P(')'), P('.'), I('delete', true)], 6)).toBe(false)
    // l . delete — the parser's dotted name never reaches here as a member, and is not a value receiver
    expect(onValueReceiver([I('l'), P('.'), I('delete', true)], 2)).toBe(false)
  })

  it('⛔ a CONDITIONAL call reading a parameter\'s history refuses by name, as the name form does', () => {
    const fn = (s) => [LINE, 'f(x) =>', `    ${s}`, 'if close > open', '    f(l)']
    const m = host(fn('x[1].delete()'))
    expect(m.objectDiagnostics.dropReasons['fn:conditional-history']).toBe(1)
    expect(m.objectDiagnostics.dropReasons).toEqual(host(fn('line.delete(x[1])')).objectDiagnostics.dropReasons)
  })
})

describe('⛔ REFUSED BY NAME — never dropped in silence', () => {
  const two = ['var a = line.new(bar_index - 5, low, bar_index, low)',
    'var b = line.new(bar_index - 5, high, bar_index, high)']

  it('`(c ? a : b).delete()` drops as `delete:target`, exactly as `line.delete(c ? a : b)`', () => {
    const m = host([...two, '(close > open ? a : b).delete()'])
    const n = host([...two, 'line.delete(close > open ? a : b)'])
    expect(m.objectDiagnostics.dropReasons['delete:target']).toBe(1)
    expect(m.objectDiagnostics.dropReasons).toEqual(n.objectDiagnostics.dropReasons)
    expect(assessObjectLoss(m).verdict).toBe('removes')
  })

  it('`(c ? a : na).delete()` — the `na` arm names no family; the target still drops by name', () => {
    const m = host([two[0], '(close > open ? a : na).delete()'])
    expect(m.objectDiagnostics.dropReasons['delete:target']).toBe(1)
  })

  it('a receiver whose family the tokens cannot name is `object.<method>`', () => {
    const lb = 'var b = label.new(bar_index, low, "x")'
    const del = host([two[0], lb, '(close > open ? a : b).delete()'])
    expect(del.objectDiagnostics.unsupported).toContain('object.delete')
    expect(assessObjectLoss(del).verdict).toBe('removes')
    const set = host([two[0], lb, '(close > open ? a : b).set_x(bar_index)'])
    expect(set.objectDiagnostics.unsupported).toContain('object.set_x')
  })

  it('a REFUSED helper whose body deletes `l[1]` still reports the removal (`bodyEffects`)', () => {
    const fn = (s) => [LINE, 'f() =>', `    ${s}`, '    1', 'plot(close + f())']
    const m = host(fn('l[1].delete()'))
    const n = host(fn('line.delete(l[1])'))
    expect(Object.keys(m.objectDiagnostics.dropReasons).some((k) => k.startsWith('fn:')),
      JSON.stringify(m.objectDiagnostics.dropReasons)).toBe(true)
    expect(m.objectDiagnostics.dropReasons).toEqual(n.objectDiagnostics.dropReasons)
    expect(assessObjectLoss(m).verdict).toBe('removes')
    expect(assessObjectLoss(n).verdict).toBe('removes')
  })

  it('a polyline history delete is named (the family is out of scope)', () => {
    const t = host(['p = polyline.new(array.from(chart.point.from_index(bar_index, low)))', 'p[1].delete()'])
    expect(t.objectDiagnostics.unsupported).toContain('object.delete')
  })
})

describe('⛔ REVIEW r1 (IDX-DELETE) — the guards a mutant could remove', () => {
  it('B: inside a loop this reader cannot run (`while`), `l[1].delete()` is loop-blocked, never served', () => {
    const t = host([LINE, 'i = 0', 'while i < 2', '    l[1].delete()', '    i += 1'])
    expect(t.objects ? t.objects.ops.some((o) => o.k === 'delete') : false).toBe(false)
    expect(t.objectDiagnostics.loopBlockedCalls).toContain('line.delete')
    expect(assessObjectLoss(t).verdict).toBe('removes')
  })

  it('G: a REFUSED helper with `l[1].set_x1(…)` keeps the name form lost-geometry count', () => {
    const fn = (s) => [LINE, 'f() =>', `    ${s}`, '    1', 'plot(close + f())']
    const m = host(fn('l[1].set_x1(bar_index)'))
    const n = host(fn('line.set_x1(l[1], bar_index)'))
    expect(Object.keys(m.objectDiagnostics.dropReasons).some((k) => k.startsWith('fn:'))).toBe(true)
    expect(m.objectDiagnostics.dropReasons).toEqual(n.objectDiagnostics.dropReasons)
    expect(m.objectDiagnostics.dropReasons['geometry:lost'] || 0,
      JSON.stringify(m.objectDiagnostics.dropReasons)).toBeGreaterThan(0)
  })

  describe('C: a user `method delete(T)` beside a drawing receiver is refused by name', () => {
    const T = ['type T', '    int x = 0', 'method delete(T this) =>', '    this.x := 1', '    this.x']
    it("`l[1].delete()` (r2: named with the receiver's family)", () => {
      const t = host([...T, LINE, 'l[1].delete()'])
      expect(t.objectDiagnostics.unsupported).toContain('line.delete')
      expect(assessObjectLoss(t).verdict).toBe('removes')
    })
    it('plain `l.delete()` (silent on master too)', () => {
      const t = host([...T, LINE, 'l.delete()'])
      expect(t.objectDiagnostics.unsupported).toContain('line.delete')
      expect(assessObjectLoss(t).verdict).toBe('removes')
    })
    it('⭐ control: the user method on its OWN receiver is not refused', () => {
      const t = host([...T, LINE, 'var u = T.new()', 'u.delete()'])
      expect(t.objectDiagnostics.unsupported).not.toContain('object.delete')
      expect(t.objectDiagnostics.unsupported).not.toContain('line.delete')
    })
    it('r2: a shadowed `t.clear()` is `table.clear`, rated a removal', () => {
      const t = host(['type U', '    int x = 0', 'method clear(U this) =>', '    this.x := 0', '    this.x',
        'var t = table.new(position.top_right, 2, 2)', 'table.cell(t, 0, 0, "a")', 't.clear()'])
      expect(t.objectDiagnostics.unsupported).toContain('table.clear')
      expect(classifyReaderName('table.clear').cls).toBe(LOSS.REMOVES)
    })
  })

  describe('r2: a PLAIN FUNCTION of the same name never shadows dot syntax — served', () => {
    it('`delete(int x) => x + 1` beside `l.delete()` and `l[1].delete()`', () => {
      for (const stmt of ['l.delete()', 'l[1].delete()']) {
        const t = host(['delete(int x) => x + 1', LINE, stmt])
        expect(t.objects.ops.some((o) => o.k === 'delete'), stmt).toBe(true)
        expect(t.objectDiagnostics.unsupported, stmt).toEqual([])
      }
    })
    it('`cell(table x, int c) => x.cell(c, 0, "a")` beside `t.cell(…)`', () => {
      const t = host(['cell(table x, int c) => x.cell(c, 0, "a")', 'var t = table.new(position.top_right, 2, 2)',
        't.cell(1, 0, "b")'])
      expect(t.objects.ops.some((o) => o.k === 'cell')).toBe(true)
      expect(t.objectDiagnostics.unsupported).toEqual([])
    })
  })
})

describe('⭐ CONTROLS — the forms that already worked are unchanged', () => {
  it('plain `l.delete()` targets the register, no history', () => {
    const t = host([LINE, 'l.delete()'])
    expect(t.objects.ops.find((o) => o.k === 'delete').target).toEqual({ r: 'reg', id: 'r0' })
    expect(shape(t)).toEqual(shape(host([LINE, 'line.delete(l)'])))
  })

  it('`a.get(0).delete()` still addresses the collection slot', () => {
    const t = host(['var a = array.new_line()', 'array.push(a, line.new(bar_index - 5, low, bar_index, low))',
      'if array.size(a) > 3', '    a.get(0).delete()'])
    expect(t.objects.ops.find((o) => o.k === 'delete').target).toMatchObject({ r: 'coll' })
  })
})
