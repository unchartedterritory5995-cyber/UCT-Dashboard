import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIRST_CHART_PAINT, useAfterFirstPaintIdle, useYouTubeApi, WARM_MAX_WAIT_MS } from './useYouTubeApi'
import { FIRST_CHART_PAINT_EVENT } from '../../lib/barsPackClient'

const ytScript = () => document.getElementById('yt-iframe-api')

describe('the YouTube player API never loads at boot (speed rule 4)', () => {
  afterEach(() => { ytScript()?.remove(); vi.useRealTimers() })

  it('the mark it waits for is the one the first chart sets', () => {
    expect(FIRST_CHART_PAINT).toBe(FIRST_CHART_PAINT_EVENT)
  })

  it('start=false injects nothing; start=true injects the script once', () => {
    const { rerender } = renderHook(({ start }) => useYouTubeApi({ start }), { initialProps: { start: false } })
    expect(ytScript()).toBeNull()
    rerender({ start: true })
    expect(ytScript()?.src).toBe('https://www.youtube.com/iframe_api')
  })

  it('becomes due after the first chart paints and the page is idle, not before', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useAfterFirstPaintIdle())
    expect(result.current).toBe(false)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current).toBe(false)
    act(() => { window.dispatchEvent(new Event(FIRST_CHART_PAINT)) })
    act(() => { vi.advanceTimersByTime(10) })
    expect(result.current).toBe(true)
  })

  it('a page with no chart still warms it, after the time limit', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useAfterFirstPaintIdle())
    act(() => { vi.advanceTimersByTime(WARM_MAX_WAIT_MS - 1) })
    expect(result.current).toBe(false)
    act(() => { vi.advanceTimersByTime(10) })
    expect(result.current).toBe(true)
  })
})

describe('the app-wide video layer waits for a video or the first chart', () => {
  it('GlobalVideoLayer starts the API only when a video is open or the page is warm', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(globalThis.process.cwd(), 'src/components/video/GlobalVideoLayer.jsx'), 'utf8')
    expect(src).toMatch(/useYouTubeApi\(\{ start: active \|\| warm \}\)/)
    expect(src).not.toMatch(/useYouTubeApi\(\)/)
  })
})
