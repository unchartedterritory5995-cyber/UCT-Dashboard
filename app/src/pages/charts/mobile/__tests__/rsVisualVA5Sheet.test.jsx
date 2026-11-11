// app/src/pages/charts/mobile/__tests__/rsVisualVA5Sheet.test.jsx
//
// UCT RS Phase 2a VISUAL, unit VA5 (spec A5b, A5c) — the phone study editor:
//   A5b  chip rows with more than 3 options, or any option label over 12
//        characters, STACK (label on its own line, chips under it, wrapping);
//        Preset and Benchmark stack, Average type stays inline; the preset's
//        origin line sits under its chips; chips keep a 44px hit area.
//   A5c  every colour row stacks and shows its CURRENT colour, marked, even when
//        the palette does not hold it — exactly one swatch pressed per row; a
//        fresh Classic instance marks #6ba3be on "Line above avg" and #8a8574 on
//        "Average colour"; swatches are 44px targets around a 30px circle.
// jsdom computes no layout, so line counts and the 844px fold stay with the
// re-capture frames; the CSS declarations that produce them are asserted here.
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { render, screen, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, afterEach } from 'vitest'
import MobileIndicatorSheet from '../MobileIndicatorSheet'
import * as engineRegistry from '../../../../components/chart/engine/nativeRegistry'

afterEach(() => { cleanup() })

const PALETTE = ['#7b68ee', '#38bdf8', '#f472b6', '#c9a84c', '#4ade80', '#f87171', '#e0dac8', '#fb923c']

function Harness({ initial, initialEditing, onWrite }) {
  const [cs, setCs] = useState(initial)
  return (
    <MobileIndicatorSheet open onClose={vi.fn()} cs={cs}
      onWrite={(next) => { onWrite(next); setCs(next) }}
      onBrowseLibrary={vi.fn()} onOpenSettings={vi.fn()} initialEditing={initialEditing} />
  )
}
const mount = (initial, initialEditing) => {
  const onWrite = vi.fn()
  render(<Harness initial={initial} initialEditing={initialEditing} onWrite={onWrite} />)
  return onWrite
}

const RS = 'rsLine'
const RS_EDITOR = 'UCT Relative Strength settings'
const rsDef = () => engineRegistry.getDefinition(RS)
const rsCs = () => ({ indicatorInstances: [{ instanceId: 'rs-1', defId: RS, inputs: {}, hidden: false }] })
const rsEditing = { kind: 'study', defId: RS, instanceId: 'rs-1' }
const editor = () => screen.getByRole('dialog', { name: RS_EDITOR })
const rowFor = (key) => editor().querySelector(`[data-input-key="${key}"]`)
const headNamed = (name) => [...editor().querySelectorAll('button[aria-expanded]')].find((b) => b.textContent === name)
const pressed = (row) => [...row.querySelectorAll('button[aria-pressed="true"]')]

