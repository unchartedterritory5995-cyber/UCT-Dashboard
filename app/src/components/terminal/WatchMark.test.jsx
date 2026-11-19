// Watchlist marks — the kit's symbol cell (PanelSymbol / PanelTicker) and the mark itself.
//
//     cd app && npx vitest run src/components/terminal/WatchMark.test.jsx --maxWorkers=2
//
// Rails:
//   * a marked name: the star, the words in the button's accessible name and title, the click
//     still loads the name; the "current" style and the mark live together;
//   * a name that is not marked renders byte-for-byte what it rendered before the marks existed;
//   * the mark is a shape with words, never colour alone, and never gold;
//   * it cannot move a column or wrap a row: read from the stylesheets (jsdom computes no layout);
//   * a mark that stands alone (`WatchMark`, for a panel with its own row button) is a named image.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { PanelLinkContext, PanelListContext, PanelSymbol, WatchMark, WatchMarksContext } from '.'
import symbolStyles from './PanelSymbol.module.css'
import markStyles from './WatchMark.module.css'
import { expectNoAxeViolations } from '../../pages/journal-2-0/a11y/axeHarness'

afterEach(cleanup)

const MARKS = new Map([
  ['NVDA', { lists: ['Swing ideas'], flagged: false }],
  ['AMD', { lists: ['Swing ideas', 'Leaders'], flagged: true }],
  ['TSLA', { lists: [], flagged: true }],
])
const run = vi.fn()
const inPanel = (ui, { marks = MARKS, linked = null } = {}) => render(
  <WatchMarksContext.Provider value={marks}>
    <PanelLinkContext.Provider value={linked}>
      <PanelListContext.Provider value={{ run }}>{ui}</PanelListContext.Provider>
    </PanelLinkContext.Provider>
  </WatchMarksContext.Provider>,
)
const HERE = path.join(process.cwd(), 'src', 'components', 'terminal')
const css = (name) => fs.readFileSync(path.join(HERE, name), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
/** The body of the rule whose selector list is exactly `selector`. */
function rule(sheet, selector) {
  const want = selector.replace(/\s+/g, ' ').trim()
  for (const m of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].replace(/\s+/g, ' ').trim() === want) return m[2].replace(/\s+/g, ' ').trim()
  }
  return null
}

