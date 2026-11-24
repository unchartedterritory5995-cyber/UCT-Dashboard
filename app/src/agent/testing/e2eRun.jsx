// ── E2E EVAL: one dialogue through the REAL panel, end to end, without teacher forcing (test-only) ─────────
//
// AgentPanel → useAgent (fast paths, compound, readers, routing v2 — or NL-1) → planner → policy → runtime → the
// executable fixture board (testing/e2eHost.js). The ONLY stand-in is the model: every request the panel sends to
// /api/agent/turn is answered by a RESPONDER —
//
//   bankResponder   the recorded paid answer to that exact request (tools/agent_eval_run.py results, keyed by a hash
//                   of the request body + the history the server would load). A request not in the bank is a MISS:
//                   it is written out as the next round's paid input (the runner's bodies format) and the dialogue
//                   stops there. Round k+1 replays everything rounds 1..k recorded, so turn N+1 always runs on the
//                   board turn N actually produced.
//   oracleResponder the EXPECTED plan as the model's envelope (the oracle self-check, and the oracle board below)
//
// The server half is emulated where the panel depends on it: the conversation store (`history` exactly as
// routers/uct_agent.py builds it: a reroute drops the repeated member line, a repair keeps it, /record adds the browser's
// own rows, a need_groups reply is never stored), the ticker search, the Screener catalog and a scan, the tracings sync
// read-back, and empty answers elsewhere. Every non-Agent data read the panel makes is recorded (`dataPaths`).
//
// The ORACLE board of a turn is the expected plan run through the SAME panel and writers from the same board: a fresh
// mount replays the dialogue's actual earlier turns (or none, for an expectation `from: 'start'`), then sends the turn
// with the oracle responder on the NL-1 path. Scoring compares boards (testing/e2eScore.js), never plan text.
import { vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { AuthContext } from '../../context/AuthContext'
import AgentPanel from '../AgentPanel'
import { NL1_KEY } from '../nl1/interpreter'
import { _resetAgentConfig, loadAgentConfig } from '../agentClient'
import { getCapability, getTargetKind } from '../capabilities'
import { _resetAuthoring } from '../capabilities/indicatorAuthoring'
import { _resetProposedPlans } from '../capabilities/indicatorEdits'
import { _resetScreenerCache } from '../capabilities/screener'
import { _simulateReload, STORAGE_KEY } from '../../components/chart/builder/authoring/conversationSessions'
import { _resetDraftPreview } from '../../components/chart/builder/agentAuthoring'
import * as drawingsStore from '../../components/chart/drawingsStore'
import { TICKERS } from './panelHarness'
import { selectionRecord, legacyRerouteRecord } from './capture'
import { buildBoard, snapshot } from './e2eHost'

// ── arms ────────────────────────────────────────────────────────────────────────────────────────────────
// A = production today: the legacy interpreter (fast paths + compound + readers, then the routed model request) on
// routing v2. B / C = NL-1 (model-directed; only the exact lane stays instant). The model is the paid run's, not ours.
export const ARMS = {
  A: { id: 'A', nl1: false, mode: 'legacy', model: 'claude-haiku-4-5', about: 'legacy interpreter + routing v2 + fast paths/compound' },
  B: { id: 'B', nl1: true, mode: 'nl1', model: 'claude-haiku-4-5', about: 'NL-1 model-directed' },
  C: { id: 'C', nl1: true, mode: 'nl1', model: 'claude-sonnet-5-5', about: 'NL-1 model-directed, stronger model' },
}
// what GET /api/agent/config answers: the code defaults of every switch (stream, data, planner off; routing v2 on). NL-1 is
// served (a server flag, as in the NL-1 dark release); whether the PANEL takes it is the browser key, set per arm.
export const SERVER_CONFIG = { stream: false, nl1: true, news: false, data: false, scan: false, data_kinds: [], planner: 'v1', coach: false, routing_v2: true }

// ── the request key ───────────────────────────────────────────────────────────────────────────────────────
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(16).padStart(8, '0') }
const stable = (v) => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v)
/** One request's identity: what run_turn is asked with (the body without the conversation id, and the server-side history). */
export function requestKey(arm, body, history) {
  const { conversationId, ...rest } = body || {}
  void conversationId
  const s = JSON.stringify(stable({ body: rest, history }))
  return `e2e:${arm}:${fnv(s)}${fnv(s.split('').reverse().join(''))}:${s.length}`
}

