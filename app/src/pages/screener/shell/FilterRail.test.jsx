import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FilterRail from './FilterRail'

const META = {
  categories: [{ key: 'descriptive', label: 'Descriptive' }, { key: 'momentum', label: 'Momentum' }],
  filters: [
    { key: 'price', label: 'Price', category: 'descriptive', type: 'range', allow_custom: true, presets: [{ label: 'Any' }] },
    { key: 'sector', label: 'Sector', category: 'descriptive', type: 'enum', presets: [{ label: 'Any' }] },
    { key: 'pole_pct', label: 'Prior Run (Pole %)', category: 'momentum', type: 'range', allow_custom: true, presets: [{ label: 'Any' }] },
  ],
}

beforeEach(() => localStorage.clear())

describe('FilterRail', () => {
  it('renders every category the server sends — nothing hardcoded', () => {
    render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    expect(screen.getByRole('button', { name: /descriptive/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /momentum/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Price')).toBeInTheDocument()
  })

  it('collapsing a group hides its controls and persists', () => {
    const { unmount } = render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /descriptive/i }))
    expect(screen.queryByLabelText('Price')).toBeNull()
    unmount()
    render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    expect(screen.queryByLabelText('Price')).toBeNull()   // remembered closed
    expect(screen.getByLabelText('Prior Run (Pole %)')).toBeInTheDocument()
  })

  it('search narrows by label and reaches inside collapsed groups', () => {
    render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /momentum/i }))          // collapse
    fireEvent.change(screen.getByLabelText('Find a filter'), { target: { value: 'pole' } })
    expect(screen.getByLabelText('Prior Run (Pole %)')).toBeInTheDocument()     // force-open
    expect(screen.queryByLabelText('Price')).toBeNull()                          // no match
    expect(screen.queryByRole('button', { name: /descriptive/i })).toBeNull()   // empty group hidden
  })

  it('active counts pip the group head and Clear N clears', () => {
    const onClear = vi.fn()
    render(<FilterRail meta={META} activeFilters={{ price: { op: 'gte', min: 10 } }}
      onChange={() => {}} onClear={onClear} />)
    expect(screen.getByRole('button', { name: /descriptive/i })).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('button', { name: /clear 1/i }))
    expect(onClear).toHaveBeenCalled()
  })

  // Wave A (A9 — Screening) — "keyboard-driven filter editing", the one piece
  // of that wave genuinely missing (live match-count + saved-screen addressing
  // were both already shipped separately — see the roadmap's own §4 record).
  // Mirrors Settings.jsx's `/`-focuses-search + arrow-nav idiom exactly.
  describe('keyboard-driven filter editing', () => {
    // jsdom ships no scrollIntoView (see the class-wide note this repo already
    // carries in e.g. hub/sections/wireSection.test.jsx) — stub it here rather
    // than let the highlight-move guard skip real behaviour under test.
    beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
    afterEach(() => { delete Element.prototype.scrollIntoView })

    // ⛔ CSS-module classes are hashed under vitest (see this file's own
    // `.toMatch(/railMatchCountEmpty/)` above) — never a literal `.railFilterActive`
    // selector. Read the highlight off the `data-filter-key` wrapper instead.
    const activeFilterKey = () => {
      for (const el of document.querySelectorAll('[data-filter-key]')) {
        if (/railFilterActive/.test(el.className)) return el.getAttribute('data-filter-key')
      }
      return null
    }

    it('"/" focuses the filter search on the desktop rail, never the sheet variant', () => {
      render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
      fireEvent.keyDown(window, { key: '/' })
      expect(document.activeElement).toBe(screen.getByLabelText('Find a filter'))
    })

    it('never wires the global "/" shortcut for the sheet variant', () => {
      render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} variant="sheet" />)
      fireEvent.keyDown(window, { key: '/' })
      expect(document.activeElement).not.toBe(screen.getByLabelText('Find a filter'))
    })

    it('"/" is ignored while another field already has focus', () => {
      render(
        <div>
          <input data-testid="external" />
          <FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />
        </div>,
      )
      const external = screen.getByTestId('external')
      external.focus()
      fireEvent.keyDown(window, { key: '/' })
      expect(document.activeElement).toBe(external)
    })

    it('"/" is suspended while any Sheet-style dialog is open on the page', () => {
      render(
        <div>
          <div role="dialog">Structure library</div>
          <FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />
        </div>,
      )
      fireEvent.keyDown(window, { key: '/' })
      expect(document.activeElement).not.toBe(screen.getByLabelText('Find a filter'))
    })

    it('opens already highlighting the first visible filter, with nothing typed', () => {
      render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
      expect(activeFilterKey()).toBe('price')
    })

    it('arrow keys move the highlight through the visible filters, wrapping both ways', () => {
      render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
      const search = screen.getByLabelText('Find a filter')
      fireEvent.keyDown(search, { key: 'ArrowDown' })
      expect(activeFilterKey()).toBe('sector')
      fireEvent.keyDown(search, { key: 'ArrowDown' })
      expect(activeFilterKey()).toBe('pole_pct')
      fireEvent.keyDown(search, { key: 'ArrowDown' })          // wraps forward
      expect(activeFilterKey()).toBe('price')
      fireEvent.keyDown(search, { key: 'ArrowUp' })            // wraps backward
      expect(activeFilterKey()).toBe('pole_pct')
    })

    it('a collapsed group is never reachable by arrow key — it is not on screen', () => {
      render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
      fireEvent.click(screen.getByRole('button', { name: /momentum/i }))   // collapse momentum
      const search = screen.getByLabelText('Find a filter')
      fireEvent.keyDown(search, { key: 'ArrowDown' })
      expect(activeFilterKey()).toBe('sector')
      fireEvent.keyDown(search, { key: 'ArrowDown' })          // wraps straight back to price —
      expect(activeFilterKey()).toBe('price')                  // pole_pct is collapsed, not skipped-to
    })

    it('typing a query re-anchors the highlight to the first match', () => {
      render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
      fireEvent.change(screen.getByLabelText('Find a filter'), { target: { value: 'pole' } })
      expect(activeFilterKey()).toBe('pole_pct')
    })

    it('Enter moves real keyboard focus into the highlighted filter\'s own control', () => {
      render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
      const search = screen.getByLabelText('Find a filter')
      fireEvent.change(search, { target: { value: 'pole' } })
      fireEvent.keyDown(search, { key: 'Enter' })
      expect(document.activeElement).toBe(screen.getByLabelText('Prior Run (Pole %)'))
    })

    it('Escape clears a query first; a second Escape blurs the (now empty) search', () => {
      render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
      const search = screen.getByLabelText('Find a filter')
      search.focus()
      fireEvent.change(search, { target: { value: 'pole' } })
      fireEvent.keyDown(search, { key: 'Escape' })
      expect(search.value).toBe('')
      expect(document.activeElement).toBe(search)
      fireEvent.keyDown(search, { key: 'Escape' })
      expect(document.activeElement).not.toBe(search)
    })
  })

  // PACKET-AB CP1 (fingerprint bc19457cf) — the preview-count badge
  describe('match-count badge', () => {
    it('renders nothing when the count has never loaded', () => {
      const { container } = render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
      expect(container.querySelector('[data-testid="filter-rail"]').textContent).not.toMatch(/matches|Scanning/)
    })

    it('shows "Scanning…" while loading and no count has arrived yet', () => {
      render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}}
        matchCountLoading />)
      expect(screen.getByText('Scanning…')).toBeInTheDocument()
    })

    it('renders the match count once it arrives, formatted with a thousands separator', () => {
      render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}}
        matchCount={1234} matchCountEmpty={false} />)
      expect(screen.getByText('1,234 matches')).toBeInTheDocument()
    })

    it('a zero-match count is styled distinctly (visually flagged, still no aria-live)', () => {
      render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}}
        matchCount={0} matchCountEmpty />)
      const el = screen.getByText('0 matches')
      expect(el.className).toMatch(/railMatchCountEmpty/)
    })

    it('⛔ NEVER carries aria-live — that stays ShellToolbar\'s alone (screener_ui_stress.py collision)', () => {
      const { container } = render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}}
        matchCount={5} matchCountEmpty={false} />)
      expect(container.querySelector('[aria-live]')).toBeNull()
    })
  })
})
