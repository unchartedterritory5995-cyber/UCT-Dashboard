/**
 * Wave 11 (lane 11B): the formula editor — pick properties by NAME, see the live
 * value, and read every error as text. Keyboard-only paths included.
 */
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FormulaEditor from './FormulaEditor'

const DEFS = [
  { id: 'e1', name: 'Entry', type: 'number', source: 'user_set' },
  { id: 's1', name: 'Stop', type: 'number', source: 'user_set' },
  { id: 'x1', name: 'Exit', type: 'number', source: 'user_set' },
  { id: 'notes', name: 'Notes', type: 'text', source: 'user_set' },
  { id: 'builtin:ticker', name: 'Ticker', type: 'text', source: 'financial_derived' },
  { id: 'r1', name: 'R', type: 'formula', source: 'user_set', computed: true,
    config: { expression: '({@x1} - {@e1}) / ({@e1} - {@s1})' } },
]

function Harness({ initial = '', ...props }) {
  const [text, setText] = useState(initial)
  return (
    <>
      <FormulaEditor value={text} onChange={setText} defs={DEFS} {...props} />
      <span data-testid="text">{text}</span>
    </>
  )
}

describe('FormulaEditor', () => {
  it('names every control: the starter picker, the formula box and the insert group', () => {
    render(<Harness />)
    expect(screen.getByRole('combobox', { name: 'Start from a trader formula' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Formula' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Insert a property' })).toBeTruthy()
  })

  it('offers only number and formula properties to insert, by name', () => {
    render(<Harness />)
    const names = screen.getAllByRole('button', { name: /^Insert / }).map((b) => b.textContent)
    expect(names).toEqual(['Entry', 'Stop', 'Exit', 'R'])
  })

  it('never offers the formula being edited to itself', () => {
    render(<Harness selfId="r1" />)
    expect(screen.queryByRole('button', { name: 'Insert R' })).toBeNull()
  })

  it('a click on a property inserts {Name} at the caret, and focus goes back to the formula', async () => {
    const user = userEvent.setup()
    render(<Harness initial="() / 2" />)
    const box = screen.getByRole('textbox', { name: 'Formula' })
    box.focus()
    box.setSelectionRange(1, 1)
    await user.click(screen.getByRole('button', { name: 'Insert Exit' }))
    expect(screen.getByTestId('text').textContent).toBe('({Exit}) / 2')
    await new Promise((r) => requestAnimationFrame(r))
    expect(document.activeElement).toBe(box)
  })

  it('KEYBOARD: Tab to a property and press Enter to insert it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    screen.getByRole('textbox', { name: 'Formula' }).focus()
    await user.tab()       // Entry
    await user.tab()       // Stop
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Insert Stop' }))
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('text').textContent).toBe('{Stop}')
  })

  it('shows the live value on the open note', async () => {
    const user = userEvent.setup()
    render(<Harness previewProps={{ e1: 100, s1: 95, x1: 110 }} />)
    await user.type(screen.getByRole('textbox', { name: 'Formula' }), '({{Exit} - {{Entry}) / ({{Entry} - {{Stop})')
    expect(screen.getByRole('status').textContent).toBe('On this note: 2')
  })

  it('a formula that can use another formula previews through it', async () => {
    const user = userEvent.setup()
    render(<Harness previewProps={{ e1: 100, s1: 90, x1: 130 }} />)
    await user.type(screen.getByRole('textbox', { name: 'Formula' }), '{{R} * 10')
    expect(screen.getByRole('status').textContent).toBe('On this note: 30')
  })

  it('division by zero is a sentence, never NaN or Infinity', async () => {
    const user = userEvent.setup()
    render(<Harness previewProps={{ e1: 100, s1: 100, x1: 110 }} />)
    await user.type(screen.getByRole('textbox', { name: 'Formula' }), '({{Exit} - {{Entry}) / ({{Entry} - {{Stop})')
    const text = screen.getByRole('status').textContent
    expect(text).toBe('On this note: no value yet (Division by zero)')
    expect(text).not.toMatch(/NaN|Infinity/)
  })

  it('an empty input says which one', async () => {
    const user = userEvent.setup()
    render(<Harness previewProps={{ e1: 100, s1: 95 }} />)
    await user.type(screen.getByRole('textbox', { name: 'Formula' }), '{{Exit} - {{Entry}')
    expect(screen.getByRole('status').textContent).toBe('On this note: no value yet (Exit is empty)')
  })

  it.each([
    ['constructor', /Unknown name "constructor".*\{Entry\}/],
    ['1 +', /ends too soon/],
    ['{{Nope} * 2', /No number property is named "Nope"/],
    ['{{Notes} * 2', /No number property is named "Notes"/],
    ['round(1, 2, 3)', /round takes 1 or 2 values, not 3/],
    ['1 < 2 < 3', /Compare two things at a time/],
  ])('the error for %j is rendered as text', async (typed, message) => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByRole('textbox', { name: 'Formula' }), typed)
    expect(screen.getByRole('status').textContent).toMatch(message)
  })

  it('a circular reference is named before Save', async () => {
    const user = userEvent.setup()
    render(<Harness selfId="r1" />)
    await user.type(screen.getByRole('textbox', { name: 'Formula' }), '{{R} + 1')
    expect(screen.getByRole('status').textContent).toMatch(/Circular reference/)
  })

  it('a starter fills the formula and hands the starter up (to name the property)', async () => {
    const user = userEvent.setup()
    const onStarter = vi.fn()
    render(<Harness onStarter={onStarter} previewProps={{ e1: 100, s1: 105, x1: 90 }} />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Start from a trader formula' }), 'r_multiple')
    expect(screen.getByTestId('text').textContent).toBe('({Exit} - {Entry}) / ({Entry} - {Stop})')
    expect(onStarter).toHaveBeenCalledWith(expect.objectContaining({ name: 'R-multiple' }))
    // the short case: a stop above the entry still reads as a positive 2R winner
    expect(screen.getByRole('status').textContent).toBe('On this note: 2')
  })

  it('offers to create the number properties a starter needs and the member lacks', async () => {
    const user = userEvent.setup()
    const onCreateMissing = vi.fn()
    render(<Harness onCreateMissing={onCreateMissing} />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Start from a trader formula' }), 'position_size')
    const btn = screen.getByRole('button', { name: 'Create Account risk as number property' })
    await user.click(btn)
    expect(onCreateMissing).toHaveBeenCalledWith(['Account risk'])
  })
})
