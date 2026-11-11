/**
 * Plan B Task 12 (spec §10): the messy OBSIDIAN corpus -- TWO vaults in one drop, zipped in
 * memory so `expandArchives` really runs -- through the real client import path
 * (`__tests__/corpora.harness.js`), asserted on the stored body and the rendered DOM, raw.
 *
 * `Vault/` has `.obsidian/app.json` with `attachmentFolderPath: "Files"`, notes with spaces in
 * their names, a sub-folder note, an escaped pipe in a table, aliases, anchors and block refs,
 * a note embed, a wikilink to a PDF, a duplicate `x.png` (`Files/` and `Notes/`), a remote image,
 * a bare URL beside a URL in code and in math. `Second Vault/` has a `Home note.md` and a
 * `Plan.md` of the same names: each note resolves inside its OWN vault.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  importCorpus, zipDrop, fixtureBytes, renderBody, destroyEditors, renderedLinks, renderedImgs, renderedChips,
  storedLinks, nodes, noteHref, assertCorpusInvariants, ATTACH,
} from './__tests__/corpora.harness'

let run
beforeAll(async () => {
  run = await importCorpus(zipDrop('obsidian', 'two-vaults.zip'), { expectAdapter: 'obsidian' })
})
afterEach(destroyEditors)

const HOME = 'obsidian:Vault/Home note.md'
const OTHER = 'obsidian:Vault/Notes/Other note.md'
const DEEPER = 'obsidian:Vault/Notes/Deep/Deeper.md'
const PLAN = 'obsidian:Vault/Plan.md'
const HOME2 = 'obsidian:Second Vault/Home note.md'
const PLAN2 = 'obsidian:Second Vault/Plan.md'
const body = (k) => run.storedByKey.get(k)
const href = (k) => noteHref(run.idOf(k))
const uploadsFor = (k) => run.server.uploads.filter((u) => u.noteId === run.idOf(k) && u.status === 200)
const linksOf = (k, startsWith) => {
  const p = [...renderBody(body(k)).querySelectorAll('p, td')].find((x) => x.textContent.startsWith(startsWith))
  expect(p, startsWith).toBeTruthy()
  return renderedLinks(p).map(({ text, href: h }) => ({ text, href: h }))
}

describe('Obsidian corpus: the whole run', () => {
  it('both vaults import, every note under its own key, nothing failed or unconnected', () => {
    expect(run.docs.map((d) => d.importKey).sort()).toEqual([HOME2, PLAN2, HOME, DEEPER, OTHER, PLAN].sort())
    expect(run.summary.created).toBe(6)
    expect(run.summary.failures).toEqual([])
    expect(run.summary.notices).toEqual([])
    expect(run.summary.unconnectedLinks).toEqual([])
    expect(run.warnings).toEqual([])
  })

  it('every written note holds the corpus-wide invariants (stored + rendered)', () => {
    expect(assertCorpusInvariants(run)).toBe(6)
  })

  it('the upload and fetch doors each met ONE 429 and their retries landed', () => {
    const first = (suffix) => run.server.calls.filter((c) => c.url.endsWith(suffix)).slice(0, 2).map((c) => c.status)
    expect(first('/images')).toEqual([429, 200])
    expect(first('/attachments')).toEqual([429, 200])
    expect(first('/media/fetch')).toEqual([429, 200])
    expect(first('/heal-links')).toEqual([429, 200])
  })
})

describe('Obsidian corpus: links', () => {
  it('space-named wikilink and its alias are note links', () => {
    expect(linksOf(HOME, 'Wikilink')).toEqual([
      { text: 'Other note', href: href(OTHER) },
      { text: 'the other one', href: href(OTHER) },
    ])
  })

  it('an anchor reads as Obsidian shows it; a block id is not shown', () => {
    expect(linksOf(HOME, 'Anchored')).toEqual([
      { text: 'Other note > Levels', href: href(OTHER) },
      { text: 'Other note', href: href(OTHER) },
    ])
  })

  it('escaped pipe in a table cell is an alias, and the table keeps its two columns', () => {
    const root = renderBody(body(HOME))
    const row = [...root.querySelectorAll('tr')][1]
    expect([...row.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['table alias', 'escaped pipe'])
    expect(renderedLinks(row).map(({ text, href: h }) => ({ text, href: h }))).toEqual([{ text: 'table alias', href: href(OTHER) }])
  })

  it('a note embed is a link to that note, never a file chip', () => {
    const b = body(HOME)
    const at = b.content.findIndex((n) => n.type === 'paragraph' && n.content?.[0]?.text === 'Embedded note:')
    expect(b.content[at + 1]).toMatchObject({ type: 'paragraph', content: [{ text: 'Other note',
      marks: [{ type: 'link', attrs: { href: href(OTHER) } }] }] })
    expect(nodes(b, 'attachmentChip').map((c) => c.attrs.name)).toEqual(['deck.pdf'])
  })

  it('a relative ../ markdown link with %20 is a note link', () => {
    expect(storedLinks(body(DEEPER))).toEqual([{ text: 'the other note', href: href(OTHER) }])
    expect(linksOf(DEEPER, 'Up one')).toEqual([{ text: 'the other note', href: href(OTHER) }])
  })

  it('two vaults in one drop: each [[Plan]] opens its own vault\'s Plan', () => {
    expect(storedLinks(body(HOME))).toContainEqual({ text: 'Plan', href: href(PLAN) })
    expect(storedLinks(body(HOME2))).toEqual([{ text: 'Plan', href: href(PLAN2) }])
    expect(href(PLAN)).not.toBe(href(PLAN2))
  })

  it('a wikilink to a file is a chip of that file', () => {
    const [pdf] = uploadsFor(HOME).filter((u) => u.name === 'deck.pdf')
    expect([pdf.door, pdf.type]).toEqual(['attachments', 'application/pdf'])
    expect([...pdf.bytes]).toEqual([...fixtureBytes('obsidian/Vault/Files/deck.pdf')])
    const root = renderBody(body(HOME))
    expect(renderedChips(root)).toEqual([{ href: `${ATTACH}${run.idOf(HOME)}/files/4-deck.pdf`, name: 'deck.pdf' }])
  })

  it('a dead wikilink is its text, never a link', () => {
    const p = [...renderBody(body(HOME)).querySelectorAll('p')].find((x) => x.textContent.startsWith('Dead'))
    expect(p.textContent).toBe('Dead: Nowhere at all')
    expect(p.querySelector('a')).toBeNull()
  })

  it('a bare URL is a link; one in code or math is untouched', () => {
    expect(linksOf(HOME, 'Bare')).toEqual([{ text: 'https://example.com/obsidian', href: 'https://example.com/obsidian' }])
    const root = renderBody(body(HOME))
    expect(root.querySelector('code').textContent).toBe('https://example.com/in-code')
    const math = root.querySelector('[data-type="inline-math"]')
    expect(math.getAttribute('data-latex')).toBe('x = https://example.com/math')
    expect(math.querySelector('a')).toBeNull()
  })
})

describe('Obsidian corpus: attachments', () => {
  const FILES_X = () => [...fixtureBytes('obsidian/Vault/Files/x.png')]
  const NOTES_X = () => [...fixtureBytes('obsidian/Vault/Notes/x.png')]

  it('the attachment folder serves an embed from the vault root', () => {
    const [x] = uploadsFor(HOME).filter((u) => u.name === 'x.png')
    expect(x.type).toBe('image/png')
    expect([...x.bytes]).toEqual(FILES_X())
  })

  it('duplicate basename: the linking note\'s own folder wins, a root-relative path takes Files/', () => {
    const ups = uploadsFor(OTHER).filter((u) => u.name === 'x.png')
    expect(ups.map((u) => [...u.bytes])).toEqual([NOTES_X(), FILES_X()])
    const id = run.idOf(OTHER)
    expect(renderedImgs(renderBody(body(OTHER)))).toEqual([`${ATTACH}${id}/inline/6-x.png`, `${ATTACH}${id}/inline/7-x.png`])
  })

  it('a sub-folder note\'s ![](Files/x.png) resolves from the vault root (attachment folder)', () => {
    const [x] = uploadsFor(DEEPER)
    expect([...x.bytes]).toEqual(FILES_X())
    expect(renderedImgs(renderBody(body(DEEPER)))).toEqual([`${ATTACH}${run.idOf(DEEPER)}/inline/5-x.png`])
  })

  it('remote image is copied in through the fetch door, never hotlinked', () => {
    expect(run.server.fetches.map((f) => [f.url, f.noteImportKey, f.status])).toEqual([
      ['https://cdn.example.com/r.png', HOME, 429], ['https://cdn.example.com/r.png', HOME, 200]])
    const srcs = nodes(body(HOME), 'image').map((i) => i.attrs.src)
    expect(srcs).toEqual([`${ATTACH}${run.idOf(HOME)}/inline/2-x.png`, `${ATTACH}${run.idOf(HOME)}/inline/fetched-r.png`])
    expect(renderedImgs(renderBody(body(HOME)))).toEqual(srcs)
  })
})
