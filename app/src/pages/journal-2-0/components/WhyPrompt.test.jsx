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
    // The request the answer was recorded for, plus the version the typed words were based on
    // (fin-data I5: the save is a compare-and-set; 'x' is the `updatedAt` this card was given).
    expect(calls[0].body).toEqual({ ...SENT, baseUpdatedAt: 'x' })
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

// ── fin-data I5: the why note is compare-and-set; a stale save keeps the member's words ────
describe('a why changed somewhere else (409) never costs the member their typed words', () => {
  const KEY = { symbol: 'NVDA', entryDay: '2026-10-02' }
  const conflict = (current) => json({
    detail: {
      code: 'why_changed',
      message: 'This note was changed somewhere else since you opened it. Your words were not saved and are still here. Save again to replace the other version, or cancel to keep it.',
      current,
    },
  }, 409)

  function recordingFetch(responses) {
    const calls = []
    global.fetch = vi.fn(async (url, init) => {
      calls.push(JSON.parse(init.body))
      return responses[Math.min(calls.length - 1, responses.length - 1)]
    })
    return calls
  }

  it('every save sends the base it read: the stored updatedAt, or null when there was no why', async () => {
    const calls = recordingFetch([json({ context: { ...KEY, why: { text: 'a', updatedAt: 't1' } } })])
    const { unmount } = render(<WhyPrompt {...KEY} why={null} whyMaxChars={500} onSaved={() => {}} />)
    await userEvent.type(screen.getByLabelText('Why did you take it?'), 'a')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ ...KEY, text: 'a', baseUpdatedAt: null })
    expect('baseUpdatedAt' in calls[0]).toBe(true)
    unmount()

    const calls2 = recordingFetch([json({ context: { ...KEY, why: { text: 'b', updatedAt: 't2' } } })])
    render(<WhyPrompt {...KEY} why={{ text: 'old', updatedAt: 't1' }} whyMaxChars={500} onSaved={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls2).toHaveLength(1))
    expect(calls2[0].baseUpdatedAt).toBe('t1')
  })

  it('on a 409 it stays editing with the typed words, says so, and shows the other version', async () => {
    recordingFetch([conflict({ text: 'What the other tab saved', updatedAt: 't2' })])
    const onSaved = vi.fn()
    render(<WhyPrompt {...KEY} why={{ text: 'old', updatedAt: 't1' }} whyMaxChars={500} onSaved={onSaved} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const textarea = screen.getByLabelText('Why did you take it?')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'My careful reasoning')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/changed somewhere else/)
    expect(alert.textContent).toMatch(/still here/)
    expect(screen.getByTestId('why-prompt-editing')).toBeTruthy()
    expect(screen.getByLabelText('Why did you take it?').value).toBe('My careful reasoning')
    expect(screen.getByTestId('why-prompt-theirs').textContent).toMatch(/What the other tab saved/)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('Save again after a 409 replaces the other version on purpose, on the base the refusal named', async () => {
    const calls = recordingFetch([
      conflict({ text: 'theirs', updatedAt: 't2' }),
      json({ context: { ...KEY, why: { text: 'mine', updatedAt: 't3' } } }),
    ])
    const onSaved = vi.fn()
    render(<WhyPrompt {...KEY} why={{ text: 'old', updatedAt: 't1' }} whyMaxChars={500} onSaved={onSaved} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const textarea = screen.getByLabelText('Why did you take it?')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'mine')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(calls.map((c) => c.baseUpdatedAt)).toEqual(['t1', 't2'])
    expect(calls[1].text).toBe('mine')
    expect(screen.getByTestId('why-prompt-saved').textContent).toMatch(/mine/)
  })

  it('cancelling after a 409 keeps the other version and shows it, with no second write', async () => {
    const calls = recordingFetch([conflict({ text: 'theirs', updatedAt: 't2' })])
    const onSaved = vi.fn()
    render(<WhyPrompt {...KEY} why={{ text: 'old', updatedAt: 't1' }} whyMaxChars={500} onSaved={onSaved} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.type(screen.getByLabelText('Why did you take it?'), ' plus mine')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Keep the other version' }))
    expect(calls).toHaveLength(1)
    expect(screen.getByTestId('why-prompt-saved').textContent).toMatch(/theirs/)
    expect(onSaved).toHaveBeenCalledTimes(1) // the parent refetches the stored version
  })

  it('a 409 where the other side CLEARED the note says it is now empty and still keeps the words', async () => {
    recordingFetch([conflict(null)])
    render(<WhyPrompt {...KEY} why={{ text: 'old', updatedAt: 't1' }} whyMaxChars={500} onSaved={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.type(screen.getByLabelText('Why did you take it?'), ' more')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Why did you take it?').value).toBe('old more')
    expect(screen.getByTestId('why-prompt-theirs').textContent).toMatch(/empty/i)
  })

  it('the base is taken when editing starts: a refetch landing mid-edit never moves it', async () => {
    const calls = recordingFetch([conflict({ text: 'theirs', updatedAt: 't2' })])
    const { rerender } = render(
      <WhyPrompt {...KEY} why={{ text: 'old', updatedAt: 't1' }} whyMaxChars={500} onSaved={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.type(screen.getByLabelText('Why did you take it?'), ' mine')
    // The parent refetched: another tab's save arrives as a new prop while this one is typing.
    rerender(<WhyPrompt {...KEY} why={{ text: 'theirs', updatedAt: 't2' }} whyMaxChars={500} onSaved={() => {}} />)
    expect(screen.getByLabelText('Why did you take it?').value).toBe('old mine')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].baseUpdatedAt).toBe('t1') // still the version the typed words were based on
  })

  it('the other 409 (no context to attach to) is still a plain message, not a conflict', async () => {
    recordingFetch([json({ detail: 'No market context was captured for this entry, so there is nothing to attach the note to.' }, 409)])
    render(<WhyPrompt {...KEY} why={null} whyMaxChars={500} onSaved={() => {}} />)
    await userEvent.type(screen.getByLabelText('Why did you take it?'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/No market context/)
    expect(screen.queryByTestId('why-prompt-theirs')).toBeNull()
  })
})
