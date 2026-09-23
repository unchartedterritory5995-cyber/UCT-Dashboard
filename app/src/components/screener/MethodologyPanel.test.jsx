// MethodologyPanel — Packet O CP1 (signed 2026-09-22, fingerprint fd57fe079).
//
// Same fetcher-injection idiom as StructureProvenance.test.jsx in this same
// directory: a failed fetch must report an alert, never an empty panel; every
// caveat must actually reach the DOM, never be silently dropped.
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MethodologyPanel from './MethodologyPanel'

const okFetch = (body) => vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) }))

const COMPOSITE = {
  column: 'uct_composite', label: 'UCT Composite',
  one_line: 'A weighted 1-99 blend of six ratings, momentum-first.',
  scale: '1-99, higher is stronger',
  components: [{ key: 'eps', label: 'EPS rating', measures: 'x', weight: 0.3, share_pct: 30.0 }],
  bands: {},
  caveat: 'The blend is renormalised over the components a company actually has.',
  not_claimed: [
    'It is not a price target, a forecast, or a recommendation.',
    'It is not comparable across companies whose basis differs.',
  ],
}
const RS_RANK = {
  column: 'rs_rank', label: 'RS Rank',
  one_line: 'Price performance rank against the whole universe, 1-99.',
  scale: '1-99, higher is stronger',
  how: 'Ranked against every other symbol in the nightly universe.',
  caveat: 'The universe is our own coverage list, not the whole market.',
}
const payload = (methods) => ({ methods, as_of_note: 'Recomputed nightly from the 03:00 ET build.' })

describe('MethodologyPanel', () => {
  it('renders every published method the route returns', async () => {
    render(<MethodologyPanel fetcher={okFetch(payload([COMPOSITE, RS_RANK]))} />)
    await waitFor(() => expect(screen.getByText('UCT Composite')).toBeInTheDocument())
    expect(screen.getByText('RS Rank')).toBeInTheDocument()
  })

  it('⛔ the caveat is a FIELD, not a footnote -- it must reach the DOM for every entry', async () => {
    render(<MethodologyPanel fetcher={okFetch(payload([COMPOSITE, RS_RANK]))} />)
    await waitFor(() => expect(screen.getByText('UCT Composite')).toBeInTheDocument())
    expect(screen.getByText(/renormalised over the components/)).toBeInTheDocument()
    expect(screen.getByText(/our own coverage list/)).toBeInTheDocument()
  })

  it("renders the composite's not_claimed list explicitly", async () => {
    render(<MethodologyPanel fetcher={okFetch(payload([COMPOSITE]))} />)
    await waitFor(() => expect(screen.getByText('UCT Composite')).toBeInTheDocument())
    expect(screen.getByText(/not a price target/)).toBeInTheDocument()
    expect(screen.getByText(/not comparable across companies/)).toBeInTheDocument()
  })

  it('renders the composite weight breakdown', async () => {
    render(<MethodologyPanel fetcher={okFetch(payload([COMPOSITE]))} />)
    await waitFor(() => expect(screen.getByText('EPS rating')).toBeInTheDocument())
    expect(screen.getByText('30%')).toBeInTheDocument()
  })

  it('⛔ reports a failed fetch instead of rendering an EMPTY panel', async () => {
    const bad = vi.fn(() => Promise.resolve({ ok: false, status: 503 }))
    render(<MethodologyPanel fetcher={bad} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/503/)
  })

  it('shows a loading state before the first response', () => {
    render(<MethodologyPanel fetcher={vi.fn(() => new Promise(() => {}))} />)
    expect(screen.getByText(/Loading methodology/i)).toBeInTheDocument()
  })

  it('requests the methodology route and nothing else', async () => {
    const f = okFetch(payload([RS_RANK]))
    render(<MethodologyPanel fetcher={f} />)
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    expect(f).toHaveBeenCalledWith('/api/screener/methodology')
  })
})