describe('PanelSymbol, a name on the member\'s watchlist', () => {
  it('carries the mark, says so in words, and still loads the name', () => {
    inPanel(<table><tbody><tr><td><PanelSymbol sym="nvda" className="sym" /></td></tr></tbody></table>)
    const btn = screen.getByRole('button', { name: 'Load NVDA, on your watchlist' })
    expect(btn.getAttribute('title')).toBe('Load NVDA into the linked panels. On your watchlist: Swing ideas.')
    const mark = within(btn).getByTestId('watch-mark')
    expect(mark.getAttribute('data-watch-mark')).toBe('watchlist')
    // the shape is hidden from assistive tech here: the button's own name already has the words
    expect(mark.querySelector('svg').getAttribute('aria-hidden')).toBe('true')
    expect(btn.textContent).toBe('NVDA')
    fireEvent.click(btn)
    expect(run).toHaveBeenCalledWith('$NVDA')
    fireEvent.click(mark)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('names the lists, and says flagged, where the data has them', () => {
    inPanel(<><PanelSymbol sym="AMD" /><PanelSymbol sym="TSLA" /></>)
    const amd = screen.getByRole('button', { name: 'Load AMD, on your watchlist and flagged' })
    expect(amd.getAttribute('title')).toBe('Load AMD into the linked panels. On your watchlists: Swing ideas, Leaders. Also flagged.')
    const tsla = screen.getByRole('button', { name: 'Load TSLA, on your Flagged list' })
    expect(tsla.getAttribute('title')).toBe('Load TSLA into the linked panels. On your Flagged list.')
    expect(within(tsla).getByTestId('watch-mark').getAttribute('data-watch-mark')).toBe('flagged')
  })

  it('adds ONE class to the cell and nothing else: no wrap, no fold, no width', () => {
    inPanel(<><PanelSymbol sym="NVDA" className="sym" /><PanelSymbol sym="MSFT" className="sym" /></>)
    const marked = screen.getByTestId('panel-symbol-NVDA').className.split(/\s+/).filter(Boolean)
    const plain = screen.getByTestId('panel-symbol-MSFT').className.split(/\s+/).filter(Boolean)
    expect(marked.filter((c) => !plain.includes(c))).toEqual([symbolStyles.marked])
    expect(plain.filter((c) => !marked.includes(c))).toEqual([])
    expect(screen.getByTestId('panel-symbol-NVDA').getAttribute('style')).toBeNull()
    const anchor = screen.getByTestId('watch-mark')
    expect(anchor.className.split(/\s+/).sort()).toEqual([markStyles.mark, symbolStyles.cellMark].sort())
    expect(anchor.getAttribute('style')).toBeNull()
  })

  it('a name that is not marked renders exactly what it rendered before', () => {
    const tree = <table><tbody><tr><td><PanelSymbol sym="MSFT" className="sym" /></td><th><PanelSymbol sym="msft"><span>MSFT</span></PanelSymbol></th></tr></tbody></table>
    const before = render(<PanelListContext.Provider value={{ run }}>{tree}</PanelListContext.Provider>).container.innerHTML
    cleanup()
    const after = inPanel(tree).container.innerHTML
    expect(after).toBe(before)
    expect(before).toContain('aria-label="Load MSFT"')
    expect(before).toContain('title="Load MSFT into the linked panels"')
    expect(before).not.toContain('watch-mark')
    cleanup()
    // an empty set, and no provider at all, are the same answer
    expect(inPanel(tree, { marks: new Map() }).container.innerHTML).toBe(before)
  })

  it('keeps a custom label (the PanelTicker shape) and puts the mark after it', () => {
    inPanel(<PanelSymbol sym="NVDA"><span data-testid="label">NVDA</span></PanelSymbol>)
    const btn = screen.getByRole('button', { name: 'Load NVDA, on your watchlist' })
    expect([...btn.children].map((c) => c.getAttribute('data-testid'))).toEqual(['label', 'watch-mark'])
  })

  it('the name the linked panels follow keeps its own style beside the mark', () => {
    inPanel(<PanelSymbol sym="NVDA" />, { linked: 'NVDA' })
    const btn = screen.getByTestId('panel-symbol-NVDA')
    expect(btn.getAttribute('aria-current')).toBe('true')
    expect(btn.className).toContain(symbolStyles.current)
    expect(btn.className).toContain(symbolStyles.marked)
  })

  it('where the name cannot be loaded (no run wire) it is plain text with a named mark', () => {
    render(<WatchMarksContext.Provider value={MARKS}><PanelSymbol sym="NVDA" /><PanelSymbol sym="MSFT" /></WatchMarksContext.Provider>)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('img', { name: 'On your watchlist: Swing ideas' })).toBeTruthy()
    expect(screen.getAllByTestId('watch-mark')).toHaveLength(1)
  })

  it('outside the Terminal (no provider) nothing changes', () => {
    render(<PanelSymbol sym="NVDA" />)
    expect(screen.queryByTestId('watch-mark')).toBeNull()
    expect(screen.getByText('NVDA')).toBeTruthy()
  })
})

describe('WatchMark, the mark on its own', () => {
  it('is a named image after a marked name and nothing after any other', () => {
    inPanel(
      <>
        <button type="button" title="Load NVDA into the linked panels"><span>1</span><span>NVDA</span><WatchMark sym="nvda" overlay /></button>
        <button type="button" title="Load MSFT into the linked panels"><span>2</span><span>MSFT</span><WatchMark sym="MSFT" overlay /></button>
        <span data-testid="inline"><WatchMark sym="TSLA" /></span>
      </>,
    )
    expect(screen.getAllByTestId('watch-mark')).toHaveLength(2)
    const nvda = screen.getByRole('button', { name: /NVDA/ })
    expect(within(nvda).getByRole('img', { name: 'On your watchlist: Swing ideas' })).toBeTruthy()
    expect(within(nvda).getByTestId('watch-mark').className.split(/\s+/).sort()).toEqual([markStyles.mark, markStyles.overlay].sort())
    expect(screen.getByRole('button', { name: /MSFT/ }).querySelector('svg')).toBeNull()
    expect(within(screen.getByTestId('inline')).getByTestId('watch-mark').className).toBe(markStyles.mark)
    expect(within(screen.getByTestId('inline')).getByRole('img', { name: 'On your Flagged list' })).toBeTruthy()
  })

  it('renders nothing outside the Terminal', () => {
    const { container } = render(<WatchMark sym="NVDA" overlay />)
    expect(container.innerHTML).toBe('')
  })
})

describe('the mark is a shape with words, in the text colour', () => {
  it('draws the filled star in the current colour: no gold gradient, no glow', () => {
    inPanel(<PanelSymbol sym="NVDA" />)
    const svg = screen.getByTestId('watch-mark').querySelector('svg')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.querySelector('linearGradient')).toBeNull()
    expect(svg.getAttribute('style') || '').not.toContain('drop-shadow')
    expect(svg.querySelector('path').getAttribute('fill')).toBe('currentColor')
  })

  it('the stylesheet colours it with a text token: no gold, no literal colour', () => {
    const sheet = css('WatchMark.module.css')
    expect(rule(sheet, '.mark')).toContain('color: var(--text);')
    expect(sheet).not.toMatch(/gold|accent/i)
    expect(sheet).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
    expect(sheet).not.toMatch(/cursor\s*:/)
    expect(sheet).not.toMatch(/animation|transition/)
  })

  it('passes axe as cells of a named table', async () => {
    const { container } = inPanel(
      <table aria-label="Names">
        <thead><tr><th scope="col">Symbol</th><th scope="col">Last</th></tr></thead>
        <tbody>
          {['NVDA', 'AMD', 'TSLA', 'MSFT'].map((s) => <tr key={s}><td><PanelSymbol sym={s} /></td><td>1.00</td></tr>)}
          <tr><td><button type="button"><span>5</span><span>NVDA</span><WatchMark sym="NVDA" overlay /></button></td><td>2.00</td></tr>
        </tbody>
      </table>,
    )
    await expectNoAxeViolations(container)
  }, 20_000)
})

