import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VoiceInputButton from './VoiceInputButton'

describe('VoiceInputButton', () => {
  let originalSR
  beforeEach(() => {
    originalSR = global.SpeechRecognition
    // Mock SpeechRecognition so the test environment has the API
    global.SpeechRecognition = class MockSR {
      constructor() {
        this.continuous = false
        this.interimResults = false
        this.lang = ''
        this.onresult = null
        this.onerror = null
        this.onend = null
      }
      start() { this._started = true }
      stop() { this._started = false; if (this.onend) this.onend() }
    }
  })
  afterEach(() => {
    global.SpeechRecognition = originalSR
  })

  it('renders microphone button when API supported', () => {
    render(<VoiceInputButton onTranscript={() => {}} />)
    expect(screen.getByRole('button', { name: /voice/i })).toBeInTheDocument()
  })

  it('renders disabled state when API unsupported', () => {
    global.SpeechRecognition = undefined
    render(<VoiceInputButton onTranscript={() => {}} />)
    const btn = screen.getByRole('button', { name: /voice not supported/i })
    expect(btn).toBeDisabled()
  })

  it('clicking starts recording', async () => {
    const user = userEvent.setup()
    render(<VoiceInputButton onTranscript={() => {}} />)
    const btn = screen.getByRole('button', { name: /voice/i })
    await user.click(btn)
    // After click, the button label changes (we use a stop emoji or "Listening" indicator)
    expect(screen.getByText(/listening/i)).toBeInTheDocument()
  })
})
