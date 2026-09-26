/**
 * Wave 7 lane H, fix round 1 — review I-4: a failed transcription in the
 * EDITOR keeps the member's recording and says why.
 *
 * ⚰️ THE DEFECT. On any non-OK `/api/voice/transcribe` (realistically the 429
 * of the monthly Whisper cap) the recorded audio was thrown away and a NEW Web
 * Speech session started with no sentence; where Web Speech does not exist
 * (Firefox) it was a pure no-op after the member spoke.
 *
 * THE CONTRACT (`holdOnFailure`, opt-in, the Notebook editor's mic): the
 * sentence RENDERS (asserted as text on the page, never as state), naming the
 * cause; the recording is KEPT (Try again re-sends the same audio); the
 * browser's own speech is a VISIBLE choice, never an automatic switch.
 * Callers without the prop keep today's behaviour (VoiceInputButton.test.jsx
 * "falls back to Web Speech when /api/voice/transcribe returns 500").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VoiceInputButton from './VoiceInputButton'

const AUDIO = 'FAKE_AUDIO_THE_MEMBER_SPOKE'

function installMediaRecorderMock({ micDenied = false } = {}) {
  class MockMediaRecorder {
    constructor(stream) { this.stream = stream; this.state = 'inactive' }
    start() { this.state = 'recording' }
    stop() {
      this.state = 'inactive'
      this.ondataavailable?.({ data: new Blob([AUDIO], { type: 'audio/webm' }) })
      this.onstop?.()
    }
  }
  global.MediaRecorder = MockMediaRecorder
  global.navigator.mediaDevices = {
    getUserMedia: micDenied
      ? vi.fn().mockRejectedValue(new Error('NotAllowedError'))
      : vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
  }
}

const srStarts = []
function installSpeechRecognitionMock() {
  class MockSR {
    start() { srStarts.push(this) }
    stop() { this.onend?.() }
  }
  global.SpeechRecognition = MockSR
}

const sentAudio = []
function answer(...responses) {
  let i = 0
  global.fetch = vi.fn(async (url, opts) => {
    const file = opts?.body?.get?.('audio')
    sentAudio.push(file ? await file.text() : null)
    const r = responses[Math.min(i, responses.length - 1)]
    i += 1
    if (r instanceof Error) throw r
    return r
  })
}
const refused = (status, detail) => ({ ok: false, status, json: async () => ({ detail }) })
const heard = (text) => ({ ok: true, status: 200, json: async () => ({ text }) })

async function speakAndStop(user) {
  await user.click(screen.getByRole('button', { name: 'Start voice input' }))
  await user.click(await screen.findByRole('button', { name: 'Stop voice input' }))
}

describe('holdOnFailure — the editor mic never drops the member\'s words silently', () => {
  let saved
  beforeEach(() => {
    saved = [global.SpeechRecognition, global.MediaRecorder, global.navigator.mediaDevices, global.fetch]
    srStarts.length = 0
    sentAudio.length = 0
    try { localStorage.setItem('voice.dictation.hintSeen', '1') } catch { /* ignore */ }
  })
  afterEach(() => {
    ;[global.SpeechRecognition, global.MediaRecorder, global.navigator.mediaDevices, global.fetch] = saved
    vi.restoreAllMocks()
  })

  it('the monthly cap (429) SAYS so, keeps the recording, and does not switch to browser speech', async () => {
    installMediaRecorderMock()
    installSpeechRecognitionMock()
    answer(refused(429, 'monthly dictation cap reached'))
    const user = userEvent.setup()
    render(<VoiceInputButton onTranscript={vi.fn()} holdOnFailure />)
    await speakAndStop(user)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/used this month's dictation/)
    expect(alert.textContent).toMatch(/Nothing was added — your recording is kept/)
    expect(srStarts).toHaveLength(0)                           // no automatic switch
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('Try again re-sends THE SAME recording, and the words land', async () => {
    installMediaRecorderMock()
    installSpeechRecognitionMock()
    answer(refused(503, 'OPENAI_API_KEY is not set'), heard('bought the dip'))
    const onTranscript = vi.fn()
    const user = userEvent.setup()
    render(<VoiceInputButton onTranscript={onTranscript} holdOnFailure />)
    await speakAndStop(user)
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't transcribe that/)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('bought the dip'))
    expect(sentAudio).toEqual([AUDIO, AUDIO])                  // the kept blob, not a new one
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    [refused(429, 'Rate limit exceeded: 60 per 1 minute'), /Too many dictations in a minute/],
    [refused(402, 'Voice requires a paid plan'), /isn't included in your plan/],
    [refused(400, 'voice features disabled in settings'), /Voice is turned off in your settings/],
    [new TypeError('Failed to fetch'), /Couldn't reach the server/],
  ])('names the cause: %#', async (response, sentence) => {
    installMediaRecorderMock()
    installSpeechRecognitionMock()
    answer(response)
    const user = userEvent.setup()
    render(<VoiceInputButton onTranscript={vi.fn()} holdOnFailure />)
    await speakAndStop(user)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(sentence)
    expect(alert.textContent).toMatch(/your recording is kept/)
  })

  it('browser speech is a VISIBLE choice the member makes', async () => {
    installMediaRecorderMock()
    installSpeechRecognitionMock()
    answer(refused(429, 'monthly dictation cap reached'))
    const user = userEvent.setup()
    render(<VoiceInputButton onTranscript={vi.fn()} holdOnFailure />)
    await speakAndStop(user)
    await screen.findByRole('alert')
    expect(srStarts).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Use browser speech' }))
    expect(srStarts).toHaveLength(1)
  })

  it('where there is NO browser speech (Firefox) the member still gets the sentence and Try again', async () => {
    installMediaRecorderMock()
    global.SpeechRecognition = undefined
    answer(refused(429, 'monthly dictation cap reached'))
    const user = userEvent.setup()
    render(<VoiceInputButton onTranscript={vi.fn()} holdOnFailure />)
    await speakAndStop(user)
    expect((await screen.findByRole('alert')).textContent).toMatch(/your recording is kept/)
    expect(screen.queryByRole('button', { name: 'Use browser speech' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('Discard recording is the member\'s explicit choice, and then it is gone', async () => {
    installMediaRecorderMock()
    installSpeechRecognitionMock()
    answer(refused(500, 'boom'))
    const user = userEvent.setup()
    render(<VoiceInputButton onTranscript={vi.fn()} holdOnFailure />)
    await speakAndStop(user)
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Discard recording' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('a blocked microphone says so instead of doing nothing', async () => {
    installMediaRecorderMock({ micDenied: true })
    global.SpeechRecognition = undefined
    const user = userEvent.setup()
    render(<VoiceInputButton onTranscript={vi.fn()} holdOnFailure />)
    await user.click(screen.getByRole('button', { name: 'Start voice input' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't use the microphone/)
  })
})
