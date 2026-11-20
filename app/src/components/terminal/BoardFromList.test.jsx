// The shared scan-to-board control: nothing outside a terminal panel, and inside one it hands the
// shell exactly the list it was given, as the function the member picked.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { BoardFromList, PanelListContext } from './index'

afterEach(cleanup)

const CODES = [{ code: 'GP', label: 'Price chart' }, { code: 'DES', label: 'Description / overview' }]
const withShell = (api, ui) => render(<PanelListContext.Provider value={api}>{ui}</PanelListContext.Provider>)

describe('BoardFromList', () => {
  it('renders nothing outside a terminal panel (the screener page, the /charts widget)', () => {
    const { container } = render(<BoardFromList syms={['NVDA']} label="screener results" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the list as the picked function, and says how many of how many', () => {
    const openBoard = vi.fn()
    withShell({ openBoard, codes: CODES, pageSize: 4 },
      <BoardFromList syms={['A', 'B', 'C', 'D', 'E', 'F']} label="MOST gainers" />)
    const btn = screen.getByTestId('terminal-board-from-list-open')
    expect(btn).toHaveTextContent('Open 4 of 6')
    expect(btn).toHaveAccessibleName(/MOST gainers as a board of GP: 4 of 6 names, 4 panels at a time/)
    fireEvent.change(screen.getByTestId('terminal-board-from-list-code'), { target: { value: 'DES' } })
    fireEvent.click(btn)
    expect(openBoard).toHaveBeenCalledWith({ code: 'DES', syms: ['A', 'B', 'C', 'D', 'E', 'F'], label: 'MOST gainers', total: null })
  })

  it('an empty list is a disabled button that says so, never a board of nothing', () => {
    const openBoard = vi.fn()
    withShell({ openBoard, codes: CODES, pageSize: 4 }, <BoardFromList syms={[]} label="x" />)
    const btn = screen.getByTestId('terminal-board-from-list-open')
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Nothing to open')
  })

  it('no usable function for this member: no control', () => {
    const { container } = withShell({ openBoard: vi.fn(), codes: [] }, <BoardFromList syms={['A']} label="x" />)
    expect(container).toBeEmptyDOMElement()
  })
})

// 2026-11-20, a 340 / 360 / 390px sweep of every Terminal command: the picker is as wide as its
// longest option ("DES · Description / overview"), and in the catalysts-history card it ran 49px
// past the card's right edge on a 390px phone (99px at 340px), cut off with no way to scroll to it.
// jsdom computes no layout, so this reads the two stylesheets.
describe('BoardFromList is never wider than the row it sits in', () => {
  const sheet = (rel) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8')
    .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = (css, selector) => {
    const at = css.indexOf(`\n${selector} {`)
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at))
  }

  it('the control and its picker may shrink, and neither may pass 100% of its row', () => {
    const css = `\n${sheet('components/terminal/BoardFromList.module.css')}`
    for (const selector of ['.wrap', '.select']) {
      expect([selector, /min-width:\s*0;/.test(rule(css, selector))]).toEqual([selector, true])
      expect([selector, /max-width:\s*100%;/.test(rule(css, selector))]).toEqual([selector, true])
    }
    expect(rule(css, '.wrap')).toMatch(/flex-wrap:\s*wrap;/)
  })

  it('CATH: the card header wraps, so the control drops under the title instead of squeezing it', () => {
    const css = `\n${sheet('pages/CatalystsHistory.module.css')}`
    const head = rule(css, '.tileHeader')
    expect(head).toMatch(/display:\s*flex;/)
    expect(head).toMatch(/flex-wrap:\s*wrap;/)
    expect(head).toMatch(/gap:\s*var\(--space-xs\) var\(--space-sm\);/)
    const jsx = fs.readFileSync(path.join(process.cwd(), 'src', 'pages', 'CatalystsHistory.jsx'), 'utf8')
    expect(jsx).toMatch(/className=\{styles\.tileHeader\}>[\s\S]{0,900}<BoardFromList /)
  })
})
