// Per-member command history (daily-use leftover #1). The pure rules, the hook against a
// stand-in preference store (read-modify-write, fallback when the preference cannot be read),
// and the rendered command line walking a history the shell hands it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect, useReducer } from 'react'
import { render, screen, fireEvent, act, cleanup, renderHook } from '@testing-library/react'

const store = vi.hoisted(() => ({ prefs: {}, loading: false, listeners: new Set(), writes: [] }))

vi.mock('../../hooks/usePreferences', () => {
  const parsePref = (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  }
  const notify = () => store.listeners.forEach((f) => f())
  return {
    parsePref,
    default: function usePreferences() {
      const [, force] = useReducer((x) => x + 1, 0)
      useEffect(() => { store.listeners.add(force); return () => store.listeners.delete(force) }, [])
      return {
        prefs: store.prefs,
        loading: store.loading,
        setPref: () => {},
        // The real hook runs the updater on the FRESHEST cached value: so does this one.
        setPrefMerged: async (k, updater) => {
          const next = updater(parsePref(store.prefs[k], undefined))
          if (next === undefined) return
          const v = typeof next === 'string' ? next : JSON.stringify(next)
          store.writes.push([k, v]); store.prefs = { ...store.prefs, [k]: v }; notify()
        },
      }
    },
  }
})

import useCommandHistory, {
  COMMAND_HISTORY_MAX, HISTORY_KEY, normalizeHistory, pushCommand, readStoredHistory,
} from './commandHistory'
import CommandLine from './CommandLine'

const KEY = 'terminal_command_history'
const serverList = () => JSON.parse(store.prefs[KEY])

beforeEach(() => {
  store.prefs = {}
  store.loading = false
  store.writes = []
  try { window.localStorage.clear() } catch { /* */ }
})
afterEach(() => cleanup())

describe('the history rules', () => {
  it('a new line goes first; a repeat of the newest line is not stored again', () => {
    expect(pushCommand(['B', 'A'], 'C')).toEqual(['C', 'B', 'A'])
    expect(pushCommand(['C', 'B', 'A'], 'C')).toEqual(['C', 'B', 'A'])
    expect(pushCommand(['C', 'B', 'A'], ' C ')).toEqual(['C', 'B', 'A'])       // trimmed first
  })

  it('a line run again moves to the front instead of appearing twice', () => {
    expect(pushCommand(['C', 'B', 'A'], 'A')).toEqual(['A', 'C', 'B'])
  })

  it('is capped at COMMAND_HISTORY_MAX, dropping the oldest', () => {
    const full = Array.from({ length: COMMAND_HISTORY_MAX }, (_, i) => `L${i}`)
    const next = pushCommand(full, 'NEW')
    expect(COMMAND_HISTORY_MAX).toBe(100)
    expect(next).toHaveLength(COMMAND_HISTORY_MAX)
    expect(next[0]).toBe('NEW')
    expect(next).not.toContain(`L${COMMAND_HISTORY_MAX - 1}`)
  })

  it('normalizes a stored list: strings only, trimmed, no blanks, no repeat in a row', () => {
    expect(normalizeHistory(['A', 'A', ' ', 3, ' B ', 'A'])).toEqual(['A', 'B', 'A'])
    expect(normalizeHistory({ a: 1 })).toBeNull()                            // not a list
  })

  it('reads the stored preference as empty, ok, or unreadable (never guessing)', () => {
    expect(readStoredHistory(undefined).status).toBe('empty')
    expect(readStoredHistory('["A","B"]')).toEqual({ status: 'ok', history: ['A', 'B'] })
    expect(readStoredHistory('{not json').status).toBe('unreadable')
    expect(readStoredHistory('{"a":1}').status).toBe('unreadable')
  })
})

