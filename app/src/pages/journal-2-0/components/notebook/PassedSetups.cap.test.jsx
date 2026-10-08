// Finish program, lane KEYS: the Passed setups list is capped, with a "Show all" control.
//
// Every row is two Tab stops (the name, Remove), the list had no limit, and the box sits ahead
// of the review buttons and the Active setups door on Research Home. With 30 names saved a
// keyboard member pressed Tab 66 times to reach "This week's review"
// (docs/notebook/fin-clicks.md). The list now shows the newest few and one button for the rest.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import PassedSetups, { PASSED_SETUPS_SHOWN } from './PassedSetups'

const item = (i) => ({ id: `id${i}`, symbol: `SYM${i}`, source: 'scanner', savedDay: '2026-08-10', baseDate: null,
  status: 'no_bars', noBarsLabel: 'No stored daily bars', outcomes: [] })
const list = (n) => ({ horizons: [1, 5, 10, 20], bestWindow: 20, tradedWithin: 10, lookbackDays: 60, tradedCount: 0,
  items: Array.from({ length: n }, (_, i) => item(i)) })

function mount(n) {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => list(n) }))
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter><PassedSetups /></MemoryRouter>
    </SWRConfig>)
}
const rows = () => document.querySelectorAll('[data-passed-symbol]').length
const stops = () => document.querySelectorAll('[data-passed-setups] ul a, [data-passed-setups] ul button').length

describe('PassedSetups: the list is capped', () => {
  beforeEach(() => { __resetNotebookFlags(); latchNotebookFlags({ notebook_passed_setups_enabled: true }) })
  afterEach(() => __resetNotebookFlags())

  it('the cap is a small number', () => {
    expect(PASSED_SETUPS_SHOWN).toBeGreaterThan(0)
    expect(PASSED_SETUPS_SHOWN).toBeLessThanOrEqual(8)
  })

  it('30 saved names render the cap, not 30, and say how many there are', async () => {
    mount(30)
    const more = await screen.findByRole('button', { name: 'Show all 30 passed setups' })
    expect(rows()).toBe(PASSED_SETUPS_SHOWN)
    expect(stops()).toBe(PASSED_SETUPS_SHOWN * 2)          // the Tab stops the list costs
    expect(more.getAttribute('aria-expanded')).toBe('false')
  })

  it('Show all renders every row, keeps focus on the same button, and can be undone', async () => {
    mount(30)
    const more = await screen.findByRole('button', { name: 'Show all 30 passed setups' })
    more.focus()
    fireEvent.click(more)
    expect(rows()).toBe(30)
    const fewer = screen.getByRole('button', { name: 'Show fewer passed setups' })
    expect(fewer.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(fewer)
    fireEvent.click(fewer)
    expect(rows()).toBe(PASSED_SETUPS_SHOWN)
  })

  it('control: at or under the cap there is no button and every row shows', async () => {
    mount(PASSED_SETUPS_SHOWN)
    await screen.findByText('$SYM0')
    expect(rows()).toBe(PASSED_SETUPS_SHOWN)
    expect(document.querySelector('[data-passed-show-all]')).toBeNull()
  })
})
