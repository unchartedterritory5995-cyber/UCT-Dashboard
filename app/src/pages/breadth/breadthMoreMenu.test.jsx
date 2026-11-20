/**
 * The top bar's ⋯ menu (owner 11-19): Snapshot… · Copy share link · Export CSV — the old
 * "Share Breadth" panel is gone. Snapshot… opens the Signature snapshot popover (its capture is
 * mocked), Esc closes it with focus back on ⋯, and Copy share link copies this URL + `?d=`.
 * Same shell-mocking pattern as monitorGridError.test.jsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))
vi.mock('../CotData', () => ({ default: () => <div /> }))
vi.mock('../BreadthCharts', () => ({ default: () => <div /> }))
vi.mock('../../components/tiles/MarketBreadth', () => ({ default: () => <div /> }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'user' } }) }))
vi.mock('../../hooks/useFlagged', () => ({
  useFlagged: () => ({ flagged: [], toggle: () => {}, remove: () => {}, isFlagged: () => false,
                       isShared: false, toggleShare: () => {}, flaggedName: 'Flagged',
                       renameFlagged: () => {} }),
}))
vi.mock('../../hooks/useLiveBreadth', () => ({
  useLiveBreadth: () => ({ row: null, stamp: null, superseded: true }),
  formatLiveClock: () => 'now',
}))
vi.mock('swr', () => ({
  default: () => ({ data: { rows: [], days: 90 }, isLoading: false, error: null, mutate: () => {} }),
  useSWRConfig: () => ({ mutate: () => {} }),
}))
vi.mock('./useMonitorGrid', () => ({
  default: () => ({
    allDates: ['2026-11-18', '2026-11-17', '2026-11-16'], getRow: () => null, trail: () => [],
    ensureRange: () => {}, refresh: () => {}, indexOfDate: () => 0, indexOfYearStart: () => 0,
    min: '2026-11-16', max: '2026-11-18', ready: true, count: 3, datesFailed: false, blocksFailed: 0,
    retry: () => {}, universe: 'uct',
  }),
}))
const shot = vi.hoisted(() => ({ captureBreadthSheet: vi.fn(), copyPng: vi.fn(), downloadBlob: vi.fn() }))
vi.mock('./breadthSnapshot', () => shot)

import Breadth from '../Breadth'

const mount = (q = '?tab=breadth') => render(<MemoryRouter initialEntries={[`/breadth${q}`]}><Breadth /></MemoryRouter>)
const openMore = () => fireEvent.click(screen.getByTestId('breadth-more-menu'))

beforeEach(() => {
  shot.captureBreadthSheet.mockReset()
  shot.captureBreadthSheet.mockResolvedValue({ blob: new Blob(['png']), width: 4096, height: 1400, filename: 'uct-breadth-uct-2026-11-18.png', rows: 3 })
  if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:x'
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {}
})

describe('the Breadth ⋯ menu', () => {
  it('offers Snapshot…, Copy share link and Export CSV — and no old Share panel', () => {
    mount()
    openMore()
    const items = screen.getAllByRole('menuitem').map((n) => n.textContent.trim())
    expect(items).toEqual(['Snapshot…', 'Copy share link', 'Export CSV'])
    expect(screen.queryByText('Share Breadth')).toBeNull()
  })

  it('Snapshot… opens the popover on the sheet; Esc closes it with focus back on ⋯', async () => {
    mount()
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Snapshot…' }))
    expect(await screen.findByRole('dialog', { name: 'Breadth snapshot' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Download PNG' })).toBeInTheDocument()
    const [sheet, opts] = shot.captureBreadthSheet.mock.calls[0]
    expect(sheet).toHaveAttribute('data-guide', 'breadth.table')
    expect(opts).toMatchObject({ universe: 'uct', universeLabel: 'UCT', topDate: '2026-11-18' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Breadth snapshot' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('breadth-more-menu'))
  })

  it('Copy share link copies the page URL with the top session as ?d=', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mount()
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy share link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const u = new URL(writeText.mock.calls[0][0])
    expect(u.pathname).toBe('/breadth')
    expect(u.searchParams.get('d')).toBe('2026-11-18')
    expect(await screen.findByTestId('breadth-share-link-note')).toHaveTextContent('Link copied')
  })
})
