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
    expect(r.roots).toEqual(['V'])
    expect(r.rootOf('V/A/n.md')).toBe('V')
    const none = await makeObsidianResolver(VAULT.map((p) => vf(p)))
    expect(none.roots).toEqual([])
    expect(none.rootOf('V/A/n.md')).toBe('')
  })

  it('resolves each link inside its own note\'s vault when the drop holds two', async () => {
    const r = await makeObsidianResolver([
      vf('Obsidian/Work/.obsidian/app.json', '{}'), vf('Obsidian/Personal/.obsidian/app.json', '{}'),
      vf('Obsidian/Work/a.md'), vf('Obsidian/Work/Plan.md'), vf('Obsidian/Work/img/c.png'),
      vf('Obsidian/Personal/b.md'), vf('Obsidian/Personal/Deep/Plan.md'), vf('Obsidian/Personal/c.png'),
    ])
    expect(r.rootOf('Obsidian/Personal/b.md')).toBe('Obsidian/Personal')
    expect(r.resolve('Plan', 'Obsidian/Work/a.md')).toBe('Obsidian/Work/Plan.md')
    expect(r.resolve('Plan', 'Obsidian/Personal/b.md')).toBe('Obsidian/Personal/Deep/Plan.md')
    expect(r.resolve('c.png', 'Obsidian/Work/a.md')).toBe('Obsidian/Work/img/c.png')
    expect(r.resolve('c.png', 'Obsidian/Personal/b.md')).toBe('Obsidian/Personal/c.png')
    expect(r.resolve('/Plan', 'Obsidian/Personal/b.md')).toBe(null)
  })

  it('resolves a loose note beside a vault against the whole drop', async () => {
    const r = await makeObsidianResolver([
      vf('Drop/Vault/.obsidian/app.json', '{}'), vf('Drop/Vault/Plan.md'), vf('Drop/Vault/x.png'),
      vf('Drop/loose.md'), vf('Drop/Other.md'),
    ])
    expect(r.resolve('Plan', 'Drop/loose.md')).toBe('Drop/Vault/Plan.md')
    expect(r.resolve('Other', 'Drop/loose.md')).toBe('Drop/Other.md')
    expect(r.resolve('x.png', 'Drop/loose.md')).toBe('Drop/Vault/x.png')
    // ...while the vault's own notes still see only the vault.
    expect(r.resolve('Other', 'Drop/Vault/Plan.md')).toBe(null)
  })

  it('splits #/? off a markdown href BEFORE its one decode', async () => {
    const r = await makeObsidianResolver([vf('a.md'), vf('Q%3F and %23.md'), vf('Q? and #1.md')])
    expect(r.resolve('Q%253F and %2523.md', 'a.md', { decode: true })).toBe('Q%3F and %23.md')
    expect(r.resolve('Q%3F and %231.md#H', 'a.md', { decode: true })).toBe('Q? and #1.md')
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
