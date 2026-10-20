// My P&L and stats (Task 7): rendered from the frozen params; See it now refreshes in place.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import MyPnlStatsEmbed from './MyPnlStatsEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const PAYLOAD = {
  asOf: '2026-10-17T21:00:00Z',
  source: 'broker',
  range: { from: '2026-10-13', to: '2026-10-17' },
  netPnl: 2840,
  winRate: 0.58,
  avgR: 0.6,
  tradeCount: 12,
  equity: [['2026-10-13', 100], ['2026-10-14', 900], ['2026-10-15', 600], ['2026-10-17', 2840]],
}
const EMPTY = {
  asOf: '2026-10-17T21:00:00Z', source: 'manual', range: { from: '2026-10-13', to: '2026-10-17' },
  netPnl: null, winRate: null, avgR: null, tradeCount: 0, equity: [], empty: 'No closed trades in this range yet.',
}
const attrsOf = (p = PAYLOAD) => widgetEmbedNode('myPnlStats', p).attrs

let fetchSpy
beforeEach(() => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ...PAYLOAD, asOf: '2026-10-20T13:00:00Z', netPnl: 3100 }) }))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('MyPnlStatsEmbed', () => {
  it('renders_from_params_without_fetch', () => {
    const { container } = render(<MyPnlStatsEmbed attrs={attrsOf()} />)
    expect(screen.getByText('+$2,840.00')).toBeInTheDocument()
    expect(screen.getByText('58%')).toBeInTheDocument()
    expect(screen.getByText('+0.6R')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Oct 13, 2026 to Oct 17, 2026')).toBeInTheDocument()
    expect(screen.getByText('Source: your linked broker')).toBeInTheDocument()
    // The equity line is an inline SVG polyline, one point per equity entry.
    const line = container.querySelector('svg polyline')
    expect(line).not.toBeNull()
    expect(line.getAttribute('points').trim().split(/\s+/)).toHaveLength(4)
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('an empty range renders the empty sentence, and no $0', () => {
    render(<MyPnlStatsEmbed attrs={attrsOf(EMPTY)} />)
    expect(screen.getByText('No closed trades in this range yet.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\$0(\.00)?\b/)
  })

  it('a null figure is n/a with a reason in its title', () => {
    render(<MyPnlStatsEmbed attrs={attrsOf({ ...PAYLOAD, avgR: null })} />)
    const na = screen.getByText('n/a')
    expect(na.getAttribute('title')).toMatch(/\w/)
  })

  it('is Only you, and See it now writes the refreshed params with the share switch kept', async () => {
    const onUpdateParams = vi.fn()
    const attrs = attrsOf()
    attrs.params = { ...attrs.params, share: true }
    render(<MyPnlStatsEmbed attrs={attrs} editable onUpdateParams={onUpdateParams} />)
    expect(screen.queryByText('Only you')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'See it now' })) })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/j2/notebook-widgets/myPnlStats?from=2026-10-13&to=2026-10-17')
    expect(onUpdateParams).toHaveBeenCalledTimes(1)
    expect(onUpdateParams.mock.calls[0][0]).toMatchObject({ netPnl: 3100, asOf: '2026-10-20T13:00:00Z', share: true })
  })

  it('the share switch writes share and nothing else changes', () => {
    const onUpdateParams = vi.fn()
    render(<MyPnlStatsEmbed attrs={attrsOf()} editable onUpdateParams={onUpdateParams} />)
    expect(screen.getByText('Only you')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Show on shared pages' }))
    expect(onUpdateParams).toHaveBeenCalledTimes(1)
    expect(onUpdateParams.mock.calls[0][0]).toMatchObject({ share: true, netPnl: 2840 })
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  // Fix round 1: the privacy race. The member switches share OFF while See it now is in flight; the
  // refresh must land with share false, never the click-time true.
  it('a share switched off during a refresh stays off when the refresh lands', async () => {
    let resolveFetch
    fetchSpy.mockImplementationOnce(() => new Promise((r) => { resolveFetch = r }))
    const stored = { params: null }
    function Host() {
      const [attrs, setAttrs] = useState(() => {
        const a = attrsOf()
        return { ...a, params: { ...a.params, share: true } }
      })
      stored.params = attrs.params
      return <MyPnlStatsEmbed attrs={attrs} editable onUpdateParams={(next) => setAttrs((a) => ({ ...a, params: next }))} />
    }
    render(<Host />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'See it now' })) })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('switch', { name: 'Show on shared pages' }))
    expect(stored.params.share).toBe(false)
    await act(async () => {
      resolveFetch({ ok: true, status: 200, json: async () => ({ ...PAYLOAD, asOf: '2026-10-20T13:00:00Z', netPnl: 3100 }) })
    })
    expect(stored.params.netPnl).toBe(3100)
    expect(stored.params.share).toBe(false)
  })

  it('a refresh that lands after the note turned read-only writes nothing', async () => {
    let resolveFetch
    fetchSpy.mockImplementationOnce(() => new Promise((r) => { resolveFetch = r }))
    const onUpdateParams = vi.fn()
    const { rerender } = render(<MyPnlStatsEmbed attrs={attrsOf()} editable onUpdateParams={onUpdateParams} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'See it now' })) })
    rerender(<MyPnlStatsEmbed attrs={attrsOf()} editable={false} onUpdateParams={onUpdateParams} />)
    await act(async () => {
      resolveFetch({ ok: true, status: 200, json: async () => ({ ...PAYLOAD, asOf: '2026-10-20T13:00:00Z' }) })
    })
    expect(onUpdateParams).not.toHaveBeenCalled()
  })
})
