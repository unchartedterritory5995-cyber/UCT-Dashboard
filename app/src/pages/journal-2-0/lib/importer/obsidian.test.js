import { describe, it, expect } from 'vitest'
import { obsidianAdapter } from './adapters/obsidian'
import { htmlToNote } from './convert'
import { extractPlainText } from '../tiptap'

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
    // ...and the written display text (including the anchor) is preserved,
    // not silently dropped, since only the RESOLUTION step ignores it.
    expect(a.html).toContain('Note#Heading')
    expect(a.html).toContain('Note#^abc123')
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
// ---------------------------------------------------------------------------
// D1: a dot in a note's NAME is not an extension. `[[Dr.Smith]]` names
// `Dr.Smith.md` (Obsidian's rule, mirrored from providers/obsidian.py
// `_note_file_of`); only a known attachment extension makes it a file.
// ---------------------------------------------------------------------------

describe('obsidian adapter — wikilinks to notes with a dot in the name', () => {
  const linkOf = (html) => [...html.matchAll(/data-import-link="([^"]+)">([^<]*)</g)].map((m) => [m[1], m[2]])

  it('resolves [[Dr.Smith]] and [[v1.2 notes]] to their notes', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('V/src.md', '[[Dr.Smith]] and [[v1.2 notes]] and [[Dr.Smith.md]]'),
      vf('V/People/Dr.Smith.md', 'x'), vf('V/v1.2 notes.md', 'y')])
    const src = docs.find((d) => d.importKey === 'obsidian:V/src.md')
    expect(linkOf(src.html)).toEqual([
      ['obsidian:V/People/Dr.Smith.md', 'Dr.Smith'],
      ['obsidian:V/v1.2 notes.md', 'v1.2 notes'],
      ['obsidian:V/People/Dr.Smith.md', 'Dr.Smith.md'],
    ])
  })

  it('resolves [[Q3.Review|alias]] and keeps the alias text', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('V/src.md', '[[Q3.Review|the review]]'), vf('V/Reviews/Q3.Review.md', 'x')])
    const src = docs.find((d) => d.importKey === 'obsidian:V/src.md')
    expect(linkOf(src.html)).toEqual([['obsidian:V/Reviews/Q3.Review.md', 'the review']])
  })

  it('resolves [[Dr.Smith#Intro]] and [[Dr.Smith#^abc]] to the note', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('V/src.md', '[[Dr.Smith#Intro]] [[Dr.Smith#^abc]]'), vf('V/Dr.Smith.md', 'x')])
    const src = docs.find((d) => d.importKey === 'obsidian:V/src.md')
    expect(linkOf(src.html).map(([k]) => k)).toEqual(['obsidian:V/Dr.Smith.md', 'obsidian:V/Dr.Smith.md'])
  })

  it('prefers the note over a file sharing its dotted stem, bare and path-qualified', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('V/src.md', '[[Dr.Smith]] [[People/Dr.Smith]]'),
      vf('V/People/Dr.Smith.csv', 'a,b'), vf('V/People/Dr.Smith.md', 'x')])
    const src = docs.find((d) => d.importKey === 'obsidian:V/src.md')
    expect(linkOf(src.html).map(([k]) => k)).toEqual(['obsidian:V/People/Dr.Smith.md', 'obsidian:V/People/Dr.Smith.md'])
  })

  it('resolves the exact note first even when the target ends in an attachment extension', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('V/src.md', '[[report.pdf]] [[Files/report.pdf]] [[Brief.txt|the brief]]'),
      vf('V/Files/report.pdf', '%PDF'), vf('V/Files/report.pdf.md', 'x'), vf('V/Brief.txt.md', 'y')])
    const src = docs.find((d) => d.importKey === 'obsidian:V/src.md')
    expect(linkOf(src.html)).toEqual([
      ['obsidian:V/Files/report.pdf.md', 'report.pdf'],
      ['obsidian:V/Files/report.pdf.md', 'Files/report.pdf'],
      ['obsidian:V/Brief.txt.md', 'the brief'],
    ])
  })

  it('resolves [[report.pdf]] to the file when no report.pdf.md exists', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('V/src.md', '[[report.pdf]] [[Files/report.pdf]]'), vf('V/Files/report.pdf', '%PDF')])
    const src = docs.find((d) => d.importKey === 'obsidian:V/src.md')
    expect(linkOf(src.html).map(([k]) => k)).toEqual(['obsidian:V/Files/report.pdf', 'obsidian:V/Files/report.pdf'])
  })

  it('never strips an unknown dot suffix to open another note or file', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('V/src.md', '[[Dr.Smith]] [[People/Dr.Smith]] [[report.pdf]] [[chart]]'),
      vf('V/People/Dr.md', 'x'), vf('V/report.png', ''), vf('V/Files/chart.png', '')])
    const src = docs.find((d) => d.importKey === 'obsidian:V/src.md')
    // Only the dot-less `[[chart]]` keeps its stem match.
    expect(linkOf(src.html).map(([k]) => k)).toEqual(['obsidian:V/Files/chart.png'])
  })

  it('leaves [[Dr.Smith]] as text when no such note exists', async () => {
    const { docs } = await obsidianAdapter.parse([vf('V/src.md', 'see [[Dr.Smith]]')])
    expect(linkOf(docs[0].html)).toEqual([])
    expect(docs[0].html).toContain('see Dr.Smith')
  })
})
// ---------------------------------------------------------------------------
// D1 fix round 2: the same rule as providers/obsidian.py::_resolve_in, case for
// case (the server twins are in test_obsidian_provider.py, and the parity
// fixture 15-dotted-names pins both runtimes on one input).
// ---------------------------------------------------------------------------

