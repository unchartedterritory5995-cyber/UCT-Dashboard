// PLANNER v2 — the browser STEP EXECUTOR (Wave 1 A-05; contract docs/agent/program/contracts/STEP-1.md).
//
// Served only when /api/agent/config says `planner: 'v2'` (UCT_AGENT_PLANNER=v2 on the server). The server runs
// the model's tool-use loop and streams one `step` event per tool call; THIS module maps each step to the
// ordinary executor — `execute([op], { path: 'model', mode })`: the same planOps → decideMode → commitPlan →
// receipt → Undo every model plan goes through — and POSTs what actually happened back as the step's result.
// Nothing executes from the final envelope (an `answer` with no ops): the steps were the turn.
//
//   step {id, action, target, args, mode}  →  execute  →  record body (applied | noop | answered | proposed |
//   refused | failed | …)  →  POST /api/agent/turn/step {turnId, id, status, receipt | refusal | result}
//
// APPROVAL: a `propose` step shows the ordinary card and the server PAUSES; "do it" / dismiss go through the
// existing approve / dismiss, then `afterCard` resumes the loop (POST /api/agent/turn/resume, a new stream)
// with the card's outcome. ONE UNDO GROUP PER TURN: the steps of a turn (across its pause) land in one session-
// memory turn (useAgent skips beginTurn for the "do it" that continues a paused turn), so "undo all of that"
// (undoTurn) reverts every applied step of the last v2 turn, newest first, through the existing group Undo.
// ISOLATION: a local-only / isolated result is never sent back as a value (`isolated: true`, result null) — the
// server strips again (L6). The v1 path is untouched: useAgent takes this module only when the config says so.
import { manifestFor, refreshContext, buildContext, getCapability, MANIFEST_VERSION } from './capabilities'
import { agentTurnV2, agentResumeV2, agentStepResult } from './agentClient'
import { bindSourceRefs } from './compose'
import { translateRefs, withModelRefs, BARE_ACK } from './useAgent'

const STEP_STATUS = {
  applied: 'done', noop: 'done', 'applied-unsaved': 'done', answered: 'query', proposed: 'proposed', failed: 'failed',
}

/** What the executor's record bodies say ONE step came to → the step_result the server reads. `shown` = the tickers
 *  the panel itself showed for this query (session memory's result set — never recorded for an isolated kind), so the
 *  model can name them in the next step instead of a composition the member would have to approve. */
export function outcomeOf(bodies, op, shown = null) {
  const relevant = (bodies || []).filter(b => b?.outcomeData?.kind)
  const last = relevant[relevant.length - 1]
  if (!last) return { status: 'refused', refusal: 'UCT asked the member something first; the step did not run' }
  const kind = String(last.outcomeData.kind)
  const text = String(last.outcome || '')
  const status = STEP_STATUS[kind] || 'refused'
  if (status === 'done') return { status, receipt: text }
  if (status === 'query') {
    const isolated = !!getCapability(op?.action)?.localOnly || last.outcomeData.local === true
    if (isolated) return { status, result: null, isolated: true }
    const syms = Array.isArray(shown) && shown.length ? ` Symbols shown, in order: ${shown.slice(0, 20).join(', ')}.` : ''
    return { status, result: text + syms }
  }
  if (status === 'proposed') return { status }
  return { status, refusal: text }
}

/** Targets the board has now that the turn's context did not (a chart a step created): each gets a FRESH short ref
 *  beyond the turn's numbering (a rebuilt context renumbers its own refs, so its ids are never reused), merged into
 *  `refMap` and returned as [{ref, kind, label}] for the server and the model. Keyed by (kind, real ref). */
export async function newRefs(host, capCtx, refMap) {
  let built
  try { await refreshContext(1500); built = buildContext(host, { ...capCtx, message: '' }) } catch { return [] }
  const known = new Set(Object.values(refMap).map(v => `${v.kind}:${v.ref}`))
  const labels = {}
  for (const section of Object.values(built.context || {})) {
    if (!Array.isArray(section)) continue
    for (const e of section) if (e && typeof e.ref === 'string') labels[e.ref] = e.label || e.name || ''
  }
  const next = (prefix) => {
    let n = 0
    for (const k of Object.keys(refMap)) { const m = /^([a-z]+)(\d+)$/.exec(k); if (m && m[1] === prefix) n = Math.max(n, Number(m[2])) }
    return `${prefix}${n + 1}`
  }
  const added = []
  for (const [builtShort, v] of Object.entries(built.refMap)) {
    if (known.has(`${v.kind}:${v.ref}`)) continue
    const short = next(builtShort.replace(/\d+$/, ''))
    refMap[short] = v
    known.add(`${v.kind}:${v.ref}`)
    added.push({ ref: short, kind: v.kind, label: String(labels[builtShort] || '').slice(0, 60) })
  }
  return added
}

