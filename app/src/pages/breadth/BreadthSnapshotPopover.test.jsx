/**
 * The ⋯ menu's "Snapshot…" popover (owner 11-19): the /charts camera's Signature popover for the
 * Monitor sheet. The capture itself is mocked; what is pinned here is the popover's contract —
 * loading state, preview + pixel size, Copy image / Download PNG (and its filename), Esc → close
 * with focus back on ⋯.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useRef } from 'react'

const shot = vi.hoisted(() => ({
  captureBreadthSheet: vi.fn(),
  copyPng: vi.fn(),
  downloadBlob: vi.fn(),
}))
vi.mock('./breadthSnapshot', () => shot)

import BreadthSnapshotPopover from './BreadthSnapshotPopover'

function Harness({ onClose = () => {}, sheet = { id: 'sheet' } }) {
  const btn = useRef(null)
  return (
    <div>
      <button ref={btn} type="button">More</button>
      <BreadthSnapshotPopover getSheet={() => sheet} universe="nasdaq" universeLabel="Nasdaq"
        topDate="2026-11-18" returnFocusTo={btn} onClose={onClose} />
    </div>
  )
}

beforeEach(() => {
  shot.captureBreadthSheet.mockReset()
  shot.copyPng.mockReset()
  shot.downloadBlob.mockReset()
  if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:x'
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {}
})

const ready = () => shot.captureBreadthSheet.mockResolvedValue({
  blob: new Blob(['png'], { type: 'image/png' }), width: 4096, height: 1400,
  filename: 'uct-breadth-nasdaq-2026-11-18.png', rows: 30,
})

describe('BreadthSnapshotPopover', () => {
  it('captures on open: a loading state, then the preview, pixel size and both actions', async () => {
    let resolve
    shot.captureBreadthSheet.mockReturnValue(new Promise((r) => { resolve = r }))
    render(<Harness />)
    expect(screen.getByRole('status')).toHaveTextContent('Capturing…')
    expect(screen.getByRole('dialog', { name: 'Breadth snapshot' })).toHaveAttribute('aria-busy', 'true')
    resolve({ blob: new Blob(['png']), width: 4096, height: 1400, filename: 'f.png', rows: 30 })
    expect(await screen.findByTestId('breadth-snapshot-size')).toHaveTextContent('4096 × 1400')
    expect(screen.getByRole('img', { name: 'Breadth snapshot preview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy image' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download PNG' })).toBeInTheDocument()
    const [sheet, opts] = shot.captureBreadthSheet.mock.calls[0]
    expect(sheet).toEqual({ id: 'sheet' })
    expect(opts).toEqual({ universe: 'nasdaq', universeLabel: 'Nasdaq', topDate: '2026-11-18' })
  })

  it('Download PNG saves the capture under its uct-breadth-<universe>-<date>.png name', async () => {
    ready()
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download PNG' }))
    await waitFor(() => expect(shot.downloadBlob).toHaveBeenCalledTimes(1))
    expect(shot.downloadBlob.mock.calls[0][1]).toBe('uct-breadth-nasdaq-2026-11-18.png')
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('Copy image says so when the clipboard refuses', async () => {
    ready()
    shot.copyPng.mockResolvedValue(false)
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Copy image' }))
    expect(await screen.findByText(/Copy isn’t available here/)).toBeInTheDocument()
    shot.copyPng.mockResolvedValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Copy image' }))
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('a failed capture is said, not a blank panel', async () => {
    shot.captureBreadthSheet.mockRejectedValue(new Error('boom'))
    render(<Harness />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t capture')
  })

  it('Esc closes and hands focus back to ⋯; a press outside closes too', async () => {
    ready()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await screen.findByRole('button', { name: 'Download PNG' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More' }))
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
