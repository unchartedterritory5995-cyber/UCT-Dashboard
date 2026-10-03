import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
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
