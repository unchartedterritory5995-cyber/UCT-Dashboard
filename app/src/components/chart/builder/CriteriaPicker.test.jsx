// ─── THE PICKER, ON ITS OWN ────────────────────────────────────────────────
//
// ⚠️ EVERY CASE HERE RENDERS THE COMPONENT DIRECTLY, AND THAT IS THE LIMIT OF
// WHAT IT CAN PROVE. All of it stays GREEN for the entire time the picker is
// mounted nowhere — which is how eight features shipped this week built, tested,
// green and unreachable. `BuilderSheet.criteria.test.jsx` is the file that fails
// when the wire is cut; this one is the file that fails when the component is
// wrong. They are different questions and they need different files.

import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import CriteriaPicker, { NUMBER_OPTION, defaultConditionSource } from './CriteriaPicker'
import { parseFormula, TABLE, astHash } from '../engine/ast/parse'
import { vocabulary, toSource, fromSource, canonicalPicker } from './criteria'

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
    // ⛔ THE CLAIM IS THE JOIN, SO THE JOIN IS WHAT IS ASSERTED.
    // ⚰️ This used to hash the emitted tree against a hand-built
    // `(close > open) && (<seed row>)`. That spelled the SEED into a case about
    // the JOIN twice over: first as the literal `(open > high)`, then as
    // `defaultConditionSource()` — and it broke AGAIN the moment the seed grew to
    // two rows (which is what makes the group survive its own round trip at all).
    // Reading the structure back is immune to both.
    const back = fromSource(emitted)
    const group = back && (back.group || back)
    expect(group.join, 'the outer group lost its join').toBe('and')
    const nested = (group.children || []).filter((c) => c.kind === 'group')
    expect(nested, `no nested group in ${emitted}`).toHaveLength(1)
    expect(nested[0].join, 'a nested group carrying its parent`s join flattens on read-back')
      .toBe('or')
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

