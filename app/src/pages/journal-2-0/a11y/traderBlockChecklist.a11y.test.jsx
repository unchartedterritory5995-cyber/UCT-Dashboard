// app/src/pages/journal-2-0/a11y/traderBlockChecklist.a11y.test.jsx
//
// Notebook P2a, Task 7: the pre-entry checklist block's body through 8A's axe harness. One recipe
// renders the body in its three member-visible shapes: a setup with two items (one ticked) and the
// "not ticked" status line (requireAll yes); no setup yet, with the named picker over two setups; and
// a reader's view (disabled boxes, and the sentence that replaces the picker). Each shape is proved on
// screen BEFORE axe runs, so an empty render cannot pass as a clean one.
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
vi.mock('../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1' }) }))
vi.mock('../hooks/useJournalRules', () => ({ default: () => ({ rules: [] }) }))
import PreEntryChecklistBlock from '../components/notebook/blocks/PreEntryChecklistBlock'

axeSurface('trader-block-checklist', async () => {
  render(<div>
    <PreEntryChecklistBlock params={{ setup: 'VCP', includeRules: 'no', requireAll: 'yes', checked: ['s1'] }} setParams={() => true} editable />
    <PreEntryChecklistBlock params={{ setup: '', includeRules: 'yes', requireAll: 'no', checked: [] }} setParams={() => true} editable />
    <PreEntryChecklistBlock params={{ setup: '', includeRules: 'no', requireAll: 'no', checked: [] }} setParams={() => true} editable={false} />
  </div>)
  const group = screen.getByRole('group', { name: 'Pre-entry checklist for VCP' })
  const boxes = screen.getAllByRole('checkbox')
  expect(boxes).toHaveLength(2)
  expect(screen.getByRole('checkbox', { name: 'Volume dry-up' }).checked).toBe(true)
  expect(screen.getByRole('checkbox', { name: 'Tight closes' }).checked).toBe(false)
  expect(boxes.every((b) => group.contains(b))).toBe(true)
  expect(screen.getByRole('status').textContent).toBe('1 checklist item not ticked.')
  expect(screen.getByText('1 of 2 ticked')).toBeTruthy()
  const picker = screen.getByRole('combobox', { name: 'Setup for this trade' })
  expect([...picker.options].map((o) => o.textContent)).toEqual(['Pick a setup', 'VCP', 'Flag'])
  expect(screen.getByText('No setup picked for this trade.')).toBeTruthy()
})
