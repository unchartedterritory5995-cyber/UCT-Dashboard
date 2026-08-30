/**
 * Compare mode (spec §3) through the REAL container.
 *
 * `CompareGrid.test.jsx` proves the grid renders what it is handed;
 * `compareQuad.test.js` proves the quad rules. Neither can see the WIRE — a
 * grid could be perfect and the container could hand it the wrong bundle, or
 * mount a second scrubber, and both files would stay green. This one toggles
 * the layout a user toggles and reads the document.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

import { SWRConfig } from 'swr'
import BreadthViews from './BreadthViews'
import ScoreAttributionView from './views/ScoreAttributionView'
import { STYLES, VIEW_CONFIG } from './views/viewMetricConfig'
import { defaultQuad, COMPARE_PANES } from './compareQuad'
import { STORAGE_KEY } from './useBreadthViews'

// 40 real sessions, newest-first — deep enough for every lens' own minimum.
const rows = Array.from({ length: 40 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 7, 28) - i * 86400000)
  return {
    date: day.toISOString().slice(0, 10),
    breadth_score: 70 - (i % 9), uct_exposure: 60,
    pct_above_50sma: 60 - i, pct_above_200sma: 55, pct_above_5sma: 40,
    pct_above_10sma: 45, pct_above_20ema: 50, pct_above_40sma: 52, pct_above_100sma: 55,
    up_4pct_today: 300 - i, down_4pct_today: 100 + i,
    up_25pct_quarter: 40, down_25pct_quarter: 10, magna_up: 60, magna_down: 20,
    stage2_count: 300, stage4_count: 90,
    new_52w_highs: 40, new_52w_lows: 9, new_20d_highs: 120, new_20d_lows: 30,
    mcclellan_osc: 20 - i, vix: 16 + (i % 4), qqq_close: 400 + i,
    sp500_close: 5000 + i * 3, advancing: 3000, declining: 1500,
    rsp_spy_ratio: 0.62, iwm_qqq_ratio: 0.55, up_vol_ratio: 1.4,
  }
})

const SERVED = {
  ok: true, date: rows[0].date, total: 80, min_weight_met: true,
  components: [{ key: 'vix', label: 'VIX (inverted)', weight: 10, points: 9, max_points: 10, present: true }],
  prev: { date: rows[1].date, total: 70, components: [] },
  reference_date: rows[0].date,
  analogues: [{ date: rows[7].date, similarity: 92.4, forward_returns: { fwd_20d: 4.5 } }],
}

const realFetch = globalThis.fetch
let fetches
beforeEach(() => {
  localStorage.clear()
  fetches = []
  globalThis.fetch = vi.fn((url) => {
    fetches.push(String(url))
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SERVED) })
  })
})
afterEach(() => { globalThis.fetch = realFetch })

const toCompare = () => fireEvent.click(screen.getByTestId('layout-compare'))
const panes = () => screen.getAllByTestId(/^compare-pane-\d+$/)
const quadOnScreen = () => panes().map(p => p.getAttribute('data-pane-style'))

describe('the layout toggle', () => {
  it('starts in Single, showing one view and no grid', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    expect(screen.getByTestId('layout-single')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('compare-grid')).toBeNull()
  })

  it('renders exactly four panes in Compare, on four DISTINCT styles', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    toCompare()
    expect(panes()).toHaveLength(COMPARE_PANES)
    const q = quadOnScreen()
    expect(q).toEqual(defaultQuad())
    expect(new Set(q).size).toBe(COMPARE_PANES)
  })

  it('retires the style switcher instead of leaving it inert', () => {
    // In Compare the four pane pickers ARE the style control. A switcher left
    // on screen would offer sixteen choices and move nothing.
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    expect(screen.getByRole('group', { name: 'Visualization style' })).toBeTruthy()
    toCompare()
    expect(screen.queryByRole('group', { name: 'Visualization style' })).toBeNull()
  })

  it('goes back to Single with the same style it left', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    // Scoped to the switcher: the Customize trigger carries the same label.
    const switcher = () => within(screen.getByRole('group', { name: 'Visualization style' }))
    fireEvent.click(switcher().getByRole('button', { name: 'Regime Clock' }))
    toCompare()
    fireEvent.click(screen.getByTestId('layout-single'))
    expect(screen.queryByTestId('compare-grid')).toBeNull()
    expect(switcher().getByRole('button', { name: 'Regime Clock' }))
      .toHaveAttribute('aria-pressed', 'true')
  })
})

describe('one cursor, one window, one scrubber', () => {
  it('mounts ONE scrubber and ONE date header for the whole grid', () => {
    // ⛔ Four panes must not each grow their own copy: four controls over one
    // value is this repo's most repeated defect.
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    toCompare()
    expect(screen.getAllByTestId('scrubber')).toHaveLength(1)
    expect(screen.getAllByTestId('scrubber-range')).toHaveLength(1)
    expect(screen.getAllByTestId('cursor-date')).toHaveLength(1)
    for (const p of panes()) {
      expect(within(p).queryByTestId('scrubber')).toBeNull()
      expect(within(p).queryByTestId('cursor-date')).toBeNull()
    }
  })

  it('a seek inside one pane moves the cursor every pane reads', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    toCompare()
    fireEvent.change(screen.getByTestId('compare-pick-0'), { target: { value: 'ribbon' } })

    const cell = panes()[0].querySelector('[data-testid^="ribbon-cell-"]')
    const target = cell.getAttribute('data-seek-date')
    expect(target).not.toBe(screen.getByTestId('cursor-date').textContent)
    fireEvent.click(cell)

    expect(screen.getByTestId('cursor-date').textContent).toBe(target)
    expect(screen.getByTestId('scrubber-range').getAttribute('aria-valuetext')).toBe(target)
  })

  it('the arrow keys still drive the one cursor from compare mode', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    toCompare()
    expect(screen.getByTestId('cursor-date').textContent).toBe(rows[0].date)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByTestId('cursor-date').textContent).toBe(rows[1].date)
  })
})

describe('the pane picker is a view over the registry', () => {
  it('offers every style, with the registry’s labels, order and grouping', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    toCompare()
    const pick = screen.getByTestId('compare-pick-0')

    const values = [...pick.querySelectorAll('option')].map(o => o.value)
    expect(new Set(values)).toEqual(new Set(STYLES))
    for (const o of pick.querySelectorAll('option')) {
      expect(o.textContent).toBe(VIEW_CONFIG[o.value].label)
    }
    const groups = [...pick.querySelectorAll('optgroup')].map(g => g.label)
    expect(groups).toEqual(['Boards', 'Lenses'])
    // Order within each group is STYLES order, from viewsByKind().
    const boards = [...pick.querySelectorAll('optgroup')[0].querySelectorAll('option')].map(o => o.value)
    expect(boards).toEqual(STYLES.filter(s => VIEW_CONFIG[s].kind === 'board'))
  })

  it('picking an unused style replaces just that pane', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    toCompare()
    const before = quadOnScreen()
    fireEvent.change(screen.getByTestId('compare-pick-1'), { target: { value: 'treemap' } })
    const after = quadOnScreen()
    expect(after[1]).toBe('treemap')
    expect([after[0], after[2], after[3]]).toEqual([before[0], before[2], before[3]])
  })

  it('picking a style ALREADY on screen swaps the two panes, never duplicates', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    toCompare()
    const before = quadOnScreen()
    fireEvent.change(screen.getByTestId('compare-pick-0'), { target: { value: before[2] } })
    const after = quadOnScreen()
    expect(after[0]).toBe(before[2])
    expect(after[2]).toBe(before[0])
    expect(new Set(after).size).toBe(COMPARE_PANES)
  })
})

/**
 * 🔴 THE RAIL THIS WAVE WAS MOST LIKELY TO BREAK.
 *
 * `viewRegistry.test.jsx` proves no two DIFFERENT styles claim the same test id,
 * and it renders each style in its own document. Compare puts four in ONE
 * document, so the only remaining way to collide is the same style twice —
 * which `compareQuad.js` makes impossible. This asserts the consequence against
 * the real grid rather than trusting the argument, and it sweeps EVERY style
 * (four quads over sixteen) so no style is exempt.
 */
