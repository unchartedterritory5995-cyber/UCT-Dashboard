import { describe, it, expect } from 'vitest'
import {
  clampVolPct, resolveVolPanePct, latchOnDrag, latchIsStale,
  VOL_PCT_MIN, VOL_PCT_MAX,
} from './volumePaneDrag'
import { computePaneLayout, paneStretchPlan, SEPARATOR_PX } from './engine/paneLayout'

// ─── what this file is for ───────────────────────────────────────────────────
//
// The volume-pane divider is advertised as draggable (`layout.panes.enableResize`,
// pinned in flipCGeometry.test.jsx) and after Flip C a drag DID NOT STICK: the
// binder re-asserts `paneLayout.above` at the end of every `sync()`, and
// `updateChart` syncs about once a second in extended hours. The fix makes the
// drag an authority the layout is computed from rather than a state the layout
// overwrites, so the last block here drives the REAL layout and the REAL
// `paneStretchPlan` — a helper that returns the right number while the layout
// still returns the old one would be a fix nobody can see.

describe('clampVolPct', () => {
  it('clamps to the range the settings path has always used', () => {
    expect(clampVolPct(22)).toBe(22)
    expect(clampVolPct(2)).toBe(VOL_PCT_MIN)
    expect(clampVolPct(90)).toBe(VOL_PCT_MAX)
  })

  it('answers null for a non-number rather than NaN', () => {
    // `Number(null) === 0` has bitten this branch eight times; a NaN percentage
    // reaches `bandsAboveHeights` and silently gives the volume pane 0 px.
    expect(clampVolPct(null)).toBeNull()
    expect(clampVolPct(undefined)).toBeNull()
    expect(clampVolPct('nope')).toBeNull()
    expect(clampVolPct(NaN)).toBeNull()
  })
})

describe('resolveVolPanePct', () => {
  it('is the SETTING when nothing has been dragged', () => {
    expect(resolveVolPanePct(22, null)).toBe(22)
  })

  it('is the DRAG once the user has moved the divider', () => {
    expect(resolveVolPanePct(22, { from: 22, pct: 34 })).toBe(34)
  })

  it('yields the moment the SETTING itself changes', () => {
    // Otherwise changing the volume-pane height in Settings, or a persisted
    // value arriving back as a prop, would be ignored for the life of the chart
    // — one stuck pane traded for another.
    expect(resolveVolPanePct(30, { from: 22, pct: 34 })).toBe(30)
    expect(latchIsStale({ from: 22, pct: 34 }, 30)).toBe(true)
    expect(latchIsStale({ from: 22, pct: 34 }, 22)).toBe(false)
  })

  it('still clamps a dragged value', () => {
    expect(resolveVolPanePct(22, { from: 22, pct: 58 })).toBe(VOL_PCT_MAX)
  })

  it('falls back to the setting rather than NaN on a corrupt latch', () => {
    expect(resolveVolPanePct(22, { from: 22, pct: undefined })).toBe(22)
  })
})

describe('latchOnDrag', () => {
  it('records a real move', () => {
    expect(latchOnDrag(22, 22, 34)).toEqual({ from: 22, pct: 34 })
  })

  it('refuses movement too small to be a deliberate resize', () => {
    // LWC clamps panes to a minimum height, so on a short widget "apply 12 →
    // measure 13" is normal and is not a user.
    expect(latchOnDrag(22, 22, 23)).toBeNull()
  })

  it('refuses a measurement outside the window the sampler has always used', () => {
    expect(latchOnDrag(22, 22, 3)).toBeNull()
    expect(latchOnDrag(22, 22, 75)).toBeNull()
  })

  it('refuses a non-number instead of latching NaN', () => {
    expect(latchOnDrag(22, null, 34)).toBeNull()
    expect(latchOnDrag(null, 22, 34)).toBeNull()
    expect(latchOnDrag(22, 22, undefined)).toBeNull()
  })

  it('⛔ SURVIVES A SECOND DRAG — `from` is the SETTING, never the applied height', () => {
    // THE REGRESSION THIS CASE EXISTS FOR. If `from` recorded the height the pane
    // was at, the second drag of a session would stamp `from` = the FIRST drag's
    // height, `resolveVolPanePct` would find it disagreeing with the (unchanged)
    // setting, drop the latch, and snap the pane back to 22 mid-drag.
    const first = latchOnDrag(22, 22, 34)
    expect(resolveVolPanePct(22, first)).toBe(34)
    const second = latchOnDrag(22, 34, 41)   // applied is now the first drag
    expect(second).toEqual({ from: 22, pct: 41 })
    expect(resolveVolPanePct(22, second)).toBe(41)
  })

  it('⛔ CANNOT RATCHET — re-measuring a latched height produces no new latch', () => {
    // "volume pane randomly triples in size": measure → apply → LWC clamps →
    // measure larger → apply → … Latching is a fixed point, so the loop has no
    // step to take.
    const latch = latchOnDrag(22, 22, 34)
    expect(latchOnDrag(22, latch.pct, latch.pct)).toBeNull()
  })
})

