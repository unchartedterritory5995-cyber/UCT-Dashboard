import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { expandArchives, fromFileList, ImportLimitError } from './intake'

const vf = (path, u8) => ({ path, size: u8.length, lastModified: null, bytes: async () => u8 })

describe('expandArchives', () => {
  it('expands a zip into member VFiles with folder paths', async () => {
    const zip = zipSync({ 'Vault/Note.md': strToU8('# hi'), 'Vault/img/a.png': new Uint8Array([1]) })
    const { files } = await expandArchives([vf('export.zip', zip)])
    const paths = files.map((f) => f.path).sort()
    expect(paths).toEqual(['Vault/Note.md', 'Vault/img/a.png'])
    expect(new TextDecoder().decode(await files[0].bytes())).toBe('# hi')
  })

  it('expands a zip nested inside a zip (Notion workspace exports do this)', async () => {
    const inner = zipSync({ 'Page.md': strToU8('inner') })
    const outer = zipSync({ 'part-1.zip': inner })
    const { files } = await expandArchives([vf('export.zip', outer)])
    expect(files.map((f) => f.path)).toEqual(['part-1.zip/Page.md'])
  })

  it('throws ImportLimitError past the entry cap', async () => {
    const many = {}
    for (let i = 0; i < 30; i++) many[`f${i}.txt`] = strToU8('x')
    const zip = zipSync(many)
    await expect(expandArchives([vf('big.zip', zip)], { limits: { maxEntries: 10, maxTotalBytes: 1e9, maxArchiveBytes: 1e9 } }))
      .rejects.toBeInstanceOf(ImportLimitError)
  })
})

describe('fromFileList', () => {
  it('uses webkitRelativePath for folder-picker files', () => {
    const f = new File(['x'], 'a.md')
    Object.defineProperty(f, 'webkitRelativePath', { value: 'Vault/sub/a.md' })
    expect(fromFileList([f])[0].path).toBe('Vault/sub/a.md')
  })
})