describe('four views in one document still own their ids', () => {
  const quads = Array.from({ length: Math.ceil(STYLES.length / COMPARE_PANES) },
    (_, i) => STYLES.slice(i * COMPARE_PANES, (i + 1) * COMPARE_PANES))

  it('covers all sixteen styles in four quads', () => {
    expect(quads.flat()).toEqual(STYLES)
    expect(quads.every(q => q.length === COMPARE_PANES)).toBe(true)
  })

  for (const quad of quads) {
    it(`renders [${quad.join(', ')}] with no duplicate test id`, () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        viewStyle: 'treemap', byView: {}, layout: 'compare', compare: quad,
      }))
      const { container } = render(<BreadthViews rows={rows} onDrill={() => {}} />)
      expect(quadOnScreen()).toEqual(quad)

      const seen = new Map()
      const dupes = []
      for (const el of container.querySelectorAll('[data-testid]')) {
        const id = el.getAttribute('data-testid')
        if (id === 'echart') continue                    // the stub at the top
        if (seen.has(id)) dupes.push(id)
        else seen.set(id, true)
      }
      // Non-vacuity: this quad really did paint ids, so an empty grid cannot
      // pass by rendering nothing.
      expect(seen.size, 'the grid rendered no test ids at all').toBeGreaterThan(10)
      expect([...new Set(dupes)], 'a query for these matches whichever pane '
        + 'mounted first').toEqual([])
    })
  }
})

