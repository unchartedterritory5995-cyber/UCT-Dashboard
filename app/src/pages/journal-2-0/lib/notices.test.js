// P0.4 -- what Research Home's Notices box shows. Pure: the box fetches, toNotices decides.
// The fixture is CAPTURED (see its _provenance), not typed: /api/alerts answers a BARE LIST and
// /api/voice/insights answers {insights: [...]}.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { toNotices } from './notices'
import fx from './__fixtures__/notices.json'
// The follow-up row is CAPTURED too, but lives in its own fixture so the literal counts the box's other
// tests assert on notices.json stand (see its _provenance).
import fu from './__fixtures__/notices.followup.json'

const ALERTS = [...fx.alertsBody, ...fu.alertsBody]

describe('toNotices', () => {
  it('keeps notebook reminders, fills and note resurfacing; drops everything else', () => {
    const alerts = [...ALERTS, { id: 'x', type: 'price_alert', title: 'NVDA', data: {} }]
    const insights = { insights: [...fx.insightsBody.insights, { id: 99, kind: 'market_move', headline: 'SPY', link: '/x' }] }
    const kinds = toNotices(alerts, insights).map((n) => n.kind).sort()
    expect(kinds).toEqual(['fill', 'followup', 'reminder', 'resurface'])
  })
  it('the fixture is not vacuous: it holds one captured row of each kind', () => {
    const types = ALERTS.map((r) => r.type).sort()
    expect(types).toEqual(['notebook_earnings_followup', 'notebook_entry_context_new_fill', 'notebook_task_reminder'])
    expect(fx.insightsBody.insights.map((r) => r.kind)).toEqual(['note_level_touch'])
  })
  it('skips read alerts and dismissed insights', () => {
    const a = ALERTS.map((r) => ({ ...r, read: true }))
    const i = { insights: fx.insightsBody.insights.map((r) => ({ ...r, dismissed_at: '2026-10-11 12:00:00' })) }
    expect(toNotices(a, i)).toEqual([])
  })
  it('a reminder says what the bell said and opens the task list', () => {
    const r = toNotices(fx.alertsBody, { insights: [] }).find((n) => n.kind === 'reminder')
    expect(r.title).toBe('Tasks due today')
    expect(r.line).toBe('You have 1 task due today and 1 overdue task in your Notebook.')
    expect(r.href).toBe('/journal/notebook?view=tasks')
  })
  it('the fill notice points at the trade side, not the Notebook', () => {
    const fill = toNotices(fx.alertsBody, { insights: [] }).find((n) => n.kind === 'fill')
    expect(fill.href).toBe('/journal?j2tab=positions')
  })
  it('a follow-up says what the bell said and opens the card', () => {
    const f = toNotices(ALERTS, { insights: [] }).find((n) => n.kind === 'followup')
    expect(f.title).toBe('ORCL reported: write your follow-up')
    expect(f.line).toMatch(/^ORCL reported earnings on [A-Z][a-z]{2} \d{1,2}, \d{4}\. It is on your watchlist\./)
    expect(f.href).toMatch(/^\/journal\/notebook\?followup=ORCL&reportDate=\d{4}-\d{2}-\d{2}$/)
    expect(f.source).toBe('alert')
  })
  it('a follow-up row whose link is not the card has no link', () => {
    const row = { ...fu.alertsBody.find((r) => r.type === 'notebook_earnings_followup') }
    for (const url of ['https://elsewhere.example/x', '/journal/notebook?note=abc', '/journal/notebook?followupx=1', null, undefined, 7]) {
      row.data = { ...row.data, research_url: url }
      expect(toNotices([row], { insights: [] })[0].href).toBeNull()
    }
    delete row.data
    expect(toNotices([row], { insights: [] })[0].href).toBeNull()
  })
  it('a follow-up row with no title or line still reads as a follow-up', () => {
    const row = { id: 'f1', type: 'notebook_earnings_followup', data: { research_url: '/journal/notebook?followup=AMD&reportDate=2026-10-14' } }
    const n = toNotices([row], { insights: [] })[0]
    expect(n.title).toBe('Write an earnings follow-up')
    expect(n.line).toBe('')
    expect(n.href).toBe(row.data.research_url)
  })
  it('the captured follow-up is the raw capture, not a retyped row', () => {
    const raw = JSON.parse(readFileSync(resolve(globalThis.process.cwd(), '..', 'docs', 'notebook', 'evidence', 't2b-notice-capture', 'alerts-body.json'), 'utf8'))
    expect(raw).toHaveLength(1)
    expect(fu.alertsBody).toEqual(raw)
  })
  it('the captured follow-up link opens the card the server builds (derived from the source, not restated)', () => {
    const src = readFileSync(resolve(globalThis.process.cwd(), '..', 'api', 'services', 'journal_two', 'earnings_followup.py'), 'utf8')
    const m = src.match(/^NOTEBOOK_PATH = "(.+)"$/m)
    expect(m).not.toBeNull()
    const row = fu.alertsBody[0]
    expect(row.data.research_url.startsWith(`${m[1]}?followup=`)).toBe(true)
    expect(toNotices([row], { insights: [] })[0].href).toBe(row.data.research_url)
  })

  it('a resurfaced note opens its note, version door included', () => {
    const r = toNotices([], fx.insightsBody)[0]
    expect(r.kind).toBe('resurface')
    expect(r.title).toBe('NVDA reached 142.50, the stop you named')
    expect(r.href).toBe(fx.insightsBody.insights[0].link)
    expect(r.href.startsWith('/journal/notebook?note=')).toBe(true)
  })
  it('a resurfaced note only links into the Notebook', () => {
    const bad = { insights: [{ id: 5, kind: 'note_big_move', headline: 'h', link: 'https://evil.example/' }] }
    expect(toNotices([], bad)[0].href).toBeNull()
    const none = { insights: [{ id: 6, kind: 'note_date_due', headline: 'h' }] }
    expect(toNotices([], none)[0].href).toBeNull()
  })
  it('keys are unique across the two sources, even when an alert id equals an insight id', () => {
    const alerts = [{ id: 1, type: 'notebook_task_reminder', title: 't', data: {} }]
    const insights = { insights: [{ id: 1, kind: 'note_level_touch', headline: 'h', link: '/journal/notebook?note=a' }] }
    const keys = toNotices(alerts, insights).map((n) => n.key)
    expect(new Set(keys).size).toBe(2)
  })
  it('tolerates missing or malformed bodies', () => {
    expect(toNotices(null, undefined)).toEqual([])
    expect(toNotices('x', { insights: {} })).toEqual([])
    expect(toNotices({}, { insights: 'nope' })).toEqual([])
    expect(toNotices([null, 5, 'x'], { insights: [null, 7] })).toEqual([])
  })

  it('the captured fill row says what the server says today (derived from the source, not restated)', () => {
    const src = readFileSync(resolve(globalThis.process.cwd(), '..', 'api', 'services', 'journal_two', 'entry_context.py'), 'utf8')
    const m = src.match(/^BELL_MESSAGE = "(.+)"$/m)
    expect(m).not.toBeNull()
    const fill = fx.alertsBody.find((r) => r.type === 'notebook_entry_context_new_fill')
    expect(fill.message).toBe(m[1])
    expect(m[1]).not.toMatch(/Notebook/)
  })
})
