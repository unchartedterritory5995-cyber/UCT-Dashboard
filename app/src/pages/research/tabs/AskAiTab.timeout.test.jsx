// ASK: a POST that never answers ends, frees the Ask button and offers Ask again
// (quality pass 2026-10-05: the turn used to sit on "Reading ..." with Ask disabled forever).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import AskAiTab, { ASK_TIMEOUT_MS } from './AskAiTab'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('AskAiTab deadline', () => {
  it('a hung request becomes a stated failure with Ask again, and Ask is usable again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    global.fetch = vi.fn(() => new Promise(() => {}))
    render(<AskAiTab sym="AAPL" />)
    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What changed?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(screen.getByTestId('ask-ai-loading')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_MS + 1) })
    expect(screen.getByTestId('ask-ai-error').textContent).toMatch(/took too long/)
    expect(screen.queryByTestId('ask-ai-loading')).toBeNull()
    expect(screen.getByRole('button', { name: 'Ask again' })).not.toBeDisabled()
  })

  it('a 500 says the assistant could not answer, with Ask again', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    render(<AskAiTab sym="AAPL" />)
    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What changed?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect((await screen.findByTestId('ask-ai-error')).textContent).toMatch(/could not answer right now/)
    fireEvent.click(screen.getByRole('button', { name: 'Ask again' }))
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})