// ── the panel's request taps (installed by the test file's vi.mock of nl1/interpreter and nlm1/flag) ─────────────
export const tap = globalThis.__e2eTap || (globalThis.__e2eTap = { nl1: null, route: null, committed: [] })

// ── responders ──────────────────────────────────────────────────────────────────────────────────────────────
/** Every result row of a runner results file (or a list of them), by key. */
export function loadBank(files) {
  const bank = new Map()
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'))
    for (const r of data.results || []) bank.set(r.key, { ...r, model: data.model })
  }
  return bank
}
export function bankFiles(dir) {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => path.join(dir, f)) } catch { return [] }
}

/**
 * The bank responder. `collect` (a Map) receives each MISS as a runner item; `catalogs` (a Map) the catalogs its
 * reroute tables need. A hit answers as the server would: the recorded envelope, and `usage.repaired` set when the
 * runner already rerouted (production never repairs a rerouted plan).
 */
export function bankResponder({ arm, bank, collect = null, catalogs = null, set = 'e2e', split = 'dev', meta = {} }) {
  return ({ body, history }) => {
    const key = requestKey(arm, body, history)
    const row = bank.get(key)
    if (row) {
      if (row.error) return { key, row, status: 503, detail: 'UCT Agent was unavailable for this message.' }
      const usage = { ...(row.usage || {}), model_calls: row.usage?.model_calls ?? row.rounds ?? 1,
        repaired: row.rerouted ? false : (row.usage?.repaired ?? null), citations: [] }
      return { key, row, envelope: row.envelope, usage }
    }
    if (collect && !collect.has(key)) collect.set(key, itemFor({ arm, key, body, history, catalogs, set, split, meta }))
    return { key, miss: true, status: 503, detail: 'e2e: this request has no recorded answer yet' }
  }
}

/** One request as a runner item (tools/agent_eval_run.py bodies format), with the reroute tables its replay needs. */
export function itemFor({ arm, key, body, history, catalogs, set, split, meta = {} }) {
  const item = { key, set, split, mode: ARMS[arm].mode, caseId: meta.caseId, turn: meta.turn, body, history }
  if (ARMS[arm].nl1 && !body.repair && !body.reroute && tap.nl1) Object.assign(item, selectionRecord(tap.nl1, catalogs))
  if (!ARMS[arm].nl1 && !body.reroute && tap.route?.routed?.routing) {
    const t = tap.route
    const rec = legacyRerouteRecord({ full: t.full, text: t.text, routed: t.routed, route: t.route, routeOpts: t.routeOpts, catalogs })
    if (rec) Object.assign(item, rec)
  }
  return item
}

/** Wraps a responder so every request it answers is also written out as a runner item (the free proxy capture). */
export function collectingResponder(inner, { arm, collect, catalogs, set = 'e2e', split = 'dev', meta = {} }) {
  return (req) => {
    const key = requestKey(arm, req.body, req.history)
    if (!collect.has(key)) collect.set(key, itemFor({ arm, key, body: req.body, history: req.history, catalogs, set, split, meta }))
    return inner(req)
  }
}

/** The labelled targets a request offered the model: { label → [{ ref, section }] }, from every context section. One label
 *  can name several targets (a chart, its indicators row, its indicatorEdits entry): the SECTION tells them apart. */
export function offered(context) {
  const out = new Map()
  const put = (k, ref, section) => { const key = String(k).toLowerCase(); if (!out.has(key)) out.set(key, []); if (!out.get(key).some(x => x.ref === ref)) out.get(key).push({ ref, section }) }
  const walk = (v, depth, section) => {
    if (!v || typeof v !== 'object' || depth > 6) return
    if (Array.isArray(v)) { v.forEach(x => walk(x, depth + 1, section)); return }
    if (typeof v.ref === 'string') {
      if (typeof v.label === 'string') put(v.label, v.ref, section)
      if (typeof v.name === 'string') put(v.name, v.ref, section)
      if (typeof v.chart === 'string') put(v.chart, v.ref, section)     // an indicatorEdits / indicators entry names its chart
    }
    for (const x of Object.values(v)) walk(x, depth + 1, section)
  }
  for (const [section, v] of Object.entries(context || {})) walk(v, 0, section)
  return out
}
/** The model ref of a target for `action`: the offered ref with that label in the action's target-kind section (else the
 *  ref initial, else the first). */
