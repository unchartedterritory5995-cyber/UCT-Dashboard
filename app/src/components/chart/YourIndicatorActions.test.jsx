// The doors on one of the member's own indicators in the Indicators window (Studio lane R1, second slice).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import YourIndicatorActions, { nameOfDefinition } from './YourIndicatorActions'
import WINDOW_SRC from './ChartSettingsIndicators.jsx?raw'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const MINE = { id: 'u_0123456789ab', label: 'My indicator' }
const doors = (over = {}) => ({ canModify: () => true, modify: vi.fn(), editFormula: vi.fn(), customCopy: vi.fn(), ...over })
/** The two reads the share panel makes on opening; returns the list of calls it saw. */
function shareRoutes() {
  const calls = []
  global.fetch = vi.fn(async (url, opts = {}) => {
    calls.push(`${opts.method || 'GET'} ${url}`)
    const body = /\/share$/.test(url) ? { token: null }
      : /\/list$/.test(url) ? { listed: false, requested: false, shared: false } : null
    return body ? { ok: true, status: 200, json: async () => body }
      : { ok: false, status: 404, json: async () => ({ detail: 'no route' }) }
  })
  return calls
}
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('the doors on a member’s own indicator', () => {
  it('Modify, Edit formula and Custom copy call the host’s doors with this indicator', () => {
    const d = doors()
    render(<YourIndicatorActions def={MINE} doors={d} />)
    fireEvent.click(screen.getByTestId('your-indicator-modify'))
    fireEvent.click(screen.getByTestId('your-indicator-edit'))
    fireEvent.click(screen.getByTestId('your-indicator-copy'))
    expect(d.modify).toHaveBeenCalledWith(MINE.id)
    expect(d.editFormula).toHaveBeenCalledWith(MINE.id)
    expect(d.customCopy).toHaveBeenCalledWith(MINE, {})
  })

  it('"Run over a list" opens the Screener’s address for this indicator, in this tab', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<YourIndicatorActions def={MINE} doors={doors()} />)
    const run = screen.getByTestId('your-indicator-run')
    expect(run.textContent).toBe('Run over a list')
    fireEvent.click(run)
    expect(open).toHaveBeenCalledWith(`/screener?scan=${MINE.id}`, '_self')
  })

  it('a press on a door never also presses the row behind it', () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    const rowClick = vi.fn()
    render(<div onClick={rowClick}><YourIndicatorActions def={MINE} doors={doors()} /></div>)
    for (const id of ['your-indicator-modify', 'your-indicator-edit', 'your-indicator-copy', 'your-indicator-run']) {
      fireEvent.click(screen.getByTestId(id))
    }
    expect(rowClick).not.toHaveBeenCalled()
  })

  it('CONTROL: an indicator with no stored id (a draft) offers no run, and no Modify without access', () => {
    render(<YourIndicatorActions def={{ id: 'draft_1' }} doors={doors({ canModify: () => false })} />)
    expect(screen.queryByTestId('your-indicator-run')).toBeNull()
    expect(screen.queryByTestId('your-indicator-modify')).toBeNull()
    expect(screen.getByTestId('your-indicator-edit')).toBeTruthy()
  })

  it('CONTROL: nothing renders without a definition or without doors', () => {
    const { container, rerender } = render(<YourIndicatorActions def={null} doors={doors()} />)
    expect(container.firstChild).toBeNull()
    rerender(<YourIndicatorActions def={MINE} doors={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('Share opens the builder’s own share panel for THIS indicator, in a window named after it', async () => {
    const calls = shareRoutes()
    render(<YourIndicatorActions def={MINE} doors={doors()} />)
    expect(screen.queryByRole('dialog')).toBeNull()                    // nothing is opened, or read, until asked
    expect(calls).toEqual([])
    fireEvent.click(screen.getByTestId('your-indicator-share'))
    const dialog = await screen.findByRole('dialog', { name: 'Share My indicator' })
    // the real panel, reading both consents for this id and granting neither
    // in the member's word for it: this is an indicator's row (the Screener's panel says "formula")
    await within(dialog).findByText(/This indicator is private/i)
    expect(within(dialog).getByRole('heading', { name: 'Share this indicator' })).toBeTruthy()
    expect(dialog.textContent).not.toMatch(/this formula/i)
    expect(within(dialog).getByTestId('library-block')).toBeTruthy()
    // ⛔ WAIT FOR THE READS; THE TEXT DOES NOT PROVE THEM. The panel says "private" from its FIRST
    // render, and its two reads are effects React runs in a LATER task: when that text first shows,
    // zero reads have been made (measured, every time). This used to check `calls` right after the
    // text and passed only while React's effect task beat Testing Library's setTimeout(0) -- not on a
    // busy runner (2026-11-17 run 44108868048, a 499-file shard: `Set{}`). The share read has LANDED
    // when the panel offers to make a link (it refuses to before, so the disclosure cannot be skipped).
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /Create a share link/ })).toBeEnabled())
    await waitFor(() => expect(new Set(calls)).toEqual(new Set([
      `GET /api/user-definitions/${MINE.id}/share`,
      `GET /api/user-definitions/${MINE.id}/list`,
    ])))
    expect(calls.some((c) => !c.startsWith('GET'))).toBe(false)
  })

  it('a press or a key inside the share window never reaches the row behind it, and closing it leaves the row alone', async () => {
    shareRoutes()
    const rowClick = vi.fn(); const rowDown = vi.fn(); const rowKey = vi.fn()
    render(<div onClick={rowClick} onMouseDown={rowDown} onKeyDown={rowKey}>
      <YourIndicatorActions def={MINE} doors={doors()} /></div>)
    fireEvent.click(screen.getByTestId('your-indicator-share'))
    const dialog = await screen.findByRole('dialog')
    const inside = await within(dialog).findByTestId('library-block')
    fireEvent.mouseDown(inside); fireEvent.click(inside); fireEvent.keyDown(inside, { key: 'a' })
    fireEvent.click(within(dialog).getByRole('button', { name: /close/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(rowClick).not.toHaveBeenCalled()
    expect(rowDown).not.toHaveBeenCalled()
    expect(rowKey).not.toHaveBeenCalled()
    // CONTROL: the same three events on the row itself do reach it, so the check above can fail
    const row = screen.getByTestId('your-indicator-actions')
    fireEvent.mouseDown(row); fireEvent.click(row); fireEvent.keyDown(row, { key: 'a' })
    expect([rowClick, rowDown, rowKey].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])
  })

  it('CONTROL: a draft (no stored id) has nothing to share, and the name is read wherever the definition keeps it', () => {
    render(<YourIndicatorActions def={{ id: 'draft_1' }} doors={doors()} />)
    expect(screen.queryByTestId('your-indicator-share')).toBeNull()
    expect(nameOfDefinition({ label: ' A ' })).toBe('A')
    expect(nameOfDefinition({ meta: { name: 'B' } })).toBe('B')
    expect(nameOfDefinition({ label: 7 })).toBe('')
    expect(nameOfDefinition(null)).toBe('')
  })

  it('⛔ the doors sit on a line of their own under the name (stylesheet + source rail)', () => {
    // Five doors on the name's line left the name no room (production, 2026-11-17). jsdom does no
    // layout, so this pins the rules that make the second line AND the nesting they depend on; the
    // measurement itself is a real-browser check on the live page.
    const css = fs.readFileSync(path.resolve(__dirname, './ChartSettingsIndicators.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    // a rule's body by its WHOLE selector (anchored at the start of a rule, so `.resRowOwn` is not
    // found inside `.resRowOwn .resMain`)
    const rule = (sel) => {
      const at = new RegExp(`(?:^|[}])\\s*${sel.replace(/[.]/g, '[.]')}\\s*[{]([^}]*)[}]`).exec(css)
      return at ? at[1] : null
    }
    // ⛔ THE DOORS ARE INSIDE `.resMain`, so `.resMain` is what wraps. The first fix wrapped the ROW
    // and gave the doors a whole-line basis inside a `.resMain` that could not wrap: the name was
    // squeezed to zero width on production.
    expect(rule('.resRowOwn .resMain')).toMatch(/flex-wrap:\s*wrap/)
    expect(rule('.resRowOwn .resActions')).toMatch(/flex:\s*1 0 100%/)        // the whole second line
    expect(rule('.resRowOwn .resActions')).toMatch(/flex-wrap:\s*wrap/)        // and it wraps when narrow
    expect(rule('.resRowOwn')).not.toMatch(/flex-wrap/)                         // the row itself stays one line
    expect(rule('.resRowOwn .resMain')).not.toMatch(/flex:\s*1 1 0\b/)
    // CONTROL: the reader sees a real rule, and a rule that is not there is null
    expect(rule('.resActions')).toMatch(/display:\s*flex/)
    expect(rule('.noSuchRule')).toBeNull()
    // the window marks the member's own rows, and only those that have doors
    const w = code(WINDOW_SRC)
    expect(w).toMatch(/row\.userDefined && definitionDoors \? styles\.resRowOwn : ''/)
    // and the nesting the rules assume: between `.resMain` opening and the doors, every span and
    // button that opened has closed, so the doors are a direct child of `.resMain`
    const open = w.indexOf('<span className={`${styles.resMain}')
    const doors = w.indexOf('<YourIndicatorActions', open)
    expect(open).toBeGreaterThan(-1)
    expect(doors).toBeGreaterThan(open)
    const between = w.slice(w.indexOf('>', open) + 1, doors)
    const count = (needle) => between.split(needle).length - 1
    expect(count('<span')).toBeGreaterThan(0)
    expect(count('<span')).toBe(count('</span>'))
    expect(count('<button')).toBe(count('</button>'))
    // CONTROL: the count sees a missing close (the doors moved out of `.resMain` would read so)
    const moved = `${between}</span>`
    expect(moved.split('<span').length).not.toBe(moved.split('</span>').length)
  })

  it('the Indicators window uses these doors for the member’s own rows (source rail; comments stripped)', () => {
    const w = code(WINDOW_SRC)
    expect(w).toMatch(/<YourIndicatorActions def=\{d\} doors=\{definitionDoors\}/)
    expect(w).not.toMatch(/data-testid="your-indicator-edit"/)       // one implementation, not two
  })
})
