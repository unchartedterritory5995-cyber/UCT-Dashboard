// Wave 9 (Task 9.18 fix 1, I-5): a routine's or tracker's retention is the TOOLS' own (routines/toolEditorLib's
// RECENTLY_DELETED_DAYS, the server's routines/trackers constant), never the widgets'. Both are 30 today, so this
// file moves the tools' value to 14 and reads every place the tab words it: a test with equal values could not tell.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import MyToolsSheet from './MyToolsSheet'
import { installToolsFetch } from './__fixtures__/toolsFixtures'

vi.mock('../routines/toolEditorLib', async (importOriginal) => ({ ...(await importOriginal()), RECENTLY_DELETED_DAYS: 14 }))
vi.mock('../routines/openRoutineEditor.js', () => ({ openRoutineEditor: vi.fn(() => () => {}) }))
vi.mock('../routines/openTrackerEditor.js', () => ({ openTrackerEditor: vi.fn(() => () => {}) }))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the tools tab words the tools’ retention, not the widgets’', () => {
  it('Kept until, the delete hint and the empty Recently deleted all count 14 days', async () => {
    const net = installToolsFetch()
    render(<MyToolsSheet onClose={() => {}} uid="u1" tab="routines" />)
    await screen.findByRole('heading', { name: '3 routines' })
    fireEvent.click(screen.getByRole('button', { name: 'Recently deleted', pressed: false }))
    await screen.findByRole('heading', { name: '1 recently deleted' })
    const row = screen.getAllByTestId('my-tools-tool-row')[0]
    expect(row).toHaveTextContent('Kept until Feb 3, 2025')        // Jan 20 + 14 days
    fireEvent.click(screen.getByRole('button', { name: 'Archived', pressed: false }))
    await screen.findByRole('heading', { name: '1 archived' })
    fireEvent.click(within(screen.getAllByTestId('my-tools-tool-row')[0]).getByRole('button', { name: 'Actions for Old routine' }))
    const del = await screen.findByRole('menuitem', { name: 'Delete permanently' })
    expect(del.getAttribute('aria-description') || del.getAttribute('title')).toBe('Needs the name typed. Kept in Recently deleted for 14 days.')
    expect(net.calls.length).toBeGreaterThan(0)
  })

  it('an empty Recently deleted says 14 days', async () => {
    installToolsFetch([['GET', 'routines?filter=deleted', () => ({ routines: [] })]])
    render(<MyToolsSheet onClose={() => {}} uid="u1" tab="routines" />)
    await screen.findByRole('heading', { name: '3 routines' })
    fireEvent.click(screen.getByRole('button', { name: 'Recently deleted', pressed: false }))
    expect(await screen.findByTestId('my-tools-empty')).toHaveTextContent('Nothing deleted in the last 14 days.')
  })
})
