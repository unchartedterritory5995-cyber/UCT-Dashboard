// Share a panel: the button in the panel frame and its menu.
//   * a real menu button with a name; the menu is the app's own (arrow keys, Escape, focus back
//     on the button), and a bottom sheet with plain buttons on a phone or tablet;
//   * the button is there only while the panel shows a list, and comes and goes with it;
//   * nothing is loaded until the menu is opened;
//   * each item acts on the panel body as it is at that moment and ends in ONE notice;
//   * the items follow the decision: a class with no file export shows no file items;
//   * a load that fails says so and is tried again on the next open; axe finds nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react'
import { useRef } from 'react'

const touch = { on: false }
vi.mock('../../../hooks/useBreakpoint', () => ({ useIsTouch: () => touch.on, useIsPhone: () => touch.on }))
// The lazy module, stood in for: `load` is the seam the component takes its import through.
const lib = { fail: false, sharePanel: vi.fn(), warmShare: vi.fn(), loads: 0 }
const load = () => {
  lib.loads += 1
  return lib.fail ? Promise.reject(new Error('chunk failed')) : Promise.resolve({ sharePanel: lib.sharePanel, warmShare: lib.warmShare })
}

import PanelShare, { holdsList } from './PanelShare'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const META = { code: 'PERF', command: 'PERF', label: 'My trading stats (from your Journal)', report: { source: 'Your journal' } }
const ALL = { offered: true, image: true, file: true }
const TABLE = '<table><thead><tr><th>Setup</th><th>Trades</th></tr></thead><tbody><tr><td>Flag</td><td>12</td></tr></tbody></table>'

function Frame({ decision = ALL, html = TABLE, onNotice }) {
  const bodyRef = useRef(null)
  return (
    <main>
      <header><PanelShare index={0} decision={decision} bodyRef={bodyRef} meta={META} onNotice={onNotice} className="act" load={load} /></header>
      <div ref={bodyRef} data-testid="body" dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  )
}

beforeEach(() => {
  touch.on = false
  lib.fail = false
  lib.loads = 0
  lib.sharePanel.mockReset()
  lib.sharePanel.mockImplementation(async (kind) => ({ kind: 'info', text: `did ${kind}` }))
  lib.warmShare.mockReset()
})
afterEach(cleanup)

const button = () => screen.getByTestId('terminal-share-0')
const openMenu = async () => {
  fireEvent.click(button())
  return screen.findByRole('menu', { name: 'Share PERF' })
}

describe('the button', () => {
  it('is a real menu button with a name that says what it does', () => {
    render(<Frame onNotice={() => {}} />)
    const b = button()
    expect(b.tagName).toBe('BUTTON')
    expect(b.getAttribute('type')).toBe('button')
    expect(b.getAttribute('aria-haspopup')).toBe('menu')
    expect(b.getAttribute('aria-expanded')).toBe('false')
    expect(b.getAttribute('aria-label')).toBe('Share panel 1: copy its list as an image or a file')
    expect(b.className).toBe('act')
    expect(screen.getByRole('button', { name: /^Share panel 1/ })).toBe(b)
  })

  it('\u26D4 nothing is loaded until the menu is opened', async () => {
    render(<Frame onNotice={() => {}} />)
    expect(lib.loads).toBe(0)
    expect(lib.warmShare).not.toHaveBeenCalled()
    await openMenu()
    await waitFor(() => expect(lib.warmShare).toHaveBeenCalledTimes(1))
    expect(button().getAttribute('aria-expanded')).toBe('true')
  })

  it('\u26D4 is offered only while the panel shows a list: it comes when rows arrive and goes when they leave', async () => {
    render(<Frame onNotice={() => {}} html="<p>Loading your trading stats</p><table><thead><tr><th>Setup</th></tr></thead><tbody></tbody></table>" />)
    expect(screen.queryByTestId('terminal-share-0')).toBeNull()
    expect(lib.loads).toBe(0)
    // The panel's data lands: a row is drawn.
    const tbody = screen.getByTestId('body').querySelector('tbody')
    await act(async () => { tbody.innerHTML = '<tr><td>Flag</td></tr>' })
    expect(await screen.findByTestId('terminal-share-0')).toBeTruthy()
    // The member filters everything away: the button goes with the rows.
    await act(async () => { tbody.innerHTML = '' })
    await waitFor(() => expect(screen.queryByTestId('terminal-share-0')).toBeNull())
    expect(lib.loads).toBe(0)
  })

  it('a table in a hidden box or a closed section is not a list on screen; opening the section offers it', async () => {
    render(<Frame onNotice={() => {}} html={`<details data-testid="adv"><summary>Advanced</summary>${TABLE}</details><div hidden>${TABLE}</div>`} />)
    expect(screen.queryByTestId('terminal-share-0')).toBeNull()
    await act(async () => { screen.getByTestId('adv').setAttribute('open', '') })
    expect(await screen.findByTestId('terminal-share-0')).toBeTruthy()
    await act(async () => { screen.getByTestId('adv').removeAttribute('open') })
    await waitFor(() => expect(screen.queryByTestId('terminal-share-0')).toBeNull())
  })

  it('holdsList: a row of cells in a table that is on screen, and nothing less', () => {
    const el = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d }
    expect(holdsList(el(TABLE))).toBe(true)
    expect(holdsList(el('<table><thead><tr><th>Setup</th></tr></thead><tbody></tbody></table>'))).toBe(false)
    expect(holdsList(el('<p>Only words</p>'))).toBe(false)
    expect(holdsList(el(`<details>${TABLE}</details>`))).toBe(false)
    expect(holdsList(el(`<details open>${TABLE}</details>`))).toBe(true)
    expect(holdsList(el(`<section hidden>${TABLE}</section>`))).toBe(false)
    expect(holdsList(el(`<section hidden>${TABLE}</section>${TABLE}`))).toBe(true)
    expect(holdsList(null)).toBe(false)
  })

  it('a list that goes between the last look and the click opens no menu, loads nothing, and says so', () => {
    const onNotice = vi.fn()
    render(<Frame onNotice={onNotice} />)
    const b = button()
    // Removed and clicked in the same tick, before the frame has looked again.
    screen.getByTestId('body').querySelector('tbody').innerHTML = ''
    fireEvent.click(b)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onNotice).toHaveBeenCalledWith({ kind: 'info', text: 'PERF shows no list to share right now.' })
    expect(lib.warmShare).not.toHaveBeenCalled()
    expect(lib.loads).toBe(0)
  })

  it('a click on it does not reach the panel behind it', () => {
    const behind = vi.fn()
    render(<div onClick={behind}><Frame onNotice={() => {}} /></div>)
    fireEvent.click(button())
    expect(behind).not.toHaveBeenCalled()
  })
})

