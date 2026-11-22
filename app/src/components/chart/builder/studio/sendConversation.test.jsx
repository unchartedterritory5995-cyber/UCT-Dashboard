// L8 (Studio plan, section 7): "Send this conversation to UCT" from the Create Indicator dock.
// Off unless the support loop's report door is on; nothing is sent until the member ticks the
// box; what is sent is what the dialog listed; the member can withdraw it at once.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { scriptedConverse } from '../../../../testing/createIndicator/scriptedConverse'
import { conversationReport, hasSomethingToSend, REPORT_TURNS_MAX } from './sendConversation'
import SendConversationDialog from './SendConversationDialog'

const H = vi.hoisted(() => ({ enabled: true }))
vi.mock('../../supportLoop/supportApi', async (orig) => ({
  ...(await orig()),
  reportsConfig: vi.fn(async () => ({ reportsEnabled: H.enabled, maxSourceBytes: 131072, maxNoteChars: 1000 })),
}))
vi.mock('../authoring/studioTelemetry', async (orig) => ({ ...(await orig()), logStudioAction: vi.fn() }))

import CreateIndicatorPanel from './CreateIndicatorPanel'

afterEach(() => { cleanup(); registry.clearUserDefinitions(); H.enabled = true })

const TRANSCRIPT = [
  { id: 0, role: 'member', text: 'Add a 20 EMA' },
  { id: 1, role: 'uct', kind: 'change', lines: ['EMA 20 — a number on every bar'] },
  { id: 2, role: 'uct', kind: 'question', lines: [], questions: [{ text: 'Which line?' }] },
  { id: 3, role: 'uct', kind: 'undo', lines: [] },
]

describe('what is sent (pure)', () => {
  it('the transcript as the member saw it, the indicator, its read-back and the chart', () => {
    const doc = JSON.parse(conversationReport({ transcript: TRANSCRIPT, working: { id: 'w' }, readbackLines: ['EMA 20'], sym: 'SPY', tf: 'D' }))
    expect(Object.keys(doc).sort()).toEqual(['chart', 'definition', 'readback', 'transcript'])
    expect(doc.transcript).toEqual([
      { role: 'member', text: 'Add a 20 EMA' },
      { role: 'uct', kind: 'change', lines: ['EMA 20 — a number on every bar'] },
      { role: 'uct', kind: 'question', lines: ['Which line?'] },
    ])                                                   // an empty entry is left out
    expect(doc.definition).toEqual({ id: 'w' })
    expect(doc.chart).toEqual({ sym: 'SPY', tf: 'D' })
  })

  it('only the most recent entries, and only when the member said something', () => {
    const many = Array.from({ length: REPORT_TURNS_MAX + 10 }, (_, i) => ({ role: 'member', text: `t${i}` }))
    expect(JSON.parse(conversationReport({ transcript: many })).transcript).toHaveLength(REPORT_TURNS_MAX)
    expect(hasSomethingToSend(TRANSCRIPT)).toBe(true)
    expect(hasSomethingToSend([{ role: 'uct', lines: ['hi'] }, { role: 'member', text: '  ' }])).toBe(false)
    expect(hasSomethingToSend(null)).toBe(false)
  })
})

describe('the dialog', () => {
  const mount = (over = {}) => {
    const submit = vi.fn(async () => ({ ok: true, report: { id: 'a'.repeat(32), duplicate: false } }))
    const withdraw = vi.fn(async () => true)
    render(<SendConversationDialog open onClose={() => {}} transcript={TRANSCRIPT} working={null}
      readbackLines={[]} sym="SPY" tf="D" submit={submit} withdraw={withdraw} {...over} />)
    return { submit, withdraw }
  }

  it('lists what it will send and sends nothing until the box is ticked', async () => {
    const { submit } = mount()
    expect(screen.getByTestId('send-conversation-preview').textContent).toContain('You: Add a 20 EMA')
    expect(screen.getByTestId('send-conversation-privacy').textContent).toMatch(/withdraw it, which deletes it/)
    const send = screen.getByTestId('send-conversation-send')
    expect(send).toBeDisabled()
    fireEvent.click(send)
    expect(submit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('send-conversation-consent'))
    fireEvent.change(screen.getByTestId('send-conversation-note'), { target: { value: ' it refused ' } })
    await act(async () => { fireEvent.click(screen.getByTestId('send-conversation-send')) })
    expect(submit).toHaveBeenCalledTimes(1)
    const body = submit.mock.calls[0][0]
    expect(body).toMatchObject({ consent: true, kind: 'converse', note: 'it refused', symbol: 'SPY', timeframe: 'D' })
    expect(JSON.parse(body.source).transcript[0]).toEqual({ role: 'member', text: 'Add a 20 EMA' })
    expect(screen.getByTestId('send-conversation-done')).toBeInTheDocument()
  })

  it('the member can withdraw it straight away', async () => {
    const { withdraw } = mount()
    fireEvent.click(screen.getByTestId('send-conversation-consent'))
    await act(async () => { fireEvent.click(screen.getByTestId('send-conversation-send')) })
    await act(async () => { fireEvent.click(screen.getByTestId('send-conversation-withdraw')) })
    expect(withdraw).toHaveBeenCalledWith('a'.repeat(32))
    expect(screen.getByTestId('send-conversation-withdrawn').textContent).toMatch(/Withdrawn and deleted/)
  })

  it('a refusal says why and sends again only on another press', async () => {
    const submit = vi.fn(async () => ({ ok: false, error: 'You have sent several reports recently. Please try again later.' }))
    mount({ submit })
    fireEvent.click(screen.getByTestId('send-conversation-consent'))
    await act(async () => { fireEvent.click(screen.getByTestId('send-conversation-send')) })
    expect(screen.getByRole('alert').textContent).toMatch(/several reports recently/)
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('a conversation over the size cap cannot be sent', () => {
    const { submit } = mount({ maxSourceBytes: 50 })
    fireEvent.click(screen.getByTestId('send-conversation-consent'))
    expect(screen.getByTestId('send-conversation-send')).toBeDisabled()
    expect(screen.getByRole('alert').textContent).toMatch(/larger than/)
    expect(submit).not.toHaveBeenCalled()
  })
})

describe('the door in the dock', () => {
  function mountDock() {
    render(<CreateIndicatorPanel settings={mergeChartSettings({})} onChange={() => {}} sym="AAPL" tf="D"
      onPreview={() => {}} onClose={() => {}} converse={scriptedConverse} />)
  }
  async function say(text) {
    fireEvent.change(screen.getByTestId('create-indicator-input'), { target: { value: text } })
    await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-send')) })
    await act(async () => {})
  }

  it('appears once the member has written something, and opens the dialog without sending', async () => {
    mountDock()
    expect(screen.queryByTestId('create-indicator-send-to-uct')).toBeNull()
    await say('Add a 20 EMA')
    const door = await screen.findByTestId('create-indicator-send-to-uct')
    await act(async () => { fireEvent.click(door) })
    await waitFor(() => expect(screen.getByTestId('send-conversation-dialog')).toBeInTheDocument())
    expect(screen.getByTestId('send-conversation-send')).toBeDisabled()
  })

  it('is not offered while the report door is off', async () => {
    H.enabled = false
    mountDock()
    await say('Add a 20 EMA')
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(screen.queryByTestId('create-indicator-send-to-uct')).toBeNull()
  })
})
