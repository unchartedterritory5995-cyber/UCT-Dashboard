// ── UCT Agent CONVERSATION: TALK vs DO orchestration ─────────────────────────
//
// One hook owns the whole turn:
//
//   text ─► fastParse ──hit──► registry ops ─┐
//      └──miss──► POST /api/agent/turn ──────┤ envelope (answer | clarify | apply | propose | unsupported)
//                                            ▼
//          answer / clarify / unsupported ─► shown, NOTHING executes
//          apply / propose ─► planOps (validate ALL, compose) ─► policy.decideMode
//                 apply   ─► runtime.commitPlan (one write per target, read-back ACK) ─► receipt + Undo
//                 propose ─► stored proposal card ─► "Do it" re-plans the STORED ops against
//                            the current charts (never regenerates them) ─► commit
//
// The fast path and the model path meet at the same planner, so there is one
// execution path. Every real outcome (receipt, refusal, undo) is recorded to the
// conversation, so the model's next turn remembers what UCT DID.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fastParse, matchPosition } from './fastPath'
import { planOps, prepareOps, collectTargets } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { refsOf, checkRefs, consumedProducers, pendingLines, resolveRefs, expandOps, bindSourceRefs } from './compose'
import { traceStart, mark, traceEnd } from './trace'
import { buildContext, manifestFor, getCapability, getTargetKind, runWarmups } from './capabilities'
import { registerBuiltins } from './builtins'
import { agentTurn, agentRecord, agentConversation } from './agentClient'
import { AGENT_CONVERSATION_KEY, readLocal, writeLocal } from './agentFlag'

registerBuiltins()

const kindsOf = (ops) => [...new Set(ops.map(o => getCapability(o?.action)?.target).filter(Boolean))]
// Which board the host is showing (null for hosts without layouts).
const epochOf = (host) => (typeof host?.epoch === 'function' ? host.epoch() : null)
// A proposal is pinned to the board only if it touches something ON the board.
const boardEpoch = (host, ops) => (kindsOf(ops).some(k => getTargetKind(k)?.boardScoped !== false) ? epochOf(host) : null)

let _id = 0
const nid = () => `i${Date.now().toString(36)}${(_id++).toString(36)}`
const UNDO_MAX = 20

function refusalText(refusals) {
  const reasons = [...new Set(refusals.map(r => r.reason))]
  return reasons.length === 1
    ? `I didn't change anything: ${reasons[0]}`
    : `I didn't change anything:\n${reasons.map(r => `- ${r}`).join('\n')}`
}

