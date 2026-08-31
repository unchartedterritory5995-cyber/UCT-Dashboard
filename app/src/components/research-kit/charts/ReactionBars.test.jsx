import { describe, it, expect } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import ReactionBars, {
  SIZE, VIEWBOX, reactionGeometry, reactionStats, outcomeOf,
} from './ReactionBars'

const Q = (quarter, reaction_pct, surprise_pct, over = {}) => ({
  quarter, reaction_pct, surprise_pct, reported: true, ...over,
})
const ROWS = [
  Q('Q1 25', 4.2, 12),
  Q('Q2 25', -6.1, 8),     // beat, sold off -> the divergence star
  Q('Q3 25', -2.0, -5),
  Q('Q4 25', 9.4, 30),
]

describe('outcomeOf', () => {
  it('reads beat/miss off the surprise sign', () => {
    expect(outcomeOf(Q('Q', 1, 5))).toBe('beat')
    expect(outcomeOf(Q('Q', 1, -5))).toBe('miss')
    expect(outcomeOf(Q('Q', 1, 0))).toBe('inline')
  })

  it('prefers an explicit eps pair over the surprise field', () => {
    expect(outcomeOf({ reported: true, eps_estimate: 1, eps_actual: 1.2, surprise_pct: null })).toBe('beat')
  })

  it('is null when the quarter has not reported or carries nothing to judge', () => {
    expect(outcomeOf({ reported: false, surprise_pct: 10 })).toBeNull()
    expect(outcomeOf({ reported: true })).toBeNull()
    expect(outcomeOf(null)).toBeNull()
  })
})

describe('reactionGeometry', () => {
  const geo = () => reactionGeometry(ROWS, { impliedPct: 7 })

  it('places one bar per quarter, evenly slotted', () => {
    const g = geo()
    expect(g.bars).toHaveLength(4)
    const gaps = g.bars.slice(1).map((b, i) => b.cx - g.bars[i].cx)
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 6)
  })

  it('draws up-moves above the baseline and down-moves below (SIGNED, §3.3)', () => {
    const g = geo()
    expect(g.bars[0].dir).toBe(1)
    expect(g.bars[0].y + g.bars[0].h).toBeCloseTo(g.baselineY, 6)   // grows upward
    expect(g.bars[1].dir).toBe(-1)
    expect(g.bars[1].y).toBeCloseTo(g.baselineY, 6)                  // grows downward
  })

  it('scales every bar against the largest magnitude on the strip', () => {
    const g = geo()
    const biggest = g.bars.find((b) => b.key === 'Q4 25')
    const smallest = g.bars.find((b) => b.key === 'Q3 25')
    expect(biggest.h).toBeGreaterThan(smallest.h)
    expect(biggest.h).toBeLessThanOrEqual((VIEWBOX.height - 28) / 2)
  })

  it('includes the implied magnitude in the scale so the bracket always fits', () => {
    const withBig = reactionGeometry([Q('Q1', 1, 5)], { impliedPct: 40 })
    expect(withBig.scaleMax).toBeGreaterThanOrEqual(40)
    expect(withBig.bracket.top).toBeGreaterThanOrEqual(0)
    expect(withBig.bracket.bottom).toBeLessThanOrEqual(VIEWBOX.height)
  })

  it('has no bracket when no implied move is supplied', () => {
    expect(reactionGeometry(ROWS, {}).bracket).toBeNull()
    expect(reactionGeometry(ROWS, { impliedPct: null }).bracket).toBeNull()
  })

  it('flags the beat-but-down quarter and only that one', () => {
    const g = geo()
    expect(g.bars.filter((b) => b.diverged).map((b) => b.key)).toEqual(['Q2 25'])
  })

  it('survives a quarter with no reaction number', () => {
    const g = reactionGeometry([Q('Q1', null, 5), Q('Q2', 3, 5)], {})
    expect(g.bars[0].value).toBeNull()
    expect(g.bars[0].h).toBe(0)
    expect(Number.isFinite(g.bars[0].cx)).toBe(true)
  })

  it('never divides by zero on an all-flat strip', () => {
    const g = reactionGeometry([Q('Q1', 0, 0)], {})
    expect(Number.isFinite(g.scaleMax)).toBe(true)
    expect(g.scaleMax).toBeGreaterThan(0)
  })

  it('distinguishes a real zero from a missing reaction', () => {
    const g = reactionGeometry([Q('Q1', 0, 5), Q('Q2', null, 5)], {})
    expect(g.bars[0].value).toBe(0)           // real zero
    expect(g.bars[0].h).toBe(0)               // no bar
    expect(g.bars[1].value).toBeNull()        // missing reaction
    expect(g.bars[1].h).toBe(0)               // no bar (same visual outcome)
  })
})

