import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, afterEach } from 'vitest'
import ThesisChip from './ThesisChip'

const CHIP = {
  noteId: 'n1',
  title: 'NVDA swing plan',
  thesisStatus: 'active',
  entry: 100,
  stop: 90,
  target: 120,
  link: '/journal/notebook?note=n1',
}

const renderChip = (props = {}) =>
  render(<MemoryRouter><ThesisChip chip={CHIP} currentPrice={105} {...props} /></MemoryRouter>)

describe('ThesisChip', () => {
  it('renders nothing for a null chip', () => {
    const { container } = render(<MemoryRouter><ThesisChip chip={null} currentPrice={105} /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the distance to the stop when a current price is known', () => {
    renderChip()
    expect(screen.getByText(/above stop/)).toBeInTheDocument()
  })

  it('falls back to the status label when no current price is available', () => {
    renderChip({ currentPrice: null })
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('opens the preview on real MOUSE hover (pointerType "mouse"), closed by default', () => {
    renderChip()
    expect(screen.queryByText('NVDA swing plan')).not.toBeInTheDocument()
    fireEvent.pointerEnter(screen.getByRole('button'), { pointerType: 'mouse' })
    expect(screen.getByText('NVDA swing plan')).toBeInTheDocument()
    fireEvent.pointerLeave(screen.getByRole('button').closest('span'), { pointerType: 'mouse' })
    expect(screen.queryByText('NVDA swing plan')).not.toBeInTheDocument()
  })

  it('a TOUCH pointerenter never opens it (only a real tap/click does)', () => {
    renderChip()
    fireEvent.pointerEnter(screen.getByRole('button'), { pointerType: 'touch' })
    expect(screen.queryByText('NVDA swing plan')).not.toBeInTheDocument()
  })

  it('opens the preview on TAP/CLICK -- the touch-tier door (no hover on a touch device)', () => {
    renderChip()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('NVDA swing plan')).toBeInTheDocument()
    // CLICK ONLY OPENS -- a second click must NOT toggle it closed (see the file-top
    // comment: a real tap IS a click preceded by synthetic mouseenter/focus, so a
    // toggling click closes itself on every single tap on a real device).
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('NVDA swing plan')).toBeInTheDocument()
  })

  it('REGRESSION (W5, tools/notebook_w13g2_walk.py): the full touch-compatibility '
    + 'sequence -- a touch pointerenter, then focus, then click -- leaves it OPEN, '
    + 'never closed. A toggling click failed this on every real touch device.', () => {
    renderChip()
    const btn = screen.getByRole('button')
    fireEvent.pointerEnter(btn, { pointerType: 'touch' })
    fireEvent.focus(btn)
    fireEvent.click(btn)
    expect(screen.getByText('NVDA swing plan')).toBeInTheDocument()
  })

  it('opens on KEYBOARD FOCUS alone (Tab to it) -- the keyboard mirror of hover, so a '
    + 'keyboard-only member never needs a second keypress to see the preview', async () => {
    const user = userEvent.setup()
    renderChip()
    expect(screen.queryByText('NVDA swing plan')).not.toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('button')).toHaveFocus()
    expect(screen.getByText('NVDA swing plan')).toBeInTheDocument()
  })

  it('ESCAPE closes the preview and returns focus to the chip', async () => {
    const user = userEvent.setup()
    renderChip()
    await user.tab()
    expect(screen.getByText('NVDA swing plan')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByText('NVDA swing plan')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveFocus()
  })

  it('the preview shows entry/stop/target and a link into the note', () => {
    renderChip()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('$100.00')).toBeInTheDocument()
    expect(screen.getByText('$90.00')).toBeInTheDocument()
    expect(screen.getByText('$120.00')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open note' })).toHaveAttribute(
      'href', '/journal/notebook?note=n1')
  })

  it('a note with no stop says so, never a fabricated zero', () => {
    renderChip({ chip: { ...CHIP, entry: null, stop: null, target: null } })
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('No stop in this note.')).toBeInTheDocument()
  })

  it('an unknown status renders the chip without a color claim (never a guess)', () => {
    renderChip({ chip: { ...CHIP, thesisStatus: 'not-a-real-status' } })
    // distance still renders since stop + currentPrice are both present
    expect(screen.getByText(/above stop/)).toBeInTheDocument()
  })
})

// ── lane FIN-A11Y (R4 I-1, I-2, M-9) ─────────────────────────────────────────
// The door is decided AT THE CLICK from the live media query (never a hook read at
// mount): touch tier -> the shared Sheet, desktop -> a fixed-position popover.
const realMatchMedia = window.matchMedia
const setTouch = (touch) => {
  window.matchMedia = (query) => ({
    matches: touch && /max-width:\s*1024px/.test(query),
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })
}

