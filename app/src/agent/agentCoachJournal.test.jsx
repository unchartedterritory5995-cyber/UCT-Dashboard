// Wave 3 W3-3 (w3-a, 2026-11-03): trade review foundations in the browser — consent (grant / revoke, per
// conversation, server-kept), journal.reviewTrades (consent-gated, descriptive stats from fake j2 rows through the
// EXISTING route, value-free for the model), journal.proposeNote (always a proposal; the only journal write), and
// the rail that nothing under coach/ writes to the journal any other way. Fake rows only; fetch is scripted.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAgentConfig, _resetAgentConfig, noteConversation } from './agentClient'
import { getCapability, getTargetKind, manifestFor } from './capabilities'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { reviewTrades, noteBody, _resetCoachForTest, _lastReview, JOURNAL_MARKER } from './capabilities/coach'
import { reviewStats, reviewText, modelView, clampN } from './coach/review'
import { consentState, readConsent, writeConsent, _resetConsentForTest } from './coach/consent'
import { loadConcepts, _resetConceptsForTest } from './coach/concepts'
import { _resetObserveForTest } from './coach/observe'
import { check, FOOTER } from './coach/guard'
import { fastParse } from './fastPath'
import { setupPanel, ONE } from './testing/panelHarness'

vi.mock('./trace', async (orig) => ({ ...(await orig()), currentTurnId: () => 't-coach' }))

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FX = JSON.parse(fs.readFileSync(path.join(HERE, '__fixtures__', 'coachJournalRows.json'), 'utf8'))
const CONCEPTS = [{ id: 'expectancy', title: 'Expectancy', aliases: ['expectancy', 'win rate'], observe: 'none', text: 'Expectancy. The average result per trade. Uncertainty: it is an estimate.', sections: {} }]
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const host = () => ({ charts: { list: () => [{ ref: 'c1', label: 'Chart (NVDA)', symbol: 'NVDA' }], read: () => null, selected: () => null } })

/** A server: config (coach on), concepts, the conversation's consent state (in memory), the j2 trades and notes routes. */
function server({ consent = null, trades = FX.rows, paid = true } = {}) {
  const st = { consent, calls: [], notes: [] }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url); const method = init.method || 'GET'
    st.calls.push([method, u, init.body ? JSON.parse(init.body) : null])
    if (u === '/api/agent/config') return json({ stream: false, data: false, data_kinds: [], coach: true })
    if (u === '/api/agent/coach/concepts') return json({ concepts: CONCEPTS, footer: FOOTER })
    const m = /^\/api\/agent\/conversations\/([^/]+)\/state\/coachConsent$/.exec(u)
    if (m) {
      if (method === 'PUT') { st.consent = { granted: init.body ? JSON.parse(init.body).value.granted : null, at: '2026-11-03T00:00:00Z' }; return json({ key: 'coachConsent', value: st.consent }) }
      return json({ key: 'coachConsent', value: st.consent, updated_at: st.consent ? 1 : null })
    }
    if (u.startsWith('/api/j2/trades')) return paid ? json({ trades: trades.slice(0, Number(new URL(u, 'http://x').searchParams.get('limit'))), total: trades.length }) : json({ detail: 'paid' }, 402)
    if (u === '/api/j2/notes' && method === 'POST') { const b = JSON.parse(init.body); st.notes.push(b); return json({ note: { id: `n${st.notes.length}`, title: b.title } }) }
    if (u === '/api/agent/record') return json({ conversationId: 'ac_1' })
    return json({})
  })
  return st
}

beforeEach(async () => {
  _resetAgentConfig(); _resetConceptsForTest(); _resetObserveForTest(); _resetCoachForTest(); _resetConsentForTest()
  noteConversation('ac_1')
})

async function up(opts) {
  const st = server(opts)
  await loadAgentConfig(); registerBuiltins(); registerServerGatedBuiltins(); await loadConcepts()
  return st
}

describe('review statistics (browser mirror of coach/review.py, the shared fixture)', () => {
  it('🔴 computes exactly the fixture’s stats for both windows, value-free', () => {
    expect(reviewStats(FX.rows, 10)).toEqual(FX.expected_n10)
    expect(reviewStats(FX.rows, 3)).toEqual(FX.expected_n3)
    const dumped = JSON.stringify(reviewStats(FX.rows, 10))
    for (const f of ['entryPrice', 'exitPrice', 'symbol', 'AAA', 'entryDate', 'pnlDollar']) expect(dumped).not.toContain(f)
    expect(clampN(null)).toBe(10); expect(clampN(500)).toBe(50); expect(clampN(0)).toBe(1)
  })
  it('the text is descriptive, matches the server’s wording, and passes the guard against its own stats', () => {
    const s = reviewStats(FX.rows, 10)
    const t = reviewText(s)
    expect(t).toBe('Your last 9 closed trades: 5 wins, 3 losses, 1 breakeven (win rate 63%). Average R +0.47R over the 8 with a stop recorded; largest win +2.00R, largest loss -1.75R. Average holding time 3 days. Mistake tags you recorded: chased (2), held through stop (1), no stop plan (1). Emotion tags: calm (2), fomo (2), hope (1). Descriptive review, not a recommendation.')
    expect(check(t, JSON.stringify(s))).toEqual([])
    expect(modelView({ ...s, rows: FX.rows, symbols: ['AAA'] })).not.toHaveProperty('rows')
    expect(Object.keys(modelView(s))).not.toContain('symbols')
  })
})

