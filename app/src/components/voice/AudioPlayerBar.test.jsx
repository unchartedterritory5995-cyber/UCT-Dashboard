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
})
