/**
 * Plan B Task 12 (spec §10): the corpora through the parts of an import that are not one clean
 * run -- a door that answers `storage_limit`, a RECOVER re-import over a notebook in which the
 * member edited one imported note, and a Stop pressed part-way. Same real client path and
 * scripted Plan A server (`__tests__/corpora.harness.js`); stored body and rendered DOM asserted raw.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  importCorpus, makeServer, folderDrop, zipDrop, renderBody, destroyEditors, renderedNotices, renderedLinks,
  storedLinks, nodes, noteHref, assertCorpusInvariants,
} from './__tests__/corpora.harness'
import { MEDIA_RETRY_MAX_ATTEMPTS } from '../importNoticeText'

afterEach(destroyEditors)

describe('storage_full: the door answers storage_limit', () => {
  it('the picture is a FINAL storage_full notice in place and the note stays pending for a re-import', async () => {
    const server = makeServer({ storageLimit: ['pic.png'] })
    const run = await importCorpus(folderDrop('generic'), { server })
    const alpha = run.storedByKey.get('file:notes/Alpha.md')
    const at = alpha.content.findIndex((n) => n.type === 'importNotice')
    expect(alpha.content[at - 1].content[0].text).toBe('Picture:')
    expect(alpha.content[at].attrs).toEqual({ reason: 'storage_full', name: 'pic.png', sourceUrl: null,
      ref: 'notes/sub/pic.png', attempts: MEDIA_RETRY_MAX_ATTEMPTS })
    expect(renderedNotices(renderBody(alpha))).toEqual([
      { text: 'Not copied: storage limit. Free up space and import again to bring pic.png over', href: null }])
    expect(run.server.putsRaw.find((p) => p.id === run.idOf('file:notes/Alpha.md')).importMediaPending).toBe(true)
    expect(run.summary.notices.filter((n) => n.note === 'Alpha').map((n) => [n.reason, n.name])).toEqual([['storage_full', 'pic.png']])
    // reported once: never also under "Needs attention"
    expect(run.summary.failures).toEqual([])
    expect(assertCorpusInvariants(run)).toBe(4)
  })
})

describe('the fetch door\'s only 404: the note\'s import key is unknown to it', () => {
  it('a note trashed between confirm and fetch: its linked picture is a fetch_failed notice with the URL kept', async () => {
    const ALPHA = 'file:notes/Alpha.md'
    const run = await importCorpus(folderDrop('generic'), { server: makeServer({ trashed: [ALPHA] }) })
    expect(run.server.fetches.map((f) => [f.noteImportKey, f.status])).toEqual([[ALPHA, 429], [ALPHA, 404]])
    const alpha = run.storedByKey.get(ALPHA)
    expect(nodes(alpha, 'importNotice').map((n) => [n.attrs.reason, n.attrs.name, n.attrs.sourceUrl])).toEqual([
      ['fetch_failed', 'linked.png', 'https://cdn.example.com/linked.png']])
    expect(run.server.putsRaw.find((p) => p.id === run.idOf(ALPHA)).importMediaPending).toBe(true)
  })
})

describe('a plain re-import of an unchanged export (non-recover)', () => {
  it('unchanged notes whose media finished come back `skipped` and are not touched; a pending one is redone', async () => {
    const first = await importCorpus(folderDrop('generic'))
    const run = await importCorpus(folderDrop('generic'), { server: makeServer({ inherit: first.server }) })
    const SKIPPED = ['file:notes/Alpha.md', 'file:notes/Beta.md', 'file:notes/sub/Gamma.md']
    const PAGE = 'file:page.html' // its two lost pictures left it import_media_pending

    expect(run.server.confirms.map((c) => c.mode)).toEqual([undefined])
    expect(run.summary.skipped).toBe(3)
    expect(run.summary.updated).toBe(1)
    expect(run.summary.created).toBe(0)
    for (const k of SKIPPED) expect(run.summary.outcomes[k]).toBe('skipped')
    expect(run.summary.outcomes[PAGE]).toBe('updated')
    const skippedIds = SKIPPED.map((k) => first.idOf(k))
    expect(run.server.putsRaw.map((p) => p.id)).toEqual([first.idOf(PAGE)])
    expect(run.server.uploads.filter((u) => skippedIds.includes(u.noteId))).toEqual([])
    expect(run.server.fetches).toEqual([])
    // the member's notes hold exactly what the first import left
    for (const k of SKIPPED) expect(run.storedByKey.get(k)).toBe(first.storedByKey.get(k))
    // same ids, nothing duplicated; the sweep still ran (an all-skipped confirm counts)
    for (const k of [...SKIPPED, PAGE]) expect(run.idOf(k)).toBe(first.idOf(k))
    expect(run.server.heals.map((h) => h.status)).toEqual([429, 200])
    expect(assertCorpusInvariants(run)).toBe(4)
  })
})

describe('recover mode with a note the member edited', () => {
  it('rebuilds every other note, keeps the edited one untouched, and links still reach it', async () => {
    const first = await importCorpus(folderDrop('generic'))
    const BETA = 'file:notes/Beta.md'
    const memberBody = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My own words, written after the import.' }] }] }
    const existing = {}
    for (const [key, id] of first.server.byKey) {
      existing[key] = { id, body: key === BETA ? memberBody : first.storedByKey.get(key), title: key, edited: key === BETA }
    }
    const server = makeServer({ existing })
    const run = await importCorpus(folderDrop('generic'), { server, mode: 'recover' })

    expect(run.server.confirms.map((c) => c.mode)).toEqual(['recover'])
    expect(run.summary.recovered).toBe(3)
    expect(run.summary.created).toBe(0)
    expect(run.summary.keptEdited).toEqual([{ name: 'Beta', importKey: BETA }])
    const betaId = first.idOf(BETA)
    // never PUT, never uploaded to, never healed: the member's words are exactly as they were
    expect(run.server.putsRaw.map((p) => p.id)).not.toContain(betaId)
    expect(run.server.uploads.filter((u) => u.noteId === betaId)).toEqual([])
    expect(run.server.heals.flatMap((h) => h.noteIds)).not.toContain(betaId)
    expect(run.storedByKey.get(BETA)).toBe(memberBody)
    expect(renderBody(run.storedByKey.get(BETA)).textContent).toBe('My own words, written after the import.')
    // the recovered note that links to the kept one still resolves it (same id as the first import)
    const alpha = run.storedByKey.get('file:notes/Alpha.md')
    expect(storedLinks(alpha)).toContainEqual({ text: 'Beta note', href: noteHref(betaId) })
    expect(renderedLinks(renderBody(alpha)).find((l) => l.text === 'Beta note').href).toBe(noteHref(betaId))
    // ids are the first import's: rebuilt in place, never duplicated
    expect(run.idOf('file:notes/Alpha.md')).toBe(first.idOf('file:notes/Alpha.md'))
  })
})

describe('Stop pressed part-way', () => {
  it('stops between door calls: the note in flight is never PUT half-done, is named, and no heal runs', async () => {
    let server
    const stopAfter = 3
    server = makeServer()
    const doorCalls = () => server.state.calls.filter((c) => /\/(images|attachments|media\/fetch)$/.test(c.url)).length
    const run = await importCorpus(folderDrop('evernote'), { server, isCancelled: () => doorCalls() >= stopAfter })

    expect(run.summary.stopped).toBe(true)
    // the 429, its retry, and one more: then nothing else went to a door
    expect(doorCalls()).toBe(stopAfter)
    expect(run.server.putsRaw).toEqual([])
    expect(run.server.heals).toEqual([])
    // every note with media or links is named as unfinished, never counted as imported
    expect(run.summary.unfinished.map((u) => u.name).sort()).toEqual(['Hash mismatch ambiguous', 'Hash mismatch paired',
      'Links to notes', 'Media mess', 'Web clip: semis rally'])
    expect(run.summary.created).toBe(4)
    expect(run.summary.unconnectedLinks).toEqual([])
    // what the server holds for the stopped clip is the confirmed body: placeholders, never a
    // half-rewritten mix (a re-import finishes it)
    const clip = run.storedByKey.get(run.docs.find((d) => d.title === 'Web clip: semis rally').importKey)
    expect(nodes(clip, 'image').every((i) => i.attrs.src.startsWith('import-ref://'))).toBe(true)
    expect(nodes(clip, 'importNotice')).toEqual([])
  })

  it('a Stop as the first note finishes: that note is whole, every later one is named and untouched', async () => {
    let stop = false
    const run = await importCorpus(zipDrop('obsidian'), {
      isCancelled: () => stop,
      // the first commit-phase progress is the first note's "done" (a link-only note has no items)
      onProgress: (p) => { if (p.phase === 'commit') stop = true },
    })
    const HOME2 = 'obsidian:Second Vault/Home note.md'
    expect(run.summary.stopped).toBe(true)
    expect(run.server.putsRaw.map((p) => p.id)).toEqual([run.idOf(HOME2)])
    expect(storedLinks(run.storedByKey.get(HOME2))).toEqual([{ text: 'Plan', href: noteHref(run.idOf('obsidian:Second Vault/Plan.md')) }])
    expect(run.server.uploads).toEqual([])
    expect(run.server.fetches).toEqual([])
    expect(run.server.heals).toEqual([])
    expect(run.summary.unfinished.map((u) => u.importKey).sort()).toEqual([
      'obsidian:Vault/Home note.md', 'obsidian:Vault/Notes/Deep/Deeper.md', 'obsidian:Vault/Notes/Other note.md'])
    // the finished note and the two link-free Plans count; the three unfinished do not
    expect(run.summary.created).toBe(3)
  })
})
