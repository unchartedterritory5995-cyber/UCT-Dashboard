// Wave 13 lane 13A — the review note: the frozen grade worded the SAME way the card words it,
// a link to the plan note, two frozen charts, created through the one create door and landed.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./noteCreation', () => ({ createNoteViaApi: vi.fn(async (args) => ({ id: 'new-note', updatedAt: 'r1', ...args })) }))
vi.mock('./offline/settleNoteWrite', () => ({ settleNoteWrite: vi.fn(async () => {}) }))

import { buildReviewDoc, createPlanReviewNote, REVIEW_TAG } from './planReview'
import { createNoteViaApi } from './noteCreation'
import { settleNoteWrite } from './offline/settleNoteWrite'
import { PLAN_ROLES, planAnnotation, planBlock, canvasLevel } from './planLevels'

const GRADE = {
  symbol: 'NVDA', side: 'Long', status: 'planned',
  plan: { noteId: 'plan-1', sourceLabel: 'Plan note', matchedAt: '2026-09-15T01:02:03Z' },
  checks: {
    entry: { state: 'kept', planned: 100, actual: 100.5, chaseR: 0.125 },
    stop: { state: 'kept', planned: 96, limit: 95, exit: 110 },
    size: { state: 'none' },
    target: { state: 'hit', planned: 120, exit: 121 },
  },
}
const TRADE = { symbol: 'NVDA', side: 'Long', shares: 100, entryPrice: 100.5, entryDate: '2026-09-10T14:30:00Z',
  exitPrice: 121, exitDate: '2026-09-15T15:00:00Z' }

const textOf = (node) => (node?.type === 'text' ? node.text : (node?.content || []).map(textOf).join(' '))

beforeEach(() => { vi.clearAllMocks() })

describe('planReview', () => {
  it('builds the frozen grade table, the plan link and two frozen charts', () => {
    const doc = buildReviewDoc(GRADE, TRADE)
    const table = doc.content.find((n) => n.type === 'table')
    const rows = table.content.map(textOf)
    expect(rows[1]).toMatch(/Entry\s+Kept\s+Planned 100\.00 · filled 100\.50/)
    expect(rows[2]).toMatch(/Stop\s+Honoured/)
    expect(rows[3]).toMatch(/Size\s+—\s+No planned shares\./)
    expect(rows[4]).toMatch(/Target\s+Hit/)
    const link = JSON.stringify(doc).includes('"type":"noteLink","attrs":{"noteId":"plan-1"}')
    expect(link).toBe(true)
    const charts = doc.content.filter((n) => n.type === 'widgetEmbed')
    expect(charts).toHaveLength(2)
    expect(charts.map((c) => c.attrs.params.symbol)).toEqual(['NVDA', 'NVDA'])
    expect(charts[0].attrs.params.to).toBe(Math.floor(Date.parse('2026-09-10T23:59:59Z') / 1000))
    expect(charts[1].attrs.params.to).toBe(Math.floor(Date.parse('2026-09-15T23:59:59Z') / 1000))
    expect(charts[0].attrs.annotations).toEqual([])
  })

  it('creates through the one door, tags it so it is never read as a plan, and lands the revision', async () => {
    const created = await createPlanReviewNote(GRADE, TRADE)
    expect(createNoteViaApi).toHaveBeenCalledTimes(1)
    const args = createNoteViaApi.mock.calls[0][0]
    expect(args.tags).toEqual([REVIEW_TAG])
    expect(args.ticker).toBe('NVDA')
    expect(args.title).toBe('Plan review: NVDA 2026-09-15')
    expect(settleNoteWrite).toHaveBeenCalledWith('new-note', created)
  })
})

describe('planLevels — the write interface builders', () => {
  it('produces the shapes plan_extract reads', () => {
    expect(PLAN_ROLES).toEqual(['entry', 'stop', 'target', 'shares'])
    expect(planAnnotation('stop', '$41.50')).toEqual({ type: 'horizontal', role: 'stop', price: 41.5 })
    expect(planBlock({ shares: 200 })).toEqual({ shares: 200 })
    expect(planBlock({ shares: 0 })).toEqual({})
    expect(canvasLevel('entry', 10)).toEqual({ id: 'lv-entry', role: 'entry', label: '', price: 10, chartId: null })
    expect(() => planAnnotation('shares', 5)).toThrow()
    expect(() => canvasLevel('entry', -1)).toThrow()
  })
})
