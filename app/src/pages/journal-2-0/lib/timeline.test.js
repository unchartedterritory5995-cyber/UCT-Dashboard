import { describe, it, expect } from 'vitest'
import {
  addDays, etDateKey, layoutTimeline, mondayOf, shiftAnchor, timelineWindow,
} from './timeline'

/** Wave 6 (lane E, item 6) — the timeline's days, windows and layout. */

describe('days', () => {
  it('an instant sits on its ET day — an evening edit is not tomorrow', () => {
    // 01:30 UTC on the 25th is 21:30 ET on the 24th (EDT, -04:00).
    expect(etDateKey('2026-09-25T01:30:00+00:00')).toBe('2026-09-24')
    // …and a -04:00 stamp stays on its own day.
    expect(etDateKey('2026-09-24T22:00:00-04:00')).toBe('2026-09-24')
    expect(etDateKey('')).toBeNull()
    expect(etDateKey('not a date')).toBeNull()
  })

  it('day arithmetic ignores time zones, across months and DST', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02') // the DST change in the US
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(mondayOf('2026-09-27')).toBe('2026-09-21') // a Sunday belongs to the week before
    expect(mondayOf('2026-09-21')).toBe('2026-09-21')
  })
})

describe('windows', () => {
  it('a week is 7 day columns from its Monday', () => {
    const w = timelineWindow('2026-09-24', 'week')
    expect(w.buckets.map((b) => b.key)).toEqual([
      '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'])
    expect(w.label).toBe('Week of Sep 21')
  })

  it('a month is a column per day, a quarter a column per week', () => {
    expect(timelineWindow('2026-02-10', 'month').buckets).toHaveLength(28)
    const q = timelineWindow('2026-08-05', 'quarter')
    expect(q.label).toBe('Q3 2026')
    expect(q.start).toBe('2026-07-01')
    expect(q.end).toBe('2026-09-30')
    expect(q.buckets[0].key).toBe('2026-06-29') // the week holding Jul 1
    expect(q.buckets.at(-1).end >= '2026-09-30').toBe(true)
  })

  it('moves a whole window at a time', () => {
    expect(shiftAnchor('2026-09-24', 'week', 1)).toBe('2026-10-01')
    expect(shiftAnchor('2026-01-31', 'month', 1)).toBe('2026-02-01')
    expect(shiftAnchor('2026-11-15', 'quarter', 1)).toBe('2027-02-01')
  })
})

describe('layout', () => {
  const REVIEW = { id: 'p:review', type: 'date', name: 'Review' }
  const defsById = new Map([[REVIEW.id, REVIEW]])
  const note = (id, extra) => ({ id, title: id, tags: [], ...extra })
  // "Zeta" sorts AFTER "Unfiled", so only the catch-all rule can put Unfiled last.
  const opts = (over) => ({ timeBy: 'p:review', zoom: 'week', groupBy: 'folder', anchor: '2026-09-24', defsById, folderName: (f) => ({ f1: 'Zeta' })[f], ...over })

  it('lanes by folder, the Unfiled lane last; undated notes Unscheduled; the rest counted outside', () => {
    const notes = [
      note('a', { folderId: 'f1', propertiesJson: { 'p:review': '2026-09-22' } }),
      note('b', { folderId: null, propertiesJson: { 'p:review': '2026-09-24T09:00' } }),
      note('c', { folderId: 'f1', propertiesJson: { 'p:review': 'next week-ish' } }),
      note('d', { folderId: 'f1', propertiesJson: {} }),
      note('e', { folderId: 'f1', propertiesJson: { 'p:review': '2026-10-15' } }),
    ]
    const got = layoutTimeline(notes, opts())
    expect(got.lanes.map((l) => l.label)).toEqual(['Zeta', 'Unfiled'])
    expect(got.lanes[0].cells['2026-09-22'].map((n) => n.id)).toEqual(['a'])
    expect(got.lanes[1].cells['2026-09-24'].map((n) => n.id)).toEqual(['b'])
    expect(got.unscheduled.map((n) => n.id)).toEqual(['c', 'd'])
    expect(got.outside).toBe(1)
  })

  it('by tag: a note sits in each of its tags’ lanes, untagged last', () => {
    const notes = [
      note('a', { tags: ['semis', 'swing'], propertiesJson: { 'p:review': '2026-09-23' } }),
      note('b', { tags: [], propertiesJson: { 'p:review': '2026-09-23' } }),
    ]
    const got = layoutTimeline(notes, opts({ groupBy: 'tag' }))
    expect(got.lanes.map((l) => l.label)).toEqual(['#semis', '#swing', 'No tag'])
    expect(got.lanes[0].cells['2026-09-23'][0].id).toBe('a')
    expect(got.lanes[1].cells['2026-09-23'][0].id).toBe('a')
  })

  it('created and updated place by the ET day of the instant', () => {
    const n = note('a', { folderId: null, updatedAt: '2026-09-25T01:30:00+00:00', createdAt: '2026-09-01T12:00:00+00:00' })
    expect(Object.keys(layoutTimeline([n], opts({ timeBy: 'updated' })).lanes[0].cells)).toEqual(['2026-09-24'])
    expect(layoutTimeline([n], opts({ timeBy: 'created' })).outside).toBe(1)
  })
})
