// Wave 9 (Task 9.18): My tools, the Trackers tab. Every assertion reads what the member SEES (rendered text, roles,
// names) or what the server is SENT (method, path, If-Match, body), never component state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import MyToolsSheet from './MyToolsSheet'
import { installToolsFetch, refuse } from './__fixtures__/toolsFixtures'
import { openTrackerEditor } from '../routines/openTrackerEditor.js'
import { openRoutineEditor } from '../routines/openRoutineEditor.js'
import { openSharePreview } from '../library/openSharePreview.js'

const bp = vi.hoisted(() => ({ phone: false, touch: false }))
vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => bp.phone, useIsTouch: () => bp.touch, useIsTablet: () => false, useIsDesktop: () => !bp.touch,
  useHasCoarsePointer: () => bp.touch, useHasNoHover: () => bp.touch,
}))
vi.mock('../routines/openRoutineEditor.js', () => ({ openRoutineEditor: vi.fn(() => () => {}) }))
vi.mock('../routines/openTrackerEditor.js', () => ({ openTrackerEditor: vi.fn(() => () => {}) }))
// Wave 11 (Task 11.19): the library doors, off by default here so the wave 9 assertions read what they read before.
const flags = vi.hoisted(() => ({ on: false }))
vi.mock('../../../lib/notebookWidgetsFlags', async (orig) => ({ ...(await orig()), widgetsWaveOn: (w) => w === 11 && flags.on }))
vi.mock('../../../lib/styleLibraryFlag', async (orig) => ({ ...(await orig()), styleLibraryEnabled: () => flags.on }))
vi.mock('../library/openSharePreview.js', () => ({ openSharePreview: vi.fn(() => () => {}) }))

const S_CONFLICT = 'SERVER: this tracker changed in another tab.'
const live = () => screen.getByTestId('my-tools-message')
const saysLive = (text) => waitFor(() => expect(live()).toHaveTextContent(text))

let net
beforeEach(() => {
  bp.phone = false
  bp.touch = false
  net = installToolsFetch()
  openTrackerEditor.mockClear()
  openRoutineEditor.mockClear()
  openSharePreview.mockClear()
  flags.on = false
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openTab() {
  render(<MyToolsSheet onClose={() => {}} uid="u1" tab="trackers" />)
  await screen.findByRole('heading', { name: /trackers?$/ })
}
const rows = () => screen.getAllByTestId('my-tools-tool-row')
const nameOf = (r) => r.querySelector('[data-tool-name]')?.textContent
const rowOf = (name) => rows().find((r) => nameOf(r) === name)
async function menuFor(name) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }))
  return bp.touch ? screen.findByRole('dialog', { name }) : screen.findByRole('menu', { name })
}
const menuItem = (label) => screen.getByRole(bp.touch ? 'button' : 'menuitem', { name: label })
const menuLabels = () => screen.queryAllByRole(bp.touch ? 'button' : 'menuitem').map((b) => b.textContent)
const showList = (label) => fireEvent.click(screen.getByRole('button', { name: label, pressed: false }))
const sent = (method, path) => net.calls.filter((c) => c.method === method && c.path === path)