describe('ThesisChip -- touch opens the shared Sheet (I-2)', () => {
  afterEach(() => { window.matchMedia = realMatchMedia })

  it('a tap at <=1024px opens a dialog named by the note, with the levels and the link', async () => {
    setTouch(true)
    renderChip()
    const chip = screen.getByRole('button', { name: /Thesis note/ })
    fireEvent.focus(chip) // the tap's compatibility sequence focuses first
    expect(screen.queryByText('NVDA swing plan')).not.toBeInTheDocument()
    fireEvent.click(chip)
    const dialog = await screen.findByRole('dialog', { name: 'NVDA swing plan' })
    expect(dialog).toHaveTextContent('$90.00')
    expect(screen.getByRole('link', { name: 'Open note' })).toBeInTheDocument()
    // no anchored popover beside the sheet
    expect(document.querySelector('[data-thesis-popover]')).toBeNull()
  })

  it('Escape closes the sheet and focus is back on the chip, which stays closed', async () => {
    setTouch(true)
    const user = userEvent.setup()
    renderChip()
    const chip = screen.getByRole('button', { name: /Thesis note/ })
    await user.click(chip)
    await screen.findByRole('dialog', { name: 'NVDA swing plan' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(chip).toHaveFocus()
    expect(chip).toHaveAttribute('aria-expanded', 'false')
  })

  it('keyboard focus alone never opens a focus-trapping sheet on the touch tier', async () => {
    setTouch(true)
    const user = userEvent.setup()
    renderChip()
    await user.tab()
    expect(screen.getByRole('button', { name: /Thesis note/ })).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'NVDA swing plan' })).toBeInTheDocument()
  })
})

describe('ThesisChip -- the desktop popover (I-1, I-2)', () => {
  const renderBetween = () => render(
    <MemoryRouter>
      <button type="button">before</button>
      <ThesisChip chip={CHIP} currentPrice={105} />
      <button type="button">after</button>
    </MemoryRouter>,
  )

  it('is fixed-position, so a scrolling table wrapper cannot clip it', () => {
    renderChip()
    fireEvent.click(screen.getByRole('button'))
    const pop = document.querySelector('[data-thesis-popover]')
    expect(pop).not.toBeNull()
    expect(pop.style.position).toBe('fixed')
  })

  it('Tab walks chip -> Open note -> out, and leaving closes it (no popover left open behind)', async () => {
    const user = userEvent.setup()
    renderBetween()
    await user.tab() // before
    await user.tab() // chip: opens on focus
    expect(screen.getByText('NVDA swing plan')).toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('link', { name: 'Open note' })).toHaveFocus()
    expect(screen.getByText('NVDA swing plan')).toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus()
    expect(screen.queryByText('NVDA swing plan')).not.toBeInTheDocument()
  })

  it('a pointerdown outside closes it (pointer events: a tap on blank space counts)', () => {
    renderBetween()
    fireEvent.click(screen.getByRole('button', { name: /Thesis note/ }))
    expect(screen.getByText('NVDA swing plan')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByText('NVDA swing plan'))
    expect(screen.getByText('NVDA swing plan')).toBeInTheDocument() // inside: stays
    fireEvent.pointerDown(document.body)
    expect(screen.queryByText('NVDA swing plan')).not.toBeInTheDocument()
  })

  it('Escape from the Open note link closes it, focuses the chip, and does not reopen', async () => {
    const user = userEvent.setup()
    renderBetween()
    await user.tab()
    await user.tab()
    await user.tab()
    expect(screen.getByRole('link', { name: 'Open note' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: /Thesis note/ })).toHaveFocus()
    expect(screen.queryByText('NVDA swing plan')).not.toBeInTheDocument()
  })

  it('a chip click or key never reaches the row it sits in', async () => {
    const onRow = vi.fn()
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div onClick={onRow} onKeyDown={onRow}><ThesisChip chip={CHIP} currentPrice={105} /></div>
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button'))
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onRow).not.toHaveBeenCalled()
  })
})

describe('ThesisChip -- the status is a word, not only a dot colour (M-9)', () => {
  it('shows the status beside the stop distance', () => {
    renderChip()
    const chip = screen.getByRole('button')
    expect(chip).toHaveTextContent('Active')
    expect(chip).toHaveTextContent(/above stop/)
  })

  it('does not say the status twice when the label already is the status', () => {
    renderChip({ currentPrice: null })
    expect(screen.getAllByText('Active')).toHaveLength(1)
  })
})
