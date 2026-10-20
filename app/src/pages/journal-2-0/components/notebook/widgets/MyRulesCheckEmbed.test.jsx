// My rules check (Task 13): rendered from the frozen params; the headline is the top-level counts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import MyRulesCheckEmbed from './MyRulesCheckEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const PAYLOAD = {
  asOf: '2026-10-17T21:00:00Z',
  source: 'manual',
  range: { from: '2026-10-13', to: '2026-10-17' },
  kept: 7,
  total: 10,
  rules: [{ rule: 'Wait for the open', kept: 4, total: 5 }, { rule: 'Honor the stop', kept: 3, total: 4 }],
}
const EMPTY = { asOf: PAYLOAD.asOf, source: 'manual', range: PAYLOAD.range, kept: null, total: null, rules: [], empty: 'No rule checks in this range yet.' }
const attrsOf = (p = PAYLOAD) => widgetEmbedNode('myRulesCheck', p).attrs

let fetchSpy
beforeEach(() => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('MyRulesCheckEmbed', () => {
  it('headline is the top-level counts, rows are a breakdown, and nothing is fetched', () => {
    render(<MyRulesCheckEmbed attrs={attrsOf()} />)
    expect(screen.getByText('Kept 7 of 10 rule checks')).toBeInTheDocument()
    expect(screen.getByText('Wait for the open')).toBeInTheDocument()
    expect(screen.getByText('4 of 5')).toBeInTheDocument()
    expect(screen.getByText('Oct 13, 2026 to Oct 17, 2026')).toBeInTheDocument()
    expect(screen.getByText('Rows count each rule only for trades made after it existed.')).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('headline stays authoritative when the rows do not add up to it', () => {
    render(<MyRulesCheckEmbed attrs={attrsOf({ ...PAYLOAD, kept: 9, total: 12 })} />)
    expect(screen.getByText('Kept 9 of 12 rule checks')).toBeInTheDocument()
  })

  it('null counts show the empty sentence, never a 0 of 0', () => {
    render(<MyRulesCheckEmbed attrs={attrsOf(EMPTY)} />)
    expect(screen.getByText('No rule checks in this range yet.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Kept 0 of 0/)
  })

  it('null counts with no sentence still show a plain empty line', () => {
    render(<MyRulesCheckEmbed attrs={attrsOf({ ...EMPTY, empty: undefined })} />)
    expect(screen.queryByText(/^Kept /)).toBeNull()
    expect(screen.getByText('No rule checks in this range yet.')).toBeInTheDocument()
  })
})