describe('obsidian adapter — D1 fix round 2', () => {
  const resolveIn = async (target, files, src = 'src.md') => {
    const { docs } = await obsidianAdapter.parse([
      ...files.map((f) => vf(`V/${f}`, 'x')), vf(`V/${src}`, `[[${target}]]`)])
    const d = docs.find((x) => x.importKey === `obsidian:V/${src}`)
    const m = d.html.match(/data-import-link="obsidian:V\/([^"]+)"/)
    return m ? m[1] : null
  }

  it('never reaches a file by its stem from a dotted target (I1)', async () => {
    expect(await resolveIn('Dr.Smith', ['People/Dr.Smith.csv'])).toBeNull()
    expect(await resolveIn('Dr.Smith', ['People/Dr.Smith.csv', 'People/Dr.md'])).toBeNull()
    expect(await resolveIn('People/Dr.Smith', ['People/Dr.Smith.csv'])).toBeNull()
    expect(await resolveIn('Q3.Review', ['Q3.Review.xlsx', 'Reviews/Q3.md'])).toBeNull()
    expect(await resolveIn('report.pdf', ['report.pdf.png'])).toBeNull()
    expect(await resolveIn('archive.tar', ['archive.tar.gz'])).toBeNull()
    expect(await resolveIn('v1.2 notes', ['v1.2 notes.pdf'])).toBeNull()
    expect(await resolveIn('Plan.md', ['Notes/Plan.md.bak'])).toBeNull()
    expect(await resolveIn('chart', ['img/chart.png'])).toBe('img/chart.png')
    expect(await resolveIn('img/chart', ['img/chart.png'])).toBe('img/chart.png')
    expect(await resolveIn('v1.2/chart', ['v1.2/chart.png'])).toBe('v1.2/chart.png')
  })

  it('takes only the exact note, never a note file with a second extension (I2)', async () => {
    for (const order of [['Notes/Plan.md.bak', 'Notes/Plan.md'], ['Notes/Plan.md', 'Notes/Plan.md.bak']]) {
      expect(await resolveIn('Notes/Plan', order)).toBe('Notes/Plan.md')
      expect(await resolveIn('Plan', order)).toBe('Notes/Plan.md')
    }
    expect(await resolveIn('Notes/Plan', ['Notes/Plan.md.bak'])).toBeNull()
    expect(await resolveIn('Files/report.pdf', ['Files/report.pdf.md.zip', 'Files/report.pdf.md'])).toBe('Files/report.pdf.md')
  })

  it('breaks same-name ties the same way whatever the listing order (M1)', async () => {
    const paths = ['Z/Setup.md', 'B/Setup.md', 'A/Deep/Setup.md']
    expect(await resolveIn('Setup', paths)).toBe('B/Setup.md')
    expect(await resolveIn('Setup', [...paths].reverse())).toBe('B/Setup.md')
    expect(await resolveIn('Setup', paths, 'Z/src.md')).toBe('Z/Setup.md')
    expect(await resolveIn('Setup', paths, 'A/Deep/src.md')).toBe('A/Deep/Setup.md')
    expect(await resolveIn('Dr.Smith', ['A/B/Dr.Smith.md', 'Dr.Smith.md'])).toBe('Dr.Smith.md')
    expect(await resolveIn('report.pdf', ['Y/report.pdf', 'X/report.pdf'])).toBe('X/report.pdf')
  })

  it('makes a note embed a link to the note, never an attachment chip (M4)', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('V/src.md', '![[report.pdf]]\n\n![[Drawing.excalidraw]]'),
      vf('V/Files/report.pdf', '%PDF'), vf('V/Files/report.pdf.md', 'x'), vf('V/Drawing.excalidraw.md', 'y')])
    const src = docs.find((d) => d.importKey === 'obsidian:V/src.md')
    expect(src.media).toEqual([])
    expect(src.html).not.toContain('attachmentChip')
    expect([...src.html.matchAll(/data-import-link="([^"]+)">([^<]*)</g)].map((m) => [m[1], m[2]])).toEqual([
      ['obsidian:V/Files/report.pdf.md', 'report.pdf'],
      ['obsidian:V/Drawing.excalidraw.md', 'Drawing.excalidraw'],
    ])
  })

  it('leaves an unresolved dotted name as plain text, never a web link', async () => {
    const { docs } = await obsidianAdapter.parse([vf('V/src.md', 'see [[Ghost.Name]] and ![[Missing.Name]]')])
    expect(docs[0].html).not.toContain('href')
    expect(docs[0].html).toContain('Ghost.Name')
  })
})
// ---------------------------------------------------------------------------
// D1 fix round 3: markup the wikilink pass writes survives the callout and
// highlight passes after it (N1: no visible `&#46;`; N2: a link inside a
// highlight or callout title keeps both). Parity fixture
// 16-links-in-highlights-and-callouts pins the server lane on the same input.
// ---------------------------------------------------------------------------

