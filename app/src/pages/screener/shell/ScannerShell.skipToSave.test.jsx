// Finish program, lane NAV, item B (ruling P5 / proposal Q7, WAVE-13-PLAN section 6).
//
// "Save these results to Notebook" is the LAST control in the Screener's toolbar. Measured in
// a real browser (docs/notebook/wave13-13q.md section 2): 339 Tab presses at 1200 px, 32 at
// 390 px, against a keyboard budget of 10 for the whole flow.
//
// The fix is a skip link, "Skip to save results", rendered through the shell's skip-link slot
// (components/skipLinks.jsx) so it is the second Tab stop on the page. This file COUNTS the
// keys, in the real ScannerShell, with the same harness as ScannerShell.notebookDoor.test.jsx.
// The real-browser count is in docs/notebook/evidence/fin-nav/.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const { META, SAVED, scanMock, sendMock } = vi.hoisted(() => ({
  META: {
    categories: [{ key: 'descriptive', label: 'Descriptive' }],
    filters: [{ key: 'price', label: 'Price', category: 'descriptive',
      type: 'range', allow_custom: true, presets: [{ label: 'Any' }] }],
    views: [
      { key: 'overview', label: 'Overview', columns: ['ticker', 'company', 'price', 'chg_pct_1d'] },
    ],
  },
  SAVED: { saved: [], starters: [], create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  scanMock: vi.fn(),
  sendMock: vi.fn(async () => 'Screener results sent to “Plan”'),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../hooks/useScreenerMeta', () => ({ default: () => ({ meta: META, isLoading: false }) }))
vi.mock('../hooks/useScreenerScan', () => ({ default: scanMock }))
vi.mock('../hooks/useSavedScreens', () => ({ default: () => SAVED }))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('./csvExport', () => ({ exportScreen: vi.fn() }))
vi.mock('../../../components/TickerPopup', () => ({ default: ({ children }) => <span>{children}</span> }))
vi.mock('../../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ longPressProps: () => ({}), menu: null, closeMenu: () => {} }),
}))
vi.mock('../../../components/PatternFeedbackChip', () => ({ default: () => null }))
vi.mock('../../journal-2-0/lib/sendToJournal', () => ({ sendCaptureToJournal: sendMock }))

import ScannerShell from './ScannerShell'
import { SkipLinkSlotContext, MAIN_CONTENT_ID } from '../../../components/skipLinks'

const here = dirname(fileURLToPath(import.meta.url))
const READY = { result: { total: 2, rows: [{ ticker: 'AAA', company: 'Aaa Corp', price: 10, chg_pct_1d: 1 },
  { ticker: 'BBB', company: 'Bbb Inc', price: 20, chg_pct_1d: -1 }], page: 1, snapshot_date: '2026-08-21' },
  isLoading: false, error: null }

/** The app shell's skip-link strip, as components/Layout.jsx lays it out: "Skip to main
 *  content", then the slot a page's own skip link is portaled into, then the nav (22 entries
 *  in the real app), then <main>. */
function AppShell({ children }) {
  const [slot, setSlot] = useState(null)
  return (
    <SkipLinkSlotContext.Provider value={slot}>
      <div>
        <a href={`#${MAIN_CONTENT_ID}`}
          onClick={(e) => { e.preventDefault(); document.getElementById(MAIN_CONTENT_ID).focus() }}>
          Skip to main content
        </a>
        <span ref={setSlot} data-skip-link-slot="" />
      </div>
      <nav>{Array.from({ length: 22 }, (_, i) => <a key={i} href={`#nav-${i}`}>Nav {i}</a>)}</nav>
      <main id={MAIN_CONTENT_ID} tabIndex={-1}>{children}</main>
    </SkipLinkSlotContext.Provider>
  )
}

const BUDGET = 10
const door = () => screen.getByRole('button', { name: 'Save these results to Notebook' })

/** Press Tab from the top of the document until `el` has focus; return how many presses. */
async function tabsTo(user, el, cap = 400) {
  let n = 0
  while (document.activeElement !== el) {
    if (n >= cap) throw new Error(`cap reached: ${cap} Tab presses never focused the control`)
    await user.tab()
    n += 1
  }
  return n
}

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  scanMock.mockReset()
  sendMock.mockClear()
  scanMock.mockReturnValue(READY)
})

