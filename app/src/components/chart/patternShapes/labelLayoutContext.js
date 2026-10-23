// app/src/components/chart/patternShapes/labelLayoutContext.js — the overlay's per-render label offsets.
// PatternOverlay computes them (labelLayout.stackLabels) and provides { dy: {labelId: px} }; a label
// reads its own offset by id. Absent (no provider) = every offset 0, i.e. the old placement.
import { createContext } from 'react'

export const LabelLayoutContext = createContext(null)

export function labelDyFor(layout, id) {
  const v = layout?.dy?.[id]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
