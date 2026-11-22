// ⭐ Every UCT RS definition's RENDERED input labels fit the inspector column (17 characters).
//
// colorUpDownSubstitution.test.js holds this for today's `rsLine`, which declares the slim line's
// second average `legacy` (never rendered). The SLIM line (`RS_LINE_SLIM_RAW`, registered under
// `VITE_RS_SPLIT_ENABLED`) RENDERS them, and nothing held its labels: three would truncate
// ("Second average (bars)" 21, "Second average type" 19, "Second average colour" 21; found by the
// stale-rail repair, PR #1367). So this rail walks every RS definition, both rsLine variants
// included, over what the inspector renders (`indicatorRegistry.visibleInputs`, the one filter).
import { describe, it, expect } from 'vitest'
import { getDefinition, RS_LINE_SLIM_RAW, RS_LINE_V5_RAW } from '../nativeRegistry'
import { visibleInputs } from '../../indicatorRegistry'

// 17 = the longest label that rendered whole in the 2026-11-06 recapture ('High before price').
const MAX = 17

const DEFS = [
  ['rsLine (slim, VITE_RS_SPLIT_ENABLED)', RS_LINE_SLIM_RAW],
  ['rsLine (today)', RS_LINE_V5_RAW],
  ...['rsRating', 'rsPhases', 'rsVsEma', 'rsExit', 'rsMansfield'].map((id) => [id, getDefinition(id)]),
]

describe('every RS input label the inspector renders fits its 17-character column', () => {
  for (const [name, def] of DEFS) {
    it(name, () => {
      expect(def, `${name} is registered`).toBeTruthy()
      const shown = visibleInputs(def)
      expect(shown.length, `${name} renders inputs`).toBeGreaterThan(0)
      const long = shown.filter((i) => typeof i.label === 'string' && i.label.length > MAX)
        .map((i) => `${i.key}: "${i.label}" (${i.label.length})`)
      expect(long, `${name}: labels longer than ${MAX}`).toEqual([])
    })
  }

  it('the slim line renders its second average (the case the old rail could not see)', () => {
    const keys = new Set(visibleInputs(RS_LINE_SLIM_RAW).map((i) => i.key))
    for (const k of ['maLength2', 'maType2', 'ma2Color']) expect(keys.has(k), k).toBe(true)
  })
})
