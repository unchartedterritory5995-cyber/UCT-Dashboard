/**
 * ⛔⛔ THE PAIR CANNOT DRIFT.
 *
 * Index and Market Context were written in one commit, minutes apart, and one of
 * them forgot to check `r.ok`. This rail exists so the next pair cannot: both go
 * through `fetchSnapshot`, and neither builds its own.
 *
 * ⭐ The member set is DERIVED from the snapshot widgets themselves, not typed
 * here — a third snapshot widget added tomorrow joins the rail the day it lands,
 * rather than depending on someone remembering to add a row.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fetchSnapshot, isFailed, FAILED } from './widgetSnapshotFetcher'

const DIR = __dirname
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

/** A "snapshot widget" is one that fetches a point-in-time read for a note embed. */
const SNAPSHOT_WIDGETS = ['IndexesWidget.jsx', 'MarketContextWidget.jsx']

describe('⛔ both snapshot widgets share ONE fetch-and-check', () => {
  it('⭐ NON-VACUITY: the files are really on disk and really readable', () => {
    for (const f of SNAPSHOT_WIDGETS) {
      const src = fs.readFileSync(path.join(DIR, f), 'utf8')
      expect(src.length, `${f} is empty`).toBeGreaterThan(500)
    }
  })

  it('⛔ each imports the shared helper', () => {
    const missing = SNAPSHOT_WIDGETS.filter((f) => !/from '\.\/widgetSnapshotFetcher'/
      .test(stripComments(fs.readFileSync(path.join(DIR, f), 'utf8'))))
    expect(missing, 'these do not use the shared fetcher').toEqual([])
  })

  it('⛔ and NONE of them hand-rolls a fetch — that is how one of a pair got it wrong', () => {
    const offenders = SNAPSHOT_WIDGETS.filter((f) => /\bfetch\s*\(/
      .test(stripComments(fs.readFileSync(path.join(DIR, f), 'utf8'))))
    expect(offenders, 'these call fetch() directly instead of the shared helper').toEqual([])
  })
})

describe('⛔ the helper checks, and fails honestly', () => {
  const res = (ok, body, throws) => ({
    ok,
    json: async () => { if (throws) throw new Error('not json'); return body },
  })

  it('⭐ a 2xx returns the body AND a stamp', async () => {
    const out = await fetchSnapshot('/x', { fetchImpl: async () => res(true, { a: 1 }), now: () => 123 })
    expect(out).toEqual({ a: 1, _fetchedAt: 123 })
  })

  it('⛔ a 500 never becomes data — the error body is not parsed through', async () => {
    const out = await fetchSnapshot('/x', { fetchImpl: async () => res(false, { detail: 'boom' }) })
    expect(out.detail).toBeUndefined()
    expect(isFailed(out)).toBe(true)
  })

  it('⛔ ...and carries NO `_fetchedAt` — that is the "as of" stamp a member reads', async () => {
    const out = await fetchSnapshot('/x', { fetchImpl: async () => res(false, null) })
    expect(out._fetchedAt).toBeUndefined()
  })

  it('⛔ ...but is TRUTHY, so an empty state reads instead of spinning forever', async () => {
    const out = await fetchSnapshot('/x', { fetchImpl: async () => res(false, null) })
    expect(Boolean(out)).toBe(true)
  })

  it('⛔⛔ a 200 whose body is NOT JSON fails too — the SPA catch-all\'s tell', async () => {
    const out = await fetchSnapshot('/x', { fetchImpl: async () => res(true, null, true) })
    expect(isFailed(out)).toBe(true)
  })

  it('⛔ a transport throw is not data either', async () => {
    const out = await fetchSnapshot('/x', { fetchImpl: async () => { throw new TypeError('Failed to fetch') } })
    expect(isFailed(out)).toBe(true)
  })

  it('⛔ a 200 carrying a non-object (a bare string) is refused', async () => {
    const out = await fetchSnapshot('/x', { fetchImpl: async () => res(true, 'nope') })
    expect(isFailed(out)).toBe(true)
  })

  it('⭐ CONTROL — FAILED is copied, never shared, so one caller cannot mutate another\'s', async () => {
    const a = await fetchSnapshot('/x', { fetchImpl: async () => res(false, null) })
    a.scribbled = true
    expect(FAILED.scribbled).toBeUndefined()
  })
})
