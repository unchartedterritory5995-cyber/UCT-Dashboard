// O8: the size banner names the regime in the house word. The stored multiplier key and the
// /api/j2/regime value stay `amber`; the member reads YELLOW. An id the map does not hold is never
// shown raw, and an inherited key ('constructor') is not a word.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import AddPositionModal from './AddPositionModal'
import usePreTradeVerdict from '../hooks/usePreTradeVerdict'

const regimeNow = vi.hoisted(() => ({ value: 'amber' }))
vi.mock('../hooks/useJ2CurrentRegime', () => ({
  default: () => ({ regime: { regime: regimeNow.value }, isLoading: false, error: null }),
}))
vi.mock('../hooks/usePreTradeVerdict', () => ({ default: vi.fn() }))
vi.mock('./SecuritySymbolInput', () => ({
  default: ({ value, onChange, placeholder }) => (
    <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
  ),
}))

const SETTINGS = {
  accountSize: 100_000,
  defaultStop: { mode: 'custom' },
  setups: ['Breakout'],
  breakevenRange: { enabled: false, unit: '$', value: 0 },
  regimeSizeMultipliers: { amber: 0.75, constructor: 0.5, purple: 0.5 },
}

const banner = () => screen.getByText(/Default size scaled to/).parentElement

describe('AddPositionModal regime banner (O8)', () => {
  beforeEach(() => {
    usePreTradeVerdict.mockReturnValue({ run: vi.fn(), verdict: null, isLoading: false, error: null, reset: vi.fn() })
  })

  it('names the amber regime YELLOW', () => {
    regimeNow.value = 'amber'
    render(<AddPositionModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(banner().textContent).toContain('Regime is YELLOW.')
    expect(banner().textContent).not.toMatch(/amber/i)
  })

  it('never shows a regime id the map does not hold, raw or inherited', () => {
    for (const id of ['purple', 'constructor']) {
      regimeNow.value = id
      const { unmount } = render(<AddPositionModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)
      expect(banner().textContent, id).toContain('Regime is not known.')
      expect(banner().textContent, id).not.toMatch(/purple|constructor|undefined|function/i)
      unmount()
    }
  })
})
