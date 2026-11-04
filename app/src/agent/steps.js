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
import { manifestFor, refreshContext, buildContext, getCapability, normalizeArgs, MANIFEST_VERSION } from './capabilities'
import { UNDO_ACTION } from './capabilities/about'
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

/** A step's `as` alias, when the step names one: a CREATOR (watchlist.create …) → {alias, kind} (the alias then names
 *  the created target's short ref in later steps of the turn); a SCREENER producer → {alias, source: 'lastScreen'} (a
 *  later `{from: alias}` reads the screen it ran). Anything else → null. */
export function aliasOf(op) {
  const as = op?.args?.as
  if (as == null || as === '') return null
  const cap = getCapability(op.action)
  const c = cap?.creates?.(op.args || {})
  if (c?.alias) return { alias: String(c.alias), kind: c.kind || null }
  if (cap?.produces && /^screener\./.test(String(op.action))) return { alias: String(as), source: 'lastScreen' }
  return null
}

/** A done creator step's alias → the short ref its `added` reported (the first of the created kind). */
export function bindAlias(turn, al, added) {
  if (!turn || !al?.alias || !al.kind || !Array.isArray(added)) return
  const hit = added.find(a => a.kind === al.kind) || null
  if (hit && turn.refMap[hit.ref]) turn.refMap[al.alias] = turn.refMap[hit.ref]
}

/** `{from: alias}` args naming an earlier step's screen → `{from: 'lastScreen'}` (the source the executor knows). */
export function withSources(op, sources) {
  if (!sources || !Object.keys(sources).length || !op?.args) return op
  let changed = false
  const args = {}
  for (const [k, v] of Object.entries(op.args)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.from === 'string' && sources[v.from]) {
      args[k] = { ...v, from: sources[v.from] }
      changed = true
    } else args[k] = v
  }
  return changed ? { ...op, args } : op
}

// ⭐ v2-readiness-2 (review #768: v2 ANSWERED an Undo honestly but never ran one). agent.undo is a query-shaped manifest
// entry that nothing may answer for (its `answer` says "Nothing was undone."): v1 intercepts the op in useAgent and runs
// the receipt's own Undo. A v2 step does the same here — doUndo / undoTurn with every refusal they have (protected
// layout, another board, changed since, the `about` check) — and only THEIR outcome rows say what happened:
//   • first change-step of the turn (nothing of this turn ran yet) → the member's newest change (scope last) or the
//     whole previous request (scope all), exactly as v1's "agent.undo alone / first";
//   • after change-steps of THIS turn ("switch to weekly, then undo that") → only what this turn committed: its newest
//     Undo entry (last) or all of them newest first (all); nothing committed → nothing is undone (said), never an older
//     change of an earlier request (v1's UNDO_AFTER_NOTHING rule).
export const UNDO_AFTER_NOTHING_V2 = 'I didn’t undo anything: the steps before the Undo didn’t make a change I could take back, so nothing was undone.'
const UNDO_DONE = new Set(['undo'])
const UNDO_REFUSED = new Set(['undo-none', 'undo-refused', 'undo-refused-mismatch', 'undo-refused-protected'])

/** The step_result of a v2 agent.undo step, from the outcome rows doUndo / undoTurn recorded. */
export function undoOutcomeOf(bodies) {
  const rows = (bodies || []).filter(b => /^undo/.test(String(b?.outcomeData?.kind || '')))
  if (!rows.length) return { status: 'refused', refusal: 'nothing was undone' }
  const turn = rows.find(b => b.outcomeData.kind === 'undo-turn')
  if (turn) {
    const { done = 0, of = 0 } = turn.outcomeData
    return done > 0 && done === of ? { status: 'done', receipt: String(turn.outcome || '') }
      : { status: done > 0 ? 'failed' : 'refused', refusal: String(turn.outcome || 'nothing was undone') }
  }
  const undone = rows.filter(b => UNDO_DONE.has(b.outcomeData.kind))
  const stop = rows.find(b => !UNDO_DONE.has(b.outcomeData.kind))
  if (undone.length && !stop) return { status: 'done', receipt: undone.map(b => String(b.outcome || '')).join(' · ') }
  if (undone.length) return { status: 'failed', refusal: `undid ${undone.length}, then stopped: ${String(stop.outcome || '')}` }
  return { status: UNDO_REFUSED.has(stop?.outcomeData?.kind) ? 'refused' : 'failed', refusal: String(stop?.outcome || 'nothing was undone') }
}

