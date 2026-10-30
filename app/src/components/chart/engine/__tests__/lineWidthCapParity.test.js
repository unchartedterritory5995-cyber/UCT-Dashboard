// app/src/components/chart/engine/__tests__/lineWidthCapParity.test.js
//
// ⭐⭐ ONE PLOT-WIDTH CEILING, CLIENT AND SERVER (`defSchema.LINE_WIDTH_HARD_MAX` ⇄
// `api/services/presentation_schema.LINE_WIDTH_HARD_MAX`), by ONE fixture both suites
// read (`tests/fixtures/line_width_cap.json`; the pytest twin is
// `tests/test_line_width_cap_parity.py`). The member door CLAMPS to it
// (`builderInputs.pineLineWidth`), so everything it builds is valid; a stored or
// shared document above it is REFUSED on both sides; 1..10 stays exact.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateDefinition, LINE_WIDTH_HARD_MAX } from '../defSchema'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { pineLineWidth } from '../../builder/builderInputs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const FIXTURE = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/line_width_cap.json'), 'utf8'))
const door = (lw) => {
  const b = memberPaneDefinition({ source: `//@version=5\nindicator("w")\nplot(ta.sma(close, 5), "w", linewidth = ${lw})\n`, id: 'u_member-pane-widthcap' })
  expect(b.ok, b.reason).toBe(true)
  return b.definition
}

describe('the plot width ceiling', () => {
  it('ONE value on both sides', () => {
    expect(LINE_WIDTH_HARD_MAX).toBe(FIXTURE.max)
  })
  for (const c of FIXTURE.cases) {
    it(`width ${c.width} as ${c.as} → ${c.ok ? 'valid' : 'refused'}`, () => {
      const d = JSON.parse(JSON.stringify(door(2)))
      if (c.as === 'literal') d.plots[0].width = c.width
      else Object.assign(d.inputs.find((i) => i.key === 'lineWidth'), { default: c.width, max: Math.max(10, c.width) })
      const v = validateDefinition(d)
      expect(v.ok, (v.errors || []).join(' ')).toBe(c.ok)
      if (!c.ok) expect(v.errors.some((e) => /width: at most 50 px/.test(e))).toBe(true)
    })
  }
  it('the door CLAMPS to it, so what it builds is valid — and 1..10 is exact', () => {
    expect([1, 2, 6, 10, 50, 51, 10000].map(pineLineWidth)).toEqual([1, 2, 6, 10, 50, 50, 50])
    const d = door(10000)
    expect(d.inputs.find((i) => i.key === 'lineWidth')).toMatchObject({ default: 50, max: 50 })
    expect(validateDefinition(d).ok).toBe(true)
  })
})
