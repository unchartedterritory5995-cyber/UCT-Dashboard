// app/src/pages/journal-2-0/a11y/toolEditors.a11y.test.jsx
//
// Wave 9 Task 9.16: the routine and tracker editors through 8A's axe harness, in the states a member meets: a new
// routine with its starters, a suggestion and its number, chosen weekdays and the reminder on; an edit with a field
// refusal beside its field, a conflict with Reload and the manage section; the "Keep your changes?" question, Used in,
// an archived routine with Restore and Delete permanently, and the typed-name delete; a new tracker with a unit
// refused as it is typed, an edited tracker whose type is fixed, and a check-in tracker. Each recipe asserts what
// painted before axe runs, so an empty screen cannot pass as a clean one. `fetch` is a fake server.
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { axeSurface } from './surface'
import RoutineEditorSheet from '../components/notebook/routines/RoutineEditorSheet'
import TrackerEditorSheet from '../components/notebook/routines/TrackerEditorSheet'
import { installServer, routine, tracker } from '../components/notebook/routines/__fixtures__/toolsServer'

// The reminder's local line reads a pinned instant and zone, never the wall clock (a Monday, EDT against CDT).
const NOW = new Date('2026-10-26T14:00:00Z')
const items = () => screen.getAllByRole('textbox', { name: /^Item \d+$/ })

axeSurface('routine-editor', async () => {
  installServer()
  render(<RoutineEditorSheet onClose={() => {}} zone="America/Chicago" now={NOW} />)
  const chips = await screen.findByRole('group', { name: 'Start from' })
  fireEvent.click(within(chips).getByRole('button', { name: 'Rules I keep' }))
  expect(items()).toHaveLength(5)
  fireEvent.click(screen.getByRole('radio', { name: 'Chosen weekdays' }))
  fireEvent.click(screen.getByRole('button', { name: 'Wed' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Remind me' }))
  expect(screen.getByRole('combobox', { name: 'Most trades in a day' })).toBeTruthy()
  expect(screen.getByText('9:00 ET · 8:00 your time')).toBeTruthy()
  expect(screen.getByRole('group', { name: 'Weekdays' })).toBeTruthy()
})

axeSurface('routine-editor-edit', async () => {
  const net = installServer({ tools: { r1: routine() } })
  render(<RoutineEditorSheet routineId="r1" onClose={() => {}} zone="America/Chicago" now={NOW} />)
  const name = await screen.findByRole('textbox', { name: 'Name' })
  net.refuseNext('PUT', '/api/j2/routines/r1', 400, { code: 'invalid', message: 'A name can be at most 80 characters.' })
  fireEvent.change(name, { target: { value: 'Prep' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'))
  net.refuseNext('PUT', '/api/j2/routines/r1', 409, { code: 'conflict', message: 'Changed in another tab. Reload to see the newer version.' })
  fireEvent.change(name, { target: { value: 'Prep 2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('button', { name: 'Reload' })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Manage' })).toBeTruthy()
  expect(screen.getByText('Save or discard your changes first.')).toBeTruthy()
})

axeSurface('routine-editor-ask', async () => {
  installServer({ tools: { r1: routine() } })
  render(<RoutineEditorSheet routineId="r1" onClose={() => {}} />)
  fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'Changed' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(await screen.findByRole('heading', { name: 'Keep your changes?' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Discard them' })).toBeTruthy()
})

axeSurface('routine-editor-used-in', async () => {
  installServer({ tools: { r1: routine() } })
  render(<RoutineEditorSheet routineId="r1" onClose={() => {}} />)
  await screen.findByRole('textbox', { name: 'Name' })
  fireEvent.click(screen.getByRole('button', { name: 'Used in 2 notes' }))
  expect(await screen.findByRole('link', { name: /Note 2/ })).toBeTruthy()
})

axeSurface('routine-editor-manage', async () => {
  installServer({ tools: { r1: routine({ archived: true }) } })
  render(<RoutineEditorSheet routineId="r1" onClose={() => {}} />)
  expect(await screen.findByText('Archived routine, history only')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
  expect(screen.getByText('Read the morning wire')).toBeTruthy()
})

axeSurface('routine-editor-delete', async () => {
  installServer({ tools: { r1: routine({ archived: true }) } })
  render(<RoutineEditorSheet routineId="r1" onClose={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }))
  const field = await screen.findByRole('textbox', { name: 'Type Pre-market routine to confirm' })
  fireEvent.change(field, { target: { value: 'Pre-market' } })
  expect(screen.getByText('Delete turns on when the name matches exactly.')).toBeTruthy()
})

axeSurface('tracker-editor', async () => {
  installServer()
  render(<TrackerEditorSheet onClose={() => {}} />)
  await screen.findByRole('heading', { name: 'New tracker' })
  fireEvent.click(screen.getByRole('radio', { name: 'Number' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Unit' }), { target: { value: 'x'.repeat(17) } })
  expect(screen.getByText('A unit can be at most 16 characters.')).toBeTruthy()
})

axeSurface('tracker-editor-edit', async () => {
  installServer({ tools: { t1: tracker() } })
  render(<TrackerEditorSheet trackerId="t1" onClose={() => {}} />)
  expect(await screen.findByText("A tracker's type can't change. Make a new tracker instead.")).toBeTruthy()
  expect(screen.getByRole('radio', { name: 'Number' }).checked).toBe(true)
})

axeSurface('tracker-editor-checkin', async () => {
  installServer({ tools: { 'checkin:mood': tracker({ id: 'checkin:mood', name: 'Check-in mood', kind: 'scale', unit: null, readOnly: true, etag: null, usedIn: 0 }) } })
  render(<TrackerEditorSheet trackerId="checkin:mood" onClose={() => {}} />)
  expect(await screen.findByText('Mood and focus come from your check-ins.')).toBeTruthy()
  expect(screen.queryAllByRole('textbox')).toEqual([])
})

vi.mock('../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => false, useIsTouch: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