const sheetCss = () => readFileSync(join(process.cwd(), 'src/pages/charts/mobile/MobileCharts.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const ruleOf = (css, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&')
  const m = new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`).exec(css)
  return m ? m[1] : null
}

describe('A5b — the stacking rule', () => {
  test('Preset: the label first, alone, then every chip in one wrapping block, then the origin line', () => {
    mount(rsCs(), rsEditing)
    const row = within(editor()).getByTestId('preset-row')
    const line = row.firstElementChild
    expect(line.className).toMatch(/paramRowStacked/)
    expect(line.children[0].textContent).toBe('Preset')
    const block = line.children[1]
    expect(block.className).toMatch(/chipsStacked/)
    const ids = [...block.children].map((c) => c.dataset.presetId)
    // 3-08: with no server declaration the four Phase 3 presets are hidden
    expect(ids).toEqual([...rsDef().meta.presets.filter((p) => p.requiresServer !== true).map((p) => p.id), '__custom'])
    const origin = within(row).getByTestId('preset-origin')
    expect(origin.className).toMatch(/presetOrigin/)
    expect(origin.previousElementSibling).toBe(line)
  })

  test('Benchmark stacks; Average type (Exponential / Simple) stays inline', async () => {
    const user = userEvent.setup()
    mount(rsCs(), rsEditing)
    expect(rowFor('benchmark').dataset.stacked).toBe('true')
    expect(rowFor('benchmark').querySelector('[class*="chipsStacked"]')).not.toBeNull()
    await user.click(headNamed('Line'))
    expect(rowFor('maType').dataset.stacked).toBeUndefined()
    expect(rowFor('maType').querySelector('[class*="paramRowStacked"]')).toBeNull()
  })

  test('the CSS: a stacked row is a column, its chips start left and wrap with 8px gaps; chips hit 44px', () => {
    const css = sheetCss()
    expect(ruleOf(css, '.paramRowStacked')).toMatch(/flex-direction:\s*column/)
    const chips = ruleOf(css, '.chipsStacked')
    expect(chips).toMatch(/justify-content:\s*flex-start/)
    expect(chips).toMatch(/gap:\s*8px/)
    expect(chips).toMatch(/max-width:\s*none/)
    expect(ruleOf(css, '.chipsWrap')).toMatch(/flex-wrap:\s*wrap/)
    // 38px visual + 3px above + 3px below = 44px.
    expect(ruleOf(css, '.chipOpt')).toMatch(/min-height:\s*38px/)
    expect(ruleOf(css, '.chipOpt')).toMatch(/position:\s*relative/)
    expect(ruleOf(css, '.chipOpt::after')).toMatch(/inset:\s*-3px 0/)
    expect(ruleOf(css, '.presetOrigin')).toMatch(/font-size:\s*12px/)
    expect(ruleOf(css, '.presetOrigin')).toMatch(/color:\s*var\(--text-muted\)/)
    expect(ruleOf(css, '.paramRowStacked > .indName')).toMatch(/white-space:\s*nowrap/)
  })
})

describe('A5c — swatches: the current colour, always present, always marked', () => {
  const offered = (row) => [...row.querySelectorAll('button[data-colour]')].map((b) => b.dataset.colour)

  test('the set: current (off-palette) first, then the default, then the palette, deduped case-insensitively', async () => {
    const user = userEvent.setup()
    // current #6ba3be is also the default: one swatch, then the palette.
    mount(rsCs(), rsEditing)
    await user.click(headNamed('Line'))
    expect(offered(rowFor('color'))).toEqual(['#6ba3be', ...PALETTE])
    cleanup()
    // An off-palette stored colour leads, the default follows, then the palette.
    mount({ indicatorInstances: [{ instanceId: 'rs-1', defId: RS, inputs: { color: '#123456' }, hidden: false }] }, rsEditing)
    await user.click(headNamed('Line'))
    expect(offered(rowFor('color'))).toEqual(['#123456', '#6ba3be', ...PALETTE])
    expect(pressed(rowFor('color')).map((b) => b.dataset.colour)).toEqual(['#123456'])
    cleanup()
    // A stored palette colour in capitals keeps its palette place and is marked there.
    mount({ indicatorInstances: [{ instanceId: 'rs-1', defId: RS, inputs: { color: '#F472B6' }, hidden: false }] }, rsEditing)
    await user.click(headNamed('Line'))
    expect(offered(rowFor('color'))).toEqual(['#6ba3be', ...PALETTE])
    expect(pressed(rowFor('color')).map((b) => b.dataset.colour)).toEqual(['#f472b6'])
  })

  test('on a fresh Classic instance every colour row is stacked and marks exactly one swatch, the drawn colour', async () => {
    const user = userEvent.setup()
    mount(rsCs(), rsEditing)
    // VA2: the colour rows live in the plan's five folded groups
    for (const g of ['Line', 'New highs', 'Stress test', 'Method']) await user.click(headNamed(g))
    const colours = rsDef().inputs.filter((i) => i.type === 'color')
    expect(colours.length).toBeGreaterThan(5)
    for (const input of colours) {
      const row = rowFor(input.key)
      expect(row.dataset.stacked, input.key).toBe('true')
      const on = pressed(row)
      expect(on, input.key).toHaveLength(1)
      expect(on[0].dataset.colour, input.key).toBe(input.default.toLowerCase())
      // the label is the declared text, whole
      expect(row.querySelector('[class*="indName"]').textContent, input.key).toBe(input.label)
    }
    expect(pressed(rowFor('color'))[0].dataset.colour).toBe('#6ba3be')
    expect(pressed(rowFor('maColor'))[0].dataset.colour).toBe('#8a8574')
  })

  test('choosing a palette swatch writes it, moves the mark, and keeps the default on offer', async () => {
    const user = userEvent.setup()
    const onWrite = mount(rsCs(), rsEditing)
    await user.click(headNamed('Line'))
    const row = () => rowFor('maColor')
    await user.click(within(row()).getByRole('button', { name: 'Average colour #f472b6' }))
    expect(onWrite).toHaveBeenCalledTimes(1)
    const inst = onWrite.mock.calls[0][0].indicatorInstances.find((i) => i.instanceId === 'rs-1')
    expect(inst.inputs.maColor).toBe('#f472b6')
    expect(pressed(row()).map((b) => b.dataset.colour)).toEqual(['#f472b6'])
    expect([...row().querySelectorAll('button[data-colour]')].map((b) => b.dataset.colour))
      .toEqual(['#8a8574', ...PALETTE])
  })

  test('the CSS: a swatch is a 44px button around a 30px circle; the mark is the ring with a surface gap', () => {
    const css = sheetCss()
    const sw = ruleOf(css, '.swatch')
    expect(sw).toMatch(/width:\s*var\(--tap-min\)/)
    expect(sw).toMatch(/height:\s*var\(--tap-min\)/)
    const dot = ruleOf(css, '.swatch::before')
    expect(dot).toMatch(/width:\s*30px/)
    expect(dot).toMatch(/background:\s*var\(--sw/)
    expect(ruleOf(css, '.swatchOn::before')).toMatch(/0 0 0 2px var\(--bg-surface\),\s*0 0 0 4px var\(--text-bright\)/)
    expect(ruleOf(css, '.swatches')).toMatch(/flex-wrap:\s*wrap/)
  })
})

describe('control — a definition with short enums keeps inline rows', () => {
  test('RSI\'s period stepper row is not stacked and its editor has no preset row', () => {
    const initial = { indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: {}, hidden: false }] }
    mount(initial, { kind: 'study', defId: 'rsi' })
    const ed = screen.getByRole('dialog', { name: 'Relative Strength Index settings' })
    expect(ed.querySelector('[data-input-key="period"]').dataset.stacked).toBeUndefined()
    expect(within(ed).queryByTestId('preset-row')).toBeNull()
  })
})
