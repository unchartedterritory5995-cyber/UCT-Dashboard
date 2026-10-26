// app/src/pages/journal-2-0/a11y/vsPnlPanel.a11y.test.jsx
//
// Wave 9 Task 9.15: the shared "vs P&L" panel through 8A's axe harness, in the states a member meets: a routine block
// opened on its comparison inside the REAL BlockNodeView frame (the day line, the groups with a "small sample" badge,
// the win-rate pair, the caveat, and the flip control pressed), a tracker's value ranges, a failed read with its
// Retry, and a comparison with no days yet. Each recipe asserts what painted before axe runs, so an empty screen
// cannot pass as a clean one. `fetch` is a fake; nothing reaches the network.
import { render, screen, within } from '@testing-library/react'
import { vi, expect } from 'vitest'
import { axeSurface } from './surface'

vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children, ...p }) => <div {...p}>{children}</div> }))
import BlockNodeView from '../components/notebook/blocks/BlockNodeView'
import VsPnlPanel, { CAVEAT, FAILED, ROUTINE_FLIP, SMALL_SAMPLE } from '../components/notebook/blocks/VsPnlPanel'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const g = (n, avg, text, sample = n < 5 ? 'hide' : n < 20 ? 'small' : '') => ({ avg, n, sample, text })
const ROUTINE_PNL = {
  done: g(22, 95, '+$95 average (22 days)'), other: g(9, -40, '−$40 average (9 days)'),
  winRate: { done: g(22, 0.58, '58% win rate (22 days)'), other: g(9, 0.41, '41% win rate (9 days)') },
  sentence: 'On days you finished it: +$95 average (22 days). Other days: −$40 (9 days). A comparison, not proof.',
}
const ITEMS = [{ id: 'i1', text: 'Read the morning wire', negative: false }]
function serve(pnl = [200, ROUTINE_PNL]) {
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    if (/\/vs-pnl$/.test(url)) return json(...pnl)
    if (url !== '/api/j2/routines/days') return json(404, {})
    const { ids, days } = JSON.parse(init.body)
    const entry = (day) => ({ day, state: 'open', ticked: { i1: false }, skipped: false, partial: null, items: ITEMS, writable: true,
      beyondNote: null, consistency: null, run: { line: null, milestone: false, best: null }, suggested: [] })
    return json(200, { routines: Object.fromEntries(ids.map((id) => [id, {
      routine: { id, name: 'Pre-market routine', archived: false }, days: Object.fromEntries(days.map((d) => [d, entry(d)])) }])) })
  })
}
const node = { attrs: { widgetId: 'routine', params: { routineId: 'r1', day: '2026-10-27', bind: 'note-day', display: 'pnl' }, searchText: '[routine: Pre-market routine · For Tue Oct 27]' } }
const editor = { isEditable: true, storage: { uctJournalWidgets: { noteId: 'n1', noteDay: '2026-10-27' } } }

axeSurface('vs-pnl-panel', async () => {
  serve()
  render(<BlockNodeView node={node} editor={editor} updateAttributes={() => {}} deleteNode={() => {}} />)
  const frame = await screen.findByRole('group', { name: 'Routine' })
  const panel = await within(frame).findByRole('group', { name: 'P&L comparison' })
  await within(panel).findByText('Win rate on days you finished it: 58% (22 days). Other days: 41% (9 days).')
  expect(within(panel).getAllByText(SMALL_SAMPLE)).toHaveLength(2)
  expect([...panel.children].at(-1).textContent).toBe(CAVEAT)
  expect(within(frame).getByText('For Tue Oct 27')).toBeTruthy()
  expect(within(frame).getByRole('button', { name: ROUTINE_FLIP }).getAttribute('aria-pressed')).toBe('true')
  expect(within(frame).queryAllByRole('checkbox')).toEqual([])
})

axeSurface('vs-pnl-panel:tracker', async () => {
  serve([200, {
    buckets: [{ label: 'Under 6h', ...g(9, -210, '−$210 average (9 days)') }, { label: '6h-8h', ...g(22, 95, '+$95 average (22 days)') }],
    sentence: 'Sleep under 6h: avg day −$210 (9 days); 6h-8h: +$95 (22 days). A comparison, not proof.',
  }])
  const { container } = render(<VsPnlPanel kind="tracker" id="t1" />)
  await screen.findByText('Under 6h: −$210 average (9 days)')
  expect(container.querySelectorAll('[data-pnl-group]')).toHaveLength(2)
  return { root: container }
})

axeSurface('vs-pnl-panel:failed', async () => {
  serve([500, {}])
  const { container } = render(<VsPnlPanel kind="routine" id="r1" />)
  await screen.findByText(FAILED)
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  return { root: container }
})

axeSurface('vs-pnl-panel:no-days', async () => {
  const none = g(0, null, 'No days with trades yet.')
  serve([200, { done: none, other: none, winRate: { done: none, other: none }, sentence: `No days with trades yet. ${CAVEAT}` }])
  const { container } = render(<VsPnlPanel kind="routine" id="r1" />)
  await screen.findByText('No days with trades yet.')
  expect(container.querySelectorAll('[data-pnl-group]')).toHaveLength(0)
  return { root: container }
})
