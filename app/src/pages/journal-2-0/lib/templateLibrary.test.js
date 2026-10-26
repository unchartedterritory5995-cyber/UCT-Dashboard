// Wave 11 Task 11.15: the template library client. Every assertion reads what the server is SENT (method, path, body)
// or what the caller gets back ({ok, data} | {ok: false, code, message}); nothing reads module state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  GALLERY, LIBRARY_COPY, sharePreview, publishTool, publishTemplate, libraryList, previewMine, adoptTool, useTemplate,
  adoptTemplate, updateTool, helpfulPrompt, answerHelpfulPrompt,
  STYLES, listTemplates, getTemplate, renameTemplate, duplicateTemplate, archiveTemplate, unarchiveTemplate,
  deleteTemplate, restoreTemplate, templateUsedIn,
} from './templateLibrary'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })
let fetchMock
beforeEach(() => {
  setOnline(true)
  fetchMock = vi.fn(async () => json(200, {}))
  globalThis.fetch = fetchMock
})
afterEach(() => { setOnline(true) })

const sent = (i = 0) => {
  const [url, init = {}] = fetchMock.mock.calls[i]
  return { url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined }
}

// Every call, with valid arguments, as [name, () => promise, expected {url, method}].
const CALLS = [
  ['sharePreview', () => sharePreview('widget', 'w1', { edits: { name: 'A' }, keep: ['display/target'] }),
    { url: `${GALLERY}/share/preview`, method: 'POST' }],
  ['publishTool', () => publishTool('routine', 'r1', { title: 'T', edits: {} }), { url: `${GALLERY}/tools`, method: 'POST' }],
  ['publishTemplate', () => publishTemplate('s1', { title: 'T', category: 'journal', edits: {} }),
    { url: `${GALLERY}/styles`, method: 'POST' }],
  ['libraryList', () => libraryList('morning'), { url: `${GALLERY}/library?group=morning`, method: 'GET' }],
  ['previewMine', () => previewMine('g1', { p1: 'Breakout' }), { url: `${GALLERY}/g1/preview-mine`, method: 'POST' }],
  ['adoptTool', () => adoptTool('g1', { notify: true }), { url: `${GALLERY}/g1/adopt-tool`, method: 'POST' }],
  ['useTemplate', () => useTemplate('g1', { title: 'x' }), { url: `${GALLERY}/g1/use-template`, method: 'POST' }],
  ['adoptTemplate', () => adoptTemplate('g1', {}), { url: `${GALLERY}/g1/adopt`, method: 'POST' }],
  ['updateTool', () => updateTool('tracker', 'c1', {}), { url: `${GALLERY}/tools/updates/tracker/c1`, method: 'POST' }],
  ['helpfulPrompt', () => helpfulPrompt('n1'), { url: `${GALLERY}/notes/n1/helpful-prompt`, method: 'GET' }],
  ['answerHelpfulPrompt', () => answerHelpfulPrompt('g1', 'yes'), { url: `${GALLERY}/g1/helpful-prompt`, method: 'POST' }],
  // Task 11.19: My tools' Templates tab, the journal-styles router's wave 11 routes.
  ['listTemplates', () => listTemplates('archived'), { url: `${STYLES}?view=archived`, method: 'GET' }],
  ['getTemplate', () => getTemplate('s1'), { url: `${STYLES}/s1`, method: 'GET' }],
  ['renameTemplate', () => renameTemplate('s1', ' Morning prep '), { url: `${STYLES}/s1`, method: 'PUT' }],
  ['duplicateTemplate', () => duplicateTemplate('s1'), { url: `${STYLES}/s1/duplicate`, method: 'POST' }],
  ['archiveTemplate', () => archiveTemplate('s1'), { url: `${STYLES}/s1/archive`, method: 'POST' }],
  ['unarchiveTemplate', () => unarchiveTemplate('s1'), { url: `${STYLES}/s1/unarchive`, method: 'POST' }],
  ['deleteTemplate', () => deleteTemplate('s1', 'Morning prep'), { url: `${STYLES}/s1/delete`, method: 'POST' }],
  ['restoreTemplate', () => restoreTemplate('s1'), { url: `${STYLES}/s1/restore`, method: 'POST' }],
  ['templateUsedIn', () => templateUsedIn('s1'), { url: `${STYLES}/s1/used-in`, method: 'GET' }],
]

