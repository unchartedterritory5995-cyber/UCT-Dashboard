// The controls for lab/__tests__/shippedLab.js: it must tell a workbench-only piece from a lab module the product
// imports, or every rail that uses it either skips shipped code or judges code that never ships.
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { labShipping } from './shippedLab'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('which Study-workbench modules ship', () => {
  const { ships, shippedLab, isLab } = labShipping(SRC)

  it('NON-VACUITY: the product really imports some lab modules, and those ship', () => {
    // The challenges reuse the workbench's start card and bits (lab/labAbsent.test.js says so).
    const importer = fs.readdirSync(path.join(SRC, 'pages', 'study', 'challenges'))
      .map((f) => path.join(SRC, 'pages', 'study', 'challenges', f))
      .find((f) => /from\s+['"][^'"]*\/lab\/StartCard['"]/.test(fs.readFileSync(f, 'utf8')))
    expect(importer, 'no Study challenge imports lab/StartCard any more: pick another shipped lab module').toBeTruthy()
    expect(shippedLab.has('lab/StartCard.jsx')).toBe(true)
    expect(ships('lab/StartCard.jsx')).toBe(true)
  })

  it('the workbench entry and its pieces do not ship', () => {
    expect(fs.existsSync(path.join(SRC, 'lab', 'Lab.jsx'))).toBe(true)
    expect(ships('lab/main.jsx')).toBe(false)
    expect(ships('lab/Lab.jsx')).toBe(false)
    expect(ships('lab/pieces/Piece64DailyDrill.jsx')).toBe(false)
  })

  it('a module outside lab/ always ships, and only lab/ paths are lab', () => {
    expect(ships('pages/Settings.jsx')).toBe(true)
    expect(isLab('lab/x.js')).toBe(true)
    expect(isLab('pages/lab/x.js')).toBe(false)
  })
})
