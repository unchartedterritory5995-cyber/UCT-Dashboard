// A rich-text treemap label is laid out from the TOP of its tile, so the Map view pads each tile's
// label down by half its spare height, measured from the rendered layout.
import { expect, test } from 'vitest'
import { tilePads } from '../heatMapModel'

test('a tall tile pads its label down to the middle; the pad grows with the tile', () => {
  const p = tilePads([{ ticker: 'BIG', height: 400, size: 'xl' }, { ticker: 'MID', height: 120, size: 'm' }])
  // xl: 26px ticker (lineHeight 33) + 15px change (lineHeight 20) = 53px of label.
  expect(p.BIG).toBe(Math.floor((400 - 53) / 2))
  // m: 13 (16) + 10 (13) = 29px.
  expect(p.MID).toBe(Math.floor((120 - 29) / 2))
})

test('a tile shorter than its label gets no padding (never negative), an unknown size reads as small', () => {
  const p = tilePads([{ ticker: 'TINY', height: 10, size: 'xl' }, { ticker: 'ODD', height: 60, size: undefined }])
  expect(p.TINY).toBe(0)
  // s: 10 (13) + 9 (12) = 25px.
  expect(p.ODD).toBe(Math.floor((60 - 25) / 2))
})
