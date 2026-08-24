import { describe, test, expect } from 'vitest'
import { planPlacement, nudgePlan } from './place'

const COLS = 24
const ROWS = 20

describe('planPlacement — owner screenshot scenarios', () => {
  // img 1 → img 3: adding Breadth to [chart + theme-rail] should drop it into the
  // empty bottom-right rail gap at the rail's width — NOT a full-width bottom strip.
  test('breadth fills the empty sidebar rail gap (img 3), no resize', () => {
    const layout = [
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 },
      { id: 't1', type: 'themes', x: 18, y: 0, w: 6, h: 10 },
    ]
    const { place, mutations } = planPlacement(layout, 'breadth', COLS, ROWS)
    expect(place).toEqual({ x: 18, y: 10, w: 6, h: 10 })
    expect(mutations).toEqual([]) // fills empty space, touches nothing
  })

  // img 4 → img 6: adding a Chart to [chart + theme + breadth] (rail full) should
  // split the existing chart 50/50 vertically — NOT a full-width bottom strip.
  test('second chart splits the chart region 50/50 (img 6)', () => {
    const layout = [
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 },
      { id: 't1', type: 'themes', x: 18, y: 0, w: 6, h: 10 },
      { id: 'b1', type: 'breadth', x: 18, y: 10, w: 6, h: 10 },
    ]
    const { place, mutations } = planPlacement(layout, 'chart', COLS, ROWS)
    expect(place).toEqual({ x: 0, y: 10, w: 18, h: 10 })   // new chart, bottom half
    expect(mutations).toEqual([{ id: 'c1', h: 10 }])       // existing chart → top half
  })
})

describe('planPlacement — general behavior', () => {
  test('empty workspace → newcomer lands at its default size, top-left', () => {
    const { place, mutations } = planPlacement([], 'chart', COLS, ROWS)
    expect(place).toEqual({ x: 0, y: 0, w: 12, h: 12 })
    expect(mutations).toEqual([])
  })

  test('fundamentals docks BELOW the chart, not into the sidebar rail', () => {
    // chart on the left + a right rail (watchlist over theme). Fundamentals must go
    // under the chart (splitting a short strip off its bottom), not into the rail.
    const layout = [
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 },
      { id: 'wl', type: 'watchlist', x: 18, y: 0, w: 6, h: 10 },
      { id: 't1', type: 'themes', x: 18, y: 10, w: 6, h: 10 },
    ]
    const { place, mutations } = planPlacement(layout, 'fundamentals', COLS, ROWS)
    expect(place).toMatchObject({ x: 0, y: 16, w: 18, h: 4 }) // short strip under the chart, chart width
    expect(mutations).toEqual([{ id: 'c1', h: 16 }])          // chart shrinks to make room
  })

  test('fundamentals fills an existing empty gap below the chart without resizing', () => {
    const layout = [{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 14 }]
    const { place, mutations } = planPlacement(layout, 'fundamentals', COLS, ROWS)
    expect(place).toMatchObject({ x: 0, y: 14, w: 18 }) // drops into the empty bottom gap
    expect(mutations).toEqual([])
  })

  test('when the sidebar rail is FULL, a panel carves a new rail beside the chart (img 13)', () => {
    // chart on the left + a right rail packed with 4 panels (no room to stack a 5th).
    const layout = [
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 },
      { id: 't', type: 'themes', x: 18, y: 0, w: 6, h: 5 },
      { id: 'b', type: 'breadth', x: 18, y: 5, w: 6, h: 5 },
      { id: 'wl', type: 'watchlist', x: 18, y: 10, w: 6, h: 5 },
      { id: 'n', type: 'news', x: 18, y: 15, w: 6, h: 5 },
    ]
    const { place, mutations } = planPlacement(layout, 'optionsflow', COLS, ROWS)
    // New rail carved on the LEFT at the existing rail's width; the chart shrinks right.
    expect(place).toMatchObject({ x: 0, y: 0, w: 6, h: 20 })
    expect(mutations).toEqual([{ id: 'c1', x: 6, w: 12 }])
  })

  test('a full board never places a widget off-screen — it always makes room (mutations)', () => {
    // A single full-width chart: any panel add must resize it, never overflow the grid.
    const layout = [{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20 }]
    for (const type of ['alerts', 'optionsflow', 'watchlist', 'chart']) {
      const { place, mutations } = planPlacement(layout, type, COLS, ROWS)
      expect(mutations.length, `${type} must make room, not overflow`).toBeGreaterThan(0)
      expect(place.x + place.w).toBeLessThanOrEqual(COLS)
      expect(place.y + place.h).toBeLessThanOrEqual(ROWS)
    }
  })

  test('a panel with no matching rail carves one beside the widest widget', () => {
    const layout = [{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20 }]
    const { place, mutations } = planPlacement(layout, 'themes', COLS, ROWS)
    // left half becomes the new rail; the chart shrinks to the right half
    expect(place).toEqual({ x: 0, y: 0, w: 12, h: 20 })
    expect(mutations).toEqual([{ id: 'c1', x: 12, w: 12 }])
  })

  test('a panel prefers a genuinely empty rectangle over resizing anything', () => {
    // chart occupies the left; the whole right half is empty.
    const layout = [{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }]
    const { place, mutations } = planPlacement(layout, 'breadth', COLS, ROWS)
    expect(mutations).toEqual([])           // no resize — empty space existed
    expect(place.x).toBeGreaterThanOrEqual(12)
    expect(place.y + place.h).toBeLessThanOrEqual(ROWS)
  })

})

