// app/src/components/chart/chartSettingsA11y.test.jsx
//
// Four defects a Playwright WebKit + axe walk of the live chart found at
// iPhone / iPad sizes (2026-10-27). Each block below fails on the markup that
// shipped:
//
//   1. "Series on this chart" had NO tab stop when nothing was selected: every
//      row's name button was tabindex -1, so Tab skipped the whole list.
//   2. Result rows announced their name twice ("Parabolic SAR SAR", "TRIX TRIX"):
//      the visible short-name tag sat inside the row's button and joined its
//      accessible name.
//   3. Chart Settings said `aria-modal="true"` and managed no focus: focus stayed
//      on the page behind, Tab walked out, the page stayed in the a11y tree, and
//      closing dropped focus on <body> instead of the gear.
//   (4, the A/L/% chips' pressed state, lives in `mobileScaleAndVolume.test.jsx`,
//   beside the harness that can render StockChart.)
//   5. The Add surface's 9.5px short tag composited to 4.03:1 (axe color-contrast).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { useRef, useState } from 'react'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { computeAccessibleName } from 'dom-accessibility-api'
import IndicatorLibraryDialog from './IndicatorLibraryDialog'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import * as engineRegistry from './engine/nativeRegistry'
import useFocusTrap, { focusableWithin } from '../mobile/useFocusTrap'
import { runAxe, formatViolations } from '../../pages/journal-2-0/a11y/axeHarness'
import { resultRows, primaryOf } from './__tests__/resultRows'

afterEach(cleanup)

const base = (extra) => mergeChartSettings(JSON.stringify(extra || {}))
const structureRows = () => [...document.body.querySelectorAll('[data-structure-row]')]
const rowPrimary = (r) => r.querySelector('[data-row-primary]')

// ─── 1. THE STRUCTURE LIST'S ROVING TAB STOP ────────────────────────────────
describe('"Series on this chart" always has exactly one Tab stop', () => {
  const mount = () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Indicators' }))
  }

  it('with NOTHING selected, the first row is the stop (it used to be none)', () => {
    mount()
    const rows = structureRows()
    expect(rows.length, 'the default chart lists no series, so this proves nothing').toBeGreaterThan(1)
    expect(rows.some((r) => rowPrimary(r).getAttribute('aria-current') === 'true'),
      'a row is already selected, so this is not the case that failed').toBe(false)
    const stops = rows.filter((r) => rowPrimary(r).getAttribute('tabindex') === '0')
    expect(stops).toEqual([rows[0]])
  })

  it('a real Tab walk reaches the list', async () => {
    const user = userEvent.setup()
    mount()
    let reached = false
    for (let i = 0; i < 80 && !reached; i++) {
      await user.tab()
      reached = !!document.activeElement?.hasAttribute?.('data-row-primary')
    }
    expect(reached, 'Tab never landed on a row of "Series on this chart"').toBe(true)
  })

  it('once a row is selected, IT is the only stop', () => {
    mount()
    const rows = structureRows()
    fireEvent.click(rows[2])
    expect(rows.filter((r) => rowPrimary(r).getAttribute('tabindex') === '0')).toEqual([rows[2]])
  })

  // ⛔ axe's `scrollable-region-focusable` needs a box that SCROLLS, and jsdom
  // lays nothing out -- so the list is given the metrics WebKit measured (its
  // content taller than its box, overflow auto). With them the rule runs for
  // real: the CONTROL (every row -1, the shipped state) must go red first.
  const rect = (top, bottom) => () => ({ top, bottom, left: 0, right: 300, width: 300, height: bottom - top, x: 0, y: top, toJSON() {} })
  const asScroller = (el) => {
    el.style.overflowY = 'auto'
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 1200 })
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 240 })
    // axe also asks that some content lie OUTSIDE the box (it scrolls past it).
    el.getBoundingClientRect = rect(0, 240)
    for (const d of el.querySelectorAll('*')) d.getBoundingClientRect = rect(0, 1200)
  }
  const scrollFindings = async (el) => {
    const { violations } = await runAxe(el)
    return violations.filter((v) => v.id === 'scrollable-region-focusable')
  }

  it('axe scrollable-region-focusable: red with no tab stop (CONTROL), clean with the fix', async () => {
    const hadRects = typeof Range.prototype.getClientRects === 'function'
    const prevRects = Range.prototype.getClientRects
    Range.prototype.getClientRects = () => [rect(0, 1200)()]
    try {
      mount()
      const list = screen.getByRole('group', { name: 'Series on this chart' })
      asScroller(list)
      const stops = structureRows().map(rowPrimary)
      const live = stops.filter((b) => b.getAttribute('tabindex') === '0')
      expect(live.length).toBe(1)
      live[0].setAttribute('tabindex', '-1')          // the shipped markup
      const red = await scrollFindings(list)
      expect(red.map((v) => v.id), 'the rule did not run: the CONTROL proves nothing').toEqual(['scrollable-region-focusable'])
      live[0].setAttribute('tabindex', '0')           // what the fix renders
      const found = await scrollFindings(list)
      expect(found, formatViolations(found)).toEqual([])
    } finally {
      if (hadRects) Range.prototype.getClientRects = prevRects
      else delete Range.prototype.getClientRects
    }
  })
})

