// @vitest-environment node
/* THE FEED'S BUDGET, PINNED WHERE IT CAN ACTUALLY BE PROVED.
 *
 * ⛔ The "at most three live charts" claim is the difference between a review
 * feed and a mobile memory incident, and it cannot be established by rendering:
 * an IntersectionObserver needs layout, jsdom has none, and a device test is a
 * thing a human has to be holding. So the POLICY is a pure function and this is
 * where the ceiling is enforced.
 */
import { describe, it, expect } from 'vitest'
import { feedWindow, centreFrom, FEED_MAX_LIVE, FEED_RADIUS } from './feedWindow'

const LIST = Array.from({ length: 40 }, (_, i) => `S${i}`)

describe('the live window', () => {
  it('⛔⛔ NEVER EXCEEDS THE BUDGET, anywhere in a long list', () => {
    // The whole list is swept rather than three sampled points: an off-by-one at
    // one end is exactly the shape that ships.
    for (let i = 0; i < LIST.length; i += 1) {
      expect(feedWindow(LIST, i).length).toBeLessThanOrEqual(FEED_MAX_LIVE)
    }
  })

  it('⭐ is CENTRED — the card you scrolled up from stays live', () => {
    // A leading window ("this and the next two") leaves the previous card a
    // placeholder, and back is the direction a reviewer moves for a second look.
    expect(feedWindow(LIST, 10)).toEqual(['S9', 'S10', 'S11'])
  })

  it('⛔ CLAMPS at the ends rather than borrowing forward', () => {
    // A member at the first card is not looking at the third; mounting it spends
    // a third of the budget on a chart nobody has reached.
    expect(feedWindow(LIST, 0)).toEqual(['S0', 'S1'])
    expect(feedWindow(LIST, 39)).toEqual(['S38', 'S39'])
  })

  it('an out-of-range centre is clamped, never a hole', () => {
    expect(feedWindow(LIST, -5)).toEqual(['S0', 'S1'])
    expect(feedWindow(LIST, 999)).toEqual(['S38', 'S39'])
  })

  it('degrades quietly on nothing', () => {
    expect(feedWindow([], 0)).toEqual([])
    expect(feedWindow(null, 3)).toEqual([])
  })

  it('a list shorter than the window is the whole list, not padded', () => {
    expect(feedWindow(['A', 'B'], 0)).toEqual(['A', 'B'])
    expect(feedWindow(['A'], 0)).toEqual(['A'])
  })

  it('CONTROL: the radius really drives it — the constants are not decoration', () => {
    expect(FEED_RADIUS).toBe(1)
    expect(FEED_MAX_LIVE).toBe(3)
    expect(feedWindow(LIST, 10, 2)).toEqual(['S8', 'S9', 'S10', 'S11', 'S12'])
  })
})

describe('which card is being looked at', () => {
  it('the most visible one wins', () => {
    expect(centreFrom([{ index: 3, ratio: 0.2 }, { index: 4, ratio: 0.8 }])).toBe(4)
  })

  it('⛔ A TIE GOES TO THE EARLIER CARD, and that is a stability rule', () => {
    // Two half-visible cards straddling the fold is the steady state of a
    // scroll. A rule that flipped on a rounding difference would re-window —
    // unmounting and remounting a chart — on every frame of a slow drag.
    expect(centreFrom([{ index: 7, ratio: 0.5 }, { index: 8, ratio: 0.5 }])).toBe(7)
  })

  it('a card with zero visibility is not a candidate', () => {
    expect(centreFrom([{ index: 0, ratio: 0 }, { index: 9, ratio: 0.1 }])).toBe(9)
  })

  it('⛔ nothing visible KEEPS the current centre — it never resets to the top', () => {
    // Between observer callbacks (a fast flick, a hidden tab) the answer must be
    // "unchanged", not "card zero" — which would unmount the live charts and
    // remount them somewhere the member is not looking.
    expect(centreFrom([], 12)).toBe(12)
    expect(centreFrom([{ index: 3, ratio: 0 }], 12)).toBe(12)
    expect(centreFrom(null, 12)).toBe(12)
  })

  it('malformed entries are ignored rather than trusted', () => {
    expect(centreFrom([{ index: NaN, ratio: 1 }, { index: 2, ratio: 0.4 }])).toBe(2)
    expect(centreFrom([{ index: 5, ratio: NaN }], 1)).toBe(1)
  })
})
