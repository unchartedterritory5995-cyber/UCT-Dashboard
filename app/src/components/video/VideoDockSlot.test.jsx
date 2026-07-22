import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import VideoDockSlot from './VideoDockSlot'
import * as store from './videoStore'

beforeEach(() => store.__reset())

const LIST = [
  { id: 1, youtube_id: 'aaaaaaaaaaa', title: 'First Video' },
  { id: 2, youtube_id: 'bbbbbbbbbbb', title: 'Second Video' },
]

describe('VideoDockSlot', () => {
  it('renders nothing when no video is active', () => {
    const { container } = render(<MemoryRouter><VideoDockSlot /></MemoryRouter>)
    expect(container.firstChild).toBeNull()
  })

  it('renders the theater and registers a dock rect when docked', () => {
    act(() => store.play(LIST, 0))
    render(<MemoryRouter><VideoDockSlot /></MemoryRouter>)
    expect(store.getSnapshot().dockRect).not.toBeNull()
    expect(screen.getByText('Second Video')).toBeInTheDocument() // up-next rail
  })

  it('shows a restore strip (not the theater) when minimized, and Restore re-docks', () => {
    act(() => store.play(LIST, 0))
    act(() => store.minimize()) // user parked it in the corner
    render(<MemoryRouter><VideoDockSlot /></MemoryRouter>)
    // the full theater up-next rail is not shown while minimized
    expect(screen.queryByText('Second Video')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /restore to theater/i }))
    expect(store.getSnapshot().mode).toBe('docked')
  })

  it('clears the dock rect (auto-mini) on unmount', () => {
    act(() => store.play(LIST, 0))
    const { unmount } = render(<MemoryRouter><VideoDockSlot /></MemoryRouter>)
    act(() => unmount())
    expect(store.getSnapshot().mode).toBe('mini')
    expect(store.getSnapshot().dockRect).toBeNull()
  })

  it('Up-Next rail jumps to the clicked video', () => {
    act(() => store.play(LIST, 0))
    render(<MemoryRouter><VideoDockSlot /></MemoryRouter>)
    fireEvent.click(screen.getByText('Second Video'))
    expect(store.getSnapshot().index).toBe(1)
  })

  it('scrolls the theater into view on a user pick, but not on autoplay-next', () => {
    const L3 = [...LIST, { id: 3, youtube_id: 'ccccccccccc', title: 'Third Video' }]
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    act(() => store.play(L3, 0))
    render(<MemoryRouter><VideoDockSlot /></MemoryRouter>)
    spy.mockClear() // discard the mount-time scroll from the initial pick
    act(() => store.next()) // autoplay advance — must NOT yank the page
    expect(spy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Third Video')) // explicit up-next pick
    expect(spy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    delete Element.prototype.scrollIntoView
  })
})
