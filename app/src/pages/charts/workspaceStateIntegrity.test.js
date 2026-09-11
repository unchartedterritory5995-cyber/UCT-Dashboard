import { describe, it, expect } from 'vitest'
import { arrangementSig, fullStateSig } from './layoutDockPins'

// ─── THE DEFECT, AS ARITHMETIC ──────────────────────────────────────────────
//
// A workspace tab click REPLACES the board. Before it does, `applyTemplate`
// flushes the outgoing one. That flush was gated on `dockDirty`, which is
// `arrangementSig` — GEOMETRY ONLY, deliberately, so the dock's unsaved dot never
// lights on a board nobody touched. The cost of that narrowness was invisible
// until it was measured: a chart-settings edit moves no geometry, so the board
// was never "dirty", the flush was a NO-OP, and the destination template then
// overwrote the live working copy. Three Info Row formulas, an RSI period, a
// derived Moving Average and a chart theme, gone on one click.
//
// These cases are the two predicates side by side. Every `settings`-shaped edit
// below leaves `arrangementSig` IDENTICAL — that is the bug restated — and moves
// `fullStateSig`, which is what now gates the flush.

const chart = (opts) => ({ id: 'w-chart', type: 'chart', x: 2, y: 0, w: 10, h: 20, opts })
const board = (...widgets) => ({ cols: 12, widgets })

const BASE_SETTINGS = {
  background: '#0a0a0a',
  indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14 } }],
  conditions: [{ id: 'c1', name: 'Inside Bar', formula: 'high < high[1] && low > low[1]', enabled: true }],
  header: { fields: ['mcap'], infoFormulas: [] },
}
const before = board(chart({ tf: '1D', settings: BASE_SETTINGS }))

/** Every edit in the matrix, as (name, next board). */
const EDITS = {
  '1. chart setting (theme/background)': board(chart({
    tf: '1D', settings: { ...BASE_SETTINGS, background: '#f3efe4' },
  })),
  '2. indicator inputs (RSI 14 → 28)': board(chart({
    tf: '1D',
    settings: { ...BASE_SETTINGS, indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 28 } }] },
  })),
  '3. custom Info field added': board(chart({
    tf: '1D',
    settings: {
      ...BASE_SETTINGS,
      header: {
        fields: ['mcap', 'info:a:1'],
        infoFormulas: [{ id: 'info:a:1', label: 'ADR', formula: 'sma((high - low) / close, 21) * 100', decimals: 2 }],
      },
    },
  })),
  '4. condition modified': board(chart({
    tf: '1D',
    settings: { ...BASE_SETTINGS, conditions: [{ id: 'c1', name: 'Inside Bar', formula: 'high < high[1]', enabled: true }] },
  })),
  '6. chart theme (a whole visual layer)': board(chart({
    tf: '1D', settings: { ...BASE_SETTINGS, background: '#f3efe4', textColor: '#3f4a57' },
  })),
  '8. timeframe (a plain opts key)': board(chart({ tf: '5', settings: BASE_SETTINGS })),
}

describe('⛔⛔ the flush gate must see what the dot does not', () => {
  for (const [name, after] of Object.entries(EDITS)) {
    it(`${name} — arrangementSig BLIND (the bug), fullStateSig SEES it (the fix)`, () => {
      expect(arrangementSig(after)).toBe(arrangementSig(before))   // ← why the flush was a no-op
      expect(fullStateSig(after)).not.toBe(fullStateSig(before))   // ← why it no longer is
    })
  }

  it('5. move/resize a widget — BOTH signatures see it (geometry was never the broken case)', () => {
    const moved = board({ ...chart({ tf: '1D', settings: BASE_SETTINGS }), x: 4, w: 8 })
    expect(arrangementSig(moved)).not.toBe(arrangementSig(before))
    expect(fullStateSig(moved)).not.toBe(fullStateSig(before))
  })

  it('12. no change — neither signature moves, so a switch causes NO churn', () => {
    const same = board(chart({ tf: '1D', settings: { ...BASE_SETTINGS } }))
    expect(fullStateSig(same)).toBe(fullStateSig(before))
    expect(arrangementSig(same)).toBe(arrangementSig(before))
  })
})

describe('the signature is stable under the things React does constantly', () => {
  it('⭐ key ORDER does not matter — state objects are rebuilt on every edit', () => {
    const reordered = board(chart({
      settings: {
        header: { infoFormulas: [], fields: ['mcap'] },
        conditions: BASE_SETTINGS.conditions,
        indicatorInstances: BASE_SETTINGS.indicatorInstances,
        background: '#0a0a0a',
      },
      tf: '1D',
    }))
    expect(fullStateSig(reordered)).toBe(fullStateSig(before))
  })

  it('⭐ widget ORDER does not matter — the parts are sorted', () => {
    const a = board(chart({ tf: '1D', settings: BASE_SETTINGS }), { id: 'w-wl', type: 'watchlist', x: 0, y: 0, w: 2, h: 7, opts: {} })
    const b = board({ id: 'w-wl', type: 'watchlist', x: 0, y: 0, w: 2, h: 7, opts: {} }, chart({ tf: '1D', settings: BASE_SETTINGS }))
    expect(fullStateSig(a)).toBe(fullStateSig(b))
  })

  it('⭐ a missing opts is not a crash and not a false difference', () => {
    const noOpts = board({ id: 'w-chart', type: 'chart', x: 2, y: 0, w: 10, h: 20 })
    expect(() => fullStateSig(noOpts)).not.toThrow()
    expect(fullStateSig(noOpts)).toBe(fullStateSig(board({ id: 'w-chart', type: 'chart', x: 2, y: 0, w: 10, h: 20, opts: undefined })))
  })

  it('⛔ ARRAY ORDER *does* matter inside opts — reordering the Info Row IS an edit', () => {
    const one = board(chart({ settings: { ...BASE_SETTINGS, header: { fields: ['mcap', 'price'], infoFormulas: [] } } }))
    const two = board(chart({ settings: { ...BASE_SETTINGS, header: { fields: ['price', 'mcap'], infoFormulas: [] } } }))
    expect(fullStateSig(one)).not.toBe(fullStateSig(two))
  })

  it('⭐ null/empty boards are handled', () => {
    expect(fullStateSig(null)).toBe(fullStateSig({ widgets: [] }))
    expect(() => fullStateSig(undefined)).not.toThrow()
  })
})
