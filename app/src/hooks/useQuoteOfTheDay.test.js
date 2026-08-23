import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

let swrState = { data: undefined, error: undefined }
vi.mock('swr', () => ({ default: () => swrState }))

import useQuoteOfTheDay from './useQuoteOfTheDay'
import { QUOTES, quoteOfTheDay } from '../constants/quotes'

const SERVER = { t: 'Only price pays.', a: 'Brian Shannon', src: 'Alphatrends', tags: ['momentum'] }

describe('useQuoteOfTheDay', () => {
  beforeEach(() => { swrState = { data: undefined, error: undefined } })

  it('returns null while the server pick is loading — never paints a quote it will swap', () => {
    const { result } = renderHook(() => useQuoteOfTheDay())
    expect(result.current).toEqual({ quote: null, label: null, source: 'loading' })
  })

  it('prefers the server pick and carries its regime label', () => {
    swrState = { data: { quote: SERVER, label: 'Neutral' }, error: undefined }
    const { result } = renderHook(() => useQuoteOfTheDay())
    expect(result.current).toEqual({ quote: SERVER, label: 'Neutral', source: 'server' })
  })

  it('falls back to the local rotation when the API errors', () => {
    swrState = { data: undefined, error: new Error('HTTP 502') }
    const { result } = renderHook(() => useQuoteOfTheDay())
    expect(result.current.source).toBe('fallback')
    expect(result.current.quote).toBe(quoteOfTheDay())
    expect(QUOTES).toContain(result.current.quote)
  })

  it('falls back when the server answers without a quote (library missing on the pod)', () => {
    swrState = { data: { quote: null, pool_size: 0 }, error: undefined }
    const { result } = renderHook(() => useQuoteOfTheDay())
    expect(result.current.source).toBe('fallback')
    expect(result.current.quote).toBe(quoteOfTheDay())
  })
})
