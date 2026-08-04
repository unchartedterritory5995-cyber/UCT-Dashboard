import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import BriefSection from './BriefSection'

const row = { sym: 'NVDA', verdict: 'pending' }
const calls = []

beforeEach(() => {
  calls.length = 0
  global.fetch = vi.fn((url) => {
    calls.push(url)
    const cached = url.includes('cached_only=1')
    return Promise.resolve({
      ok: true,
      json: async () => (cached
        ? { sym: 'NVDA', cached: false, preview_text: '', preview_bullets: [], news: [] }
        : { sym: 'NVDA', cached: true, preview_text: 'Guidance is the whole story.',
            preview_bullets: ['Watch data-centre mix'], news: [] }),
    })
  })
})

const renderBrief = (props = {}) => render(
  <BriefSection sym="NVDA" row={row} reportDate="2026-08-06" lifecycle="PRE"
                stepping={false} expectedMove={null} {...props} />,
)

describe('BriefSection', () => {
  it('on a click-open it requests the full brief', async () => {
    renderBrief()
    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0]).not.toContain('cached_only')
    expect(await screen.findByText(/Guidance is the whole story/)).toBeTruthy()
  })

  it('GATE: on a STEPPED-to symbol it requests cached-only and never auto-fires the LLM', async () => {
    renderBrief({ stepping: true })
    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0]).toContain('cached_only=1')
    expect(await screen.findByRole('button', { name: /generate brief/i })).toBeTruthy()
    expect(calls.filter(u => !u.includes('cached_only')).length).toBe(0)
  })

  it('the Generate brief button is what escalates to the LLM path', async () => {
    renderBrief({ stepping: true })
    const btn = await screen.findByRole('button', { name: /generate brief/i })
    fireEvent.click(btn)
    await waitFor(() =>
      expect(calls.some(u => !u.includes('cached_only'))).toBe(true))
  })

  it('a cached hit on a stepped-to symbol renders WITHOUT the button', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({ sym: 'NVDA', cached: true, preview_text: 'Cached copy.',
                           preview_bullets: [], news: [] }),
    }))
    renderBrief({ stepping: true })
    expect(await screen.findByText('Cached copy.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /generate brief/i })).toBeNull()
  })

  it('shows the AI provenance line', async () => {
    renderBrief()
    expect((await screen.findByTestId('brief-provenance')).textContent).toMatch(/^AI ·/)
  })

  it('never says "verdict"', async () => {
    const { container } = renderBrief()
    await screen.findByText(/Guidance is the whole story/)
    expect(container.textContent.toLowerCase()).not.toContain('verdict')
  })

  // `useEarningsBrief`'s `escalated` state lives in a hook instance that
  // BriefSection never remounts across an arrow-step (only its `sym` prop
  // changes) — so clicking Generate on one symbol must NOT carry over and
  // silently auto-fire the LLM the moment the user steps to the next one.
  // This is the GATE's actual invariant across a multi-symbol session, not
  // just a single mount.
  it('escalating on one symbol does not carry over to the next stepped-to symbol', async () => {
    calls.length = 0
    global.fetch = vi.fn((url) => {
      calls.push(url)
      const cached = url.includes('cached_only=1')
      return Promise.resolve({
        ok: true,
        json: async () => (cached
          ? { sym: 'X', cached: false, preview_text: '', preview_bullets: [], news: [] }
          : { sym: 'X', cached: true, preview_text: 'Full brief.', preview_bullets: [], news: [] }),
      })
    })

    const { rerender } = render(
      <BriefSection sym="NVDA" row={row} stepping />,
    )
    const btn = await screen.findByRole('button', { name: /generate brief/i })
    fireEvent.click(btn)
    await waitFor(() => expect(calls.some(u => u.includes('NVDA') && !u.includes('cached_only'))).toBe(true))

    calls.length = 0
    rerender(<BriefSection sym="AAPL" row={row} stepping />)
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(calls.every(u => u.includes('cached_only=1'))).toBe(true)
    expect(calls.some(u => u.includes('AAPL') && !u.includes('cached_only'))).toBe(false)
  })
})