describe('consent (per conversation, server-kept)', () => {
  it('unknown until read; granted / revoked round-trip through the state route; no conversation → nothing granted', async () => {
    const st = await up()
    expect(consentState()).toBe('unknown')
    expect(await readConsent()).toBe('unknown')
    expect(await writeConsent(true)).toBe('granted')
    expect(st.consent.granted).toBe(true)
    expect(consentState()).toBe('granted')
    expect(await writeConsent(false)).toBe('revoked')
    expect(consentState()).toBe('revoked')
    _resetConsentForTest(); noteConversation(null)
    expect(consentState()).toBe('unknown')
    await expect(writeConsent(true)).rejects.toThrow(/ask me something first/)
  })
  it('🔴 the member’s own words are an EXPLICIT grant / revoke (applied); any other grant is confirm-risk (a card)', async () => {
    await up()
    const h = host()
    const cap = getCapability('coach.consent')
    expect(cap.risk).toBe('confirm'); expect(cap.explicitOk).toBe(true); expect(cap.undo).toBe('none')
    const grant = fastParse('yes, use my journal', { host: h })
    expect(grant.ops[0]).toMatchObject({ action: 'coach.consent', args: { granted: true }, explicit: true })
    const revoke = fastParse('stop using my journal', { host: h })
    expect(revoke.ops[0]).toMatchObject({ action: 'coach.consent', args: { granted: false }, explicit: true })
    expect(fastParse('use my journal for everything forever', { host: h })).toBe(null)
    // the pure state transform and its receipt
    const before = { consent: 'unknown', note: null }
    const after = cap.apply(before, { granted: true })
    expect(after.consent).toBe('granted')
    expect(cap.describe(before, after)).toMatch(/Allowed the coach to use your journal in this chat/)
    expect(cap.apply(after, { granted: true })).toBe(after)                                   // a no-op is the same object
    expect(cap.describe(after, cap.apply(after, { granted: false }))).toMatch(/Stopped the coach/)
    noteConversation(null)
    expect(cap.check(before, { granted: true })).toMatch(/ask me something first/)
  })
})

describe('journal.reviewTrades', () => {
  it('🔴 without consent: asks for it and reads NOTHING from the journal', async () => {
    const st = await up()
    const a = await reviewTrades(null)
    expect(a.text).toMatch(/say “yes, use my journal”/)
    expect(a.text).toContain(FOOTER)
    expect(st.calls.some(([, u]) => u.startsWith('/api/j2/'))).toBe(false)
  })
  it('🔴 with consent: the newest N through GET /api/j2/trades, descriptive stats, the footer, no prices', async () => {
    const st = await up({ consent: { granted: true, at: 'x' } })
    const a = await reviewTrades(null)
    expect(st.calls.find(([m, u]) => m === 'GET' && u.startsWith('/api/j2/trades'))[1]).toBe('/api/j2/trades?limit=10&offset=0')
    expect(a.text).toContain('Your last 9 closed trades: 5 wins, 3 losses, 1 breakeven (win rate 63%).')
    expect(a.text).toContain('Descriptive review, not a recommendation.')
    expect(a.text.trim().endsWith(FOOTER)).toBe(true)
    expect(a.present.kind).toBe('metrics')
    expect(JSON.stringify(a)).not.toMatch(/AAA|entryPrice|\$\d/)
    expect(_lastReview().stats).toEqual(FX.expected_n10)
    const three = await reviewTrades(3)
    expect(three.text).toContain('Your last 3 closed trades')
    const capped = await reviewTrades(999)
    expect(st.calls.at(-1)[1]).toBe('/api/j2/trades?limit=50&offset=0')
    expect(capped.text).toContain('closed trades')
  })
  it('revoked consent closes the door again; a refused route is a sentence', async () => {
    const st = await up({ consent: { granted: false, at: 'x' } })
    expect((await reviewTrades(null)).text).toMatch(/yes, use my journal/)
    expect(st.calls.some(([, u]) => u.startsWith('/api/j2/'))).toBe(false)
    server({ consent: { granted: true, at: 'x' }, paid: false }); _resetConsentForTest()
    expect((await reviewTrades(null)).text).toMatch(/paid UCT plan/)
  })
  it('the fast path reads "review my last 5 trades"', async () => {
    await up()
    expect(fastParse('review my last 5 trades', { host: host() }).ops[0]).toMatchObject({ action: 'journal.reviewTrades', args: { count: 5 } })
    expect(fastParse('review my trades', { host: host() }).ops[0]).toMatchObject({ action: 'journal.reviewTrades', args: { count: null } })
  })
  it('🔴 the model sees counts and stats only: the coach context entry carries modelView, never rows', async () => {
    await up({ consent: { granted: true, at: 'x' } })
    await reviewTrades(null)
    const { buildContext } = await import('./capabilities')
    const [e] = buildContext(host(), { surface: 'charts', message: 'what do you see in my trades?' }).context.coach
    expect(e.consent).toBe('granted')
    expect(e.review).toEqual(modelView(FX.expected_n10))
    expect(JSON.stringify(e)).not.toMatch(/AAA|entryPrice|exitDate/)
  })
})

