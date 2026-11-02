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

  it('turns image embeds into media refs and callouts into callout asides', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('V/n.md', '![[chart.png]]\n\n> [!warning] Risk\n> tight stop'),
      vf('V/files/chart.png', '')])
    const d = docs[0]
    expect(d.media[0].ref).toBe('V/files/chart.png')
    expect(d.html).toContain('import-ref://V/files/chart.png')
    // D2 item 1: the callout node's own HTML, never a blockquote.
    expect(d.html).toMatch(/<aside data-variant="warning"><p><strong>Risk<\/strong><\/p>.*tight stop.*<\/aside>/s)
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
    // ...and the anchor stays in the display text as Obsidian shows it, never
    // silently dropped: a heading as `Note > Heading`, a block as the note's
    // name (D2 item 8; it used to read `Note#Heading` / `Note#^abc123`).
    const { bodyJson } = htmlToNote(a.html)
    expect(extractPlainText(bodyJson)).toBe('see Note > Heading and Note')
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
    // D2 fix round 1, I3: a wikilink to a file is its chip, never a note link.
    expect(linkOf(src.html)).toEqual([])
    expect([...src.html.matchAll(/data-type="attachmentChip" data-import-ref="([^"]+)"/g)].map((m) => m[1]))
      .toEqual(['V/Files/report.pdf', 'V/Files/report.pdf'])
  })

  it('never strips an unknown dot suffix to open another note or file', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('V/src.md', '[[Dr.Smith]] [[People/Dr.Smith]] [[report.pdf]] [[chart]]'),
      vf('V/People/Dr.md', 'x'), vf('V/report.png', ''), vf('V/Files/chart.png', '')])
    const src = docs.find((d) => d.importKey === 'obsidian:V/src.md')
    // Plan C Task 4 fix round 1: no stem match, dot or not (`[[chart]]` names `chart.md`).
    expect(linkOf(src.html).map(([k]) => k)).toEqual([])
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
    // A note target is a link; a FILE target is a chip (D2 fix round 1, I3): read both.
    const m = d.html.match(/(?:data-import-link="obsidian:|data-type="attachmentChip" data-import-ref=")V\/([^"]+)"/)
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
    // Plan C Task 4 fix round 1: a dot-less name has no stem match either.
    expect(await resolveIn('chart', ['img/chart.png'])).toBeNull()
    expect(await resolveIn('img/chart', ['img/chart.png'])).toBeNull()
    expect(await resolveIn('v1.2/chart', ['v1.2/chart.png'])).toBeNull()
    expect(await resolveIn('chart', ['img/chart.png', 'Notes/chart.md'])).toBe('Notes/chart.md')
    expect(await resolveIn('img/chart', ['img/chart.png', 'img/chart.md'])).toBe('img/chart.md')
  })

  it('opens a file whose full name holds a # before splitting an anchor (Plan C Task 4)', async () => {
    const name = 'attachments/my chart #1 (v2).png'
    expect(await resolveIn('my chart #1 (v2).png', [name])).toBe(name)
    expect(await resolveIn('attachments/my chart #1 (v2).png', [name])).toBe(name)
    expect(await resolveIn('MY CHART #1 (V2).PNG', [name])).toBe(name)
    expect(await resolveIn('Other note#Risk', ['Other note.md'])).toBe('Other note.md')
    expect(await resolveIn('Other note#^abc123', ['Other note.md'])).toBe('Other note.md')
    expect(await resolveIn('my chart #1 (v2).png', ['my chart.md'])).toBe('my chart.md')
    const { docs } = await obsidianAdapter.parse([
      vf(`V/${name}`, ''), vf('V/src.md', '![[my chart #1 (v2).png]]')])
    const d = docs.find((x) => x.importKey === 'obsidian:V/src.md')
    expect(d.media.map((m) => m.ref)).toEqual([`V/${name}`])
    expect(d.html).toContain('<img')
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
  const noPlaceholder = (s) => expect(/[\uE000-\uF8FF\uFDD0-\uFDEF]/.test(s)).toBe(false)

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

// ---------------------------------------------------------------------------
// D1 fix round 4 (re-review P1): the member's own text can never collide with
// the importer's held-markup placeholders. Every row keeps the member's
// characters byte-exact, with only `[[...]]` replaced, and adds no link. Parity
// fixture 17-member-placeholder-characters pins the server lane on the same
// characters.
// ---------------------------------------------------------------------------

describe('obsidian adapter — D1 fix round 4: member text vs held-markup placeholders', () => {
  const O = '\uE000'
  const C = '\uE001'
  const D = (n) => String.fromCharCode(0xe010 + n)
  const F = '\uFDD0'
  const textOf = async (body) => {
    const { docs, warnings } = await obsidianAdapter.parse([
      vf('V/src.md', body), vf('V/Plan.md', 'p'), vf('V/Other.md', 'o'), vf('V/img.png', 'i')])
    const d = docs.find((x) => x.importKey === 'obsidian:V/src.md')
    expect(d, `not imported: ${warnings.join('; ')}`).toBeTruthy()
    const { bodyJson } = htmlToNote(d.html)
    const links = [...d.html.matchAll(/data-import-link="obsidian:V\/([^"]+)"/g)].length
    return { text: extractPlainText(bodyJson).replace(/\s+/g, ' ').trim(), links, html: d.html, doc: bodyJson,
      media: d.media.map((m) => m.ref) }
  }
  const RUN = F.repeat(40000)
  const eleven = '[[Plan]] '.repeat(10) + '[[Other]] '
  const ROWS = [
    // [name, body, expected stored text, expected link count]
    ['valid index, before a link', `x ${O}${D(0)}${C} y [[Plan]]`, `x ${O}${D(0)}${C} y Plan`, 1],
    ['valid index, after a link', `[[Plan]] then ${O}${D(0)}${C}`, `Plan then ${O}${D(0)}${C}`, 1],
    ['index 1 with two links', `${O}${D(1)}${C} [[Plan]] [[Other]]`, `${O}${D(1)}${C} Plan Other`, 2],
    ['index "00"', `${O}${D(0)}${D(0)}${C} [[Plan]]`, `${O}${D(0)}${D(0)}${C} Plan`, 1],
    ['index past 10, 11 links', `${eleven}${O}${D(1)}${D(0)}${C}`,
      `${'Plan '.repeat(10)}Other ${O}${D(1)}${D(0)}${C}`, 11],
    ['inside a highlight', `a ==${O}${D(0)}${C} [[Plan]]== b`, `a ${O}${D(0)}${C} Plan b`, 1],
    ['inside a callout title', `> [!note] ${O}${D(0)}${C} [[Plan]]\n> body`, `${O}${D(0)}${C} Plan body`, 1],
    ['next to an unresolved dotted name', `${O}${D(0)}${C} and [[Ghost.Name]]`, `${O}${D(0)}${C} and Ghost.Name`, 0],
    ['Nerd Font / Powerline / Font Awesome glyphs',
      '\uE0A0 branch \uF015 home \uE5FA [[Plan]] ' + O + C, '\uE0A0 branch \uF015 home \uE5FA Plan ' + O + C, 1],
    ['glyphs in a highlight', '==\uF015 [[Plan]] \uE0A0==', '\uF015 Plan \uE0A0', 1],
    ['glyphs in a callout title', '> [!tip] \uF015 [[Plan]] \uE0A0\n> b', '\uF015 Plan \uE0A0 b', 1],
    ['Pomicons run', `${O}${C}\uE002\uE003\uE00A [[Plan]]`, `${O}${C}\uE002\uE003\uE00A Plan`, 1],
    ['lone E000 / E001 around a link', `${O}[[Plan]]${C}`, `${O}Plan${C}`, 1],
    ['adjacent E000 E010 before a link', `${O}${D(0)}[[Plan]]`, `${O}${D(0)}Plan`, 1],
    ['inside a code span', `\`${O}${D(0)}${C}\` [[Plan]]`, `${O}${D(0)}${C} Plan`, 1],
    // The importer's own sentinel, U+FDD0, in the member's text.
    ['U+FDD0 run with an index', `${F}${D(0)}${C} [[Plan]]`, `${F}${D(0)}${C} Plan`, 1],
    ['double U+FDD0 run', `${F}${F}${D(0)}${C} [[Plan]] ${F}`, `${F}${F}${D(0)}${C} Plan ${F}`, 1],
    ['U+FDD0 touching a link', `x${F}[[Plan]]${F}${F}y`, `x${F}Plan${F}${F}y`, 1],
    ['mixed E000 and U+FDD0 runs', `${O}${D(0)}${C}${F}${D(1)}${C} [[Plan]] [[Other]]`,
      `${O}${D(0)}${C}${F}${D(1)}${C} Plan Other`, 2],
    // Fix round 5, M-a: a run past V8's regex size limit (32,767) still imports.
    ['40,000-long U+FDD0 run, no links', `a ${RUN} b`, `a ${RUN} b`, 0],
    ['40,000-long U+FDD0 run with links', `${RUN}${D(0)}${C} [[Plan]]${RUN}[[Other]] ${RUN}`,
      `${RUN}${D(0)}${C} Plan${RUN}Other ${RUN}`, 2],
    // Fix round 5, M-b: a held piece holding an earlier placeholder.
    ['note embed nested in a wikilink', '[[![[Plan]]]] after', 'Plan after', 1],
    ['note embed nested in an alias', '[[Other|![[Plan]]]] after', 'Plan after', 2],
  ]

  for (const [name, body, expected, links] of ROWS) {
    it(`keeps the member's characters byte-exact: ${name}`, async () => {
      const r = await textOf(body)
      expect(r.text).toBe(expected)
      expect(r.links).toBe(links)
    })
  }

  // No row, and no nested piece, may leave a placeholder character behind: the
  // output holds no more U+FDD0 / U+E000-U+E019 / U+E001 than the input did.
  const NESTED_IMAGE = '[[![[img.png]]]] after'
  const count = (s, re) => (s.match(re) || []).length
  for (const [name, body] of [...ROWS, ['image embed nested in a wikilink', NESTED_IMAGE]]) {
    it(`adds no placeholder character to the output: ${name}`, async () => {
      const r = await textOf(body)
      const doc = JSON.stringify(r.doc)
      for (const re of [/\uFDD0/g, /[\uE000-\uE019]/g]) {
        expect(count(r.html, re)).toBeLessThanOrEqual(count(body, re))
        expect(count(doc, re)).toBeLessThanOrEqual(count(body, re))
      }
    })
  }

  it('keeps the image of [[![[img.png]]]] and lists it in media (M-b)', async () => {
    const r = await textOf(NESTED_IMAGE)
    expect(r.html).toContain('<img src="import-ref://V/img.png">')
    expect(r.media).toContain('V/img.png')
    expect(r.text).toBe('after')
    expect(JSON.stringify(r.doc)).toContain('import-ref://V/img.png')
  })
})

// ---------------------------------------------------------------------------
// D2 item 4: a held piece the note never shows lists nothing. In
// `[[![[img.png]]|al.ias]]` the alias is what shows, so the image is not
// displayed, and a media entry for it would upload a file nothing references
// (ruling: do not list it). The same for a note embed's link. The server lane
// does the same (`test_an_embed_nested_in_a_wikilink_with_an_alias_...`).
// ---------------------------------------------------------------------------

describe('obsidian adapter — D2 item 4: an unshown embed lists no media and no link', () => {
  const parseOne = async (body) => {
    const { docs } = await obsidianAdapter.parse([
      vf('V/src.md', body), vf('V/Plan.md', 'p'), vf('V/Other.md', 'o'), vf('V/img.png', 'i'),
      vf('V/q.pdf', 'q')])
    const d = docs.find((x) => x.importKey === 'obsidian:V/src.md')
    const { bodyJson } = htmlToNote(d.html)
    return { d, text: extractPlainText(bodyJson).replace(/\s+/g, ' ').trim() }
  }

  it('shows the alias of [[![[img.png]]|al.ias]] and lists no media for the image', async () => {
    const { d, text } = await parseOne('[[![[img.png]]|al.ias]] after')
    expect(text).toBe('al.ias after')
    expect(d.html).not.toContain('<img')
    expect(d.media).toEqual([])
    expect(d.links).toEqual([])
  })

  it('lists no file for [[![[q.pdf]]|the file]] and no link for [[![[Plan]]|the plan]]', async () => {
    const pdf = await parseOne('[[![[q.pdf]]|the file]] after')
    expect(pdf.text).toBe('the file after')
    expect(pdf.d.media).toEqual([])
    const note = await parseOne('[[![[Plan]]|the plan]] after')
    expect(note.text).toBe('the plan after')
    expect(note.d.links).toEqual([])
  })

  it('still lists what IS shown: a nested embed with no alias, and an embed in an alias', async () => {
    const img = await parseOne('[[![[img.png]]]] and ![[img.png]] and [[![[q.pdf]]]]')
    expect(img.d.media.map((m) => m.ref)).toEqual(['V/img.png', 'V/q.pdf'])
    const both = await parseOne('[[Other|![[Plan]]]] after')
    expect(both.d.links.map((l) => l.targetKey)).toEqual(['obsidian:V/Plan.md', 'obsidian:V/Other.md'])
  })
})

// ---------------------------------------------------------------------------
// D2 item 8: a wikilink's display text is the server lane's
// (`providers/obsidian.py::_wikilink_display`), as Obsidian shows it: a heading
// link reads `Note > Heading`, a block link reads `Note`, a link to this note's
// own heading reads `Heading`. A missing FILE whose name holds `#` keeps its
// name. An unresolved note embed reads as the note's name, as the server's
// pending link does. Parity fixtures 11 and 21 pin both lanes.
// ---------------------------------------------------------------------------

describe('obsidian adapter — D2 item 8: heading-link display text', () => {
  const textOf = async (body) => {
    const { docs } = await obsidianAdapter.parse([vf('V/src.md', body), vf('V/Other note.md', 'o')])
    const d = docs.find((x) => x.importKey === 'obsidian:V/src.md')
    return extractPlainText(htmlToNote(d.html).bodyJson)
  }
  const ROWS = [
    ['[[Ghost#Risk]]', 'Ghost > Risk'],
    ['[[Ghost#^abc]]', 'Ghost'],
    ['[[#Risk]]', 'Risk'],
    ['[[#^abc]]', '#^abc'],
    ['[[Ghost# Risk ]]', 'Ghost > Risk'],
    ['[[Ghost#]]', 'Ghost'],
    ['[[Ghost#Risk#Sub]]', 'Ghost > Risk#Sub'],
    ['[[Other note#Risk]]', 'Other note > Risk'],
    ['[[Other note#^abc]]', 'Other note'],
    ['[[Other note#Risk|the risk]]', 'the risk'],
    ['[[report #2.pdf]]', 'report #2.pdf'],
    ['[[q3 #4.xlsx|the sheet]]', 'the sheet'],
    ['![[Ghost#Risk]]', 'Ghost'],
    ['![[Ghost.md]]', 'Ghost'],
    ['![[missing.png]]', 'missing.png'],
    ['![[my chart #1 (v2).png]]', 'my chart #1 (v2).png'],
  ]
  for (const [body, expected] of ROWS) {
    it(`${body} reads "${expected}"`, async () => {
      expect(await textOf(body)).toBe(expected)
    })
  }

  it('keeps the link of a resolved heading link under its new text', async () => {
    const { docs } = await obsidianAdapter.parse([vf('V/src.md', '[[Other note#Risk]]'), vf('V/Other note.md', 'o')])
    const d = docs.find((x) => x.importKey === 'obsidian:V/src.md')
    expect(d.html).toContain('<a data-import-link="obsidian:V/Other note.md">Other note &gt; Risk</a>')
  })
})

// ---------------------------------------------------------------------------
// D2 item 1: an Obsidian callout is the editor's callout node on the client too,
// the server lane's shape (`providers/obsidian.py::_callouts_in_doc`): `variant`
// from the callout type, the title (or the type, capitalised) as a bold first
// paragraph, then the body. The fold marker (`+`/`-`) is dropped, as the server
// drops it. Parity fixtures 12, 16 and 17 pin both lanes.
// ---------------------------------------------------------------------------

describe('obsidian adapter — D2 item 1: callouts are callout nodes', () => {
  const docOf = async (body) => {
    const { docs } = await obsidianAdapter.parse([vf('V/src.md', body), vf('V/Plan.md', 'p')])
    const d = docs.find((x) => x.importKey === 'obsidian:V/src.md')
    return htmlToNote(d.html).bodyJson
  }
  const runs = (para) => (para.content || []).map((r) => [r.text, (r.marks || []).map((m) => m.type).sort().join('+')])

  it('makes a titled callout a callout node with its variant, a bold title and the body', async () => {
    const doc = await docOf('> [!warning] Size\n> Keep it small.')
    expect(doc.content).toHaveLength(1)
    const callout = doc.content[0]
    expect(callout.type).toBe('callout')
    expect(callout.attrs.variant).toBe('warning')
    expect(callout.content.map((b) => b.type)).toEqual(['paragraph', 'paragraph'])
    expect(runs(callout.content[0])).toEqual([['Size', 'bold']])
    expect(runs(callout.content[1])).toEqual([['Keep it small.', '']])
  })

  it('titles an untitled callout with its type, never with the next line', async () => {
    const callout = (await docOf('> [!tip]\n> Wait for the pivot.')).content[0]
    expect(callout.type).toBe('callout')
    expect(callout.attrs.variant).toBe('success')
    expect(runs(callout.content[0])).toEqual([['Tip', 'bold']])
    expect(runs(callout.content[1])).toEqual([['Wait for the pivot.', '']])
  })

  it('maps types to the five variants, unknown ones to note, and drops the fold marker', async () => {
    for (const [type, variant] of [['note', 'note'], ['info', 'info'], ['caution', 'warning'],
      ['bug', 'danger'], ['important', 'warning'], ['FAILURE', 'danger'], ['quote', 'note']]) {
      const callout = (await docOf(`> [!${type}]- Folded\n> body`)).content[0]
      expect(callout.type, type).toBe('callout')
      expect(callout.attrs.variant, type).toBe(variant)
      expect(runs(callout.content[0]), type).toEqual([['Folded', 'bold']])
    }
    const open = (await docOf('> [!note]+ Open\n> body')).content[0]
    expect(runs(open.content[0])).toEqual([['Open', 'bold']])
  })

  it('keeps a link in the title a bold link, and a one-line callout is its title only', async () => {
    const callout = (await docOf('> [!note] See [[Plan]]')).content[0]
    expect(callout.type).toBe('callout')
    expect(callout.content).toHaveLength(1)
    expect(runs(callout.content[0])).toEqual([['See ', 'bold'], ['Plan', 'bold+link']])
  })

  it('leaves a plain blockquote, a marker that does not open its quote, and code alone', async () => {
    const plain = await docOf('> just a quote')
    expect(plain.content[0].type).toBe('blockquote')
    const late = await docOf('> first line\n> [!note] not a marker here')
    expect(late.content[0].type).toBe('blockquote')
    const fenced = await docOf('```\n> [!note] Title\n> body\n```')
    expect(fenced.content[0].type).toBe('codeBlock')
    expect(fenced.content[0].content[0].text.trimEnd()).toBe('> [!note] Title\n> body')
  })

  it('reads a CRLF note the same way and nests a callout inside a quote', async () => {
    const crlf = (await docOf('> [!warning] Size\r\n> Keep it small.')).content[0]
    expect(crlf.type).toBe('callout')
    expect(runs(crlf.content[0])).toEqual([['Size', 'bold']])
    const nested = (await docOf('> outer\n>\n> > [!danger] Inner\n> > body')).content[0]
    expect(nested.type).toBe('blockquote')
    const inner = nested.content[1]
    expect(inner.type).toBe('callout')
    expect(inner.attrs.variant).toBe('danger')
  })

  it('renders in the editor as the callout node, with its style', async () => {
    const { Editor } = await import('@tiptap/core')
    const { buildExtensions } = await import('../tiptap')
    const doc = await docOf('> [!warning] Size\n> Keep it small.')
    const editor = new Editor({ extensions: buildExtensions(), content: doc })
    try {
      const html = editor.getHTML()
      expect(html).toContain('data-type="callout"')
      expect(html).toContain('data-variant="warning"')
      expect(editor.state.doc.firstChild.type.name).toBe('callout')
    } finally {
      editor.destroy()
    }
  })
})

// D2 item 5 (shared parse, `convert.js::htmlToNote`): through this importer.
describe('obsidian adapter — D2 item 5: no empty paragraph, no lost space', () => {
  const shape = (n) => (n.type === 'text' ? JSON.stringify(n.text)
    : n.type + (n.content ? `(${n.content.map(shape).join(', ')})` : ''))
  it('a markdown image alone on its line, and text before a file chip', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('V/a.md', 'Top\n\n![](att/a.png)\n\nRead [the report](att/q.pdf) before the open.'),
      vf('V/att/a.png', 'i'), vf('V/att/q.pdf', 'q')])
    const d = docs.find((x) => x.importKey === 'obsidian:V/a.md')
    expect(shape(htmlToNote(d.html).bodyJson)).toBe(
      'doc(paragraph("Top"), image, paragraph("Read "), attachmentChip, paragraph(" before the open."))')
  })
})

