import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

// The real scan, wrapped so the "empty window is refused BEFORE it is scanned"
// case can distinguish the reorder it exists to pin. A fixture that cannot tell
// the two orders apart proves nothing (`lesson_a_fixture_that_cannot_distinguish`).
vi.mock('./breadthEvents', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, scanEvents: vi.fn(actual.scanEvents) }
})

import EventLedgerView, { FIRED_ACCENT } from './EventLedgerView'
import { scanEvents } from './breadthEvents'
import { PALETTES } from './breadthViewShared'

const base = { advancing: 2000, declining: 2000, up_vol_ratio: 1.0, mcclellan_osc: 0,
               hvc_52w: 5, atr_ext_7: 5, new_52w_lows: 10, is_ftd: 0 }
const rows = Array.from({ length: 40 }, (_, i) => ({
  ...base, date: `2026-08-${String(40 - i).padStart(2, '0')}`,
  ...(i === 0 ? { up_vol_ratio: 9.5 } : {}),
}))

describe('EventLedgerView', () => {
  it('shows an event that fired today', () => {
    const { getByTestId } = render(<EventLedgerView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{}} />)
    expect(getByTestId('event-vol90up').textContent).toMatch(/today/i)
  })

  it('says how far back it looked when an event never fired', () => {
    const { getByTestId } = render(<EventLedgerView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{}} />)
    expect(getByTestId('event-ftd').textContent).toMatch(/not in the last 40 sessions/i)
  })

  it('shows the reason an event could not be evaluated', () => {
    const blind = rows.map(r => ({ ...r, advancing: null, declining: null }))
    const { getByTestId } = render(<EventLedgerView rows={blind} rowIdx={0} currentRow={blind[0]}
      onDrill={() => {}} options={{}} />)
    expect(getByTestId('event-zweig').textContent).toMatch(/advance\/decline counts cover 0/i)
  })

  // 🔴 A FIRED EVENT IS NOT A BULLISH EVENT. Every fired card used to paint the
  // palette's bull colour, so a *90% DOWN Volume Day* rendered green with a
  // green border. This lens reports that a named thing happened; it does not
  // grade it. The accent is the neutral gold, whatever the palette.
  it('paints a fired event with a NEUTRAL accent, never the bull colour', () => {
    const down = rows.map((r, i) => ({ ...r, up_vol_ratio: i === 0 ? 0.05 : 1.0 }))
    const { getByTestId } = render(<EventLedgerView rows={down} rowIdx={0} currentRow={down[0]}
      onDrill={() => {}} options={{ palette: 'classic' }} />)
    const card = getByTestId('event-vol90dn')
    expect(card.textContent).toMatch(/today/i)

    const bull = PALETTES.classic.bull
    const painted = [card.style.border, ...[...card.querySelectorAll('*')]
      .flatMap(el => [el.style.color, el.style.background, el.style.backgroundColor])]
      .filter(Boolean).join(' ')
    expect(painted.toLowerCase()).not.toContain(bull.toLowerCase())
    expect(painted).not.toContain('rgb(52, 211, 153)')   // classic bull, as jsdom serialises it
    expect(card.style.border).toContain(FIRED_ACCENT)
  })

  it('renders nothing for an empty window WITHOUT scanning it first', () => {
    scanEvents.mockClear()
    const { container } = render(<EventLedgerView rows={[]} rowIdx={0} currentRow={null}
      onDrill={() => {}} options={{}} />)
    expect(container.innerHTML).toBe('')
    expect(scanEvents, 'the window was scanned before the guard refused it')
      .not.toHaveBeenCalled()
  })
})
