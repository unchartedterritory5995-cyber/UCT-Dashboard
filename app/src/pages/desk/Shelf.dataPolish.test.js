// Data-honesty polish: import stamps never read as air dates, and episode
// titles drop the "Show Season N, Episode N" prefix the meta line repeats.
import { describe, it, expect } from 'vitest'
import { markImportStamps, IMPORT_BATCH_MIN } from './VideosSection'
import { cardTitle } from './Shelf'

const BATCH = 1781911749 // the 2026-06-19 back-catalogue load
const vid = (id, created_at) => ({ id, created_at, title: `v${id}` })

describe('markImportStamps', () => {
  it('flags every video sharing a bulk-load minute, across categories', () => {
    const cats = [
      { name: 'A', videos: Array.from({ length: 5 }, (_, i) => vid(i, BATCH + i)) },
      { name: 'B', videos: Array.from({ length: IMPORT_BATCH_MIN - 5 }, (_, i) => vid(100 + i, BATCH + 3)) },
    ]
    const out = markImportStamps(cats)
    expect(out.flatMap((c) => c.videos).every((v) => v.importStamped)).toBe(true)
  })
  it('leaves normally published videos alone and never mutates the payload', () => {
    const cats = [{ name: 'Shows', videos: [vid(1, BATCH), vid(2, BATCH + 86400), vid(3, BATCH + 2 * 86400)] }]
    const out = markImportStamps(cats)
    expect(out).toBe(cats) // nothing batched → the same array back
    expect(cats[0].videos.some((v) => 'importStamped' in v)).toBe(false)
  })
  it('does not flag a minute just under the threshold', () => {
    const cats = [{ name: 'A', videos: Array.from({ length: IMPORT_BATCH_MIN - 1 }, (_, i) => vid(i, BATCH)) }]
    expect(markImportStamps(cats)[0].videos.some((v) => v.importStamped)).toBe(false)
  })
})

describe('cardTitle', () => {
  const ep = (title) => ({ title, episode_label: 'S1 · E5' })
  it('drops the repeated season/episode prefix', () => {
    expect(cardTitle(ep('The Mental Game Season 1, Episode 5 Hesitation and Edge: Identifying the Reasons')))
      .toBe('Hesitation and Edge: Identifying the Reasons')
    expect(cardTitle(ep('The Mental Game Season 1, Episode 1 in Uncharted Territory Train Your Mind')))
      .toBe('Train Your Mind')
  })
  it('keeps the title when there is no episode label', () => {
    const t = 'The Mental Game Season 1, Episode 5 Hesitation'
    expect(cardTitle({ title: t })).toBe(t)
  })
  it('keeps the title when nothing meaningful would remain', () => {
    expect(cardTitle(ep('The Mental Game Season 1, Episode 5'))).toBe('The Mental Game Season 1, Episode 5')
  })
  it('leaves titles without the pattern untouched', () => {
    expect(cardTitle(ep('Distinction Between Conviction and Hope'))).toBe('Distinction Between Conviction and Hope')
  })
})
