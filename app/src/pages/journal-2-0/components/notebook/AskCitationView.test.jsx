import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const navSpy = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navSpy }))

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AskCitationView from './AskCitationView'
import styles from './AskCitationView.module.css'
import askStyles from './AskPanel.module.css'

const HERE = path.dirname(fileURLToPath(import.meta.url))

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

    const css = fs.readFileSync(path.join(HERE, 'AskCitationView.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const touch = /@media \(max-width: 1024px\) \{([\s\S]*)\}\s*$/.exec(css)?.[1] || ''
    const rule = (sel) => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(touch)?.[1] || ''
    expect(rule('.wrap .chip')).toMatch(/min-height:\s*0;/)
    expect(rule('.wrap .chip')).toMatch(/line-height:\s*inherit;/)
    expect(rule('.wrap button.chip')).toMatch(/position:\s*relative;/)
    expect(rule('.wrap button.chip::after')).toMatch(/position:\s*absolute;/)
    expect(rule('.wrap button.chip::after')).toMatch(/inset:\s*-12px -8px;/)
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
