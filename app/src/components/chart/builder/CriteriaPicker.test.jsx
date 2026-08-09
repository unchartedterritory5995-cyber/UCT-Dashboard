// ─── THE PICKER, ON ITS OWN ────────────────────────────────────────────────
//
// ⚠️ EVERY CASE HERE RENDERS THE COMPONENT DIRECTLY, AND THAT IS THE LIMIT OF
// WHAT IT CAN PROVE. All of it stays GREEN for the entire time the picker is
// mounted nowhere — which is how eight features shipped this week built, tested,
// green and unreachable. `BuilderSheet.criteria.test.jsx` is the file that fails
// when the wire is cut; this one is the file that fails when the component is
// wrong. They are different questions and they need different files.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import CriteriaPicker, { NUMBER_OPTION } from './CriteriaPicker'
import { parseFormula, TABLE, astHash } from '../engine/ast/parse'
import { vocabulary, toSource } from './criteria'

const VOCAB = vocabulary(TABLE)
const astOf = (src) => {
  const p = parseFormula(src)
  if (!p.ok) throw new Error(`the fixture source did not parse: ${src} — ${p.error}`)
  return p.ast
}

afterEach(cleanup)

function mount({ ast = null, onSourceChange = vi.fn(), onUnrepresentable = vi.fn() } = {}) {
  const out = render(
    <CriteriaPicker ast={ast} onSourceChange={onSourceChange} onUnrepresentable={onUnrepresentable} />,
  )
  return { ...out, onSourceChange, onUnrepresentable }
}

describe('the picker is DERIVED from the tree and emits nothing by deriving', () => {
  it('a tree it can show becomes rows — one per comparison', () => {
    mount({ ast: astOf('(close > open) && (high > low)') })
    expect(screen.getAllByTestId('picker-row')).toHaveLength(2)
    expect(screen.getByTestId('picker-group')).toHaveAttribute('data-join', 'and')
  })

  it('⛔ AND MERELY SHOWING IT NEVER WRITES BACK', () => {
    // If the derivation emitted, switching to the picker would rewrite the text
    // box with the picker's own spelling of the user's formula — a silent edit
    // of the artifact, on a surface whose whole claim is that it does not have
    // one.
    const { onSourceChange } = mount({ ast: astOf('close > open') })
    expect(onSourceChange).not.toHaveBeenCalled()
  })

  it('a formula it CANNOT show reports the refusal and renders no rows', () => {
    const { onUnrepresentable, onSourceChange } = mount({ ast: astOf('sma(close, 20)') })
    expect(screen.queryAllByTestId('picker-row')).toHaveLength(0)
    expect(onUnrepresentable).toHaveBeenCalledTimes(1)
    expect(onUnrepresentable.mock.calls[0][0].guard).toBe('picker:not-a-condition')
    expect(onUnrepresentable.mock.calls[0][0].reason).toMatch(/yes-or-no/i)
    // ⛔ AND IT EMITS NOTHING. A picker that "helpfully" replaced an
    // unrepresentable formula with its nearest representable neighbour is the
    // TC2000 PCF seam with a friendly face.
    expect(onSourceChange).not.toHaveBeenCalled()
  })

  it('a mixed-join tree keeps its nesting rather than flattening it', () => {
    mount({ ast: astOf('(close > open) && ((high > low) || (volume > 1))') })
    const groups = screen.getAllByTestId('picker-group')
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveAttribute('data-join', 'and')
    expect(groups[1]).toHaveAttribute('data-join', 'or')
  })
})

