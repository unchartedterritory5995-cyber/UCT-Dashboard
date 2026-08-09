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
    // and every TERM-valued function, with no bool-yielding one among them.
    expect([...VOCAB.functions.keys()].filter((f) => !offered.includes(f))).toEqual([])
    expect(offered).not.toContain('crossOver')
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
