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
import { __resetNoteBatchForTests, loadNoteBatch, noteBatchLoader } from './NotebookTab'
import { chunkRetry } from '../lib/lazyChunk'
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

  // Fix round 1 (I1): the failure names its chunk, so the retry runs under the new address (chunkRetry.importUrl).
  const chunkError = () => new Error(`Failed to fetch dynamically imported module: ${window.location.origin}/assets/noteBatch-abc.js`)

  it('a failed fetch whose retry succeeds hands over the module (noteBatch has no default export)', async () => {
    const real = noteBatchLoader.load
    vi.spyOn(noteBatchLoader, 'load').mockRejectedValue(chunkError())
    const retry = vi.spyOn(chunkRetry, 'importUrl').mockImplementation(() => real())
    const m = await loadNoteBatch()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(typeof m.runNoteBatch).toBe('function')
  }, 15000)

  it('two failed fetches answer chunkLost with the plain sentence, never reload by themselves, and the next press asks again', async () => {
    const reload = vi.spyOn(pageReload, 'run').mockImplementation(() => {})
    const real = noteBatchLoader.load
    const load = vi.spyOn(noteBatchLoader, 'load').mockRejectedValue(chunkError())
    const retry = vi.spyOn(chunkRetry, 'importUrl').mockRejectedValue(chunkError())
    const err = await loadNoteBatch().catch((e) => e)
    expect(err.chunkLost).toBe(true)
    expect(err.message).toBe('This action could not be loaded.')
    expect(load).toHaveBeenCalledTimes(1)
    expect(retry).toHaveBeenCalledTimes(1)                 // one retry, under the new address
    expect(reload).not.toHaveBeenCalled()
    load.mockImplementation(real)
    retry.mockRestore()
    const m = await loadNoteBatch()
    expect(typeof m.runNoteBatch).toBe('function')
  }, 15000)
})