describe('the menu', () => {
  it('offers the three ways, each a menu item with a hint', async () => {
    render(<Frame onNotice={() => {}} />)
    const menu = await openMenu()
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['Copy as image', 'Download spreadsheet (CSV)', 'Copy as text'])
    for (const item of items) expect(item.getAttribute('aria-description')).toBeTruthy()
  })

  it('follows the decision: no file export means no file items; no picture means no picture item', async () => {
    const { unmount } = render(<Frame decision={{ offered: true, image: true, file: false }} onNotice={() => {}} />)
    expect(within(await openMenu()).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Copy as image'])
    unmount()
    render(<Frame decision={{ offered: true, image: false, file: true }} onNotice={() => {}} />)
    expect(within(await openMenu()).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Download spreadsheet (CSV)', 'Copy as text'])
  })

  it('each item shares the panel body as it is NOW, closes the menu, and ends in one notice', async () => {
    const onNotice = vi.fn()
    render(<Frame onNotice={onNotice} />)
    for (const [label, kind] of [['Copy as image', 'image'], ['Download spreadsheet (CSV)', 'csv'], ['Copy as text', 'text']]) {
      onNotice.mockClear()
      lib.sharePanel.mockClear()
      const menu = await openMenu()
      await waitFor(() => expect(lib.warmShare).toHaveBeenCalled())
      // The member changes the list while the menu is open: the item reads the body at the click.
      screen.getByTestId('body').querySelector('td').textContent = `Changed before ${kind}`
      let seen = null
      lib.sharePanel.mockImplementationOnce(async (k, body) => { seen = body.querySelector('td').textContent; return { kind: 'info', text: `did ${k}` } })
      await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: label })) })
      expect(lib.sharePanel).toHaveBeenCalledTimes(1)
      expect(lib.sharePanel.mock.calls[0][0]).toBe(kind)
      expect(lib.sharePanel.mock.calls[0][1]).toBe(screen.getByTestId('body'))
      expect(lib.sharePanel.mock.calls[0][2]).toBe(META)
      expect(seen).toBe(`Changed before ${kind}`)
      await waitFor(() => expect(onNotice).toHaveBeenCalledWith({ kind: 'info', text: `did ${kind}` }))
      expect(onNotice).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('menu')).toBeNull()
    }
  })

  it('once loaded, an item acts inside the click (the clipboard needs that)', async () => {
    render(<Frame onNotice={() => {}} />)
    const menu = await openMenu()
    await waitFor(() => expect(lib.warmShare).toHaveBeenCalled())
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy as image' }))
    // No await between the click and this line.
    expect(lib.sharePanel).toHaveBeenCalledTimes(1)
  })

  it('keyboard: arrows move between items, Escape closes and puts focus back on the button', async () => {
    render(<Frame onNotice={() => {}} />)
    button().focus()
    const menu = await openMenu()
    const items = within(menu).getAllByRole('menuitem')
    await waitFor(() => expect(document.activeElement).toBe(items[0]))
    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1], { key: 'End' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(document.activeElement).toBe(button())
    expect(button().getAttribute('aria-expanded')).toBe('false')
  })

  it('a failed load says nothing was shared, and the next open tries again', async () => {
    const onNotice = vi.fn()
    lib.fail = true
    render(<Frame onNotice={onNotice} />)
    let menu = await openMenu()
    await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: 'Download spreadsheet (CSV)' })) })
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', text: expect.stringMatching(/did not work.*nothing was copied or downloaded/) })))
    expect(lib.sharePanel).not.toHaveBeenCalled()
    expect(lib.loads).toBeGreaterThanOrEqual(1)
    const before = lib.loads
    lib.fail = false
    onNotice.mockClear()
    menu = await openMenu()
    await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: 'Download spreadsheet (CSV)' })) })
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith({ kind: 'info', text: 'did csv' }))
    expect(lib.loads).toBeGreaterThan(before)
  })

  it('an action that throws, now or later, is reported, never swallowed', async () => {
    const onNotice = vi.fn()
    render(<Frame onNotice={onNotice} />)
    for (const boom of [async () => { throw new Error('later') }, () => { throw new Error('now') }]) {
      onNotice.mockClear()
      lib.sharePanel.mockImplementation(boom)
      const menu = await openMenu()
      await waitFor(() => expect(lib.warmShare).toHaveBeenCalled())
      await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy as text' })) })
      await waitFor(() => expect(onNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' })))
      expect(onNotice).toHaveBeenCalledTimes(1)
    }
  })

  it('the real import is a dynamic one of ./shareActions, and only that', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.join(process.cwd(), 'src/pages/terminal/share/PanelShare.jsx'), 'utf8')
    expect(src).toMatch(/const loadShare = \(\) => import\('\.\/shareActions'\)/)
    expect(src).not.toMatch(/^import .* from '\.\/share(Actions|Read|Text|Image)'/m)
  })
})

