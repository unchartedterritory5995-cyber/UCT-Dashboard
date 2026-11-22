/**
 * deskVideoHref — the RS indicator's Learn-link builder (unit 2a-16).
 *
 * The consumer contract this pins is VideosSection.jsx's `?v=` effect:
 * `searchParams.get('v')` is the id, `searchParams.get('t')` is floored and
 * applied only when > 0. So `t=0` is dead weight and is omitted here (unlike
 * StockChart's deskMentionHref, which emits it and is tested separately).
 *
 * The second half reads `tests/fixtures/indicators/rs_learn_videos.json` —
 * the SAME file `tests/test_rs_learn_seed.py` pins against the Desk seed —
 * so the JS map and the Python rail can never drift apart silently.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deskVideoHref, RS_LEARN_VIDEOS, learnHref } from './deskVideoHref'

const ID = 'dQw4w9WgXcQ'
const YT_ID = /^[A-Za-z0-9_-]{11}$/

describe('deskVideoHref', () => {
  it('builds the Desk deep link with section=videos and the id', () => {
    expect(deskVideoHref(ID)).toBe(`/desk?section=videos&v=${ID}`)
  })

  it('appends &t=<int> for a finite seek >= 1 (floored)', () => {
    expect(deskVideoHref(ID, 341)).toBe(`/desk?section=videos&v=${ID}&t=341`)
    expect(deskVideoHref(ID, 1)).toBe(`/desk?section=videos&v=${ID}&t=1`)
    expect(deskVideoHref(ID, 91.6)).toBe(`/desk?section=videos&v=${ID}&t=91`)
  })

  it('omits t=0: the consumer ignores it, so the link is byte-identical to "no seek"', () => {
    expect(deskVideoHref(ID, 0)).toBe(deskVideoHref(ID))
    expect(deskVideoHref(ID, 0)).not.toContain('&t=')
    expect(deskVideoHref(ID, 0.4)).not.toContain('&t=')
  })

  it('treats negatives, NaN, Infinity, null, undefined and strings as "no seek"', () => {
    for (const bad of [-5, NaN, Infinity, -Infinity, null, undefined, '90', 'later', {}]) {
      expect(deskVideoHref(ID, bad)).toBe(`/desk?section=videos&v=${ID}`)
    }
  })

  it('refuses an id that is not 11 URL-safe characters', () => {
    for (const bad of [
      '', 'short', 'dQw4w9WgXcQQ', 'dQw4w9WgXc?', 'dQw4w9 gXcQ', 'dQw4w9WgXc/',
      null, undefined, 42, {}, ['dQw4w9WgXcQ'],
    ]) {
      expect(deskVideoHref(bad, 10)).toBeNull()
    }
  })

  it('accepts ids with the URL-safe base64 punctuation (- and _)', () => {
    expect(deskVideoHref('sM-aFdyOps4')).toBe('/desk?section=videos&v=sM-aFdyOps4')
    expect(deskVideoHref('_0ZvKLYznLo', 1814)).toBe('/desk?section=videos&v=_0ZvKLYznLo&t=1814')
  })
})

describe('RS_LEARN_VIDEOS', () => {
  const EXPECTED_KEYS = ['rsLine', 'phase', 'newHigh', 'beforePrice', 'redDay', 'fourChecks']

  it('is frozen, with frozen entries', () => {
    expect(Object.isFrozen(RS_LEARN_VIDEOS)).toBe(true)
    for (const entry of Object.values(RS_LEARN_VIDEOS)) expect(Object.isFrozen(entry)).toBe(true)
  })

  it('carries exactly the six lesson keys', () => {
    expect(Object.keys(RS_LEARN_VIDEOS).sort()).toEqual([...EXPECTED_KEYS].sort())
  })

  it('every entry has an 11-char id, a non-empty label and t undefined or >= 1', () => {
    for (const [key, entry] of Object.entries(RS_LEARN_VIDEOS)) {
      expect(entry.youtubeId, key).toMatch(YT_ID)
      expect(typeof entry.label, key).toBe('string')
      expect(entry.label.trim().length, key).toBeGreaterThan(0)
      if (entry.t !== undefined) {
        expect(Number.isInteger(entry.t), `${key}.t must be an integer`).toBe(true)
        expect(entry.t, key).toBeGreaterThanOrEqual(1)
      }
    }
  })

  // Decision D6 (2026-11-07): every lesson carries a start. No chapter data for
  // these videos is in the repo, so the three whole-workshop rows open at 1 s
  // (the top, not the member's resume point) and the three passage seeks stay.
  it('every lesson carries a start second (D6): 1 without repo chapters, else the passage', () => {
    for (const [key, entry] of Object.entries(RS_LEARN_VIDEOS)) {
      expect(entry.t, key).not.toBeUndefined()
    }
    expect(RS_LEARN_VIDEOS.rsLine.t).toBe(1)
    expect(RS_LEARN_VIDEOS.phase.t).toBe(1)
    expect(RS_LEARN_VIDEOS.newHigh.t).toBe(1)
    expect(learnHref('rsLine')).toBe('/desk?section=videos&v=sM-aFdyOps4&t=1')
    expect(learnHref('newHigh')).toBe('/desk?section=videos&v=QCTOJgCQmjw&t=1')
    expect([RS_LEARN_VIDEOS.beforePrice.t, RS_LEARN_VIDEOS.redDay.t, RS_LEARN_VIDEOS.fourChecks.t])
      .toEqual([1814, 341, 726])
  })

  it('learnHref composes a Desk link for every key and null for an unknown one', () => {
    for (const [key, entry] of Object.entries(RS_LEARN_VIDEOS)) {
      const href = learnHref(key)
      expect(href, key).toMatch(/^\/desk\?section=videos&v=[A-Za-z0-9_-]{11}(&t=\d+)?$/)
      expect(href, key).toContain(`&v=${entry.youtubeId}`)
      if (entry.t !== undefined) expect(href, key).toContain(`&t=${entry.t}`)
      else expect(href, key).not.toContain('&t=')
    }
    expect(learnHref('nope')).toBeNull()
    expect(learnHref('toString')).toBeNull() // prototype keys are not lessons
    expect(learnHref(undefined)).toBeNull()
  })
})

describe('shared fixture: tests/fixtures/indicators/rs_learn_videos.json', () => {
  // Same resolution rule as goldenFixtures.test.js: vitest runs from app/,
  // but a root-level run must work too. Loud failure when neither hits.
  const candidates = [
    join(process.cwd(), '..', 'tests', 'fixtures', 'indicators', 'rs_learn_videos.json'),
    join(process.cwd(), 'tests', 'fixtures', 'indicators', 'rs_learn_videos.json'),
  ]
  const path = candidates.find((p) => existsSync(p))
  if (!path) {
    throw new Error(
      `rs_learn_videos.json not found from cwd ${process.cwd()} — expected `
      + 'tests/fixtures/indicators/rs_learn_videos.json at the repo root',
    )
  }
  const fixture = JSON.parse(readFileSync(path, 'utf8'))

  it('names the plan section in its note', () => {
    expect(fixture.note).toMatch(/2a-16/)
    expect(fixture.note).toMatch(/§2\.8/)
  })

  it('has the same keys as RS_LEARN_VIDEOS', () => {
    expect(Object.keys(fixture.videos).sort()).toEqual(Object.keys(RS_LEARN_VIDEOS).sort())
  })

  it('agrees with RS_LEARN_VIDEOS entry for entry (JSON null == JS undefined for t)', () => {
    for (const [key, entry] of Object.entries(RS_LEARN_VIDEOS)) {
      const fx = fixture.videos[key]
      expect(fx, key).toBeTruthy()
      expect(fx.youtubeId, key).toBe(entry.youtubeId)
      expect(fx.label, key).toBe(entry.label)
      expect(fx.t === null ? undefined : fx.t, key).toBe(entry.t)
    }
  })
})
