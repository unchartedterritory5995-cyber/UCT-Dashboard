/**
 * Plan B Task 12 (spec §10): the messy NOTION corpus -- an export zipped in memory, so
 * `expandArchives` really runs -- through the real client import path (`__tests__/corpora.harness.js`),
 * asserted on the stored body and the rendered DOM, raw.
 *
 * `Export/Hub <id>.md` links a page in the export (relative and by notion.so URL), a page
 * missing from the export with and without an id, a notion.so page that is not in it, an
 * in-zip image, a remote image and a bare URL beside a ticker.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  importCorpus, zipDrop, fixtureBytes, renderBody, destroyEditors, renderedLinks, renderedImgs,
  storedLinks, nodes, noteHref, assertCorpusInvariants, ATTACH,
} from './__tests__/corpora.harness'
import { pendingLinkFallbackHref } from '../linkClickOpen'

const HUB_ID = '0123456789abcdef0123456789abcdef'
let run
beforeAll(async () => {
  run = await importCorpus(zipDrop('notion', 'notion-export.zip'), { expectAdapter: 'notion' })
})
afterEach(destroyEditors)

const HUB = 'notion:Export/Hub.md'
const CHILD = 'notion:Export/Hub/Child Page.md'
const MISSING = 'import-link://notion:aaaabbbb-cccc-dddd-eeee-ffff00001111'
const body = (k) => run.storedByKey.get(k)
const linksOf = (startsWith) => {
  const p = [...renderBody(body(HUB)).querySelectorAll('p')].find((x) => x.textContent.startsWith(startsWith))
  expect(p, startsWith).toBeTruthy()
  return renderedLinks(p)
}

describe('Notion corpus', () => {
  it('both pages import under id-stripped keys; the missing page is the only unconnected link', () => {
    expect(run.docs.map((d) => d.importKey).sort()).toEqual([HUB, CHILD])
    expect(run.summary.created).toBe(2)
    expect(run.summary.failures).toEqual([])
    expect(run.summary.notices).toEqual([])
    expect(run.summary.unconnectedLinks).toEqual([{ note: 'Hub', text: 'Missing Page' }])
  })

  it('every written note holds the corpus-wide invariants (stored + rendered)', () => {
    expect(assertCorpusInvariants(run)).toBe(2)
  })

  it('in-zip links (relative, %20-encoded, and ../) are note links', () => {
    expect(linksOf('In the export')).toEqual([{ text: 'Child Page', href: noteHref(run.idOf(CHILD)), plain: false }])
    expect(storedLinks(body(CHILD))).toEqual([{ text: 'Hub', href: noteHref(run.idOf(HUB)) }])
  })

  it('missing page -> notion.so: the placeholder keeps the page id and opens it on notion.so', () => {
    expect(storedLinks(body(HUB))).toContainEqual({ text: 'Missing Page', href: MISSING })
    const [a] = linksOf('Missing with an id')
    expect(a).toEqual({ text: 'Missing Page', href: MISSING, plain: false })
    expect(pendingLinkFallbackHref(a.href)).toBe('https://www.notion.so/aaaabbbbccccddddeeeeffff00001111')
  })

  it('a missing page with no id is plain text, never a dead relative href', () => {
    const p = [...renderBody(body(HUB)).querySelectorAll('p')].find((x) => x.textContent.startsWith('Missing without'))
    expect(p.textContent).toBe('Missing without an id: Gone page')
    expect(p.querySelector('a')).toBeNull()
    expect(JSON.stringify(body(HUB))).not.toContain('Gone.md')
  })

  it('present notion.so URL -> internal link; an absent one stays the working URL', () => {
    expect(linksOf('Present by URL')).toEqual([{ text: 'child on notion.so', href: noteHref(run.idOf(CHILD)), plain: false }])
    expect(linksOf('Absent by URL')).toEqual([{ text: 'elsewhere',
      href: 'https://www.notion.so/Elsewhere-99998888777766665555444433332222', plain: false }])
  })

  it('remote image copied, in-zip image uploaded with its bytes', () => {
    const id = run.idOf(HUB)
    expect(run.server.fetches.map((f) => [f.url, f.status])).toEqual([['https://cdn.example.com/n.png', 429], ['https://cdn.example.com/n.png', 200]])
    const [shot] = run.server.uploads.filter((u) => u.status === 200)
    expect([shot.name, shot.type]).toEqual(['shot.png', 'image/png'])
    expect([...shot.bytes]).toEqual([...fixtureBytes(`notion/Export/Hub ${HUB_ID}/shot.png`)])
    const srcs = [`${ATTACH}${id}/inline/fetched-n.png`, `${ATTACH}${id}/inline/2-shot.png`]
    expect(nodes(body(HUB), 'image').map((i) => i.attrs.src)).toEqual(srcs)
    expect(renderedImgs(renderBody(body(HUB)))).toEqual(srcs)
  })

  it('bare URL linked, the ticker beside it is not', () => {
    expect(linksOf('Bare')).toEqual([{ text: 'https://example.com/notion', href: 'https://example.com/notion', plain: false }])
    expect([...renderBody(body(HUB)).querySelectorAll('p')].at(-1).textContent).toBe('Bare: https://example.com/notion and NVDA.US')
  })

  it('the heal door was asked about the note that kept a link, once past its 429', () => {
    expect(run.server.heals).toEqual([{ noteIds: [run.idOf(HUB)], status: 429 }, { noteIds: [run.idOf(HUB)], status: 200 }])
  })
})
