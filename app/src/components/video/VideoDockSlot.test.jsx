import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import VideoDockSlot from './VideoDockSlot'
import * as store from './videoStore'

beforeEach(() => store.__reset())

const LIST = [
  { id: 1, youtube_id: 'aaaaaaaaaaa', title: 'First Video' },
  { id: 2, youtube_id: 'bbbbbbbbbbb', title: 'Second Video' },
]

describe('VideoDockSlot', () => {
  it('renders nothing when no video is active', () => {
    const { container } = render(<VideoDockSlot />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the theater and registers a dock rect when docked', () => {
    act(() => store.play(LIST, 0))
    render(<VideoDockSlot />)
    expect(store.getSnapshot().dockRect).not.toBeNull()
    expect(screen.getByText('Second Video')).toBeInTheDocument() // up-next rail
  })

  it('shows a restore strip (not the theater) when minimized, and Restore re-docks', () => {
    act(() => store.play(LIST, 0))
    act(() => store.minimize()) // user parked it in the corner
    render(<VideoDockSlot />)
    // the full theater up-next rail is not shown while minimized
    expect(screen.queryByText('Second Video')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /restore to theater/i }))
    expect(store.getSnapshot().mode).toBe('docked')
  })

  it('clears the dock rect (auto-mini) on unmount', () => {
    act(() => store.play(LIST, 0))
    const { unmount } = render(<VideoDockSlot />)
    act(() => unmount())
    expect(store.getSnapshot().mode).toBe('mini')
    expect(store.getSnapshot().dockRect).toBeNull()
  })

  it('Up-Next rail jumps to the clicked video', () => {
    act(() => store.play(LIST, 0))
    render(<VideoDockSlot />)
    fireEvent.click(screen.getByText('Second Video'))
    expect(store.getSnapshot().index).toBe(1)
  })
})