export function refFor(refs, action, label) {
  const list = refs.get(String(label).toLowerCase()) || []
  const kind = String(getCapability(action)?.target || '')
  const plural = (k) => [k, `${k}s`, k.replace(/y$/, 'ies')]
  return (list.find(x => kind && plural(kind).includes(x.section)) || list.find(x => kind && x.ref[0] === kind[0]) || list[0])?.ref || null
}

/** The board target a case names ("Right chart (META)", 'selected', a list / layout name), found on the board NOW. */
export function targetOf(host, action, hint) {
  const kind = getTargetKind(getCapability(action)?.target)
  const list = (() => { try { return kind?.list(host) || [] } catch { return [] } })()
  if (!list.length) return null
  if (!hint) return list.length === 1 ? list[0] : (list.find(s => s.selected) || null)
  if (hint === 'selected') return list.find(s => s.selected) || (list.length === 1 ? list[0] : null)
  const h = String(hint).toLowerCase()
  const exact = list.find(s => String(s.label).toLowerCase() === h || String(s.name || '').toLowerCase() === h)
  if (exact) return exact
  // "Right chart (META)" after an earlier turn changed that chart's symbol: the same position; else the same symbol
  const m = /^(.*?)\s*\(([^)]+)\)$/.exec(String(hint))
  if (m) {
    const pos = m[1].toLowerCase(), sym = m[2].toUpperCase()
    const byPos = list.filter(s => String(s.label).toLowerCase().startsWith(`${pos} (`))
    if (byPos.length === 1 && pos !== 'chart') return byPos[0]
    const bySym = list.filter(s => String(s.symbol || '').toUpperCase() === sym || String(s.label).toUpperCase().endsWith(`(${sym})`))
    if (bySym.length === 1) return bySym[0]
  }
  const named = list.filter(s => String(s.label).toLowerCase().includes(h))
  if (named.length === 1) return named[0]
  return list.length === 1 ? list[0] : null
}

/** A case's argument matcher made concrete: { $has: [...] } → the list, { $in: [...] } → option `pick`. */
export function concreteArgs(args, pick = 0) {
  if (Array.isArray(args)) return args.map(a => concreteArgs(a, pick))
  if (args && typeof args === 'object') {
    if (Array.isArray(args.$has)) return concreteArgs(args.$has, pick)
    if (Array.isArray(args.$in)) return concreteArgs(args.$in[Math.min(pick, args.$in.length - 1)], pick)
    return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, concreteArgs(v, pick)]))
  }
  return args
}
/** How many concrete readings a plan's `$in` matchers allow (each is one oracle). */
export const inChoices = (plan) => Math.max(1, ...JSON.stringify(plan || []).match(/"\$in":\[[^\]]*\]/g)?.map(s => JSON.parse(s.slice(6)).length) || [1])

/**
 * The oracle responder: the expected plan as the model's envelope, its targets the refs THIS request offered for the
 * case's labels. kind 'propose' → a proposal (the harness then approves it, as the member would).
 */
export function oracleResponder({ host, plan, kind = 'act', pick = 0, reply = '' }) {
  return ({ body }) => {
    const refs = offered(body.context)
    const ops = (plan || []).map(o => {
      const t = o.t !== undefined || getCapability(o.a)?.target ? targetOf(host, o.a, o.t) : null
      const ref = t ? (refFor(refs, o.a, t.label) || t.ref) : undefined
      return { action: o.a, ...(ref ? { target: ref } : {}), args: concreteArgs(o.args || {}, pick) }
    })
    const envelope = { disposition: kind === 'propose' ? 'propose' : (ops.length ? 'apply' : 'answer'), reply, question: null, ops,
      unsupported_category: null, correction: null }
    return { key: 'oracle', envelope, usage: { model_calls: 1, repaired: false, citations: [] } }
  }
}

