import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import GlobalVideoLayer from './GlobalVideoLayer'
import * as store from './videoStore'

vi.mock('../../pages/desk/useYouTubeApi', () => ({ useYouTubeApi: () => true }))

let lastPlayer, lastOnStateChange
beforeEach(() => {
  store.__reset()
  lastPlayer = null
  lastOnStateChange = null
  window.YT = {
    Player: class {
      constructor(mount, opts) {
        lastOnStateChange = opts.events?.onStateChange
        this.loadVideoById = vi.fn()
        this.pauseVideo = vi.fn()
        this.playVideo = vi.fn()
        this.destroy = vi.fn()
        this.getCurrentTime = () => 0
        this.getDuration = () => 0
        lastPlayer = this
      }
    },
  }
})

const LIST = [
  { id: 1, youtube_id: 'aaaaaaaaaaa', title: 'First Video' },
  { id: 2, youtube_id: 'bbbbbbbbbbb', title: 'Second Video' },
]

const renderLayer = () =>
  render(<MemoryRouter><GlobalVideoLayer /></MemoryRouter>)

describe('GlobalVideoLayer', () => {
  it('renders nothing while closed', () => {
    const { container } = renderLayer()
    expect(container.firstChild).toBeNull()
  })

  it('builds the player and shows the title when a video plays', () => {
    renderLayer()
    act(() => store.play(LIST, 0))
    expect(lastPlayer).toBeTruthy()
    expect(screen.getByText('First Video')).toBeInTheDocument()
  })

  it('shows a Next up card when the video ends and advances on Play now', () => {
    renderLayer()
    act(() => store.play(LIST, 0))
    act(() => lastOnStateChange({ data: 0 })) // ENDED
    expect(screen.getByText('Next up')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Play now'))
    expect(store.getSnapshot().index).toBe(1)
    expect(lastPlayer.loadVideoById).toHaveBeenCalledWith({ videoId: 'bbbbbbbbbbb', startSeconds: 0 })
  })

  it('Close button tears the player down and closes the store', () => {
    renderLayer()
    act(() => store.play(LIST, 0))
    fireEvent.click(screen.getByLabelText('Close player'))
    expect(store.getSnapshot().mode).toBe('closed')
    expect(lastPlayer.destroy).toHaveBeenCalled()
  })

  it('Minimize switches the store to mini mode', () => {
    renderLayer()
    act(() => store.play(LIST, 0))
    fireEvent.click(screen.getByLabelText('Minimize'))
    expect(store.getSnapshot().mode).toBe('mini')
  })
})