export function createStepRunner() {
  let paused = null              // { turnId, id } while a card waits
  let active = null              // the turn being served: { turnId, refMap, voice, chain }

  async function runStep(ev, deps) {
    const { host, execute, tapRef } = deps
    const op = { action: ev.action, target: ev.target, args: ev.args || {} }
    const bound = translateRefs(bindSourceRefs([op], active.refMap, { host, message: '' }), active.refMap)
    const mode = ev.mode === 'propose' ? 'propose' : 'apply'
    tapRef.current = []
    let bodies
    try {
      await execute(bound, { path: 'model', mode, member: null, voice: active.voice })
    } catch (e) {
      bodies = [{ outcome: `That didn't work: ${e?.message || 'error'}`, outcomeData: { kind: 'failed', actions: [op.action] } }]
    } finally {
      bodies = bodies || tapRef.current
      tapRef.current = null
    }
    const set = deps.memoryRef?.current?.latestResults?.()
    const shown = set && set.source === op.action ? set.symbols : null
    const res = outcomeOf(bodies, bound[0] || op, shown)
    if (res.status === 'done') {
      // a step that CREATED targets (a new chart): the board's context is rebuilt and the new refs reported, so the
      // server lets the next step name them and the model learns them from the result
      const added = await newRefs(host, deps.capCtx, active.refMap)
      if (added.length) res.added = added
    }
    if (res.status === 'proposed') {
      // the card waits: whatever the member does about it (approve / dismiss) is recorded for afterCard
      paused = { turnId: ev.turnId, id: ev.id }
      tapRef.current = []
    }
    await agentStepResult({ turnId: ev.turnId, id: ev.id, ...res })
  }

  function onEvent(deps) {
    return (ev) => {
      if (ev?.t === 'step' && active) {
        // steps arrive one at a time (the server waits for each result); a chain keeps them in order anyway
        active.chain = active.chain.then(() => runStep(ev, deps)).catch(() => {})
      }
    }
  }

  async function finish(res, deps) {
    const { push, conversationRef, setConversationId } = deps
    if (active) await active.chain
    if (!res.ok) { push({ role: 'error', text: res.error }); active = null; return }
    const data = res.data
    if (data.conversationId && data.conversationId !== conversationRef.current) setConversationId(data.conversationId)
    const env = data.envelope || {}
    if (env.paused === true) return                      // the card above waits; afterCard continues this turn
    active = null
    const reply = String(env.reply || '').trim()
    if (reply && !BARE_ACK.test(reply)) push({ role: 'agent', text: reply, sources: data.usage?.citations || [] })
  }

  return {
    paused: () => !!paused,
    /** One member message through the server's step loop. */
    async send({ text, voice, manageIndicators, pending }, deps) {
      const { host, capCtx, memoryRef, conversationRef, mark } = deps
      paused = null
      const full = manifestFor({ ...capCtx, manageIndicators })
      await refreshContext(1500)
      mark?.('context:refreshed')
      const { context, refMap } = buildContext(host, { ...capCtx, message: text })
      mark?.('context:built')
      const back = Object.fromEntries(Object.entries(refMap).map(([k, v]) => [v.ref, k]))
      const mem = memoryRef.current?.forModel?.()
      const body = {
        conversationId: conversationRef.current, message: text, voice,
        pending: pending ? { ops: pending.ops.map(o => ({ ...o, target: back[o.target] || o.target })) } : null,
        context: mem ? { ...context, conversation_memory: withModelRefs(mem, back) } : context,
        capabilities: full, manifestVersion: MANIFEST_VERSION, routing: null, planner: 'v2',
      }
      active = { turnId: null, refMap, voice, chain: Promise.resolve() }
      mark?.('turn:sent')
      const res = await agentTurnV2(body, onEvent(deps))
      mark?.('turn:received', res.ok ? 'ok' : res.status || 'error')
      await finish(res, deps)
    },
    /** The paused turn's card was applied or dismissed: resume the server's loop with its outcome. */
    async afterCard(deps) {
      const p = paused
      if (!p) return
      paused = null
      const bodies = deps.tapRef.current || []
      deps.tapRef.current = null
      const res = outcomeOf(bodies.length ? bodies : [{ outcome: 'the member dismissed the card', outcomeData: { kind: 'dismissed' } }], null)
      const status = res.status === 'done' ? 'done' : (res.status === 'failed' ? 'failed' : 'refused')
      if (!active) active = { turnId: p.turnId, refMap: {}, voice: false, chain: Promise.resolve() }
      active.chain = Promise.resolve()
      const added = status === 'done' ? await newRefs(deps.host, deps.capCtx, active.refMap) : []
      const r = await agentResumeV2({ turnId: p.turnId, id: p.id, status, receipt: res.receipt || null, refusal: res.refusal || null,
        added: added.length ? added : null }, onEvent(deps))
      await finish(r, deps)
    },
  }
}
