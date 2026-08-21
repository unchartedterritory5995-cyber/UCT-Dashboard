import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ShellToolbar from './ShellToolbar'

const META = { views: [{ key: 'overview', label: 'Overview' }, { key: 'momentum', label: 'Momentum' }] }
const SNAP = { rows: 3742, snapshot_date: '2026-08-21', rows_on_snapshot_date: 3540,
  oldest_snapshot_date: '2026-08-19', newest_snapshot_date: '2026-08-21',
  rows_missing_snapshot_date: 0, mixed: true }
const base = {
  meta: META, view: 'overview', onView: vi.fn(), visibleColumns: ['ticker'], allColumns: [],
  onColumns: vi.fn(), onResetColumns: vi.fn(), density: 'compact', onDensity: vi.fn(),
  snapshot: SNAP, snapshotDate: '2026-08-21', total: 120, shown: 100, isLoading: false,
  onExport: vi.fn(), exportState: {}, saveBar: <span>savebar</span>,
}

describe('ShellToolbar', () => {
  it('views come from meta and select through onView', () => {
    render(<ShellToolbar {...base} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Momentum' }))
    expect(base.onView).toHaveBeenCalledWith('momentum')
  })

  it('the seal opens the provenance popover and says when the snapshot is mixed', () => {
    render(<ShellToolbar {...base} />)
    fireEvent.click(screen.getByRole('button', { name: /snapshot 2026-08-21/i }))
    expect(screen.getByRole('dialog', { name: /provenance/i })).toHaveTextContent(/3,540/)
    expect(screen.getByText(/mixed snapshot/i)).toBeInTheDocument()
  })

  it('density toggles with aria-pressed; export error is a status', () => {
    render(<ShellToolbar {...base} exportState={{ error: 'Export failed — nothing downloaded.' }} />)
    expect(screen.getByRole('button', { name: /density/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(/nothing downloaded/i)
  })

  it('unmounting with the seal popover open removes the outside-click listener', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<ShellToolbar {...base} />)
    fireEvent.click(screen.getByRole('button', { name: /snapshot 2026-08-21/i }))
    const added = addSpy.mock.calls.filter(([t]) => t === 'mousedown').length
    unmount()
    const removed = removeSpy.mock.calls.filter(([t]) => t === 'mousedown').length
    expect(added).toBeGreaterThan(0)
    expect(removed).toBe(added)
    addSpy.mockRestore(); removeSpy.mockRestore()
  })
})