describe('the picker EDITS, and every edit emits a source the parser accepts', () => {
  it('the first condition is added on demand, and its source parses', () => {
    const { onSourceChange } = mount({ ast: null })
    expect(screen.queryAllByTestId('picker-row')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }))
    expect(onSourceChange).toHaveBeenCalledTimes(1)
    const src = onSourceChange.mock.calls[0][0]
    expect(parseFormula(src).ok, src).toBe(true)
    expect(screen.getAllByTestId('picker-row')).toHaveLength(1)
  })

  it('changing a term emits the SAME string `toSource` would spell', () => {
    const { onSourceChange } = mount({ ast: astOf('close > open') })
    fireEvent.change(screen.getByLabelText('Condition 0 left side'), { target: { value: 'high' } })
    const emitted = onSourceChange.mock.calls.at(-1)[0]
    expect(emitted).toBe(toSource({
      kind: 'group',
      join: 'and',
      children: [{
        kind: 'row',
        left: { t: 'name', name: 'high' },
        cmp: '>',
        right: { t: 'name', name: 'open' },
      }],
    }, VOCAB))
    expect(parseFormula(emitted).ok).toBe(true)
  })

  it('⭐ A SCALAR IS IN THE DROPDOWN — E-1 reaching the surface', () => {
    mount({ ast: astOf('close > open') })
    const left = screen.getByLabelText('Condition 0 left side')
    const offered = [...left.options].map((o) => o.value)
    // ⛔ DERIVED. Naming `rs_rank` here would be a fourth place a scalar has to
    // be registered; the assertion is that EVERY declared scalar is offered.
    const missing = [...VOCAB.scalars].filter((s) => !offered.includes(s))
    expect(VOCAB.scalars.size).toBeGreaterThan(50)
    expect(missing).toEqual([])
    expect([...VOCAB.series].filter((s) => !offered.includes(s))).toEqual([])
    // and every TERM-valued function, with no bool-yielding one among them —
    // ⛔ DERIVED, not spelled: a crossing is a ROW, not a term, and offering one
    // in a term slot would build a condition `fromAst` refuses at `picker:term`.
    expect([...VOCAB.functions.keys()].filter((f) => !offered.includes(f))).toEqual([])
    expect(VOCAB.crossings.size).toBeGreaterThan(0)
    expect([...VOCAB.crossings.keys()].filter((f) => offered.includes(f))).toEqual([])
  })

  it('and picking a scalar spells a scalar condition', () => {
    const { onSourceChange } = mount({ ast: astOf('close > open') })
    fireEvent.change(screen.getByLabelText('Condition 0 left side'), { target: { value: 'rs_rank' } })
    fireEvent.change(screen.getByLabelText('Condition 0 right side'), { target: { value: NUMBER_OPTION } })
    fireEvent.change(screen.getByLabelText('Condition 0 right side value'), { target: { value: '80' } })
    expect(onSourceChange.mock.calls.at(-1)[0]).toBe('(rs_rank > 80)')
  })

  it('a function term offers ONE level and its window is editable', () => {
    const { onSourceChange } = mount({ ast: astOf('close > open') })
    fireEvent.change(screen.getByLabelText('Condition 0 right side'), { target: { value: 'sma' } })
    fireEvent.change(screen.getByLabelText('Condition 0 right side sma argument 2'), { target: { value: '50' } })
    const emitted = onSourceChange.mock.calls.at(-1)[0]
    expect(emitted).toBe('(close > sma(open, 50))')
    // ⛔ AND ITS FIRST ARGUMENT IS A NAME PICKER, NEVER ANOTHER FUNCTION. A
    // nested call is refused by `fromAst` at `picker:term`, so offering one
    // would build a condition the picker could not read back.
    const arg = screen.getByLabelText('Condition 0 right side sma argument 1')
    expect([...arg.options].map((o) => o.value)).not.toContain('sma')
  })

  it('the number sentinel cannot collide with a manifest name', () => {
    const declared = new Set([
      ...Object.keys(TABLE.series), ...Object.keys(TABLE.scalars),
      ...Object.keys(TABLE.functions), ...Object.keys(TABLE.operators),
    ])
    expect(declared.has(NUMBER_OPTION)).toBe(false)
    expect(declared.size).toBeGreaterThan(70)
  })

  it('a nested group always carries the OTHER join, so the shape stays canonical', () => {
    const { onSourceChange } = mount({ ast: astOf('close > open') })
    fireEvent.click(screen.getByRole('button', { name: /add an any-of group/i }))
    const emitted = onSourceChange.mock.calls.at(-1)[0]
    // ⛔ THE PROOF IS THE TREE, NOT THE STRING. A nested group carrying the
    // parent's join would flatten on read-back into a picker the user never
    // assembled, and only the hash sees that.
    const ast = parseFormula(emitted).ast
    expect(astHash(ast)).toBe(astHash(astOf('(close > open) && (open > high)')))
  })

  it('removing the last condition emits the EMPTY string rather than a broken shape', () => {
    const { onSourceChange } = mount({ ast: astOf('close > open') })
    fireEvent.click(screen.getByRole('button', { name: /remove condition 0/i }))
    expect(onSourceChange.mock.calls.at(-1)[0]).toBe('')
    expect(screen.queryAllByTestId('picker-row')).toHaveLength(0)
  })

  it('removing the last row of a NESTED group removes the group, not the picker', () => {
    const { onSourceChange } = mount({ ast: astOf('(close > open) && ((high > low) || (volume > 1))') })
    fireEvent.click(screen.getByRole('button', { name: /remove condition 1-0/i }))
    fireEvent.click(screen.getByRole('button', { name: /remove condition 1-0/i }))
    const emitted = onSourceChange.mock.calls.at(-1)[0]
    expect(emitted).toBe('(close > open)')
    expect(screen.getAllByTestId('picker-group')).toHaveLength(1)
  })
})