// ── the server ──────────────────────────────────────────────────────────────────────────────────────────────
const SCR = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../__fixtures__/nlIntent/screener-catalog.json'), 'utf8'))
// fixture tickers only (no market data): the panel harness's table plus the bench's own symbols
const EXTRA = ['A', 'AI', 'U', 'GO', 'SO', 'BE', 'CVX', 'OXY', 'RIVN', 'LCID', 'SNOW', 'NET', 'DDOG', 'PANW', 'LLY', 'UNH', 'CAT', 'GE', 'F', 'GM', 'NIO', 'BABA', 'SQ', 'PYPL', 'ROKU', 'ZM', 'MARA', 'RIOT', 'MSTR', 'APP', 'CELH', 'ENPH', 'FSLR', 'SPOT', 'ABNB', 'DKNG', 'TTD', 'CRWV', 'IONQ', 'OKLO', 'VRT', 'ARKK', 'KRE', 'XBI', 'USO', 'SLV', 'HYG', 'EEM', 'FXI', 'KWEB']
// a scan's rows (fixture names, fixture numbers)
const SCAN_ROWS = ['RKLB', 'ASTS', 'SOFI', 'HOOD', 'PLTR', 'IONQ', 'OKLO', 'VRT'].map((t, i) => ({ ticker: t, company: `${t} (fixture)`, price: 20 + i * 7, chg_pct_1d: 9 - i, gap_pct: 8 - i * 0.5 }))
// the reads a LOOKUP makes (stock data, news, catalysts, breadth, the data gateway, a scan, research): what a data question
// must do. Context refreshes (alerts, lists, layouts…) differ by interpreter path and are never counted.
const DATA_READS = /^\/api\/(screener\/scan|earnings-intel|fundamentals-full|research|news|catalysts|agent\/(breadth|data|session-stats)|calendar|economic|cot|rs-|market-)/

