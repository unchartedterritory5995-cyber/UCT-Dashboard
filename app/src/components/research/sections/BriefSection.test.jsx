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

  // Review r1 C1 — THE regression test. Every gate test above passes
  // `stepping` as a constant, which is a state that does not exist at the
  // moment the fetch is issued: `stepping` is `rawSym !== settledSym`, and
  // this component is fed `settledSym`, so by the render where `sym` becomes
  // the new symbol the flag is ALREADY false. A gate that only holds under
  // `stepping={true}` therefore proves nothing about shipped behaviour. This
  // drives the composition as it actually runs — a step arriving with the
  // flag already down — and must still be gated.
  it('GATE: a stepped-to symbol is cached-only even when `stepping` has already gone false', async () => {
    const { rerender } = render(<BriefSection sym="NVDA" row={row} stepping={false} />)
    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0]).toContain('NVDA')
    expect(calls[0]).not.toContain('cached_only')   // click-open: full brief, correct

    calls.length = 0
    // The debounce has ALREADY settled — this is exactly how the shipped
    // shell re-renders the panel on an arrow-step.
    rerender(<BriefSection sym="AAPL" row={row} stepping={false} />)
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(calls.some(u => u.includes('AAPL') && !u.includes('cached_only'))).toBe(false)
    expect(calls.every(u => u.includes('cached_only=1'))).toBe(true)
  })

  // I1: a transport/LLM failure must not be reported as an editorial fact
  // about the company ("not enough source material on this name").
  it('a failed fetch renders a failure state with a retry, not a claim about source material', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down')))
    renderBrief()
    expect(await screen.findByText(/unavailable right now/i)).toBeTruthy()
    const body = document.body.textContent.toLowerCase()
    expect(body).not.toContain('source material on this name')
    expect(screen.getByRole('button', { name: /retry|try again/i })).toBeTruthy()
  })

  it('the backend error payload is treated as a failure, not as an empty brief', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: async () => ({ sym: 'NVDA', error: 'anthropic timeout' }),
    }))
    renderBrief()
    expect(await screen.findByText(/unavailable right now/i)).toBeTruthy()
  })

  // A 200 carrying no content is genuinely "nothing written yet" — the
  // OTHER direction of I1. If both collapsed to one state the fix would be
  // half-done in a way no single-direction test could see.
  it('a 200 with no content still reads as "nothing written yet", not as a failure', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: async () => ({ sym: 'NVDA', cached: true, preview_text: '', preview_bullets: [] }),
    }))
    renderBrief()
    expect(await screen.findByText(/no brief available yet/i)).toBeTruthy()
    expect(screen.queryByText(/unavailable right now/i)).toBeNull()
  })

  // I2: the payload carries no generation timestamp, so the provenance line
  // must not imply one. A wall-clock "updated 5:59 PM" on a 12h-cached,
  // redeploy-persisted brief is a fabricated fact.
  it('the provenance line claims no freshness the payload cannot support', async () => {
    renderBrief()
    const text = (await screen.findByTestId('brief-provenance')).textContent
    expect(text).toMatch(/^AI ·/)
    expect(text.toLowerCase()).not.toContain('updated')
    expect(text).not.toMatch(/\d{1,2}:\d{2}/)          // no clock time
  })

  // M1: flipping `escalated` changes the SWR key, and a key change is itself
  // what triggers the fetch — the old extra `mutate()` fired a second request
  // against the about-to-be-stale key, on a 10/minute endpoint.
  it('Generate brief fires exactly one request', async () => {
    renderBrief({ stepping: true })
    const btn = await screen.findByRole('button', { name: /generate brief/i })
    calls.length = 0
    fireEvent.click(btn)
    await waitFor(() => expect(calls.some(u => !u.includes('cached_only'))).toBe(true))
    expect(calls.filter(u => !u.includes('cached_only')).length).toBe(1)
  })

  // M2: `'   '` is truthy, so a naive `{x && <p>{x}</p>}` renders an empty
  // paragraph; a blank `url` renders `<a href="">`, which re-opens the
  // CURRENT page in a new tab. engine.py defaults news fields to '', so this
  // is a real payload, not a hypothetical one.
  it('blank-but-present fields render as absent, not as empty UI', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({
        sym: 'NVDA', cached: true,
        preview_text: '   ',
        preview_bullets: ['', null, '  ', 'A real bullet'],
        news: [{ headline: '', source: '', url: '', time: '' },
               { headline: 'Real headline', source: 'Reuters', url: 'https://example.com', time: '1h' }],
      }),
    }))
    const { container } = renderBrief()
    expect(await screen.findByText('A real bullet')).toBeTruthy()
    // exactly one bullet survived — the three blanks are gone, not rendered empty
    expect(container.querySelectorAll('li').length).toBe(1)
    // and no link points at the current page
    expect([...container.querySelectorAll('a')].every(a => a.getAttribute('href'))).toBe(true)
    expect(container.querySelector('a[href=""]')).toBeNull()
  })
})