// D2 item 6: a markdown link to a file keeps the member's text as the chip's label.
describe('obsidian adapter — D2 item 6: a file link keeps its text as the chip label', () => {
  it('[the report](att/q3%20report.pdf) is a chip named q3 report.pdf that shows "the report"', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('V/a.md', 'Read [the report](att/q3%20report.pdf) and [q3 report.pdf](att/q3%20report.pdf).'),
      vf('V/att/q3 report.pdf', 'q')])
    const d = docs.find((x) => x.importKey === 'obsidian:V/a.md')
    const chips = htmlToNote(d.html).bodyJson.content.filter((n) => n.type === 'attachmentChip')
    expect(chips.map((c) => [c.attrs.name, c.attrs.label])).toEqual([
      ['q3 report.pdf', 'the report'], ['q3 report.pdf', null]])
    expect(d.media.map((m) => m.ref)).toEqual(['V/att/q3 report.pdf'])
  })
})

// ---------------------------------------------------------------------------
// D2 fix round 1, I3: a wikilink (not an embed) that resolves to a FILE is the
// attachment chip, as the server lane makes it (the plugin sends it as a
// non-embed ref, `providers/obsidian.py::_ref_markdown`). It used to be a link
// to a note key no note has, which commit stripped: the file never uploaded and
// nothing said so. The alias is the chip's label, as rendered text.
// ---------------------------------------------------------------------------

