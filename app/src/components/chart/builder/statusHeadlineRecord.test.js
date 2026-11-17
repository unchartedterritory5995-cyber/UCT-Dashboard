// WHEN THE AUTHOR'S STATUS SENTENCE GOES ON RECORD (statusHeadlineRecord.js; Studio lane R4),
// and the call that records it.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { headlineToRecord, headlineKey } from './statusHeadlineRecord'
import { recordStatusHeadline } from '../../../hooks/useUserDefinitions'

afterEach(() => { vi.restoreAllMocks(); delete global.fetch })

const ID = 'u_0123456789ab'
const TEXT = 'indicator("x")\nplot(close)'
const ok = (over = {}) => ({ enabled: true, defId: ID, version: 3, savedText: TEXT,
  said: { headline: 'Runs fully', source: TEXT }, engine: 71, ...over })

describe('what is recorded', () => {
  it('the panel\'s sentence, for the saved version, under this browser\'s engine', () => {
    expect(headlineToRecord(ok())).toEqual({ defId: ID, version: 3, engine: 71, headline: 'Runs fully' })
    expect(headlineToRecord(ok({ said: { headline: '  Runs on charts, 2 values withheld (not guessed) ', source: TEXT } })).headline)
      .toBe('Runs on charts, 2 values withheld (not guessed)')
  })

  it('⛔ never a sentence about a different text than the one saved', () => {
    expect(headlineToRecord(ok({ said: { headline: 'Runs fully', source: `${TEXT}\n// edited since` } }))).toBeNull()
    expect(headlineToRecord(ok({ savedText: `${TEXT} ` }))).toBeNull()
    expect(headlineToRecord(ok({ savedText: '   ', said: { headline: 'Runs fully', source: '   ' } }))).toBeNull()
  })

  it('nothing while the panel is off, has no sentence, or the save did not store a version', () => {
    expect(headlineToRecord(ok({ enabled: false }))).toBeNull()
    expect(headlineToRecord(ok({ enabled: 'yes' }))).toBeNull()
    expect(headlineToRecord(ok({ said: null }))).toBeNull()
    expect(headlineToRecord(ok({ said: { headline: '   ', source: TEXT } }))).toBeNull()
    expect(headlineToRecord(ok({ defId: 'draft_1' }))).toBeNull()                 // not an id the store minted
    expect(headlineToRecord(ok({ defId: undefined }))).toBeNull()
    expect(headlineToRecord(ok({ version: undefined }))).toBeNull()
    expect(headlineToRecord(ok({ version: 0 }))).toBeNull()
    expect(headlineToRecord(ok({ engine: null }))).toBeNull()
    expect(headlineToRecord()).toBeNull()
  })

  it('one record per version and sentence: the key tells them apart', () => {
    const a = headlineKey(headlineToRecord(ok()))
    expect(a).toBe(headlineKey(headlineToRecord(ok())))
    expect(a).not.toBe(headlineKey(headlineToRecord(ok({ version: 4 }))))
    expect(a).not.toBe(headlineKey(headlineToRecord(ok({ said: { headline: 'Runs on charts', source: TEXT } }))))
  })
})

describe('the call', () => {
  it('posts the three fields to the definition\'s own route, and answers what the server said', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 }))
    const r = await recordStatusHeadline(ID, { version: 3, engine: 71, headline: ' Runs fully ' })
    expect(r).toEqual({ ok: true, status: 200 })
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe(`/api/user-definitions/${ID}/status-headline`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ version: 3, engine: 71, headline: 'Runs fully' })
  })

  it('a refusal is an answer and a dead network is not an exception; neither is retried here', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 409 }))
    expect(await recordStatusHeadline(ID, { version: 3, engine: 71, headline: 'Runs fully' })).toEqual({ ok: false, status: 409 })
    global.fetch = vi.fn(async () => { throw new Error('offline') })
    expect(await recordStatusHeadline(ID, { version: 3, engine: 71, headline: 'Runs fully' })).toEqual({ ok: false, status: null })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('sends nothing for a blank sentence or a missing version', async () => {
    global.fetch = vi.fn()
    expect((await recordStatusHeadline(ID, { version: 3, engine: 71, headline: '  ' })).ok).toBe(false)
    expect((await recordStatusHeadline(ID, { engine: 71, headline: 'x' })).ok).toBe(false)
    expect((await recordStatusHeadline('', { version: 1, engine: 71, headline: 'x' })).ok).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('the window posts it at the two moments it should (source rail; comments stripped)', () => {
  const code = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const sheet = code(fs.readFileSync(path.resolve(__dirname, './BuilderSheet.jsx'), 'utf8'))
  const box = code(fs.readFileSync(path.resolve(__dirname, './PineBox.jsx'), 'utf8'))

  it('after a script save, with the saved row\'s id and version and the text in the box', () => {
    expect(sheet).toMatch(/postStatusHeadline\(row\.def_id, row\.version, pineText, statusHeadline\)/)
  })

  it('after a form save that carried the script ("Use this formula", then Save), for exactly that script', () => {
    expect(sheet).toMatch(/if \(keepScript && res\.row\) postStatusHeadline\(res\.row\.def_id, res\.row\.version, applyScriptRef\.current, statusHeadline\)/)
    // it reads the script BEFORE the save clears it
    const at = sheet.indexOf('if (keepScript && res.row) postStatusHeadline(')
    expect(at).toBeGreaterThan(-1)
    expect(sheet.indexOf('applyScriptRef.current = null; applyMathsRef.current = null', at)).toBeGreaterThan(at)
  })

  it('and once on reopening a saved script whose text is unchanged', () => {
    expect(sheet).toMatch(/if \(editing\.script !== pineText\) return\s+postStatusHeadline\(editing\.defId, editing\.version, pineText, statusHeadline\)/)
  })

  it('the script box reports the sentence only for the text it was computed on', () => {
    expect(box).toMatch(/editorStatusNow && text === inspected && typeof editorStatusNow\.headline === 'string'/)
    expect(box).toMatch(/onStatusHeadline\(headlineNow \? \{ headline: headlineNow, source: inspected \} : null\)/)
    // CONTROL: the stripper leaves code and takes comments, so the matches above are about code
    expect(code('// postStatusHeadline(row.def_id, row.version, pineText, statusHeadline)\nconst a = 1')).not.toMatch(/postStatusHeadline/)
  })
})