describe('the mark cannot move a column or wrap a row (read from the stylesheets)', () => {
  const mark = css('WatchMark.module.css')
  const symbol = css('PanelSymbol.module.css')

  it('the star is placed inside an anchor, so the anchor\'s width is the only room it takes', () => {
    const anchor = rule(mark, '.mark')
    expect(anchor).toContain('position: relative;')
    expect(anchor).toContain('display: inline-block;')
    expect(anchor).toContain('width: 13px;')
    expect(anchor).toContain('height: 10px;')
    const star = rule(mark, '.mark svg')
    expect(star).toContain('position: absolute;')
    expect(star).toContain('left: 3px;')
  })

  it('as an overlay the anchor is 0 wide: a marked name is as wide as an unmarked one', () => {
    expect(rule(mark, '.overlay')).toBe('width: 0;')
  })

  it('the kit cell is an overlay as the last thing in a table cell, and never splits from its name', () => {
    expect(rule(symbol, 'td > .marked:last-child .cellMark, th > .marked:last-child .cellMark')).toBe('width: 0;')
    expect(rule(symbol, '.marked')).toBe('white-space: nowrap;')
  })

  it('neither sheet changes the cell\'s own box: no padding, margin, min-width or display on the marked button', () => {
    expect(rule(symbol, '.marked')).not.toMatch(/padding|margin|min-width|display|font/)
    expect(mark).not.toMatch(/margin|padding|min-width/)
  })
})