describe('⭐ THE CROSSING ROW is offered in the SAME control as a comparison', () => {
  // 🔴 THE WIRE FOR THE SECOND SHAPE. `criteria.js` can spell a crossing and
  // read one back with this dropdown offering comparators only — every case in
  // `criteria.test.js` stays green while a member can never reach one. This is
  // the file that fails when the relation control is cut back.

  const relationOptions = () => [...screen.getByLabelText('Condition 0 comparison').options]

  it('the relation dropdown offers EXACTLY the comparators and the crossings', () => {
    // ⛔ DERIVED FROM THE VOCABULARY, so a manifest that declares another
    // two-operand boolean function must reach this control with no edit here —
    // and a control cut back to comparators fails BY NAME.
    mount({ ast: astOf('close > open') })
    expect(VOCAB.crossings.size).toBeGreaterThan(0)
    const offered = relationOptions().map((o) => o.value)
    expect(offered.sort()).toEqual(
      [...VOCAB.comparators, ...VOCAB.crossings.keys()].sort())
  })

  it('and each crossing is LABELLED with the manifest\'s own words, not its name', () => {
    mount({ ast: astOf('close > open') })
    const byValue = new Map(relationOptions().map((o) => [o.value, o.textContent]))
    for (const [name, spec] of VOCAB.crossings) {
      // ⛔ THE VALUE THE SOURCE OWNS, USED — never retyped here.
      expect(byValue.get(name), name).toBe(spec.label)
      expect(byValue.get(name), name).not.toBe(name)
    }
  })

  it('picking a crossing re-shapes the row and emits a CALL, keeping both terms', () => {
    const fn = [...VOCAB.crossings.keys()][0]
    const { onSourceChange } = mount({ ast: astOf('close > open') })
    fireEvent.change(screen.getByLabelText('Condition 0 comparison'), { target: { value: fn } })
    const emitted = onSourceChange.mock.calls.at(-1)[0]
    expect(parseFormula(emitted).ok, emitted).toBe(true)
    // ⛔ THE STRING `toSource` WOULD SPELL, taken from the shipped function.
    expect(emitted).toBe(toSource({
      kind: 'group',
      join: 'and',
      children: [{
        kind: 'cross',
        left: { t: 'name', name: 'close' },
        fn,
        right: { t: 'name', name: 'open' },
      }],
    }, VOCAB))
    expect(screen.getByTestId('picker-row')).toHaveAttribute('data-kind', 'cross')
  })

  it('a TYPED crossing renders as an ordinary row with its relation selected', () => {
    const fn = [...VOCAB.crossings.keys()][0]
    const { onSourceChange } = mount({ ast: astOf(`${fn}(close, sma(open, 50))`) })
    expect(screen.getAllByTestId('picker-row')).toHaveLength(1)
    expect(screen.getByLabelText('Condition 0 comparison')).toHaveValue(fn)
    expect(screen.getByLabelText('Condition 0 right side')).toHaveValue('sma')
    // …and merely SHOWING it wrote nothing back.
    expect(onSourceChange).not.toHaveBeenCalled()
  })

  it('and switching a crossing BACK to a comparison keeps the terms too', () => {
    const fn = [...VOCAB.crossings.keys()][0]
    const cmp = [...VOCAB.comparators][0]
    const { onSourceChange } = mount({ ast: astOf(`${fn}(close, open)`) })
    fireEvent.change(screen.getByLabelText('Condition 0 comparison'), { target: { value: cmp } })
    const emitted = onSourceChange.mock.calls.at(-1)[0]
    expect(emitted).toBe(toSource({
      kind: 'group',
      join: 'and',
      children: [{ kind: 'row', left: { t: 'name', name: 'close' }, cmp, right: { t: 'name', name: 'open' } }],
    }, VOCAB))
    expect(screen.getByTestId('picker-row')).toHaveAttribute('data-kind', 'row')
  })

  it('a crossing sits in a GROUP beside comparisons, and the whole group round-trips', () => {
    const fn = [...VOCAB.crossings.keys()][0]
    const src = `${fn}(close, open) && (high > low)`
    const { onSourceChange } = mount({ ast: astOf(src) })
    expect(screen.getAllByTestId('picker-row')).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Condition 0 left side'), { target: { value: 'low' } })
    const emitted = onSourceChange.mock.calls.at(-1)[0]
    expect(astHash(parseFormula(emitted).ast))
      .toBe(astHash(astOf(`${fn}(low, open) && (high > low)`)))
  })
})

