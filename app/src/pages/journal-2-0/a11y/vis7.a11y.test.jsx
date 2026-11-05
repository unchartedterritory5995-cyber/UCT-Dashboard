// VIS-7 (audit 2026-11-05, visual-report §2.6): the four "serious" axe rules the browser captures found.
//
//   nested-interactive          Chart IQ's head was a div[role=button] holding the "Turn Chart IQ off" button.
//   aria-dialog-name            the phone Insert bottom sheet (ContextPopover's touch branch) had no name.
//   scrollable-region-focusable the phone calendar grid scrolls sideways and had nothing focusable inside.
//   color-contrast              the Browser Capture install link (fixed by VIS-1; railed here).
//
// jsdom lays nothing out, so axe cannot see the last two (both need a measured box or a computed colour). Those
// two are railed structurally, each with the reason, beside the two axe can read.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { axeSurface } from './surface'
import { J2_DIR } from './population'
import ChartIqPanel from '../../../components/chart/chartIq/ChartIqPanel'
import ContextPopover from '../../../components/mobile/ContextPopover'
import { MQ } from '../../../styles/breakpoints'

const LAYERS = { lines: true, levels: true, candles: true, buys: true }
const DATA = { ticker: 'CVLT', asof: '2026-10-30', thesis: 'CVLT is an uptrend. More words.', card: [], watches: [] }

let realMatchMedia = null
function touch(on) {
  realMatchMedia = realMatchMedia || window.matchMedia
  window.matchMedia = vi.fn((q) => ({
    matches: on && (q === MQ.touchDown || q === MQ.phone), media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  }))
}
afterEach(() => { if (realMatchMedia) window.matchMedia = realMatchMedia })

describe('VIS-7: the serious axe rules', () => {
  axeSurface('vis7-chart-iq-head', async () => {
    render(<main><ChartIqPanel data={DATA} layers={LAYERS} onLayer={() => {}} onClose={() => {}} /></main>)
    // non-vacuity: both controls are on screen, and neither holds the other
    const toggle = screen.getByRole('button', { expanded: false })
    const close = screen.getByRole('button', { name: 'Turn Chart IQ off' })
    expect(toggle.contains(close)).toBe(false)
    expect(document.querySelector('[role="button"]')).toBeNull()
  })

  it('Chart IQ: the toggle opens and closes the read, and the close still closes Chart IQ (every click target kept)', () => {
    const onClose = vi.fn()
    render(<ChartIqPanel data={DATA} layers={LAYERS} onLayer={() => {}} onClose={onClose} />)
    fireEvent.click(screen.getByText('Chart IQ'))           // the label, inside the toggle
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument()
    fireEvent.click(screen.getByText('less'))               // the "more/less" word, inside the toggle
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Turn Chart IQ off' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()   // the close did not toggle
  })

  axeSurface('vis7-phone-insert-sheet', async () => {
    touch(true)
    render(<ContextPopover open onClose={() => {}} anchor={{ x: 0, y: 0 }} title="Insert"
      items={[{ label: 'Image', onClick: () => {} }, { label: 'Chart', onClick: () => {} }]} />)
    expect(screen.getByRole('dialog', { name: 'Insert' })).toBeInTheDocument()
  })

  it('a touch ContextPopover with no plain-text title is still a named dialog', () => {
    touch(true)
    render(<ContextPopover open onClose={() => {}} anchor={{ x: 0, y: 0 }}
      items={[{ label: 'Image', onClick: () => {} }]} />)
    expect(screen.getByRole('dialog', { name: 'Actions' })).toBeInTheDocument()
  })

  it('the phone calendar: the SCROLL BOX is a named, focusable region on a phone only; the grid stays plain (review minor 17)', () => {
    const src = readFileSync(join(J2_DIR, 'components/notebook/NoteCalendarView.jsx'), 'utf8')
    const box = src.match(/<div className=\{styles\.gridScroll\}[^\n]*/)
    expect(box, 'the scroll box').not.toBeNull()
    expect(box[0]).toMatch(/phone \? \{ role: 'region', tabIndex: 0, 'aria-label':/)
    const grid = src.match(/<div className=\{styles\.grid\}[^>]*>/)
    expect(grid[0]).toMatch(/role="grid"/)
    expect(grid[0]).not.toMatch(/tabIndex/)
    const css = readFileSync(join(J2_DIR, 'components/notebook/NoteCalendarView.module.css'), 'utf8')
    expect(css).toMatch(/\.gridScroll \{ overflow-x: auto; \}/)
  })

  it('the Browser Capture links paint the theme accent with no dimming parent (axe colour needs layout)', () => {
    const src = readFileSync(join(J2_DIR, 'components/BrowserCaptureCard.jsx'), 'utf8')
    expect(src).toMatch(/const LINK_STYLE = \{ color: 'var\(--accent\)', textDecoration: 'underline' \}/)
    const links = [...src.matchAll(/<a href=\{CAPTURE_INSTALL_URL\}[^>]*>/g)].map((m) => m[0])
    expect(links.length).toBe(2)                              // non-vacuity: both install links
    for (const a of links) expect(a).toMatch(/style=\{LINK_STYLE\}/)
    // the 1.59:1 came from the UA blue under a parent at opacity 0.75: each link's wrapper reads --text-muted, and
    // no opacity sits between the card and either link
    for (const m of src.matchAll(/<div style=\{\{([^}]*)\}\}>\s*(?:Not connected\.|On another computer\?)/g)) {
      expect(m[1]).toMatch(/color: 'var\(--text-muted\)'/)
      expect(m[1]).not.toMatch(/opacity/)
    }
    expect([...src.matchAll(/<div style=\{\{([^}]*)\}\}>\s*(?:Not connected\.|On another computer\?)/g)].length).toBe(2)
  })
})
