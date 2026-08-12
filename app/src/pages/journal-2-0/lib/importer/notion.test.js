import { describe, it, expect } from 'vitest'
import { notionAdapter } from './adapters/notion'

const vf = (path, text) => ({ path, size: text.length, lastModified: null,
                              bytes: async () => new TextEncoder().encode(text) })
const HEX = 'abc123def456789012345678abcdef01'
const HEX2 = 'def456789012345678abcdef01abc123'

describe('notion adapter', () => {
  it('strips hex ids from titles, folders, and importKeys', async () => {
    const { docs } = await notionAdapter.parse([
      vf(`My Page ${HEX}.md`, '# My Page\nbody'),
      vf(`My Page ${HEX}/Sub ${HEX2}.md`, 'child'),
    ])
    const sub = docs.find((d) => d.title === 'Sub')
    expect(sub.folderPath).toEqual(['My Page'])
    expect(sub.importKey).toBe('notion:My Page/Sub.md')
  })

  it('keeps callout/toggle HTML islands for the converter', async () => {
    const { docs } = await notionAdapter.parse([
      vf(`P ${HEX}.md`, '<aside>💡 tip</aside>\n\n<details><summary>t</summary>hidden</details>')])
    expect(docs[0].html).toContain('tip')
    expect(docs[0].html).toContain('hidden')
  })

  it('rewrites internal relative links to link placeholders', async () => {
    const { docs } = await notionAdapter.parse([
      vf(`A ${HEX}.md`, `[go](Sub%20${HEX2}.md)`),
      vf(`Sub ${HEX2}.md`, 'target'),
    ])
    const a = docs.find((d) => d.title === 'A')
    expect(a.html).toContain(`data-import-link="notion:Sub.md"`)
    expect(a.links[0].targetKey).toBe('notion:Sub.md')
  })

  it('turns a small CSV database into a table note and warns on big ones', async () => {
    const small = 'Name,Status\nAlpha,Done\nBeta,Open'
    const bigRows = ['Name'].concat(Array.from({ length: 60 }, (_, i) => `r${i}`)).join('\n')
    const { docs, warnings } = await notionAdapter.parse([
      vf(`Tasks ${HEX}.csv`, small), vf(`Big ${HEX2}.csv`, bigRows)])
    const table = docs.find((d) => d.title === 'Tasks')
    expect(table.html).toMatch(/<table>.*<th>Name<\/th>.*Alpha/s)
    expect(warnings.join(' ')).toMatch(/Big/)
  })
})

// ---------------------------------------------------------------------------
// Supplementary coverage beyond the brief's Step-1 test text — exercises
// behaviors the "Interfaces" prose describes (image/attachment resolution,
// the .html-over-.md twin preference + link redirect, dangling internal
// links, CSV quoted commas, id-stripping stability across re-exports) and
// the carry-forward from Task 9's review (0.7 detect tier tightened to
// same-directory adjacency).
// ---------------------------------------------------------------------------

describe('notion adapter — images/attachments (resolved like generic)', () => {
  it('resolves a relative image ref to a media placeholder', async () => {
    const png = { path: `Vault ${HEX}/img.png`, size: 1, lastModified: null, bytes: async () => new Uint8Array([1]) }
    const { docs } = await notionAdapter.parse([
      vf(`Vault ${HEX}.md`, `![alt](Vault%20${HEX}/img.png)`), png,
    ])
    const doc = docs[0]
    expect(doc.html).toContain(`import-ref://Vault ${HEX}/img.png`)
    expect(doc.media[0]).toMatchObject({ ref: `Vault ${HEX}/img.png`, kind: 'image', name: 'img.png' })
  })

  it('turns a relative link to a local non-image file into an attachment chip', async () => {
    const pdf = { path: `Report ${HEX}/notes.pdf`, size: 1, lastModified: null, bytes: async () => new Uint8Array([1]) }
    const { docs } = await notionAdapter.parse([
      vf(`Report ${HEX}.md`, `[notes](Report%20${HEX}/notes.pdf)`), pdf,
    ])
    const doc = docs[0]
    expect(doc.html).toContain('data-type="attachmentChip"')
    expect(doc.html).toContain(`href="import-ref://Report ${HEX}/notes.pdf"`)
    expect(doc.media[0]).toMatchObject({ ref: `Report ${HEX}/notes.pdf`, kind: 'file', name: 'notes.pdf' })
  })
})

