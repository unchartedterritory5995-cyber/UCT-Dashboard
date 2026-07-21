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

describe('VoiceContext — stop() is authoritative', () => {
  beforeEach(() => {
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue()
    HTMLMediaElement.prototype.pause = vi.fn()
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
