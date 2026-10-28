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
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { computeAccessibleName } from 'dom-accessibility-api'
import IndicatorLibraryDialog from './IndicatorLibraryDialog'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import * as engineRegistry from './engine/nativeRegistry'
import { focusableWithin } from '../mobile/useFocusTrap'
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

  it('axe finds no keyboard or structure violations in the list', async () => {
    mount()
    const { violations } = await runAxe(screen.getByTestId('chart-structure'))
    expect(violations, formatViolations(violations)).toEqual([])
  })
})

// ─── 2. RESULT ROWS SAY THEIR NAME ONCE ─────────────────────────────────────
/** A name that ends by repeating a word or tail it already said: "TRIX TRIX",
 *  "Parabolic SAR SAR", "Average Directional Index ADX" is not caught here
 *  (different words) — the exact-name assertions below cover that kind. */
const stutters = (name) => {
  const w = name.trim().split(/\s+/)
  return w.length > 1 && w[w.length - 1] === w[w.length - 2]
}

describe('a result row\'s accessible name is the indicator name, once', () => {
  it('Indicator library: exact names, and the short tag is still on screen', () => {
    render(<IndicatorLibraryDialog open onClose={() => {}} settings={base()}
      onChange={vi.fn()} registry={engineRegistry} />)
    for (const name of ['Parabolic SAR', 'TRIX', 'SuperTrend', 'Average Directional Index']) {
      const btn = screen.getByRole('button', { name })
      expect(btn.matches('[data-result-primary]')).toBe(true)
      // still VISIBLE: the tag is in the button, just not in its name
      expect(btn.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBeTruthy()
    }
    const names = resultRows(screen.getByRole('dialog')).map((r) => computeAccessibleName(primaryOf(r)))
    expect(names.length).toBeGreaterThan(20)
    expect(names.filter(stutters)).toEqual([])
  })

  it('Add surface in Chart Settings: exact names for indicator rows', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Indicators' }))
    if (!document.body.querySelector('[data-testid="add-surface"]')) fireEvent.click(screen.getByTestId('add-enter'))
    const surface = screen.getByTestId('add-surface')
    fireEvent.change(screen.getByRole('searchbox', { name: /Search indicators/i }), { target: { value: 'sar' } })
    expect(screen.getByRole('button', { name: 'Parabolic SAR' }).matches('[data-result-primary]')).toBe(true)
    fireEvent.change(screen.getByRole('searchbox', { name: /Search indicators/i }), { target: { value: 'trix' } })
    expect(screen.getByRole('button', { name: 'TRIX' }).matches('[data-result-primary]')).toBe(true)
    const names = resultRows(surface).map((r) => computeAccessibleName(primaryOf(r)))
    expect(names.filter(stutters)).toEqual([])
  })
})

// ─── 3. CHART SETTINGS IS A REAL MODAL ──────────────────────────────────────
function Host({ withRef = true }) {
  const [open, setOpen] = useState(false)
  const gearRef = useRef(null)
  return (
    <>
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
