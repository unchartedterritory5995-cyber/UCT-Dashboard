// Audit 2026-10-08 (lane A): ASK is keyboard-operable (Enter asks, Shift+Enter is a new line) and
// its waiting line is announced, in plain words.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import AskAiTab from './AskAiTab'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('AskAiTab keyboard', () => {
  it('Enter asks the typed question', () => {
    global.fetch = vi.fn(() => new Promise(() => {}))
    render(<AskAiTab sym="AAPL" />)
    const box = screen.getByTestId('ask-ai-input')
    fireEvent.change(box, { target: { value: 'What changed?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const loading = screen.getByTestId('ask-ai-loading')
    expect(loading.getAttribute('role')).toBe('status')
    expect(loading.textContent).toBe("Reading UCT's research data on AAPL…")
  })

  it('Shift+Enter does not ask, and an empty box never asks', () => {
    global.fetch = vi.fn(() => new Promise(() => {}))
    render(<AskAiTab sym="AAPL" />)
    const box = screen.getByTestId('ask-ai-input')
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.change(box, { target: { value: 'What changed?' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
