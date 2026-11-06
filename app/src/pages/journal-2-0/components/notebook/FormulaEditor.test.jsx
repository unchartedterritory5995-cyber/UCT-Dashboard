/**
 * Wave 11 (lane 11B): the formula editor — pick properties by NAME, see the live
 * value, and read every error as text. Keyboard-only paths included.
 */
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
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

// S13: the raw box lives behind "Write your own"; the tests of the raw box open it first, as a member would.
function renderOwn(ui) {
  const out = render(ui)
  const own = screen.queryByRole('button', { name: 'Write your own' })   // already open for a formula of their own
  if (own) fireEvent.click(own)
  return out
}

describe('FormulaEditor', () => {
  it('names every control: the trader formulas, the formula box and the insert group', () => {
    renderOwn(<Harness />)
    expect(screen.getByRole('group', { name: 'Start from a trader formula' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Formula' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Insert a property' })).toBeTruthy()
  })

  it('offers only number and formula properties to insert, by name', () => {
    renderOwn(<Harness />)
    const names = screen.getAllByRole('button', { name: /^Insert / }).map((b) => b.textContent)
    expect(names).toEqual(['Entry', 'Stop', 'Exit', 'R'])
  })

  it('never offers the formula being edited to itself', () => {
    renderOwn(<Harness selfId="r1" />)
    expect(screen.queryByRole('button', { name: 'Insert R' })).toBeNull()
  })

  it('a click on a property inserts {Name} at the caret, and focus goes back to the formula', async () => {
    const user = userEvent.setup()
    renderOwn(<Harness initial="() / 2" />)
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
    renderOwn(<Harness />)
    screen.getByRole('textbox', { name: 'Formula' }).focus()
    await user.tab()       // Entry
    await user.tab()       // Stop
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Insert Stop' }))
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('text').textContent).toBe('{Stop}')
  })

  it('shows the live value on the open note', async () => {
    const user = userEvent.setup()
    renderOwn(<Harness previewProps={{ e1: 100, s1: 95, x1: 110 }} />)
    await user.type(screen.getByRole('textbox', { name: 'Formula' }), '({{Exit} - {{Entry}) / ({{Entry} - {{Stop})')
    expect(screen.getByRole('status').textContent).toBe('On this note: 2')
  })

  it('a formula that can use another formula previews through it', async () => {
    const user = userEvent.setup()
    renderOwn(<Harness previewProps={{ e1: 100, s1: 90, x1: 130 }} />)
    await user.type(screen.getByRole('textbox', { name: 'Formula' }), '{{R} * 10')
    expect(screen.getByRole('status').textContent).toBe('On this note: 30')
  })

  it('division by zero is a sentence, never NaN or Infinity', async () => {
    const user = userEvent.setup()
    renderOwn(<Harness previewProps={{ e1: 100, s1: 100, x1: 110 }} />)
    await user.type(screen.getByRole('textbox', { name: 'Formula' }), '({{Exit} - {{Entry}) / ({{Entry} - {{Stop})')
    const text = screen.getByRole('status').textContent
    expect(text).toBe('On this note: no value yet (Division by zero)')
    expect(text).not.toMatch(/NaN|Infinity/)
  })

  it('an empty input says which one', async () => {
    const user = userEvent.setup()
    renderOwn(<Harness previewProps={{ e1: 100, s1: 95 }} />)
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
    renderOwn(<Harness />)
    await user.type(screen.getByRole('textbox', { name: 'Formula' }), typed)
    expect(screen.getByRole('status').textContent).toMatch(message)
  })

  it('a circular reference is named before Save', async () => {
    const user = userEvent.setup()
    renderOwn(<Harness selfId="r1" />)
    await user.type(screen.getByRole('textbox', { name: 'Formula' }), '{{R} + 1')
    expect(screen.getByRole('status').textContent).toMatch(/Circular reference/)
  })

  it('a cycle through ANOTHER formula is named, with the path, before Save', async () => {
    const user = userEvent.setup()
    const defs = [
      ...DEFS,
      { id: 'a1', name: 'A', type: 'formula', source: 'user_set', config: { expression: '{@b1} + 1' } },
      { id: 'b1', name: 'B', type: 'formula', source: 'user_set', config: { expression: '{@e1}' } },
    ]
    renderOwn(<Harness selfId="b1" defs={defs} />)
    await user.type(screen.getByRole('textbox', { name: 'Formula' }), '{{A} * 2')
    expect(screen.getByRole('status').textContent).toBe(
      "Circular reference: B -> A -> B. A formula can't depend on its own result.")
  })

  it('a starter fills the formula and hands the starter up (to name the property)', async () => {
    const user = userEvent.setup()
    const onStarter = vi.fn()
    renderOwn(<Harness onStarter={onStarter} previewProps={{ e1: 100, s1: 105, x1: 90 }} />)
    await user.click(screen.getByRole('button', { name: 'R-multiple' }))
    expect(screen.getByTestId('text').textContent).toBe('({Exit} - {Entry}) / ({Entry} - {Stop})')
    expect(onStarter).toHaveBeenCalledWith(expect.objectContaining({ name: 'R-multiple' }))
    // the short case: a stop above the entry still reads as a positive 2R winner
    expect(screen.getByRole('status').textContent).toBe('On this note: 2')
  })

  it('offers to create the number properties a starter needs and the member lacks', async () => {
    const user = userEvent.setup()
    const onCreateMissing = vi.fn()
    renderOwn(<Harness onCreateMissing={onCreateMissing} />)
    await user.click(screen.getByRole('button', { name: 'Position size' }))
    const btn = screen.getByRole('button', { name: 'Create Account risk as number property' })
    await user.click(btn)
    expect(onCreateMissing).toHaveBeenCalledWith(['Account risk'])
  })

  // S13 (audit 2026-11-05): lead with the trader formulas, in plain words; the raw syntax behind "Write your own".
  describe('trader formulas first (S13)', () => {
    it('leads with R-multiple, Risk per share and Position size, each saying what it works out and what it uses', () => {
      render(<Harness />)
      const group = screen.getByRole('group', { name: 'Start from a trader formula' })
      const names = [...group.querySelectorAll('[data-formula-starter]')].map((b) => b.getAttribute('data-formula-starter'))
      expect(names.slice(0, 3)).toEqual(['r_multiple', 'risk_per_share', 'position_size'])
      const risk = screen.getByRole('button', { name: 'Risk per share' })
      expect(risk).toHaveAccessibleDescription('Dollars at risk on each share. Uses Entry, Stop.')
    })

    it('the raw syntax is behind "Write your own" until asked for (a new formula)', () => {
      render(<Harness />)
      expect(screen.queryByRole('textbox', { name: 'Formula' })).toBeNull()
      expect(screen.getByText(/Put a number property in braces/).closest('[hidden]')).not.toBeNull()
      const own = screen.getByRole('button', { name: 'Write your own' })
      expect(own).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(own)
      expect(screen.getByRole('textbox', { name: 'Formula' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Hide the formula' })).toHaveAttribute('aria-expanded', 'true')
    })

    it("a formula of the member's own opens with its box showing; a starter-built one shows the starter pressed", () => {
      const { unmount } = render(<Harness initial="{Exit} * 2" />)
      expect(screen.getByRole('textbox', { name: 'Formula' })).toBeInTheDocument()
      unmount()
      render(<Harness initial="abs({Entry} - {Stop})" />)
      expect(screen.queryByRole('textbox', { name: 'Formula' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Risk per share' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'R-multiple' })).toHaveAttribute('aria-pressed', 'false')
    })

    it('picking a starter without opening the box still says what it reads on this note', async () => {
      const user = userEvent.setup()
      render(<Harness previewProps={{ e1: 100, s1: 95, x1: 110 }} />)
      await user.click(screen.getByRole('button', { name: 'Risk per share' }))
      expect(screen.getByRole('status').textContent).toBe('On this note: 5')
    })
  })
})
