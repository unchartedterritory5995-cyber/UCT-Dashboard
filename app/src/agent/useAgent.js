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
import { fastParse } from './fastPath'
import { planOps, prepareOps, collectTargets } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { buildContext, manifestFor, getCapability, getTargetKind } from './capabilities'
import { registerBuiltins } from './builtins'
import { agentTurn, agentRecord, agentConversation } from './agentClient'
import { AGENT_CONVERSATION_KEY, readLocal, writeLocal } from './agentFlag'

registerBuiltins()

const kindsOf = (ops) => [...new Set(ops.map(o => getCapability(o?.action)?.target).filter(Boolean))]

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
  useEffect(() => {
    let alive = true
    const id = conversationRef.current
    if (!id) return undefined
    agentConversation(id).then((conv) => {
      if (!alive) return
      if (!conv) { setConversationId(null); return }
      setItems(conv.turns.map(t => ({
        id: `h${t.id}`, role: t.role === 'member' ? 'member' : (t.role === 'outcome' ? 'outcome' : 'agent'),
        text: t.text, history: true,
      })))
    })
    return () => { alive = false }
  }, [setConversationId])

  const record = useCallback(async (body) => {
    const res = await agentRecord({ conversationId: conversationRef.current, ...body })
    if (res.ok && res.data?.conversationId && res.data.conversationId !== conversationRef.current) {
      setConversationId(res.data.conversationId)
    }
  }, [setConversationId])

  // ── execution (shared by the fast path, the model path and approvals) ──
  const execute = useCallback(async (ops, { path, mode: suggested, member, voice }) => {
    const targets = collectTargets(host, kindsOf(ops))
    const env = await prepareOps(ops)
    const plan = planOps(targets, ops, env, capCtx)
    const actions = ops.map(o => o.action)
    if (!plan.ok) {
      const text = refusalText(plan.refusals)
      push({ role: 'refusal', text })
      record({ member, outcome: text, outcomeData: { kind: 'refused', actions }, telemetry: { path, refused: true, actions, voice } })
      return
    }
    const mode = suggested === 'approved' ? 'apply' : decideMode(suggested, plan)
    if (mode === 'propose') {
      const pid = nid()
      pendingRef.current = { kind: 'proposal', id: pid, ops }
      push({ id: pid, role: 'proposal', lines: plan.lines.length ? plan.lines : plan.noops, status: 'pending' })
      record({ member, outcome: `Proposed: ${plan.lines.join(' · ')}`, outcomeData: { kind: 'proposed', actions }, telemetry: { path, disposition: 'propose', actions, voice } })
      return
    }
    if (!plan.changed) {
      const text = plan.noops.length ? `Nothing to change — ${plan.noops.join(' · ')}.` : 'Nothing to change.'
      push({ role: 'outcome', text })
      record({ member, outcome: text, outcomeData: { kind: 'noop', actions }, telemetry: { path, disposition: 'apply', actions, voice } })
      return
    }
    const res = await commitPlan(host, plan)
    if (res.undo) {
      undoRef.current = [...undoRef.current, res.undo].slice(-UNDO_MAX)
    }
    if (res.ok) {
      push({ role: 'receipt', lines: res.lines, undoId: res.undo?.id || null, notes: plan.noops })
      record({ member, outcome: res.lines.join(' · '), outcomeData: { kind: 'applied', actions, lines: res.lines }, telemetry: { path, disposition: 'apply', actions, voice } })
    } else {
      const text = `Some of that didn't take effect: ${res.failed.map(f => `${f.label} ${f.reason}`).join('; ')}.`
      if (res.lines.length) push({ role: 'receipt', lines: res.lines, undoId: res.undo?.id || null })
      push({ role: 'refusal', text })
      record({ member, outcome: [res.lines.join(' · '), text].filter(Boolean).join(' · '), outcomeData: { kind: 'failed', actions }, telemetry: { path, refused: true, actions, voice } })
    }
  }, [host, push, record, capCtx])

  const doUndo = useCallback(async (undoId, { member, voice } = {}) => {
    const stack = undoRef.current
    const entry = undoId ? stack.find(e => e.id === undoId) : stack[stack.length - 1]
    if (!entry) {
      const text = 'There is nothing of mine to undo in this session.'
      push({ role: 'outcome', text })
      record({ member, outcome: text, outcomeData: { kind: 'undo-none' }, telemetry: { path: 'fast', undo: true, voice } })
      return
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
    patchItem(p.id, { status: 'approved' })
    const ops = count ? p.ops.slice(0, count) : p.ops
    await execute(ops, { path: 'approved', mode: 'approved', member, voice })
  }, [execute, patchItem, push])

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
    await execute(p.ops.map(o => ({ ...o, target: ref })), { path: p.path, mode: 'apply', member: `${p.member} → ${label}`, voice: p.voice })
  }, [execute, push])

  const send = useCallback(async (raw, { voice = false } = {}) => {
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
      const fast = fastParse(text)
      if (fast?.kind === 'undo') return await doUndo(null, { member: text, voice })
      if (fast?.kind === 'confirm' && pendingRef.current?.kind === 'proposal') return await approve(null, { member: text, voice })
      if (fast?.kind === 'subset' && pendingRef.current?.kind === 'proposal') return await approve(fast.count, { member: text, voice })
      if (fast?.kind === 'dismiss' && pendingRef.current) return dismiss({ member: text })
      if (fast?.kind === 'ops' && kindsOf(fast.ops).length === 1) {
        const kind = getTargetKind(kindsOf(fast.ops)[0])
        const charts = kind ? kind.list(host) : []
        if (charts.length === 0) {
          const t = 'There is nothing on this workspace for that to change.'
          push({ role: 'agent', text: t })
          record({ member: text, outcome: t, telemetry: { path: 'fast', refused: true, voice } })
          return
        }
        if (charts.length > 1) {
          pendingRef.current = { kind: 'target', ops: fast.ops, path: 'fast', member: text, voice }
          push({ role: 'question', text: `Which ${kind.name}?`, choices: charts.map(c => ({ ref: c.ref, label: c.label })), local: true })
          record({ member: text, outcome: 'Asked which target.', telemetry: { path: 'fast', clarified: true, voice } })
          return
        }
        return await execute(fast.ops.map(o => ({ ...o, target: charts[0].ref })), { path: 'fast', mode: 'apply', member: text, voice })
      }

      // ── model path ──
      // Context from every registered provider; actions from every AVAILABLE
      // capability's manifest. Nothing here names a feature.
      const { context, refMap } = buildContext(host, capCtx)
      const back = Object.fromEntries(Object.entries(refMap).map(([k, v]) => [v.ref, k]))
      const p = pendingRef.current
      const pending = p?.kind === 'proposal'
        ? { ops: p.ops.filter(o => back[o.target]).map(o => ({ ...o, target: back[o.target] })) }
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
      const ops = env.ops.map(o => ({ ...o, target: refMap[o.target]?.ref || o.target }))
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
    items, busy, conversationId, send, newChat, openConversation,
    undo: (undoId) => doUndo(undoId, { member: null }),
    approve: () => approve(null, { member: null }), dismiss: () => dismiss({ member: null }),
    chooseTarget, canUndo,
    hasPending: !!pendingRef.current,
  }
}
