import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

import AgentPanel from './AgentPanel'

// The welcome plays ONCE (full list, typed out); after that a new chat types a short greeting,
// and reopening the panel shows the greeting at once — never a replay of the full welcome.
const host = { charts: { list: () => [], read: () => null }, otherWidgets: () => [] }
const KEY = 'uct.agent.welcomed.anon'
const open = () => render(<AgentPanel host={host} onClose={() => {}} />)

beforeEach(() => {
  vi.useFakeTimers()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async () => new Response('{"conversations":[]}', { status: 200, headers: { 'content-type': 'application/json' } }))
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('welcome: once, then a short greeting', () => {
  it('first open: types, then the full welcome, and remembers it was seen', () => {
    open()
    expect(screen.getByTestId('agent-typing').textContent).toMatch(/UCT Agent is typing/)
    expect(screen.queryByTestId('agent-welcome')).toBeNull()        // the bubble arrives whole
    expect(localStorage.getItem(KEY)).toBeNull()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText(/full-time trading assistant/)).toBeTruthy()
    expect(screen.queryByTestId('agent-typing')).toBeNull()
    expect(localStorage.getItem(KEY)).toBe('1')
  })
  it('reopening after that: the short greeting at once, no typing, no full list', () => {
    localStorage.setItem(KEY, '1')
    open()
    expect(screen.queryByTestId('agent-typing')).toBeNull()
    expect(screen.getByText(/What can I help you with\?/)).toBeTruthy()
    expect(screen.queryByText(/full-time trading assistant/)).toBeNull()
  })
  it('New chat: a short greeting, typed', () => {
    localStorage.setItem(KEY, '1')
    open()
    fireEvent.click(screen.getByLabelText('New chat'))
    expect(screen.getByTestId('agent-typing')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(700) })
    expect(screen.getByText(/What can I help you with\?/)).toBeTruthy()
    expect(screen.queryByText(/full-time trading assistant/)).toBeNull()
  })
})
