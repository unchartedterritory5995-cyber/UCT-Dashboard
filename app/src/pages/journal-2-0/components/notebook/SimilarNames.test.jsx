// Wave 13 lane 13J -- find more like this (SimilarNames.jsx).
//
//   * The reasons are the server's field deltas, worded: "RS 94 vs 92", "depth 11% vs 12%",
//     a shared confirmed pattern by name; the closest fields lead.
//   * A chart with no run yet says so (matched tonight) -- the page never asks for a scan.
//   * DARK: with the gate off it renders nothing and fetches nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import SimilarNames, { reasonText, topReasons, setupLabel, similarUrl } from './SimilarNames'
import { Providers } from '../../a11y/fixtures'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

const F = (field, label, unit, template, candidate, d, same = null) =>
  ({ field, label, unit, template, candidate, delta: same === null && typeof candidate === 'number' ? candidate - template : null, same, d })

const respond = (status, body) => Promise.resolve({ ok: status < 400, status, headers: { get: () => null }, json: () => Promise.resolve(body) })
function stub(body) {
  const calls = []
  global.fetch = vi.fn((url) => { calls.push(String(url)); return respond(200, body) })
  return calls
}

describe('SimilarNames', () => {
  beforeEach(() => __resetNotebookFlags())
  afterEach(() => __resetNotebookFlags())

  it('words a reason from the field deltas', () => {
    expect(reasonText(F('rs_rank', 'RS', '', 92, 94, 0.08))).toBe('RS 94 vs 92')
    expect(reasonText(F('pullback_depth_pct', 'depth', '%', 12, 11.5, 0.05))).toBe('depth 11.5% vs 12%')
    expect(reasonText(F('ma_stack', 'MA stack', '', 'full-bull', 'full-bull', 0, true))).toBe('MA stack full-bull')
    expect(reasonText(F('ma_stack', 'MA stack', '', 'full-bull', 'partial', 1, false))).toBe('MA stack partial vs full-bull')
    expect(reasonText(F('ema_stack_intact', 'EMA stack', '', true, false, 1, false))).toBe('EMA stack broken vs intact')
    expect(reasonText({ label: 'RS', unit: '', template: 92, candidate: null })).toBe('RS: not available for this name')
    expect([setupLabel('vcp'), setupLabel('flat_base'), setupLabel('cup_handle')]).toEqual(['VCP', 'Flat base', 'Cup handle'])
    expect(similarUrl('n 1', 'chart|2026#2')).toBe('/api/j2/similar-names/n%201/chart%7C2026%232')
  })

  it('the closest fields lead, ties keep the server order, missing fields never lead', () => {
    const fields = [F('a', 'A', '', 1, 2, 0.5), F('b', 'B', '', 1, 1, 0), F('c', 'C', '', 1, null, null),
      F('d', 'D', '', 1, 1.1, 0), F('e', 'E', '', 1, 3, 0.9)]
    expect(topReasons({ fields }).map((r) => r.field)).toEqual(['b', 'd', 'a'])
  })

  it('renders the matches with their reasons', async () => {
    latchNotebookFlags({ notebook_find_similar_enabled: true })
    const calls = stub({
      template: { noteId: 'n1', embedKey: 'e-1', symbol: 'NVDA', setupTag: 'VCP' }, asOf: '2026-10-01',
      status: 'ready', matches: [{ rank: 1, symbol: 'CRWD', score: 88, reasons: {
        fields: [F('rs_rank', 'RS', '', 92, 94, 0.08), F('pullback_depth_pct', 'depth', '%', 12, 11, 0.1),
          F('pole_pct', 'prior run', '%', 60, 90, 0.6)],
        patterns: { shared: ['vcp'], templateOnly: [], missing: null } } }],
    })
    render(<Providers><SimilarNames noteId="n1" embedKey="e-1" /></Providers>)
    expect(await screen.findByText('RS 94 vs 92 · depth 11% vs 12% · prior run 90% vs 60% · VCP')).toBeTruthy()
    expect(screen.getByText('Names like NVDA (VCP)')).toBeTruthy()
    expect(screen.getByText('88 match')).toBeTruthy()
    expect(calls).toEqual(['/api/j2/similar-names/n1/e-1'])
  })

  it('a chart with no run yet says it is matched tonight', async () => {
    latchNotebookFlags({ notebook_find_similar_enabled: true })
    stub({ template: { noteId: 'n1', embedKey: 'e-1', symbol: 'NVDA', setupTag: 'VCP' }, asOf: null, status: 'pending', matches: [] })
    render(<Providers><SimilarNames noteId="n1" embedKey="e-1" /></Providers>)
    expect(await screen.findByText(/this one is matched tonight/)).toBeTruthy()
  })

  it('gate OFF: renders nothing and fetches nothing', async () => {
    const calls = stub({})
    const { container } = render(<Providers><SimilarNames noteId="n1" embedKey="e-1" /></Providers>)
    await new Promise((r) => setTimeout(r, 20))
    expect(container.querySelector('[data-similar-names]')).toBeNull()
    expect(calls).toEqual([])
  })
})