describe('on a phone or tablet', () => {
  it('the menu opens as the app\'s sheet: a named dialog of plain buttons', async () => {
    touch.on = true
    const onNotice = vi.fn()
    render(<Frame onNotice={onNotice} />)
    fireEvent.click(button())
    const dialog = await screen.findByRole('dialog', { name: 'Share PERF' })
    expect(screen.queryByRole('menu')).toBeNull()
    const rows = within(dialog).getAllByRole('button').filter((b) => /image|spreadsheet|text/.test(b.textContent))
    expect(rows.map((b) => b.textContent)).toEqual(['Copy as image', 'Download spreadsheet (CSV)', 'Copy as text'])
    await act(async () => { fireEvent.click(rows[1]) })
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith({ kind: 'info', text: 'did csv' }))
  })

  it('the rows of the sheet and the button itself meet the 44px touch floor in the CSS', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const css = (rel) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css('components/mobile/ContextPopover.module.css')).toMatch(/@media \(max-width: 1024px\)[\s\S]*\.sheetList \.item\s*\{[^}]*min-height:\s*var\(--tap-min\)/)
    const shell = css('pages/terminal/TerminalShell.module.css')
    expect(shell).toMatch(/\.panelAct,[\s\S]{0,200}min-height:\s*var\(--tap-min\)/)
    expect(shell).toMatch(/\.panelAct,[\s\S]{0,120}min-width:\s*var\(--tap-min\)/)
    // ... and the frame hands the Share button that class.
    const frame = fs.readFileSync(path.join(process.cwd(), 'src/pages/terminal/TerminalShell.jsx'), 'utf8')
    expect(frame).toMatch(/<PanelShare[^>]*className=\{styles\.panelAct\}/)
  })
})

describe('accessibility', () => {
  it('axe finds nothing on the closed button or on the open menu', async () => {
    const { container } = render(<Frame onNotice={() => {}} />)
    await expectNoAxeViolations(container)
    await openMenu()
    await expectNoAxeViolations(document.body)
  })

  it('axe finds nothing on the phone sheet', async () => {
    touch.on = true
    render(<Frame onNotice={() => {}} />)
    fireEvent.click(button())
    await screen.findByRole('dialog', { name: 'Share PERF' })
    await expectNoAxeViolations(document.body)
  })
})