describe('obsidian adapter — D1 fix round 3', () => {
  const stored = async (body, files = []) => {
    const { docs } = await obsidianAdapter.parse([
      ...files.map((f) => vf(`V/${f}`, 'x')), vf('V/src.md', body)])
    const d = docs.find((x) => x.importKey === 'obsidian:V/src.md')
    const { bodyJson } = htmlToNote(d.html)
    return { html: d.html, doc: bodyJson, text: extractPlainText(bodyJson) }
  }
  const marksOf = (node, out = []) => {
    if (node && node.type === 'text') out.push([node.text, (node.marks || []).map((m) => m.type).sort().join('+'),
      (node.marks || []).find((m) => m.type === 'link')?.attrs?.href || null])
    for (const c of node?.content || []) marksOf(c, out)
    return out
  }
  const noPlaceholder = (s) => expect(/[\uE000-\uF8FF]/.test(s)).toBe(false)

  it('keeps an unresolved dotted name plain "Ghost.Name" inside a highlight (N1)', async () => {
    const r = await stored('a ==[[Ghost.Name]]== b')
    expect(r.text).toBe('a Ghost.Name b')
    expect(r.html).not.toContain('&amp;#46;')
    expect(r.html).not.toContain('href')
    expect(marksOf(r.doc)).toEqual([['a ', '', null], ['Ghost.Name', 'highlight', null], [' b', '', null]])
    noPlaceholder(r.html)
    noPlaceholder(JSON.stringify(r.doc))
  })

  it('keeps an unresolved dotted name plain "Ghost.Name" in a callout title (N1)', async () => {
    const r = await stored('> [!note] [[Ghost.Name]]\n> body')
    expect(r.text).toBe('Ghost.Name body')
    expect(r.html).not.toContain('&amp;#46;')
    expect(r.html).not.toContain('href')
    noPlaceholder(r.html)
    noPlaceholder(JSON.stringify(r.doc))
  })

  it('keeps a link AND its highlight for ==[[Plan]]== (N2)', async () => {
    const r = await stored('a ==[[Plan]]== b', ['Plan.md'])
    expect(r.text).toBe('a Plan b')
    expect(marksOf(r.doc).find(([t]) => t === 'Plan')?.[1]).toBe('highlight+link')
    expect(r.html).toContain('data-import-link="obsidian:V/Plan.md"')
    noPlaceholder(r.html)
  })

  it('keeps a link inside a callout title, never escaped markup (N2)', async () => {
    const r = await stored('> [!note] See [[Plan]]\n> body', ['Plan.md'])
    expect(r.text).toBe('See Plan body')
    expect(r.html).not.toContain('&lt;a')
    expect(marksOf(r.doc).find(([t]) => t === 'Plan')?.[1]).toBe('bold+link')
    noPlaceholder(r.html)
  })
})
