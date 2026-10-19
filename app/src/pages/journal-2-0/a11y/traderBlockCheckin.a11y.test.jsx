// app/src/pages/journal-2-0/a11y/traderBlockCheckin.a11y.test.jsx
//
// P2 Tier 3 Task 3: the mood and focus check-in through 8A's axe harness, in the REAL BlockNodeView
// frame (its named group and Remove button), in the states a member meets: editable with one pick (two
// named groups of five pressed-state buttons and the day line), and read-only (the picked words as
// text, no buttons). Each recipe asserts what painted before axe runs, so an empty screen cannot pass
// as a clean one.
import { render, screen, within } from '@testing-library/react'
import { vi, expect } from 'vitest'
import { axeSurface } from './surface'

vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children, ...p }) => <div {...p}>{children}</div> }))
import BlockNodeView from '../components/notebook/blocks/BlockNodeView'

const node = (params) => ({ attrs: { widgetId: 'moodCheckIn', params, searchText: '[mood and focus check-in]' } })

axeSurface('trader-block-checkin', async () => {
  const editor = { isEditable: true, storage: { uctJournalWidgets: { noteId: 'n1' } } }
  render(<BlockNodeView node={node({ mood: '4', focus: '', day: '2026-10-17' })} editor={editor}
    updateAttributes={() => {}} deleteNode={() => {}} />)
  const frame = await screen.findByRole('group', { name: 'Mood and focus check-in' })
  const good = await within(frame).findByRole('button', { name: 'Mood: Good' })
  expect(good.getAttribute('aria-pressed')).toBe('true')
  for (const row of ['Mood', 'Focus']) {
    expect(within(within(frame).getByRole('group', { name: row })).getAllByRole('button'), row).toHaveLength(5)
  }
  expect(within(frame).getByText('Checked in for Oct 17')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Remove Mood and focus check-in' })).toBeTruthy()
})

axeSurface('trader-block-checkin:readonly', async () => {
  const editor = { isEditable: false, storage: { uctJournalWidgets: { noteId: 'n1' } } }
  render(<BlockNodeView node={node({ mood: '4', focus: '3', day: '2026-10-17' })} editor={editor}
    updateAttributes={() => {}} deleteNode={() => {}} />)
  const frame = await screen.findByRole('group', { name: 'Mood and focus check-in' })
  expect(await within(frame).findByText('Mood: Good · Focus: Steady')).toBeTruthy()
  expect(within(frame).queryAllByRole('button')).toEqual([])
})
