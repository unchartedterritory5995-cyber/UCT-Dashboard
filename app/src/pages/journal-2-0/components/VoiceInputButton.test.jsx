import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VoiceInputButton from './VoiceInputButton'

// ── Shared mock helpers ─────────────────────────────────────────────────────

function installMediaRecorderMock() {
  const instances = []
  class MockMediaRecorder {
    constructor(stream) {
      this.stream = stream
      this.state = 'inactive'
      this.ondataavailable = null
      this.onstop = null
      this.onerror = null
      instances.push(this)
    }
    start() { this.state = 'recording' }
    stop() {
      this.state = 'inactive'
      if (this.ondataavailable) {
        this.ondataavailable({ data: new Blob(['FAKE_AUDIO'], { type: 'audio/webm' }) })
      }
      if (this.onstop) this.onstop()
    }
  }
  MockMediaRecorder.isTypeSupported = () => true
  global.MediaRecorder = MockMediaRecorder
  global.navigator.mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    }),
  }
  return instances
}

function installSpeechRecognitionMock() {
  class MockSR {
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
  global.SpeechRecognition = MockSR
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('VoiceInputButton', () => {
  let originalSR
  let originalMR
  let originalNav
  let originalFetch

  beforeEach(() => {
    originalSR = global.SpeechRecognition
    originalMR = global.MediaRecorder
    originalNav = global.navigator.mediaDevices
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.SpeechRecognition = originalSR
    global.MediaRecorder = originalMR
    if (originalNav === undefined) {
      delete global.navigator.mediaDevices
    } else {
      global.navigator.mediaDevices = originalNav
    }
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  // ── Rendering / capability detection ──

  it('renders microphone button when SpeechRecognition supported (no MediaRecorder)', () => {
    installSpeechRecognitionMock()
    render(<VoiceInputButton onTranscript={() => {}} />)
    expect(screen.getByRole('button', { name: /voice/i })).toBeInTheDocument()
  })

  it('renders microphone button when MediaRecorder supported (no SpeechRecognition)', () => {
    installMediaRecorderMock()
    render(<VoiceInputButton onTranscript={() => {}} />)
    expect(screen.getByRole('button', { name: /voice/i })).toBeInTheDocument()
  })

  it('renders disabled state when neither API supported', () => {
    global.SpeechRecognition = undefined
    global.MediaRecorder = undefined
    render(<VoiceInputButton onTranscript={() => {}} />)
    const btn = screen.getByRole('button', { name: /voice not supported/i })
    expect(btn).toBeDisabled()
  })

  it('clicking starts recording (Web Speech path)', async () => {
    installSpeechRecognitionMock()
    global.MediaRecorder = undefined
    const user = userEvent.setup()
    render(<VoiceInputButton onTranscript={() => {}} />)
    const btn = screen.getByRole('button', { name: /voice/i })
    await user.click(btn)
    expect(screen.getByText(/listening/i)).toBeInTheDocument()
  })

  // ── Whisper path (primary) ──

  it('clicking starts MediaRecorder when available (Whisper path)', async () => {
    installMediaRecorderMock()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: '' }),
    })
    const user = userEvent.setup()
    render(<VoiceInputButton onTranscript={() => {}} />)
    const btn = screen.getByRole('button', { name: /voice/i })
    await user.click(btn)
    expect(global.navigator.mediaDevices.getUserMedia).toHaveBeenCalled()
  })

  it('stops recording and POSTs audio to /api/voice/transcribe, calls onTranscript with text', async () => {
    const recorders = installMediaRecorderMock()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'add NVDA long at 142', seconds_billed: 3 }),
    })
    const onTranscript = vi.fn()
    const user = userEvent.setup()
    render(<VoiceInputButton onTranscript={onTranscript} />)
    const btn = screen.getByRole('button', { name: /voice/i })
    await user.click(btn) // start
    // Wait for MediaRecorder to be instantiated by the async getUserMedia
    await waitFor(() => expect(recorders.length).toBeGreaterThan(0))
    await user.click(btn) // stop → fires dataavailable + onstop → POST
    await waitFor(() =>
      expect(onTranscript).toHaveBeenCalledWith('add NVDA long at 142'),
    )
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/voice/transcribe',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('sends cleanup=true in the form data by default', async () => {
    const recorders = installMediaRecorderMock()
    let sentForm = null
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      sentForm = opts.body
      return Promise.resolve({ ok: true, json: async () => ({ text: 'hi' }) })
    })
    const user = userEvent.setup()
    render(<VoiceInputButton onTranscript={vi.fn()} />)
    const btn = screen.getByRole('button', { name: /voice/i })
    await user.click(btn)
    await waitFor(() => expect(recorders.length).toBeGreaterThan(0))
    await user.click(btn)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(sentForm.get('cleanup')).toBe('true')
  })

  it('omits cleanup when cleanup prop is false', async () => {
    const recorders = installMediaRecorderMock()
    let sentForm = null
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      sentForm = opts.body
      return Promise.resolve({ ok: true, json: async () => ({ text: 'hi' }) })
    })
    const user = userEvent.setup()
    render(<VoiceInputButton onTranscript={vi.fn()} cleanup={false} />)
    const btn = screen.getByRole('button', { name: /voice/i })
    await user.click(btn)
    await waitFor(() => expect(recorders.length).toBeGreaterThan(0))
    await user.click(btn)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(sentForm.get('cleanup')).toBe('false')
  })

  it('falls back to Web Speech when /api/voice/transcribe returns 500', async () => {
    const recorders = installMediaRecorderMock()
    installSpeechRecognitionMock()
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const onTranscript = vi.fn()
    const user = userEvent.setup()
    render(<VoiceInputButton onTranscript={onTranscript} />)
    const btn = screen.getByRole('button', { name: /voice/i })
    await user.click(btn)
    await waitFor(() => expect(recorders.length).toBeGreaterThan(0))
    await user.click(btn)
    // After fetch fails, the button should still be functional. We assert no
    // crash + onTranscript not called with stale/garbage text from failed path.
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(onTranscript).not.toHaveBeenCalledWith(expect.stringContaining('FAKE_AUDIO'))
  })
})
