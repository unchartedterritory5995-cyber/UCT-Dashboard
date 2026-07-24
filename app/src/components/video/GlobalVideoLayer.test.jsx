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
      // Authoritative mute/play happens through the onReady path (the fix):
      // there is no synchronous post-construction mute()/playVideo() call on
      // this path anymore, so this can only have come from the onReady
      // handler. See the ordering test below for a direct proof of that.
      expect(lastPlayer.mute).toHaveBeenCalled()
      expect(lastPlayer.playVideo).toHaveBeenCalled()
    })

    it('does not call mute/playVideo until onReady fires (guards against a re-introduced synchronous call)', () => {
      import.meta.env.VITE_DESK_BG_AUDIO_ENABLED = '1'
      window.matchMedia = (q) => ({ matches: q.includes('coarse'), addEventListener() {}, removeEventListener() {} })
      vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue()

      // Local override of the global YT.Player mock: defers onReady instead
      // of firing it synchronously in the constructor, so call order can be
      // observed directly.
      let fireOnReady = null
      const prevYT = window.YT
      window.YT = {
        Player: class {
          constructor(mount, opts) {
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
            lastPlayerVars = opts.playerVars
            fireOnReady = () => opts.events?.onReady?.({ target: this })
          }
        },
      }

      try {
        renderLayer()
        act(() => store.play([{ id: 7, youtube_id: 'abc', audio_url: 'desk_audio/abc.m4a' }], 0))

        // Constructed but not yet command-ready: no mute/play calls yet.
        expect(lastPlayer.mute).not.toHaveBeenCalled()
        expect(lastPlayer.playVideo).not.toHaveBeenCalled()

        act(() => fireOnReady())

        expect(lastPlayer.mute).toHaveBeenCalled()
        expect(lastPlayer.playVideo).toHaveBeenCalled()
      } finally {
        window.YT = prevYT
      }
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

  // Task 10: once the <audio> element's own play() has resolved (audioActiveRef
  // flips true), it becomes the playback CLOCK — controls read/write it first
  // and mirror seeks/rate to the still-muted YT player. jsdom's HTMLMediaElement
  // exposes `duration` and `paused` as GETTER-ONLY (no setter) per spec, so
  // tests stub them via Object.defineProperty on the element instance rather
  // than plain assignment.
  describe('audio element as the clock (Task 10)', () => {
    const prevFlag = import.meta.env.VITE_DESK_BG_AUDIO_ENABLED
    const prevMatchMedia = window.matchMedia

    afterEach(() => {
      import.meta.env.VITE_DESK_BG_AUDIO_ENABLED = prevFlag
      window.matchMedia = prevMatchMedia
      // vi.spyOn on an already-spied HTMLMediaElement.prototype method reuses
      // the SAME mock (call history included) across tests — restore so each
      // test's play()/pause() spy starts from a clean call count.
      vi.restoreAllMocks()
    })

    // Renders with the audio-primary path engaged and waits for the initial
    // play() (from the "build the player" effect) to resolve, so audioActiveRef
    // is true and audioOn() reads truthy for the rest of the test.
    const renderWithAudioActive = async () => {
      import.meta.env.VITE_DESK_BG_AUDIO_ENABLED = '1'
      window.matchMedia = (q) => ({ matches: q.includes('coarse'), addEventListener() {}, removeEventListener() {} })
      renderLayer()
      await act(async () => {
        store.play([{ id: 7, youtube_id: 'abc', audio_url: 'desk_audio/abc.m4a' }], 0)
        await Promise.resolve() // flush audioRef.current.play().then(() => audioActiveRef.current = true)
      })
      return document.querySelector('audio[data-uct-video-audio]')
    }

    it('play/pause toggles the audio element (audioEl.paused) once audio is active', async () => {
      vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function () {
        Object.defineProperty(this, 'paused', { value: false, configurable: true })
        return Promise.resolve()
      })
      vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(function () {
        Object.defineProperty(this, 'paused', { value: true, configurable: true })
      })

      const audioEl = await renderWithAudioActive()
      expect(audioEl.paused).toBe(false) // engaged by the initial play()

      // isPlaying starts true (useState(true)) → button reads "Pause".
      fireEvent.click(screen.getByLabelText('Pause'))
      expect(audioEl.paused).toBe(true)

      fireEvent.click(screen.getByLabelText('Play'))
      expect(audioEl.paused).toBe(false)
    })

    it('play/pause also mirrors to the still-muted YT player (pauseVideo/playVideo) once audio is active', async () => {
      vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function () {
        Object.defineProperty(this, 'paused', { value: false, configurable: true })
        return Promise.resolve()
      })
      vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(function () {
        Object.defineProperty(this, 'paused', { value: true, configurable: true })
      })

      await renderWithAudioActive()
      // The audio-primary onReady path already calls playVideo() once at
      // construction (to born-mute-and-play the underlying iframe) — capture
      // that baseline so the assertions below check for a NEW call from
      // togglePlay, not the initial one.
      const playVideoCallsBefore = lastPlayer.playVideo.mock.calls.length

      // isPlaying starts true (useState(true)) → button reads "Pause".
      fireEvent.click(screen.getByLabelText('Pause'))
      expect(lastPlayer.pauseVideo).toHaveBeenCalled()
      expect(lastPlayer.playVideo.mock.calls.length).toBe(playVideoCallsBefore)

      fireEvent.click(screen.getByLabelText('Play'))
      expect(lastPlayer.playVideo.mock.calls.length).toBe(playVideoCallsBefore + 1)
    })

    it('the scrubber drag sets audioEl.currentTime AND mirrors to the YT player via seekTo', async () => {
      // Fake timers must be installed BEFORE the component mounts — the poll
      // effect's setInterval is created with whatever timer implementation is
      // active at that moment; installing fake timers afterward doesn't
      // retarget an already-scheduled real interval.
      vi.useFakeTimers()
      try {
        vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue()
        const audioEl = await renderWithAudioActive()
        Object.defineProperty(audioEl, 'duration', { value: 100, configurable: true })

        // Let the 300ms poll effect pick up the new duration into prog.d so
        // the Scrubber component (gated on its own `duration` prop) accepts a seek.
        act(() => { vi.advanceTimersByTime(300) })

        const slider = screen.getByRole('slider', { name: 'Seek' })
        vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
          left: 0, right: 200, top: 0, bottom: 0, width: 200, height: 20, x: 0, y: 0, toJSON() {},
        })
        fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 }) // 50% of 200px track → frac 0.5

        expect(audioEl.currentTime).toBe(50)
        expect(lastPlayer.seekTo).toHaveBeenCalledWith(50, true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('the speed button sets audioEl.playbackRate AND fakePlayer.setPlaybackRate', async () => {
      vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue()
      const audioEl = await renderWithAudioActive()

      fireEvent.click(screen.getByLabelText('Playback speed'))

      expect(audioEl.playbackRate).toBe(1.25)
      expect(lastPlayer.setPlaybackRate).toHaveBeenCalledWith(1.25)
    })

    it("the registered time getter returns audioEl.currentTime once audio is active", async () => {
      vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue()
      const audioEl = await renderWithAudioActive()
      audioEl.currentTime = 42

      expect(store.getCurrentTime()).toBe(42)
    })

    it('with the flag off, none of the audio-clock paths run (today\'s YT-only behavior)', async () => {
      import.meta.env.VITE_DESK_BG_AUDIO_ENABLED = '0'
      window.matchMedia = (q) => ({ matches: q.includes('coarse'), addEventListener() {}, removeEventListener() {} })
      const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue()

      renderLayer()
      await act(async () => {
        store.play([{ id: 7, youtube_id: 'abc', audio_url: 'desk_audio/abc.m4a' }], 0)
        await Promise.resolve()
      })

      // The audio element never even got a src, let alone play() called on it.
      expect(playSpy).not.toHaveBeenCalled()

      // Every control still drives the YT player exactly as before.
      fireEvent.click(screen.getByLabelText('Pause'))
      expect(lastPlayer.pauseVideo).toHaveBeenCalled()

      fireEvent.click(screen.getByLabelText('Playback speed'))
      expect(lastPlayer.setPlaybackRate).toHaveBeenCalledWith(1.25)

      expect(store.getCurrentTime()).toBe(20) // from fakePlayer.getCurrentTime() stub, not the audio element
    })
  })

  // Task 11: on foreground return (visibilitychange → 'visible'), the muted YT
  // player gets one authoritative seekTo() back to the <audio> clock. The
  // scrubber-poll effect also threshold-gates a periodic drift correction
  // while visible: > 0.4s gap → seekTo, within tolerance → no-op.
  describe('foreground resync + drift correction (Task 11)', () => {
    const prevFlag = import.meta.env.VITE_DESK_BG_AUDIO_ENABLED
    const prevMatchMedia = window.matchMedia
    const prevVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')

    afterEach(() => {
      import.meta.env.VITE_DESK_BG_AUDIO_ENABLED = prevFlag
      window.matchMedia = prevMatchMedia
      if (prevVisibility) Object.defineProperty(document, 'visibilityState', prevVisibility)
      else delete document.visibilityState
      vi.restoreAllMocks()
    })

    const setVisibility = (value) => {
      Object.defineProperty(document, 'visibilityState', { value, configurable: true })
    }

    const renderWithAudioActive = async () => {
      import.meta.env.VITE_DESK_BG_AUDIO_ENABLED = '1'
      window.matchMedia = (q) => ({ matches: q.includes('coarse'), addEventListener() {}, removeEventListener() {} })
      renderLayer()
      await act(async () => {
        store.play([{ id: 7, youtube_id: 'abc', audio_url: 'desk_audio/abc.m4a' }], 0)
        await Promise.resolve() // flush audioRef.current.play().then(() => audioActiveRef.current = true)
      })
      return document.querySelector('audio[data-uct-video-audio]')
    }

    it('visibilitychange to visible does one authoritative seekTo back to the audio clock', async () => {
      vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function () {
        Object.defineProperty(this, 'paused', { value: false, configurable: true })
        return Promise.resolve()
      })
      const audioEl = await renderWithAudioActive()
      audioEl.currentTime = 42
      setVisibility('visible')

      act(() => { document.dispatchEvent(new Event('visibilitychange')) })

      expect(lastPlayer.seekTo).toHaveBeenCalledWith(42, true)
    })

    it('also calls playVideo on resync when the audio clock is still playing', async () => {
      vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function () {
        Object.defineProperty(this, 'paused', { value: false, configurable: true })
        return Promise.resolve()
      })
      await renderWithAudioActive()
      const playVideoCallsBefore = lastPlayer.playVideo.mock.calls.length
      setVisibility('visible')

      act(() => { document.dispatchEvent(new Event('visibilitychange')) })

      expect(lastPlayer.playVideo.mock.calls.length).toBeGreaterThan(playVideoCallsBefore)
    })

    it('does not call playVideo on resync when the audio clock is paused', async () => {
      vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function () {
        Object.defineProperty(this, 'paused', { value: true, configurable: true })
        return Promise.resolve()
      })
      await renderWithAudioActive()
      const playVideoCallsBefore = lastPlayer.playVideo.mock.calls.length
      setVisibility('visible')

      act(() => { document.dispatchEvent(new Event('visibilitychange')) })

      expect(lastPlayer.seekTo).toHaveBeenCalled()
      expect(lastPlayer.playVideo.mock.calls.length).toBe(playVideoCallsBefore)
    })

    it('does not resync while hidden', async () => {
      vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function () {
        Object.defineProperty(this, 'paused', { value: false, configurable: true })
        return Promise.resolve()
      })
      const audioEl = await renderWithAudioActive()
      audioEl.currentTime = 42
      setVisibility('hidden')

      act(() => { document.dispatchEvent(new Event('visibilitychange')) })

      expect(lastPlayer.seekTo).not.toHaveBeenCalled()
    })

    it('with the flag off, no visibilitychange listener drives a resync', async () => {
      import.meta.env.VITE_DESK_BG_AUDIO_ENABLED = '0'
      window.matchMedia = (q) => ({ matches: q.includes('coarse'), addEventListener() {}, removeEventListener() {} })
      renderLayer()
      act(() => store.play(LIST, 0))
      setVisibility('visible')

      act(() => { document.dispatchEvent(new Event('visibilitychange')) })

      expect(lastPlayer.seekTo).not.toHaveBeenCalled()
    })

    it('periodic poll corrects drift beyond the 0.4s threshold while visible', async () => {
      vi.useFakeTimers()
      try {
        vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue()
        const audioEl = await renderWithAudioActive()
        setVisibility('visible')
        audioEl.currentTime = 21.0 // fakePlayer.getCurrentTime() stub returns 20 → 1.0s gap
        lastPlayer.seekTo.mockClear()

        act(() => { vi.advanceTimersByTime(300) })

        expect(lastPlayer.seekTo).toHaveBeenCalledWith(21.0, true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('periodic poll does NOT correct drift within the 0.4s tolerance', async () => {
      vi.useFakeTimers()
      try {
        vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue()
        const audioEl = await renderWithAudioActive()
        setVisibility('visible')
        audioEl.currentTime = 20.2 // fakePlayer.getCurrentTime() stub returns 20 → 0.2s gap
        lastPlayer.seekTo.mockClear()

        act(() => { vi.advanceTimersByTime(300) })

        expect(lastPlayer.seekTo).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('periodic poll does not correct drift while hidden', async () => {
      vi.useFakeTimers()
      try {
        vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue()
        const audioEl = await renderWithAudioActive()
        setVisibility('hidden')
        audioEl.currentTime = 21.0 // would be a correctable 1.0s gap if visible
        lastPlayer.seekTo.mockClear()

        act(() => { vi.advanceTimersByTime(300) })

        expect(lastPlayer.seekTo).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
