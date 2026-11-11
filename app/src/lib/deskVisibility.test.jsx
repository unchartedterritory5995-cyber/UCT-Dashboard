// Idle mode (desktop Task 22): while the whole desktop desk is hidden, SWR stops polling. Streams are
// not SWR and are untouched. In a browser, nothing changes: a hidden tab already stops SWR polls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import useSWR, { SWRConfig } from 'swr'
import { __resetDeskVisibility, isAppVisible, isDeskHidden, onDeskHiddenChange, setDeskHidden } from './deskVisibility'
import DesktopBridgeSync from '../components/DesktopBridgeSync'

beforeEach(() => { __resetDeskVisibility(); delete window.uctDesktop })
afterEach(() => { cleanup(); vi.useRealTimers(); __resetDeskVisibility(); delete window.uctDesktop })

describe('deskVisibility', () => {
  it('is visible by default and while a hidden desk is not reported', () => {
    expect(isAppVisible()).toBe(true)
    setDeskHidden(true)
    expect(isAppVisible()).toBe(false)
    setDeskHidden(false)
    expect(isAppVisible()).toBe(true)
  })

  it('still follows a browser tab that is hidden', () => {
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    expect(isAppVisible()).toBe(false)
    spy.mockRestore()
  })

  it('notifies on a change only', () => {
    const seen = []
    const off = onDeskHiddenChange((h) => seen.push(h))
    setDeskHidden(true); setDeskHidden(true); setDeskHidden(false)
    off()
    setDeskHidden(true)
    expect(seen).toEqual([true, false])
  })
})

describe('SWR polls stop while the desk is hidden and resume after', () => {
  it('a 1 s poll fetches while visible, not while hidden, and again once visible', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(async () => 'ok')
    function Poller() { useSWR('desk-poll-key', fetcher, { refreshInterval: 1000, dedupingInterval: 0 }); return null }
    render(
      <SWRConfig value={{ provider: () => new Map(), isVisible: isAppVisible, dedupingInterval: 0 }}>
        <Poller />
      </SWRConfig>,
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    const visibleCalls = fetcher.mock.calls.length
    expect(visibleCalls).toBeGreaterThanOrEqual(3)

    act(() => setDeskHidden(true))
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(fetcher.mock.calls.length).toBe(visibleCalls) // not one poll while hidden

    act(() => setDeskHidden(false))
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(fetcher.mock.calls.length).toBeGreaterThan(visibleCalls)
  })
})

describe('the app wires it', () => {
  it('App.jsx gives SWR the desk-aware isVisible', () => {
    const app = readFileSync(path.resolve(globalThis.process.cwd(), 'src/App.jsx'), 'utf8')
    expect(app).toMatch(/isVisible:\s*isAppVisible/)
  })

  it('DesktopBridgeSync turns the shell\'s desk visibility into the flag, and clears it on unmount', async () => {
    let emit = null
    window.uctDesktop = {
      bridgeVersion: 1,
      capabilities: ['window-state', 'before-quit', 'desk-visibility'],
      getInfo: async () => ({ appVersion: '1', platform: 'win32' }),
      onWindowState: () => () => {},
      onDeskVisibility: (cb) => { emit = cb; return () => { emit = null } },
      onBeforeQuit: () => () => {},
      ackBeforeQuit: () => {},
    }
    const view = render(<DesktopBridgeSync />)
    await act(async () => {})
    expect(typeof emit).toBe('function')
    act(() => emit('hidden'))
    expect(isDeskHidden()).toBe(true)
    act(() => emit('visible'))
    expect(isDeskHidden()).toBe(false)
    act(() => emit('hidden'))
    view.unmount()
    expect(isDeskHidden()).toBe(false) // a shell that goes away never leaves polls paused
  })

  it('an older shell without the capability changes nothing', async () => {
    window.uctDesktop = {
      bridgeVersion: 1,
      capabilities: ['window-state', 'before-quit'],
      getInfo: async () => ({ appVersion: '1', platform: 'win32' }),
      onWindowState: () => () => {},
      onBeforeQuit: () => () => {},
      ackBeforeQuit: () => {},
    }
    render(<DesktopBridgeSync />)
    await act(async () => {})
    expect(isAppVisible()).toBe(true)
  })
})
