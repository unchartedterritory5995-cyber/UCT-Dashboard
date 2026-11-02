// agent-qa — MODEL ISOLATION, browser side: raw breadth / ratings values never reach a model request.
//
// Owner rule: "Do not consider gateway-only refusal sufficient proof." The gateway trusts a client-asserted
// purpose, so a capability can always ask for an isolated kind with purpose 'answer'. What must then hold is that
// nothing the browser SENDS toward the model carries the values. Railed here:
//   (1) TODAY'S EXPOSURE IS NIL, and stays so: no non-test module calls readData with an isolated kind unless every
//       capability it registers is `localOnly` AND named in the server's turn.LOCAL_ONLY_ACTIONS (F-10: those two
//       were joined by nothing), and nothing but agentClient.js names the /api/agent/data route.
//       The isolated kinds and local-only names come from the server, via the generated handshake
//       __fixtures__/program/isolation.json (tests/test_uct_agent_qa_isolation.py keeps it current).
//   (2) END TO END through the REAL panel: a local-only capability reads an isolated kind (fake server, sentinel
//       values), the member sees the values, then sends another message. Every /api/agent/turn body (context,
//       conversation_memory, pending, everything), every /api/agent/record telemetry, and the trace store must be
//       free of them; the record row must say LOCAL (the server's history door keys on it — railed server-side).
//       A CONTROL capability that is NOT local-only must be caught leaking, or the detector proves nothing.
// The record row's outcome text DOES carry the values: the member's own history keeps them, and the server never
// replays a local row to a model (tests/test_uct_agent_qa_isolation.py). That is the boundary: never replayed,
// not never stored.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import handshake from '../__fixtures__/program/isolation.json'
import { loadFixture } from '../__fixtures__/program'
import { registerBuiltins } from '../builtins'
import { registerCapability } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { loadAgentConfig, _resetAgentConfig } from '../agentClient'
import { loadBreadthDates, _resetBreadthDates } from '../capabilities/breadth'
import { makeBoard } from '../__fixtures__/board'
import { leaksOf, SENT_NUM, SENT_INT, SENT_STR } from './sentinels'

vi.mock('../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from '../AgentPanel'

const SRC = path.resolve(__dirname, '../..')
const ISOLATED = new Set(handshake.isolated_kinds)
const LOCAL_ONLY = new Set(handshake.local_only_actions)
const parse = (src) => Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach(n => walk(n, visit)); return }
  if (typeof node.type === 'string') visit(node)
  for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') walk(v, visit)
}
const resolves = (from, spec, rel) => spec.startsWith('.') && ['', '.js', '.jsx'].some(x =>
  path.normalize(path.resolve(path.dirname(from), spec) + x) === path.normalize(path.join(SRC, rel)))

/** Violations of rule (1) in one module, as `file:line  why`. */
export function isolationViolations(src, file) {
  const ast = parse(src)
  const rel = path.relative(SRC, file).split(path.sep).join('/')
  const out = []
  const rd = new Set(); const ns = new Set()
  for (const st of ast.body) {
    if (st.type !== 'ImportDeclaration' || !resolves(file, st.source.value, 'agent/marketdata/client.js')) continue
    for (const s of st.specifiers) {
      if (s.type === 'ImportSpecifier' && s.imported.name === 'readData') rd.add(s.local.name)
      if (s.type === 'ImportNamespaceSpecifier') ns.add(s.local.name)
    }
  }
  walk(ast, (n) => {                                   // the route string anywhere outside the one client
    const strs = n.type === 'Literal' && typeof n.value === 'string' ? [n.value]
      : n.type === 'TemplateLiteral' ? n.quasis.map(q => q.value.cooked || '') : []
    if (strs.some(s => s.includes('/api/agent/data')) && rel !== 'agent/agentClient.js') out.push(`${rel}:${n.loc.start.line}  names /api/agent/data directly`)
  })
  if (!rd.size && !ns.size) return out
  const isRd = (c) => (c.type === 'Identifier' && rd.has(c.name))
    || (c.type === 'MemberExpression' && c.object.type === 'Identifier' && ns.has(c.object.name) && c.property.name === 'readData')
  let readsIsolated = false
  walk(ast, (n) => {
    if (n.type !== 'CallExpression' || !isRd(n.callee)) return
    const k = n.arguments[0]
    if (!k || k.type !== 'Literal' || typeof k.value !== 'string') { out.push(`${rel}:${n.loc.start.line}  readData kind is not a string literal: isolation cannot be checked`); return }
    if (ISOLATED.has(k.value)) readsIsolated = true
  })
  if (!readsIsolated) return out
  // the module reads an isolated kind: EVERY capability it registers must be local-only on both sides
  walk(ast, (n) => {
    if (n.type !== 'CallExpression' || n.callee.name !== 'registerCapability' || n.arguments[0]?.type !== 'ObjectExpression') return
    const props = Object.fromEntries(n.arguments[0].properties.filter(p => p.type === 'Property' && !p.computed).map(p => [p.key.name || p.key.value, p.value]))
    const name = props.name?.type === 'Literal' ? props.name.value : '<computed>'
    if (!(props.localOnly?.type === 'Literal' && props.localOnly.value === true)) out.push(`${rel}:${n.loc.start.line}  ${name} reads an isolated kind's module but is not localOnly: true`)
    if (!LOCAL_ONLY.has(name)) out.push(`${rel}:${n.loc.start.line}  ${name} is not in the server's turn.LOCAL_ONLY_ACTIONS (F-10)`)
  })
  return out
}

function sourceFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!['node_modules', '__fixtures__', 'testing'].includes(e.name)) sourceFiles(p, acc) }
    else if (/\.(js|jsx|mjs)$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name)) acc.push(p)
  }
  return acc
}

describe('agent-qa model isolation (1): exposure is nil and stays guarded', () => {
  it('the handshake names the owner\'s isolated kinds (non-vacuity)', () => {
    expect([...ISOLATED]).toEqual(expect.arrayContaining(['breadth.current', 'ratings']))
    expect([...LOCAL_ONLY].length).toBeGreaterThan(0)
  })

  it('no module reads an isolated kind outside a local-only capability, and only agentClient.js names /api/agent/data', () => {
    const files = sourceFiles(SRC)
    expect(files.length).toBeGreaterThan(500)
    const bad = files.flatMap(f => isolationViolations(fs.readFileSync(f, 'utf8'), f))
    expect(bad, bad.join('\n')).toEqual([])
  })

  const CAP = path.join(SRC, 'agent', 'capabilities', 'qaVirtual.js')
  const head = "import { readData } from '../marketdata/client'\nimport { registerCapability } from '../capabilities'\n"
  it.each([
    ['a non-local capability reading ratings', `${head}registerCapability({ name: 'breadth.show', answer: () => readData('ratings', {}, {}) })`],
    ['a local capability the server does not know (F-10)', `${head}registerCapability({ name: 'ratings.show', localOnly: true, answer: () => readData('ratings', {}, {}) })`],
    ['a computed kind', `${head}const k = 'ratings'\nregisterCapability({ name: 'breadth.show', localOnly: true, answer: () => readData(k, {}, {}) })`],
    ['a direct fetch of the data route', "export const f = () => fetch('/api/agent/data', { method: 'POST' })"],
    ['a template-literal route', "export const f = (k) => fetch(`/api/agent/data?k=${k}`)"],
  ])('REFUSES %s', (_, src) => { expect(isolationViolations(src, CAP).length).toBeGreaterThan(0) })
  it.each([
    ['a local, server-listed capability reading breadth', `${head}registerCapability({ name: 'breadth.show', localOnly: true, answer: () => readData('breadth.current', {}, {}) })`],
    ['a non-isolated kind', `${head}registerCapability({ name: 'screener.run', answer: () => readData('screen.run', {}, {}) })`],
  ])('ACCEPTS %s', (_, src) => { expect(isolationViolations(src, CAP)).toEqual([]) })
})

// ── (2) end to end ──────────────────────────────────────────────────────────────────────────────────
// token-aware sentinels (./sentinels.js): a timing such as trace.js `t0` can no longer read as a leak
const leaks = (o) => leaksOf(o)
const RATINGS = (() => {
  const e = loadFixture('ratings')                                // the program fixture, values replaced by sentinels
  e.data = { ratings: [{ symbol: 'NVDA', rating: Number(SENT_NUM), percentile: Number(SENT_INT), label: SENT_STR }], missing: [] }
  return e
})()

registerBuiltins()
const answerFrom = (opts) => async () => {
  const env = await readData('ratings', { symbols: ['NVDA'] }, { purpose: 'answer', turnId: currentTurnId() })
  const r = env?.data?.ratings?.[0]
  return { text: `NVDA rating ${r?.rating} (percentile ${r?.percentile}) ${r?.label}`, title: opts.title,
    table: { columns: [{ key: 'symbol', label: 'Symbol' }, { key: 'rating', label: 'Rating' }], rows: [{ symbol: 'NVDA', rating: String(r?.rating) }] } }
}
registerCapability({ name: 'qa.isolatedShow', surfaces: ['charts'], target: 'breadth', query: true, localOnly: true,
  summary: 'agent-qa test capability: a local-only reader of an isolated kind.', args: { type: 'object', properties: {}, additionalProperties: false },
  answer: answerFrom({ title: `Ratings ${SENT_STR}` }) })
registerCapability({ name: 'qa.leakyShow', surfaces: ['charts'], target: 'breadth', query: true,
  summary: 'agent-qa CONTROL: the same reader WITHOUT localOnly, title carrying a value.', args: { type: 'object', properties: {}, additionalProperties: false },
  answer: answerFrom({ title: `Ratings ${SENT_STR}` }) })

