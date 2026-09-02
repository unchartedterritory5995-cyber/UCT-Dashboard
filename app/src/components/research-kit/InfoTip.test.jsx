import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import InfoTip, { normalizeInfo } from './InfoTip'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('InfoTip', () => {
  it('renders nothing without text', () => {
    const { container } = render(<InfoTip label="About X" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a UIcon svg trigger, not an emoji character', () => {
    const { container } = render(<InfoTip label="About Setup Grade" text="Explains it." />)
    const btn = screen.getByRole('button', { name: 'About Setup Grade' })
    expect(btn.querySelector('svg')).not.toBeNull()
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}ℹⓘ]/u)
  })

  it('is closed at rest and opens on click', () => {
    render(<InfoTip label="About X" text="Priced through Fri Aug 8." />)
    const btn = screen.getByRole('button', { name: 'About X' })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Priced through Fri Aug 8.')
  })

  it('describes the trigger while open', () => {
    render(<InfoTip label="About X" text="Body copy." />)
    const btn = screen.getByRole('button', { name: 'About X' })
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
  })

  it('renders the methodology link only when href is given', () => {
    const { rerender } = render(<InfoTip label="A" text="Body." />)
    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()

    // Same component at the same position, so React preserves the open state —
    // do NOT click again here or the tip toggles shut.
    rerender(<InfoTip label="A" text="Body." href="/methodology#setup-grade" />)
    const link = screen.getByRole('link', { name: 'How this is computed →' })
    expect(link.getAttribute('href')).toBe('/methodology#setup-grade')
  })

  it('closes on Escape and on an outside click', () => {
    render(
      <div>
        <InfoTip label="A" text="Body." />
        <button type="button">elsewhere</button>
      </div>,
    )
    const btn = screen.getByRole('button', { name: 'A' })

    fireEvent.click(btn)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.click(btn)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  // M4 — viewport collision. jsdom never lays anything out, so
  // getBoundingClientRect()/clientWidth default to zero; both tests pin
  // document.documentElement.clientWidth to a realistic viewport so the
  // comparison is meaningful, then control the popover's own rect.
  it('keeps left alignment by default when the popover fits the viewport', () => {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1024)
    render(<InfoTip label="A" text="Body." />)
    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    const pop = screen.getByRole('tooltip')
    // Unmocked jsdom rect (all zeros) never overflows a 1024px viewport.
    expect(pop.className).not.toMatch(/alignRight/)
  })

  it('adds alignRight when the popover would overflow the viewport', () => {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1024)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 900,
      y: 0,
      top: 0,
      left: 900,
      right: 1200,
      bottom: 40,
      width: 300,
      height: 40,
      toJSON() {},
    })
    render(<InfoTip label="A" text="Body." />)
    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    const pop = screen.getByRole('tooltip')
    expect(pop.className).toMatch(/alignRight/)
  })
})

describe('normalizeInfo — one copy of the shape rule (§3.4)', () => {
  it('lifts a bare string into { text }', () => {
    expect(normalizeInfo('what is this')).toEqual({ text: 'what is this' })
  })

  it('passes an object through untouched', () => {
    const o = { text: 'x', href: '/methodology', hrefLabel: 'How →' }
    expect(normalizeInfo(o)).toBe(o)
  })

  it('is null for anything without text', () => {
    expect(normalizeInfo('')).toBeNull()
    expect(normalizeInfo(null)).toBeNull()
    expect(normalizeInfo(undefined)).toBeNull()
    expect(normalizeInfo({})).toBeNull()
    expect(normalizeInfo({ href: '/x' })).toBeNull()
  })
})

// The 44px tap floor cannot be asserted by measurement here: jsdom does no
// layout, so clientWidth/getBoundingClientRect() are 0 for every element and a
// size assertion would pass whatever the CSS says. The contract is therefore
// checked against the stylesheet SOURCE — the same technique as
// toneClasses.test.js and styles/tokens.test.js.
//
// The path is routed through a variable (not a `new URL('literal.css', ...)`
// string literal) — Vite's import-analysis plugin statically rewrites a
// literal `new URL('*.css', import.meta.url)` into an asset-URL reference
// (the same feature it uses for `new URL('./img.png', import.meta.url)`
// asset imports), which is not a `file:` URL and makes fileURLToPath throw
// "The URL must be of scheme file". A variable first argument isn't
// statically analyzable, so Vite leaves it alone — the exact indirection
// toneClasses.test.js and styles/tokens.test.js already rely on.
describe('InfoTip.module.css — touch tap target without a row jump', () => {
  const cssRelPath = './InfoTip.module.css'
  const CSS = readFileSync(fileURLToPath(new URL(cssRelPath, import.meta.url)), 'utf8')
  const touchBlock = /@media\s*\(max-width:\s*1024px\)\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? ''

  // Wave 17 swapped the ::after pseudo-expander for PADDING + negative-margin
  // expansion: the hit area is identical, but padding also grows the button's
  // measured rect, so the mobile-audit harness (which reads
  // getBoundingClientRect) can PROVE the floor instead of flagging the 16px
  // glyph as a false positive forever. The floor is derived from the sheet's
  // own numbers, not retyped: glyph + 2×padding must reach 44.
  it('meets the tap floor with measurable hit-box expansion (padding), layout-cancelled by equal negative margin', () => {
    const pad = Number(/padding:\s*(\d+)px/.exec(touchBlock)?.[1])
    const neg = Number(/(?<!-)margin:\s*-(\d+)px/.exec(touchBlock)?.[1])
    const glyph = Number(/\.trigger\s*\{[^}]*?width:\s*(\d+)px/.exec(CSS)?.[1])
    expect(pad).toBeGreaterThan(0)
    expect(neg).toBe(pad) // layout-neutral: the margin cancels exactly what the padding adds
    expect(glyph + 2 * pad).toBeGreaterThanOrEqual(44)
    // The base margin-left spacing must survive the blanket negative margin.
    expect(touchBlock).toMatch(new RegExp(`margin-left:\\s*calc\\(var\\(--space-xs\\) - ${pad}px\\)`))
  })

  it('the folded-away ::after expander stays gone (stacked with padding it would double the reach)', () => {
    expect(CSS).not.toMatch(/\.trigger::after/)
  })

  it('never sizes the trigger BOX to --tap-min (that is what jumped the row)', () => {
    const triggerRule = /\.trigger\s*\{([^}]*)\}/g
    for (const m of CSS.matchAll(triggerRule)) {
      expect(m[1]).not.toMatch(/(width|height):\s*var\(--tap-min\)/)
    }
  })

  it('positions the trigger so the expander can centre on it', () => {
    expect(/\.trigger\s*\{[^}]*position:\s*relative/.test(CSS)).toBe(true)
  })
})
