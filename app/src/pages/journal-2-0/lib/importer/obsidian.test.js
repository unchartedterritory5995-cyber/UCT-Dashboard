import { describe, it, expect } from 'vitest'
import { obsidianAdapter } from './adapters/obsidian'

const vf = (path, text) => ({ path, size: text.length, lastModified: null,
                              bytes: async () => new TextEncoder().encode(text) })

describe('obsidian adapter', () => {
  it('parses frontmatter tags + created and strips the block', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('Vault/n.md', '---\ntags: [swing, vcp]\ncreated: 2024-01-05\n---\n# N\nbody')])
    expect(docs[0].tags).toEqual(['swing', 'vcp'])
    expect(docs[0].createdAt).toBe('2024-01-05')
    expect(docs[0].html).not.toContain('tags:')
  })

  it('resolves wiki-links by basename and leaves unresolvable ones as text', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('Vault/a.md', 'see [[Setups/VCP|the setup]] and [[Ghost Note]]'),
      vf('Vault/Setups/VCP.md', 'x')])
    const a = docs.find((d) => d.importKey === 'obsidian:Vault/a.md')
    expect(a.html).toContain('data-import-link="obsidian:Vault/Setups/VCP.md"')
    expect(a.html).toContain('the setup')
    expect(a.html).not.toContain('data-import-link="obsidian:Ghost')
    expect(a.html).toContain('Ghost Note')
  })

  it('turns image embeds into media refs and callouts into blockquotes', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('V/n.md', '![[chart.png]]\n\n> [!warning] Risk\n> tight stop'),
      vf('V/files/chart.png', '')])
    const d = docs[0]
    expect(d.media[0].ref).toBe('V/files/chart.png')
    expect(d.html).toContain('import-ref://V/files/chart.png')
    expect(d.html).toMatch(/<blockquote>.*Risk.*tight stop/s)
  })

  it('skips the .obsidian config dir', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('.obsidian/workspace.json', '{}'), vf('n.md', 'x')])
    expect(docs).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Supplementary coverage beyond the brief's Step-1 test text — exercises the
// self-review items called out in the task brief: code fences must protect
// wiki-syntax inside them, path-qualified link targets must resolve past a
// single directory level, and the async content-detection heuristic must
// never reject (a bytes() failure counts as no signal from that file).
// ---------------------------------------------------------------------------

describe('obsidian adapter — code fences protect wiki-syntax inside them', () => {
  it('leaves wiki-links, embeds, and highlights untouched inside a fenced code block', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf(
        'n.md',
        'before [[Real Link]]\n\n```\n[[Fake Link]] ![[fake.png]] ==fake== > [!note] Fake\n```\n\nafter ==real=='
      ),
    ])
    const html = docs[0].html
    expect(html).toContain('[[Fake Link]]')
    expect(html).toContain('![[fake.png]]')
    expect(html).toContain('==fake==')
    expect(html).not.toContain('<mark>fake</mark>')
    expect(html).toContain('<mark>real</mark>')
  })
})

describe('obsidian adapter — path-qualified resolution beyond one directory level', () => {
  it('resolves a two-level path-qualified link target', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('Vault/a.md', '[[Deep/Nested/Target]]'),
      vf('Vault/Deep/Nested/Target.md', 'x'),
    ])
    const a = docs.find((d) => d.importKey === 'obsidian:Vault/a.md')
    expect(a.html).toContain('data-import-link="obsidian:Vault/Deep/Nested/Target.md"')
  })
})

describe('obsidian adapter — detect() is async-tolerant and never rejects', () => {
  it('treats a bytes() failure on a sampled file as no signal, not a rejection', async () => {
    const bad = {
      path: 'note.md',
      size: 10,
      lastModified: null,
      bytes: async () => {
        throw new Error('boom')
      },
    }
    const good = vf('other.md', 'has [[a link]] in it')
    await expect(obsidianAdapter.detect([bad, good])).resolves.toBe(0.6)

    const onlyBad = {
      path: 'note2.md',
      size: 10,
      lastModified: null,
      bytes: async () => {
        throw new Error('boom')
      },
    }
    await expect(obsidianAdapter.detect([onlyBad])).resolves.toBe(0)
  })
})
