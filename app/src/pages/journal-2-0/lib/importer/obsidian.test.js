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

// ---------------------------------------------------------------------------
// Fix-review coverage (coordinator review of the initial implementation) —
// inline single-backtick code spans, the unresolved-embed fallback, and
// `#Heading`/`#^block` link-anchor stripping.
// ---------------------------------------------------------------------------

describe('obsidian adapter — inline code spans protect wiki-syntax too', () => {
  it('leaves a resolvable wiki-link untouched inside an inline code span', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('Vault/a.md', 'Use `[[Other Note]]` to link to it.'),
      vf('Vault/Other Note.md', 'x'),
    ])
    const a = docs.find((d) => d.importKey === 'obsidian:Vault/a.md')
    // The raw wiki-link text must survive byte-for-byte inside the code span
    // — not be converted to a link, and not lose its brackets either.
    expect(a.html).toContain('[[Other Note]]')
    expect(a.html).not.toContain('data-import-link')
  })

  it('leaves ==highlight== untouched inside an inline code span', async () => {
    const { docs } = await obsidianAdapter.parse([vf('n.md', 'Syntax: `==x==` stays literal.')])
    expect(docs[0].html).toContain('==x==')
    expect(docs[0].html).not.toContain('<mark>')
  })

  it('still converts wiki-syntax outside the inline span on the same line', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('n.md', '`[[Fake]]` and ==real==, both on one line'),
    ])
    const html = docs[0].html
    expect(html).toContain('[[Fake]]')
    expect(html).toContain('<mark>real</mark>')
  })
})

describe('obsidian adapter — unresolvable embed fallback', () => {
  it('renders an unresolvable embed target as plain text, not an <img> or media entry', async () => {
    const { docs } = await obsidianAdapter.parse([vf('n.md', 'before ![[missing.png]] after')])
    const d = docs[0]
    expect(d.media).toHaveLength(0)
    expect(d.html).not.toContain('<img')
    expect(d.html).toContain('missing.png')
  })
})

describe('obsidian adapter — link anchors (#Heading / #^block) resolve to the target note', () => {
  it('strips a #Heading or #^block fragment before lookup and still resolves the note', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('Vault/a.md', 'see [[Note#Heading]] and [[Note#^abc123]]'),
      vf('Vault/Note.md', 'x'),
    ])
    const a = docs.find((d) => d.importKey === 'obsidian:Vault/a.md')
    // Both anchored links resolve to the same target note...
    expect(a.links).toHaveLength(2)
    expect(a.links.every((l) => l.targetKey === 'obsidian:Vault/Note.md')).toBe(true)
    expect(a.html).toContain('data-import-link="obsidian:Vault/Note.md"')
    // ...and the written display text (including the anchor) is preserved,
    // not silently dropped, since only the RESOLUTION step ignores it.
    expect(a.html).toContain('Note#Heading')
    expect(a.html).toContain('Note#^abc123')
  })
})