describe('journal.proposeNote', () => {
  it('🔴 is always a proposal, guarded, and its commit is the one POST /api/j2/notes', async () => {
    const st = await up({ consent: { granted: true, at: 'x' } })
    await reviewTrades(null)
    const cap = getCapability('journal.proposeNote')
    expect(cap.risk).toBe('confirm'); expect(cap.reversible).toBe(false); expect(cap.undo).toBe('none')
    const h = host()
    const state = { consent: 'granted', note: null }
    const good = { title: 'Review: chasing entries', body: 'Two of the three losses carried the tag chased. What would an entry rule look like that rules those out? Win rate 63% describes this sample only.' }
    expect(cap.check(state, good)).toBe(null)
    expect(cap.apply(state, good).note).toEqual(good)
    expect(cap.describe(state, cap.apply(state, good))).toMatch(/Proposed a journal note “Review: chasing entries” — saved to your journal only when you approve it/)
    // refused notes: a claim, an order, an invented figure, an over-long title
    expect(cap.check(state, { title: 'x', body: 'This setup will go up next time.' })).toMatch(/can’t propose a note that makes a claim/)
    expect(cap.check(state, { title: 'x', body: 'Buy 100 shares at the open next time.' })).toMatch(/can’t propose a note/)
    expect(cap.check(state, { title: 'x', body: 'Your win rate of 80% is strong.' })).toMatch(/figures from your own review/)
    expect(cap.check(state, { title: 'x'.repeat(121), body: 'ok' })).toMatch(/title of up to 120/)
    // the commit: the kind's one journal write, a TipTap doc of paragraphs
    const kind = getTargetKind('coach')
    const res = await kind.commit(h, 'coach', { note: good })
    expect(res.created.note).toBe('n1')
    const post = st.calls.find(([m, u]) => m === 'POST' && u === '/api/j2/notes')
    expect(post[2]).toMatchObject({ title: good.title, tags: ['uct-agent-coach'] })
    expect(post[2].bodyJson).toEqual(noteBody(good.body))
    expect(post[2].bodyJson.type).toBe('doc')
    expect(post[2].bodyJson.content[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: good.body }] })
  })
})

describe('🔴 RAIL: the journal is read through its existing route and written ONLY by journal.proposeNote', () => {
  it('every /api/j2 reference under coach/ is a GET of /api/j2/trades or the one POST of /api/j2/notes', () => {
    const files = [path.join(HERE, 'capabilities', 'coach.js'), ...fs.readdirSync(path.join(HERE, 'coach')).map(f => path.join(HERE, 'coach', f))]
      .filter(f => /\.(js|jsx)$/.test(f) && !/\.test\./.test(f))
    const refs = []
    for (const f of files) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const code = line.trim()
        if (/^(\/\/|\*|\/\*)/.test(code)) return
        if (code.includes('/api/j2/')) refs.push({ file: path.basename(f), line: i + 1, code })
      })
    }
    const writes = refs.filter(r => /method:\s*'(POST|PUT|PATCH|DELETE)'/.test(r.code) || /\/api\/j2\/(?!trades|notes)/.test(r.code))
    expect(writes.map(r => `${r.file}:${r.line}`)).toEqual(['coach.js:' + writes[0]?.line])
    expect(writes[0].code).toMatch(/fetch\('\/api\/j2\/notes', \{ method: 'POST'/)
    expect(refs.filter(r => r.code.includes('TRADES_ROUTE =')).map(r => r.file)).toEqual(['review.js'])
    expect(refs.every(r => r.code.includes("'/api/j2/notes'") || r.code.includes("'/api/j2/trades'"))).toBe(true)
  })
  it('the manifest names the three journal-side capabilities on the coach target, explain unchanged', async () => {
    await up()
    const names = manifestFor({ surface: 'charts' }).filter(c => c.target === 'coach').map(c => c.name).sort()
    expect(names).toEqual(['coach.consent', 'coach.explain', 'journal.proposeNote', 'journal.reviewTrades'])
  })
})

