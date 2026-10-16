// ⛔ The WIRE for the chart header's RVOL (approach B): `resolveHeaderField('rvol')` reads the
// chart symbol's OWN curve only if ChartPane (a) asks the endpoint for that symbol — ONE
// request per symbol change, never per tick — and (b) hands the symbol to the resolver.
// headerFields.test.js proves the resolver; this proves the pane feeds it. Comments are
// stripped so prose cannot satisfy it.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'ChartPane.jsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

describe('ChartPane RVOL wiring', () => {
  it("asks for the chart symbol's curve, keyed by that symbol only", () => {
    expect(src).toMatch(/useVolumeCurve\(wantsCurve, wantsCurve \? \[sym\] : \[\]\)/)
  })
  it('passes the symbol and the curve to the header resolver', () => {
    expect(src).toMatch(/const ctx = \{[^}]*\bvolCurve, sym \}/)
  })
})
