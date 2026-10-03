// Wave 13 lane 13H-3 — the pure arithmetic behind the chart embed's Draw-mode
// toolbar-clearance height bump. See WidgetEmbedView.drawClearance.test.jsx for
// the end-to-end mechanism (the DOM measurement that feeds `drawClearance` in).
import { describe, it, expect } from 'vitest'
import { annotateEffectiveHeight, EMBED_MAX_H, ANNOTATE_DRAW_BUFFER_PX } from './widgetEmbedCore'

describe('annotateEffectiveHeight', () => {
  it('no clearance measured (fine pointer, or Draw mode closed): the base height is unchanged', () => {
    expect(annotateEffectiveHeight(400, 0)).toBe(400)
  })

  it('a measured toolbar bottom bumps the height past it by the buffer', () => {
    // The measured 390px-wide case (docs/notebook/evidence/wave13-13h3/): the
    // toolbar bottoms out ~174px below the body's own top edge.
    expect(annotateEffectiveHeight(400, 174)).toBe(174 + ANNOTATE_DRAW_BUFFER_PX)
  })

  it('never SHRINKS the embed: an already-taller base height wins', () => {
    expect(annotateEffectiveHeight(1000, 174)).toBe(1000)
  })

  it('is clamped to EMBED_MAX_H — the same ceiling the resize handles obey', () => {
    expect(annotateEffectiveHeight(400, EMBED_MAX_H)).toBe(EMBED_MAX_H)
  })

  it('a zero, negative or NaN clearance is treated as "nothing measured"', () => {
    expect(annotateEffectiveHeight(400, 0)).toBe(400)
    expect(annotateEffectiveHeight(400, -5)).toBe(400)
    expect(annotateEffectiveHeight(400, NaN)).toBe(400)
  })
})