let envelopes, turnBodies, records, dataBodies
beforeEach(async () => {
  envelopes = []; turnBodies = []; records = []; dataBodies = []
  _resetBreadthDates(); _resetAgentConfig()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    const body = init.body ? JSON.parse(init.body) : null
    if (url === '/api/agent/config') return json({ stream: false, nl1: false, data: true, scan: false })
    if (url === '/api/agent/turn') { turnBodies.push(body); const e = envelopes.shift(); return json({ conversationId: 'c1', envelope: typeof e === 'function' ? e(body) : e, usage: {} }) }
    if (url === '/api/agent/record') { records.push(body); return json({ conversationId: 'c1' }) }
    if (url === '/api/agent/data') { dataBodies.push(body); return json(RATINGS) }
    if (url === '/api/agent/breadth/dates') return json({ today_et: '2026-10-11', latest_finalized: { us: '2026-10-09' } })
    if (String(url).startsWith('/api/live-prices')) return json({})
    if (String(url).startsWith('/api/research/compare/')) return json({ a: { fundamentals: {}, ratings: { composite: Number(SENT_NUM) } },
      b: { fundamentals: {}, ratings: { composite: Number(SENT_INT) } } })
    return json({ conversations: [] })
  })
  await loadAgentConfig()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const plan = (ops) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null, ops })
const answer = { disposition: 'answer', reply: 'Noted.', question: null, unsupported_category: null, ops: [] }
async function mount() {
  const board = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' })
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await waitFor(() => expect(box.disabled).toBe(false), { timeout: 6000 }); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  return { say }
}
async function showThenAsk(action) {
  const { say } = await mount()
  await loadBreadthDates()
  envelopes.push((b) => plan([{ action, target: b.context.breadth?.[0]?.ref, args: {} }]))
  await say('show me the composite rating for NVDA please')
  await screen.findByText(/NVDA rating 987\.654321/, {}, { timeout: 6000 })               // the MEMBER sees it
  await waitFor(() => expect(records.some(r => r.outcomeData?.kind === 'answered')).toBe(true), { timeout: 6000 })
  envelopes.push(answer)
  await say('thanks, and what else should I look at?')
  await waitFor(() => expect(turnBodies.length).toBe(2), { timeout: 6000 })
}

describe('agent-qa model isolation (2): end to end through the real panel', () => {
  it('F-12 FIXED (owner: display-only needs server isolation, which it lacks): stock.compare no longer shows the UCT composite anywhere', async () => {
    const { say } = await mount()
    envelopes.push((b) => plan([{ action: 'stock.compare', target: b.context.stockData?.[0]?.ref, args: { symbols: ['NVDA', 'AMD'] } }]))
    // (worded so the MODEL plans it: the obvious wording is a fast-path chart command)
    await say('roughly how would you weigh the fundamentals of nvda against amd, in your view?')
    await waitFor(() => expect(records.length).toBeGreaterThan(0), { timeout: 6000 })
    await screen.findByText(/NVDA vs AMD/, {}, { timeout: 6000 })
    await waitFor(() => expect(records.some(r => r.outcomeData?.kind === 'answered')).toBe(true), { timeout: 6000 })
    const row = records.find(r => r.outcomeData?.kind === 'answered')
    expect(leaks(row.outcome), 'outcome TEXT (replayed by the server for a non-local row)').toEqual([])
    expect(leaks(row.outcomeData.views), 'views: the rating is no longer shown at all').toEqual([])
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u).startsWith('/api/research/compare/')),
      'CONTROL: the compare payload that carries the sentinel composite WAS fetched').toBe(true)
    envelopes.push(answer)
    await say('and which one has the better margin?')
    await waitFor(() => expect(turnBodies.length).toBe(2), { timeout: 6000 })
    turnBodies.forEach((b, i) => expect(leaks(b), `turn body ${i + 1}`).toEqual([]))
  })

  it('a local-only reader of an isolated kind: values reach the member and NO model-bound payload', async () => {
    await showThenAsk('qa.isolatedShow')
    expect(dataBodies).toHaveLength(1)
    expect(dataBodies[0]).toMatchObject({ kind: 'ratings', purpose: 'answer' })
    expect(typeof dataBodies[0].turn_id).toBe('string')
    turnBodies.forEach((b, i) => expect(leaks(b), `turn body ${i + 1}`).toEqual([]))       // context, memory, pending, all
    const row = records.find(r => r.outcomeData?.kind === 'answered')
    expect(row.outcomeData).toMatchObject({ actions: ['qa.isolatedShow'], local: true })     // the server door keys on it
    records.forEach(r => expect(leaks(r.telemetry), 'telemetry').toEqual([]))
    const turns = globalThis.window.__uctAgentTurns()                                      // trace.js stores (functions)
    expect(turns.length, 'the trace store recorded the turns (non-vacuity)').toBeGreaterThan(0)
    expect(leaks(turns), 'trace turns').toEqual([])
    expect(leaks(globalThis.window.__uctAgentTrace()), 'apply traces').toEqual([])
  })

  it('CONTROL: the same reader WITHOUT localOnly is caught leaking (the detector can fail)', async () => {
    await showThenAsk('qa.leakyShow')
    expect(dataBodies).toHaveLength(1)                                                      // it really read the kind
    expect(turnBodies).toHaveLength(2)
    const row = records.find(r => r.outcomeData?.kind === 'answered')
    expect(row.outcomeData.local).toBeUndefined()                                           // not marked local
    expect(leaks(turnBodies[1]).length).toBeGreaterThan(0)                                  // its title rides in memory
  })
})
