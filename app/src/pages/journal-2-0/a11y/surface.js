// app/src/pages/journal-2-0/a11y/surface.js
//
// `axeSurface(id, recipe)` registers ONE axe rail for one Notebook surface
// (wave 8, lane 8A, A1). The id is what `notebookSurfaces.js` names as a
// file's recipe or `coveredBy`, and `surfaceCoverage.test.js` reads the rail
// files for `axeSurface('<id>'` — so a manifest entry naming a recipe nobody
// registered fails there, by name.
//
// The recipe renders the surface and proves it rendered (a non-vacuity
// assertion on something specific); it resolves to `{ root }` when the axe run
// should be scoped, or nothing for `document.body` (which also holds every
// portaled popover and sheet).
import { it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { expectNoAxeViolations } from './axeHarness'

export function axeSurface(id, recipe, { level = 'component', timeout = 30000 } = {}) {
  it(`surface "${id}": axe finds 0 violations`, async () => {
    try {
      const out = await recipe()
      await expectNoAxeViolations(out?.root || document.body, { level })
    } finally {
      cleanup()
    }
  }, timeout)
}