// ─── and the layout really takes it ──────────────────────────────────────────

const H = 600
const layoutFor = (volPct) => computePaneLayout([], {
  chartHeight: H,
  separatorPx: SEPARATOR_PX,
  firstPaneIndex: 2,               // candles + a separate volume pane
  abovePct: [100 - volPct, volPct],
  mainPaneIndex: 0,
})

describe('the dragged divider survives the layout the binder re-asserts', () => {
  it('a drag CHANGES the heights paneStretchPlan writes back', () => {
    const settled = layoutFor(resolveVolPanePct(22, null))
    const dragged = layoutFor(resolveVolPanePct(22, { from: 22, pct: 34 }))
    expect(dragged.above).not.toEqual(settled.above)
    // …and in the direction the user dragged: a bigger volume pane.
    expect(dragged.above[1]).toBeGreaterThan(settled.above[1])
    expect(dragged.above[0] + dragged.above[1]).toBe(H - SEPARATOR_PX)
  })

  it('🔴 WITHOUT THE LATCH THE PLAN PUTS IT BACK — that is the whole bug', () => {
    // `applyPaneStretch` reads the live factors and overwrites any that differ
    // from the plan. Standing where the user dropped it, with the layout still
    // computed from the SETTING, the plan is the setting's heights: the snap-back.
    const dropped = layoutFor(22).above          // layout still on the setting
    const dragged = layoutFor(34).above          // where the user put the divider
    const current = [...dragged, ...[]]
    const snapBack = paneStretchPlan(layoutFor(22), current)
    expect(snapBack.slice(0, 2)).toEqual(dropped)
    expect(snapBack.slice(0, 2)).not.toEqual(dragged)

    // With the latch, the plan the binder applies IS where the divider is.
    const withLatch = paneStretchPlan(layoutFor(resolveVolPanePct(22, { from: 22, pct: 34 })), current)
    expect(withLatch.slice(0, 2)).toEqual(dragged)
  })

  it('is a FIXED POINT — feeding the plan back changes nothing', () => {
    // The property the whole module rests on: this layout writes pixel counts
    // into the stretch factors, so a second pass must not re-read them as
    // percentages. A latch that broke it would drift a pixel per sync.
    const layout = layoutFor(resolveVolPanePct(22, { from: 22, pct: 34 }))
    const once = paneStretchPlan(layout, [1, 1])
    expect(paneStretchPlan(layout, once)).toEqual(once)
  })
})

// ─── and StockChart is actually wired to it ─────────────────────────────────
//
// The helpers above are pure, so they pass whether or not anything calls them.
// Two lines in `StockChart.jsx` are the whole fix, and both have a natural
// "tidy-up" that silently restores the bug — so both are pinned by name.

describe('StockChart wiring (comment-stripped source scan)', () => {
  const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

  const read = async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    return fs.readFileSync(
      path.resolve(__dirname, '../StockChart.jsx'), 'utf8')
  }

  it('the stripper is neither a no-op nor a nuke', () => {
    // CONTROL. An identity stripper makes every scan below pass off a comment;
    // an over-eager one makes them all pass off nothing.
    expect(strip('/* X */ keep')).not.toMatch(/X/)
    expect(strip('a // X\nkeep')).not.toMatch(/X/)
    expect(strip('const url = "http://x" // c')).toMatch(/http:\/\/x/)
    expect(strip('keep')).toMatch(/keep/)
  })

  it('the pane layout is computed through resolveVolPanePct, not the raw setting', async () => {
    const code = strip(await read())
    expect(code, 'StockChart no longer resolves the volume pane through the drag latch — '
      + 'the binder re-asserts paneLayout.above every sync, so the divider snaps back')
      .toMatch(/resolveVolPanePct\(/)
    expect(code).toMatch(/from '\.\/chart\/volumePaneDrag'/)
  })

  it('⛔ the drag sampler does NOT require a persistence callback', async () => {
    const raw = await read()
    const code = strip(raw)
    // The needle is the early return that used to be there. Exactly ONE surface
    // passes `onVolumePaneResize` (ChartPane); gating the sampler on it means
    // ChartWidget, the grid cells, Model Book and the popover never latch a drag
    // at all and the binder undoes it about once a second.
    expect(code, 'the volume-drag sampler early-returns without onVolumePaneResize again — '
      + 'the drag then only survives on the ONE surface that persists it')
      .not.toMatch(/!onVolumePaneResize/)
    // ...and the probe has a subject: the prop is still read, optionally.
    expect(raw).toMatch(/onVolumePaneResize\?\./)
  })
})