/**
 * Wave A's roster: six styles render ONE row's snapshot and therefore carry no
 * per-session mark. Compare mode is the obvious way a snapshot view could
 * quietly acquire a fake affordance (a shared bundle is easy to over-fill), so
 * the same claim is re-checked inside a pane.
 */
describe('a pane does not invent a seek affordance', () => {
  const NO_MARK = ['treemap', 'rings', 'tug', 'meters', 'radar', 'equalizer']

  it('the six snapshot styles render zero marks in the grid, as in Single', () => {
    expect(NO_MARK.every(s => STYLES.includes(s))).toBe(true)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      viewStyle: 'treemap', byView: {}, layout: 'compare', compare: NO_MARK.slice(0, 4),
    }))
    const { container } = render(<BreadthViews rows={rows} onDrill={() => {}} />)
    expect(container.querySelectorAll('[data-seek-date]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-seek-idx]')).toHaveLength(0)
  })
})

describe('per-style options follow the style into whatever pane it sits in', () => {
  it('a pane paints with its OWN style’s saved palette, not the active one', () => {
    // Ocean is the palette no other palette can produce (viewRegistry.test.jsx
    // pins that). Save it on `ribbon` only, then put ribbon in pane 3 while the
    // active style is something else: the pane must be ocean.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      viewStyle: 'treemap',
      byView: { ribbon: { activePreset: 'Sea', presets: { Sea: { visible: ['pct_above_50sma', 'vix'], options: { palette: 'ocean' } } } } },
      layout: 'compare', compare: ['clock', 'divergence', 'events', 'ribbon'],
    }))
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    const ribbonPane = panes()[3]
    expect(ribbonPane.getAttribute('data-pane-style')).toBe('ribbon')
    const html = ribbonPane.innerHTML.toLowerCase()
    expect(html.includes('#22d3ee') || html.includes('rgb(34, 211, 238)')).toBe(true)
  })

  it('a pane draws its OWN style’s visible metrics, not the active style’s', () => {
    // The active style is Treemap, whose default is the FULL board; Meters is
    // saved down to two readings. A pane handed the active style's metric set
    // would draw fifty markers here, and every other assertion in this file
    // would still be green — the palette test above cannot see it, because
    // lenses ignore `metrics` entirely.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      viewStyle: 'treemap',
      byView: { meters: { activePreset: 'Two', presets: { Two: { visible: ['vix', 'breadth_score'], options: {} } } } },
      layout: 'compare', compare: ['meters', 'clock', 'events', 'analogues'],
    }))
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    const metersPane = panes()[0]
    expect(metersPane.getAttribute('data-pane-style')).toBe('meters')
    const markers = metersPane.querySelectorAll('[data-testid^="marker-"]')
    expect([...markers].map(m => m.getAttribute('data-testid')).sort())
      .toEqual(['marker-breadth_score', 'marker-vix'])
  })
})

