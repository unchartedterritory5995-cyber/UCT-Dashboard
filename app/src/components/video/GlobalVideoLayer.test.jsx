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
        this.seekTo = vi.fn()
        this.setPlaybackRate = vi.fn()
        this.mute = vi.fn()
        this.unMute = vi.fn()
        this.loadModule = vi.fn()
        this.unloadModule = vi.fn()
        this.setOption = vi.fn()
        this.getOption = () => []
        this.getCurrentTime = () => 20
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

  it('Expand button navigates to the Desk and re-docks', () => {
    renderLayer()
    act(() => store.play(LIST, 0))
    act(() => store.minimize())
    fireEvent.click(screen.getByLabelText('Expand to Desk'))
    expect(store.getSnapshot().mode).toBe('docked')
  })

  it('the speed button cycles the playback rate', () => {
    renderLayer()
    act(() => store.play(LIST, 0))
    const speed = screen.getByLabelText('Playback speed')
    expect(speed).toHaveTextContent('1×')
    fireEvent.click(speed)
    expect(lastPlayer.setPlaybackRate).toHaveBeenCalledWith(1.25)
    expect(speed).toHaveTextContent('1.25×')
  })

  it('the mute button mutes the player', () => {
    renderLayer()
    act(() => store.play(LIST, 0))
    fireEvent.click(screen.getByLabelText('Mute'))
    expect(lastPlayer.mute).toHaveBeenCalled()
    expect(screen.getByLabelText('Unmute')).toBeInTheDocument()
  })

  it('the captions button loads a caption track', () => {
    renderLayer()
    act(() => store.play(LIST, 0))
    fireEvent.click(screen.getByLabelText('Turn captions on'))
    expect(lastPlayer.loadModule).toHaveBeenCalledWith('captions')
    expect(lastPlayer.setOption).toHaveBeenCalledWith('captions', 'track', { languageCode: 'en' })
    expect(screen.getByLabelText('Turn captions off')).toBeInTheDocument()
  })

  it('Space toggles play/pause via keyboard', () => {
    renderLayer()
    act(() => store.play(LIST, 0)) // starts playing
    fireEvent.keyDown(window, { key: ' ' })
    expect(lastPlayer.pauseVideo).toHaveBeenCalled()
  })

  it('ArrowRight skips forward 15s via keyboard', () => {
    renderLayer()
    act(() => store.play(LIST, 0)) // getCurrentTime() = 20
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(lastPlayer.seekTo).toHaveBeenCalledWith(35, true)
  })

  it('keyboard shortcuts are ignored while typing in a field', () => {
    renderLayer()
    act(() => store.play(LIST, 0))
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(window, { key: ' ' })
    expect(lastPlayer.pauseVideo).not.toHaveBeenCalled()
    input.remove()
  })

  it('skip-forward seeks 15s ahead of the current time', () => {
    renderLayer()
    act(() => store.play(LIST, 0)) // stub getCurrentTime() = 20
    fireEvent.click(screen.getByLabelText('Forward 15 seconds'))
    expect(lastPlayer.seekTo).toHaveBeenCalledWith(35, true)
  })

  it('skip-back seeks 15s behind, clamped at 0', () => {
    renderLayer()
    act(() => store.play(LIST, 0)) // stub getCurrentTime() = 20
    fireEvent.click(screen.getByLabelText('Back 15 seconds'))
    expect(lastPlayer.seekTo).toHaveBeenCalledWith(5, true)
  })
})
