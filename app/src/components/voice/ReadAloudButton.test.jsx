import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VoiceProvider } from '../../context/VoiceContext'
import ReadAloudButton from './ReadAloudButton'

function wrap(node) {
  return render(<VoiceProvider>{node}</VoiceProvider>)
}

describe('ReadAloudButton', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['audio'], { type: 'audio/mpeg' })),
    })
    global.URL.createObjectURL = vi.fn(() => 'blob:fake')
    // jsdom <audio> doesn't implement play/pause — stub them.
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue()
    HTMLMediaElement.prototype.pause = vi.fn()
  })

  it('renders the read-aloud icon by default', () => {
    wrap(<ReadAloudButton trackId="t1" label="Test" textProvider={() => 'hi'} />)
    expect(screen.getByRole('button')).toBeTruthy()
  })

  it('fires a TTS fetch on click', async () => {
    wrap(<ReadAloudButton trackId="t1" label="Test" textProvider={() => 'hello'} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/voice/tts',
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  it('does not fetch when textProvider returns empty', async () => {
    wrap(<ReadAloudButton trackId="t1" label="Test" textProvider={() => ''} />)
    fireEvent.click(screen.getByRole('button'))
    // microtask flush
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
  })
})