describe('🔴 PANEL: consent → review → a proposed note, through the real panel (scripted model, no paid call)', () => {
  it('yes, use my journal → review my trades → a note card; nothing is written until Apply', async () => {
    _resetAgentConfig(); _resetConceptsForTest(); _resetCoachForTest(); _resetConsentForTest()
    const p = setupPanel()
    const base = globalThis.fetch
    const st = { consent: null, notes: [], j2: [] }
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url); const method = init.method || 'GET'
      if (u === '/api/agent/config') return json({ stream: false, data: false, data_kinds: [], coach: true })
      if (u === '/api/agent/coach/concepts') return json({ concepts: CONCEPTS, footer: FOOTER })
      const m = /^\/api\/agent\/conversations\/([^/]+)\/state\/coachConsent$/.exec(u)
      if (m) { if (method === 'PUT') st.consent = { granted: JSON.parse(init.body).value.granted }; return json({ key: 'coachConsent', value: st.consent }) }
      if (u.startsWith('/api/j2/')) { st.j2.push([method, u]); if (u.startsWith('/api/j2/trades')) return json({ trades: FX.rows, total: FX.rows.length }); if (u === '/api/j2/notes' && method === 'POST') { st.notes.push(JSON.parse(init.body)); return json({ note: { id: 'n1' } }) } }
      return base(url, init)
    })
    const { say, click } = p.mount(...ONE('NVDA'))
    await loadConcepts()
    expect(await say('review my trades')).toMatch(/say “yes, use my journal”/)
    expect(st.j2).toEqual([])
    expect(await say('yes, use my journal')).toMatch(/Allowed the coach to use your journal in this chat/)
    expect(st.consent).toEqual({ granted: true })
    const review = await say('review my trades')
    expect(review).toMatch(/5 wins, 3 losses/)
    expect(review).not.toMatch(/AAA|\$\d/)
    expect(st.j2).toEqual([['GET', '/api/j2/trades?limit=10&offset=0']])
    // ⛔ review B3: the transcript row is the value-free marker only, flagged local (never replayed to a model)
    const rec = p.st.calls.filter(c => c[1] === '/api/agent/record').map(c => c[2]).pop()
    expect(JSON.stringify(rec)).not.toMatch(/5 wins|3 losses|chased|win rate/i)
    expect(JSON.stringify(rec)).toContain(JOURNAL_MARKER)
    expect(rec.outcomeData).toMatchObject({ local: true, actions: ['journal.reviewTrades'] })
    expect(rec.outcomeData.views).toBeUndefined()
    // the model proposes a note (scripted, aimed at the coach entry's minted ref): a card, nothing written
    p.st.envelopes.push((body) => p.env('propose', [{ action: 'journal.proposeNote', target: body.context.coach[0].ref, args: { title: 'Review: chasing', body: 'Two losses carried the tag chased. What entry rule would rule those out?' } }], 'Here is a note you could keep.'))
    const proposed = await say('write that up as a note for my journal')
    expect(proposed).toMatch(/Proposed a journal note/)
    expect(st.notes).toEqual([])
    await click('Apply')
    expect(st.notes.length).toBe(1)
    expect(st.notes[0].title).toBe('Review: chasing')
    expect(await say('stop using my journal')).toMatch(/Stopped the coach using your journal/)
    expect(st.consent).toEqual({ granted: false })
    // a grant the MODEL writes (not the member's words) is a card, and nothing is granted until Apply
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'coach.consent', target: body.context.coach[0].ref, args: { granted: true } }], 'Allowing it.'))
    const card = await say('coach, I want you to look at my journal again')
    // after revoke, the turn the model saw carries no journal content at all
    expect(JSON.stringify(p.lastTurnBody())).not.toMatch(/winRatePct|5 wins|chased/)
    expect(card).toMatch(/Allow/i)
    expect(st.consent).toEqual({ granted: false })
    await click('Apply')
    expect(st.consent).toEqual({ granted: true })
  })
})

describe('review fix: the last review is kept PER CONVERSATION', () => {
  it('a review in chat A never rides into chat B (context entry and note-guard inputs)', async () => {
    await up({ consent: { granted: true, at: '2026-11-03T00:00:00Z' } })
    await readConsent()
    await reviewTrades(10)
    expect(_lastReview()?.stats).toEqual(FX.expected_n10)
    noteConversation('ac_2')
    expect(_lastReview()).toBe(null)
    noteConversation('ac_1')
    expect(_lastReview()?.stats).toEqual(FX.expected_n10)
  })
})