export default function useAgent({ host, gridMode = false, surface = 'charts' }) {
  const capCtx = useMemo(() => ({ surface }), [surface])
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [conversationId, setConversationIdState] = useState(() => readLocal(AGENT_CONVERSATION_KEY))
  const conversationRef = useRef(conversationId)
  const pendingRef = useRef(null)           // { kind:'proposal', id, ops } | { kind:'target', ops, path }
  const undoRef = useRef([])                // newest last
  const [, force] = useState(0)
  const rerender = () => force(n => n + 1)

  const setConversationId = useCallback((id) => {
    conversationRef.current = id
    setConversationIdState(id)
    writeLocal(AGENT_CONVERSATION_KEY, id)
  }, [])

  const push = useCallback((item) => setItems(xs => [...xs, { id: nid(), ...item }]), [])
  const patchItem = useCallback((id, patch) => setItems(xs => xs.map(x => (x.id === id ? { ...x, ...patch } : x))), [])

  // Reopen the remembered conversation (transcript only; proposals and undo are per session).
  // ⭐ MERGED, never replaced: the composer stays usable while this loads, and a
  // message sent meanwhile (and its answer) must survive the history arriving —
  // replacing the transcript here is how a typed message "disappeared" after a reload.
  const [restoring, setRestoring] = useState(() => !!conversationRef.current)
  useEffect(() => {
    let alive = true
    const id = conversationRef.current
    if (!id) return undefined
    agentConversation(id).then((conv) => {
      if (!alive) return
      setRestoring(false)
      if (!conv) { setConversationId(null); return }
      const history = conv.turns.map(t => ({
        id: `h${t.id}`, role: t.role === 'member' ? 'member' : (t.role === 'outcome' ? 'outcome' : 'agent'),
        text: t.text, history: true,
      }))
      setItems(xs => [...history, ...xs.filter(x => !x.history)])
    }, () => { if (alive) setRestoring(false) })
    return () => { alive = false }
  }, [setConversationId])

  // Features warm their data (catalogs) once the Agent is open.
  useEffect(() => { runWarmups(host) }, [host])

  const record = useCallback(async (body) => {
    const res = await agentRecord({ conversationId: conversationRef.current, ...body })
    if (res.ok && res.data?.conversationId && res.data.conversationId !== conversationRef.current) {
      setConversationId(res.data.conversationId)
    }
  }, [setConversationId])

  // ── execution (shared by the fast path, the model path and approvals) ──
  const executeInner = useCallback(async (opsIn, { path, mode: suggested, member, voice }) => {
    let allOps = opsIn
    // ⛔ Another window/device may have changed this member's board (one shared,
    // last-write-wins preference): never write over it (host.boardInSync).
    const boardStillOurs = async (ops) => {
      if (!host?.boardInSync || boardEpoch(host, ops) == null) return true
      const s = await host.boardInSync()
      mark('board:synced', s.ok ? 'ok' : 'changed')
      if (s.ok) return true
      const text = `I didn't change anything: ${s.reason}. Reload this page to see the current board, then ask again.`
      push({ role: 'refusal', text })
      record({ member, outcome: text, outcomeData: { kind: 'refused-stale-board', actions: ops.map(o => o?.action) }, telemetry: { path, refused: true, voice } })
      return false
    }
    const refuse = (why) => {
      const text = `I didn't change anything: ${why}`
      push({ role: 'refusal', text })
      record({ member, outcome: text, outcomeData: { kind: 'refused', actions: opsIn.map(o => o?.action) }, telemetry: { path, refused: true, voice } })
    }
    // ── EXPANSION: a macro op with CONCRETE inputs (widget.addCharts with tickers)
    // becomes the ordinary ops it stands for, before anything is planned. One whose
    // input is still a reference expands at apply, once its symbols exist.
    let expansion = null
    {
      const x = expandOps(allOps)
      if (!x.ok) { refuse(`${x.reason}.`); return }
      if (x.expanded) { allOps = x.ops; expansion = x }
    }
    // ── COMPOSITION: an op fed by another op's RESULT (compose.js). Never applied
    // straight from a model turn — the result does not exist yet, so the member
    // approves the query + selection rule; at APPLY the producers run fresh, the
    // actual symbols replace the references, and the rest commits as usual.
    const composing = refsOf(allOps).length > 0
    let composed = null
    if (composing) {
      const bad = checkRefs(allOps, host)
      if (bad) { refuse(bad); return }
      if (suggested === 'approved') {
        if (!(await boardStillOurs(allOps))) return
        // The consumers are re-checked against the board AS IT IS NOW (capacity,
        // the target list) BEFORE any producer runs — a full workspace never runs
        // the screen it could not use.
        {
          const producersNow = consumedProducers(allOps)
          const rest = allOps.filter(o => !producersNow.includes(o) && !getCapability(o?.action)?.query)
          if (rest.length) {
            const gate = planOps(collectTargets(host, kindsOf(rest)), rest, await prepareOps(rest), capCtx)
            if (!gate.ok) {
              const text = refusalText(gate.refusals)
              push({ role: 'refusal', text })
              record({ member, outcome: text, outcomeData: { kind: 'refused', actions: rest.map(o => o.action) }, telemetry: { path, refused: true, voice } })
              return
            }
          }
        }
        mark('gate:capacity')
        const r = await resolveRefs(allOps, host)
        mark('sources:resolved')
        if (!r.ok) {
          const text = `I didn't change anything: ${r.reason}.`
          push({ role: 'refusal', text })
          record({ member, outcome: text, outcomeData: { kind: 'refused', actions: allOps.map(o => o.action) }, telemetry: { path, refused: true, voice } })
          return
        }
        if (r.empty) {
          const text = `${r.lines.join(' · ')}, so I didn't create or change anything.`
          push({ role: 'outcome', text })
          record({ member, outcome: text, outcomeData: { kind: 'noop', actions: allOps.map(o => o.action) }, telemetry: { path, disposition: 'apply', voice } })
          return
        }
        // The references are concrete now: macros fed by them expand here.
        const x = expandOps(r.ops)
        mark('expanded')
        if (!x.ok) { refuse(`${x.reason}.`); return }
        allOps = x.ops
        if (x.expanded) expansion = x
        composed = { lines: r.lines }
      }
    }
    const producers = composing && !composed ? consumedProducers(allOps) : []
    const targets = collectTargets(host, kindsOf(allOps))
    // QUERIES only read: answered from the target's own snapshot, never planned. A
    // plan that also changes something answers its queries and plans the rest. A
    // producer waiting to feed another op is not answered — it runs at apply.
    const queries = allOps.filter(o => getCapability(o?.action)?.query && !producers.includes(o))
    if (queries.length) {
      // An answer is a string, or { text, table, link } for structured results (rows
      // the feature returned — never written by the model). It may be async.
      const answers = []
      for (const o of queries) {
        let a
        try { a = await getCapability(o.action).answer(targets.get(o.target)?.snap || null, o.args || {}, host) } catch (e) { a = `That didn't work: ${e?.message || 'error'}` }
        answers.push(typeof a === 'string' || a == null ? { text: a || '' } : a)
      }
      for (const a of answers) push({ role: 'agent', text: a.text, table: a.table || null, link: a.link || null })
      const text = answers.map(a => a.text).join('\n\n')
      record({ member, outcome: text, outcomeData: { kind: 'answered', actions: queries.map(o => o.action) }, telemetry: { path, disposition: 'answer', actions: queries.map(o => o.action), voice } })
    }
    const ops = allOps.filter(o => !getCapability(o?.action)?.query)
    if (!ops.length) return
    const env = await prepareOps(ops)
    mark('prepared')
    const plan = planOps(targets, ops, env, capCtx)
    mark('planned')
    const actions = ops.map(o => o.action)
    if (!plan.ok) {
      const text = refusalText(plan.refusals)
      push({ role: 'refusal', text })
      record({ member, outcome: text, outcomeData: { kind: 'refused', actions }, telemetry: { path, refused: true, actions, voice } })
      return
    }
    if (composing && !composed) {
      const pid = nid()
      pendingRef.current = { kind: 'proposal', id: pid, ops: allOps, epoch: boardEpoch(host, allOps) }
      const lines = [...pendingLines(allOps, host), ...plan.lines]
      push({ id: pid, role: 'proposal', lines, status: 'pending' })
      record({ member, outcome: `Proposed: ${lines.join(' · ')}`, outcomeData: { kind: 'proposed', actions }, telemetry: { path, disposition: 'propose', actions, voice } })
      return
    }
    // Every op came from expansions → the member reads ONE line per request
    // ("Create 4 5-minute charts: SPY, QQQ, …"), not the per-chart steps.
    const wholly = expansion && ops.every(o => o.fromExpand != null)
    // An expansion is always proposed first (it creates several widgets at once).
    const mode = suggested === 'approved' ? 'apply' : (expansion ? 'propose' : decideMode(suggested, plan))
    // Any write to the board is preceded by the cross-session check (once per Apply).
    if (mode !== 'propose' && !composed && !(await boardStillOurs(ops))) return
    if (mode === 'propose') {
      const pid = nid()
      // The proposal keeps the UNEXPANDED request: Apply expands it again from scratch.
      const keep = expansion ? opsIn.filter(o => !getCapability(o?.action)?.query) : ops
      pendingRef.current = { kind: 'proposal', id: pid, ops: keep, epoch: boardEpoch(host, keep) }
      const plines = wholly ? expansion.proposal : (plan.lines.length ? plan.lines : plan.noops)
      push({ id: pid, role: 'proposal', lines: plines, status: 'pending' })
      record({ member, outcome: `Proposed: ${plines.join(' · ')}`, outcomeData: { kind: 'proposed', actions }, telemetry: { path, disposition: 'propose', actions, voice } })
      return
    }
    if (!plan.changed) {
      const text = plan.noops.length ? `Nothing to change — ${plan.noops.join(' · ')}.` : 'Nothing to change.'
      push({ role: 'outcome', text })
      record({ member, outcome: text, outcomeData: { kind: 'noop', actions }, telemetry: { path, disposition: 'apply', actions, voice } })
      return
    }
    mark('commit:start')
    const res = await commitPlan(host, plan, { env, ctx: capCtx })
    mark('commit:end')
    if (res.ok && wholly) {
      res.lines = expansion.lines
      if (res.undo) res.undo.lines = expansion.lines
    }
    if (res.undo) {
      undoRef.current = [...undoRef.current, res.undo].slice(-UNDO_MAX)
    }
    if (res.ok) {
      // A composed request says first what its producers actually returned.
      const lines = composed ? [...composed.lines, ...res.lines] : res.lines
      push({ role: 'receipt', lines, undoId: res.undo?.id || null, notes: wholly ? [] : plan.noops })
      record({ member, outcome: lines.join(' · '), outcomeData: { kind: 'applied', actions, lines }, telemetry: { path, disposition: 'apply', actions, voice } })
    } else {
      const text = `Some of that didn't take effect: ${res.failed.map(f => `${f.label} ${f.reason}`).join('; ')}.`
      if (res.lines.length) push({ role: 'receipt', lines: res.lines, undoId: res.undo?.id || null })
      push({ role: 'refusal', text })
      record({ member, outcome: [res.lines.join(' · '), text].filter(Boolean).join(' · '), outcomeData: { kind: 'failed', actions }, telemetry: { path, refused: true, actions, voice } })
    }
  }, [host, push, record, capCtx])

  // Every execution is traced (agent/trace.js): phase timestamps, memory only.
  const execute = useCallback(async (opsIn, { path, mode: suggested, member, voice }) => {
    traceStart(`${path}:${suggested || 'apply'}`)
    try {
      return await executeInner(opsIn, { path, mode: suggested, member, voice })
    } finally { traceEnd('done') }
  }, [executeInner])

  const doUndo = useCallback(async (undoId, { member, voice } = {}) => {
    const stack = undoRef.current
    const entry = undoId ? stack.find(e => e.id === undoId) : stack[stack.length - 1]
    if (!entry) {
      const text = 'There is nothing of mine to undo in this session.'
      push({ role: 'outcome', text })
      record({ member, outcome: text, outcomeData: { kind: 'undo-none' }, telemetry: { path: 'fast', undo: true, voice } })
      return
    }
    if (entry.epoch != null && host?.boardInSync) {
      const s = await host.boardInSync()
      if (!s.ok) {
        const text = `I didn't undo anything: ${s.reason}. Reload this page to see the current board.`
        push({ role: 'refusal', text })
        record({ member, outcome: text, outcomeData: { kind: 'undo-refused' }, telemetry: { path: 'fast', undo: true, refused: true, voice } })
        return
      }
    }
    const res = await undoEntry(host, entry)
    if (res.ok) {
      undoRef.current = stack.filter(e => e.id !== entry.id)
      setItems(xs => xs.map(x => (x.undoId === entry.id ? { ...x, undone: true } : x)))
      push({ role: 'receipt', lines: res.lines, undoId: null, isUndo: true })
      record({ member, outcome: res.lines.join(' · '), outcomeData: { kind: 'undo' }, telemetry: { path: 'fast', undo: true, voice } })
    } else {
      push({ role: 'refusal', text: res.reason })
      record({ member, outcome: res.reason, outcomeData: { kind: 'undo-refused' }, telemetry: { path: 'fast', undo: true, refused: true, voice } })
    }
    rerender()
  }, [host, push, record])

  const approve = useCallback(async (count = null, { member, voice } = {}) => {
    const p = pendingRef.current
    if (!p || p.kind !== 'proposal') {
      const text = 'There is no proposal waiting.'
      push({ role: 'outcome', text })
      return
    }
    pendingRef.current = null
    // A proposal belongs to the board it was made on. If another layout is open now,
    // its refs (and "the workspace") would mean a different board: never apply it there.
    if (p.epoch != null && p.epoch !== epochOf(host)) {
      patchItem(p.id, { status: 'dismissed' })
      const text = "A different layout is open now, so I didn't apply that proposal — it was for the board you had open then. Nothing was changed. Ask again if you still want it."
      push({ role: 'refusal', text })
      record({ member, outcome: text, outcomeData: { kind: 'refused-stale' }, telemetry: { path: 'approved', refused: true, voice } })
      return
    }
    patchItem(p.id, { status: 'approved' })
    const ops = count ? p.ops.slice(0, count) : p.ops
    await execute(ops, { path: 'approved', mode: 'approved', member, voice })
  }, [execute, patchItem, push, record, host])

  const dismiss = useCallback(({ member } = {}) => {
    const p = pendingRef.current
    pendingRef.current = null
    if (p?.kind === 'proposal') patchItem(p.id, { status: 'dismissed' })
    const text = 'Okay — nothing changed.'
    push({ role: 'outcome', text })
    record({ member, outcome: text, outcomeData: { kind: 'dismissed' }, telemetry: { path: 'fast' } })
  }, [patchItem, push, record])

  // A local "which one?" for fast-path ops when several targets of the kind exist.
  const chooseTarget = useCallback(async (ref, label) => {
    const p = pendingRef.current
    if (!p || p.kind !== 'target') return
    pendingRef.current = null
    push({ role: 'member', text: label })
    if (p.epoch !== epochOf(host)) {
      push({ role: 'refusal', text: "A different layout is open now, so I didn't change anything. Ask again." })
      return
    }
    await execute(p.ops.map(o => ({ ...o, target: ref })), { path: p.path, mode: 'apply', member: `${p.member} → ${label}`, voice: p.voice })
  }, [execute, push, host])

  const send = useCallback(async (raw, { voice = false, answering = false } = {}) => {
    const text = String(raw || '').trim()
    if (!text || busy) return
    push({ role: 'member', text, voice })
    setBusy(true)
    try {
      if (gridMode) {
        const t = 'UCT Agent works on the Charts workspace. Switch out of Multi Chart (Layouts ▸ Multi Chart) and ask again.'
        push({ role: 'agent', text: t })
        record({ member: text, outcome: t, telemetry: { path: 'local', disposition: 'unsupported', unsupported: 'multichart', voice } })
        return
      }
      // A choice clicked under the MODEL's own question answers that question:
      // it goes back to the model (which has the conversation), never through the
      // fast path, which would act on the bare label ("Hide volume") out of context.
      const fast = answering ? null : fastParse(text, { host })
      if (fast?.kind === 'undo') return await doUndo(null, { member: text, voice })
      if (fast?.kind === 'confirm' && pendingRef.current?.kind === 'proposal') return await approve(null, { member: text, voice })
      if (fast?.kind === 'subset' && pendingRef.current?.kind === 'proposal') return await approve(fast.count, { member: text, voice })
      if (fast?.kind === 'dismiss' && pendingRef.current) return dismiss({ member: text })
      // "do it" / "just the first two" with NOTHING pending never goes to the
      // model: after a reload or a chat switch the history still shows the old
      // proposal, and the model would REGENERATE and apply it. Approval only ever
      // executes a stored, re-validated plan.
      if (fast?.kind === 'confirm' || fast?.kind === 'subset' || fast?.kind === 'dismiss') {
        const t = fast.kind === 'dismiss' ? 'Nothing is waiting — nothing changed.'
          : "There is no proposal waiting to apply. Tell me what you'd like to change."
        push({ role: 'agent', text: t })
        record({ member: text, outcome: t, telemetry: { path: 'fast', voice } })
        return
      }
      // Ops whose capability already resolved the target (a named saved list) run as-is.
      if (fast?.kind === 'ops' && fast.ops.every(o => o.target)) {
        return await execute(fast.ops, { path: 'fast', mode: 'apply', member: text, voice })
      }
      if (fast?.kind === 'ops' && kindsOf(fast.ops).length === 1) {
        const kind = getTargetKind(kindsOf(fast.ops)[0])
        const charts = kind ? kind.list(host) : []
        if (charts.length === 0) {
          const t = 'There is nothing on this workspace for that to change.'
          push({ role: 'agent', text: t })
          record({ member: text, outcome: t, telemetry: { path: 'fast', refused: true, voice } })
          return
        }
        // "both / all" → one op set per target; the multi-target policy makes it
        // a proposal. A position hint narrows by the positions the kind
        // publishes; anything still ambiguous asks. A lone target needs no hint.
        if (fast.target?.all && charts.length > 1) {
          return await execute(charts.flatMap(c => fast.ops.map(o => ({ ...o, target: c.ref }))),
            { path: 'fast', mode: 'apply', member: text, voice })
        }
        let candidates = charts
        let ask = `Which ${kind.name}?`
        if (fast.target?.position && charts.length > 1) {
          const hit = matchPosition(charts, fast.target.position)
          if (hit.length) candidates = hit
          else ask = `I don't see a ${fast.target.position} ${kind.name}. Which one?`
        }
        const unmatchedHint = fast.target?.position && charts.length > 1 && candidates === charts
        if (candidates.length > 1 || unmatchedHint) {
          pendingRef.current = { kind: 'target', ops: fast.ops, path: 'fast', member: text, voice, epoch: epochOf(host) }
          push({ role: 'question', text: ask, choices: candidates.map(c => ({ ref: c.ref, label: c.label })), local: true })
          record({ member: text, outcome: 'Asked which target.', telemetry: { path: 'fast', clarified: true, voice } })
          return
        }
        return await execute(fast.ops.map(o => ({ ...o, target: candidates[0].ref })), { path: 'fast', mode: 'apply', member: text, voice })
      }

      // ── model path ──
      // Context from every registered provider; actions from every AVAILABLE
      // capability's manifest. Nothing here names a feature.
      const { context, refMap } = buildContext(host, capCtx)
      const back = Object.fromEntries(Object.entries(refMap).map(([k, v]) => [v.ref, k]))
      const p = pendingRef.current
      const pending = p?.kind === 'proposal'
        // Transaction-local aliases (new1…) are not context refs: they pass through.
        ? { ops: p.ops.map(o => ({ ...o, target: back[o.target] || o.target })) }
        : null
      const res = await agentTurn({
        conversationId: conversationRef.current, message: text, voice, pending,
        context, capabilities: manifestFor(capCtx),
      })
      if (!res.ok) { push({ role: 'error', text: res.error }); return }
      if (res.data.conversationId !== conversationRef.current) setConversationId(res.data.conversationId)
      const env = res.data.envelope
      const sources = res.data.usage?.citations || []
      if (env.disposition === 'answer' || env.disposition === 'unsupported') {
        push({ role: 'agent', text: env.reply, sources })
        return
      }
      if (env.disposition === 'clarify') {
        pendingRef.current = p                     // a question doesn't drop a waiting proposal
        push({ role: 'question', text: env.question?.text || env.reply, choices: (env.question?.choices || []).map(c => ({ label: c })) })
        return
      }
      // apply / propose: translate the context refs back to real target refs
      if (env.reply) push({ role: 'agent', text: env.reply, sources })
      if (p?.kind === 'proposal') { pendingRef.current = null; patchItem(p.id, { status: 'replaced' }) }
      // A reference that names a context target (a saved list's ref) is bound to
      // that target's own read-only producer before the refs are translated.
      const ops = bindSourceRefs(env.ops, refMap, { host, message: text }).map(o => ({ ...o, target: refMap[o.target]?.ref || o.target }))
      await execute(ops, { path: 'model', mode: env.disposition, member: null, voice })
    } finally {
      setBusy(false)
    }
  }, [busy, push, gridMode, host, record, doUndo, approve, dismiss, execute, setConversationId, patchItem, capCtx])

  const newChat = useCallback(() => {
    setConversationId(null)
    pendingRef.current = null
    setItems([])
  }, [setConversationId])

  const openConversation = useCallback(async (id) => {
    const conv = await agentConversation(id)
    if (!conv) return
    pendingRef.current = null
    setConversationId(id)
    setItems(conv.turns.map(t => ({
      id: `h${t.id}`, role: t.role === 'member' ? 'member' : (t.role === 'outcome' ? 'outcome' : 'agent'),
      text: t.text, history: true,
    })))
  }, [setConversationId])

  const canUndo = (undoId) => undoRef.current.some(e => e.id === undoId)

  return {
    items, busy, restoring, conversationId, send, newChat, openConversation,
    undo: (undoId) => doUndo(undoId, { member: null }),
    approve: () => approve(null, { member: null }), dismiss: () => dismiss({ member: null }),
    chooseTarget, canUndo,
    hasPending: !!pendingRef.current,
  }
}