describe('My tools, Trackers tab', () => {
  it('trackers_rows_with_builtins_first_read_only', async () => {
    await openTab()
    expect(net.calls[0]).toMatchObject({ method: 'GET', path: 'trackers?filter=active' })
    expect(screen.getByRole('tabpanel', { name: 'Trackers' })).toBeInTheDocument()
    // The two check-in trackers first (the fixture hands one of them over last), then the member's own.
    expect(rows().map(nameOf)).toEqual(['Check-in mood', 'Check-in focus', 'Sleep', 'Coffee'])
    expect(screen.getByRole('heading', { name: '4 trackers' })).toBeInTheDocument()
    for (const name of ['Check-in mood', 'Check-in focus']) {
      const r = rowOf(name)
      expect(r).toHaveTextContent('From your check-ins')
      expect(r).toHaveTextContent('1-5 scale')
      expect(r).not.toHaveTextContent(/Used in|Not in any note|Edited/)
      expect(r.querySelector('svg')).not.toBeNull()
    }
    // Read-only: Open, and nothing else.
    await menuFor('Check-in mood')
    expect(menuLabels()).toEqual(['Open'])
    fireEvent.click(menuItem('Open'))
    await waitFor(() => expect(openTrackerEditor).toHaveBeenCalledTimes(1))
    expect(openTrackerEditor.mock.calls[0][0]).toMatchObject({ trackerId: 'checkin:mood' })
    expect(openRoutineEditor).not.toHaveBeenCalled()
    // The member's own: kind and unit, Used in, last edited.
    const sleep = rowOf('Sleep')
    expect(sleep).toHaveTextContent('Duration')
    expect(within(sleep).getByRole('button', { name: /^Used in 1 note/ })).toBeInTheDocument()
    expect(sleep).toHaveTextContent('Edited Mar 4, 2025')
    expect(sleep).not.toHaveTextContent('From your check-ins')
    const coffee = rowOf('Coffee')
    expect(coffee).toHaveTextContent('Number · cups')
    expect(coffee).toHaveTextContent('Not in any note')
    await menuFor('Sleep')
    expect(menuLabels()).toEqual(expect.arrayContaining(['Open', 'Rename', 'Duplicate', 'Used in 1 note', 'Archive']))
  })

  it('Used in lists the tracker’s notes (UsedInList takes the kind)', async () => {
    await openTab()
    fireEvent.click(within(rowOf('Sleep')).getByRole('button', { name: /^Used in 1 note/ }))
    expect(await screen.findByRole('heading', { name: '“Sleep” is in 1 note' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Sleep log/ })).toHaveAttribute('href', '/journal/notebook?note=n7')
    expect(sent('GET', 'trackers/t1/used-in')).toHaveLength(1)
    expect(net.calls.some((c) => c.url.includes('widget-definitions'))).toBe(false)
  })

  it('rename carries If-Match and shows the conflict sentence', async () => {
    net = installToolsFetch([['PUT', 'trackers/t1', () => refuse(409, 'conflict', S_CONFLICT)]])
    await openTab()
    await menuFor('Sleep')
    fireEvent.click(menuItem('Rename'))
    const field = await screen.findByRole('textbox', { name: 'Name' })
    fireEvent.change(field, { target: { value: 'Sleep hours' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await saysLive(S_CONFLICT)
    expect(sent('PUT', 'trackers/t1')[0].headers['If-Match']).toBe('4')
    expect(sent('PUT', 'trackers/t1')[0].body).toEqual({ name: 'Sleep hours' })
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('archive says what happens to the notes, and Delete permanently is only in Archived', async () => {
    net = installToolsFetch([
      ['POST', 'trackers/t1/archive', () => ({ id: 't1', archived: true })],
      ['POST', 'trackers/ta1/delete', () => ({ id: 'ta1', deletedAt: '2025-03-05T17:00:00Z' })],
    ])
    await openTab()
    await menuFor('Sleep')
    expect(menuLabels()).not.toContain('Delete permanently')
    fireEvent.click(menuItem('Archive'))
    expect(await screen.findByText('It stays in your 1 note. Its history is kept.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to your trackers' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Archive tracker' }))
    await saysLive('Archived “Sleep”. Restore it from Archived.')
    showList('Archived')
    await screen.findByRole('heading', { name: '1 archived' })
    await menuFor('Old tracker')
    fireEvent.click(menuItem('Delete permanently'))
    const field = await screen.findByRole('textbox', { name: /Type Old tracker to confirm/ })
    fireEvent.change(field, { target: { value: 'Old tracker' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await saysLive('“Old tracker” moved to Recently deleted.')
    expect(sent('POST', 'trackers/ta1/delete')[0].body).toEqual({ typedName: 'Old tracker' })
  })

  it('Recently deleted: Restore, kept 30 days, and no check-in tracker in Archived or Recently deleted', async () => {
    net = installToolsFetch([['POST', 'trackers/tx1/undelete', () => ({ ...net.data.trackers.deleted[0], deleted: false })]])
    await openTab()
    showList('Archived')
    await screen.findByRole('heading', { name: '1 archived' })
    expect(screen.queryByText('Check-in mood')).toBeNull()
    showList('Recently deleted')
    await screen.findByRole('heading', { name: '1 recently deleted' })
    expect(rowOf('Gone tracker')).toHaveTextContent('Kept until Feb 19, 2025')
    fireEvent.click(within(rowOf('Gone tracker')).getByRole('button', { name: 'Restore Gone tracker' }))
    await saysLive('Restored “Gone tracker”. It\'s in Archived.')
    expect(sent('POST', 'trackers/tx1/undelete')).toHaveLength(1)
  })

  it('no Share action in wave 9, on any list', async () => {
    await openTab()
    for (const [list, name] of [[null, 'Sleep'], [null, 'Check-in focus'], ['Archived', 'Old tracker'], ['Recently deleted', 'Gone tracker']]) {
      if (list) { showList(list); await screen.findByText(name, { exact: true }) }
      await menuFor(name)
      expect(menuLabels().length).toBeGreaterThan(0)
      expect(menuLabels().filter((l) => /share|library/i.test(l))).toEqual([])
      fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    }
  })

  it('tools_rows_show_credit_and_share', async () => {
    flags.on = true
    const [mood, sleep, coffee] = net.data.trackers.active
    net = installToolsFetch([['GET', 'trackers?filter=active', () => ({
      trackers: [mood, sleep, { ...coffee, credit: "Based on a former member's Coffee", sourceGalleryId: 'g2', fromLibrary: true }],
    })]])
    await openTab()
    expect(rowOf('Coffee')).toHaveTextContent("Based on a former member's Coffee")
    expect(rowOf('Sleep')).not.toHaveTextContent('Based on')
    await menuFor('Sleep')
    fireEvent.click(menuItem('Share to library'))
    await waitFor(() => expect(openSharePreview).toHaveBeenCalledTimes(1))
    expect(openSharePreview.mock.calls[0][0]).toMatchObject({ kind: 'tracker', id: 't1' })
    await menuFor('Coffee')
    expect(menuLabels()).not.toContain('Share to library')                  // a copy
    expect(menuLabels()).toContain('Rename')
    await menuFor('Check-in mood')
    expect(menuLabels()).toEqual(['Open'])                                  // a check-in tracker: Open only, never shared
  })
})
