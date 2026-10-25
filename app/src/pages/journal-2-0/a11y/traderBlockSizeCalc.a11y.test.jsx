// app/src/pages/journal-2-0/a11y/traderBlockSizeCalc.a11y.test.jsx
//
// Wave 10 Task 10.20: the position size calculator body through 8A's axe harness. Two states in ONE document and
// ONE React root (as in the editor, where node views share the app's root, so each body's useId labels are unique):
// a sized trade (its four inputs and the two result sentences) and the placeholder account (IR-S9: the reason and the
// "Account size for this note" input); then, as its own surface, the block with wave 10 off ("Not available right
// now.", no inputs). Each is asserted present before axe runs, so an unpainted body cannot pass as a clean one.
import { render, screen, within } from '@testing-library/react'
import { vi, expect } from 'vitest'
import { axeSurface } from './surface'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

const H = vi.hoisted(() => ({ Settings: null }))
vi.mock('../hooks/useJ2Settings', async () => {
  const React = await import('react')
  H.Settings = React.createContext({ accountSize: 50000 })
  return { default: () => ({ settings: React.useContext(H.Settings), isLoading: false }) }
})
vi.mock('../hooks/useJ2Accounts', () => ({ default: () => ({ accounts: [{ id: 'a1', name: 'Main' }], isLoading: false }) }))
vi.mock('../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1', accounts: [{ id: 'a1', name: 'Main' }], isLoading: false }) }))
vi.mock('../hooks/useJ2CurrentRegime', () => ({ default: () => ({ regime: null }) }))
import SizeCalcBlock from '../components/notebook/blocks/SizeCalcBlock'

axeSurface('trader-block-size-calc', async () => {
  latchNotebookFlags({ notebook_widgets_w10_enabled: true })
  const { Settings } = H
  try {
    render(<div>
      <section aria-label="A sized trade">
        <Settings.Provider value={{ accountSize: 50000, maxRiskPerTradePct: 1 }}>
          <SizeCalcBlock params={{ symbol: 'NVDA', entry: 100, stop: 95, riskPct: 1 }} setParams={() => true} editable />
        </Settings.Provider>
      </section>
      <section aria-label="The placeholder account">
        <Settings.Provider value={{ accountSize: 100000 }}>
          <SizeCalcBlock params={{ entry: 100, stop: 95, riskPct: 1 }} setParams={() => true} editable />
        </Settings.Provider>
      </section>
    </div>)

    const a = within(screen.getByRole('region', { name: 'A sized trade' }))
    expect(a.getByRole('textbox', { name: 'Symbol' })).toBeTruthy()
    for (const name of ['Entry', 'Stop', 'Risk per trade (%)']) expect(a.getByRole('spinbutton', { name })).toBeTruthy()
    expect(a.getByText('100 shares of NVDA, $500 at risk (1% of the account).')).toBeTruthy()
    expect(a.getByText('Position value: $10,000 (20% of the account).')).toBeTruthy()

    const b = within(screen.getByRole('region', { name: 'The placeholder account' }))
    expect(b.getByText('Set your account size, or enter one for this note.')).toBeTruthy()
    expect(b.getByRole('spinbutton', { name: 'Account size for this note' })).toBeTruthy()

    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id)
    expect(new Set(ids).size).toBe(ids.length)
  } finally {
    __resetNotebookFlags()
  }
})

axeSurface('trader-block-size-calc:wave-off', async () => {
  __resetNotebookFlags()
  render(<section aria-label="Wave 10 off"><SizeCalcBlock params={{ entry: 100 }} setParams={() => true} editable /></section>)
  const c = within(screen.getByRole('region', { name: 'Wave 10 off' }))
  expect(c.getByText('Not available right now.')).toBeTruthy()
  expect(c.queryAllByRole('spinbutton')).toEqual([])
})