// ⭐ v2-readiness-2: a REF CARRIED IN ARGS (a capability's `argRefs`: indicatorAlert.create `chart` once #771 lands — the
// chart a chart-scoped alert is for —, chartSetup.saveTemplate `chart`, screener `within`, …). v1 and v2 translate them the
// same way (useAgent translateRefs → argRefsBack over the turn's refMap, which in v2 also holds the refs earlier steps
// created and their `as` aliases). In v2 the model can only correct what it is told, so a short ref the turn never offered
// (or one of the wrong kind) is refused HERE with the arg's name — before any capability reads a raw short ref as a real
// one — instead of a capability-specific sentence. Values that are not short refs pass through untouched.
const SHORT_REF = /^[a-z]{1,3}\d{1,3}$/
export function argRefProblem(op, refMap) {
  const decl = getCapability(op?.action)?.argRefs
  if (!decl || !op?.args || typeof op.args !== 'object') return null
  for (const [arg, kind] of Object.entries(decl)) {
    const kinds = [].concat(kind)
    for (const v of [].concat(op.args[arg] ?? [])) {
      if (typeof v !== 'string' || !SHORT_REF.test(v)) continue
      const hit = refMap?.[v]
      if (!hit) return `${arg} "${v}" is not a ref on this board: use a ${kinds.join(' / ')} ref from <workspace_context> (or one an earlier step of this turn reported)`
      if (!kinds.includes(hit.kind)) return `${arg} "${v}" is a ${hit.kind} ref; ${arg} needs a ${kinds.join(' / ')} ref from <workspace_context>`
    }
  }
  return null
}

/** review #775 (3): the turn a resumed card continues when the runner no longer holds it — its Undo baseline is the
 *  stack AS IT WAS when the turn started (carried on the paused card), so a later agent.undo step of this turn can only
 *  ever reach this turn's own changes. With no carried baseline, the stack as it is NOW minus the card's own change
 *  (the newest entry, just committed by the approval) — never "everything is this turn's". */
export function resumedTurn(p, deps) {
  const stack = (deps?.undoRef?.current || []).map(e => e.id)
  const undoBefore = Array.isArray(p?.undoBefore) ? [...p.undoBefore] : stack.slice(0, Math.max(0, stack.length - 1))
  return { turnId: p?.turnId ?? null, refMap: {}, sources: {}, voice: false, chain: Promise.resolve(),
    changeSteps: Math.max(1, Number(p?.changeSteps) || 0), undoBefore }
}

