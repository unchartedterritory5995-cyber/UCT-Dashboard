// A failed request must never reach a section as `null`.
//
// Reported 2026-08-23: the NVDA modal's News tab read "No recent news for this
// ticker." while `/api/research/news/NVDA` was returning 15KB of headlines in
// 260ms. The pod had restarted mid-request; every fetcher in this tree was
// `.catch(() => null)`, so the section could not tell a dropped connection
// from a quiet ticker and rendered the more confident of the two.
//
// These tests pin the DISTINCTION, which is the whole point of the module: a
// failure REJECTS (so SWR sets `error` and the section can offer a retry), a
// paid gate RESOLVES (it is a state the section renders), and an empty-but-
// successful body RESOLVES (a genuinely quiet ticker still says so).
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FETCH_FAILED, SectionFetchError, sectionFetcher } from './sectionFetch'

const jsonRes = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

beforeEach(() => { vi.restoreAllMocks() })

describe('sectionFetcher — failures reject', () => {
  it('rejects on a network error instead of resolving null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(sectionFetcher('/api/research/news/NVDA')).rejects.toBeInstanceOf(SectionFetchError)
  })

  it.each([500, 502, 503, 504, 404, 401])('rejects on HTTP %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(null, status)))
    await expect(sectionFetcher('/api/x')).rejects.toMatchObject({ status })
  })

  it('rejects when a 200 body is not JSON (an HTML error page)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => { throw new SyntaxError('Unexpected token <') },
    }))
    await expect(sectionFetcher('/api/x')).rejects.toBeInstanceOf(SectionFetchError)
  })

  it('carries the url so a failure is diagnosable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(null, 502)))
    await expect(sectionFetcher('/api/research/news/NVDA'))
      .rejects.toMatchObject({ url: '/api/research/news/NVDA' })
  })
})

describe('sectionFetcher — states resolve', () => {
  it('resolves 402 as the paywalled STATE, never an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(null, 402)))
    await expect(sectionFetcher('/api/stock-brief/NVDA')).resolves.toEqual({ paywalled: true })
  })

  it('resolves a successful but EMPTY payload — a quiet ticker is not a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ sym: 'XYZ', items: [] })))
    await expect(sectionFetcher('/api/research/news/XYZ')).resolves.toEqual({ sym: 'XYZ', items: [] })
  })

  it('resolves real content unchanged', async () => {
    const body = { sym: 'NVDA', items: [{ title: 'a' }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(body)))
    await expect(sectionFetcher('/api/research/news/NVDA')).resolves.toEqual(body)
  })
})

describe('paidFetcher is the SAME function, not a second copy of the 402 rule', () => {
  it('re-exports sectionFetcher', async () => {
    const { paidFetcher } = await import('./paidFetcher')
    expect(paidFetcher).toBe(sectionFetcher)
  })
})

describe('failure copy', () => {
  it('does not make a claim about the company', () => {
    const text = `${FETCH_FAILED.title} ${FETCH_FAILED.hint}`.toLowerCase()
    // The whole defect was copy that asserted a fact ("No recent news for this
    // ticker") off a network error. The failure copy must say the REQUEST
    // failed, and must not read as a finding about the business.
    expect(text).toMatch(/request failed|could not load/)
    expect(text).not.toMatch(/\bno recent\b|\bno news\b|\bnothing\b/)
  })
})
