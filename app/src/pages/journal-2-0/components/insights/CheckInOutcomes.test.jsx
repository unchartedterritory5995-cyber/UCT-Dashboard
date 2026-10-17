import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'

import CheckInOutcomes, { EMPTY_TEXT, TOO_FEW_TEXT } from './CheckInOutcomes'
import PsychologySection from './PsychologySection'
import { TIER3_FLAG } from '../../lib/tier3Flag'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

// The payload shape `analytics._checkin_section` builds (tests/test_analytics_checkins.py).
const level = (lv, word, days, tradeCount, avgPnl, winRate) => ({ level: lv, word, days, tradeCount, avgPnl, winRate })
const checkIns = {
  checkInDays: 9,
  joinedTrades: 31,
  unjoined: 2,
  mood: [
    level(1, 'Rough', 1, 3, -42.5, 0.0),
    level(2, 'Low', 0, 0, null, null),
    level(3, 'Okay', 2, 9, 12.0, 0.5),
    level(4, 'Good', 4, 12, 88.25, 0.75),
    level(5, 'Great', 2, 7, 130.0, 1.0),
  ],
  focus: [
    level(1, 'Scattered', 0, 0, null, null),
    level(2, 'Distracted', 1, 2, -10.0, 0.0),
    level(3, 'Steady', 3, 10, 5.0, 0.4),
    level(4, 'Focused', 4, 19, 64.0, 0.7),
    level(5, 'Locked in', 1, 0, null, null),
  ],
}

const rowFor = (word) => screen.getByRole('rowheader', { name: new RegExp(`^${word}`) }).closest('tr')

beforeEach(() => {
  localStorage.clear()
  // No account is passed, so the section mounts nothing that fetches; a stray request fails loudly.
  globalThis.fetch = vi.fn(() => Promise.reject(new Error('unexpected fetch')))
})
afterEach(() => { __resetNotebookFlags() })

// Let the lazy leaf resolve and Suspense retry, inside act. The module is already imported above,
// so its dynamic import resolves from the module cache.
const settleLazy = () => act(async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0))
})

describe('CheckInOutcomes — the Tier 3 switch', () => {
  const psychology = { taggedTradeCount: 0, checkIns }

  it('with the switch off, the view is absent from the psychology section', async () => {
    render(<PsychologySection analytics={{ psychology }} />)
    // Something else in the section rendered, so an absent view is the gate and not a blank page.
    expect(screen.getByText(/tag your last 20 trades/i)).toBeInTheDocument()
    // The same settle the switch-on test proves is enough for the lazy view to mount.
    await settleLazy()
    expect(screen.queryByText('By check-in')).not.toBeInTheDocument()
    expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('with the switch on, the view mounts in the section, even on an untagged book', async () => {
    latchNotebookFlags({ [TIER3_FLAG]: true })
    render(<PsychologySection analytics={{ psychology }} />)
    await settleLazy()
    // getBy, not findBy: this is the control that the off test's settle is long enough.
    expect(screen.getByText('By check-in')).toBeInTheDocument()
    expect(screen.getByText(/tag your last 20 trades/i)).toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('CheckInOutcomes — the table', () => {
  it('renders one row per level from the payload, on the Mood tab first', () => {
    render(<CheckInOutcomes checkIns={checkIns} />)
    expect(screen.getByRole('tab', { name: 'Mood' })).toHaveAttribute('aria-selected', 'true')
    for (const w of ['Rough', 'Low', 'Okay', 'Good', 'Great']) expect(rowFor(w)).toBeInTheDocument()
    const good = within(rowFor('Good'))
    expect(good.getByText('4')).toBeInTheDocument()          // days
    expect(good.getByText('12')).toBeInTheDocument()         // trades
    expect(good.getByText('75%')).toBeInTheDocument()
    expect(good.getByText('+$88.25')).toBeInTheDocument()
    expect(within(rowFor('Rough')).getByText('-$42.50')).toBeInTheDocument()
  })

  it('greys a row under 10 trades with "Too few trades", and leaves a 10+ row plain', () => {
    render(<CheckInOutcomes checkIns={checkIns} />)
    for (const w of ['Rough', 'Low', 'Okay', 'Great']) {          // 3, 0, 9, 7 trades
      const row = rowFor(w)
      expect(within(row).getByText(TOO_FEW_TEXT)).toBeInTheDocument()
      expect(row.className).toMatch(/rowThin/)
    }
    const good = rowFor('Good')                                     // 12 trades: the edge above 10
    expect(within(good).queryByText(TOO_FEW_TEXT)).not.toBeInTheDocument()
    expect(good.className).not.toMatch(/rowThin/)
    expect(TOO_FEW_TEXT).toBe('Too few trades')
  })

  it('shows a level with no trades as dashes, never as 0% or $0', () => {
    render(<CheckInOutcomes checkIns={checkIns} />)
    const low = within(rowFor('Low'))
    expect(low.getAllByText('—')).toHaveLength(2)
    expect(low.queryByText('0%')).not.toBeInTheDocument()
    expect(low.queryByText('$0')).not.toBeInTheDocument()
  })

  it('switches to the Focus tab by click and by arrow key', () => {
    render(<CheckInOutcomes checkIns={checkIns} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Focus' }))
    expect(screen.getByRole('tab', { name: 'Focus' })).toHaveAttribute('aria-selected', 'true')
    expect(rowFor('Locked in')).toBeInTheDocument()
    expect(screen.queryByRole('rowheader', { name: /^Good/ })).not.toBeInTheDocument()
    // Focus 4 has 19 trades: plain. Focus 3 has 10: plain too (10 is not under 10).
    expect(within(rowFor('Steady')).queryByText(TOO_FEW_TEXT)).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Focus' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Mood' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Mood' })).toHaveFocus()
  })

  it('says how many trades have no trading day', () => {
    render(<CheckInOutcomes checkIns={checkIns} />)
    expect(screen.getByText(/2 trades have no trading day/)).toBeInTheDocument()
  })

  it('renders no emoji', () => {
    const { container } = render(<CheckInOutcomes checkIns={checkIns} />)
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})

describe('CheckInOutcomes — the empty state', () => {
  it('renders the empty-state sentence when checkInDays is 0', () => {
    render(<CheckInOutcomes checkIns={{ ...checkIns, checkInDays: 0 }} />)
    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument()
    expect(EMPTY_TEXT).toBe(
      'Add a check-in block to your daily note to see how mood and focus line up with your trading.',
    )
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('renders the empty state, not a crash, when the slice is missing', () => {
    render(<CheckInOutcomes checkIns={undefined} />)
    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument()
  })
})
