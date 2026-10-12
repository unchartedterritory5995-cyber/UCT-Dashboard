// app/src/pages/journal-2-0/a11y/traderBlockSizing.a11y.test.jsx
//
// Notebook P2a Task 11: the position sizing body through 8A's axe harness. Two states in ONE document
// and ONE React root (as in the editor, where every node view shares the app's root, so each body's
// useId labels are unique): a sized trade (its three inputs and the result list), and the placeholder
// account (S9: the reason, the way to set it, and the "Account size for this note" input). Each is
// asserted present before axe runs, so an unpainted body cannot pass as a clean one.
import { render, screen, within } from '@testing-library/react'
import { vi, expect } from 'vitest'
import { axeSurface } from './surface'

// Each block reads its settings from the nearest provider, so the two states can differ in one root.
const H = vi.hoisted(() => ({ Settings: null }))
vi.mock('../hooks/useJ2Settings', async () => {
  const React = await import('react')
  H.Settings = React.createContext({ accountSize: 50000 })
  return { default: () => ({ settings: React.useContext(H.Settings), isLoading: false, accountId: 'a1', accountName: 'Main' }) }
})
vi.mock('../hooks/useJ2Accounts', () => ({ default: () => ({ accounts: [{ id: 'a1', name: 'Main' }], isLoading: false }) }))
vi.mock('../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1', accounts: [{ id: 'a1', name: 'Main' }], isLoading: false }) }))
vi.mock('../hooks/useJ2CurrentRegime', () => ({ default: () => ({ regime: { regime: 'green', asOf: '2026-10-13' } }) }))
import PositionSizingBlock from '../components/notebook/blocks/PositionSizingBlock'

axeSurface('trader-block-sizing', async () => {
  const { Settings } = H
  render(<div>
    <section aria-label="A sized trade">
      <Settings.Provider value={{ accountSize: 50000 }}>
        <PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A+', regimeId: 'orange', regimeAsOf: '2026-10-01' }}
          setParams={() => true} editable />
      </Settings.Provider>
    </section>
    <section aria-label="The placeholder account">
      <Settings.Provider value={{ accountSize: 100000 }}>
        <PositionSizingBlock params={{ entry: 100, stop: 95, grade: 'A', regimeId: 'green' }} setParams={() => true} editable />
      </Settings.Provider>
    </section>
  </div>)

  const a = within(screen.getByRole('region', { name: 'A sized trade' }))
  for (const name of ['Entry', 'Stop']) expect(a.getByRole('spinbutton', { name })).toBeTruthy()
  expect(a.getByRole('combobox', { name: 'Setup grade' })).toBeTruthy()
  const list = a.getByRole('list', { name: 'Position size' })
  expect(within(list).getAllByRole('listitem').length).toBeGreaterThanOrEqual(4)
  expect(a.getByRole('button', { name: "Use today's regime (GREEN)" })).toBeTruthy()

  const b = within(screen.getByRole('region', { name: 'The placeholder account' }))
  expect(b.getByText('Set your account size in Settings.')).toBeTruthy()
  expect(b.getByRole('spinbutton', { name: 'Account size for this note' })).toBeTruthy()
  expect(b.queryByRole('list', { name: 'Position size' })).toBeNull()

  // one root: every label's id is unique, so each label names its own input
  const ids = [...document.querySelectorAll('[id]')].map((el) => el.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(screen.getAllByRole('spinbutton', { name: 'Entry' })).toHaveLength(2)
})
