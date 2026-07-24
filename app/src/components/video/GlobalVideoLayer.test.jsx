import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import GlobalVideoLayer from './GlobalVideoLayer'
import * as store from './videoStore'

vi.mock('../../pages/desk/useYouTubeApi', () => ({ useYouTubeApi: () => true }))

let lastPlayer, lastOnStateChange, lastPlayerVars
beforeEach(() => {
  store.__reset()
  lastPlayer = null
  lastOnStateChange = null
  lastPlayerVars = null
  window.YT = {
    Player: class {
      constructor(mount, opts) {
        lastOnStateChange = opts.events?.onStateChange
        lastPlayerVars = opts.playerVars
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
        // Mirror real YT.Player behavior: onReady fires once the player is
        // actually command-ready. Calling it here (post-construction, all
        // spies wired) lets tests exercise the onReady-driven mute/play path.
        opts.events?.onReady?.({ target: this })
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

  it('shows the UCT broadcast watermark when docked, not when minimized', () => {
    renderLayer()
    act(() => store.play(LIST, 0))
    expect(screen.getByTestId('brand-watermark')).toBeInTheDocument()
    act(() => store.minimize())
    expect(screen.queryByTestId('brand-watermark')).not.toBeInTheDocument()
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

  // jsdom (like iPhone WebKit) has NO element-fullscreen API — the button must
  // fall back to fake fullscreen instead of silently doing nothing.
  it('fullscreen button falls back to viewport-pinned mode without a fullscreen API', () => {
    const { container } = renderLayer()
    act(() => store.play(LIST, 0))
    fireEvent.click(screen.getByLabelText('Fullscreen'))
    const host = container.firstChild
    expect(host.style.top).toBe('0px')
    expect(host.style.left).toBe('0px')
    expect(document.documentElement.style.overflow).toBe('hidden')
    // Toggles back off
    fireEvent.click(screen.getByLabelText('Exit fullscreen'))
    expect(screen.getByLabelText('Fullscreen')).toBeInTheDocument()
    expect(document.documentElement.style.overflow).not.toBe('hidden')
  })

  it('fullscreen button uses the native API when available', () => {
    const req = vi.fn(() => Promise.resolve())
    HTMLElement.prototype.requestFullscreen = req
    try {
      renderLayer()
      act(() => store.play(LIST, 0))
      fireEvent.click(screen.getByLabelText('Fullscreen'))
      expect(req).toHaveBeenCalled()
      // Native path engaged — no fake-fullscreen scroll lock
      expect(document.documentElement.style.overflow).not.toBe('hidden')
    } finally {
      delete HTMLElement.prototype.requestFullscreen
    }
  })

  it('leaving the docked theater exits fake fullscreen', () => {
    const { container } = renderLayer()
    act(() => store.play(LIST, 0))
    fireEvent.click(screen.getByLabelText('Fullscreen'))
    expect(container.firstChild.style.top).toBe('0px')
    act(() => store.minimize())
    expect(document.documentElement.style.overflow).not.toBe('hidden')
    expect(container.firstChild.style.top).not.toBe('0px')
  })

  describe('mobile audio-primary playback', () => {
    const prevFlag = import.meta.env.VITE_DESK_BG_AUDIO_ENABLED
    const prevMatchMedia = window.matchMedia

    afterEach(() => {
      import.meta.env.VITE_DESK_BG_AUDIO_ENABLED = prevFlag
      window.matchMedia = prevMatchMedia
    })

    it('starts the audio element muted-video on mobile when the flag is on', () => {
      import.meta.env.VITE_DESK_BG_AUDIO_ENABLED = '1'
      window.matchMedia = (q) => ({ matches: q.includes('coarse'), addEventListener() {}, removeEventListener() {} })
      const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue()

      renderLayer()
      act(() => store.play([{ id: 7, youtube_id: 'abc', audio_url: 'desk_audio/abc.m4a' }], 0))

      const audioEl = document.querySelector('audio[data-uct-video-audio]')
      expect(audioEl).toBeTruthy()
      expect(audioEl.getAttribute('src')).toMatch(/\/api\/education\/videos\/7\/audio$/)
      expect(playSpy).toHaveBeenCalled()
      // Born muted via playerVars — no audible-autoplay window before onReady.
      expect(lastPlayerVars.mute).toBe(1)
      // Authoritative mute happens through the onReady-ready path (the fix):
      // the mock invokes onReady synchronously post-construction, so this
      // call can only have come from the onReady handler, not the raw ctor.
      expect(lastPlayer.mute).toHaveBeenCalled()
      expect(lastPlayer.playVideo).toHaveBeenCalled()
    })

    it('does not touch the audio element when the flag is off (desktop-identical behavior)', () => {
      import.meta.env.VITE_DESK_BG_AUDIO_ENABLED = '0'
      window.matchMedia = (q) => ({ matches: q.includes('coarse'), addEventListener() {}, removeEventListener() {} })

      renderLayer()
      act(() => store.play(LIST, 0))

      const audioEl = document.querySelector('audio[data-uct-video-audio]')
      expect(audioEl).toBeTruthy()
      expect(audioEl.getAttribute('src')).toBeFalsy()
      expect(lastPlayer.mute).not.toHaveBeenCalled()
      expect(lastPlayerVars.mute).toBeUndefined()
    })

    it('does not touch the audio element on a mouse-pointer device even with the flag on', () => {
      import.meta.env.VITE_DESK_BG_AUDIO_ENABLED = '1'
      window.matchMedia = (q) => ({ matches: false, addEventListener() {}, removeEventListener() {} })

      renderLayer()
      act(() => store.play(LIST, 0))

      const audioEl = document.querySelector('audio[data-uct-video-audio]')
      expect(audioEl.getAttribute('src')).toBeFalsy()
      expect(lastPlayer.mute).not.toHaveBeenCalled()
      expect(lastPlayerVars.mute).toBeUndefined()
    })
  })
})
