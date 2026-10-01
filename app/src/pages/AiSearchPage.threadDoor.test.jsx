/* Build D (2026-09-30) — the `A:<id>` address door: /ai-search?thread=<id>
 * reopens that conversation on arrival through the page's own openThread. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('./charts/widgets/AiSearchWidget', () => ({
  default: ({ initialThread }) => (
    <div data-testid="widget">{initialThread ? initialThread.map((t) => t.q).join('|') : 'fresh'}</div>
  ),
  AIS_HANDOFF_KEY: 'uct.aisearch.handoff',
  AnswerBody: () => null,
}))

import AiSearchPage from './AiSearchPage'

function serve(turns) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (u) => {
    calls.push(String(u))
    if (String(u).includes('/api/ai-search/threads/')) {
      return { ok: !!turns, json: async () => (turns ? { turns } : {}) }
    }
    return { ok: true, json: async () => ({ threads: [] }) }
  }))
  return calls
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('AI Search — the ?thread= door', () => {
  it('reopens the named conversation on arrival', async () => {
    const calls = serve([{ q: 'Is NVDA extended?', a: 'Yes.' }, { q: 'And AMD?', a: 'Less so.' }])
    render(<MemoryRouter initialEntries={['/ai-search?thread=t-9']}><AiSearchPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('widget')).toHaveTextContent('Is NVDA extended?|And AMD?'))
    expect(calls).toContain('/api/ai-search/threads/t-9')
  })

  it('without ?thread= the page opens fresh and asks for no conversation', async () => {
    const calls = serve(null)
    render(<MemoryRouter initialEntries={['/ai-search']}><AiSearchPage /></MemoryRouter>)
    expect(screen.getByTestId('widget')).toHaveTextContent('fresh')
    await new Promise((r) => setTimeout(r, 20))
    expect(calls.some((u) => u.includes('/api/ai-search/threads/'))).toBe(false)
  })

  it('an unknown or foreign id leaves the page fresh', async () => {
    serve(null)
    render(<MemoryRouter initialEntries={['/ai-search?thread=nope']}><AiSearchPage /></MemoryRouter>)
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.getByTestId('widget')).toHaveTextContent('fresh')
  })
})
