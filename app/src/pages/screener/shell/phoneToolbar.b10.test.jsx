import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOTTOM_OFFSET_PX, PAD_PX } from '../../../hub/constants'

// Decision B10 (2026-11-07): the phone screener toolbar scrolls sideways with a right-edge fade
// instead of wrapping into a stack of rows, keeps its 44 px tap floor, and nothing on the phone
// screener sits under the joystick's band. jsdom does no layout, so the CSS half is read from the
// stylesheet (the ColumnPicker.va6 idiom) and the behaviour half is mounted.

// Capture what ResultCards hands its virtualizer, without needing a laid-out scroller.
const virtualOpts = []
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts) => {
    virtualOpts.push(opts)
    return { getTotalSize: () => 0, getVirtualItems: () => [], scrollToIndex: () => {}, measureElement: () => {} }
  },
}))

const { default: ShellToolbar } = await import('./ShellToolbar')
const { default: ResultCards } = await import('./ResultCards')

const CSS = readFileSync(join(globalThis.process.cwd(), 'src/pages/screener/shell/ScannerShell.module.css'), 'utf8')
  .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
const block = (head) => {
  const at = CSS.indexOf(head)
  expect(at, `missing ${head}`).toBeGreaterThan(-1)
  let d = 0
  for (let i = CSS.indexOf('{', at); i < CSS.length; i += 1) {
    if (CSS[i] === '{') d += 1
    else if (CSS[i] === '}' && --d === 0) return CSS.slice(at, i + 1)
  }
  return ''
}
const rule = (css, sel) => {
  const re = new RegExp(`(?:^|[}\\s])${sel.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm')
  return re.exec(css)?.[1] ?? null
}
const PHONE = block('@media (max-width: 640px) {\n  .shell')
const TOUCH = block('@media (max-width: 1024px) {\n  .railSlot')
const BAND = BOTTOM_OFFSET_PX + PAD_PX

const realMatchMedia = window.matchMedia
function setPhone(phone) {
  window.matchMedia = (q) => ({
    matches: phone && q === '(max-width: 640px)', media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false },
  })
}
afterEach(() => { window.matchMedia = realMatchMedia })

describe('B10: the phone toolbar is one scrolling row', () => {
  it('nowrap + horizontal scroll, no scrollbar chrome, on the phone only', () => {
    const tb = rule(PHONE, '.toolbar')
    expect(tb).toMatch(/flex-wrap:\s*nowrap/)
    expect(tb).toMatch(/overflow-x:\s*auto/)
    expect(tb).toMatch(/scrollbar-width:\s*none/)
    expect(rule(PHONE, '.viewTabs')).toMatch(/flex-wrap:\s*nowrap/)
    // every control keeps its natural width rather than squeezing
    expect(PHONE).toMatch(/\.toolbar > \*,\s*\.viewTabs > \*,\s*\.toolGroup > \*\s*\{\s*flex:\s*0 0 auto/)
    // desktop and tablet keep the wrapping row
    expect(rule(CSS, '.toolbar')).toMatch(/flex-wrap:\s*wrap/)
  })

  it('the right-edge fade is a sticky trailing gradient that never takes a tap, and never a mask', () => {
    const fade = rule(PHONE, '.toolbar::after')
    expect(fade).toMatch(/position:\s*sticky/)
    expect(fade).toMatch(/right:\s*0/)
    expect(fade).toMatch(/linear-gradient\(to right, transparent, var\(--bg\)/)
    expect(fade).toMatch(/pointer-events:\s*none/)
    // a mask on the toolbar would also hide its fixed-position phone menus
    expect(PHONE).not.toMatch(/mask-image/)
  })

  it('the 44 px tap floor holds for every toolbar control on a phone', () => {
    expect(TOUCH).toMatch(/\.viewTab, \.toolBtn\s*\{\s*min-height:\s*var\(--tap-min, 44px\)/)
    expect(rule(TOUCH, '.seal')).toMatch(/min-height:\s*var\(--tap-min, 44px\)/)
    // the saved-view tabs: on every touch width, not the phone only (styles/tapFloor.test.js)
    expect(rule(TOUCH, '.presetTab')).toMatch(/min-height:\s*var\(--tap-min, 44px\)/)
    expect(rule(TOUCH, '.presetDel')).toMatch(/min-width:\s*var\(--tap-min, 44px\)/)
  })

  it('canonical breakpoints only', () => {
    for (const m of CSS.matchAll(/@media \(max-width: (\d+)px\)/g)) expect(['640', '1024']).toContain(m[1])
  })
})

describe('B10: nothing on the phone screener sits under the joystick band', () => {
  it('the result scrollers end with the band\'s height of room, derived from the hub geometry', () => {
    expect(BAND).toBe(152)
    expect(PHONE).toMatch(new RegExp(`\\.cardsScroll,\\s*\\.gridScroll\\s*\\{\\s*padding-bottom:\\s*calc\\(${BAND}px \\+ env\\(safe-area-inset-bottom, 0px\\)\\)`))
  })

  it('the card list tells its virtualizer, so a joystick cursor step stops above the band', () => {
    virtualOpts.length = 0
    render(<ResultCards rows={[]} columns={['ticker']} livePrices={{}} />)
    expect(virtualOpts.at(-1)?.scrollPaddingEnd).toBe(BAND)
  })
})

describe('B10: the seal panel survives the scrolling row', () => {
  const props = {
    meta: { views: [{ key: 'overview', label: 'Overview' }] }, view: 'overview', onView: () => {},
    visibleColumns: ['ticker'], allColumns: [], onColumns: () => {}, onResetColumns: () => {},
    snapshot: { rows: 10, snapshot_date: '2026-11-06', rows_on_snapshot_date: 10 },
    snapshotDate: '2026-11-06', total: 10, shown: 10, isLoading: false, onExport: () => {}, exportState: {},
  }

  it('on a phone it opens viewport-pinned (a scroller would clip an absolute popover)', () => {
    setPhone(true)
    render(<ShellToolbar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /data provenance/ }))
    const pop = screen.getByRole('dialog', { name: 'Snapshot provenance' })
    expect(pop).toHaveAttribute('data-phone-panel')
    expect(pop.style.position).toBe('fixed')
    expect(pop.style.left).toBe('8px')
    expect(pop.style.right).toBe('8px')
    expect(rule(PHONE, '.sealPop[data-phone-panel]')).toMatch(/overflow-y:\s*auto/)
  })

  it('CONTROL: desktop keeps the anchored popover', () => {
    setPhone(false)
    render(<ShellToolbar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /data provenance/ }))
    const pop = screen.getByRole('dialog', { name: 'Snapshot provenance' })
    expect(pop).not.toHaveAttribute('data-phone-panel')
    expect(pop.getAttribute('style')).toBeNull()
  })
})