export function createServer({ responder, known = [] }) {
  const st = { turns: [], calls: [], dataPaths: [], requests: [], responder, known: new Set(known.map(s => String(s).toUpperCase())) }
  const table = [...TICKERS.map(([ticker, name]) => ({ ticker, name })), ...EXTRA.map(ticker => ({ ticker, name: '' }))]
  const search = (raw) => {
    const q = String(raw || '').trim()
    if (!q) return []
    const up = q.toUpperCase(), low = q.toLowerCase()
    const all = [...table, ...[...st.known].filter(t => !table.some(r => r.ticker === t)).map(ticker => ({ ticker, name: '' }))]
    return [...all.filter(r => r.ticker === up), ...all.filter(r => r.ticker !== up && r.ticker.startsWith(up)),
      ...all.filter(r => r.ticker !== up && !r.ticker.startsWith(up) && r.name.toLowerCase().includes(low))].slice(0, 20)
  }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const p = u.split('?')[0]
    const method = (init.method || 'GET').toUpperCase()
    let body = null
    try { body = init.body ? JSON.parse(init.body) : null } catch { body = null }
    st.calls.push([method, u])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (p === '/api/agent/config') return json(SERVER_CONFIG)
    if (p === '/api/agent/turn' || p === '/api/agent/turn/stream') {
      // routers/uct_agent.py _admitted_turn: the history is the stored turns BEFORE this message is stored
      let history = st.turns.map(t => ({ role: t.role, text: t.text, data: t.data }))
      const last = history[history.length - 1]
      if (body.reroute && last && last.role === 'member' && last.text === body.message) history = history.slice(0, -1)
      else if (body.repair != null && body.reroute && history.slice(-2).some(t => t.role === 'member' && t.text === body.message)) { /* the member typed it once */ }
      else st.turns.push({ role: 'member', text: body.message, data: { voice: !!body.voice } })
      const r = await st.responder({ body, history, turn: st.turn, step: st.step, host: st.host })
      st.requests.push({ key: r.key, miss: !!r.miss, row: r.row || null, envelope: r.envelope || null, repair: body.repair != null, reroute: !!body.reroute })
      if (r.status && !r.envelope) {
        if (body.repair == null) st.turns.push({ role: 'outcome', text: 'UCT Agent was unavailable for this message.', data: { kind: 'error' } })
        return json({ detail: r.detail }, r.status)
      }
      const env = r.envelope
      if (!env.need_groups && body.repair == null) st.turns.push({ role: 'agent', text: env.reply || env.question?.text || '', data: { envelope: env, citations: [] } })
      const out = { conversationId: 'ac_e2e', turnId: null, envelope: env, usage: r.usage }
      if (p.endsWith('/stream')) return new Response(`data: ${JSON.stringify({ t: 'final', ...out })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      return json(out)
    }
    if (p === '/api/agent/record') {
      if (body?.member) st.turns.push({ role: 'member', text: body.member, data: { local: true } })
      if (body?.outcome) st.turns.push({ role: 'outcome', text: body.outcome, data: body.outcomeData || null })
      return json({ conversationId: 'ac_e2e' })
    }
    const q = /ticker-search\?q=([^&]+)/.exec(u)
    if (q) return json({ results: search(decodeURIComponent(q[1])) })
    if (p.startsWith('/api/live-prices')) return json({})
    if (p === '/api/auth/preferences') return json({ tracings_doc: JSON.stringify({ updatedAt: 1, doc: drawingsStore.exportTracings() }) })
    if (p.startsWith('/api/user-definitions')) return json({ definitions: [] })
    if (u === '/api/screener/fields') return json({ fields: SCR.fields })
    if (u === '/api/screener/fields?options=1') return json({ options: SCR.options })
    if (p === '/api/screener/saved-screens') return json({ saved: [], starters: SCR.starters })
    if (p.startsWith('/api/agent/conversations')) return json({ conversations: [] })
    if (DATA_READS.test(p)) st.dataPaths.push(`${method} ${p}`)
    if (p === '/api/screener/scan') return json({ total: SCAN_ROWS.length, rows: SCAN_ROWS.slice(0, body?.page_size || 50), snapshot_date: '2026-11-20', snapshot: { live: { state: 'closed' } } })
    return json({})
  })
  return st
}

// ── the mount ───────────────────────────────────────────────────────────────────────────────────────────────
function resetAll() {
  cleanup()
  _simulateReload()
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
  try { sessionStorage.clear() } catch { /* */ }
  try { localStorage.clear() } catch { /* */ }
  _resetAuthoring(); _resetDraftPreview(); _resetProposedPlans(); _resetScreenerCache(); _resetAgentConfig()
  try { drawingsStore._reset() } catch { /* */ }
  tap.nl1 = null; tap.route = null; tap.committed = []
}

const busy = () => !!screen.queryByTestId('agent-typing')
const idle = () => waitFor(() => { if (busy()) throw new Error('busy') }, { timeout: 15000 })
const transcript = () => screen.getByTestId('agent-transcript')
const choiceButtons = () => [...transcript().querySelectorAll('button')].filter(b => !['Apply', 'Dismiss'].includes(b.textContent) && !b.closest('[data-testid=agent-proposal]') && !b.closest('[data-testid=agent-receipt]') && !b.dataset.testid)

/** Mount the real panel over a case's board. → { say, approve, snap, built, server } */
export async function mountCase({ spec, c, arm, responder, conflict = null }) {
  resetAll()
  const built = buildBoard(spec, c.fx, { state: c.state || null, libExtra: c.libExtra || null, conflict })
  const known = Object.values(built.state.groupSyms)
  const server = createServer({ responder, known })
  server.host = built.host
  if (ARMS[arm].nl1) localStorage.setItem(NL1_KEY, '1')
  await loadAgentConfig()
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={built.host} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (text) => {
    await idle()
    const before = transcript().textContent
    // the buttons on screen BEFORE the turn, by element (the welcome screen's buttons leave with the first message, so a count
    // taken before would hide the turn's own choices)
    const choicesBefore = new Set(choiceButtons())
    const reqBefore = server.requests.length
    const dataBefore = server.dataPaths.length
    const t0 = performance.now()
    fireEvent.change(box, { target: { value: text } }); fireEvent.keyDown(box, { key: 'Enter' })
    await idle(); await new Promise(r => setTimeout(r, 0)); await idle()
    const all = transcript().textContent
    const at = all.lastIndexOf(text)
    const reply = at >= 0 ? all.slice(at + text.length) : all.slice(before.length)
    const requests = server.requests.slice(reqBefore)
    const card = screen.queryAllByTestId('agent-proposal').some(e => e.dataset.status === 'pending')
    return { reply, requests, card, data: server.dataPaths.slice(dataBefore), newChoices: choiceButtons().filter(b => !choicesBefore.has(b)).map(b => b.textContent), ms: performance.now() - t0 }
  }
  const approve = async () => {
    await idle()
    const card = screen.queryAllByTestId('agent-proposal').filter(e => e.dataset.status === 'pending').pop()
    if (!card) return ''
    const before = transcript().textContent.length
    fireEvent.click([...card.querySelectorAll('button')].find(b => b.textContent === 'Apply'))
    await idle(); await new Promise(r => setTimeout(r, 0)); await idle()
    return transcript().textContent.slice(before)
  }
  // click one of the choices UCT just offered (a member answering its question)
  const choose = async (label) => {
    await idle()
    const b = choiceButtons().reverse().find(x => x.textContent === label)
    if (!b) return { card: false }
    fireEvent.click(b)
    await idle(); await new Promise(r => setTimeout(r, 0)); await idle()
    return { card: screen.queryAllByTestId('agent-proposal').some(e => e.dataset.status === 'pending') }
  }
  return { say, approve, choose, snap: () => snapshot(built), built, server, setNl1: (on) => (on ? localStorage.setItem(NL1_KEY, '1') : localStorage.removeItem(NL1_KEY)) }
}

// ── the dialogue ────────────────────────────────────────────────────────────────────────────────────────────
/** A case as the dialogue's steps: [{ say, expect, branch? }]. A bench `pending` answer is asked for real first. */
export function stepsOf(c) {
  if (Array.isArray(c.turns)) return c.turns
  if (c.pending) return [{ say: c.pending.request, expect: { kind: 'clarify', choicesInclude: c.pending.choices }, synthetic: true }, { say: c.text, expect: c.expect }]
  return [{ say: c.text, expect: c.expect }]
}
/** The step a branch takes after the previous turn's outcome. */
export function branchStep(step, prev) {
  if (!step?.branch) return step
  const b = step.branch
  const o = prev?.outcome
  if (o === 'success') return b.success || b.fail
  if ((o === 'unnecessary_ask' || prev?.asked) && b.ask) return b.ask
  if (o === 'wrong_chart' && b.wrongChart) return b.wrongChart
  return b.fail || b.success
}

/**
 * Run `steps[0..upTo)` of a case on a fresh mount with `responder`, following each step's branch by the outcome the
 * scorer gave it (`decided[i]`, from the scored run). Returns the mount and each turn's raw record. A MISS stops the run.
 */
export async function replay({ spec, c, arm, responder, conflict, steps, upTo, decided = [] }) {
  const m = await mountCase({ spec, c, arm, responder, conflict })
  const start = m.snap()
  const turns = []
  for (let i = 0; i < upTo; i++) {
    const step = branchStep(steps[i], decided[i - 1])
    const pre = m.snap()
    m.server.turn = i; m.server.step = step
    const committedBefore = (tap.committed || []).length
    const r = await m.say(step.say)
    if (r.requests.some(q => q.miss)) return { m, start, turns, missAt: i }
    const mid = m.snap()
    let approved = ''
    if (r.card && ['act', 'propose'].includes(step.expect?.kind)) approved = await m.approve()
    // the EXECUTED plan: what the runtime committed in this turn (a repair REPLACES the first plan; approvals included)
    const commits = (tap.committed || []).slice(committedBefore)
    turns.push({ step, pre, mid, post: m.snap(), ...r, approved, executed: commits.filter(x => x.ok).flatMap(x => x.ops), failedCommits: commits.filter(x => !x.ok).flatMap(x => x.ops) })
  }
  return { m, start, turns, missAt: null }
}
