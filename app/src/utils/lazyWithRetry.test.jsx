import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Suspense } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import lazyWithRetry, { RELOAD_FLAG } from './lazyWithRetry'
import ErrorBoundary from '../components/ErrorBoundary'
import { registerPopout } from '../lib/popoutRegistry'
import { __resetReloadGuardForTests, isUpdateAnnounced } from '../lib/reloadGuard'

const chunkErr = () => new Error('Failed to fetch dynamically imported module: /assets/x.js')
let reloadSpy
const realLocation = window.location

beforeEach(() => {
  sessionStorage.clear()
  __resetReloadGuardForTests()
  reloadSpy = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { pathname: '/', search: '', hash: '', href: 'http://localhost/', reload: reloadSpy },
  })
})
afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('lazyWithRetry with no pop-outs (today exactly)', () => {
  it('reloads once on a chunk error and sets the flag', async () => {
    const L = lazyWithRetry(() => Promise.reject(chunkErr()))
    render(<Suspense fallback="loading"><L /></Suspense>)
    await vi.waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1))
    expect(sessionStorage.getItem(RELOAD_FLAG)).toBeTruthy()
    expect(isUpdateAnnounced()).toBe(false)
  })
  it('throws to the boundary when the reload was already tried', async () => {
    sessionStorage.setItem(RELOAD_FLAG, '1')
    const L = lazyWithRetry(() => Promise.reject(chunkErr()))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary fallback={<div>boundary</div>}><Suspense fallback="loading"><L /></Suspense></ErrorBoundary>)
    await screen.findByText('boundary')
    expect(reloadSpy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('lazyWithRetry with a pop-out open', () => {
  it('resolves the UpdateRequiredNotice stub instead of throwing or reloading', async () => {
    const release = registerPopout()
    const L = lazyWithRetry(() => Promise.reject(chunkErr()))
    render(<Suspense fallback="loading"><L /></Suspense>)
    await screen.findByTestId('update-required-notice')
    expect(screen.getByText('Update required to open this')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(reloadSpy).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(RELOAD_FLAG)).toBeNull()
    expect(isUpdateAnnounced()).toBe(true)
    release()
  })
  it('a non-chunk error still propagates to the boundary', async () => {
    const release = registerPopout()
    const L = lazyWithRetry(() => Promise.reject(new Error('boom')))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary fallback={<div>boundary</div>}><Suspense fallback="loading"><L /></Suspense></ErrorBoundary>)
    await screen.findByText('boundary')
    spy.mockRestore()
    release()
  })
})

describe('a Terminal pop-out child never auto-reloads', () => {
  it('shows the stub and announces', async () => {
    window.location.pathname = '/terminal'
    window.location.search = '?popout=abc'
    const L = lazyWithRetry(() => Promise.reject(chunkErr()))
    render(<Suspense fallback="loading"><L /></Suspense>)
    await screen.findByTestId('update-required-notice')
    expect(reloadSpy).not.toHaveBeenCalled()
    expect(isUpdateAnnounced()).toBe(true)
  })
})
