// app/src/pages/journal-2-0/a11y/traderBlockRoutine.a11y.test.jsx
//
// Wave 9 Task 9.13: the routine block through 8A's axe harness, in the REAL BlockNodeView frame (its named group and
// Remove button), in the states a member meets: editable with ticks (a negative item reading "Didn't happen", the
// partial, Skip, the lines and the ⋯ button), the ⋯ menu open, read-only (items as text, no buttons), archived, a
// read failure with its Retry, and offline. Each recipe asserts what painted before axe runs, so an empty screen
// cannot pass as a clean one. `fetch` is a fake routines server; nothing reaches the network.
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import { vi, expect, afterEach } from 'vitest'
import { axeSurface } from './surface'

vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children, ...p }) => <div {...p}>{children}</div> }))
import BlockNodeView from '../components/notebook/blocks/BlockNodeView'
import { TOOL_COPY } from '../lib/blocks/toolsApi'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })
const ITEMS = [
  { id: 'i1', text: 'Read the morning wire', negative: false },
  { id: 'i2', text: 'Mark key levels', negative: false },
  { id: 'i3', text: 'No revenge trades', negative: true },
]
function serve({ archived = false, readStatus = 200, suggested = [] } = {}) {
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    if (url !== '/api/j2/routines/days') return json(404, {})
    if (readStatus !== 200) return json(readStatus, {})
    const { ids, days } = JSON.parse(init.body)
    const entry = (day) => ({
      day, state: 'open', ticked: { i1: true, i2: false, i3: true }, skipped: false, partial: '2 of 3', items: ITEMS,
      writable: !archived, beyondNote: null, consistency: '18 of the last 20 trading days (2 skipped)',
      run: { line: '7 sessions in a row', milestone: true, best: null }, suggested,
    })
    return json(200, { routines: Object.fromEntries(ids.map((id) => [id, {
      routine: { id, name: 'Pre-market routine', archived }, days: Object.fromEntries(days.map((d) => [d, entry(d)])) }])) })
  })
}
const node = { attrs: { widgetId: 'routine', params: { routineId: 'r1', day: '2026-10-27', bind: 'note-day' }, searchText: '[routine: Pre-market routine · For Tue Oct 27]' } }
const editor = (editable = true) => ({ isEditable: editable, storage: { uctJournalWidgets: { noteId: 'n1', noteDay: '2026-10-27' } } })
const mount = (editable = true) => render(<BlockNodeView node={node} editor={editor(editable)} updateAttributes={() => {}} deleteNode={() => {}} />)

afterEach(() => { setOnline(true) })

axeSurface('trader-block-routine', async () => {
  serve()
  mount()
  const frame = await screen.findByRole('group', { name: 'Routine' })
  await within(frame).findByRole('checkbox', { name: 'Read the morning wire' })
  expect(within(frame).getAllByRole('checkbox')).toHaveLength(3)
  expect(within(frame).getByText("Didn't happen")).toBeTruthy()
  expect(within(frame).getByText('2 of 3')).toBeTruthy()
  expect(within(frame).getByRole('button', { name: 'Skip this day' })).toBeTruthy()
  expect(within(frame).getByText('7 sessions in a row')).toBeTruthy()
  expect(within(frame).getByRole('button', { name: 'Routine options' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Remove Routine' })).toBeTruthy()
})

// Task 9.15: the from-your-trades hint beside an unticked item, read with it.
axeSurface('trader-block-routine:suggested', async () => {
  serve({ suggested: ['i2'] })
  mount()
  const frame = await screen.findByRole('group', { name: 'Routine' })
  const box = await within(frame).findByRole('checkbox', { name: 'Mark key levels' })
  expect(within(frame).getByText('From your trades: looks done').id).toBe(box.getAttribute('aria-describedby'))
  expect(box.getAttribute('aria-checked')).toBe('false')
})

axeSurface('trader-block-routine:menu', async () => {
  serve()
  mount()
  const frame = await screen.findByRole('group', { name: 'Routine' })
  await within(frame).findByRole('checkbox', { name: 'Read the morning wire' })
  fireEvent.click(within(frame).getByRole('button', { name: 'Routine options' }))
  const menu = screen.getByRole('menu')
  expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Edit routine', 'Manage…', 'Follow today', 'Show the P&L comparison first'])
})

axeSurface('trader-block-routine:readonly', async () => {
  serve()
  mount(false)
  const frame = await screen.findByRole('group', { name: 'Routine' })
  expect(await within(frame).findByText('Read the morning wire')).toBeTruthy()
  expect(within(frame).queryAllByRole('checkbox')).toEqual([])
  expect(within(frame).queryAllByRole('button')).toEqual([])
})

axeSurface('trader-block-routine:archived', async () => {
  serve({ archived: true })
  mount()
  const frame = await screen.findByRole('group', { name: 'Routine' })
  expect(await within(frame).findByText(TOOL_COPY.archivedRoutine)).toBeTruthy()
  expect(within(frame).queryAllByRole('checkbox')).toEqual([])
})

axeSurface('trader-block-routine:read-failed', async () => {
  serve({ readStatus: 500 })
  mount()
  const frame = await screen.findByRole('group', { name: 'Routine' })
  expect(await within(frame).findByText(TOOL_COPY.readFailedRoutine)).toBeTruthy()
  expect(within(frame).getByRole('button', { name: 'Retry' })).toBeTruthy()
})

axeSurface('trader-block-routine:offline', async () => {
  serve()
  mount()
  const frame = await screen.findByRole('group', { name: 'Routine' })
  await within(frame).findByRole('checkbox', { name: 'Read the morning wire' })
  act(() => { setOnline(false); window.dispatchEvent(new Event('offline')) })
  expect(await within(frame).findByText(TOOL_COPY.offline)).toBeTruthy()
  expect(within(frame).getAllByRole('checkbox').every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true)
})
