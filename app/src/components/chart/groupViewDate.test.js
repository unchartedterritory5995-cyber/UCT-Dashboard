// (zero-network PR 1.3; review of #3020) the keys a colour group's charts read, per timeframe
import { describe, it, expect, beforeEach } from 'vitest'
import { groupChartEntry, noteGroupChart, dropGroupChart, noteGroupChartWhileShown, warmVariantsFor, _resetGroupDatesForTests } from './groupViewDate'
import { createBoardVisibility } from './boardVisibility'

beforeEach(() => _resetGroupDatesForTests())
const plain = (tf) => ({ id: tf, viewWindow: null })
const ids = (vs) => vs.map((v) => v.id)

describe('groupChartEntry: the key family a chart reads', () => {
  it('a native intraday chart at a date reads a window; D/W/M and a custom tf read the plain key (no day)', () => {
    expect(groupChartEntry('5', '2006-03-14')).toEqual({ tf: '5', day: '2006-03-14' })
    expect(groupChartEntry('D', '2006-03-14')).toEqual({ tf: 'D', day: null })
    expect(groupChartEntry('5', null)).toEqual({ tf: '5', day: null })
    const custom = groupChartEntry('120', '2006-03-14')
    expect(custom.day, 'a 2h chart at a date reads its base plain key').toBe(null)
    expect(custom.tf, 'its native base').not.toBe('120')
  })
})

describe('warmVariantsFor', () => {
  it('(B1) a D chart dated and a 5m chart at the present on one colour: 5m warms its PLAIN key only, D its plain key', () => {
    noteGroupChart('A', 'd', groupChartEntry('D', '2006-03-14'))
    noteGroupChart('A', 'm5', groupChartEntry('5', null))
    expect(warmVariantsFor('A', '5')).toEqual([plain('5')])
    expect(warmVariantsFor('A', 'D')).toEqual([plain('D')])
  })
  it('a 5m chart at a date: the 5m window only', () => {
    noteGroupChart('A', 'm5', groupChartEntry('5', '2006-03-14'))
    const v = warmVariantsFor('A', '5')
    expect(ids(v)).toEqual(['5@2006-03-14'])
    expect(v[0].viewWindow?.to).toBeGreaterThan(0)
  })
  it('one tf with a dated AND a present chart: both keys', () => {
    noteGroupChart('A', 'a', groupChartEntry('5', '2006-03-14'))
    noteGroupChart('A', 'b', groupChartEntry('5', null))
    expect(ids(warmVariantsFor('A', '5'))).toEqual(['5', '5@2006-03-14'])
  })
  it('(B2) a custom 2h chart at a date: its base warms the plain key (the chart reads SYM|base, no window)', () => {
    const e = groupChartEntry('120', '2006-03-14')
    noteGroupChart('A', 'h2', e)
    expect(warmVariantsFor('A', e.tf)).toEqual([plain(e.tf)])
  })
  it('no chart notes the tf: the plain key, as before; another colour is untouched', () => {
    noteGroupChart('B', 'x', groupChartEntry('5', '2006-03-14'))
    expect(warmVariantsFor('A', '5')).toEqual([plain('5')])
  })
  it('two dated charts on one tf: the latest noted wins, a republish included; a drop leaves the other', () => {
    noteGroupChart('A', 'c1', groupChartEntry('5', '2006-03-14'))
    noteGroupChart('A', 'c2', groupChartEntry('5', '2012-01-03'))
    expect(ids(warmVariantsFor('A', '5'))).toEqual(['5@2012-01-03'])
    noteGroupChart('A', 'c1', groupChartEntry('5', '2008-06-02'))
    expect(ids(warmVariantsFor('A', '5'))).toEqual(['5@2008-06-02'])
    dropGroupChart('A', 'c1')
    expect(ids(warmVariantsFor('A', '5'))).toEqual(['5@2012-01-03'])
  })
  it("(R1) a hidden board's chart notes nothing: the visible board's list warms as if it were not there", () => {
    const vis = createBoardVisibility({ layer: true })
    const stop = noteGroupChartWhileShown(vis, 'A', 'hiddenChart', groupChartEntry('5', '2006-03-14'))
    expect(ids(warmVariantsFor('A', '5')), 'shown: its window').toEqual(['5@2006-03-14'])
    vis.set('hidden')
    expect(warmVariantsFor('A', '5'), 'hidden: nothing of it').toEqual([plain('5')])
    vis.set('visible')
    expect(ids(warmVariantsFor('A', '5')), 'shown again').toEqual(['5@2006-03-14'])
    stop()
    expect(warmVariantsFor('A', '5')).toEqual([plain('5')])
  })
})
