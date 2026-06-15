import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VoiceProvider, useVoice } from '../../context/VoiceContext'
import AudioPlayerBar from './AudioPlayerBar'

function PlayHarness() {
  const voice = useVoice()
  return (
    <button
      onClick={() =>
        voice.playUrl({
          url: '/api/voice/tts/stream?token=x',
          trackId: 't1',
          trackLabel: 'Morning Wire',
        })
      }
    >
      go
    </button>
  )
}

// Harness exposing both a read-aloud start and the Realtime-session teardown,
// so we can reproduce a lingering voice session wiping an active read-aloud.
function OrphanHarness() {
  const voice = useVoice()
  return (
    <>
      <button
        onClick={() =>
          voice.playUrl({
            url: '/api/voice/tts/stream?token=x',
            trackId: 'catalysts-brief',
            trackLabel: 'Stock Catalysts brief',
          })
        }
      >
        read-aloud
      </button>
      <button onClick={() => voice.beginRealtime('global')}>rt-connect</button>
      <button onClick={() => voice.realtimeDisconnect()}>rt-disconnect</button>
    </>
  )
}

describe('AudioPlayerBar', () => {
  beforeEach(() => {
    // jsdom <audio> doesn't implement play/pause — stub them.
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue()
    HTMLMediaElement.prototype.pause = vi.fn()
  })

  it('renders only a hidden <audio> when idle', () => {
    const { container } = render(
      <VoiceProvider><AudioPlayerBar /></VoiceProvider>
    )
    expect(container.querySelector('audio')).toBeTruthy()
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('keeps the SAME <audio> node across idle→playing (no DOM swap)', async () => {
    // Regression: the element used to be rendered in two different tree
    // positions, so the idle→loading re-render removed it mid-play() and threw
    // "the play() request was interrupted because the media was removed from
    // the document". The node must be stable.
    const { container } = render(
      <VoiceProvider><AudioPlayerBar /><PlayHarness /></VoiceProvider>
    )
    const before = container.querySelector('audio')
    expect(before).toBeTruthy()

    fireEvent.click(screen.getByText('go'))
    await waitFor(() => expect(screen.queryByRole('region')).toBeTruthy())

    const after = container.querySelector('audio')
    expect(after).toBe(before) // exact same DOM node — not unmounted/recreated
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('shows seek bar, voice picker, and speed control while reading aloud', async () => {
    render(
      <VoiceProvider><AudioPlayerBar /><PlayHarness /></VoiceProvider>
    )
    fireEvent.click(screen.getByText('go'))
    await waitFor(() => expect(screen.queryByRole('region')).toBeTruthy())

    expect(screen.getByLabelText('Seek')).toBeTruthy()
    expect(screen.getByLabelText('Reader voice')).toBeTruthy()
    expect(screen.getByLabelText('Playback speed')).toBeTruthy()
    expect(screen.getByLabelText('Pause')).toBeTruthy() // playing → pause control
  })

  it('does NOT hide the player when a stale Realtime session tears down mid read-aloud', async () => {
    // Regression: read-aloud (mode 'a') + Realtime voice (mode 'c') share one
    // state machine and one <audio> element. A lingering Realtime session's
    // silence-timeout teardown dispatched c_disconnect, which reset the shared
    // state to idle — hiding the player bar while the read-aloud <audio> kept
    // playing. Result: bar gone, voice still talking, no way to stop it but to
    // close the tab. A Realtime teardown must leave an active read-aloud alone.
    render(
      <VoiceProvider><AudioPlayerBar /><OrphanHarness /></VoiceProvider>
    )
    fireEvent.click(screen.getByText('read-aloud'))
    await waitFor(() => expect(screen.queryByRole('region')).toBeTruthy())

    // A background Realtime session times out and disconnects.
    fireEvent.click(screen.getByText('rt-disconnect'))

    // The read-aloud player must still be on screen and controllable.
    expect(screen.queryByRole('region')).toBeTruthy()
    expect(screen.getByLabelText('Pause')).toBeTruthy()
  })

  it('still hides the player when an actual Realtime session disconnects', async () => {
    // Guard the fix: a real mode-'c' teardown should still return to idle.
    render(
      <VoiceProvider><AudioPlayerBar /><OrphanHarness /></VoiceProvider>
    )
    fireEvent.click(screen.getByText('rt-connect'))
    await waitFor(() => expect(screen.queryByRole('region')).toBeTruthy())

    fireEvent.click(screen.getByText('rt-disconnect'))
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
  })
})