describe('obsidian adapter — D2 fix round 1, I3: a wikilink to a file is a chip', () => {
  const parseOne = async (body) => {
    const { docs } = await obsidianAdapter.parse([
      vf('V/src.md', body), vf('V/Plan.md', 'p'), vf('V/att/q.pdf', 'q'), vf('V/att/chart.png', 'c')])
    const d = docs.find((x) => x.importKey === 'obsidian:V/src.md')
    const bodyJson = htmlToNote(d.html).bodyJson
    const chips = []
    const walk = (n) => { if (n.type === 'attachmentChip') chips.push(n.attrs); (n.content || []).forEach(walk) }
    walk(bodyJson)
    return { d, chips, text: extractPlainText(bodyJson) }
  }

  it('[[q.pdf]] and [[q.pdf|the **deck**]] are chips of one listed file, the alias its label', async () => {
    const { d, chips } = await parseOne('see [[q.pdf]] and [[q.pdf|the **deck**]] and [[q.pdf|q.pdf]] now')
    expect(d.html).not.toContain('data-import-link')
    expect(chips.map((c) => [c.name, c.label, c.href])).toEqual([
      ['q.pdf', null, 'import-ref://V/att/q.pdf'],
      ['q.pdf', 'the deck', 'import-ref://V/att/q.pdf'],
      ['q.pdf', null, 'import-ref://V/att/q.pdf']])
    expect(d.media.map((m) => [m.ref, m.kind])).toEqual([['V/att/q.pdf', 'file']])
    expect(d.links).toEqual([])
  })

  it('[[chart.png]] linked, not embedded, is a file chip too; [[Plan]] stays a note link', async () => {
    const { d, chips } = await parseOne('[[chart.png]] and [[Plan]]')
    expect(chips.map((c) => c.name)).toEqual(['chart.png'])
    expect(d.media.map((m) => [m.ref, m.kind])).toEqual([['V/att/chart.png', 'file']])
    expect(d.links.map((l) => l.targetKey)).toEqual(['obsidian:V/Plan.md'])
  })
})
