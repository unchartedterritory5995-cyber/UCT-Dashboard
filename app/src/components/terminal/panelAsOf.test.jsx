// TERM-019 as-of dates — `panelAsOf` turns a server's own as-of into the panel header report, and
// reports the source alone (the header's "undated") when the server sent none. Never "now".
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { panelAsOf } from './terminalPanel'
import { PanelProvenance } from '../../pages/terminal/TerminalShell'

describe('panelAsOf', () => {
  it('an ISO instant becomes observedAt plus an ET age clause', () => {
    const r = panelAsOf('UCT Model Book', '2026-10-06T19:42:00+00:00')
    expect(r.source).toBe('UCT Model Book')
    expect(r.observedAt).toBe('2026-10-06T19:42:00.000Z')
    expect(r.age).toEqual({ asOfDate: 'Oct 6, 3:42 PM ET' })
  })

  it('epoch SECONDS are read as seconds, not milliseconds', () => {
    const r = panelAsOf('SEC EDGAR', 1790000000)
    expect(r.observedAt).toBe(new Date(1790000000 * 1000).toISOString())
    expect(r.observedAt.startsWith('2026-')).toBe(true)
  })

  it('a calendar date is rendered as given, never parsed into a time it never had', () => {
    const r = panelAsOf('UCT options log', '2026-10-05', { dataClass: 'end_of_day' })
    expect(r.observedAt).toBeUndefined()
    expect(r.age).toEqual({ dataClass: 'end_of_day', asOfDate: '2026-10-05' })
  })

  it.each([null, undefined, '', 'not a time'])('no usable as-of (%s) reports the source alone', (at) => {
    expect(panelAsOf('Massive', at)).toEqual({ source: 'Massive' })
  })

  it('the header shows the age when an as-of was given, and "undated" when it was not', () => {
    render(<PanelProvenance report={panelAsOf('UCT Model Book', '2026-10-06T19:42:00Z')} index={1} />)
    const dated = screen.getByTestId('terminal-panel-freshness-1').textContent
    expect(dated).toContain('as of Oct 6, 3:42 PM ET')
    expect(dated).not.toContain('undated')
    render(<PanelProvenance report={panelAsOf('UCT Model Book', null)} index={2} />)
    expect(screen.getByTestId('terminal-panel-freshness-2').textContent).toContain('undated')
  })
})
