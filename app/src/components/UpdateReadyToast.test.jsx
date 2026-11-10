import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import UpdateReadyToast, { COPY_PLAIN, COPY_POPOUTS } from './UpdateReadyToast'
import { registerPopout } from '../lib/popoutRegistry'
import {
  announceUpdateRequired, announceNewBuild, clearNewBuild, __resetReloadGuardForTests,
} from '../lib/reloadGuard'
import { fetchHealthSafe } from '../lib/buildVersion'

const realLocation = window.location
beforeEach(() => __resetReloadGuardForTests())
afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('UpdateReadyToast', () => {
  it('renders nothing until an update is announced', () => {
    const { container } = render(<UpdateReadyToast watch={false} />)
    expect(container.innerHTML).toBe('')
  })
  it('plain copy with a Reload button when no pop-outs are open', () => {
    render(<UpdateReadyToast watch={false} />)
    act(() => announceUpdateRequired())
    expect(screen.getByText(COPY_PLAIN)).toBeTruthy()
    expect(COPY_PLAIN).toBe('A new version of UCT is ready.')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })
  it('pop-out copy while a window is open, switching live', () => {
    render(<UpdateReadyToast watch={false} />)
    act(() => announceUpdateRequired())
    let release
    act(() => { release = registerPopout() })
    expect(screen.getByText(COPY_POPOUTS)).toBeTruthy()
    expect(COPY_POPOUTS).toBe('A new version of UCT is ready. Your popped-out windows will close, and you can restore boards from Charts afterward.')
    act(() => release())
    expect(screen.getByText(COPY_PLAIN)).toBeTruthy()
  })
  it('copy has no em dashes', () => {
    expect(COPY_PLAIN + COPY_POPOUTS).not.toMatch(/—/)
  })
  it('a stale-chunk update (forced) has no dismiss control', () => {
    render(<UpdateReadyToast watch={false} />)
    act(() => announceUpdateRequired())
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull()
  })
  it('a watcher-announced build can be dismissed with Later, and stays dismissed across remounts', () => {
    const a = render(<UpdateReadyToast watch={false} />)
    act(() => announceNewBuild('assets/index-b.js'))
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(screen.queryByTestId('update-ready-toast')).toBeNull()
    a.unmount()
    const b = render(<UpdateReadyToast watch={false} />)
    expect(b.container.innerHTML).toBe('')
  })
  it('A, B, A: dismissed B stays hidden, a different build C returns, rollback to A clears', () => {
    render(<UpdateReadyToast watch={false} />)
    act(() => announceNewBuild('assets/index-b.js'))
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    act(() => announceNewBuild('assets/index-b.js'))
    expect(screen.queryByTestId('update-ready-toast')).toBeNull()
    act(() => announceNewBuild('assets/index-c.js'))
    expect(screen.getByTestId('update-ready-toast')).toBeTruthy()
    act(() => clearNewBuild())
    expect(screen.queryByTestId('update-ready-toast')).toBeNull()
    act(() => announceNewBuild('assets/index-b.js'))
    expect(screen.getByTestId('update-ready-toast')).toBeTruthy()
  })
  it('a forced update cannot be dismissed even after a build was dismissed', () => {
    render(<UpdateReadyToast watch={false} />)
    act(() => announceNewBuild('assets/index-b.js'))
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    act(() => announceUpdateRequired())
    expect(screen.getByTestId('update-ready-toast')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull()
  })
  it('Reload calls location.reload', () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/', search: '', reload } })
    render(<UpdateReadyToast watch={false} />)
    act(() => announceUpdateRequired())
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })
  it('RENDER LOOP RAIL: announce and pop-out churn never re-render the parent', () => {
    let renders = 0
    const Probe = () => { renders += 1; return <UpdateReadyToast watch={false} /> }
    render(<Probe />)
    const base = renders
    act(() => announceUpdateRequired())
    act(() => announceUpdateRequired())
    for (let i = 0; i < 3; i++) {
      let r
      act(() => { r = registerPopout() })
      act(() => r())
    }
    expect(renders).toBe(base)
    expect(renders).toBeLessThan(50)
  })
  it('stays out of layout: position fixed, mounted in Layout as a stateless leaf', () => {
    const css = readFileSync(`${process.cwd()}/src/components/UpdateReadyToast.module.css`, 'utf8')
    expect(css).toMatch(/\.toast\s*\{[^}]*position:\s*fixed/)
    const layout = readFileSync(`${process.cwd()}/src/components/Layout.jsx`, 'utf8')
    expect(layout).toMatch(/<UpdateReadyToast\s*\/>/)
  })
})

describe('fetchHealthSafe', () => {
  it('returns the body on success', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ build_id: 'assets/index-a.js' }) })
    expect(await fetchHealthSafe({ fetchImpl: f })).toEqual({ build_id: 'assets/index-a.js' })
  })
  it('never throws: rejection, non-ok and bad json all give null', async () => {
    expect(await fetchHealthSafe({ fetchImpl: () => Promise.reject(new Error('x')) })).toBeNull()
    expect(await fetchHealthSafe({ fetchImpl: async () => ({ ok: false }) })).toBeNull()
    expect(await fetchHealthSafe({ fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('j') } }) })).toBeNull()
  })
  it('aborts after its own 10 second timeout', async () => {
    vi.useFakeTimers()
    let signal
    const f = (_u, o) => {
      signal = o.signal
      return new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('abort'))))
    }
    const p = fetchHealthSafe({ fetchImpl: f })
    await vi.advanceTimersByTimeAsync(9999)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(await p).toBeNull()
    expect(signal.aborted).toBe(true)
    vi.useRealTimers()
  })
})
