import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const navSpy = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navSpy }))

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AskCitationView from './AskCitationView'
import { ASK_CITATION_TYPE } from '../../lib/askInsert'
import styles from './AskCitationView.module.css'
import askStyles from './AskPanel.module.css'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** The touch tier's rules, `{ selector: body }`, comments stripped. */
function touchRules() {
  const css = fs.readFileSync(path.join(HERE, 'AskCitationView.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const touch = /@media \(max-width: 1024px\) \{([\s\S]*)\}\s*$/.exec(css)?.[1] || ''
  const out = {}
  for (const [, sel, body] of touch.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out[sel.trim()] = body
  return out
}

const node = (attrs = {}) => ({ attrs: {
  n: 1, label: 'NVDA thesis', nav: { kind: 'note', note_id: 'n1' }, citation: 'exact', claim: 'x', ...attrs,
} })

beforeEach(() => navSpy.mockClear())

describe('AskCitationView', () => {
  it('renders [n] and names its source', () => {
    render(<AskCitationView node={node()} decorations={[]} />)
    expect(screen.getByRole('button', { name: 'Source 1: NVDA thesis' })).toHaveTextContent('[1]')
  })

  it('opens the cited note', () => {
    render(<AskCitationView node={node()} decorations={[]} />)
    fireEvent.click(screen.getByRole('button'))
    expect(navSpy).toHaveBeenCalledWith('/journal/notebook?note=n1')
  })

  it('a stale chip says "edited" in visible text and in its name', () => {
    render(<AskCitationView node={node()} decorations={[{ spec: { askStale: true } }]} />)
    const b = screen.getByRole('button')
    expect(b).toHaveTextContent('[1 · edited]')
    expect(b).toHaveAccessibleName('Source 1: NVDA thesis, text edited since inserted')
  })

  it('insert-time precision is stated in words', () => {
    render(<AskCitationView node={node({ citation: 'page_only' })} decorations={[]} />)
    expect(screen.getByRole('button')).toHaveAccessibleName('Source 1: NVDA thesis, page only')
  })

  // G-064 final fix wave (I3) — on touch, AskPanel gives .citationChip a 44px
  // min-height, which on this inline <button> grew every prose line holding a
  // chip. The note-scoped override in AskCitationView.module.css can only match
  // if the element carries its local class, and must keep a >=44px target via
  // an out-of-flow ::after. jsdom does no layout, so this pins DECLARATIONS:
  // the wiring (class on the element) and the rule (inside the touch tier).
  it('the chip carries the note-scoped class, and the touch rule drops the floor but keeps an out-of-flow target', () => {
    render(<AskCitationView node={node()} decorations={[]} />)
    const b = screen.getByRole('button')
    expect(styles.chip).toBeTruthy()
    expect(b.className).toContain(askStyles.citationChip)
    expect(b.className).toContain(styles.chip)

    const rule = touchRules()
    expect(rule['.wrap .chip']).toMatch(/min-height:\s*0;/)
    expect(rule['.wrap .chip']).toMatch(/line-height:\s*inherit;/)
    expect(rule['.wrap button.chip::after']).toMatch(/position:\s*absolute;/)
  })

  // G-064 close-out (review Important #2) — EVERY chip is positioned, the
  // <span> chip of a source with no note included. A non-positioned box paints
  // below every positioned one, so an earlier button chip's ::after covered a
  // later span chip's own box: tapping `[7]` (an excerpt) opened source 6.
  // `position: relative` sits on `.wrap .chip`, the rule both kinds match, and
  // the span chip carries the class that rule needs.
  it('every chip is positioned on touch, the no-note <span> chip included', () => {
    const rule = touchRules()
    expect(rule['.wrap .chip']).toMatch(/position:\s*relative;/)
    render(<AskCitationView node={node({ nav: null })} decorations={[]} />)
    const span = screen.getByText('Source 1: NVDA thesis').parentElement
    expect(span.tagName).toBe('SPAN')
    expect(span.className).toContain(styles.chip)
    expect(span.parentElement.className).toContain(styles.wrap)
  })

  // G-064 close-out — a tap on a chip's OWN box must open that chip's source.
  // With the extension on all four sides, `[3]`'s ::after painted over the
  // right of `[2]` (positioned boxes paint in document order; a tap goes to
  // the topmost). The extension may reach only LATER content: never up, and
  // not left when the element before is another chip. jsdom does no layout,
  // so this pins the DECLARATIONS; AskCitationView.live.test.jsx pins the DOM
  // shape the adjacency selector depends on, against a real editor.
  it('the touch target never reaches earlier content: no upward extension, no left one after a chip', () => {
    const rule = touchRules()
    const after = rule['.wrap button.chip::after']
    expect(after).not.toMatch(/inset:/)
    const side = (body, name) => {
      const m = new RegExp(`(?:^|;|\\s)${name}:\\s*(-?\\d+)(?:px)?;`).exec(body)
      return m ? Number(m[1]) : null
    }
    const top = side(after, 'top')
    const right = side(after, 'right')
    const bottom = side(after, 'bottom')
    const left = side(after, 'left')
    expect(top).toBe(0)
    expect(right).toBeLessThan(0)
    expect(bottom).toBeLessThan(0)
    expect(left).toBeLessThan(0)

    const adjacent = `:global(.node-${ASK_CITATION_TYPE}) + :global(.node-${ASK_CITATION_TYPE}) .wrap button.chip::after`
    expect(Object.keys(rule)).toContain(adjacent)
    expect(side(rule[adjacent], 'left')).toBe(0)
    expect(rule[adjacent]).not.toMatch(/top:/)

    // Moved, not removed: at the SMALLEST MEASURED chip box the target still
    // clears the 44px floor, including a chip that has lost its left side.
    // Measured by the G-064 close-out review (review-polish.md, Minor #1,
    // Playwright getBoundingClientRect): `[1]` is 30.3px wide in Segoe UI and
    // system-ui (Chromium) and 31.4px in WebKit; the box is 23.5px tall in
    // Chromium and 23px in WebKit. A narrower measurement belongs here, and
    // turns this red.
    const BOX_H = 23
    const BOX_W = 30.3
    expect(BOX_H - top - bottom).toBeGreaterThanOrEqual(44)
    expect(BOX_W - right).toBeGreaterThanOrEqual(44)
    expect(BOX_W - left - right).toBeGreaterThanOrEqual(44)
  })

  // G-064 final fix wave — `{}['constructor']` is a truthy function; a stored
  // precision naming a prototype key must read "unavailable".
  it('a precision that names a prototype key reads "unavailable", never a function', () => {
    render(<AskCitationView node={node({ citation: 'constructor' })} decorations={[]} />)
    expect(screen.getByRole('button')).toHaveAccessibleName('Source 1: NVDA thesis, unavailable')
  })

  it('a source with no note is not clickable, and a shared copy (attrs reduced to n) still reads', () => {
    render(<AskCitationView node={{ attrs: { n: 2 } }} decorations={[]} />)
    expect(screen.queryByRole('button')).toBeNull()
    // G-064 fix round 1 (Finding F6): the visible glyph is aria-hidden so a
    // screen reader hears only the sr-only description, once.
    expect(screen.getByText('[2]')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Source 2: source')).toBeInTheDocument()
  })

  // G-064 fix round 1 (Finding F4): a shared/reduced copy can carry no `n` at
  // all -- render "?", matching renderHTML's `[${n ?? '?'}]` server-render
  // fallback, never "[null]" or "Source undefined: …".
  it('renders "?" when n is null or undefined, consistent with renderHTML', () => {
    render(<AskCitationView node={{ attrs: { n: null } }} decorations={[]} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('[?]')).toBeInTheDocument()
    expect(screen.getByText('Source ?: source')).toBeInTheDocument()
  })

  it('renders "?" when n is undefined (attrs missing the key entirely)', () => {
    render(<AskCitationView node={{ attrs: {} }} decorations={[]} />)
    expect(screen.getByText('[?]')).toBeInTheDocument()
    expect(screen.getByText('Source ?: source')).toBeInTheDocument()
  })
})