describe('templateLibrary: the routes and the bodies', () => {
  it('GALLERY is the gallery router', () => {
    expect(GALLERY).toBe('/api/j2/template-gallery')
  })

  it.each(CALLS)('%s calls its route', async (_name, run, want) => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: 1 }))
    expect(await run()).toEqual({ ok: true, data: { ok: 1 } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sent()).toMatchObject(want)
  })

  it('the share preview sends exactly {kind, id, edits, keep}', async () => {
    await sharePreview('widget', 'w1', { edits: { name: 'Mine', formulas: { f1: 'R' } }, keep: ['filters/0/values/0'] })
    expect(sent().body).toEqual({ kind: 'widget', id: 'w1', edits: { name: 'Mine', formulas: { f1: 'R' } }, keep: ['filters/0/values/0'] })
  })

  it('a first preview with no edits sends no edits key and an empty keep', async () => {
    await sharePreview('tracker', 't1')
    expect(sent().body).toEqual({ kind: 'tracker', id: 't1', keep: [] })
  })

  it('publishing names the item by the call, never by the caller body', async () => {
    await publishTool('widget', 'w1', { kind: 'routine', id: 'other', title: 'T', edits: {}, keep: ['a', 3, ''] })
    expect(sent().body).toEqual({ kind: 'widget', id: 'w1', title: 'T', edits: {}, keep: ['a'] })
    await publishTemplate('s1', { styleId: 'other', title: 'T', category: 'journal' })
    expect(sent(1).body).toEqual({ styleId: 's1', title: 'T', category: 'journal', keep: [] })
  })
})

