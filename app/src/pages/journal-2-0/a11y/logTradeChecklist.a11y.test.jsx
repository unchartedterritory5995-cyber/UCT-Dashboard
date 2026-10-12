// app/src/pages/journal-2-0/a11y/logTradeChecklist.a11y.test.jsx
//
// Notebook P2a, Task 8: Log Trade's pre-entry checklist (a body loaded inside AddPositionModal and
// AddTradeModal, outside the derived population; OUTSIDE_POPULATION_SURFACES names this file) through
// 8A's axe harness. The recipe renders the body with two items, one ticked, and the soft warning
// (requireAll yes). The group, both boxes and the status line are proved on screen BEFORE axe runs,
// so an empty render cannot pass as a clean one. The three Journal hooks behind the read seam are
// stood in for; the seam itself is real.
import { render, screen } from '@testing-library/react'
import { vi, expect } from 'vitest'
import { axeSurface } from './surface'

vi.mock('../hooks/useJ2Settings', () => ({
  default: () => ({
    settings: {
      setups: ['VCP', 'Flag'],
      setupRules: { VCP: [{ id: 's1', label: 'Volume dry-up' }, { id: 's2', label: 'Tight closes' }] },
    },
  }),
}))
vi.mock('../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1', accounts: [{ id: 'a1' }] }) }))
vi.mock('../hooks/useJournalRules', () => ({ default: () => ({ rules: [] }) }))
import LogTradeChecklist from '../components/LogTradeChecklist'

axeSurface('log-trade-checklist', async () => {
  render(<LogTradeChecklist setup="VCP" requireAll="yes" checked={['s1']} onChange={() => {}} />)
  const group = screen.getByRole('group', { name: 'Pre-entry checklist' })
  const boxes = screen.getAllByRole('checkbox')
  expect(boxes).toHaveLength(2)
  expect(boxes.every((b) => group.contains(b))).toBe(true)
  expect(screen.getByRole('checkbox', { name: 'Volume dry-up' }).checked).toBe(true)
  expect(screen.getByRole('checkbox', { name: 'Tight closes' }).checked).toBe(false)
  expect(screen.getByRole('status').textContent).toBe('1 checklist item not ticked. You can still log this trade.')
})