describe('Screener, keyboard: the save door is inside the 10-key budget (Q7)', () => {
  it('Tab, Tab, Enter, Tab, Enter saves the results: 5 keys', async () => {
    const user = userEvent.setup()
    render(<AppShell><ScannerShell /></AppShell>)
    let keys = 0

    await user.tab(); keys += 1
    expect(document.activeElement).toHaveAccessibleName('Skip to main content')
    await user.tab(); keys += 1
    expect(document.activeElement.tagName).toBe('A')
    expect(document.activeElement).toHaveAccessibleName('Skip to save results')
    await user.keyboard('{Enter}'); keys += 1
    // Focus lands just before the door, on a named, script-focusable target ...
    expect(document.activeElement).toHaveAttribute('data-screener-save-anchor')
    expect(document.activeElement.getAttribute('tabindex')).toBe('-1')
    // ... so the very next Tab is the door itself.
    await user.tab(); keys += 1
    expect(document.activeElement).toBe(door())
    await user.keyboard('{Enter}'); keys += 1

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
    expect(sendMock.mock.calls[0][0]).toBe('screener')
    expect(keys).toBe(5)
    expect(keys).toBeLessThanOrEqual(BUDGET)
  })

  it('control: without the skip link the same door is over budget even in this small fixture', async () => {
    const user = userEvent.setup()
    render(<AppShell><ScannerShell /></AppShell>)
    // The honest walk: "Skip to main content", Enter, then Tab through the page.
    await user.tab()
    await user.keyboard('{Enter}')
    expect(document.activeElement.id).toBe(MAIN_CONTENT_ID)
    const walked = 2 + await tabsTo(user, door()) + 1
    expect(walked).toBeGreaterThan(BUDGET)
  })

  it('the landing target still works while the door is disabled (no result yet)', async () => {
    scanMock.mockReturnValue({ result: null, isLoading: true, error: null })
    const user = userEvent.setup()
    render(<AppShell><ScannerShell /></AppShell>)
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(document.activeElement).toHaveAttribute('data-screener-save-anchor')
    expect(door()).toBeDisabled()
  })

  it('rendered alone (no app shell) the link stays with the page, and still works', async () => {
    const user = userEvent.setup()
    render(<ScannerShell />)
    const link = screen.getByRole('link', { name: 'Skip to save results' })
    link.focus()
    await user.keyboard('{Enter}')
    await user.tab()
    expect(document.activeElement).toBe(door())
  })

  it('embedded in a Charts widget there is no skip link and no landing target', () => {
    const { container } = render(<AppShell><ScannerShell embedded /></AppShell>)
    expect(screen.queryByRole('link', { name: 'Skip to save results' })).toBeNull()
    expect(container.querySelector('[data-screener-save-anchor]')).toBeNull()
    expect(door()).toBeTruthy()
  })

  it('adds no Tab stop of its own inside the page, and no second door', () => {
    const { container } = render(<AppShell><ScannerShell /></AppShell>)
    expect(screen.getAllByRole('button', { name: 'Save these results to Notebook' })).toHaveLength(1)
    const anchor = container.querySelector('[data-screener-save-anchor]')
    expect(anchor.className).toMatch(/sr-only/)
    // The target sits directly before the door in the document.
    expect(anchor.compareDocumentPosition(door()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// The lesson of PR #225 / H14: a skip link that is merely moved off-screen can still be painted
// over a tap target on a phone and take the tap. jsdom lays nothing out, so this reads the
// stylesheet, the same way journal-2-0/a11y/skipLinkUntappable.test.js does.
describe("the Screener's skip link never takes a tap meant for something else", () => {
  const css = readFileSync(resolve(here, 'ScannerShell.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) rules.push({ selector: m[1].trim(), body: m[2] })
  const decl = (body, prop) => {
    const d = body.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`))
    return d ? d[1].trim() : null
  }
  const link = rules.filter((r) => /\.skipLink\b/.test(r.selector))
  const base = link.find((r) => r.selector === '.skipLink' && decl(r.body, 'position') === 'absolute')
  const shown = link.filter((r) => /\.skipLink:focus/.test(r.selector))

  it('non-vacuity: the base rule and one focused rule exist', () => {
    expect(base, 'the positioned .skipLink rule').toBeTruthy()
    expect(shown).toHaveLength(1)
  })

  it('unfocused: invisible, off-screen and pointer-transparent', () => {
    expect(decl(base.body, 'opacity')).toBe('0')
    expect(decl(base.body, 'pointer-events')).toBe('none')
    expect(decl(base.body, 'transform')).toMatch(/translateY\(-\d+%\)/)
  })

  it('it is shown by :focus-visible ONLY, never by a plain :focus a tap can cause', () => {
    expect(shown[0].selector).toBe('.skipLink:focus-visible')
    expect(decl(shown[0].body, 'opacity')).toBe('1')
    expect(decl(shown[0].body, 'pointer-events')).toBe('auto')
    expect(decl(shown[0].body, 'outline')).toBeTruthy()
  })

  it('no other rule makes the unfocused link visible or tappable', () => {
    for (const r of link.filter((x) => !/:focus-visible/.test(x.selector))) {
      const op = decl(r.body, 'opacity')
      expect(op === null || op === '0', `${r.selector}: opacity ${op}`).toBe(true)
      const pe = decl(r.body, 'pointer-events')
      expect(pe === null || pe === 'none', `${r.selector}: pointer-events ${pe}`).toBe(true)
    }
  })
})
