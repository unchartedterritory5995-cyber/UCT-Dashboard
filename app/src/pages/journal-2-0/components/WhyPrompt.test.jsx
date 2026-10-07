// Wave 13 lane 13E-2 — the "Why did you take it?" prompt.
// ⛔ The load-bearing guard: with the voice flag off, NO dictation control is in the tree and
// no microphone is ever requested — asserted both by DOM absence and by a getUserMedia spy.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WhyPrompt from './WhyPrompt'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { contract, contractBody, contractResponse } from '../__fixtures__/contract'

// CONTRACT: the save's answer and its refusals are the REAL server's (PUT /api/j2/entry-context/why,
// `__fixtures__/contract`, written by tools/notebook_contract_fixtures.py).
const SAVED = contract('entry-context.why.saved')
const SENT = SAVED._contract.requestBody            // { symbol, entryDay, text }
const HINT_KEY = 'voice.dictation.hintSeen'

// Same capability stub VoiceInputButton.test.jsx installs: both MediaRecorder AND
// navigator.mediaDevices.getUserMedia must exist for the button to render the real
// (supported) mic control rather than its disabled "not supported" fallback.
function installMediaRecorderMock() {
  class MockMediaRecorder {}
  MockMediaRecorder.isTypeSupported = () => true
  global.MediaRecorder = MockMediaRecorder
  global.navigator.mediaDevices = { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) }
}

let originalMR
let originalNav

beforeEach(() => {
  originalMR = global.MediaRecorder
  originalNav = global.navigator.mediaDevices
  try { localStorage.setItem(HINT_KEY, '1') } catch { /* ignore */ }
})
afterEach(() => {
  global.MediaRecorder = originalMR
  if (originalNav === undefined) delete global.navigator.mediaDevices
  else global.navigator.mediaDevices = originalNav
  __resetNotebookFlags()
  vi.restoreAllMocks()
})

describe('voice gating — the load-bearing guard', () => {
  it('renders no dictation control and never touches the microphone when the voice flag is off', () => {
    installMediaRecorderMock()
    latchNotebookFlags({ notebook_entry_context_enabled: true, notebook_voice_notes_enabled: false })
    render(<WhyPrompt symbol="NVDA" entryDay="2026-10-02" why={null} whyMaxChars={500} onSaved={() => {}} />)
    expect(screen.queryByTestId('why-prompt-voice')).toBeNull()
    expect(screen.queryByRole('button', { name: /voice input/i })).toBeNull()
    expect(global.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  })

  it('renders the dictation control when the voice flag is armed', () => {
    installMediaRecorderMock()
    latchNotebookFlags({ notebook_entry_context_enabled: true, notebook_voice_notes_enabled: true })
    render(<WhyPrompt symbol="NVDA" entryDay="2026-10-02" why={null} whyMaxChars={500} onSaved={() => {}} />)
    expect(screen.getByTestId('why-prompt-voice')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start voice input' })).toBeTruthy()
    // Mounting the control must not itself touch the microphone — only a click does.
    expect(global.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  })
})

describe('reading and saving the note', () => {
  it('renders the saved text with an Edit door when a why already exists', () => {
    render(<WhyPrompt symbol="NVDA" entryDay="2026-10-02"
      why={{ text: 'Tight flag at the 21EMA', updatedAt: '2026-10-02T00:00:00Z' }}
      whyMaxChars={500} onSaved={() => {}} />)
    expect(screen.getByTestId('why-prompt-saved')).toBeTruthy()
    expect(screen.getByText('Tight flag at the 21EMA')).toBeTruthy()
  })

  it('a FIRST save (why starts null) renders the just-typed text, never crashes, even before the parent refetches', async () => {
    // ⚰️ Measured on a real sandbox walk, not guessed: `editing` flips to false locally the
    // instant the PUT resolves, one render before the parent's `why` prop (via onSaved -> retry)
    // catches up -- so this render happens with `why` STILL null. The component used to read
    // `why.text` unconditionally there and crashed outright.
    global.fetch = vi.fn(async () => contractResponse('entry-context.why.saved'))
    const onSaved = vi.fn()
    render(<WhyPrompt symbol={SENT.symbol} entryDay={SENT.entryDay} why={null} whyMaxChars={500} onSaved={onSaved} />)
    await userEvent.type(screen.getByLabelText('Why did you take it?'), SENT.text)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(screen.getByTestId('why-prompt-saved')).toBeTruthy()
    expect(screen.getByText(SENT.text)).toBeTruthy()
    // what the server stored is what was typed
    expect(SAVED.body.context.why.text).toBe(SENT.text)
  })

  it('opens editing pre-filled, and Save PUTs the key and text then calls onSaved', async () => {
    const calls = []
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: JSON.parse(init.body) })
      return contractResponse('entry-context.why.saved')
    })
    const onSaved = vi.fn()
    render(<WhyPrompt symbol={SENT.symbol} entryDay={SENT.entryDay}
      why={{ text: 'Old reason', updatedAt: 'x' }} whyMaxChars={500} onSaved={onSaved} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const textarea = screen.getByLabelText('Why did you take it?')
    expect(textarea.value).toBe('Old reason')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, SENT.text)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(SAVED._contract.path)
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].body).toEqual(SENT)                // exactly the request the answer was recorded for
  })

  it.each([
    ['a note that is too long', 'entry-context.why.too-long'],
    ['an entry with no captured context to attach it to', 'entry-context.why.no-context'],
  ])('shows the server sentence on a failed save and stays editing: %s', async (_label, name) => {
    const sentence = contractBody(name).detail
    expect(sentence.length).toBeGreaterThan(20)
    global.fetch = vi.fn(async () => contractResponse(name))
    const onSaved = vi.fn()
    render(<WhyPrompt symbol="NVDA" entryDay="2026-10-02" why={null} whyMaxChars={500} onSaved={onSaved} />)
    await userEvent.type(screen.getByLabelText('Why did you take it?'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain(sentence)
    expect(screen.getByTestId('why-prompt-editing')).toBeTruthy()
    expect(screen.getByLabelText('Why did you take it?').value).toBe('x')     // what was typed is kept
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('the server limit the card is given is the one the server enforces', () => {
    expect(contractBody('entry-context.why.too-long').detail).toContain(String(contractBody('entry-context.meta').whyMaxChars))
  })

  it('the textarea is capped at the server-reported whyMaxChars, never a hardcoded guess', () => {
    render(<WhyPrompt symbol="NVDA" entryDay="2026-10-02" why={null} whyMaxChars={37} onSaved={() => {}} />)
    expect(screen.getByLabelText('Why did you take it?')).toHaveAttribute('maxLength', '37')
  })

  it('renders nothing without a symbol/entryDay key (nothing to attach the note to)', () => {
    const { container } = render(<WhyPrompt symbol={null} entryDay={null} why={null} onSaved={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})
