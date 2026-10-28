/**
 * The provider's half of the chart menu's keyboard contract: the REAL provider,
 * driven through its real entry point (the `uct:chart-contextmenu` event every
 * chart dispatches), names the menu for the symbol and hands it the chart element
 * the event carries, so Escape lands focus on that chart's region.
 * (ChartContextMenu.a11y.test.jsx pins the menu's own behaviour.)
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false }) }))
vi.mock('./hooks/useJ2Settings', () => ({ default: () => ({ settings: {} }) }))
vi.mock('./hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1', accounts: [] }) }))
vi.mock('../../hooks/useWatchlistAlerts', () => ({ default: () => ({ createAlert: vi.fn() }) }))
vi.mock('../../hooks/useFlagged', () => ({ useFlagged: () => ({ toggle: vi.fn(), isFlagged: () => false }) }))
vi.mock('../../hooks/useTickerTags', () => ({
  default: () => ({ getTag: () => null, setTag: vi.fn(), removeTag: vi.fn() }),
}))
vi.mock('../../hooks/useTagColors', () => ({ default: () => ({ tagColors: [] }) }))
vi.mock('swr', () => ({
  default: () => ({ data: [], mutate: vi.fn() }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))
vi.mock('./components/AddPositionModal', () => ({ default: () => null }))

import GlobalAddPositionProvider from './GlobalAddPositionProvider'

afterEach(() => cleanup())

function renderWithChart() {
  render(
    <>
      <div role="region" aria-label="NVDA daily price chart" tabIndex={0} data-testid="region">
        <div data-testid="chart-el" />
      </div>
      <GlobalAddPositionProvider />
    </>,
  )
}

async function rightClick(detail) {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('uct:chart-contextmenu', {
      detail: { sym: 'nvda', bar: { t: 1757700000, c: 180.5 }, clientX: 100, clientY: 100, sections: [], ...detail },
    }))
  })
}

describe('GlobalAddPositionProvider → ChartContextMenu focus wiring', () => {
  it('names the menu for the symbol and returns Escape focus to the chart region it opened on', async () => {
    renderWithChart()
    await rightClick({ opener: screen.getByTestId('chart-el') })
    const menu = await screen.findByRole('menu', { name: 'Chart actions for NVDA' })
    expect(menu.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('region'))
  })

  it('NON-VACUITY · an event with no opener closes on Escape without inventing a target', async () => {
    renderWithChart()
    await rightClick({})
    await screen.findByRole('menu', { name: 'Chart actions for NVDA' })
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).not.toBe(screen.getByTestId('region'))
  })
})
