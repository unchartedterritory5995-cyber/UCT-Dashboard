/**
 * The grid in isolation — the claim being tested is that it holds NO per-style
 * knowledge: it looks a component up by key and hands it whatever the caller's
 * one assembly returned.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

import CompareGrid from './CompareGrid'
import { STYLES, VIEW_CONFIG } from './views/viewMetricConfig'
import { COMPARE_PANES } from './compareQuad'

const rows = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-08-${String(28 - i).padStart(2, '0')}`,
  breadth_score: 60, uct_exposure: 60, pct_above_50sma: 55 - i, pct_above_200sma: 50,
  up_4pct_today: 200, down_4pct_today: 90, new_52w_highs: 30, new_52w_lows: 8,
  mcclellan_osc: 10, vix: 16, sp500_close: 5000 + i, advancing: 3000, declining: 1500,
}))

const lensProps = {
  rows, currentRow: rows[0], prevRow: rows[3], rowIdx: 0,
  onDrill: () => {}, onSeek: () => true, canSeek: () => true, options: {},
}

describe('CompareGrid', () => {
  it('renders one pane per quad entry, tagged with its style', () => {
    const quad = ['clock', 'divergence', 'events', 'analogues']
    render(<CompareGrid quad={quad} propsForStyle={() => lensProps} onPick={() => {}} />)
    const panes = screen.getAllByTestId(/^compare-pane-\d+$/)
    expect(panes).toHaveLength(COMPARE_PANES)
    expect(panes.map(p => p.getAttribute('data-pane-style'))).toEqual(quad)
  })

  it('asks the caller for props ONCE PER PANE, by that pane’s style', () => {
    // The whole abstraction in one assertion: the grid's only input to the
    // assembly is the style key.
    const quad = ['clock', 'divergence', 'events', 'analogues']
    const propsForStyle = vi.fn(() => lensProps)
    render(<CompareGrid quad={quad} propsForStyle={propsForStyle} onPick={() => {}} />)
    expect(propsForStyle.mock.calls.map(c => c[0])).toEqual(quad)
  })

  it('mounts no scrubber and no date header of its own', () => {
    render(<CompareGrid quad={['clock', 'divergence', 'events', 'analogues']}
                        propsForStyle={() => lensProps} onPick={() => {}} />)
    expect(screen.queryByTestId('scrubber')).toBeNull()
    expect(screen.queryByTestId('cursor-date')).toBeNull()
    expect(screen.queryByTestId('scrubber-range')).toBeNull()
  })

  it('derives every picker option from the registry, never a local list', () => {
    render(<CompareGrid quad={['clock', 'divergence', 'events', 'analogues']}
                        propsForStyle={() => lensProps} onPick={() => {}} />)
    for (let i = 0; i < COMPARE_PANES; i++) {
      const pick = screen.getByTestId(`compare-pick-${i}`)
      const opts = [...pick.querySelectorAll('option')]
      expect(opts.map(o => o.value).sort()).toEqual([...STYLES].sort())
      expect(opts.map(o => o.textContent)).toEqual(opts.map(o => VIEW_CONFIG[o.value].label))
    }
  })

  it('reports a pick as (paneIndex, styleKey) and changes nothing itself', () => {
    const onPick = vi.fn()
    const quad = ['clock', 'divergence', 'events', 'analogues']
    render(<CompareGrid quad={quad} propsForStyle={() => lensProps} onPick={onPick} />)
    fireEvent.change(screen.getByTestId('compare-pick-2'), { target: { value: 'radar' } })
    expect(onPick).toHaveBeenCalledWith(2, 'radar')
    // The quad it was handed is still what it draws — the owner decides.
    expect(screen.getAllByTestId(/^compare-pane-\d+$/)
      .map(p => p.getAttribute('data-pane-style'))).toEqual(quad)
  })

  it('survives a style with no component rather than throwing the tab away', () => {
    expect(() => render(<CompareGrid quad={['clock', 'nope', 'events', 'analogues']}
                                     propsForStyle={() => lensProps} onPick={() => {}} />))
      .not.toThrow()
  })

  it('renders nothing at all for an empty quad', () => {
    render(<CompareGrid quad={[]} propsForStyle={() => lensProps} onPick={() => {}} />)
    expect(screen.queryAllByTestId(/^compare-pane-\d+$/)).toHaveLength(0)
  })
})

/**
 * ⭐ CUSTOMIZE, PER PANE — and asked for the same way the view bundle is.
 *
 * The grid learns nothing new about styles here: it calls one resolver with a
 * style key and renders whatever came back, exactly as it does for the view.
 */