describe('nudgePlan — column-model directional move', () => {
  // Board: a wide chart (col 0) + a right rail of themes/calendar (col 1).
  const BOARD = [
    { id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 },
    { id: 't1', type: 'themes', x: 18, y: 0, w: 6, h: 10 },
    { id: 'cal', type: 'calendar', x: 18, y: 10, w: 6, h: 10 },
  ]

  // ── Scenario (b): breadth (panel) added into the right rail ────────────────
  // Ghost stacked into the rail (planPlacement's panel→splitVertical result).
  const railGhost = {
    type: 'breadth',
    place: { x: 18, y: 15, w: 6, h: 5 },
    mutations: [{ id: 'cal', h: 5 }],
    anchor: { kind: 'stack', colKey: 't1', slot: 3 },
  }

  test('(b) LEFT from the rail → own column BETWEEN chart and rail (not far left)', () => {
    const { place, mutations, anchor } = nudgePlan(BOARD, railGhost, 'left', COLS, ROWS)
    expect(place).toMatchObject({ x: 12, y: 0, w: 6, h: 20 })  // middle column
    expect(mutations).toContainEqual({ id: 'c1', w: 12 })      // chart shrank; rail stayed
    expect(anchor).toEqual({ kind: 'col', gap: 1 })
  })

  // From the middle column, all four moves stay available.
  const midGhost = {
    type: 'breadth',
    place: { x: 12, y: 0, w: 6, h: 20 },
    mutations: [{ id: 'c1', w: 12 }],
    anchor: { kind: 'col', gap: 1 },
  }

  test('(b) RIGHT from the middle column merges back INTO the rail', () => {
    const { place, mutations, anchor } = nudgePlan(BOARD, midGhost, 'right', COLS, ROWS)
    expect(place).toMatchObject({ x: 18, y: 0, w: 6, h: 5 })   // top slice of the rail
    expect(mutations).toEqual([{ id: 't1', y: 5, h: 5 }])
    expect(anchor).toMatchObject({ kind: 'stack', colKey: 't1', slot: 0 })
  })

  test('(b) LEFT again from the middle column → far left, chart shifts right', () => {
    const { place, mutations, anchor } = nudgePlan(BOARD, midGhost, 'left', COLS, ROWS)
    expect(place).toMatchObject({ x: 0, y: 0, w: 6, h: 20 })
    expect(mutations).toContainEqual({ id: 'c1', x: 6, w: 12 })
    expect(anchor).toEqual({ kind: 'col', gap: 0 })
  })

  // ── Fundamentals (minW 6) nudged RIGHT into its own column must NOT overlap the
  //    rail: the carved column has to be at least the ghost's min width so clampPlace
  //    can't widen it past the slot into the theme/watchlist rail. ──
  test('fundamentals nudged RIGHT into its own column never overlaps the rail', () => {
    const board = [
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 },
      { id: 'wl', type: 'watchlist', x: 18, y: 0, w: 6, h: 10 },
      { id: 't1', type: 'themes', x: 18, y: 10, w: 6, h: 10 },
    ]
    // Fundamentals as it lands docked below the chart, then step RIGHT.
    const docked = { type: 'fundamentals', place: { x: 0, y: 16, w: 18, h: 4 }, mutations: [{ id: 'c1', h: 16 }] }
    const res = nudgePlan(board, docked, 'right', COLS, ROWS)
    expect(res).not.toBeNull()
    expect(res.place.x + res.place.w).toBeLessThanOrEqual(18)  // right edge butts the rail, never past it
    expect(res.place.w).toBeGreaterThanOrEqual(6)              // shrank to its min width (6), not wider
    for (const r of board.filter(w => w.id !== 'c1')) {        // no overlap with either rail widget
      const g = res.place
      const over = g.x < r.x + r.w && r.x < g.x + g.w && g.y < r.y + r.h && r.y < g.y + g.h
      expect(over).toBe(false)
    }
  })

  // ── Image 26: a panel stacked in the rail walks the RAIL's slots on UP/DOWN,
  //    never jumping to the chart (that only happens once it's over the chart). ──
  test('a rail-stacked panel walks the rail vertically on UP/DOWN (stays in the rail)', () => {
    // Ghost split into the bottom member (calendar) of the rail — its bottom half.
    const railStack = {
      type: 'profile',
      place: { x: 18, y: 15, w: 6, h: 5 },
      mutations: [{ id: 'cal', h: 5 }],
      anchor: { kind: 'stack', colKey: 't1', slot: 3 },  // cal, below
    }
    const up = nudgePlan(BOARD, railStack, 'up', COLS, ROWS)
    expect(up).not.toBeNull()
    expect(up.place.x).toBe(18)                    // still in the rail, NOT the chart at x:0
    expect(up.anchor).toEqual({ kind: 'stack', colKey: 't1', slot: 2 })
    // DOWN is at the bottom of the rail already → no further down.
    expect(nudgePlan(BOARD, railStack, 'down', COLS, ROWS)).toBeNull()
    // LEFT pops it out to an own column beside the rail.
    expect(nudgePlan(BOARD, railStack, 'left', COLS, ROWS)).not.toBeNull()
  })

  // ── Scenario (a): a panel beside a SOLO chart → UP/DOWN target the chart ────
  test('(a) beside a solo chart, UP / DOWN move above / below it', () => {
    const solo = [{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20 }]
    const sideGhost = { type: 'breadth', place: { x: 0, y: 0, w: 12, h: 20 }, mutations: [{ id: 'c1', x: 12, w: 12 }] }
    const up = nudgePlan(solo, sideGhost, 'up', COLS, ROWS)
    expect(up.place).toMatchObject({ x: 0, y: 0, w: 24, h: 10 })
    expect(up.mutations).toEqual([{ id: 'c1', y: 10, h: 10 }])
    const down = nudgePlan(solo, sideGhost, 'down', COLS, ROWS)
    expect(down.place).toMatchObject({ x: 0, y: 10, w: 24, h: 10 })
  })

  // ── Scenario (c): a second chart ──────────────────────────────────────────
  // planPlacement stacks it below the existing chart (50/50 vertical split).
  const chartGhost = {
    type: 'chart',
    place: { x: 0, y: 10, w: 18, h: 10 },
    mutations: [{ id: 'c1', h: 10 }],
    anchor: { kind: 'stack', colKey: 'c1', slot: 1 },  // below the chart
  }

  test('(c) UP moves the new chart ABOVE the other chart', () => {
    const { place, mutations } = nudgePlan(BOARD, chartGhost, 'up', COLS, ROWS)
    expect(place).toMatchObject({ x: 0, y: 0, w: 18, h: 10 })
    expect(mutations).toEqual([{ id: 'c1', y: 10, h: 10 }])
  })

  test('(c) RIGHT pops the new chart into its own column, chart shrinks', () => {
    const { place, mutations, anchor } = nudgePlan(BOARD, chartGhost, 'right', COLS, ROWS)
    expect(place).toMatchObject({ x: 9, y: 0, w: 9, h: 20 })   // between chart and rail
    expect(mutations).toContainEqual({ id: 'c1', w: 9 })
    expect(anchor).toEqual({ kind: 'col', gap: 1 })
    // …and RIGHT again lands it to the far right, rail now BETWEEN the two charts.
    const step2 = nudgePlan(BOARD, { ...chartGhost, place, mutations, anchor }, 'right', COLS, ROWS)
    expect(step2.anchor).toEqual({ kind: 'col', gap: 2 })
    expect(step2.place.x).toBeGreaterThan(place.x)
  })

  test('(c) a far-right new chart stacks onto the OTHER chart on UP/DOWN (not the rail)', () => {
    // Chart ghost as its own far-right column; UP/DOWN must reach the chart, not the rail.
    const farChart = { type: 'chart', place: { x: 18, y: 0, w: 6, h: 20 }, mutations: [{ id: 'c1', w: 12 }], anchor: { kind: 'col', gap: 2 } }
    const up = nudgePlan(BOARD, farChart, 'up', COLS, ROWS)
    expect(up).not.toBeNull()
    expect(up.place.x).toBe(0)                     // over the chart column, not the rail at x:18
    expect(up.mutations[0].id).toBe('c1')
  })

  test('RIGHT past the last column is unavailable (arrow hidden)', () => {
    const farRight = { type: 'breadth', place: { x: 18, y: 0, w: 6, h: 20 }, mutations: [], anchor: { kind: 'col', gap: 2 } }
    expect(nudgePlan(BOARD, farRight, 'right', COLS, ROWS)).toBeNull()
  })

  // ── An own column at the far right (image 25): LEFT must revert the move ─────
  test('a far-right own column can still go LEFT (move is reversible)', () => {
    const farRight = { type: 'profile', place: { x: 18, y: 0, w: 6, h: 20 }, mutations: [{ id: 'c1', w: 12 }], anchor: { kind: 'col', gap: 2 } }
    const back = nudgePlan(BOARD, farRight, 'left', COLS, ROWS)
    expect(back).not.toBeNull()
    // RIGHT from wherever LEFT landed returns to the far-right own column — reversible.
    const fwd = nudgePlan(BOARD, { ...farRight, place: back.place, mutations: back.mutations, anchor: back.anchor }, 'right', COLS, ROWS)
    expect(fwd).not.toBeNull()
    expect(fwd.anchor).toEqual({ kind: 'col', gap: 2 })
  })
})

describe('planPlacement — grid bounds', () => {
  test('placement never leaves the grid', () => {
    const layout = [
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 },
      { id: 't1', type: 'themes', x: 18, y: 0, w: 6, h: 10 },
      { id: 'b1', type: 'breadth', x: 18, y: 10, w: 6, h: 10 },
    ]
    for (const type of ['chart', 'breadth', 'watchlist', 'fundamentals']) {
      const { place } = planPlacement(layout, type, COLS, ROWS)
      expect(place.x).toBeGreaterThanOrEqual(0)
      expect(place.y).toBeGreaterThanOrEqual(0)
      expect(place.x + place.w).toBeLessThanOrEqual(COLS)
      expect(place.y + place.h).toBeLessThanOrEqual(ROWS)
    }
  })
})