describe('templateLibrary: refusals', () => {
  it('a 404 is unavailable, "Not available right now."', async () => {
    fetchMock.mockResolvedValueOnce(json(404, { detail: 'Not Found' }))
    expect(await sharePreview('widget', 'w1')).toEqual({ ok: false, code: 'unavailable', message: 'Not available right now.' })
  })

  it('the server code and sentence come through as they were sent', async () => {
    const message = 'Field 1 uses your own words. Change that part before sharing.'
    fetchMock.mockResolvedValueOnce(json(400, { detail: { code: 'own_words', message } }))
    expect(await sharePreview('widget', 'w1')).toEqual({ ok: false, code: 'own_words', message })
    fetchMock.mockResolvedValueOnce(json(400, { detail: { code: 'adopted', message: 'This widget came from the library, so it can’t be shared again.' } }))
    expect((await publishTool('widget', 'w1', {})).code).toBe('adopted')
  })

  it('402 is paid, 429 is rate, an unreadable refusal is network', async () => {
    fetchMock.mockResolvedValueOnce(json(402, {}))
    expect((await libraryList()).code).toBe('paid')
    fetchMock.mockResolvedValueOnce(json(429, {}))
    expect(await libraryList()).toEqual({ ok: false, code: 'rate', message: LIBRARY_COPY.rate })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new Error('html') } })
    expect(await libraryList()).toEqual({ ok: false, code: 'network', message: LIBRARY_COPY.network })
  })

  it('offline makes no request at all', async () => {
    setOnline(false)
    for (const [, run] of CALLS) {
      expect(await run()).toEqual({ ok: false, code: 'offline', message: LIBRARY_COPY.offline })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('bad arguments make no request', async () => {
    expect((await sharePreview('style', 'x')).ok).toBe(false)
    expect((await sharePreview('widget', '')).ok).toBe(false)
    expect((await publishTool('template', 's1')).ok).toBe(false)
    expect((await answerHelpfulPrompt('g1', 'maybe')).ok).toBe(false)
    expect((await updateTool('widget', null)).ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('templateLibrary: the Templates tab calls (Task 11.19)', () => {
  it('rename sends the name only, trimmed; delete sends the typed name exactly', async () => {
    await renameTemplate('s1', '  Morning prep ')
    expect(sent().body).toEqual({ name: 'Morning prep' })
    fetchMock.mockClear()
    await deleteTemplate('s1', ' Morning prep')
    expect(sent().body).toEqual({ typedName: ' Morning prep' })        // never trimmed: the server compares exactly
  })

  it("the journal-styles router's plain-sentence refusal is shown as the server worded it", async () => {
    const message = 'SERVER: Archive this template before deleting it.'
    fetchMock.mockResolvedValueOnce(json(400, { detail: message }))
    expect(await deleteTemplate('s1', 'x')).toEqual({ ok: false, code: 'invalid', message })
    fetchMock.mockResolvedValueOnce(json(404, { detail: 'Not found' }))
    expect(await restoreTemplate('s1')).toEqual({ ok: false, code: 'unavailable', message: LIBRARY_COPY.unavailable })
    fetchMock.mockResolvedValueOnce(json(409, { detail: 'SERVER: that kind is still in use.' }))
    expect((await archiveTemplate('s1')).message).toBe('SERVER: that kind is still in use.')
    // Only the router's 400/409 sentences: a 401 or 422 string is never shown to a member (m-1).
    for (const status of [401, 422, 500]) {
      fetchMock.mockResolvedValueOnce(json(status, { detail: 'Not authenticated' }))
      expect(await archiveTemplate('s1'), String(status)).toEqual({ ok: false, code: 'network', message: LIBRARY_COPY.network })
    }
    fetchMock.mockResolvedValueOnce(json(400, { detail: '   ' }))      // a blank sentence is no sentence
    expect(await archiveTemplate('s1')).toEqual({ ok: false, code: 'network', message: LIBRARY_COPY.network })
  })

  it('a view outside the three, a missing id or a blank name makes no request', async () => {
    expect((await listTemplates('picker')).ok).toBe(false)
    expect((await listTemplates()).ok).toBe(false)
    expect((await archiveTemplate('')).ok).toBe(false)
    expect((await renameTemplate('s1', '   ')).ok).toBe(false)
    expect((await deleteTemplate('s1')).ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('templateLibrary_never_throws', () => {
  const HOSTILE = [
    () => { throw new TypeError('Failed to fetch') },
    async () => { throw new Error('reset') },
    async () => undefined,
    async () => ({}),
    async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json') } }),
    async () => json(200, null),
    async () => json(200, [1, 2]),
    async () => json(200, 'text'),
    async () => ({ ok: false, status: 400, json: async () => null }),
    async () => json(400, { detail: { code: 7, message: { a: 1 } } }),
  ]

  it.each(HOSTILE.map((h, i) => [i, h]))('hostile answer %i: every call resolves to a refusal', async (_i, hostile) => {
    for (const [name, run] of CALLS) {
      globalThis.fetch = vi.fn(hostile)
      const out = await run().catch((e) => ({ threw: e }))
      expect(out, name).not.toHaveProperty('threw')
      expect(out.ok, name).toBe(false)
      expect(typeof out.code, name).toBe('string')
      expect(typeof out.message, name).toBe('string')
    }
  })

  it('hostile ARGUMENTS never throw either (a null or junk options object)', async () => {
    for (const opts of [null, 7, 'x', []]) {
      const out = await Promise.resolve().then(() => sharePreview('widget', 'w1', opts)).catch((e) => ({ threw: e }))
      expect(out).not.toHaveProperty('threw')
      expect(out.ok).toBe(true)
    }
    expect(sent().body).toEqual({ kind: 'widget', id: 'w1', keep: [] })
  })

  it('a body that cannot be serialised is a refusal, not a throw', async () => {
    const loop = {}
    loop.self = loop
    const out = await adoptTool('g1', loop)
    expect(out).toEqual({ ok: false, code: 'network', message: LIBRARY_COPY.network })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// F-FE-1 F2 (ruling W11-R34): Use and Adopt are KEYED. One `Idempotency-Key` (a uuid4 from lib/idempotencyKeys, the
// Notebook's one generator) per deliberate press: a press whose earlier request has no settled answer (a lost answer,
// offline, a 409 "already on its way", a 5xx) sends the SAME key, so the server replays what it made; a settled answer
// (made, or refused for good) ends the press, and the next one takes a fresh key. A preview or an update is never keyed.
describe('templateLibrary: the Idempotency-Key on Use and Adopt (W11-R34)', () => {
  const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  const keyOf = (i) => fetchMock.mock.calls[i]?.[1]?.headers?.['Idempotency-Key']
  const DOORS = [
    ['useTemplate', (g, b) => useTemplate(g, b), 'use-template'],
    ['adoptTemplate', (g, b) => adoptTemplate(g, b), 'adopt'],
    ['adoptTool', (g, b) => adoptTool(g, b), 'adopt-tool'],
  ]

  it.each(DOORS)('%s sends a uuid4 key with its JSON body', async (_n, run, path) => {
    await run('gk-1', { answers: { p1: 'Breakout' } })
    expect(sent().url).toBe(`${GALLERY}/gk-1/${path}`)
    expect(keyOf(0)).toMatch(UUID4)
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBe('application/json')
    expect(sent().body).toEqual({ answers: { p1: 'Breakout' } })
  })

  it.each(DOORS)('%s: a settled answer ends the press, so the next press is a NEW key', async (_n, run) => {
    fetchMock.mockResolvedValueOnce(json(200, { note: { id: 'n1' } }))
    await run('gk-2', { answers: {} })
    fetchMock.mockResolvedValueOnce(json(400, { detail: { code: 'unresolved', message: 'Pick one.' } }))
    await run('gk-2', { answers: {} })
    await run('gk-2', { answers: {} })
    expect(keyOf(1)).not.toBe(keyOf(0))
    expect(keyOf(2)).not.toBe(keyOf(1))                 // a refusal for good settled it too
  })

  it.each(DOORS)('%s: a retry after an unsettled answer reuses the key (lost, 5xx, 409 in flight)', async (_n, run) => {
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch') })
    await run('gk-3', { answers: { p1: 'A' } })
    fetchMock.mockResolvedValueOnce(json(502, null))
    await run('gk-3', { answers: { p1: 'A' } })
    fetchMock.mockResolvedValueOnce(json(409, { detail: { code: 'conflict', message: 'That is already on its way. Try again in a moment.' } }))
    await run('gk-3', { answers: { p1: 'A' } })
    await run('gk-3', { answers: { p1: 'A' } })          // 200: the server replays what the first one made
    expect(new Set([keyOf(0), keyOf(1), keyOf(2), keyOf(3)]).size).toBe(1)
    await run('gk-3', { answers: { p1: 'A' } })          // that one settled: a deliberate press again
    expect(keyOf(4)).not.toBe(keyOf(3))
  })

  it('W11-R44: while no clear answer has come, the press keeps its key even when the body changes', async () => {
    // A reopened sheet re-asks the preview, and its answers or reuse choices can differ ("Use your Morning routine"
    // now that the lost Use made it). A new key there would let the server make a SECOND note: the key is held per
    // door and item, never per body. Another item or another door is its own press.
    fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch') })   // nothing ever settles
    await useTemplate('gk-4', { answers: { p1: 'A' }, choices: { routine_a: { create: true } } })
    await useTemplate('gk-4', { answers: { p1: 'B' }, choices: { routine_a: { use: 'r1' } } })
    await useTemplate('gk-5', { answers: { p1: 'B' } })
    await adoptTemplate('gk-5', { answers: { p1: 'B' } })
    await adoptTool('gk-5', { answers: { p1: 'B' } })
    expect(keyOf(1)).toBe(keyOf(0))
    expect(new Set([keyOf(0), keyOf(2), keyOf(3), keyOf(4)]).size).toBe(4)
    fetchMock.mockImplementation(async () => json(200, { note: { id: 'n1' } }))
    await useTemplate('gk-4', { answers: { p1: 'C' } })         // the held key once more: the server replays N1
    expect(keyOf(5)).toBe(keyOf(0))
    await useTemplate('gk-4', { answers: { p1: 'C' } })         // that answer was clear: a deliberate new press
    expect(keyOf(6)).not.toBe(keyOf(0))
  })

  it('offline sends nothing, and the press is still open when the member is back', async () => {
    setOnline(false)
    expect((await useTemplate('gk-6', {})).code).toBe('offline')
    expect(fetchMock).not.toHaveBeenCalled()
    setOnline(true)
    await useTemplate('gk-6', {})
    expect(keyOf(0)).toMatch(UUID4)
  })

  it('CONTROL: a preview and an update carry no key', async () => {
    await previewMine('gk-7', { p1: 'A' })
    await updateTool('routine', 'c1', {})
    await sharePreview('widget', 'w1')
    for (let i = 0; i < 3; i += 1) expect(keyOf(i)).toBeUndefined()
  })
})
