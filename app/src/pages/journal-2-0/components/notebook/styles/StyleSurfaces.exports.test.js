// Task 11.19 fix round 4: StyleSurfaces is the chunk every note opened with a style loads (KindSection, StyleHost,
// SaveStyleDoor through styles/lazyStyles). Anything else exported from it rides along on ordinary note opens, so the
// export list is EXACT. (My tools' template editor imports StyleEditor statically inside its own lazy chunk instead.)
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const exportsOf = (src) => [...src.matchAll(/^\s*export\s*\{\s*default\s+as\s+(\w+)\s*\}/gm)].map((m) => m[1])
  .concat([...src.matchAll(/^\s*export\s+(?:const|function|let|class|default)\b\s*(\w*)/gm)].map((m) => m[1] || 'default'))
  .concat([...src.matchAll(/^\s*export\s*\*\s*from/gm)].map(() => '*'))

describe('StyleSurfaces exports exactly the three in-note surfaces', () => {
  it('KindSection, StyleHost and SaveStyleDoor, nothing else', () => {
    const src = fs.readFileSync(path.join(__dirname, 'StyleSurfaces.js'), 'utf8')
    expect(exportsOf(src).sort()).toEqual(['KindSection', 'SaveStyleDoor', 'StyleHost'])
  })

  it('CONTROL: a fourth export, a star re-export or a local export is SEEN', () => {
    expect(exportsOf("export { default as StyleEditor } from './StyleEditor'")).toEqual(['StyleEditor'])
    expect(exportsOf("export * from './StyleEditor'")).toEqual(['*'])
    expect(exportsOf('export const x = 1')).toEqual(['x'])
  })
})
