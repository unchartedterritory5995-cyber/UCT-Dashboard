import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import BuzzRender from '../BuzzRender'

// ⚠️ DEVIATION FROM THE TASK BRIEF'S STEP-6 SNIPPET — disclosed in
// task-8-report.md. The brief's literal test text ("14 ppl", a separate
// 🔥-prefixed "heat line" reading "PLTR 6.3x") encodes the pre-reference
// Step-4 skeleton JSX, not the owner-reviewed v4 reference this component
// actually renders (which says "14 people", has NO emoji anywhere, and shows
// heat as a per-row "▲ 6.3×" marker using the multiplication sign, not the
// letter "x"). This file tests the REAL rendered behaviour instead.
const PAYLOAD = {
  window: 'open', label: 'since the open',
  rows: [{ ticker: 'NVDA', people: 14, mentions: 47, spark: [1, 2, 3] }],
  heat: [{ ticker: 'PLTR', ratio: 6.3 }],
  coverage: 'counted through 3:58p', asOf: 1,
}

const HOT_ROW_PAYLOAD = {
  window: 'open', label: 'since the open',
  rows: [
    { ticker: 'NVDA', people: 14, mentions: 47, spark: [1, 2, 3], hot: null },
    { ticker: 'PLTR', people: 5, mentions: 19, spark: [1, 2, 3], hot: 6.3 },
  ],
  heat: [{ ticker: 'PLTR', ratio: 6.3 }],
  coverage: 'counted through 3:58p', asOf: 1,
}

beforeEach(() => {
  window.__buzzReady = undefined
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(PAYLOAD) })))
})

describe('BuzzRender', () => {
  it('renders a row per ticker with people and mentions', async () => {
    render(<BuzzRender />)
    // NVDA renders exactly ONCE — as the row symbol. (Before the 2026-09-01
    // prose-lead removal, NVDA also appeared in a lead sentence at the top,
    // which is why this used to assert mere PRESENCE via getAllByText rather
    // than a single unique match. With the lead gone, the row is the only
    // place NVDA can appear, so this now asserts the tighter, unique query.)
    expect(await screen.findByText('NVDA')).toBeInTheDocument()
    expect(screen.getByText('47')).toBeInTheDocument()
    // The people count used to render as the string "14 people" on EVERY row.
    // The v6 structure pass (owner, 2026-09-01) moved the word into a column
    // header that appears once, so the cell is now the bare figure — the
    // repeated noun was the third-most-repeated string on the board. Both
    // halves are asserted so a regression that drops the header (leaving a
    // naked "14" nobody can read) still fails.
    expect(screen.getByText('14')).toBeInTheDocument()
    expect(screen.getByText('PEOPLE')).toBeInTheDocument()
  })

  it('shows the heat marker on a row the heat board flagged', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(HOT_ROW_PAYLOAD) })))
    render(<BuzzRender />)
    // '▲ 6.3×' is unique to the row-level heat marker. (Before the
    // 2026-09-01 prose-lead removal, the lead's second sentence also named
    // this ratio, just without the ▲ glyph — that was the original source of
    // uniqueness. With the lead gone there is no other element rendering
    // this ratio at all, so the string is unambiguous on its own terms now.)
    expect(await screen.findByText('▲ 6.3×')).toBeInTheDocument()
  })

  it('labels the message count honestly', async () => {
    render(<BuzzRender />)
    // The store holds ONLY ticker-bearing rows, so a bare "318 messages" would
    // claim the board counted the whole room. It counted the subset that named
    // a stock, and the most prominent line on the image has to say so.
    // Case-insensitive since the v6 stat strip sets this label in caps.
    expect(await screen.findByText(/messages with tickers/i)).toBeInTheDocument()
  })

  it('scales the magnitude bar to the loudest row, not the first one', async () => {
    // The board ranks by DISTINCT PEOPLE, so the top row is not necessarily
    // the one with the most mentions — three people saying a name forty times
    // outranks nobody. Reading rows[0].mentions as the maximum would render a
    // bar WIDER THAN ITS TRACK on exactly the rows the board exists to
    // surface. This payload puts the loudest row second on purpose.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        window: 'open', label: 'since the open',
        rows: [
          { ticker: 'AAAA', people: 14, mentions: 10, spark: [1], hot: null },
          { ticker: 'BBBB', people: 5, mentions: 40, spark: [1], hot: null },
        ],
        coverage: 'counted through 3:58p', asOf: 1,
      }),
    })))
    const { container } = render(<BuzzRender />)
    await screen.findByText('AAAA')
    const bars = container.querySelectorAll('[data-buzz-bar]')
    expect(bars).toHaveLength(2)
    // Assert the RATIO and the unit separately: jsdom re-serializes CSS, so
    // the "100.0%" the component writes reads back as "100%". Pinning the
    // literal string would be a test of jsdom's serializer, not of the
    // scaling. The unit check keeps a px regression from passing on the float.
    expect(bars[0].style.width.endsWith('%')).toBe(true)
    expect(parseFloat(bars[1].style.width)).toBe(100)
    expect(parseFloat(bars[0].style.width)).toBe(25)
  })

  // ── The export container's geometry. Both halves of one guard.
  //
  // chart-renderer screenshots `#buzz-export`, so the id is a literal string —
  // but this page's stylesheet is a CSS MODULE, which scopes bare id selectors
  // exactly like classes. `#buzz-export { width: 1000px }` in the module
  // compiles to `#_buzz-export_<hash>` and matches nothing. It shipped that
  // way: the board stretched to chart-renderer's 1400px viewport instead of
  // its designed 1000px, doubling the row grid's `1fr` column and pushing the
  // people/heat cells ~800px from the count they annotate.
  //
  // ⛔ Neither test alone is the rail. jsdom computes no layout, so the first
  // one cannot tell a working stylesheet from a dead one — it only proves the
  // width is set INLINE, where css-modules cannot reach it. The second proves
  // nobody moved it back into the module, where it would be inert again.
  it('sets the export container geometry inline, where css-modules cannot scope it away', async () => {
    const { container } = render(<BuzzRender />)
    await screen.findByText('NVDA')
    const box = container.querySelector('#buzz-export')
    expect(box.style.width).toBe('1000px')
    // position/overflow travel with the width: .rose is absolutely positioned
    // and needs this element as its containing block, clipped to the board.
    expect(box.style.position).toBe('relative')
    expect(box.style.overflow).toBe('hidden')
  })

  it('declares no id selector in the CSS module, where it would be inert', () => {
    // Resolved from the vitest root (app/), not import.meta.url — the test
    // environment does not serve a file: URL there.
    const css = readFileSync(resolve('src/pages/BuzzRender.module.css'), 'utf8')
    // Strip comments first — this file DOCUMENTS the trap at length, and the
    // prose naturally contains the very string being searched for.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const idSelectors = code.match(/^\s*#[\w-]+/gm) || []
    expect(idSelectors).toEqual([])
  })

  it('does not claim ready before data arrives', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<BuzzRender />)
    expect(window.__buzzReady).toBeUndefined()
  })

  it('renders "Unavailable" rather than a blank board on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500 })))
    render(<BuzzRender />)
    expect(await screen.findByText('Unavailable')).toBeInTheDocument()
  })
})
