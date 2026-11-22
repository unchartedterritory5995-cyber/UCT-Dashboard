// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.b4bColourCast.test.js
//
// ─── U-BUILTIN B4b (2026-11-21) — `color(x)` OF A COLOUR IS THAT COLOUR, ON THE CAPTURES THAT NEED IT ─────
//
// bolingger-bands-inside-bar-boxes (committed, MPL) draws every box with `border_color = color(bgColor)`, an
// `input.color`. The runtime lane refused the cast `pine:function`, so its drawing program never built (DRAW-1) and the
// grade read DIVERGE on all three captures: "TradingView holds 51 drawing object(s) at the last bar and our script has
// no drawing program". The reference (`color()`): "The value of the argument after casting to color". Now the program
// builds, every plot still MATCHes, and the ONE thing not drawn is withheld BY NAME: the boxes, at
// `objects:count-at-cap` (the script holds more boxes than its max count, and which oldest ones TradingView keeps is
// unmeasured until vw-draw-count-at-cap). A DIVERGE became an honest refusal; no box is guessed.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import path from 'node:path'

import { loadCapture, gradeCapture } from './harness'

const REPO = path.resolve(process.cwd(), '..')
const IDS = ['bolingger-bands-inside-bar-boxes-rddt-1d-2026-11-14', 'bolingger-bands-inside-bar-boxes-rddt-1d-2026-11-17',
  'bolingger-bands-inside-bar-boxes-spy-1d-2026-11-17']
const cap = (id) => loadCapture(path.join(REPO, 'tests/fixtures/vendor/harness', `${id}.json`)).capture

beforeAll(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
})
afterAll(() => { vi.unstubAllEnvs() })

describe('⭐⭐ B4b — bolingger-bands-inside-bar-boxes on the runtime lane: the program draws, and only the boxes are withheld, by name', () => {
  for (const id of IDS) {
    it(id, () => {
      const c = cap(id)
      expect(c.source.text).toMatch(/border_color = color\(bgColor\)/)          // the witness uses the cast
      expect(c.objects.records.boxes.length).toBeGreaterThan(0)                  // and TradingView drew boxes
      const g = gradeCapture(c)
      expect(g.ours && g.ours.ok, JSON.stringify(g.ours && g.ours.refusal)).toBe(true)
      const ob = g.ours.objects
      expect(ob && ob.lane).toBe('runtime')
      expect(ob.drawsObjects).toBe(true)                                         // ⛔ was: no drawing program at all
      expect(ob.withheldGuards).toEqual(['objects:count-at-cap'])                // the one wall left, by name
      expect(g.verdict.objects).toMatchObject({ verdict: 'INCONCLUSIVE', withheld: 'objects:count-at-cap' })
      expect(g.verdict.objects.reason).toMatch(/every other object family's counts and texts agree/)
      for (const p of g.verdict.plots) expect(p.verdict, p.title).toBe('MATCH')
      expect(g.verdict.verdict).not.toBe('DIVERGE')
    })
  }
})