// ─── 2. RESULT ROWS SAY THEIR NAME ONCE, AND SAY WHAT THEY SHOW ─────────────
/** A name that ends by repeating its last word: "TRIX TRIX", "Parabolic SAR SAR". */
const stutters = (name) => {
  const w = name.trim().split(/\s+/)
  return w.length > 1 && w[w.length - 1] === w[w.length - 2]
}
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const wordsOf = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/**
 * ⛔ WCAG 2.5.3 LABEL IN NAME, per row. Every VISIBLE tag in a row's button is
 * either IN the button's accessible name, or the visible name already contains
 * it as a run of whole words (so the name says it). Written independently of
 * `shortTag.js`, so it can catch that module hiding something it should not.
 * Returns the offending rows, readably.
 */
function labelInNameBreaks(rows) {
  const out = []
  for (const row of rows) {
    const btn = primaryOf(row)
    const acc = squash(computeAccessibleName(btn))
    const nameEl = btn.querySelector('[class*="resName"], [class*="name"]')
    const visibleName = nameEl ? nameEl.textContent : ''
    for (const tagEl of btn.querySelectorAll('[class*="resShort"], [class*="chip"]')) {
      const t = tagEl.textContent.trim()
      if (!t) continue
      if (acc.includes(squash(t))) continue
      const n = ' ' + wordsOf(visibleName).join(' ') + ' '
      if (n.includes(' ' + wordsOf(t).join(' ') + ' ')) continue
      out.push(`"${visibleName}" shows "${t}" but is named "${computeAccessibleName(btn)}"`)
    }
  }
  return out
}

describe('a result row\'s accessible name says the name once, and every visible tag', () => {
  it('Indicator library: no stutter, and Label in Name on every row', () => {
    render(<IndicatorLibraryDialog open onClose={() => {}} settings={base()}
      onChange={vi.fn()} registry={engineRegistry} />)
    for (const name of ['Parabolic SAR', 'TRIX', 'SuperTrend']) {
      const btn = screen.getByRole('button', { name })
      expect(btn.matches('[data-result-primary]')).toBe(true)
      // still VISIBLE: the tag is in the button, just not in its name
      expect(btn.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBeTruthy()
    }
    // An abbreviation the name does not literally contain is visible text, and is read.
    expect(screen.getByRole('button', { name: /^Average Directional Index\s*ADX$/ }).matches('[data-result-primary]')).toBe(true)
    expect(screen.getByRole('button', { name: /^Relative Strength Index\s*RSI$/ }).matches('[data-result-primary]')).toBe(true)
    const rows = resultRows(screen.getByRole('dialog'))
    expect(rows.length).toBeGreaterThan(20)
    expect(rows.map((r) => computeAccessibleName(primaryOf(r))).filter(stutters)).toEqual([])
    expect(labelInNameBreaks(rows)).toEqual([])
  })

  it('Add surface in Chart Settings: exact names, no stutter, Label in Name', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Indicators' }))
    if (!document.body.querySelector('[data-testid="add-surface"]')) fireEvent.click(screen.getByTestId('add-enter'))
    const surface = screen.getByTestId('add-surface')
    const browse = resultRows(surface)
    expect(browse.length).toBeGreaterThan(20)
    expect(labelInNameBreaks(browse)).toEqual([])
    const box = () => screen.getByRole('searchbox', { name: /Search indicators/i })
    fireEvent.change(box(), { target: { value: 'sar' } })
    expect(screen.getByRole('button', { name: 'Parabolic SAR' }).matches('[data-result-primary]')).toBe(true)
    fireEvent.change(box(), { target: { value: 'trix' } })
    expect(screen.getByRole('button', { name: 'TRIX' }).matches('[data-result-primary]')).toBe(true)
    fireEvent.change(box(), { target: { value: 'relative strength' } })
    expect(screen.getByRole('button', { name: /^Relative Strength Index\s*RSI$/ }).matches('[data-result-primary]')).toBe(true)
    expect(resultRows(surface).map((r) => computeAccessibleName(primaryOf(r))).filter(stutters)).toEqual([])
  })

  it('CONTROL: the Label-in-Name rail catches a hidden tag the name does not say', () => {
    const li = document.createElement('li')
    li.innerHTML = '<button data-result-primary="true"><span class="resName">Relative Strength Index</span>'
      + '<span class="resShort" aria-hidden="true">RSI</span></button>'
    document.body.appendChild(li)
    expect(labelInNameBreaks([li])).toHaveLength(1)
    li.querySelector('.resShort').removeAttribute('aria-hidden')
    expect(labelInNameBreaks([li])).toEqual([])
    li.remove()
  })
})

