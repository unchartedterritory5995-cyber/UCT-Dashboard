/**
 * Wave 11 lane 11A — the voice-note dialog, driven through every state a member
 * can see: idle, recording, paused, uploading, transcribing (with progress),
 * summarizing, done (the preview), error with Retry — by mouse AND keyboard.
 *
 * ⛔ Asserted by RENDERED TEXT (the house rule): a state that only changed in a
 * hook but never reached the screen fails here. Only the network and the
 * browser's microphone are faked; the dialog, the recorder hook and the
 * transcription loop are the real modules.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VoiceNoteDialog from './VoiceNoteDialog'

const RESULT = {
  source: 'recording', title: 'Voice note', name: '', date: '2026-10-01', durationSeconds: 65,
  transcript: 'I am watching NVDA for a breakout. Set a stop on AMD below the 50-day.', transcriptShortened: false, words: 15,
  summary: 'Watching NVDA for a breakout; a stop on AMD below the 50-day.',
  tickers: ['NVDA', 'AMD'], actionItems: ['Set a stop on AMD below the 50-day'],
  ai: { ok: true, model: 'claude-sonnet-5', sentence: '' },
}

// ── the microphone ───────────────────────────────────────────────────────────
class FakeRecorder {
  static isTypeSupported(t) { return t.startsWith('audio/webm') }

  constructor(stream, opts) {
    this.state = 'inactive'
    this.mimeType = opts?.mimeType || 'audio/webm'
    FakeRecorder.last = this
  }

  start() { this.state = 'recording' }

  pause() { this.state = 'paused' }

  resume() { this.state = 'recording' }

  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['audio-bytes'], { type: this.mimeType }) })
    this.onstop?.()
  }
}

// ── the network: each transcribe call waits for the test to release it ──────
let calls
let gates
let transcribeAnswers
function resp(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body } }
function installFetch({ summary = RESULT } = {}) {
  calls = []
  gates = []
  vi.stubGlobal('fetch', vi.fn((url, init) => {
    const u = String(url).replace('/api/j2/voice-notes', '')
    calls.push(`${init?.method || 'GET'} ${u}`)
    if (u === '/status') return Promise.resolve(resp(200, { cap: { usedSeconds: 600, capSeconds: 3600, remainingSeconds: 3000, unlimited: false } }))
    if (u === '/jobs') return Promise.resolve(resp(200, { jobId: 'j1', parts: 2, done: 0, finished: false }))
    if (u.endsWith('/transcribe')) {
      const answer = transcribeAnswers.shift()
      return new Promise((resolve) => gates.push(() => resolve(answer)))
    }
    if (u.endsWith('/summarize')) return Promise.resolve(resp(200, summary))
    if (init?.method === 'DELETE') return Promise.resolve(resp(200, { ok: true }))
    return Promise.resolve(resp(404, { detail: 'Not Found' }))
  }))
}
const release = async () => {
  await waitFor(() => expect(gates.length).toBeGreaterThan(0))
  await act(async () => { gates.shift()() })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
  })
  transcribeAnswers = [
    resp(200, { jobId: 'j1', parts: 2, done: 1, finished: false }),
    resp(200, { jobId: 'j1', parts: 2, done: 2, finished: true }),
  ]
  installFetch()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const timer = () => screen.getByRole('timer', { name: 'Recorded time' })
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms) })

describe('the recorder states, as the member sees them', () => {
  it('idle → recording → paused → recording → uploading → transcribing (progress) → summarizing → done', async () => {
    const onSave = vi.fn(async () => ({ id: 'nv1', title: 'x' }))
    const onClose = vi.fn()
    render(<VoiceNoteDialog initialSource="record" onSave={onSave} onClose={onClose} />)

    // idle
    expect(screen.getByRole('dialog', { name: 'Voice note' })).toBeInTheDocument()
    expect(timer()).toHaveTextContent('0:00 / 1:00:00')
    expect(await screen.findByTestId('voice-cap')).toHaveTextContent('50 of 60 minutes of transcription left this month.')

    // recording
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
    expect(await screen.findByText('Recording')).toBeInTheDocument()
    tick(5000)
    expect(timer()).toHaveTextContent('0:05')

    // paused: the clock stops
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(screen.getByText('Paused')).toBeInTheDocument()
    tick(3000)
    expect(timer()).toHaveTextContent('0:05')

    // recording again
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    tick(2000)
    expect(timer()).toHaveTextContent('0:07')

    // stop → uploading → transcribing
    fireEvent.click(screen.getByRole('button', { name: 'Stop and transcribe' }))
    expect(await screen.findByText(/Transcribing part 1 of 2/)).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: 'Transcribed 0 of 2 parts' })
    expect(bar).toHaveAttribute('max', '2')
    await release()
    expect(await screen.findByText(/Transcribing part 2 of 2/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Transcribed 1 of 2 parts' })).toBeInTheDocument()
    await release()

    // done: the preview, with every section and the AI label
    const preview = await screen.findByRole('region', { name: 'Voice note preview' })
    expect(within(preview).getByRole('heading', { name: 'Summary' })).toBeInTheDocument()
    expect(within(preview).getByText(/AI-written · Compass · Voice note summary · claude-sonnet-5/)).toBeInTheDocument()
    expect(within(preview).getByText(RESULT.summary)).toBeInTheDocument()
    expect(within(preview).getByRole('heading', { name: 'Tickers' })).toBeInTheDocument()
    expect(within(preview).getByText('$NVDA')).toBeInTheDocument()
    expect(within(preview).getByRole('heading', { name: 'Action items' })).toBeInTheDocument()
    expect(within(preview).getByText('Set a stop on AMD below the 50-day')).toBeInTheDocument()
    expect(within(preview).getByRole('heading', { name: 'Transcript' })).toBeInTheDocument()
    expect(within(preview).getByText('Full transcript · 15 words')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Voice note — Oct 1, 2026')
    expect(calls.filter((c) => c === 'POST /jobs')).toHaveLength(1)
    const form = fetch.mock.calls.find(([u]) => String(u).endsWith('/jobs'))[1].body
    expect(form.get('source')).toBe('recording')
    expect(form.get('audio').name).toBe('recording.webm')

    // nothing was written yet; Save is the one write
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Morning plan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new note' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ title: 'Morning plan', result: RESULT }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls).toContain('DELETE /jobs/j1')
  })

  it('error with Retry: a failed part keeps the recording, and Retry continues from it', async () => {
    transcribeAnswers = [
      resp(200, { jobId: 'j1', parts: 2, done: 1, finished: false }),
      resp(502, { detail: 'Transcription failed for part 2 of 2. Your recording is kept — choose Retry to continue from where it stopped.' }),
      resp(200, { jobId: 'j1', parts: 2, done: 2, finished: true }),
    ]
    render(<VoiceNoteDialog initialSource="record" onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
    await screen.findByText('Recording')
    tick(4000)
    fireEvent.click(screen.getByRole('button', { name: 'Stop and transcribe' }))
    await release()
    await release()
    expect(await screen.findByRole('alert')).toHaveTextContent('Transcription failed for part 2 of 2. Your recording is kept')
    expect(screen.getByText('Your recording is kept. Retry continues from where it stopped.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await release()
    expect(await screen.findByRole('region', { name: 'Voice note preview' })).toBeInTheDocument()
    expect(calls.filter((c) => c === 'POST /jobs')).toHaveLength(1)           // never uploaded twice
    expect(calls.filter((c) => c.endsWith('/transcribe'))).toHaveLength(3)
  })

  it('a microphone the browser refuses is said, and the upload door is offered instead', async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(new Error('NotAllowedError'))
    render(<VoiceNoteDialog initialSource="record" onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The microphone is blocked. Allow it for this site, or upload a recording instead.')
    expect(screen.getByRole('button', { name: /Upload a file/ })).toBeInTheDocument()
  })
})

describe('the other two sources', () => {
  it('an uploaded file goes through the same transcription, marked as an upload', async () => {
    render(<VoiceNoteDialog initialSource="upload" onClose={vi.fn()} />)
    const input = screen.getByLabelText('Choose an audio file')
    fireEvent.change(input, { target: { files: [new File(['m4a'], 'call.m4a', { type: 'audio/mp4' })] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Transcribe' }))
    await release()
    await release()
    expect(await screen.findByRole('region', { name: 'Voice note preview' })).toBeInTheDocument()
    const form = fetch.mock.calls.find(([u]) => String(u).endsWith('/jobs'))[1].body
    expect(form.get('source')).toBe('upload')
    expect(form.get('audio').name).toBe('call.m4a')
  })

  it('a file over 90 MB is refused before anything is sent', async () => {
    render(<VoiceNoteDialog initialSource="upload" onClose={vi.fn()} />)
    const big = new File(['x'], 'huge.wav', { type: 'audio/wav' })
    Object.defineProperty(big, 'size', { value: 95 * 1024 * 1024 })
    fireEvent.change(screen.getByLabelText('Choose an audio file'), { target: { files: [big] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('That file is larger than 90 MB')
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([])
  })

  it('a named Desk session is summarised straight away, with no transcription', async () => {
    installFetch({ summary: { ...RESULT, source: 'desk', title: 'Live Trading — Oct 1, 2026', desk: { id: 7, title: 'Live Trading — Oct 1, 2026' } } })
    render(<VoiceNoteDialog deskVideo={{ id: 7, title: 'Live Trading — Oct 1, 2026' }} onClose={vi.fn()} />)
    expect(await screen.findByRole('region', { name: 'Voice note preview' })).toBeInTheDocument()
    expect(calls).toContain('POST /desk-sessions/7/summarize')
    expect(calls.some((c) => c.endsWith('/transcribe') || c === 'POST /jobs')).toBe(false)
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Live Trading — Oct 1, 2026')
  })

  it('a summary that could not be written still offers the transcript, and says so', async () => {
    installFetch({ summary: { ...RESULT, summary: '', tickers: [], actionItems: [], ai: { ok: false, model: 'm', sentence: 'The summary couldn’t be written this time. You can save the transcript, or try again.' } } })
    render(<VoiceNoteDialog deskVideo={{ id: 7, title: 'S' }} onClose={vi.fn()} />)
    const preview = await screen.findByRole('region', { name: 'Voice note preview' })
    expect(within(preview).getByRole('note')).toHaveTextContent('The note will hold the transcript.')
    expect(within(preview).queryByRole('heading', { name: 'Summary' })).toBeNull()
    expect(within(preview).getByRole('heading', { name: 'Transcript' })).toBeInTheDocument()
  })
})

describe('the open note: Add to this note', () => {
  it('a refused append (a locked note) shows the sentence and keeps the result to save instead', async () => {
    installFetch()
    const onAppend = vi.fn(() => ({ ok: false, reason: 'This note is locked — unlock it in the Notebook first' }))
    const onClose = vi.fn()
    render(<VoiceNoteDialog deskVideo={{ id: 7, title: 'S' }} onAppend={onAppend} onClose={onClose} />)
    await screen.findByRole('region', { name: 'Voice note preview' })
    fireEvent.click(screen.getByRole('button', { name: 'Add to this note' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This note is locked — unlock it in the Notebook first')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save as a new note' })).toBeInTheDocument()
  })
})

describe('keyboard', () => {
  it('every step is reachable and operable from the keyboard, and Escape never drops a recording', async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    const onClose = vi.fn()
    render(<VoiceNoteDialog initialSource="upload" onClose={onClose} />)
    // the source switcher is a group of real buttons
    const record = screen.getByRole('button', { name: /Record/ })
    record.focus()
    await user.keyboard('{Enter}')
    expect(record).toHaveAttribute('aria-pressed', 'true')
    const start = screen.getByRole('button', { name: 'Start recording' })
    start.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Recording')).toBeInTheDocument()
    screen.getByRole('button', { name: 'Pause' }).focus()
    await user.keyboard(' ')
    expect(screen.getByText('Paused')).toBeInTheDocument()
    // Escape with a recording in hand asks first — nothing is discarded
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    const keep = screen.getByRole('button', { name: 'Keep it' })
    expect(keep).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByText('Paused')).toBeInTheDocument()
    screen.getByRole('button', { name: 'Stop and transcribe' }).focus()
    await user.keyboard('{Enter}')
    await release()
    await release()
    await screen.findByRole('region', { name: 'Voice note preview' })
    const title = screen.getByRole('textbox', { name: 'Title' })
    title.focus()
    await user.keyboard('{Tab}')
    expect(document.activeElement.tagName).not.toBe('BODY')
  })
})