describe('notion adapter — internal links, edge cases', () => {
  it('leaves an internal link inert when its target file is missing from the import', async () => {
    const { docs } = await notionAdapter.parse([
      vf(`A ${HEX}.md`, `[ghost](Missing%20${HEX2}.md)`),
    ])
    expect(docs[0].html).not.toContain('data-import-link')
    expect(docs[0].links).toHaveLength(0)
  })

  it('prefers the .html export over a .md twin for the same page id, and redirects a link at the .md twin to the .html winner', async () => {
    const { docs } = await notionAdapter.parse([
      vf(`Journal ${HEX}.md`, '# From Markdown'),
      vf(`Journal ${HEX}.html`, '<html><body><h1>From HTML</h1></body></html>'),
      vf(`Link ${HEX2}.md`, `[j](Journal%20${HEX}.md)`),
    ])
    expect(docs).toHaveLength(2)
    const journal = docs.find((d) => d.importKey === 'notion:Journal.html')
    expect(journal.title).toBe('From HTML')
    const link = docs.find((d) => d.title === 'Link')
    expect(link.html).toContain('data-import-link="notion:Journal.html"')
    expect(link.links[0].targetKey).toBe('notion:Journal.html')
  })
})

describe('notion adapter — id stripping stability', () => {
  it('produces the same importKey across two exports of the same page with different hex ids', async () => {
    const HEX_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const HEX_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const { docs: docsA } = await notionAdapter.parse([vf(`Trade Log ${HEX_A}.md`, '# Trade Log')])
    const { docs: docsB } = await notionAdapter.parse([vf(`Trade Log ${HEX_B}.md`, '# Trade Log')])
    expect(docsA[0].importKey).toBe(docsB[0].importKey)
    expect(docsA[0].importKey).toBe('notion:Trade Log.md')
  })
})

describe('notion adapter — CSV hand-parser', () => {
  it('respects quoted commas inside a field', async () => {
    const csv = 'Name,Note\n"Doe, John",ok\nBeta,fine'
    const { docs } = await notionAdapter.parse([vf(`People ${HEX}.csv`, csv)])
    expect(docs[0].html).toContain('<td>Doe, John</td>')
  })
})

describe('notion adapter — duplicate stripped-name collision', () => {
  it('regenerates distinct importKeys (keeping the hex id) for pages that strip to the same key, and warns naming the titles', async () => {
    const HEX_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const HEX_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const { docs, warnings } = await notionAdapter.parse([
      vf(`Untitled ${HEX_A}.md`, 'no heading here'),
      vf(`Untitled ${HEX_B}.md`, 'no heading either'),
      vf(`Unique Page ${HEX}.md`, '# Real Title'),
    ])
    expect(docs).toHaveLength(3)

    const untitled = docs.filter((d) => d.title === 'Untitled')
    expect(untitled).toHaveLength(2)
    const untitledKeys = untitled.map((d) => d.importKey)
    // distinct — no longer collapse to the same key
    expect(new Set(untitledKeys).size).toBe(2)
    expect(untitledKeys).toContain(`notion:Untitled ${HEX_A}.md`)
    expect(untitledKeys).toContain(`notion:Untitled ${HEX_B}.md`)

    // the third, non-colliding doc keeps its clean, stable key
    const unique = docs.find((d) => d.title === 'Real Title')
    expect(unique.importKey).toBe('notion:Unique Page.md')

    expect(warnings.join(' ')).toMatch(/Untitled/)
  })

  it('does not touch importKeys when there is no collision', async () => {
    const { docs, warnings } = await notionAdapter.parse([
      vf(`Alpha ${HEX}.md`, '# Alpha'),
      vf(`Beta ${HEX2}.md`, '# Beta'),
    ])
    expect(docs.map((d) => d.importKey).sort()).toEqual(['notion:Alpha.md', 'notion:Beta.md'])
    expect(warnings).toEqual([])
  })
})

describe('notion adapter — detect (0.7 tier: index.html beside a hex-suffixed dir)', () => {
  it('scores 0.7 when index.html and a hex-suffixed dir are DIRECT siblings', () => {
    const score = notionAdapter.detect([
      vf('export/index.html', ''),
      vf(`export/My Page ${HEX}/sub.html`, ''),
    ])
    expect(score).toBe(0.7)
  })

  it('does NOT score 0.7 when the hex-suffixed dir lives elsewhere in the tree, not beside index.html', () => {
    const score = notionAdapter.detect([
      vf('export/index.html', ''),
      vf(`export/other/My Page ${HEX}/sub.html`, ''),
    ])
    expect(score).toBe(0)
  })
})
