// ── v2-readiness-2 (Mission 3): PLANNER v1 vs v2 PARITY over the capability-regression corpus ───────────────────────
//
// The corpus (qa/capabilityRegression/baseline/corpus.json: 46 intents, 233 owner-style phrasings) replayed through the
// REAL panel twice, with no model and no paid call:
//   v1 — exactly the capability-regression level (c): the FAITHFUL scripted model answers the intent's canonical plan
//        only with the actions the production ROUTED request carried (testing/harness.jsx faithful()).
//   v2 — the same phrasing with the config saying planner 'v2': the deterministic layers run first exactly as in v1 (they
//        sit before the planner branch in useAgent), and a message that reaches the model is served by the scripted STEP-1
//        server (testing/stepServer.js) playing the canonical plan ONE STEP PER OP, each step's mode from the manifest
//        entry the way turn_v2 decides it (query → query, agent.undo → apply, confirm / irreversible → propose, else
//        apply) — FAITHFUL too: a canonical action that is not in the v2 request's manifest is never played.
// Both are judged by the SAME checkExpect (board, indicators, reads / writes, receipt / proposal / refusal structure).
//
// Default (CI): the first phrasing of every intent through v2 only, asserted to pass — the v2 parity RAIL (one panel run
// per intent). V2_PARITY=full runs every phrasing through v1 AND v2 and writes the table to V2_PARITY_OUT (JSON).
// Planner v2 stays OFF in production: only these tests' scripted config says 'v2'.
import { describe, it, expect, afterEach, afterAll, vi } from 'vitest'
import { waitFor, fireEvent, screen, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import { getCapability } from './capabilities'
import { registerCatalog, isDark } from './qa/capabilityRegression/testing/registry'
import { corpus, phrasingsOf, failureMode, gapIt } from './qa/capabilityRegression/testing/corpus'
import { mountCase, resolveOps, boardState, receiptsNow, refusals, panelHost } from './qa/capabilityRegression/testing/harness'
import { pinClock, CLOCK } from './qa/capabilityRegression/testing/clock'
import clockExpectations from './qa/capabilityRegression/baseline/clockExpectations.json'

pinClock()                   // the corpus's pinned instant (#783 testing/clock.js): the market clock never depends on when CI runs
import { replay, checkExpect } from './qa/capabilityRegression/testing/run'
import { routedNames } from './qa/capabilityRegression/testing/route'
import { groupOfAction } from './routing'
import { _resetAgentConfig, loadAgentConfig } from './agentClient'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
// PKG2: a DARK corpus entry ("kinds": "ALL") runs only in capabilityRegression/corpus.dark.test.jsx
const PROD_INTENTS = corpus.intents.filter(i => !isDark(i))
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const FULL = globalThis.process?.env?.V2_PARITY === 'full'
const OUT = globalThis.process?.env?.V2_PARITY_OUT || null
const rows = []

/** Known v2-ONLY gaps (the case passes on v1): each must fail in exactly its recorded way (corpus.js gapIt), so a fix
 *  turns it red until the marker is removed, and an unrelated break is never hidden. */
const V2_GAPS = {
  // V2-G1 ("Put four charts on my screen") is FIXED by V2-G2 plan groups (agent/w2/v2-nl-equivalence): the adds and the
  // re-tile come in one response and run as ONE plan, as v1 runs them. No v2-only gap is open.
  // V2-G3 (PKG2, planner v2 is dark): "put these in a new watchlist called Leaders" — v1 runs watchlist.create + watchlist.add
  // {from: lastScreen} into the new list's alias as ONE approved plan; v2 makes the guarded create its own card, then the
  // add (a later response targeting the alias `new1`) does not land in the created list: the list is created EMPTY.
  'scan.to-new-watchlist': { id: 'V2-G3', reason: 'v2: a create card then an add into its alias leaves the new list empty', owner: 'agent-core (planner v2)', mode: '→ Apply: T01 on Leaders' },
}

/** The CORPUS's own known gap (ph.gaps.c), honoured as the v1 capreg final-state test honours it (corpus.js gapIt): the
 *  case passes only when it fails in the RECORDED mode — any other failure (a harness crash, a different assertion) still
 *  fails loudly. One difference, on purpose: if v2 PASSES where v1's gap is recorded, that is reported (a console warning
 *  naming the gap) and NOT failed — a v1 gap v2 does not have is information for the gap's owner, not a v2 regression.
 *  The marker itself is owned by the corpus (v1); this rail never edits it. */
function corpusGapIt(gap) {
  if (!gap?.id || !gap.mode) throw new Error(`a corpus gap needs {id, mode}: ${JSON.stringify(gap)}`)
  const run = (title, fn, timeout) => it(title, async () => {
    let err = null
    try { await fn() } catch (e) { err = e }
    if (!err) {
      console.warn(`[v2 parity] corpus KNOWN GAP ${gap.id} does not reproduce on v2 (v2 reaches the expected state): ${title}`)
      return
    }
    if (!failureMode(err).includes(gap.mode)) throw new Error(`corpus KNOWN GAP ${gap.id} failed on v2 for an UNRELATED reason — expected the mode "${gap.mode}", got: ${String(err?.message ?? err).split('\n')[0]}`)
  }, timeout)
  return { run, tag: ` [corpus KNOWN GAP ${gap.id}]` }
}

/** turn_v2's mode for one step, from the manifest entry the v2 request carried (STEP-1 + v2-readiness-2 agent.undo). */
export function v2ModeOf(entry) {
  if (entry.name === 'agent.undo') return 'apply'
  if (entry.query) return 'query'
  if (entry.name !== 'indicator.saveDraft' && (entry.risk === 'confirm' || entry.reversible === false)) return 'propose'
  return 'apply'
}

/** The scripted v2 model for one canonical plan: one step per op, faithful to the v2 request's manifest. */
function v2Script(plan) {
  // V2-G2: the scripted model follows the v2 prompt — consecutive ordinary changes go in ONE response (one plan group,
  // run as one plan); a query, a guarded step (its own card) or the Undo is a response of its own
  const offered = (c) => new Map((c.body?.capabilities || []).map(e => [e.name, e]))
  const stepFor = (op, c) => {
    const entry = offered(c).get(op.action)
    if (!entry) return null
    const [r] = resolveOps([{ ...op, args: op.args || {} }], c.body)      // target AND "$ctx:" args, as the v1 replay resolves them
    return { action: op.action, target: r.target, args: r.args, mode: v2ModeOf(entry) }
  }
  const responses = []
  for (const op of plan.ops) {
    const lastR = responses[responses.length - 1]
    // (PKG2: a guarded op — its own card — is a response of its own here too, judged from the registry's contract)
    const groupable = (o) => o.action !== 'agent.undo' && v2ModeOf({ name: o.action, ...(getCapability(o.action) || {}) }) === 'apply'
    if (lastR && lastR.groupable && groupable(op)) lastR.ops.push(op)
    else responses.push({ ops: [op], groupable: groupable(op) })
  }
  const items = responses.map(r => (c) => {
    const steps = r.ops.map(op => stepFor(op, c))
    const missing = r.ops.filter((op, i) => !steps[i]).map(op => op.action)
    if (missing.length) return { reply: `«v2 was not offered ${missing.join(', ')}»` }
    // modes other than apply never share a group (turn_v2._plannable)
    if (steps.length > 1 && steps.every(st => st.mode === 'apply')) return { group: steps }
    if (steps.length === 1) return steps[0]
    throw new Error(`v2Script: a response mixing apply with ${steps.map(st => st.mode).join('/')} steps is not scripted (none in the corpus)`)
  })
  return [...items, { reply: '' }]
}

const turnCount = (p) => p.st.calls.filter(c => c[1] === '/api/agent/turn').length

/** run.jsx replay(), with the model turns served by the v2 step server. Returns { modelTurns } (v2 streams opened). */
async function replayV2({ board: boardName = 'ONE', steps, seed = {} }, label) {
  // keyed by the MEMBER'S MESSAGE: a step with no canonical plan (a prelude, a deterministic follow-up) that still reaches
  // the model gets a bare reply, never the next step's plan (the step server's script is consumed per stream)
  const plans = new Map(steps.filter(s => s.model).map(s => [s.say, v2Script(s.model)]))
  const queues = new Map()
  const dispatch = (c) => {
    const msg = c.body?.message
    if (!queues.has(msg) || queues.get(msg).done) queues.set(msg, { items: [...(plans.get(msg) || [{ reply: '' }])], done: false })
    const q = queues.get(msg)
    const item = q.items.shift()
    if (!q.items.length) q.done = true
    return typeof item === 'function' ? item(c) : item
  }
  const script = Array.from({ length: 64 }, () => dispatch)
  const m = mountCase(boardName, { seed, stepScript: script })
  // the catalog was registered under a v1 config (registerCatalog): re-read it from this case's server, which says v2
  _resetAgentConfig()
  await loadAgentConfig()
  const { p, board, say, srv } = m
  const start = boardState(board)
  for (const [i, s] of steps.entries()) {
    const before = boardState(board)
    const since = { calls: p.st.calls.length, turns: turnCount(p), receipts: receiptsNow().length, refusals: refusals().length }
    await say(s.say)
    await waitFor(() => { if (screen.queryByTestId('agent-typing') || srv.stream) throw new Error('busy') }, { timeout: 15000 })
    const ctx = { ...m, start, before, since }
    const l = `${label} · step ${i + 1} "${s.say}"`
    if (s.expect) {
      try { await waitFor(() => checkExpect(ctx, s.expect, l), { timeout: 6000 }) } catch (e) {
        if (globalThis.process?.env?.V2_PARITY_DEBUG) e.message += `
  v2 steps: ${JSON.stringify(srv.events.filter(x => x.t === 'step').map(x => [x.action, x.target, x.mode]))} results: ${JSON.stringify(srv.results.map(r => [r.status, (r.refusal || r.receipt || '').slice(0, 140)]))} streams: ${srv.bodies.length}`
        throw e
      }
    }
    if (s.approve) {
      const since2 = { ...since, calls: p.st.calls.length, receipts: receiptsNow().length }
      fireEvent.click(screen.getAllByRole('button', { name: 'Apply' }).at(-1))
      await m.p.idle()
      await waitFor(() => { if (screen.queryByTestId('agent-typing') || srv.stream) throw new Error('busy') }, { timeout: 15000 })
      if (s.afterApprove) await waitFor(() => checkExpect({ ...ctx, since: since2 }, s.afterApprove, `${l} → Apply`), { timeout: 6000 })
    }
  }
  return { modelTurns: srv.bodies.length, steps: srv.results.map(r => r.status) }
}

// baseline/clockExpectations.json: where the product legitimately answers differently at the pinned instant
// (testing/clock.js CAPREG_CLOCK), the same per-clock expectation the v1 final-state test uses (testing/finalState.jsx)
const stepsOf = (intent, ph) => {
  const byClock = clockExpectations.intents[intent.id]?.[CLOCK]?.expect
  return [...(intent.before || []), ...(ph.prelude || []).map(say => ({ say })),
    { say: ph.text, model: intent.model, expect: byClock || intent.expect, approve: byClock ? undefined : intent.approve, afterApprove: byClock ? undefined : intent.afterApprove }]
}

async function outcome(fn) {
  try { const r = await fn(); return { ok: true, ...(r || {}) } } catch (e) { return { ok: false, mode: failureMode(e).slice(0, 160) } }
}

/** Level (a): v1 = the production routed request carries every needed action (capability-regression rule); v2 = the
 *  v2 request's manifest (the whole catalog, ≤ turn_v2.MAX_CAPABILITIES_V2) carries it, so the action index lists it. */
function routing(intent, ph) {
  const host = panelHost(intent.board)
  const { names, overBudget } = routedNames(ph.text, { host, recentActions: intent.recentActions || [] })
  const v1 = intent.needs.every(a => names.includes(a) && !overBudget.includes(groupOfAction(a)))
  return { v1, needs: intent.needs }
}

describe('planner v2 parity — capability-regression corpus', () => {
  if (!FULL) {
    // the RAIL: the first phrasing of every intent reaches the same final state under v2
    for (const intent of PROD_INTENTS) {
      const ph = phrasingsOf(intent)[0]
      const body = async () => {
        await replayV2({ board: intent.board, seed: intent.seed, steps: stepsOf(intent, ph) }, `v2 ${intent.id}`)
      }
      // a v2-only gap first; else the CORPUS's own recorded final-state gap (ph.gaps.c — what the v1 capreg final-state
      // test honours through gapIt): v2 replays the same canonical plan, so it is expected to fail in the SAME recorded way
      const v2gap = V2_GAPS[intent.id]
      if (v2gap) {
        const { run, tag } = gapIt(v2gap)
        run(`v2 · ${intent.id} · "${ph.text}"${tag}`, body, 60000)
      } else if (ph.gaps?.c) {
        const { run, tag } = corpusGapIt(ph.gaps.c)
        run(`v2 · ${intent.id} · "${ph.text}"${tag}`, body, 60000)
      } else {
        it(`v2 · ${intent.id} · "${ph.text}"`, body, 60000)
      }
    }
    return
  }
  for (const intent of PROD_INTENTS) {
    for (const ph of phrasingsOf(intent)) {
      it(`${intent.id} · "${ph.text}"`, async () => {
        const r = routing(intent, ph)
        _resetAgentConfig()                              // the v1 case re-reads its own (v1) config
        const v1 = await outcome(() => replay({ board: intent.board, seed: intent.seed, steps: stepsOf(intent, ph) }, `v1 ${intent.id}`))
        cleanup()
        const v2 = await outcome(() => replayV2({ board: intent.board, seed: intent.seed, steps: stepsOf(intent, ph) }, `v2 ${intent.id}`))
        rows.push({ intent: intent.id, text: ph.text, gaps: Object.fromEntries(Object.entries(ph.gaps || {}).map(([k, g]) => [k, g.id])),
          ops: intent.model.ops.map(o => o.action), route_v1: r.v1, v1, v2 })
      }, 90000)
    }
  }
  afterAll(() => { if (OUT) fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), rows }, null, 1)) })
})
