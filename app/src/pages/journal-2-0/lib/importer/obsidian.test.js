import { describe, it, expect } from 'vitest'
import { obsidianAdapter } from './adapters/obsidian'
import { parseImport } from './postParse'

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

describe('obsidian adapter — `==` comparisons are never a highlight', () => {
  it('keeps "rsi == 30 and macd == 0" and "close==open" exactly, and still marks a real ==highlight==', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('n.md', 'If rsi == 30 and macd == 0 then buy. close==open stays. The ==key level== holds, (==risk==) too.'),
    ])
    const html = docs[0].html
    expect(html).toContain('If rsi == 30 and macd == 0 then buy.')
    expect(html).toContain('close==open stays.')
    expect(html).not.toContain('<mark> 30 and macd </mark>')
    expect(html).toContain('<mark>key level</mark>')
    expect(html).toContain('(<mark>risk</mark>)')
  })
})

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
    // ...and the display reads as Obsidian shows it (Plan B Task 8, server
    // `_wikilink_display`): a heading as `Note > Heading`, a block id not at all.
    expect(a.html).toContain('>Note &gt; Heading</a>')
    expect(a.html).toContain('>Note</a>')
    expect(a.html).not.toContain('abc123')
  })
})

// Plan B Task 8 (I-9, O-5, O-8, O-11, `obsidian://`): links and media resolve the way
// Obsidian (and the server's Obsidian connector) resolves them. Through `parseImport`, the
// wizard's own call, so the post-parse pass sees what the adapter wrote.
describe('obsidian adapter — Obsidian resolution (Plan B Task 8)', () => {
  const docOf = async (files, path) => {
    const { docs } = await parseImport(obsidianAdapter, files, {})
    return docs.find((d) => d.importKey === `obsidian:${path}`)
  }

  it('resolves a relative markdown link to the note', async () => {
    const d = await docOf([
      vf('V/.obsidian/app.json', '{}'),
      vf('V/Notes/Src.md', '[a](../Notes/Other.md) [b](Other%20note.md) [c](<Other note.md#H>) [d](Archive/Deep.md) [e](Ghost.md)'),
      vf('V/Notes/Other.md', ''), vf('V/Notes/Other note.md', ''), vf('V/Archive/Deep.md', ''),
    ], 'V/Notes/Src.md')
    expect(d.html).toContain('<a data-import-link="obsidian:V/Notes/Other.md">a</a>')
    expect(d.html).toContain('<a data-import-link="obsidian:V/Notes/Other note.md">b</a>')
    expect(d.html).toContain('<a data-import-link="obsidian:V/Notes/Other note.md">c</a>')
    expect(d.html).toContain('<a data-import-link="obsidian:V/Archive/Deep.md">d</a>')
    // A miss is never a link: the post-parse pass makes it its text.
    expect(d.html).not.toContain('Ghost.md')
    expect(d.html).toContain('e')
    expect(d.links.map((l) => l.targetKey)).toEqual(expect.arrayContaining([
      'obsidian:V/Notes/Other.md', 'obsidian:V/Notes/Other note.md', 'obsidian:V/Archive/Deep.md']))
  })

  it('makes a relative link to a non-note vault file an attachment chip', async () => {
    const d = await docOf([
      vf('V/n.md', '[the deck](files/deck.pdf)'), vf('V/files/deck.pdf', 'x'),
      vf('V/sub/m.md', '[deck](files/deck.pdf)'),
    ], 'V/sub/m.md')
    expect(d.html).toContain('data-type="attachmentChip"')
    expect(d.html).toContain('href="import-ref://V/files/deck.pdf"')
    expect(d.media.map((m) => m.ref)).toContain('V/files/deck.pdf')
  })

  it('resolves a wikilink with an escaped pipe in a table', async () => {
    const d = await docOf([
      vf('a.md', '| col |\n| --- |\n| [[Other note\\|alias]] |\n'), vf('Other note.md', ''),
    ], 'a.md')
    expect(d.html).toMatch(/<td><a data-import-link="obsidian:Other note.md">alias<\/a><\/td>/)
    expect(d.links).toEqual([{ targetKey: 'obsidian:Other note.md' }])
  })

  it('never shows the table escape in the text of an unresolved embed', async () => {
    const d = await docOf([vf('a.md', '| col |\n| --- |\n| ![[missing.png\\|100]] |\n')], 'a.md')
    expect(d.html).toMatch(/<td>missing\.png<\/td>/)
    expect(d.media).toEqual([])
  })

  it('makes ![[Other note]] a note link, not a file chip', async () => {
    const d = await docOf([vf('a.md', '![[Other note]] ![[Other note.md#Risk]]'), vf('Other note.md', '')], 'a.md')
    expect(d.html).not.toContain('attachmentChip')
    expect(d.html).toContain('<a data-import-link="obsidian:Other note.md">Other note</a>')
    expect(d.html).not.toContain('Risk')
    expect(d.media).toEqual([])
    expect(d.links[0]).toEqual({ targetKey: 'obsidian:Other note.md' })
  })

  it('resolves a vault-root image path from a subfolder note', async () => {
    const d = await docOf([
      vf('V/.obsidian/app.json', '{}'),
      vf('V/Sub/n.md', '![x](attachments/x.png) ![y](y%20pic.png)'),
      vf('V/attachments/x.png', 'x'), vf('V/elsewhere/y pic.png', 'y'),
    ], 'V/Sub/n.md')
    expect(d.html).toContain('src="import-ref://V/attachments/x.png"')
    expect(d.html).toContain('src="import-ref://V/elsewhere/y pic.png"')
    expect(d.media.map((m) => m.ref).sort()).toEqual(['V/attachments/x.png', 'V/elsewhere/y pic.png'])
  })

  it('resolves an obsidian://open link to the note', async () => {
    const d = await docOf([
      vf('Trading/a.md', '[the plan](obsidian://open?vault=Trading&file=Plans%2FPlan) and [gone](obsidian://open?vault=Trading&file=Ghost)'),
      vf('Trading/Plans/Plan.md', ''),
    ], 'Trading/a.md')
    expect(d.html).toContain('<a data-import-link="obsidian:Trading/Plans/Plan.md">the plan</a>')
    expect(d.html).not.toContain('obsidian://')
    expect(d.html).toContain('gone')
  })

  // Plan B final review, fix 2: with no `.obsidian/` folder, `vault=` must name the drop's
  // top folder (exact, case-sensitive); otherwise a by-name lookup across the whole drop
  // opened another vault's note.
  it('no vault root: a vault= matching the drop top folder links', async () => {
    const d = await docOf([
      vf('Personal/a.md', '[p](obsidian://open?vault=Personal&file=Plan)'),
      vf('Personal/Plan.md', ''),
    ], 'Personal/a.md')
    expect(d.html).toContain('<a data-import-link="obsidian:Personal/Plan.md">p</a>')
  })

  it('no vault root: a vault= naming another vault is text, never a by-name hit', async () => {
    const d = await docOf([
      vf('Work/a.md', '[p](obsidian://open?vault=Personal&file=Plan) [q](obsidian://open?vault=work&file=Plan)'),
      vf('Work/Plan.md', ''),
    ], 'Work/a.md')
    expect(d.html).not.toContain('data-import-link')
    expect(d.html).not.toContain('obsidian://')
    expect(d.html).toContain('p')
    expect(d.html).toContain('q')
    expect(d.links).toEqual([])
  })

  it('no vault root and files under several top folders: a vault= link is text', async () => {
    const d = await docOf([
      vf('a.md', '[p](obsidian://open?vault=Personal&file=Plan)'),
      vf('Personal/Plan.md', ''),
    ], 'a.md')
    expect(d.html).not.toContain('data-import-link')
    expect(d.links).toEqual([])
  })

  it('no vault root: a link with no vault= resolves by name as before', async () => {
    const d = await docOf([
      vf('a.md', '[p](obsidian://open?file=Plan)'),
      vf('Other/Plan.md', ''),
    ], 'a.md')
    expect(d.html).toContain('<a data-import-link="obsidian:Other/Plan.md">p</a>')
  })

  it('leaves an obsidian:// link into ANOTHER named vault as text', async () => {
    const d = await docOf([
      vf('Trading/.obsidian/app.json', '{}'),
      vf('Trading/a.md', '[mine](obsidian://open?vault=trading&file=Plan) [theirs](obsidian://open?vault=Other&file=Plan)'),
      vf('Trading/Plan.md', ''),
    ], 'Trading/a.md')
    expect(d.html).toContain('<a data-import-link="obsidian:Trading/Plan.md">mine</a>')
    expect(d.html).not.toMatch(/<a[^>]*>theirs/)
  })

  it('makes a wikilink to a non-note file a chip, never a dead note link', async () => {
    const d = await docOf([
      vf('a.md', 'See [[deck.pdf]] and [[chart.png|the chart]].'),
      vf('files/deck.pdf', 'x'), vf('chart.png', 'x'),
    ], 'a.md')
    expect(d.html).not.toContain('data-import-link')
    expect(d.links).toEqual([])
    expect(d.html).toContain('href="import-ref://files/deck.pdf"')
    expect(d.html).toMatch(/href="import-ref:\/\/chart\.png"[^>]*>the chart<\/a>/)
    expect(d.media.map((m) => [m.ref, m.kind]).sort()).toEqual([['chart.png', 'file'], ['files/deck.pdf', 'file']])
  })

  it('links each vault\'s notes inside that vault in a two-vault drop, and still links loose notes', async () => {
    const files = [
      vf('Obsidian/Work/.obsidian/app.json', '{}'), vf('Obsidian/Personal/.obsidian/app.json', '{}'),
      // Each vault's own copy sits DEEPER than the other vault's, so a whole-drop lookup
      // (shortest path wins) would cross vaults: only a per-vault index gets both right.
      vf('Obsidian/Work/a.md', '[[Plan]] ![[c.png]]'), vf('Obsidian/Work/Plan.md', ''), vf('Obsidian/Work/img/c.png', 'w'),
      vf('Obsidian/Personal/b.md', '[[Plan]] ![[c.png]]'), vf('Obsidian/Personal/Deep/Plan.md', ''), vf('Obsidian/Personal/c.png', 'p'),
      vf('Obsidian/Loose/loose.md', 'see [[Plan]] and [[Ideas]]'), vf('Obsidian/Ideas.md', ''),
    ]
    const a = await docOf(files, 'Obsidian/Work/a.md')
    const b = await docOf(files, 'Obsidian/Personal/b.md')
    const loose = await docOf(files, 'Obsidian/Loose/loose.md')
    expect(a.html).toContain('data-import-link="obsidian:Obsidian/Work/Plan.md"')
    expect(a.html).toContain('src="import-ref://Obsidian/Work/img/c.png"')
    expect(b.html).toContain('data-import-link="obsidian:Obsidian/Personal/Deep/Plan.md"')
    expect(b.html).toContain('src="import-ref://Obsidian/Personal/c.png"')
    // A note in no vault resolves against the whole drop: into a vault, and beside itself.
    expect(loose.html).toContain('data-import-link="obsidian:Obsidian/Work/Plan.md"')
    expect(loose.html).toContain('data-import-link="obsidian:Obsidian/Ideas.md"')
  })

  it('prefers the note in the linking note\'s own folder over the first one seen', async () => {
    const d = await docOf([
      vf('A/Deep/Plan.md', ''), vf('B/Plan.md', ''), vf('Notes/Sub/Plan.md', ''),
      vf('Notes/Sub/Src.md', 'Follow [[Plan]].'),
    ], 'Notes/Sub/Src.md')
    expect(d.html).toContain('data-import-link="obsidian:Notes/Sub/Plan.md"')
  })
})

describe('obsidian adapter — mixed-platform drop (audit B4)', () => {
  it('names a non-vault file it silently discarded, with a count', async () => {
    const evernoteFile = {
      path: 'Trading Notebook.enex', size: 4, lastModified: null,
      bytes: async () => new TextEncoder().encode('body'),
    }
    const { docs, warnings } = await obsidianAdapter.parse([
      vf('Vault/n.md', '# N\nbody'),
      evernoteFile,
    ])
    expect(docs).toHaveLength(1)
    const joined = warnings.join(' ')
    expect(joined).toContain('1 file')
    expect(joined).toContain('Trading Notebook.enex')
  })

  it('does not warn about its own .obsidian/ config files', async () => {
    const { warnings } = await obsidianAdapter.parse([
      vf('Vault/n.md', '# N\nbody'),
      vf('Vault/.obsidian/workspace.json', '{}'),
    ])
    expect(warnings).toEqual([])
  })
})