// ─── 2b. A TICKER IS AN IDENTIFIER, NOT AN ABBREVIATION ─────────────────────
// A BROWSE security row (symbolSearchModel's POPULAR list) is named with the
// COMPANY and tagged with the TICKER. The ticker is spoken unless the company
// name literally contains it as a word: "Advanced Micro Devices" / AMD is read
// out; "Meta Platforms Inc." / META is not repeated, because the name says it.
const tickerSpan = (row, ticker) => [...primaryOf(row).querySelectorAll('span')]
  .find((n) => n.textContent.trim() === ticker)

describe('security rows keep the ticker where the name does not say it', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([['amd', 'AMD', 'Advanced Micro Devices', false], ['meta', 'META', 'Meta Platforms Inc.', true]])(
    'search "%s" -> the %s row (Label in Name holds)', async (q, ticker, company, hidden) => {
      vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).startsWith('/api/ticker-search')
        ? { ok: true, status: 200, json: async () => ({ results: [] }) }
        : { ok: false, status: 404, json: async () => ({}) })))
      render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
      fireEvent.click(screen.getByRole('tab', { name: 'Indicators' }))
      if (!document.body.querySelector('[data-testid="add-surface"]')) fireEvent.click(screen.getByTestId('add-enter'))
      fireEvent.change(screen.getByRole('searchbox', { name: /Search indicators/i }), { target: { value: q } })
      const row = await waitFor(() => {
        const r = resultRows().find((li) => li.dataset.resultKind === 'security'
          && primaryOf(li).textContent.includes(company))
        expect(r, `no browse-shape ${ticker} row`).toBeTruthy()
        return r
      })
      const span = tickerSpan(row, ticker)
      expect(span, `no ${ticker} tag on the row`).toBeTruthy()
      expect(!!span.closest('[aria-hidden="true"]'), computeAccessibleName(primaryOf(row))).toBe(hidden)
      expect(labelInNameBreaks([row])).toEqual([])
    })
})

// ─── 3. CHART SETTINGS IS A REAL MODAL ──────────────────────────────────────
function Host({ withRef = true, under = null }) {
  const [open, setOpen] = useState(false)
  const gearRef = useRef(null)
  return (
    <>
      {under}
      <main>
        <button type="button" data-testid="gear" ref={gearRef}
          onClick={(e) => { gearRef.current = e.currentTarget; setOpen(true) }}>Chart settings</button>
        <button type="button">Behind</button>
      </main>
      <ChartSettingsModal open={open} onClose={() => setOpen(false)} settings={base()}
        onChange={vi.fn()} returnFocusRef={withRef ? gearRef : null} />
    </>
  )
}
const dialog = () => screen.queryByRole('dialog', { name: 'Chart settings' })

describe('Chart Settings manages focus like the repo\'s Sheet', () => {
  it('opening moves focus INTO the dialog (a click does not focus the gear in WebKit)', () => {
    render(<Host />)
    // fireEvent.click, not user.click: no focus moves to the gear, which is WebKit.
    fireEvent.click(screen.getByTestId('gear'))
    expect(dialog()).toBeTruthy()
    expect(dialog().contains(document.activeElement), `focus is on ${document.activeElement?.tagName}`).toBe(true)
  })

  it('the page behind is inert while open, and live again after', () => {
    render(<Host />)
    fireEvent.click(screen.getByTestId('gear'))
    expect(screen.getByText('Behind').closest('[inert]'), 'the page behind is still live').toBeTruthy()
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(dialog()).toBeNull()
    expect(screen.getByText('Behind').closest('[inert]')).toBeNull()
  })

  it('Tab wraps inside the dialog in both directions', async () => {
    const user = userEvent.setup()
    render(<Host />)
    fireEvent.click(screen.getByTestId('gear'))
    const nodes = focusableWithin(dialog())
    expect(nodes.length).toBeGreaterThan(3)
    nodes[nodes.length - 1].focus()
    await user.tab()
    expect(document.activeElement).toBe(nodes[0])
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(nodes[nodes.length - 1])
  })

  it('Escape returns focus to the gear, not <body>', async () => {
    const user = userEvent.setup()
    render(<Host />)
    fireEvent.click(screen.getByTestId('gear'))
    await user.keyboard('{Escape}')
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('gear'))
  })

  it('without a host ref, focus returns to whatever held it at open', async () => {
    const user = userEvent.setup()
    render(<Host withRef={false} />)
    const gear = screen.getByTestId('gear')
    gear.focus()
    await user.keyboard('{Enter}')
    expect(dialog()).toBeTruthy()
    expect(document.activeElement).not.toBe(gear)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(document.activeElement).toBe(gear)
  })
})

