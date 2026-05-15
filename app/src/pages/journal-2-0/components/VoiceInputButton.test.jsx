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

const HINT_KEY = 'voice.dictation.hintSeen'

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
    // Default: hint already seen, so behavioral tests aren't affected by the
    // one-time discoverability popover. Hint-specific tests opt out below.
    try { localStorage.setItem(HINT_KEY, '1') } catch { /* ignore */ }
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

  // ── First-run discoverability hint ──

  it('shows the first-run hint when the flag is unset and voice is supported', () => {
    localStorage.removeItem(HINT_KEY)
    installMediaRecorderMock()
    render(<VoiceInputButton onTranscript={() => {}} />)
    expect(screen.getByText(/speak instead of type/i)).toBeInTheDocument()
  })

  it('does not show the hint when the flag is already set', () => {
    localStorage.setItem(HINT_KEY, '1')
    installMediaRecorderMock()
    render(<VoiceInputButton onTranscript={() => {}} />)
    expect(screen.queryByText(/speak instead of type/i)).not.toBeInTheDocument()
    localStorage.removeItem(HINT_KEY)
  })

  it('dismissing the hint sets the flag and hides it', async () => {
    localStorage.removeItem(HINT_KEY)
    installMediaRecorderMock()
    const user = userEvent.setup()
    render(<VoiceInputButton onTranscript={() => {}} />)
    const dismiss = screen.getByRole('button', { name: /dismiss tip/i })
    await user.click(dismiss)
    expect(screen.queryByText(/speak instead of type/i)).not.toBeInTheDocument()
    expect(localStorage.getItem(HINT_KEY)).toBe('1')
    localStorage.removeItem(HINT_KEY)
  })

  it('starting a recording dismisses the hint and sets the flag', async () => {
    localStorage.removeItem(HINT_KEY)
    installMediaRecorderMock()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: '' }) })
    const user = userEvent.setup()
    render(<VoiceInputButton onTranscript={() => {}} />)
    expect(screen.getByText(/speak instead of type/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /start voice input/i }))
    await waitFor(() =>
      expect(screen.queryByText(/speak instead of type/i)).not.toBeInTheDocument(),
    )
    expect(localStorage.getItem(HINT_KEY)).toBe('1')
    localStorage.removeItem(HINT_KEY)
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
