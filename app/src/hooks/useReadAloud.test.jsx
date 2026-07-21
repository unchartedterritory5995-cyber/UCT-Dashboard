import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { VoiceProvider, useVoice } from '../context/VoiceContext'
import AudioPlayerBar from '../components/voice/AudioPlayerBar'
import useReadAloud from './useReadAloud'

/**
 * Regression suite for the "I closed it but it kept talking" bug.
 *
 * Read-aloud is a two-step flow: POST /api/voice/tts/prepare (which can take
 * seconds on a cold clip) and only THEN point the <audio> at /tts/stream.
 * The prepare window used to be both invisible (state stayed 'idle', so no
 * player bar and no Stop control existed) and uncancellable (the resolved
 * chain called playUrl() unconditionally). Pressing Stop mid-prepare did
 * nothing, and the voice started talking afterwards — from the saved
 * position, i.e. halfway through the brief.
 */

function Harness() {
  const { play } = useReadAloud()
  return (
    <button
      onClick={() =>
        play({
          trackId: 'morning-wire-2026-07-20',
          label: 'Morning Wire',
          textProvider: () => 'the brief',
        })
      }
    >
      read-aloud
    </button>
  )
}

// Lets a test resolve /tts/prepare at a moment of its choosing.
function deferredPrepare() {
  let release
  const gate = new Promise((r) => { release = r })
  const fetchMock = vi.fn(async (url) => {
    if (String(url).includes('/tts/prepare')) {
      await gate
      return { ok: true, status: 200, json: async () => ({ token: 'tok' }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  return { fetchMock, release: () => release() }
}

describe('useReadAloud — cancelling during prepare', () => {
  beforeEach(() => {
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue()
    HTMLMediaElement.prototype.pause = vi.fn()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('shows a player bar with a Stop control while preparing', async () => {
    const { fetchMock } = deferredPrepare()
    vi.stubGlobal('fetch', fetchMock)

    render(<VoiceProvider><AudioPlayerBar /><Harness /></VoiceProvider>)
    fireEvent.click(screen.getByText('read-aloud'))

    // The user must have something to cancel with while the clip synthesizes.
    await waitFor(() => expect(screen.queryByRole('region')).toBeTruthy())
    expect(screen.getByLabelText('Stop')).toBeTruthy()
  })

  it('does NOT start playing when Stop was pressed during prepare', async () => {
    const { fetchMock, release } = deferredPrepare()
    vi.stubGlobal('fetch', fetchMock)

    render(<VoiceProvider><AudioPlayerBar /><Harness /></VoiceProvider>)
    fireEvent.click(screen.getByText('read-aloud'))
    await waitFor(() => expect(screen.getByLabelText('Stop')).toBeTruthy())

    // User closes it out while it's still "preparing…".
    fireEvent.click(screen.getByLabelText('Stop'))
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull())

    // The in-flight prepare now lands. It must NOT resurrect playback.
    await act(async () => { release(); await Promise.resolve() })

    await waitFor(() => {
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
      expect(screen.queryByRole('region')).toBeNull()
    })
  })

  it('cancels the pending read when the button is clicked again mid-prepare', async () => {
    // The button shows "Pause read-aloud" during prepare, so a second click
    // must cancel — not queue a second synthesis of the same clip.
    const { fetchMock, release } = deferredPrepare()
    vi.stubGlobal('fetch', fetchMock)

    render(<VoiceProvider><AudioPlayerBar /><Harness /></VoiceProvider>)
    fireEvent.click(screen.getByText('read-aloud'))
    await waitFor(() => expect(screen.getByLabelText('Stop')).toBeTruthy())

    fireEvent.click(screen.getByText('read-aloud'))
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull())

    await act(async () => { release(); await Promise.resolve() })
    await waitFor(() => expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled())
  })

  it('a stray media error on a cleared element does not cancel a new read', async () => {
    // Regression: haltAudioEl used to do `el.src = ''`, which resolves against
    // the document URL — Chrome then tries to load the PAGE as media and fires
    // a bogus 'error'. AudioPlayerBar's reset handler treats an error as a real
    // failure and calls stop(); once stop() started cancelling pending reads,
    // that stray event silently killed the NEXT read-aloud mid-prepare
    // (press Stop, press Read aloud again → nothing ever plays).
    const { fetchMock, release } = deferredPrepare()
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<VoiceProvider><AudioPlayerBar /><Harness /></VoiceProvider>)
    fireEvent.click(screen.getByText('read-aloud'))
    await waitFor(() => expect(screen.getByLabelText('Stop')).toBeTruthy())

    // Late teardown error from the PREVIOUS clip's cleared element.
    const el = container.querySelector('audio')
    expect(el.getAttribute('src')).toBeNull()
    await act(async () => { fireEvent(el, new Event('error')) })

    // The in-flight read must survive it and play.
    await act(async () => { release(); await Promise.resolve() })
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())
  })

  it('still plays normally when the user does not cancel', async () => {
    const { fetchMock, release } = deferredPrepare()
    vi.stubGlobal('fetch', fetchMock)

    render(<VoiceProvider><AudioPlayerBar /><Harness /></VoiceProvider>)
    fireEvent.click(screen.getByText('read-aloud'))
    await act(async () => { release(); await Promise.resolve() })

    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())
  })
})

describe('switching tracks while one is still playing', () => {
  beforeEach(() => {
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue()
    HTMLMediaElement.prototype.pause = vi.fn()
    localStorage.clear()
  })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  // Harness: track A plays directly; track B goes through the read-aloud flow.
  function TwoTracks() {
    const voice = useVoice()
    const { play } = useReadAloud()
    return (
      <>
        <button onClick={() => voice.playUrl({ url: '/api/voice/tts/stream?token=A', trackId: 'trackA', trackLabel: 'A' })}>play-A</button>
        <button onClick={() => play({ trackId: 'trackB', label: 'B', textProvider: () => 'b' })}>read-B</button>
      </>
    )
  }

  it("an old clip ending mid-prepare does not cancel the new read", async () => {
    // Regression: reset() fired voice.stop() for the OUTGOING clip, bumping the
    // cancel generation and silently killing the read that was still preparing
    // — bar vanished, nothing played, button looked broken.
    const { fetchMock, release } = deferredPrepare()
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<VoiceProvider><AudioPlayerBar /><TwoTracks /></VoiceProvider>)
    fireEvent.click(screen.getByText('play-A'))
    await waitFor(() => expect(screen.queryByRole('region')).toBeTruthy())

    const el = container.querySelector('audio')
    fireEvent.click(screen.getByText('read-B'))
    // Wait until B has actually entered prepare (bar relabelled) — otherwise
    // the 'ended' below lands before beginLoad and proves nothing.
    await waitFor(() => expect(screen.getByText(/preparing/i)).toBeTruthy())

    await act(async () => { fireEvent(el, new Event('ended')) }) // A finishes

    await act(async () => { release(); await Promise.resolve() })
    // B must still play: 1 call for A, 1 for B.
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2))
  })

  it("an old clip's position is never saved under the new track's key", async () => {
    // Regression: the outgoing clip kept emitting timeupdate/pause while the
    // store already pointed at the incoming trackId, so its position was
    // stamped onto the new track — which then resumed from a spot it had
    // never reached (the "starts halfway through" symptom, second route).
    const { fetchMock } = deferredPrepare()
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<VoiceProvider><AudioPlayerBar /><TwoTracks /></VoiceProvider>)
    fireEvent.click(screen.getByText('play-A'))
    await waitFor(() => expect(screen.queryByRole('region')).toBeTruthy())

    const el = container.querySelector('audio')
    Object.defineProperty(el, 'currentTime', { value: 240, configurable: true, writable: true })

    fireEvent.click(screen.getByText('read-B'))
    await waitFor(() => expect(screen.getByText(/preparing/i)).toBeTruthy())

    await act(async () => {
      fireEvent(el, new Event('timeupdate'))             // stray events from A
      fireEvent(el, new Event('pause'))
    })

    expect(localStorage.getItem('readaloud.pos.trackB')).toBeNull()
  })
})