describe('useCommandHistory', () => {
  it('walks the member\'s server history and pushes to it (read-modify-write)', async () => {
    store.prefs = { [KEY]: JSON.stringify(['NVDA GP', 'AMD FA']) }
    const { result } = renderHook(() => useCommandHistory())
    expect(result.current.source).toBe('server')
    expect(result.current.history).toEqual(['NVDA GP', 'AMD FA'])
    // Another device writes in between: the push is merged onto the FRESHEST value.
    store.prefs = { [KEY]: JSON.stringify(['TSLA DES', 'NVDA GP', 'AMD FA']) }
    await act(async () => { result.current.push('SPY GP') })
    expect(serverList()).toEqual(['SPY GP', 'TSLA DES', 'NVDA GP', 'AMD FA'])
    expect(result.current.history[0]).toBe('SPY GP')
  })

  it('a repeat of the newest command writes nothing', async () => {
    store.prefs = { [KEY]: JSON.stringify(['NVDA GP']) }
    const { result } = renderHook(() => useCommandHistory())
    await act(async () => { result.current.push('NVDA GP') })
    expect(store.writes).toEqual([])
  })

  it('a member with no server history starts empty; this browser\'s copy is never carried into the account', async () => {
    // A shared computer: the browser copy holds the previous person's commands.
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(['OLD 1', 'OLD 2']))
    const { result } = renderHook(() => useCommandHistory())
    expect(result.current.history).toEqual([])
    await act(async () => { result.current.push('NEW') })
    expect(serverList()).toEqual(['NEW'])
    expect(JSON.parse(window.localStorage.getItem(HISTORY_KEY))).toEqual(['NEW', 'OLD 1', 'OLD 2'])
  })

  it('while preferences load, ↑ walks this browser and nothing is written to the server', async () => {
    store.loading = true
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(['LOCAL']))
    const { result } = renderHook(() => useCommandHistory())
    expect(result.current.source).toBe('local')
    expect(result.current.history).toEqual(['LOCAL'])
    await act(async () => { result.current.push('X') })
    expect(store.writes).toEqual([])
    expect(JSON.parse(window.localStorage.getItem(HISTORY_KEY))).toEqual(['X', 'LOCAL'])
  })

  it('an unreadable stored value is never saved over; the browser copy carries on', async () => {
    store.prefs = { [KEY]: '{"broken":' }
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(['LOCAL']))
    const { result } = renderHook(() => useCommandHistory())
    expect(result.current.source).toBe('local')
    expect(result.current.history).toEqual(['LOCAL'])
    await act(async () => { result.current.push('X') })
    expect(store.writes).toEqual([])
    expect(store.prefs[KEY]).toBe('{"broken":')
  })

  it('CONTROL: storage that throws still leaves a working (server) history', async () => {
    store.prefs = { [KEY]: JSON.stringify(['A']) }
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('off') })
    const { result } = renderHook(() => useCommandHistory())
    await act(async () => { result.current.push('B') })
    spy.mockRestore()
    expect(serverList()).toEqual(['B', 'A'])
  })
})

describe('the command line walks the history it is handed', () => {
  const input = () => screen.getByTestId('terminal-command')
  const key = (k) => act(() => { fireEvent.keyDown(input(), { key: k }) })

  it('↑/↓ walk the passed history (not this browser\'s), and Enter reports to onHistory', () => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(['LOCAL ONLY']))
    const pushed = []
    render(<CommandLine onSubmit={() => {}} history={['SRV 2', 'SRV 1']} onHistory={(v) => pushed.push(v)} />)
    key('ArrowUp'); expect(input().value).toBe('SRV 2')
    key('ArrowUp'); expect(input().value).toBe('SRV 1')
    key('ArrowDown'); expect(input().value).toBe('SRV 2')
    act(() => { fireEvent.change(input(), { target: { value: 'AMD GP' } }) })
    key('Enter')
    expect(pushed).toEqual(['AMD GP'])
    // onHistory owns the write: the command line did not also push to the browser itself.
    expect(JSON.parse(window.localStorage.getItem(HISTORY_KEY))).toEqual(['LOCAL ONLY'])
  })

  it('CONTROL: without a history prop it walks this browser\'s copy', () => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(['LOCAL ONLY']))
    render(<CommandLine onSubmit={() => {}} />)
    key('ArrowUp'); expect(input().value).toBe('LOCAL ONLY')
  })
})
