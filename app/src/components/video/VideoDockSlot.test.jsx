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

  it('registers a dock rect on mount and re-docks the store', () => {
    act(() => store.play(LIST, 0))
    act(() => { store.clearDockSlot() }) // simulate having been minimized
    expect(store.getSnapshot().mode).toBe('mini')
    render(<VideoDockSlot />)
    expect(store.getSnapshot().mode).toBe('docked')
    expect(store.getSnapshot().dockRect).not.toBeNull()
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