/**
 * 🔴 COMPARE MODE USED TO HIDE CUSTOMIZE ENTIRELY, so a reader in the 2×2 could
 * not change ANY pane's options — the panel and the preset switcher simply were
 * not there. That was honest about a real limit (the hook's writes could only
 * target the single active style) but it left the reader with no way out except
 * leaving the layout.
 *
 * ⛔ AND A CONTROL THAT IS PRESENT BUT INERT WOULD HAVE BEEN WORSE — this tab
 * has already paid for that twice (the metric checklist on the lenses, the Event
 * Ledger's dead palette control). So the writes take a style now and the gear in
 * each pane's header edits THAT pane's style. These tests are about the wire:
 * the panel is real, it edits the right style, and what it writes is the same
 * per-style preset Single mode reads.
 */
describe('a pane can be customized without leaving compare mode', () => {
  const OCEAN = ['#22d3ee', 'rgb(34, 211, 238)']
  const paintsOcean = (el) => {
    const html = el.innerHTML.toLowerCase()
    return OCEAN.some(c => html.includes(c))
  }
  // Heat Ribbon in pane 0 on a custom preset — Default is immutable by design,
  // and editing it opens the Save-as prompt rather than changing anything.
  const seedRibbonPane = () => localStorage.setItem(STORAGE_KEY, JSON.stringify({
    viewStyle: 'treemap',
    byView: { ribbon: { activePreset: 'Mine',
                        presets: { Mine: { visible: ['pct_above_50sma', 'vix'], options: { palette: 'classic' } } } } },
    layout: 'compare', compare: ['ribbon', 'clock', 'events', 'analogues'],
  }))
  const openPanePanel = (i) => {
    fireEvent.click(screen.getByTestId(`compare-customize-${i}`))
    return screen.getByRole('dialog')
  }

  it('gives every pane a gear, and offers no inert page-level Customize beside it', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    toCompare()
    for (let i = 0; i < COMPARE_PANES; i++) {
      expect(screen.getByTestId(`compare-customize-${i}`)).toBeTruthy()
    }
    // The page-level trigger acted on the single active style; there isn't one
    // here, so it stays retired rather than sitting on screen doing nothing.
    expect(screen.queryByTitle('Customize this view')).toBeNull()
  })

  it('edits the pane’s OWN style, and leaves the other three alone', () => {
    seedRibbonPane()
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    const ribbonPane = () => panes()[0]
    expect(paintsOcean(ribbonPane()), 'the fixture starts ocean — it proves nothing').toBe(false)

    const dialog = openPanePanel(0)
    expect(dialog.getAttribute('aria-label')).toBe('Customize Heat Ribbon')
    fireEvent.change(within(dialog).getByLabelText('Color palette'), { target: { value: 'ocean' } })

    expect(paintsOcean(ribbonPane()), 'the pane ignored its own Customize').toBe(true)
    for (const other of panes().slice(1)) expect(paintsOcean(other)).toBe(false)
  })

  it('changes which metrics a pane draws, from inside the pane', () => {
    // The palette assertion above cannot see this: a pane handed the wrong
    // metric set still paints in the right colours.
    seedRibbonPane()
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    const vixCells = () => panes()[0].querySelectorAll('[data-testid^="ribbon-cell-vix-"]')
    expect(vixCells().length).toBeGreaterThan(0)

    const dialog = openPanePanel(0)
    const vixRow = [...dialog.querySelectorAll('label')].find(l => l.textContent === 'VIX')
    fireEvent.click(vixRow.querySelector('input'))
    expect(vixCells()).toHaveLength(0)
    // …and the metric it was not asked about is untouched.
    expect(panes()[0].querySelectorAll('[data-testid^="ribbon-cell-pct_above_50sma-"]').length)
      .toBeGreaterThan(0)
  })

  it('writes it to the STYLE’s preset, so Single mode opens on the same thing', () => {
    // ⛔ The point of per-style options: a pane edit is not pane-local scratch.
    seedRibbonPane()
    const { container } = render(<BreadthViews rows={rows} onDrill={() => {}} />)
    const dialog = openPanePanel(0)
    fireEvent.change(within(dialog).getByLabelText('Color palette'), { target: { value: 'ocean' } })

    fireEvent.click(screen.getByTestId('layout-single'))
    const switcher = within(screen.getByRole('group', { name: 'Visualization style' }))
    fireEvent.click(switcher.getByRole('button', { name: 'Heat Ribbon' }))
    expect(screen.getByTestId('ribbon-basis'), 'Single is not showing the ribbon').toBeTruthy()
    expect(paintsOcean(container)).toBe(true)
  })
})

