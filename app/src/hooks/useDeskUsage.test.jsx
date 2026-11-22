import { render, cleanup, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let authState
vi.mock('../context/AuthContext', () => ({ useAuth: () => authState }))

const { default: DeskUsageReporter } = await import('../components/DeskUsageReporter')
const {
  classifyOs, readDeskUsage, etDay, msUntilReportTime, DESK_USAGE_SENT_KEY, DESK_USAGE_ENDPOINT,
} = await import('./useDeskUsage')
const { registerPopout } = await import('../lib/popoutRegistry')

let fetchMock
const hide = () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  authState = { user: { id: 'u1' }, loading: false }
  fetchMock = vi.fn(() => Promise.resolve({ ok: true }))
  vi.stubGlobal('fetch', fetchMock)
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete document.visibilityState
})

const bodies = () => fetchMock.mock.calls.map((c) => JSON.parse(c[1].body))

describe('payload', () => {
  it('has exactly the four allow-listed fields', () => {
    expect(Object.keys(readDeskUsage(false)).sort()).toEqual(['multi_monitor', 'os', 'popout_opened', 'standalone'])
  })
  it('absent screen.isExtended is unknown; true/false map to yes/no', () => {
    expect(readDeskUsage(false).multi_monitor).toBe('unknown')
    vi.stubGlobal('screen', { isExtended: true })
    expect(readDeskUsage(false).multi_monitor).toBe('yes')
    vi.stubGlobal('screen', { isExtended: false })
    expect(readDeskUsage(false).multi_monitor).toBe('no')
  })
  it('standalone comes from the display-mode media query', () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: q === '(display-mode: standalone)' }))
    window.matchMedia = globalThis.matchMedia
    expect(readDeskUsage(false).standalone).toBe(true)
  })
  it('classifies the OS coarsely and never returns the input', () => {
    expect(classifyOs('Mozilla/5.0 (Linux; Android 14)')).toBe('android')
    expect(classifyOs('Mozilla/5.0 (iPhone; CPU iPhone OS 17 like Mac OS X)')).toBe('ios')
    expect(classifyOs('Win32')).toBe('windows')
    expect(classifyOs('MacIntel')).toBe('mac')
    expect(classifyOs('X11; CrOS x86_64')).toBe('chromeos')
    expect(classifyOs('Linux x86_64')).toBe('linux')
    expect(classifyOs('Haiku')).toBe('other')
  })
  it('ET day and the pre-midnight timer', () => {
    expect(etDay(new Date('2026-11-09T04:59:00Z'))).toBe('2026-11-08')
    expect(etDay(new Date('2026-11-09T05:01:00Z'))).toBe('2026-11-09')
    // 23:00 ET (04:00Z next day, EST) -> 50 minutes to 23:50
    expect(msUntilReportTime(new Date('2026-11-10T04:00:00Z'))).toBe(50 * 60 * 1000)
    expect(msUntilReportTime(new Date('2026-11-10T04:55:00Z'))).toBe(0)
  })
})

describe('the leaf', () => {
  it('renders nothing and sends nothing for a signed-out visitor, even when hidden', () => {
    authState = { user: null, loading: false }
    const { container } = render(<DeskUsageReporter />)
    hide()
    expect(container.innerHTML).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('sends nothing while auth is still loading', () => {
    authState = { user: { id: 'u1' }, loading: true }
    render(<DeskUsageReporter />)
    hide()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('sends once on hide, to the endpoint, and never again that day', () => {
    render(<DeskUsageReporter />)
    expect(fetchMock).not.toHaveBeenCalled()
    hide(); hide(); window.dispatchEvent(new Event('pagehide'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(DESK_USAGE_ENDPOINT)
    expect(bodies()[0].popout_opened).toBe(false)
    expect(localStorage.getItem(DESK_USAGE_SENT_KEY)).toBe(`u1|${etDay()}|p0`)
  })
  it('a second mount the same day (reload) does not send again', () => {
    const a = render(<DeskUsageReporter />); hide(); a.unmount()
    render(<DeskUsageReporter />); hide()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('a pop-out opened after the first report sends one upgrade, then nothing', () => {
    render(<DeskUsageReporter />)
    hide()
    let release
    act(() => { release = registerPopout() })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodies()[1].popout_opened).toBe(true)
    act(() => { release() }); hide()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('a pop-out that opened and closed before any other trigger is still counted', () => {
    render(<DeskUsageReporter />)
    let release
    act(() => { release = registerPopout() })
    act(() => { release() })
    hide()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodies()[0].popout_opened).toBe(true)
  })
  it('a failed send is dropped silently and not retried that day', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')))
    render(<DeskUsageReporter />)
    hide()
    await Promise.resolve()
    hide()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('a throwing fetch never reaches the app', () => {
    fetchMock.mockImplementation(() => { throw new Error('boom') })
    render(<DeskUsageReporter />)
    expect(() => hide()).not.toThrow()
  })
  it('the payload carries no url, ticker or user-agent text', () => {
    render(<DeskUsageReporter />); hide()
    const raw = fetchMock.mock.calls[0][1].body
    expect(raw).not.toMatch(/http|Mozilla|\/|AAPL/)
  })
  describe('the 23:50 ET timer', () => {
    const setVis = (v) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v })
    afterEach(() => { vi.useRealTimers() })
    // 23:00 ET on 2026-11-10 (EST) is 04:00Z the next day; the timer is 50 minutes out.
    const arm = (vis) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      vi.setSystemTime(new Date('2026-11-10T04:00:00Z'))
      setVis(vis)
      render(<DeskUsageReporter />)
      act(() => { vi.advanceTimersByTime(51 * 60 * 1000) })
    }
    it('files nothing for a tab that was hidden all day (left idle overnight)', () => {
      arm('hidden')
      expect(fetchMock).not.toHaveBeenCalled()
    })
    it('files one report for a tab that was visible that day', () => {
      arm('visible')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })
})
