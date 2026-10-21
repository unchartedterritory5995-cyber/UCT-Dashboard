// My screen today (Task 20, wave 6): the hits and the four-count coverage line, in CoverageLine's own words.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import MyScreenTodayEmbed from './MyScreenTodayEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const COVER = { evaluated: 3742, answered: 3699, dropped: 2, notComputable: 41, withheld: 5 }
const PAYLOAD = {
  asOf: '2026-10-20T14:05:00Z', source: 'market', definitionId: 'u:abc123', name: 'Tight flags', session: '2026-10-19',
  hits: [{ symbol: 'NVDA', price: 224.1, changePct: 3.0 }, { symbol: 'AMD', price: null, changePct: null }],
  coverage: COVER, truncated: true,
}
const attrsOf = (p = PAYLOAD) => widgetEmbedNode('myScreenToday', p).attrs

let fetchSpy
beforeEach(() => { fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy) })
afterEach(() => vi.unstubAllGlobals())

describe('MyScreenTodayEmbed', () => {
  it('renders the hits and the four counts, never collapsed, withheld beside them, no fetch', () => {
    render(<MyScreenTodayEmbed attrs={attrsOf()} />)
    expect(screen.getByText('Tight flags')).toBeInTheDocument()
    expect(screen.getByText('NVDA')).toBeInTheDocument()
    expect(screen.getByText('$224.10')).toBeInTheDocument()
    expect(screen.getByTestId('coverage-line').textContent)
      .toBe('3,742 evaluated·3,699 answered·2 dropped·41 not computable')
    expect(screen.getByTestId('coverage-withheld').textContent).toBe('5 more were not looked at on your plan.')
    expect(screen.getByText('Swept session of Oct 19, 2026. More hits than shown here.')).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('answered 0 with not-computable says it is a gap in what we hold, not a quiet market, and no "no hits" line', () => {
    render(<MyScreenTodayEmbed attrs={attrsOf({
      ...PAYLOAD, hits: [], truncated: undefined,
      coverage: { evaluated: 2615, answered: 0, dropped: 0, notComputable: 2615, withheld: 0 },
    })} />)
    expect(screen.getByTestId('coverage-nodata').textContent)
      .toContain('that is a gap in what we hold, not a quiet market.')
    expect(screen.queryByText('No hits in the last swept session.')).toBeNull()
  })

  it('a quiet session (all answered, no hits) says no hits, and no gap sentence', () => {
    render(<MyScreenTodayEmbed attrs={attrsOf({
      ...PAYLOAD, hits: [], coverage: { evaluated: 10, answered: 10, dropped: 0, notComputable: 0, withheld: 0 },
    })} />)
    expect(screen.getByText('No hits in the last swept session.')).toBeInTheDocument()
    expect(screen.queryByTestId('coverage-nodata')).toBeNull()
  })

  it('a screen that is not ready shows the server sentence and no counts', () => {
    render(<MyScreenTodayEmbed attrs={attrsOf({
      asOf: PAYLOAD.asOf, source: 'market', name: 'Tight flags', hits: [], coverage: null,
      empty: "This screen's results are not ready yet.",
    })} />)
    expect(screen.getByText("This screen's results are not ready yet.")).toBeInTheDocument()
    expect(screen.queryByTestId('coverage-line')).toBeNull()
  })

  it('an unknown price is n/a with a reason, and the request key is never drawn', () => {
    render(<MyScreenTodayEmbed attrs={attrsOf()} />)
    const nas = screen.getAllByText('n/a')
    expect(nas).toHaveLength(2)
    for (const n of nas) expect(n.getAttribute('title')).toMatch(/\w/)
    expect(document.body.textContent).not.toContain('u:abc123')
  })
})