describe('⭐ THE NEGATION TOGGLE — the fourth shape, on the condition it wraps', () => {
  // 🔴 THE WIRE FOR THE SHAPE THAT IS NOT A ROW. `criteria.js` can read `!x`
  // back, spell it and normalise it with this component rendering no control for
  // it at all — every case in `criteria.test.js` stays green while a member can
  // neither see that their formula is negated nor negate one. This is the file
  // that fails when the toggle is cut.

  const negateRow = (where = '0') => screen.getByLabelText(`Negate condition ${where}`)

  it('every row carries the toggle, and it is OFF for a plain condition', () => {
    mount({ ast: astOf('(close > open) && above_50sma') })
    const rows = screen.getAllByTestId('picker-row')
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(['row', 'flag'])
    // ⛔ EVERY row shape, not just the comparison — a flag is a condition too,
    // and `!above_50sma` is the sentence a member reaches for first.
    expect(rows.every((r) => r.getAttribute('data-negated') === 'false')).toBe(true)
    expect(negateRow('0')).not.toBeChecked()
    expect(negateRow('1')).not.toBeChecked()
  })

  it('turning it ON emits the string `toSource` would spell, and re-shapes nothing else', () => {
    const { onSourceChange } = mount({ ast: astOf('close > open') })
    fireEvent.click(negateRow())
    const emitted = onSourceChange.mock.calls.at(-1)[0]
    expect(parseFormula(emitted).ok, emitted).toBe(true)
    // ⛔ THE STRING THE SHIPPED FUNCTION SPELLS, never a string retyped here.
    expect(emitted).toBe(toSource({
      kind: 'group',
      join: 'and',
      children: [{
        kind: 'not',
        child: { kind: 'row', left: { t: 'name', name: 'close' }, cmp: '>', right: { t: 'name', name: 'open' } },
      }],
    }, VOCAB))
    expect(screen.getByTestId('picker-row')).toHaveAttribute('data-negated', 'true')
  })

  it('a TYPED negation renders the toggle CHECKED, on the row it wraps — and writes nothing back', () => {
    const { onSourceChange } = mount({ ast: astOf('!(close > open)') })
    // ⛔ ONE ROW, NOT A ROW INSIDE A BOX. A negation is the condition said the
    // other way round, so it must not put a second container on screen for a
    // difference that is the grammar's rather than the member's.
    expect(screen.getAllByTestId('picker-row')).toHaveLength(1)
    expect(screen.getByTestId('picker-row')).toHaveAttribute('data-negated', 'true')
    expect(negateRow()).toBeChecked()
    expect(screen.getByLabelText('Condition 0 left side')).toHaveValue('close')
    expect(screen.getByLabelText('Condition 0 comparison')).toHaveValue('>')
    expect(onSourceChange).not.toHaveBeenCalled()
  })

  it('and turning it OFF hands back the bare condition', () => {
    const { onSourceChange } = mount({ ast: astOf('!(close > open)') })
    fireEvent.click(negateRow())
    expect(onSourceChange.mock.calls.at(-1)[0]).toBe('(close > open)')
    expect(screen.getByTestId('picker-row')).toHaveAttribute('data-negated', 'false')
  })

  it('editing a term INSIDE a negated row keeps the negation', () => {
    // ⭐ THE WRAPPER SURVIVES AN EDIT OF WHAT IT WRAPS. A component that
    // unwrapped to render and forgot to put the wrapper back would silently drop
    // the member's negation on their next keystroke — a lossy edit, and the one
    // failure mode of rendering a wrapper as a property.
    const { onSourceChange } = mount({ ast: astOf('!(close > open)') })
    fireEvent.change(screen.getByLabelText('Condition 0 left side'), { target: { value: 'high' } })
    const emitted = onSourceChange.mock.calls.at(-1)[0]
    expect(astHash(parseFormula(emitted).ast)).toBe(astHash(astOf('!(high > open)')))
  })

  it('a NESTED GROUP has one too, and the ROOT does not', () => {
    // ⛔ THE ROOT IS THE WHOLE FORMULA'S FRAME — `fromAst` hands a top-level
    // negation back as a one-child group wrapping it, so a negated root is a
    // shape the model has no spelling for. Same reason the root has no remove
    // button, and it is asserted rather than left to be noticed.
    const { onSourceChange } = mount({ ast: astOf('(close > open) && ((high > low) || (volume > 1))') })
    expect(screen.queryByLabelText('Negate group top')).toBeNull()
    const nested = screen.getByLabelText('Negate group 1')
    expect(nested).not.toBeChecked()
    fireEvent.click(nested)
    const emitted = onSourceChange.mock.calls.at(-1)[0]
    expect(astHash(parseFormula(emitted).ast))
      .toBe(astHash(astOf('(close > open) && !((high > low) || (volume > 1))')))
    expect(screen.getAllByTestId('picker-group')[1]).toHaveAttribute('data-negated', 'true')
  })

  it('a TYPED negated group renders nested, checked, with its rows editable', () => {
    const src = '(close > open) && !((high > low) || (volume > 1))'
    const { onSourceChange } = mount({ ast: astOf(src) })
    expect(screen.getAllByTestId('picker-group')).toHaveLength(2)
    expect(screen.getByLabelText('Negate group 1')).toBeChecked()
    fireEvent.change(screen.getByLabelText('Condition 1-0 left side'), { target: { value: 'low' } })
    expect(astHash(parseFormula(onSourceChange.mock.calls.at(-1)[0]).ast))
      .toBe(astHash(astOf('(close > open) && !((low > low) || (volume > 1))')))
  })

  it('emptying a NEGATED group removes it, rather than leaving a negation of nothing', () => {
    // ⛔ THE PRUNE LOOKS THROUGH THE WRAPPER. A prune that only recognised the
    // bare shape would leave `!(<no rows>)` in the model, and `canonicalPicker`
    // refuses that — so the failure would surface as a throw out of an edit
    // rather than as a row disappearing.
    const { onSourceChange } = mount({ ast: astOf('(close > open) && !((high > low) || (volume > 1))') })
    fireEvent.click(screen.getByRole('button', { name: /remove condition 1-0/i }))
    fireEvent.click(screen.getByRole('button', { name: /remove condition 1-0/i }))
    expect(onSourceChange.mock.calls.at(-1)[0]).toBe('(close > open)')
    expect(screen.getAllByTestId('picker-group')).toHaveLength(1)
  })

  it('a negated FLAG is one control and a toggle — not a comparison with an empty side', () => {
    const name = [...VOCAB.flags.keys()][0]
    const { onSourceChange } = mount({ ast: astOf(name) })
    fireEvent.click(negateRow())
    const emitted = onSourceChange.mock.calls.at(-1)[0]
    expect(emitted).toBe(toSource({
      kind: 'group', join: 'and', children: [{ kind: 'not', child: { kind: 'flag', name } }],
    }, VOCAB))
    expect(screen.getByTestId('picker-row')).toHaveAttribute('data-kind', 'flag')
    expect(screen.queryByLabelText('Condition 0 comparison')).toBeNull()
  })

  it('⛔ AND NO SEQUENCE OF CLICKS BUILDS `!!x` — the toggle REPLACES the wrapper', () => {
    // `criteria.js` refuses a chain on all three of its sides; this is the half
    // that says the UI cannot ask it to. Toggling twice returns to the bare
    // condition rather than stacking a second negation.
    const { onSourceChange } = mount({ ast: astOf('close > open') })
    fireEvent.click(negateRow())
    fireEvent.click(negateRow())
    fireEvent.click(negateRow())
    const emitted = onSourceChange.mock.calls.at(-1)[0]
    expect(emitted).toBe(toSource({
      kind: 'group',
      join: 'and',
      children: [{
        kind: 'not',
        child: { kind: 'row', left: { t: 'name', name: 'close' }, cmp: '>', right: { t: 'name', name: 'open' } },
      }],
    }, VOCAB))
    expect(parseFormula(emitted).ok).toBe(true)
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

// ─── "ADD AN ANY-OF GROUP" HAS TO SURVIVE THE ROUND TRIP ────────────────────
//
// ⚰️ MEASURED IN THE LIVE BUILDER 2026-08-11. Clicking it produced a row that
// looked exactly like an AND sibling — same indent, no nested Match control,
// labelled `Condition 1` — and the group was GONE. The picker rebuilds its state
// from the SOURCE TEXT on every edit, and a one-child group serialises to
// `(close > open)`: textually identical to a bare condition. A member could never
// add a second row to a group that no longer existed, so the any-of feature was
// unreachable through the UI.
describe('🔴 a new any-of group survives being written out and read back', () => {
  it('emits a real OR group, not two ANDed rows', () => {
    const { onSourceChange } = mount({ ast: astOf('close > open') })
    fireEvent.click(screen.getByRole('button', { name: /add an any-of group/i }))
    const emitted = onSourceChange.mock.calls.at(-1)[0]
    // ⭐ The `||` is the whole point — without it the group evaporated.
    expect(emitted, `no OR in the emitted source: ${emitted}`).toContain('||')
  })

  it('⛔ AND IT READS BACK AS A GROUP — the half that was broken', () => {
    // Emitting `||` is not enough; the picker must SEE a group when it re-reads
    // its own output, because that round trip is what erased it.
    const { onSourceChange } = mount({ ast: astOf('close > open') })
    fireEvent.click(screen.getByRole('button', { name: /add an any-of group/i }))
    const back = fromSource(onSourceChange.mock.calls.at(-1)[0])
    const group = back && (back.group || back)
    const kinds = (group.children || []).map((c) => c.kind)
    expect(kinds, `read back as ${JSON.stringify(kinds)} — the group did not survive`)
      .toContain('group')
  })

  it('⛔ THE CONTROL — a ONE-child group is what used to vanish', () => {
    // Pins the mechanism rather than the symptom: if a future change makes a
    // one-child group survive, this seed can go back to one row.
    const oneChild = {
      kind: 'group',
      join: 'and',
      children: [
        { kind: 'row', left: { t: 'name', name: 'close' }, cmp: '>', right: { t: 'num', value: 0 } },
        { kind: 'group', join: 'or', children: [
          { kind: 'row', left: { t: 'name', name: 'close' }, cmp: '>', right: { t: 'name', name: 'open' } },
        ] },
      ],
    }
    const back = fromSource(toSource(canonicalPicker(oneChild)))
    const group = back && (back.group || back)
    expect((group.children || []).map((c) => c.kind)).toEqual(['row', 'row'])
  })
})

// ─── A CSS REGRESSION jsdom CANNOT SEE ──────────────────────────────────────
//
// ⛔ THIS SCANS THE STYLESHEET, and that is deliberate rather than lazy. jsdom
// performs no layout, so a rendered assertion cannot tell a readable control from
// a collapsed one — the same blindness `BuilderSheet.test.jsx` documents for
// `pointer-events`, where a literally un-clickable button kept twenty-three click
// tests green. A mutation run confirmed it: reverting this rule broke NOTHING.
//
// ⚰️ MEASURED IN THE LIVE BUILDER 2026-08-11. `.pickerSelect { flex: 1 1 0;
// min-width: 0 }` let the term select shrink below its own text once the 96px
// number input joined the row, and "a number" rendered as **"a nu"** — a control
// whose own label was cut mid-word.
describe('🔴 the term select cannot collapse below its own label', () => {
  // ⛔ COMMENTS STRIPPED FIRST, AND THAT IS NOT TIDINESS. A selector is found by
  // splitting the text before `{` on commas — and the prose above these rules
  // contains commas, so an un-stripped comment shatters the selector into
  // fragments and the block is silently NOT FOUND. The probe then reads an
  // OVERRIDDEN value from an earlier block and fails a rule that is correct,
  // which is the worst kind of red: it accuses the source of the probe's bug.
  const css = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/chart/builder/BuilderSheet.module.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  /** Every block whose selector list contains `sel` exactly, in source order.
   *  ⛔ No regex: the selector starts with a dot and the body is full of braces
   *  and colons, and an escaped-backslash slip in the pattern silently matches
   *  NOTHING — which reads as "the rule is fine" rather than as a broken probe. */
  const blocksFor = (sel) => css.split('}').flatMap((block) => {
    const at = block.lastIndexOf('{')
    if (at === -1) return []
    const selectors = block.slice(0, at).split(',').map((s) => s.trim())
    return selectors.includes(sel) ? [block.slice(at + 1)] : []
  })

  const ruleFor = (sel) => (blocksFor(sel).length ? blocksFor(sel).join('\n') : null)

  /** ⛔ THE EFFECTIVE VALUE, NOT THE FIRST ONE. `.pickerSelect` appears TWICE —
   *  once in a shared block with `.pickerNum` (which legitimately keeps
   *  `min-width: 0`) and once on its own. Reading the first block reported the
   *  overridden value and failed a rule that was correct; the cascade means the
   *  LAST declaration is the one on screen. */
  const effective = (sel, prop) => {
    let value = null
    for (const body of blocksFor(sel)) {
      for (const decl of body.split(';')) {
        const [k, v] = decl.split(':')
        if (k && v && k.trim() === prop) value = v.trim()
      }
    }
    return value
  }

  it('declares a floor wide enough for "a number"', () => {
    expect(ruleFor('.pickerSelect'), '.pickerSelect not found — did the class move?')
      .toBeTruthy()
    const min = effective('.pickerSelect', 'min-width')
    expect(min, '.pickerSelect declares no min-width at all').toBeTruthy()
    expect(min, 'the select may collapse below its own text again').not.toBe('0')
  })

  it('and the row WRAPS rather than truncating when it cannot fit', () => {
    const rule = ruleFor('.pickerArgs')
    expect(rule).toBeTruthy()
    expect(rule, 'without wrapping, a narrow width clips instead of reflowing')
      .toMatch(/flex-wrap:\s*wrap/)
  })

  it('⛔ THE CONTROL — the scan can SEE a missing declaration', () => {
    // Without this the two cases above would pass on a regex that matched nothing.
    expect(effective('.pickerCmp', 'min-width')).toBeNull()
    expect(ruleFor('.__no_such_class__')).toBeNull()
    // …and it can read a value it IS looking at, so a null never means "broken".
    expect(effective('.pickerNum', 'flex')).toBe('0 1 96px')
  })
})