describe('each pane carries its own Customize', () => {
  const quad = ['clock', 'divergence', 'events', 'analogues']
  const panelFor = (style) => ({
    viewLabel: VIEW_CONFIG[style].label, metrics: [], optionsSchema: [], options: {},
    activePreset: 'Default', visibleKeys: new Set(), presetNames: ['Default'],
    isDefaultActive: true,
    onToggleVisible: () => {}, onSetOption: () => {}, onSavePreset: () => {},
    onRenamePreset: () => {}, onDeletePreset: () => {}, onSwitchPreset: () => {},
    onResetActive: () => {},
  })
  const mount = (props = {}) => render(
    <CompareGrid quad={quad} propsForStyle={() => lensProps}
                 customizeForStyle={panelFor} onPick={() => {}} {...props} />)

  it('asks the caller for a panel ONCE PER PANE, by that pane’s style', () => {
    const customizeForStyle = vi.fn(panelFor)
    mount({ customizeForStyle })
    expect(customizeForStyle.mock.calls.map(c => c[0])).toEqual(quad)
  })

  it('opens the panel for the pane’s OWN style, one at a time', () => {
    mount()
    fireEvent.click(screen.getByTestId('compare-customize-1'))
    expect(screen.getByRole('dialog', { name: 'Customize Divergence' })).toBeTruthy()
    expect(screen.queryAllByRole('dialog')).toHaveLength(1)

    fireEvent.click(screen.getByTestId('compare-customize-2'))
    expect(screen.getByRole('dialog', { name: 'Customize Event Ledger' })).toBeTruthy()
    expect(screen.queryAllByRole('dialog'),
           'two panels at once would cover the grid they configure').toHaveLength(1)
  })

  // 🔴 A CONTROL PRESENT BUT INERT IS THE DEFECT THIS TAB HAS ALREADY FIXED
  // TWICE. If the container has no resolver to give, the gear is not rendered at
  // all — the same rule the style switcher follows in compare mode.
  it('renders no gear when there is no panel to open', () => {
    render(<CompareGrid quad={quad} propsForStyle={() => lensProps} onPick={() => {}} />)
    expect(screen.queryByTestId('compare-customize-0')).toBeNull()
  })

  it('closes the panel when the pane changes style under it', () => {
    // Otherwise the panel would go on editing the style the pane no longer shows.
    mount()
    fireEvent.click(screen.getByTestId('compare-customize-0'))
    expect(screen.queryAllByRole('dialog')).toHaveLength(1)
    fireEvent.change(screen.getByTestId('compare-pick-0'), { target: { value: 'radar' } })
    expect(screen.queryAllByRole('dialog')).toHaveLength(0)
  })

  it('names the pane’s preset on the gear when it is not the default', () => {
    render(<CompareGrid quad={quad} propsForStyle={() => lensProps} onPick={() => {}}
                        customizeForStyle={(s) => ({ ...panelFor(s),
                          activePreset: 'Sea', isDefaultActive: false })} />)
    expect(screen.getByTestId('compare-customize-0').textContent).toContain('Sea')
  })
})

/**
 * ⭐ THE CONTROL BEHIND THE RULING — why the quad is a set.
 *
 * `BreadthViews.compare.test.jsx` asserts that four panes never produce a
 * duplicate test id. On its own that assertion could be passing because the
 * detector cannot see a duplicate. This forces the case the state layer makes
 * impossible — one style in two panes — straight into the grid, and shows the
 * collision is real: ids are namespaced `{styleKey}-{role}`, so mounting a
 * style twice makes every id it owns ambiguous.
 *
 * ⛔ Which is also the answer to "why not just support duplicates": the fix
 * would be an id prefix threaded through all sixteen views — a change to the
 * view contract, and a rewrite of every existing `getByTestId` — to buy a pane
 * that renders the same pixels as its neighbour (options are per STYLE, and the
 * cursor and window are shared, so there is nothing left to differ).
 */
describe('one style in two panes WOULD collide — the control', () => {
  it('duplicates every id that style owns', () => {
    const { container } = render(
      <CompareGrid quad={['events', 'events', 'clock', 'analogues']}
                   propsForStyle={() => lensProps} onPick={() => {}} />)
    const ids = [...container.querySelectorAll('[data-testid]')]
      .map(el => el.getAttribute('data-testid'))
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(dupes.length, 'the detector saw no collision — it cannot distinguish')
      .toBeGreaterThan(0)
    expect(dupes.every(id => id.startsWith('events-'))).toBe(true)
  })
})