export function createStepRunner() {
  let paused = null              // { turnId, id, memoryTurn, alias } while a card waits
  let active = null              // the turn being served: { turnId, refMap, sources, voice, chain }

  async function runUndoStep(ev, deps) {
    const { tapRef, push } = deps
    const u = normalizeArgs(UNDO_ACTION, ev.args && typeof ev.args === 'object' ? ev.args : {}).args || {}
    const about = typeof u.about === 'string' ? u.about : null
    const opts = { member: null, voice: active.voice, about }
    tapRef.current = []
    try {
      if (active.changeSteps > 0) {
        const before = active.undoBefore || []
        const fresh = (deps.undoRef?.current || []).filter(e => !before.includes(e.id))
        if (!fresh.length) {
          push?.({ role: 'agent', text: UNDO_AFTER_NOTHING_V2 })
          return { status: 'refused', refusal: 'the earlier steps of this turn made no change that can be undone; nothing was undone' }
        }
        const ids = u.scope === 'all' ? [...fresh].reverse().map(e => e.id) : [fresh[fresh.length - 1].id]
        for (const id of ids) { if (!(await deps.doUndo(id, opts))) break }
      } else if (u.scope === 'all') {
        await deps.undoTurn({ member: null, voice: active.voice })
      } else {
        await deps.doUndo(null, opts)
      }
      return undoOutcomeOf(tapRef.current)
    } catch (e) {
      return { status: 'failed', refusal: `the Undo did not complete: ${e?.message || 'error'}` }
    } finally {
      tapRef.current = null
    }
  }

  async function runStep(ev, deps) {
    if (ev.action === UNDO_ACTION && typeof deps.doUndo === 'function') {
      const res = await runUndoStep(ev, deps)
      await agentStepResult({ turnId: ev.turnId, id: ev.id, ...res })
      return
    }
    await runGroup([ev], deps)
  }

  // ⭐ V2-G2: the steps of ONE plan group (consecutive ordinary changes of one model response, turn_v2._send_group) run as
  // ONE execute — one plan, one decideMode, one commit, one receipt, one Undo — exactly like one v1 envelope's ops (new
  // widgets placed together with a re-tile of the board: "put four charts on my screen"). A group of one is the ordinary
  // single step. Every step gets the group's outcome; results go back in step order (the server reads them in order).
  async function runGroup(evs, deps) {
    const { host, execute, tapRef } = deps
    const out = new Map()
    const run = []
    for (const ev of evs) {
      if (!getCapability(ev.action)?.query) active.changeSteps += 1
      const op = withSources({ action: ev.action, target: ev.target, args: ev.args || {} }, active.sources)
      const argProblem = argRefProblem(op, active.refMap)
      if (argProblem) out.set(ev.id, { status: 'refused', refusal: argProblem })
      else run.push({ ev, op, al: aliasOf(op) })
    }
    if (run.length) {
      const ops = run.map(r => r.op)
      const bound = translateRefs(bindSourceRefs(ops, active.refMap, { host, message: '' }), active.refMap)
      const mode = run.some(r => r.ev.mode === 'propose') ? 'propose' : 'apply'
      tapRef.current = []
      let bodies
      try {
        await execute(bound, { path: 'model', mode, member: null, voice: active.voice })
      } catch (e) {
        bodies = [{ outcome: `That didn't work: ${e?.message || 'error'}`, outcomeData: { kind: 'failed', actions: ops.map(o => o.action) } }]
      } finally {
        bodies = bodies || tapRef.current
        tapRef.current = null
      }
      const set = deps.memoryRef?.current?.latestResults?.()
      const last = run[run.length - 1]
      const shown = set && set.source === last.op.action ? set.symbols : null
      const res = outcomeOf(bodies, bound[bound.length - 1] || last.op, shown)
      if (res.status === 'done') {
        // a step that CREATED targets (a new chart): the board's context is rebuilt and the new refs reported, so the
        // server lets the next step name them and the model learns them from the result
        const added = await newRefs(host, deps.capCtx, active.refMap)
        if (added.length) res.added = added
        for (const r of run) bindAlias(active, r.al, added)
      }
      for (const r of run) if (r.al?.source && (res.status === 'query' || res.status === 'done')) active.sources[r.al.alias] = r.al.source
      if (res.status === 'proposed') {
        // the card waits: whatever the member does about it (approve / dismiss) is recorded for afterCard
        const al = run.map(r => r.al).filter(x => x?.kind).pop() || null
        paused = { turnId: last.ev.turnId, id: last.ev.id, memoryTurn: deps.memoryRef?.current?.currentTurn?.() ?? null, alias: al,
          undoBefore: active.undoBefore, changeSteps: active.changeSteps }
        tapRef.current = []
      }
      run.forEach((r, i) => out.set(r.ev.id, i === 0 || !res.added ? res : { ...res, added: undefined }))
    }
    for (const ev of evs) await agentStepResult({ turnId: ev.turnId, id: ev.id, ...out.get(ev.id) })
  }

  function onEvent(deps) {
    const groups = new Map()
    return (ev) => {
      if (ev?.t !== 'step' || !active) return
      const g = ev.group
      if (g && Number(g.size) > 1) {
        // V2-G2: hold a group's steps until all of them have arrived (the server emits them back to back)
        const held = groups.get(g.id) || []
        held.push(ev)
        groups.set(g.id, held)
        if (held.length < Number(g.size)) return
        groups.delete(g.id)
        active.chain = active.chain.then(() => runGroup(held.sort((x, y) => x.group.index - y.group.index), deps)).catch(() => {})
        return
      }
      // steps arrive one at a time (the server waits for each result); a chain keeps them in order anyway
      active.chain = active.chain.then(() => runStep(ev, deps)).catch(() => {})
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
    /** The session-memory turn the paused card belongs to (useAgent re-opens it for the approval). */
    memoryTurn: () => paused?.memoryTurn ?? null,
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
      active = { turnId: null, refMap, sources: {}, voice, chain: Promise.resolve(), changeSteps: 0,
        undoBefore: (deps.undoRef?.current || []).map(e => e.id) }
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
      if (!active) active = resumedTurn(p, deps)
      active.chain = Promise.resolve()
      const added = status === 'done' ? await newRefs(deps.host, deps.capCtx, active.refMap) : []
      if (status === 'done') bindAlias(active, p.alias, added)      // the approved creator's alias names what it made
      const r = await agentResumeV2({ turnId: p.turnId, id: p.id, status, receipt: res.receipt || null, refusal: res.refusal || null,
        added: added.length ? added : null }, onEvent(deps))
      await finish(r, deps)
    },
  }
}
