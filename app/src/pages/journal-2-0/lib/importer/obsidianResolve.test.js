import { describe, it, expect } from 'vitest'
import { makeObsidianResolver } from './obsidianResolve'

const vf = (path, text = '') => ({ path, size: text.length, lastModified: null,
                                    bytes: async () => new TextEncoder().encode(text) })

const VAULT = [
  'V/A/n.md', 'V/B/x.png', 'V/Files/x.png', 'V/A/x.png', 'V/Deep/er/x.png',
  'V/C/m.md', 'V/Other note.md', 'V/Notes/Other.md', 'V/Notes/Src.md', 'V/Archive/Deep.md',
]
const withConfig = (cfg, paths = VAULT) =>
  [vf('V/.obsidian/app.json', cfg), ...paths.map((p) => vf(p))]

describe('makeObsidianResolver', () => {
  it('finds the vault root from .obsidian/ and reads attachmentFolderPath', async () => {
    const r = await makeObsidianResolver(withConfig('{"attachmentFolderPath":"Files"}'))
    expect(r.root).toBe('V')
    const none = await makeObsidianResolver(VAULT.map((p) => vf(p)))
    expect(none.root).toBe('')
  })

  it('prefers the same folder', async () => {
    const r = await makeObsidianResolver(withConfig('{"attachmentFolderPath":"Files"}'))
    expect(r.resolve('x.png', 'V/A/n.md')).toBe('V/A/x.png')
  })

  it('then the attachment folder', async () => {
    const r = await makeObsidianResolver(withConfig('{"attachmentFolderPath":"Files"}'))
    expect(r.resolve('x.png', 'V/C/m.md')).toBe('V/Files/x.png')
  })

  it('reads a "./sub" attachment folder as the source note\'s own subfolder', async () => {
    const r = await makeObsidianResolver(withConfig('{"attachmentFolderPath":"./att"}',
      ['V/C/m.md', 'V/B/x.png', 'V/C/att/x.png']))
    expect(r.resolve('x.png', 'V/C/m.md')).toBe('V/C/att/x.png')
  })

  it('then the shortest path', async () => {
    const r = await makeObsidianResolver(withConfig('not json',
      ['V/C/m.md', 'V/B/x.png', 'V/Files/q/x.png', 'V/Deep/er/x.png']))
    expect(r.resolve('x.png', 'V/C/m.md')).toBe('V/B/x.png')
    const noA = await makeObsidianResolver(withConfig('{}',
      ['V/C/m.md', 'V/Deep/er/x.png', 'V/B/x.png']))
    expect(noA.resolve('x.png', 'V/C/m.md')).toBe('V/B/x.png')
  })

  it('breaks a same-depth tie by the shorter path, then lexicographically', async () => {
    const r = await makeObsidianResolver(withConfig('{}',
      ['V/C/m.md', 'V/Bbb/x.png', 'V/Bb/x.png', 'V/Ba/x.png']))
    expect(r.resolve('x.png', 'V/C/m.md')).toBe('V/Ba/x.png')
  })

  it('decodes a markdown href once and appends .md', async () => {
    const r = await makeObsidianResolver(withConfig('{}'))
    expect(r.resolve('Other%20note', 'V/A/n.md', { decode: true })).toBe('V/Other note.md')
    // A wikilink is never decoded: `%20` is part of a name as written.
    expect(r.resolve('Other%20note', 'V/A/n.md')).toBe(null)
  })

  it('strips the escaped table pipe', async () => {
    const r = await makeObsidianResolver(withConfig('{}'))
    expect(r.resolve('Other note\\', 'V/A/n.md')).toBe('V/Other note.md')
  })

  it('drops #anchors and |aliases before resolving', async () => {
    const r = await makeObsidianResolver(withConfig('{}'))
    expect(r.resolve('Other note#Risk', 'V/A/n.md')).toBe('V/Other note.md')
    expect(r.resolve('Other note|alias', 'V/A/n.md')).toBe('V/Other note.md')
    expect(r.resolve('#Risk', 'V/A/n.md')).toBe(null)
  })

  it('resolves a relative path beside the source, then from the root, never above the root', async () => {
    const r = await makeObsidianResolver(withConfig('{}', [...VAULT, 'Outside.md']))
    expect(r.resolve('../Notes/Other.md', 'V/Notes/Src.md', { decode: true })).toBe('V/Notes/Other.md')
    expect(r.resolve('Archive/Deep.md', 'V/Notes/Src.md', { decode: true })).toBe('V/Archive/Deep.md')
    expect(r.resolve('/Archive/Deep', 'V/Notes/Src.md')).toBe('V/Archive/Deep.md')
    // `Outside.md` is in the drop but not in the vault: a link never climbs out of it.
    expect(r.resolve('../../Outside.md', 'V/Notes/Src.md', { decode: true })).toBe(null)
    expect(r.resolve('../../../Outside.md', 'V/Notes/Src.md', { decode: true })).toBe(null)
    // No `.obsidian/`: the drop's top is the vault's top, and `..` from it is nothing.
    const flat = await makeObsidianResolver([vf('a.md'), vf('x.md')])
    expect(flat.resolve('../x.md', 'a.md', { decode: true })).toBe(null)
    expect(flat.resolve('./x.md', 'a.md', { decode: true })).toBe('x.md')
  })

  it('falls back to a /-boundary suffix match for a partial path', async () => {
    const r = await makeObsidianResolver(withConfig('{}'))
    expect(r.resolve('er/x.png', 'V/A/n.md')).toBe('V/Deep/er/x.png')
    expect(r.resolve('r/x.png', 'V/A/n.md')).toBe(null)
  })

  it('matches names case-insensitively', async () => {
    const r = await makeObsidianResolver(withConfig('{}'))
    expect(r.resolve('other NOTE', 'V/A/n.md')).toBe('V/Other note.md')
  })
})