// ─── 5. THE SHORT TAG'S CONTRAST ────────────────────────────────────────────
// jsdom computes no styles, so this reads the two stylesheets the browser
// composes: the rule's own colour TOKEN, resolved from tokens.css against
// --menu-bg, and the `opacity` that composited it down to #727278 (4.03:1).
describe('the Add surface short tag meets WCAG AA (4.5:1)', () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url))
  const css = readFileSync(path.join(HERE, 'ChartSettingsModal.module.css'), 'utf8').replace(/\r\n/g, '\n')
  const tokens = readFileSync(path.join(HERE, '..', '..', 'styles', 'tokens.css'), 'utf8')
  const token = (name) => tokens.match(new RegExp(`${name}:[ \\t]*(#[0-9a-fA-F]{6})`))[1]
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const mix = (fg, bg, a) => '#' + [1, 3, 5].map((i) => Math.round(
    parseInt(fg.slice(i, i + 2), 16) * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a),
  ).toString(16).padStart(2, '0')).join('')
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const rule = () => {
    const at = css.indexOf('.insAdd .resShort {')
    expect(at, 'the .insAdd .resShort rule is gone').toBeGreaterThan(-1)
    return css.slice(at, css.indexOf('}', at)).replace(/\/\*[\s\S]*?\*\//g, '')
  }

  it('CONTROL: the shipped values compute to the measured 4.03:1', () => {
    expect(mix('#93939a', '#0e0e10', 0.75)).toBe('#727278')
    expect(ratio('#727278', '#0e0e10')).toBeLessThan(4.5)
  })

  it('the rule uses a token, and the composited colour clears 4.5:1', () => {
    const body = rule()
    const tok = body.match(/color:\s*var\((--[\w-]+)/)
    expect(tok, 'the tag colour is not a design token').toBeTruthy()
    const op = body.match(/opacity:\s*([\d.]+)/)
    const fg = mix(token(tok[1]), token('--menu-bg'), op ? Number(op[1]) : 1)
    expect(ratio(fg, token('--menu-bg'))).toBeGreaterThanOrEqual(4.5)
  })
})

// ─── 3b. A MODAL OVER A MODAL, AND THE LAYERS THIS ONE OPENS ────────────────
// The ticker popup consumes the same shared trap, registered FIRST on document
// capture, and its chart can open Chart Settings above it (right-click "Chart
// settings", Alt+,). The popup is then inert; its trap must not keep the Tab.
function PopupLike() {
  const ref = useRef(null)
  useFocusTrap(true, ref)
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Ticker popup" tabIndex={-1}>
      <button type="button">popup-first</button>
      <button type="button">popup-last</button>
    </div>
  )
}

describe('Chart Settings over another trapped dialog, and its own popouts', () => {
  it('⛔ Tab moves FORWARD through Chart Settings while the popup beneath is trapped', async () => {
    const user = userEvent.setup()
    render(<Host under={<PopupLike />} />)
    fireEvent.click(screen.getByTestId('gear'))
    expect(screen.getByText('popup-first').closest('[inert]'), 'the popup beneath is not inert').toBeTruthy()
    const nodes = focusableWithin(dialog())
    nodes[1].focus()
    await user.tab()
    expect(document.activeElement, `Tab went to ${document.activeElement?.textContent}`).toBe(nodes[2])
    await user.tab()
    expect(document.activeElement).toBe(nodes[3])
  })

  it('the trap STANDS DOWN while the colour panel is open, so Tab can walk it', async () => {
    const user = userEvent.setup()
    render(<Host />)
    fireEvent.click(screen.getByTestId('gear'))
    const swatch = dialog().querySelector('[data-color-swatch]')
    expect(swatch, 'no colour swatch on the opening tab').toBeTruthy()
    fireEvent.click(swatch)
    const panel = document.body.querySelector('[data-color-panel]')
    expect(panel, 'the colour panel did not open').toBeTruthy()
    expect(dialog().contains(panel)).toBe(false)
    const ring = focusableWithin(panel)
    expect(ring.length).toBeGreaterThan(2)
    ring[0].focus()
    await user.tab()
    expect(document.activeElement, 'Tab did not walk on inside the colour panel').toBe(ring[1])
  })
})