describe('reactionStats — the numbers P2 puts in the StatTile caption row', () => {
  it('computes average absolute move, up-count and the extremes', () => {
    const s = reactionStats(ROWS)
    expect(s.total).toBe(4)
    expect(s.upCount).toBe(2)
    expect(s.avgAbs).toBeCloseTo((4.2 + 6.1 + 2.0 + 9.4) / 4, 6)
    expect(s.best).toEqual({ quarter: 'Q4 25', pct: 9.4 })
    expect(s.worst).toEqual({ quarter: 'Q2 25', pct: -6.1 })
  })

  it('counts only quarters with a real reaction', () => {
    const s = reactionStats([Q('Q1', null, 5), Q('Q2', 3, 5)])
    expect(s.total).toBe(1)
    expect(s.upCount).toBe(1)
  })

  it('returns an empty shape rather than NaN when there is nothing', () => {
    const s = reactionStats([])
    expect(s).toEqual({ total: 0, upCount: 0, avgAbs: null, best: null, worst: null })
  })
})

describe('ReactionBars', () => {
  it('renders an EmptyState when no quarter has a reaction', () => {
    render(<ReactionBars quarters={[Q('Q1', null, 5)]} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('renders one bar rect per quarter', () => {
    const { container } = render(<ReactionBars quarters={ROWS} />)
    expect(container.querySelectorAll('[data-testid="rk-reaction-bar"]')).toHaveLength(4)
  })

  it('shape-codes the outcome: solid disc on a beat, hollow ring on a miss', () => {
    const { container } = render(<ReactionBars quarters={ROWS} />)
    const dots = container.querySelectorAll('[data-testid="rk-reaction-dot"]')
    expect(dots[0].getAttribute('fill')).not.toBe('none')     // Q1 beat
    expect(dots[2].getAttribute('fill')).toBe('none')         // Q3 missed
  })

  it('stars the beat-but-sold-off quarter', () => {
    const { container } = render(<ReactionBars quarters={ROWS} />)
    const stars = container.querySelectorAll('[data-testid="rk-reaction-star"]')
    expect(stars).toHaveLength(1)
    expect(stars[0].textContent).toBe('★')
    // data-rk-star is the class-shape-independent oracle (module classes are
    // scoped, e.g. `_star_<hash>`) — a className regex would be the wrong seam.
    expect(stars[0]).toHaveAttribute('data-rk-star', '')
  })

  it('draws the implied bracket only when an implied move is given', () => {
    const { container, rerender } = render(<ReactionBars quarters={ROWS} />)
    expect(container.querySelector('[data-testid="rk-reaction-bracket"]')).toBeNull()
    rerender(<ReactionBars quarters={ROWS} impliedPct={7} impliedLabel="through Fri Aug 8" />)
    expect(container.querySelectorAll('[data-testid="rk-reaction-bracket"]')).toHaveLength(2)
  })

  // I6 — the bracket PAIR is one gold data-highlight, not two.
  it('stamps data-rk-gold once on the bracket group, not once per line', () => {
    const { container } = render(<ReactionBars quarters={ROWS} impliedPct={7} />)
    expect(container.querySelectorAll('[data-rk-gold]')).toHaveLength(1)
  })

  it('keeps dots circular at any width (never preserveAspectRatio=none)', () => {
    const { container } = render(<ReactionBars quarters={ROWS} />)
    const svg = container.querySelector('svg')
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`)
  })

  it('is one labelled image, and the label states the finding', () => {
    render(<ReactionBars quarters={ROWS} impliedPct={7} />)
    const label = screen.getByRole('img').getAttribute('aria-label')
    expect(label).toMatch(/closed up 2 of 4/i)
    expect(label).toMatch(/average move 5\.4%/i)
    expect(label).toMatch(/implied ±7\.0%/i)
  })

  it('exports a SIZE box for SkeletonBlock', () => {
    expect(SIZE).toEqual({ width: '100%', height: VIEWBOX.height })
  })
})

// ── the viewBox tracks the CONTAINER (mirror of ImpliedVsRealized's rail) ────
//
// Both charts share `useMeasuredWidth`, and jsdom implements no ResizeObserver,
// so every OTHER test in this file renders the 320-unit fallback. Without this
// block the entire measured path — the reason this chart stopped drawing at a
// third of its width — is invisible to a green run.
describe('viewBox tracks the measured container width', () => {
  const roCallbacks = []

  function withMeasuredWidth(px, fn) {
    const realRO = globalThis.ResizeObserver
    const proto = Element.prototype
    const realClientWidth = Object.getOwnPropertyDescriptor(proto, 'getBoundingClientRect')
    roCallbacks.length = 0
    globalThis.ResizeObserver = class {
      // Registers on observe(), NOT in the constructor — a stub that collects
      // the callback at construction stays green when `ro.observe(node)` is
      // deleted, which is the exact wire these tests exist to protect.
      constructor(cb) { this._cb = cb }
      observe() { roCallbacks.push(this._cb) }
      disconnect() { const i = roCallbacks.indexOf(this._cb); if (i >= 0) roCallbacks.splice(i, 1) }
    }
    Object.defineProperty(proto, 'getBoundingClientRect', { configurable: true, writable: true, value: () => ({ width: px, height: 0, top: 0, left: 0, right: px, bottom: 0, x: 0, y: 0 }) })
    try {
      return fn()
    } finally {
      if (realClientWidth) Object.defineProperty(proto, 'getBoundingClientRect', realClientWidth)
      else delete proto.getBoundingClientRect
      if (realRO) globalThis.ResizeObserver = realRO
      else delete globalThis.ResizeObserver
    }
  }

  const viewBoxOf = (c) => c.querySelector('[data-testid="rk-reaction"]')?.getAttribute('viewBox')

  it('cuts the box to the wrapper width once it can be measured', () => {
    const { container } = withMeasuredWidth(604, () => render(<ReactionBars quarters={ROWS} />))
    expect(viewBoxOf(container)).toBe(`0 0 604 ${VIEWBOX.height}`)
  })

  it('is a DIFFERENT box at a different width — the measurement is read, not ignored', () => {
    const { container } = withMeasuredWidth(880, () => render(<ReactionBars quarters={ROWS} />))
    expect(viewBoxOf(container)).toBe(`0 0 880 ${VIEWBOX.height}`)
  })

  it('falls back to VIEWBOX.width when the element measures 0 (detached/hidden)', () => {
    const { container } = withMeasuredWidth(0, () => render(<ReactionBars quarters={ROWS} />))
    expect(viewBoxOf(container)).toBe(`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`)
  })

  it('measures after mounting EMPTY first — the real SWR arrival order', () => {
    // This chart has an EmptyState early-return too, so it carries the same
    // trap: a useRef-based hook would measure an absent node once and never
    // run again. The shared hook uses a callback ref; this pins the ordering.
    const { container } = withMeasuredWidth(604, () => {
      const r = render(<ReactionBars quarters={[]} />)
      expect(r.container.querySelector('[data-testid="rk-reaction"]')).toBeNull()
      r.rerender(<ReactionBars quarters={ROWS} />)
      return r
    })
    expect(viewBoxOf(container)).toBe(`0 0 604 ${VIEWBOX.height}`)
  })

  it('re-cuts the box when the container later RESIZES', () => {
    let width = 604
    const proto = Element.prototype
    const realClientWidth = Object.getOwnPropertyDescriptor(proto, 'getBoundingClientRect')
    const realRO = globalThis.ResizeObserver
    roCallbacks.length = 0
    globalThis.ResizeObserver = class {
      constructor(cb) { this._cb = cb }
      observe() { roCallbacks.push(this._cb) }
      disconnect() { const i = roCallbacks.indexOf(this._cb); if (i >= 0) roCallbacks.splice(i, 1) }
    }
    Object.defineProperty(proto, 'getBoundingClientRect', { configurable: true, writable: true, value: () => ({ width: width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0 }) })
    try {
      const { container } = render(<ReactionBars quarters={ROWS} />)
      expect(viewBoxOf(container)).toBe(`0 0 604 ${VIEWBOX.height}`)
      width = 880
      act(() => { roCallbacks.forEach((cb) => cb()) })
      expect(viewBoxOf(container)).toBe(`0 0 880 ${VIEWBOX.height}`)
    } finally {
      if (realClientWidth) Object.defineProperty(proto, 'getBoundingClientRect', realClientWidth)
      else delete proto.getBoundingClientRect
      if (realRO) globalThis.ResizeObserver = realRO
      else delete globalThis.ResizeObserver
    }
  })

  it('bars get WIDER in a wider box, and stay capped', () => {
    const barOf = (w) => reactionGeometry(ROWS, { width: w, height: VIEWBOX.height }).bars[0].w
    expect(barOf(604)).toBeGreaterThan(barOf(320))
    expect(barOf(4000)).toBe(barOf(604))
  })

  it('the whole box is used: the last bar stays inside it', () => {
    const geo = reactionGeometry(ROWS, { width: 604, height: VIEWBOX.height })
    const last = geo.bars[geo.bars.length - 1]
    expect(last.cx).toBeGreaterThan(604 * 0.8)
    expect(last.cx).toBeLessThan(604)
  })
})
