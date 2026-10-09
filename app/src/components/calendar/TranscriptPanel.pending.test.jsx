// Wave 4 #2: the transcript route answers 503 + Retry-After while its bounded provider fetch is
// still running (wave 2, fb5641e7a). The panel must say "still fetching, retrying" and re-ask —
// never "the request failed" — and the re-ask must land the transcript once it is ready.
// Real useTranscript + sectionFetcher; only fetch and the unrelated quarter/search reads are faked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../hooks/useTranscriptQuarters', () => ({
  default: () => ({ quarters: [], error: null, retry: () => {} }),
}))
vi.mock('./TranscriptSearchAll', () => ({ default: () => null }))

import TranscriptPanel from './TranscriptPanel'
import { isTranscriptPending, transcriptOnErrorRetry } from '../../hooks/transcriptRetry'

const TRANSCRIPT = {
  symbol: 'AAPL', quarter: '2025Q1', resolved: true,
  segments: [{ speaker: 'Tim Cook', title: 'CEO', content: 'Revenue grew strongly this quarter.', sentiment: null }],
}
const res = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
  json: async () => body,
})

let calls
beforeEach(() => { calls = [] })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const open = () => {
  render(<SWRConfig value={{ provider: () => new Map() }}><TranscriptPanel sym="AAPL" /></SWRConfig>)
  fireEvent.click(screen.getByText('FULL TRANSCRIPT'))
}

describe('TranscriptPanel — a pending (503 + Retry-After) transcript', () => {
  it('says "still fetching, retrying", never "request failed", then lands the transcript', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(url)
      if (!String(url).startsWith('/api/earnings/transcript/')) return res(404, {})
      const n = calls.filter((u) => String(u).startsWith('/api/earnings/transcript/')).length
      return n === 1 ? res(503, { detail: 'pending' }, { 'Retry-After': '1' }) : res(200, TRANSCRIPT)
    })
    open()
    await waitFor(() => expect(screen.getByTestId('transcript-pending')).toBeTruthy())
    expect(screen.getByTestId('transcript-pending').textContent).toMatch(/still fetching the transcript.*retrying/i)
    expect(screen.queryByTestId('transcript-failed')).toBeNull()
    await waitFor(() => expect(screen.getByText('Revenue grew strongly this quarter.')).toBeTruthy(), { timeout: 4000 })
    expect(screen.queryByTestId('transcript-pending')).toBeNull()
  })

  it('a 503 WITHOUT Retry-After (a real outage) still reads as a failure', async () => {
    globalThis.fetch = vi.fn(async (url) => (String(url).startsWith('/api/earnings/transcript/') ? res(503, {}) : res(404, {})))
    open()
    await waitFor(() => expect(screen.getByTestId('transcript-failed')).toBeTruthy())
    expect(screen.queryByTestId('transcript-pending')).toBeNull()
  })
})

describe('transcriptOnErrorRetry', () => {
  it('re-asks a pending 503 after Retry-After (clamped 1-60 s) and stops after the cap', () => {
    vi.useFakeTimers()
    try {
      const revalidate = vi.fn()
      transcriptOnErrorRetry({ status: 503, retryAfter: 8 }, 'k', {}, revalidate, { retryCount: 1 })
      vi.advanceTimersByTime(7999)
      expect(revalidate).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(revalidate).toHaveBeenCalledWith({ retryCount: 1 })
      revalidate.mockClear()
      transcriptOnErrorRetry({ status: 503, retryAfter: 8 }, 'k', {}, revalidate, { retryCount: 99 })
      vi.advanceTimersByTime(120000)
      expect(revalidate).not.toHaveBeenCalled()
      transcriptOnErrorRetry({ status: 404 }, 'k', {}, revalidate, { retryCount: 1 })
      vi.advanceTimersByTime(120000)
      expect(revalidate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
  it('isTranscriptPending needs both the 503 and the header', () => {
    expect(isTranscriptPending({ status: 503, retryAfter: 8 })).toBe(true)
    expect(isTranscriptPending({ status: 503, retryAfter: null })).toBe(false)
    expect(isTranscriptPending({ status: 500, retryAfter: 8 })).toBe(false)
    expect(isTranscriptPending(null)).toBe(false)
  })
})
