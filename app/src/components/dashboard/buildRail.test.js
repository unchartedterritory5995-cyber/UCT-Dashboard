import { describe, it, expect } from 'vitest'
import { buildRail } from './buildRail'

const cats = [
  { name: 'A', videos: [
    { id: 1, youtube_id: 'aaaaaaaaaaa', title: 'Alpha', created_at: 100 },
    { id: 2, youtube_id: 'bbbbbbbbbbb', title: 'Bravo', created_at: 300 },
  ] },
  { name: 'B', videos: [
    { id: 3, youtube_id: 'ccccccccccc', title: 'Charlie', created_at: 200 },
    { id: 4, youtube_id: 'ddddddddddd', title: 'Delta', created_at: 400 },
  ] },
]

describe('buildRail', () => {
  it('returns [] for no categories', () => {
    expect(buildRail([], {})).toEqual([])
  })

  it('orders latest by created_at desc when nothing is in progress', () => {
    const r = buildRail(cats, {})
    expect(r.map((i) => i.video.title)).toEqual(['Delta', 'Bravo', 'Charlie', 'Alpha'])
    expect(r.every((i) => i.resume === false)).toBe(true)
  })

  it('puts Continue Watching first (newest by at), then latest; dedups', () => {
    const progress = {
      aaaaaaaaaaa: { t: 30, d: 60, at: 999, done: false }, // Alpha in progress, newest
      ccccccccccc: { t: 15, d: 60, at: 500, done: false }, // Charlie in progress
    }
    const r = buildRail(cats, progress)
    expect(r.map((i) => i.video.title)).toEqual(['Alpha', 'Charlie', 'Delta', 'Bravo'])
    expect(r[0]).toMatchObject({ resume: true, pct: 50, index: 0 })
    expect(r[0].list).toBe(cats[0].videos) // carries its category list
    expect(new Set(r.map((i) => i.video.youtube_id)).size).toBe(r.length)
  })

  it('excludes finished videos', () => {
    const progress = { ddddddddddd: { t: 60, d: 60, at: 999, done: true } }
    const r = buildRail(cats, progress)
    expect(r.map((i) => i.video.title)).not.toContain('Delta')
  })

  it('respects the cap', () => {
    expect(buildRail(cats, {}, 2)).toHaveLength(2)
  })

  it('ignores barely-started progress (<8s) for the resume group', () => {
    const r = buildRail(cats, { aaaaaaaaaaa: { t: 3, d: 60, at: 999, done: false } })
    expect(r[0].resume).toBe(false) // Alpha falls to latest, not resume
  })
})
