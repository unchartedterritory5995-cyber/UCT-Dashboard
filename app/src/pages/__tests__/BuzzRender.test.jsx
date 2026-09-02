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
    // 'PPL', not 'PEOPLE': the v8 two-column pass shortened every header to
    // fit a ~46%-width column. The rail is that SOME header still names the
    // figure -- a naked '14' is unreadable either way.
    expect(screen.getByText('PPL')).toBeInTheDocument()
  })

  it('splits the head rows into two columns whose ranks read DOWN, not across', async () => {
    // ⛔ THE COLUMNS ARE A HEIGHT FIX, AND THE RANKING MUST SURVIVE IT.
    // Discord scales a PORTRAIT attachment by HEIGHT into a landscape box, so
    // the 1338px board rendered ~262px wide and the bottom rows were
    // unreadable -- the owner's actual complaint. Two columns halve the height
    // at the same width. But a split that numbers ACROSS (01 02 / 03 04) makes
    // the highest-mention ticker sit beside the second instead of above it,
    // and the board stops reading as a ranking at all.
    //
    // Five rows on purpose: an ODD count is where a balanced split can put the
    // extra row on the wrong side and silently renumber everything after it.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        window: 'open', label: 'since the open',
        rows: [
          { ticker: 'AAA', people: 9, mentions: 50, spark: [1], hot: null },
          { ticker: 'BBB', people: 8, mentions: 40, spark: [1], hot: null },
          { ticker: 'CCC', people: 7, mentions: 30, spark: [1], hot: null },
          { ticker: 'DDD', people: 6, mentions: 20, spark: [1], hot: null },
          { ticker: 'EEE', people: 5, mentions: 10, spark: [1], hot: null },
        ],
        coverage: 'counted through 3:58p', asOf: 1,
      }),
    })))
    const { container } = render(<BuzzRender />)
    await screen.findByText('EEE')
    // Rank labels in DOM order must be 01..05 -- the left column's three rows
    // first, then the right column's two. Reading across would give 01 04 02
    // 05 03 here, so this ordering is what distinguishes the two designs.
    const ranks = [...container.querySelectorAll('[data-buzz-row]')]
      .map((el) => el.firstElementChild.textContent)
    expect(ranks).toEqual(['01', '02', '03', '04', '05'])
    // ...and the ticker beside each rank is the one the payload ranked there.
    const syms = [...container.querySelectorAll('[data-buzz-row]')]
      .map((el) => el.children[1].textContent)
    expect(syms).toEqual(['AAA', 'BBB', 'CCC', 'DDD', 'EEE'])
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

  it('never draws a bar that steps up below a higher-ranked row', async () => {
    // ⛔ THE BOARD MUST NOT CONTRADICT ITS OWN ORDER. The bar has to draw the
    // same quantity the rows are sorted by, whichever that is. It drew mentions
    // against a people-sorted board and stepped UP three times in fourteen rows
    // (DELL 8 people/18 mentions below COIN 9/9, nearly double the bar), which
    // reads as a sorting bug. Both are MENTIONS now (owner ruling 2026-09-02),
    // and this rail is what keeps them from drifting apart again.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        window: 'open', label: 'since the open',
        // Ordered as the API now returns it: mentions DESC, people as the
        // tiebreak. The rail is that the BAR follows that order.
        rows: [
          { ticker: 'LOUD', people: 4, mentions: 40, spark: [1], hot: null },
          { ticker: 'BROAD', people: 9, mentions: 9, spark: [1], hot: null },
        ],
        coverage: 'counted through 3:58p', asOf: 1,
      }),
    })))
    const { container } = render(<BuzzRender />)
    await screen.findByText('BROAD')
    const widths = [...container.querySelectorAll('[data-buzz-bar]')]
      .map((el) => parseFloat(el.style.width))
    expect(widths).toHaveLength(2)
    // The higher-ranked row must not have the shorter bar.
    expect(widths[0]).toBeGreaterThan(widths[1])
    expect(Math.max(...widths)).toBe(100)
  })

  // ⚰️ "scales the magnitude bar to the loudest row" lived here until
  // 2026-09-02. It asserted bars scale to max MENTIONS, which was right while
  // bars drew mentions and is wrong now that they draw PEOPLE -- the quantity
  // the board is ranked by. Its content is carried by the monotonicity rail
  // above, which is strictly stronger: a bar scaled to the wrong quantity
  // shows up as an ordering break. Removed rather than left contradicting it.

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

  it('publishes its declared width for the render probe, matching the inline style', async () => {
    // buzz_image.PROBE_JS measures the drawn board and compares it against
    // window.__buzzBoardW, then discards a PNG whose box does not match. That
    // makes this value the ONE authority for the board's width -- the Python
    // side deliberately does not restate it. If these two ever disagree the
    // probe starts discarding good boards, or passing bad ones.
    const { container } = render(<BuzzRender />)
    await screen.findByText('NVDA')
    const box = container.querySelector('#buzz-export')
    expect(window.__buzzBoardW).toBe(1000)
    expect(box.style.width).toBe(`${window.__buzzBoardW}px`)
  })

  it('renders every once-named ticker as its own readable chip', async () => {
    // ⛔ OWNER REQUIREMENT, 2026-09-02: "Cant see the bottom lesser important
    // shaded ones that we want seen. Even the 1-3 mentions people want to
    // see." They used to be one joined string at 10.5px / 36% opacity. A
    // single text node is not a list you can read, so this asserts they are
    // SEPARATE elements — the thing that makes them scannable.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        window: 'open', label: 'since the open',
        rows: [{ ticker: 'NVDA', people: 3, mentions: 9, spark: [1], hot: null }],
        tail: [{ ticker: 'AMD', mentions: 3 }],
        singles: ['ANET', 'PANW', 'ZS'],
        coverage: 'counted through 3:58p', asOf: 1,
      }),
    })))
    render(<BuzzRender />)
    for (const t of ['ANET', 'PANW', 'ZS']) {
      const el = await screen.findByText(t)
      expect(el).toBeInTheDocument()
      // each is its own node, not a fragment of a comma-run
      expect(el.textContent).toBe(t)
    }
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