describe('VoiceContext — stop() is authoritative', () => {
  beforeEach(() => {
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue()
    HTMLMediaElement.prototype.pause = vi.fn()
  })

  it("clears the element by REMOVING src, never by assigning '' ", async () => {
    // `el.src = ''` resolves against the document URL, so the browser tries to
    // load the page itself as media and fires a bogus 'error'. That error used
    // to reach reset() -> stop() and cancel the next read. This assertion is
    // what pins removeAttribute('src') + load(); without it the whole clearing
    // half of the fix could be reverted with the suite still green.
    function Ctl() {
      const voice = useVoice()
      return (
        <>
          <button onClick={() => voice.playUrl({ url: '/api/voice/tts/stream?token=A', trackId: 't', trackLabel: 'T' })}>go</button>
          <button onClick={() => voice.stop()}>stop</button>
        </>
      )
    }
    const { container } = render(<VoiceProvider><AudioPlayerBar /><Ctl /></VoiceProvider>)
    fireEvent.click(screen.getByText('go'))
    await waitFor(() => expect(screen.queryByRole('region')).toBeTruthy())

    const el = container.querySelector('audio')
    expect(el.getAttribute('src')).toBe('/api/voice/tts/stream?token=A')

    fireEvent.click(screen.getByText('stop'))
    // The attribute must be GONE, not set to the empty string.
    expect(el.getAttribute('src')).toBeNull()
    expect(el.hasAttribute('src')).toBe(false)
  })

  it('halts a voice <audio> even when the ref was detached', async () => {
    // Defense in depth: haltAudioEl() used to silently no-op when the ref was
    // null, while the state still went idle and hid the bar — stranding audio
    // with no way to stop it. Stopping must not depend on the ref alone.
    function Detacher() {
      const voice = useVoice()
      return (
        <>
          <button onClick={() => voice.playUrl({ url: '/s', trackId: 't', trackLabel: 'T' })}>go</button>
          <button onClick={() => voice.attachAudio(null)}>detach</button>
          <button onClick={() => voice.stop()}>stop</button>
        </>
      )
    }
    const { container } = render(<VoiceProvider><AudioPlayerBar /><Detacher /></VoiceProvider>)
    fireEvent.click(screen.getByText('go'))
    await waitFor(() => expect(screen.queryByRole('region')).toBeTruthy())

    const el = container.querySelector('audio')
    Object.defineProperty(el, 'paused', { value: false, configurable: true })

    fireEvent.click(screen.getByText('detach'))
    fireEvent.click(screen.getByText('stop'))

    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
  })
})