describe('⭐ THE FLAG ROW — a yes-or-no name sits beside the comparisons', () => {
  // 🔴 THE WIRE FOR THE THIRD SHAPE. `criteria.js` can spell a flag and read one
  // back with this component rendering nothing for it — every case in
  // `criteria.test.js` stays green while a member opening the firm's own starter
  // sees a row that is not there, or a comparison with no terms in it. This is
  // the file that fails when the flag control is cut.

  const someFlag = () => [...VOCAB.flags.keys()][0]
  const flagSelect = () => screen.getByLabelText('Condition 0 fact')

  it('a TYPED boolean name renders as ONE row of its own kind, and shows nothing back', () => {
    const name = someFlag()
    const { onSourceChange } = mount({ ast: astOf(name) })
    expect(screen.getAllByTestId('picker-row')).toHaveLength(1)
    expect(screen.getByTestId('picker-row')).toHaveAttribute('data-kind', 'flag')
    expect(flagSelect()).toHaveValue(name)
    // ⛔ AND IT HAS NO COMPARISON. A flag rendered through the comparison editor
    // would put a relation dropdown and two empty term slots on screen for a
    // formula that says none of that.
    expect(screen.queryByLabelText('Condition 0 comparison')).toBeNull()
    expect(screen.queryByLabelText('Condition 0 left side')).toBeNull()
    expect(onSourceChange).not.toHaveBeenCalled()
  })

  it('the flag control offers EXACTLY the vocabulary\'s flags, with the manifest\'s own words', () => {
    // ⛔ DERIVED, so a manifest that declares another boolean scalar reaches this
    // control with no edit here — and a control cut back to a curated list fails
    // BY NAME. The labels are read off the vocabulary, never retyped.
    mount({ ast: astOf(someFlag()) })
    expect(VOCAB.flags.size).toBeGreaterThan(0)
    const options = [...flagSelect().options]
    expect(options.map((o) => o.value).sort()).toEqual([...VOCAB.flags.keys()].sort())
    const byValue = new Map(options.map((o) => [o.value, o.textContent]))
    for (const [name, spec] of VOCAB.flags) {
      expect(byValue.get(name), name).toBe(spec.label)
      expect(byValue.get(name), name).not.toBe(name)
    }
  })

  it('changing the flag emits the string `toSource` would spell', () => {
    const names = [...VOCAB.flags.keys()]
    const { onSourceChange } = mount({ ast: astOf(names[0]) })
    fireEvent.change(flagSelect(), { target: { value: names[1] } })
    const emitted = onSourceChange.mock.calls.at(-1)[0]
    expect(emitted).toBe(toSource({
      kind: 'group', join: 'and', children: [{ kind: 'flag', name: names[1] }],
    }, VOCAB))
    expect(parseFormula(emitted).ok, emitted).toBe(true)
  })

  it('a flag can be ADDED with clicks, and what it emits parses', () => {
    const { onSourceChange } = mount({ ast: astOf('close > open') })
    fireEvent.click(screen.getByRole('button', { name: /add a yes-or-no fact/i }))
    const emitted = onSourceChange.mock.calls.at(-1)[0]
    expect(parseFormula(emitted).ok, emitted).toBe(true)
    expect(screen.getAllByTestId('picker-row')).toHaveLength(2)
    expect(screen.getAllByTestId('picker-row')[1]).toHaveAttribute('data-kind', 'flag')
    expect(astHash(parseFormula(emitted).ast))
      .toBe(astHash(astOf(`(close > open) && ${[...VOCAB.flags.keys()][0]}`)))
  })

  it('🔴 THE SHIPPED STARTER\'S SHAPE renders BOTH kinds and round-trips through the picker', () => {
    // ⭐ THE CASE THE WHOLE TASK IS FOR: the firm's surviving starter is a
    // comparison, a bare boolean scalar and a NEGATIVE threshold in one group.
    // Before this task the picker rendered none of it.
    const src = 'rs_rank >= 80 && above_50sma && pct_vs_ema20 >= -2 && pct_vs_ema20 <= 2'
    const { onSourceChange } = mount({ ast: astOf(src) })
    const rows = screen.getAllByTestId('picker-row')
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(['row', 'flag', 'row', 'row'])
    expect(onSourceChange).not.toHaveBeenCalled()
    // …and one edit re-emits the WHOLE group, negative threshold intact.
    fireEvent.change(screen.getByLabelText('Condition 0 right side value'), { target: { value: '90' } })
    const emitted = onSourceChange.mock.calls.at(-1)[0]
    expect(astHash(parseFormula(emitted).ast)).toBe(astHash(astOf(
      'rs_rank >= 90 && above_50sma && pct_vs_ema20 >= -2 && pct_vs_ema20 <= 2')))
  })

  it('a NEGATIVE threshold is EDITABLE, and a function\'s window is still not', () => {
    // ⛔ THE ASYMMETRY IS THE MANIFEST'S. A row's term is a magnitude and the
    // firm screens on a negative one; a function's `int` argument is a LOOKBACK
    // (`lookback: "arg1"`), and `criteria.leafSource` refuses a negative literal
    // inside a call — so a control that offered one would build source the
    // picker could not read back.
    const { onSourceChange } = mount({ ast: astOf('pct_vs_ema20 >= 2') })
    fireEvent.change(screen.getByLabelText('Condition 0 right side value'), { target: { value: '-2' } })
    expect(onSourceChange.mock.calls.at(-1)[0]).toBe('(pct_vs_ema20 >= -2)')

    cleanup()
    const second = mount({ ast: astOf('close > sma(open, 50)') })
    const window = screen.getByLabelText('Condition 0 right side sma argument 2')
    expect(window).toHaveAttribute('min', '0')
    fireEvent.change(window, { target: { value: '-5' } })
    expect(second.onSourceChange.mock.calls.at(-1)[0]).toBe('(close > sma(open, 0))')
  })
})

describe('no new chrome', () => {
  it('every glyph is a UIcon and not one emoji reaches the DOM', () => {
    const { container } = mount({ ast: astOf('(close > open) && (high > low)') })
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0)
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('and the stylesheet is the SHEET\'s, not a second one', async () => {
    // ⛔ Spec §1.5. A second `.module.css` for one surface is how a sheet ends
    // up with two button heights and two focus rings.
    const fs = await import('node:fs')
    const path = await import('node:path')
    const here = path.join(process.cwd(), 'src', 'components', 'chart', 'builder', 'CriteriaPicker.jsx')
    const src = fs.readFileSync(here, 'utf8')
    const imports = [...src.matchAll(/from\s+'([^']*\.css)'/g)].map((m) => m[1])
    expect(imports).toEqual(['./BuilderSheet.module.css'])
  })
})
