// Follow-up A (first-open bytes): the bulk actions' library (lib/noteBatch.js) is off the Notebook's first open.
//  1. No first-open file imports it statically (AST, never grep: a path in a comment is not an import).
//  2. The list's loader retries once, then fails as `chunkLost` with the plain sentence (never a throw out of the list,
//     never a reload by itself), and a later press asks again and succeeds.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { BULK_UNAVAILABLE, __resetNoteBatchForTests, loadNoteBatch, noteBatchLoader } from './NotebookTab'
import { pageReload } from '../lib/heldModule'

const JsxParser = Parser.extend(jsx())
const WAVE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NOTE_BATCH = /(^|\/)noteBatch(\.js)?$/

function staticImports(rel) {
  const ast = JsxParser.parse(fs.readFileSync(path.join(WAVE, rel), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })
  const out = []
  ;(function visit(n) {
    if (!n || typeof n.type !== 'string') return
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration')
      && n.source && NOTE_BATCH.test(n.source.value)) out.push(n.source.value)
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v.type === 'string') visit(v)
    }
  })(ast)
  return out
}

afterEach(() => { __resetNoteBatchForTests(); vi.restoreAllMocks() })

describe('the bulk actions library stays off the first open', () => {
  it.each([
    'tabs/NotebookTab.jsx',
    'components/notebook/NoteEditorPage.jsx',
    'components/notebook/TodayHome.jsx',
  ])('%s does not import lib/noteBatch statically', (rel) => {
    expect(staticImports(rel)).toEqual([])
  })

  it('NON-VACUITY: the walk sees a static importer that is allowed to (the lazy AI actions library)', () => {
    expect(staticImports('lib/aiActions.js')).toEqual(['./noteBatch'])
  })
})

describe('loadNoteBatch', () => {
  it('a press with the library in hand gets the real module', async () => {
    const m = await loadNoteBatch()
    expect(typeof m.runNoteBatch).toBe('function')
    expect(typeof m.describeBatch).toBe('function')
  })

  it('two failed fetches answer chunkLost with the plain sentence, never reload by themselves, and the next press asks again', async () => {
    const reload = vi.spyOn(pageReload, 'run').mockImplementation(() => {})
    const real = noteBatchLoader.load
    const load = vi.spyOn(noteBatchLoader, 'load').mockRejectedValue(new TypeError('Failed to fetch dynamically imported module'))
    const err = await loadNoteBatch().catch((e) => e)
    expect(err.chunkLost).toBe(true)
    expect(err.message).toBe(BULK_UNAVAILABLE)
    expect(load).toHaveBeenCalledTimes(2)                 // one in-place retry
    expect(reload).not.toHaveBeenCalled()
    load.mockImplementation(real)
    const m = await loadNoteBatch()
    expect(typeof m.runNoteBatch).toBe('function')
  }, 15000)
})
