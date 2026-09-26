// D14 — every error boundary reports what it caught, through the scrubbing
// beacon, and a boundary still renders its fallback and calls onError.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ErrorBoundary from './ErrorBoundary'
import { FLUSH_MS, resetErrorBeaconForTests } from '../lib/errorBeacon'

const NOTE_SENTENCE = 'Trim TSLA into the gap and hold the rest over earnings'

function Thrower({ message }) {
  throw new Error(message)
}

let fetchSpy
beforeEach(() => {
  vi.useFakeTimers()
  resetErrorBeaconForTests()
  fetchSpy = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ enabled: true }) }))
  vi.stubGlobal('fetch', fetchSpy)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetErrorBeaconForTests()
})

const beaconPosts = () => fetchSpy.mock.calls.filter(([url]) => url === '/api/client-errors')

describe('ErrorBoundary → beacon', () => {
  it('reports the caught error as a boundary report with its component stack', () => {
    render(
      <ErrorBoundary fallback={<div>Something went wrong</div>}>
        <Thrower message="x is not a function" />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    vi.advanceTimersByTime(FLUSH_MS)
    const posts = beaconPosts()
    expect(posts).toHaveLength(1)
    const [report] = JSON.parse(posts[0][1].body).reports
    expect(report.kind).toBe('boundary')
    expect(report.message).toBe('x is not a function')
    expect(report.componentStack).toContain('Thrower')
  })

  it('a note sentence thrown inside the tree never leaves the browser', () => {
    render(
      <ErrorBoundary fallback={<div>fallback</div>}>
        <Thrower message={NOTE_SENTENCE} />
      </ErrorBoundary>,
    )
    vi.advanceTimersByTime(FLUSH_MS)
    const body = beaconPosts().map(([, init]) => init.body).join('\n')
    expect(body).not.toBe('')
    for (const word of ['TSLA', 'Trim', 'gap', 'earnings', NOTE_SENTENCE]) {
      expect(body).not.toContain(word)
    }
  })

  it('still calls onError and renders the fallback', () => {
    const onError = vi.fn()
    render(
      <ErrorBoundary fallback={<div>fallback shown</div>} onError={onError}>
        <Thrower message="boom" />
      </ErrorBoundary>,
    )
    expect(onError).toHaveBeenCalledTimes(1)
    expect(screen.getByText('fallback shown')).toBeTruthy()
  })

  it('a boundary with no network still renders its fallback (the beacon never throws)', () => {
    vi.stubGlobal('fetch', () => { throw new Error('offline') })
    render(
      <ErrorBoundary fallback={<div>still here</div>}>
        <Thrower message="boom" />
      </ErrorBoundary>,
    )
    expect(() => vi.advanceTimersByTime(FLUSH_MS)).not.toThrow()
    expect(screen.getByText('still here')).toBeTruthy()
  })
})