describe('the quad persists', () => {
  it('a chosen quad and layout survive a remount', () => {
    const { unmount } = render(<BreadthViews rows={rows} onDrill={() => {}} />)
    toCompare()
    fireEvent.change(screen.getByTestId('compare-pick-2'), { target: { value: 'radar' } })
    const chosen = quadOnScreen()
    unmount()

    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    expect(screen.getByTestId('layout-compare')).toHaveAttribute('aria-pressed', 'true')
    expect(quadOnScreen()).toEqual(chosen)
  })
})

/**
 * ⭐ MEASURED, NOT ASSUMED (the brief asked for exactly this).
 *
 * Two of the sixteen styles fetch: Score Attribution
 * (`/score-components/{date}`) and Analogue Deck (`/analogues`). With both in
 * the grid, four live panes must still cost the two requests those two lenses
 * would each have cost alone.
 */
describe('what four live panes cost the network', () => {
  const urls = (frag) => fetches.filter(u => u.includes(frag))
  // `usePreferences` hits /api/auth/preferences on mount; it is the shell, not
  // a lens, and it is the same one request in Single mode.
  const lensCalls = () => fetches.filter(u => u.includes('/api/breadth-monitor'))

  it('four panes including BOTH fetching lenses issue one request each', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      viewStyle: 'treemap', byView: {},
      layout: 'compare', compare: ['attribution', 'analogues', 'clock', 'divergence'],
    }))
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    await screen.findByTestId('compare-pane-0')
    await new Promise(r => setTimeout(r, 0))

    expect(urls('score-components')).toHaveLength(1)
    expect(urls('analogues')).toHaveLength(1)
    // …and the two non-fetching lenses added nothing.
    expect(lensCalls()).toHaveLength(2)
  })

  it('the two silent lenses in a quad fetch nothing at all', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      viewStyle: 'treemap', byView: {},
      layout: 'compare', compare: ['clock', 'divergence', 'rotation', 'events'],
    }))
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    await screen.findByTestId('compare-pane-0')
    await new Promise(r => setTimeout(r, 0))
    expect(lensCalls()).toEqual([])
  })
})

/**
 * ⭐ THE DEDUPE ITSELF, MEASURED — because "SWR dedupes by key" is an assumption
 * until something counts.
 *
 * Compare mode cannot mount one style twice (`compareQuad.js` makes the quad a
 * set), so the case cannot arise through the grid. That is a structural claim,
 * and a structural claim is only worth as much as the property it rests on — so
 * the property is measured directly here, by mounting one fetching lens TWICE
 * on the same key and counting requests at `globalThis.fetch`.
 *
 * A fresh SWR cache per render (`provider: () => new Map()`) keeps an earlier
 * test in this file from making the count 0 for the wrong reason.
 */
describe('two mounts of one SWR key cost one request', () => {
  const lensProps = {
    rows, currentRow: rows[0], prevRow: rows[3], rowIdx: 0,
    onDrill: () => {}, onSeek: () => true, canSeek: () => true, options: {},
  }
  const isolated = (ui) => render(
    <SWRConfig value={{ provider: () => new Map() }}>{ui}</SWRConfig>)
  const settle = () => new Promise(r => setTimeout(r, 0))

  it('deduplicates two identical keys to ONE fetch', async () => {
    isolated(<><ScoreAttributionView {...lensProps} /><ScoreAttributionView {...lensProps} /></>)
    await settle()
    expect(fetches.filter(u => u.includes('score-components'))).toHaveLength(1)
  })

  it('CONTROL: two different keys still cost two fetches', async () => {
    // Without this the assertion above could pass on a counter that cannot
    // reach 2 — `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`.
    isolated(
      <>
        <ScoreAttributionView {...lensProps} />
        <ScoreAttributionView {...lensProps} rows={rows.slice(0, 20)} />
      </>)
    await settle()
    expect(fetches.filter(u => u.includes('score-components'))).toHaveLength(2)
  })
})
