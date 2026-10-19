import { describe, expect, it } from 'vitest'
import { LABEL_MIN_GAP_PX, nudgeLabelOffsets } from './learnedLabelNudge'

describe('nudgeLabelOffsets', () => {
  it('leaves labels that are already far apart alone', () => {
    expect(nudgeLabelOffsets([10, 50, 120])).toEqual([0, 0, 0])
  })

  it('pushes the lower of two colliding labels down to the minimum gap', () => {
    const offs = nudgeLabelOffsets([100, 104])
    expect(offs).toEqual([0, LABEL_MIN_GAP_PX - 4])
  })

  it('spaces a cluster of three, in render order, without moving the top one', () => {
    const ys = [205, 200, 203]
    const offs = nudgeLabelOffsets(ys)
    const placed = ys.map((y, i) => y + offs[i]).sort((a, b) => a - b)
    expect(placed[0]).toBe(200)
    expect(placed[1] - placed[0]).toBeGreaterThanOrEqual(LABEL_MIN_GAP_PX)
    expect(placed[2] - placed[1]).toBeGreaterThanOrEqual(LABEL_MIN_GAP_PX)
  })

  it('ignores labels with no y', () => {
    expect(nudgeLabelOffsets([null, 50, undefined, 52])).toEqual([0, 0, 0, LABEL_MIN_GAP_PX - 2])
  })
})
