// app/src/testing/lazyChunks.test.js
//
// ⛔ Every lazy chunk a test preloads (`lazyChunks.js`) is the one its importer loads lazily: the importer's
// source still holds the exact `import('<spec>')`, the spec resolves to a real file, and the module the entry
// loads IS that file's module (one instance). A chunk moved or renamed fails HERE, by name, instead of silently
// preloading the wrong module and bringing the race back.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { LAZY_CHUNKS, NOTE_EDITOR_CHUNKS, NOTEBOOK_TAB_CHUNKS } from './lazyChunks'

const SRC = path.resolve(__dirname, '..')
const EXT = ['', '.js', '.jsx', '.mjs', '/index.js', '/index.jsx']
function resolveSpec(importer, spec) {
  const base = path.resolve(SRC, path.dirname(importer), spec)
  for (const e of EXT) {
    const f = base + e
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return path.relative(SRC, f).replace(/\\/g, '/')
  }
  return null
}

describe('the lazy chunks a test may preload', () => {
  it('names some, and the groups name only entries that exist (a rail over nothing passes)', () => {
    expect(Object.keys(LAZY_CHUNKS).length).toBeGreaterThan(5)
    for (const n of [...NOTE_EDITOR_CHUNKS, ...NOTEBOOK_TAB_CHUNKS]) expect(LAZY_CHUNKS[n], n).toBeTruthy()
  })

  for (const [name, c] of Object.entries(LAZY_CHUNKS)) {
    it(`${name}: ${c.importer} still loads ${c.spec} lazily, and the entry loads that very module`, async () => {
      const src = fs.readFileSync(path.join(SRC, c.importer), 'utf8')
      expect(src.includes(`import('${c.spec}')`) || src.includes(`import("${c.spec}")`),
        `${c.importer} no longer holds import('${c.spec}')`).toBe(true)
      const file = resolveSpec(c.importer, c.spec)
      expect(file, `${c.spec} from ${c.importer} resolves to no file`).toBeTruthy()
      const viaImporter = await import(/* @vite-ignore */ `/src/${file}`)
      expect(await c.load()).toBe(viaImporter)
    }, 300_000)
  }
})
