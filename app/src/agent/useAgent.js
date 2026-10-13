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

import { protectionRefusal, undoProtectionRefusal, protectedOpenLayout } from './protectedLayouts'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AuthContext } from '../context/AuthContext'
import { useCreateIndicatorAccess } from '../components/chart/builder/studio/createIndicatorFlag'
import { useUserDefinitions, USER_DEFINITIONS_KEY } from '../hooks/useUserDefinitions'
import { mutate } from 'swr'
import { setOwnedDefinitionSource } from './capabilities/indicatorEdits'
import { setAuthoringSources, draftAmbiguity, selectDraft, isDraftAction, lastSaved, screenModelOps, PROPOSAL_TTL_MS, saveReferent, splitSaveAs, renameBeforeSave } from './capabilities/indicatorAuthoring'
import { fastParse, matchPosition } from './fastPath'
import { screenNewChart } from './capabilities/workspace'
import { resolveDeictic, screenDeicticOps } from './deixis'
import { planOps, prepareOps, collectTargets, undoNotesFor } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry, undoEntryFor } from './runtime'
import { pendingLines as pendingWording } from './proposalWording'
import { refsOf, checkRefs, consumedProducers, pendingLines, resolveRefs, expandOps, bindSourceRefs } from './compose'
import { traceStart, mark, traceEnd, turnStart, turnPath, turnVisible, turnOutput, turnOutputMs, turnEnd } from './trace'
import { buildContext, refreshContext, manifestFor, getCapability, getTargetKind, runWarmups, MANIFEST_VERSION, MANIFEST_CONTRACT } from './capabilities'
import { registerBuiltins } from './builtins'
import { routeManifest, routingEnabled, routingNames } from './routing'
import { createMemory, tickersOfAnswer } from './memory'
import { resolveReference, subjectTarget } from './references'
import { takeIndicatorTouch } from './capabilities/indicatorEdits'
import { correctTypos, lexiconFor } from './nl/lexicon'
import { agentTurn, agentTurnStream, serverStreams, loadAgentConfig, agentRecord, agentConversation } from './agentClient'
import { AGENT_CONVERSATION_KEY, AGENT_INFLIGHT_KEY, readLocal, writeLocal } from './agentFlag'
import { presentOf, compactViews, itemsFromTurns, chartTarget } from './present'
// ⭐ INDICATORS ⇄ AGENT (2026-10-12): the chart's Create Indicator / Modify doors open the Agent; the
// member's answer to its question runs the existing `indicator.draft` for that chart. See indicatorEntry.js.
import { beginAuthoringIntent, takeAuthoringIntent, peekAuthoringIntent, clearAuthoringIntent, authoringPrompt, authoringOp, isCancelWords, INDICATOR_DOORS, openIndicatorDoor } from './indicatorEntry'

registerBuiltins()

// An ARGUMENT that names another context target (widget.showList's `list` = a watchlist ref) is
// translated back like a target — only for the args a capability declares (`argRefs: {arg: kind}`),
// and only when the short ref really is a target of that kind; anything else stays as the model
// sent it, and the capability's check refuses it.
function argRefsBack(op, refMap, isAlias = () => false) {
  const decl = getCapability(op?.action)?.argRefs
  if (!decl || !op.args || typeof op.args !== 'object') return op.args
  const args = { ...op.args }
  for (const [arg, kind] of Object.entries(decl)) {
    const kinds = Array.isArray(kind) ? kind : [kind]
    const back = (v) => {
      if (isAlias(v, kinds)) return v
      const hit = typeof v === 'string' ? refMap[v] : null
      return hit && kinds.includes(hit.kind) ? hit.ref : v
    }
    args[arg] = Array.isArray(args[arg]) ? args[arg].map(back) : back(args[arg])
  }
  return args
}

// The model's short refs → real refs. ⛔ An ALIAS the plan itself declared (a creator's `as`,
// e.g. a new list "w1") wins over a context ref spelled the same way, for every LATER op that
// expects that kind — the model picks alias names freely, and "w1" may also be the short ref
// of an existing list (measured 2026-10-11: the fill went to the wrong list). Earlier ops, and
// ops expecting another kind, still read the context ref.
export function translateRefs(ops, refMap) {
  const aliasKind = {}
  const isAlias = (v, kinds) => typeof v === 'string' && aliasKind[v] != null && (!kinds || [].concat(kinds).includes(aliasKind[v]))
  return (ops || []).map((o) => {
    const cap = getCapability(o?.action)
    const target = isAlias(o?.target, cap?.target) ? o.target : (refMap[o?.target]?.ref || o?.target)
    const out = { ...o, target, args: argRefsBack(o, refMap, isAlias) }
    const c = cap?.creates?.(o?.args || {})
    if (c?.alias) aliasKind[c.alias] = c.kind
    return out
  })
}
const kindsOf = (ops) => [...new Set(ops.map(o => getCapability(o?.action)?.target).filter(Boolean))]
// GATE C: a committed plan → session memory, every target as its CHART ref (a kind's `groupOf`), with
// the chart's symbol after the change. Never throws (memory is a convenience, not a gate).
function rememberChange(memory, host, ops) {
  try {
    const asChart = (o) => { const k = getTargetKind(getCapability(o.action)?.target); return k?.groupOf ? (k.groupOf(o.target) ?? o.target) : o.target }
    const clean = (ops || []).filter(o => o?.action && typeof o.target === 'string').map(o => ({ ...o, target: asChart(o) }))
    const refs = [...new Set(clean.map(o => o.target))]
    const sym = refs.length === 1 ? host?.charts?.read?.(refs[0])?.symbol || null : null
    memory?.noteChange({ ops: clean, epoch: epochOf(host), chartSymbol: sym })
    // the indicator a confirmed add / edit touched ("make it a 9"), taken from Indicators' own receipt
    const t = takeIndicatorTouch()
    if (t) memory?.noteIndicator({ chart: t.chartRef, instanceId: t.instanceId, defId: t.defId, label: t.name, epoch: epochOf(host) })
  } catch { /* memory is best-effort */ }
}
// GATE C: a message that corrects the last one ("no, I meant…", "not that", "wrong one", "I said…")
const CORRECTION = /^(?:no|nope|nah|not that|not those|wrong|that's wrong|that is wrong|actually,? i meant|i meant|i said|i asked for)\b/i
// Which board the host is showing (null for hosts without layouts).
const epochOf = (host) => (typeof host?.epoch === 'function' ? host.epoch() : null)
// A proposal is pinned to the board only if it touches something ON the board.
const boardEpoch = (host, ops) => (kindsOf(ops).some(k => getTargetKind(k)?.boardScoped !== false) ? epochOf(host) : null)
// ⛔ F6 — what an approval binds to: each target kind may SEAL its planned change (the M3 Save
// does: draft, revision, name, target definition, acknowledgement, summary, charts, expiry).
// The seals and the exact card lines are kept with the proposal; Apply plans from them.
const sealsOf = (plan) => (plan?.plans || []).map(p => { try { return getTargetKind(p.kind)?.seal?.(p) || null } catch { return null } }).filter(Boolean)
const sameLines = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || [])
const STALE_PROPOSAL = 'so nothing was changed — ask again and I’ll show you the current version.'
// ⭐ F5 — the SAME change on several charts ("add this indicator to both charts"): a capability that
// declares `fanOut` is run once per target, each as its own ordinary execution (own plan,
// permission check, persistence, receipt and Undo) — never a second engine, never one write.
function fanOutOf(ops) {
  if (!Array.isArray(ops) || ops.length < 2) return null
  const cap = getCapability(ops[0]?.action)
  if (!cap?.fanOut) return null
  const args = JSON.stringify(ops[0].args ?? null)
  if (!ops.every(o => o?.action === ops[0].action && JSON.stringify(o.args ?? null) === args)) return null
  if (new Set(ops.map(o => o.target)).size !== ops.length) return null
  return ops
}

// ⭐ DEFERRED steps (a capability with `deferred: true`, e.g. watchlist.open): in a request that
// also does other things, they run AFTER the rest has landed — as their own execution with their
// own receipt and Undo, aimed at what the rest created (an alias → its real id). If one cannot
// run, what the rest did STAYS (a new list is never deleted because it could not be opened) and
// the member is told exactly that. Never a way around approval: they are on the same card.
const isDeferred = (o) => !!getCapability(o?.action)?.deferred
// a model reply that only acknowledges (the receipt that follows is the real confirmation)
const BARE_ACK = /^(?:on it|sure(?: thing)?|ok(?:ay)?|got it|will do|doing (?:it|that)(?: now)?|right away|coming (?:right )?up|done|one moment|one sec)[.!…]*$/i
// alias → the name a creator in these ops will give it (watchlist.create's `as`)
function aliasNames(ops) {
  const out = {}
  for (const o of ops || []) {
    const c = getCapability(o?.action)?.creates?.(o.args || {})
    if (c?.alias && c.spec?.name) out[c.alias] = c.spec.name
  }
  return out
}
// A deferred op re-aimed at what was created: aliases in its target / args → real refs.
function landDeferred(ops, created, names, approved = false) {
  const real = (v) => (typeof v === 'string' && created?.[v] ? created[v] : v)
  const made = Object.entries(names).filter(([a]) => created?.[a])
  const pendingLists = Object.fromEntries(made.map(([a, n]) => [created[a], n]))
  const followNote = made.length
    ? `${made.map(([, n]) => `“${n}”`).join(' and ')} ${made.length === 1 ? 'was' : 'were'} still created and filled — say “open ${made[0][1]}” to try again.`
    : 'The rest of your request was done.'
  return ops.map(o => ({
    action: o.action, target: real(o.target),
    args: Object.fromEntries(Object.entries(o.args || {}).map(([k, v]) => [k, real(v)])),
    pendingLists, followNote,
    // a step that was ON the card the member approved runs as approved (re-validated, never re-asked)
    ...(approved ? { approvedStep: true } : {}),
  }))
}

// ⛔ A RECEIPT CLAIMS ONLY WHAT IS PROVEN. A change to the board is on screen the moment it
// lands, but it is SAVED only when the server accepts the workspace write (which a newer change
// in another window can refuse). The board host's `persist()` writes it now and answers with
// the server's verdict; until it says ok, the receipt says "on screen, not saved" and offers no
// Undo (an Undo of something that was never saved would be a second unsaved change).
const INFLIGHT_TTL_MS = 30 * 60 * 1000
// What a plan DOES, in the member's words ("Create 2 charts: SPY, QQQ") — to recognise the same
// change coming back after a reload. Not the raw ops: their refs are minted per page load.
const planSig = (lines) => JSON.stringify(lines || [])

const UNSAVED_NOTE = {
  conflict: 'Shown on this screen but NOT saved: your workspace was changed in another window or device. Reload to see the current workspace (reloading discards this change).',
  'not-saved': 'Shown on this screen, but the save was not confirmed — it is not saved yet.',
  'not-synced': 'Drawn on this device, but syncing it to your account was not confirmed yet — keep this tab open a few seconds; closing it now may lose the change.',
}
// Drawings reach the account through the tracings sync, not the board save: wait for the server's
// copy of each touched symbol to match (host.drawings.confirm). Same rule as a board change: until
// confirmed, the receipt says so and offers no Undo.
async function confirmDrawings(host, refs) {
  if (!host?.drawings?.confirm || !refs.length) return { ok: true }
  for (const ref of [...new Set(refs)]) {
    try {
      const r = await host.drawings.confirm(ref)
      if (!r?.ok) return { ok: false, reason: r?.reason || 'not-synced' }
    } catch { return { ok: false, reason: 'not-synced' } }
  }
  return { ok: true }
}
const drawingRefsOfPlan = (plan) => (plan?.plans || []).filter(p => p.kind === 'drawing' && p.changed).map(p => p.ref)
// ⭐ LATENCY: a target kind whose commit ALREADY saved its change and read it back (`persistsInCommit`,
// e.g. indicator edits) needs no second, identical board write after it. Only when every changed
// target is such a kind; anything else is saved exactly as before.
const selfSaved = (items) => {
  const changed = (items || []).filter(p => p && p.changed !== false)
  return changed.length > 0 && changed.every(p => getTargetKind(p.kind)?.persistsInCommit === true)
}
async function persistBoard(host, ops) {
  if (!host?.persist || boardEpoch(host, ops) == null) return { ok: true }
  try {
    const r = await host.persist()
    return r && r.ok ? { ok: true } : { ok: false, reason: (r && r.reason) || 'not-saved' }
  } catch {
    return { ok: false, reason: 'not-saved' }
  }
}

// the server's stage timings (ms only) for the turn trace
const stagesOf = (data) => { const s = data?.usage?.stages; return s && typeof s === 'object' ? JSON.stringify(s) : null }

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
  // Create Indicator access — the button's own rule (Indicators' createIndicatorAccess: admin +
  // this browser's flag, or the server cohort). It makes indicator.openCreate available or not;
  // the chart's opener re-checks it, and /converse enforces it server-side.
  const createIndicator = useCreateIndicatorAccess(useContext(AuthContext))
  const capCtx = useMemo(() => ({ surface, createIndicator }), [surface, createIndicator])
  // INDICATORS M2 — the member's OWN saved definition ids (server rows), read fresh by the
  // Indicators permission check at plan, apply and Undo.
  const { rows: ownedDefinitionRows } = useUserDefinitions()
  const ownedRowsRef = useRef(ownedDefinitionRows)
  ownedRowsRef.current = ownedDefinitionRows
  useEffect(() => { setOwnedDefinitionSource(() => (ownedRowsRef.current || []).map(r => r && r.def_id).filter(Boolean)) }, [])
  // INDICATORS M3 — read at every specialist call (never captured when the conversation began)
  const accessRef = useRef(createIndicator)
  accessRef.current = createIndicator
  useEffect(() => { setAuthoringSources({ access: () => accessRef.current === true, rows: () => ownedRowsRef.current || [] }) }, [])
  // M3: a just-saved indicator is added only once the member's own list carries it (the store's
  // list, refreshed now) — bounded; if it never shows, the add refuses with M2's own sentence.
  const definitionListed = useCallback(async ({ defId, version }, ms = 8000) => {
    const has = () => (ownedRowsRef.current || []).some(r => r && r.def_id === defId && r.version >= version)
    if (has()) return true
    try { mutate(USER_DEFINITIONS_KEY) } catch { /* the wait below is the check */ }
    const until = Date.now() + ms
    while (!has() && Date.now() < until) await new Promise(r => setTimeout(r, 100))
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    return has()
  }, [])
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  // the member's line and "typing…" are on screen: the turn's first visible feedback
  useEffect(() => { if (busy) turnVisible() }, [busy])
  // ⛔ ONE thing at a time: a send, an Apply, an Undo or a choice. A ref (not the
  // `busy` state) so two clicks in the same tick cannot both get through; every
  // entry point the panel calls takes it, and the internal calls send() makes
  // ("undo" / "do it" typed) run inside the lock it already holds.
  const lockRef = useRef(false)
  const exclusive = useCallback((fn) => async (...args) => {
    if (lockRef.current) return undefined
    lockRef.current = true
    const traced = turnStart('click')
    setBusy(true)
    try { return await fn(...args) } finally { lockRef.current = false; setBusy(false); if (traced) turnEnd() }
  }, [])
  const [conversationId, setConversationIdState] = useState(() => readLocal(AGENT_CONVERSATION_KEY))
  const conversationRef = useRef(conversationId)
  const pendingRef = useRef(null)           // { kind:'proposal', id, ops } | { kind:'target', ops, path }
  // INTERRUPTED EXECUTION. A board change is marked in-flight (this browser) before its first
  // write and cleared at its receipt. A mark that survives a reload means the change was cut off
  // part-way — some of it may already be on the board, and the Agent cannot know how much. The
  // member is told; and the SAME plan, if it comes back, is proposed with a warning instead of
  // run blind (re-running it would e.g. build the charts a second time). Best-effort, per
  // browser: not an exactly-once guarantee.
  const interruptedRef = useRef(null)       // { sig, lines, at } from a mark found at load
  const undoRef = useRef([])                // newest last
  const lastActionsRef = useRef([])         // actions of the last plan (routing keeps follow-ups' groups)
  const saidRef = useRef('')                // the member's words this turn (how much an answer shows)
  const memoryRef = useRef(null)            // GATE C session memory (agent/memory.js) — this chat only
  if (!memoryRef.current) memoryRef.current = createMemory()
  const [, force] = useState(0)
  const rerender = () => force(n => n + 1)

  const setConversationId = useCallback((id) => {
    conversationRef.current = id
    setConversationIdState(id)
    writeLocal(AGENT_CONVERSATION_KEY, id)
  }, [])

  // `at`: when the line joined the chat (the panel shows it beside the sender's name).
  // ⛔ Never an EMPTY Agent container: an agent / refusal / error line with nothing to show is not
  // added (a blank reply, an answer that came back empty). Cards and questions always carry content.
  const push = useCallback((item) => {
    if (['agent', 'refusal', 'error'].includes(item?.role) && !String(item.text || '').trim()
        && !item.present && !item.table && !item.link) return
    if (item?.role && item.role !== 'member') turnOutput(item.role)
    setItems(xs => [...xs, { id: nid(), at: Date.now(), ...item }])
  }, [])
  const patchItem = useCallback((id, patch) => setItems(xs => xs.map(x => (x.id === id ? { ...x, ...patch } : x))), [])
  // What the Agent is doing while the member waits, beyond "typing" ('research' = a web search runs).
  const [activity, setActivity] = useState(null)
  // ⭐ STREAMING (server flag UCT_AGENT_STREAM): an ANSWER's reply appears while it is being written, as
  // ONE provisional line — repainted at most every 50 ms, replaced by the final envelope's reply (the
  // authority) when the turn ends as an answer, removed when it does not or when a web search follows
  // (`retract`). The server sends text only through its gate (turn.ReplyStream): never a plan's words,
  // never a local-only result.
  const streamLine = useCallback(() => {
    let id = null
    let text = ''
    let timer = null
    const stop = () => { if (timer) { clearTimeout(timer); timer = null } }
    const remove = (gone) => setItems(xs => xs.filter(x => x.id !== gone))
    return {
      onEvent(e) {
        if (e?.t === 'delta' && typeof e.text === 'string') {
          text += e.text
          if (!id) {
            id = nid()
            mark('turn:first-delta')
            setActivity(null)
            push({ id, role: 'agent', text, streaming: true })
          } else if (!timer) {
            timer = setTimeout(() => { timer = null; if (id) patchItem(id, { text }) }, 50)
          }
        } else if (e?.t === 'retract') {
          stop()
          if (id) remove(id)
          id = null; text = ''
        } else if (e?.t === 'status' && e.stage === 'research') {
          setActivity('research')
        }
      },
      // `final` ({text, sources}): the answer takes the streamed line's place → true. null: removed → false.
      settle(final) {
        stop()
        const had = id
        id = null; text = ''
        if (!had) return false
        if (final && String(final.text || '').trim()) { patchItem(had, { ...final, streaming: false }); return true }
        remove(had)
        return false
      },
    }
  }, [push, patchItem])

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
      const history = itemsFromTurns(conv.turns)
      setItems(xs => [...history, ...xs.filter(x => !x.history)])
    }, () => { if (alive) setRestoring(false) })
    return () => { alive = false }
  }, [setConversationId])

  // Features warm their data (catalogs) once the Agent is open; so does the server's streaming flag.
  useEffect(() => { runWarmups(host); loadAgentConfig() }, [host])

  useEffect(() => {
    let mark = null
    try { mark = JSON.parse(readLocal(AGENT_INFLIGHT_KEY) || 'null') } catch { mark = null }
    writeLocal(AGENT_INFLIGHT_KEY, null)
    if (!mark || !mark.sig || Date.now() - (mark.at || 0) > INFLIGHT_TTL_MS) return
    interruptedRef.current = mark
    const what = (mark.lines || []).join(' · ')
    push({ role: 'refusal', text: `Your last change was interrupted before it finished (the page reloaded or closed)${what ? `: ${what}` : ''}. Part of it may already be on the board — check it before asking again.` })
  }, [push])

  const record = useCallback(async (body) => {
    // a local turn's time to its first useful output (content-free: one number) rides the telemetry row
    const ms = turnOutputMs()
    if (body?.telemetry && body.telemetry.latency_ms == null && ms != null) body = { ...body, telemetry: { ...body.telemetry, latency_ms: ms } }
    const res = await agentRecord({ conversationId: conversationRef.current, ...body })
    if (res.ok && res.data?.conversationId && res.data.conversationId !== conversationRef.current) {
      setConversationId(res.data.conversationId)
    }
  }, [setConversationId])

  // ── execution (shared by the fast path, the model path and approvals) ──
  const executeInner = useCallback(async (opsIn, { path, mode: suggested, member, voice, approval = null, card = null, note = null, onTarget = null, lead = null }) => {
    // A follow-up step's refusal says what the earlier steps already did (`note`). `lead` (OWNER
    // 2026-10-12): the held receipt of the step before it (a Save) — said in THIS step's message,
    // first, so "save + apply" reads as ONE confirmation; `lead.used` tells the caller it was said.
    const leadLines = lead && !lead.used ? lead.lines : []
    const refusalPush = (text) => {
      const before = leadLines.length ? `${leadLines.join(' ')} ` : ''
      if (lead) lead.used = true
      push({ role: 'refusal', text: `${before}${note ? `${text} ${note}` : text}` })
    }
    let allOps = opsIn
    let deferred = []
    if (opsIn.some(isDeferred) && !opsIn.every(isDeferred)) {
      deferred = opsIn.filter(isDeferred)
      allOps = opsIn.filter(o => !isDeferred(o))
      opsIn = allOps
    }
    // SEQUENTIAL capabilities (indicator edits: exclusive — never mixed in a plan): in a request that
    // asks for more, each runs as its OWN step after the rest (own receipt + Undo), in request order.
    // The same change on several charts keeps its fan-out path (proposed together, run per chart).
    {
      const seq = (o) => !!getCapability(o?.action)?.sequential
      if (allOps.length > 1 && allOps.some(seq) && !fanOutOf(allOps)) {
        const rest = allOps.filter(o => !seq(o))
        const steps = allOps.filter(seq)
        const keep = rest.length ? rest : [steps.shift()]
        deferred = [...steps, ...deferred]
        allOps = keep; opsIn = keep
      }
    }
    const pendingNames = aliasNames(allOps)
    // Checked NOW against the board as it is (a new list's alias stands in for it). One that
    // cannot run is dropped and said up front — the rest of the request still runs.
    let deferredLines = []
    if (deferred.length) {
      // each one on its own (they run one at a time, so they are checked one at a time)
      const okd = []
      for (const d of deferred) {
        const dp = planOps(collectTargets(host, kindsOf([d])), [d], { pendingLists: pendingNames }, capCtx)
        if (!dp.ok) push({ role: 'agent', text: `I'll do the rest, but not this part: ${[...new Set(dp.refusals.map(r => r.reason))].join(' ')}` })
        else { okd.push(d); deferredLines.push(...dp.lines) }
      }
      deferred = okd
    }
    // ⛔ Another window/device may have changed this member's board (one shared,
    // last-write-wins preference): never write over it (host.boardInSync).
    // `early`: the same check already started (LATENCY: beside planning's own lookups, see below)
    const boardStillOurs = async (ops, early = null) => {
      if (!host?.boardInSync || boardEpoch(host, ops) == null) return true
      const s = await (early || host.boardInSync())
      mark('board:synced', s.ok ? 'ok' : 'changed')
      if (s.ok) return true
      const text = `I didn't change anything: ${s.reason}. Reload this page to see the current board, then ask again.`
      refusalPush(text)
      record({ member, outcome: text, outcomeData: { kind: 'refused-stale-board', actions: ops.map(o => o?.action) }, telemetry: { path, refused: true, voice } })
      return false
    }
    const refuse = (why) => {
      const text = `I didn't change anything: ${why}`
      refusalPush(text)
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
              refusalPush(text)
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
          refusalPush(text)
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
      // ⭐ ONE presentation contract (present.js): each answer → the smallest view that carries it,
      // shaped by the member's own request (concise by default, depth when asked).
      const views = answers.map(a => presentOf(a, { message: saidRef.current }))
      // ⭐ GATE C session memory: a table of tickers UCT showed, in the order shown ("open the third one").
      // Never a local-only answer (its rows stay in the browser only, as before).
      queries.forEach((o, i) => {
        const syms = getCapability(o.action)?.localOnly ? null : tickersOfAnswer(answers[i])
        if (syms) memoryRef.current.noteResults({ source: o.action, label: answers[i]?.title || null, symbols: syms })
      })
      answers.forEach((a, i) => push(views[i] ? { role: 'agent', present: views[i], text: a.text || '' } : { role: 'agent', text: a.text, table: a.table || null, link: a.link || null }))
      const text = answers.map(a => a.text).filter(Boolean).join('\n\n')
      // the member's transcript keeps the views (restored on reload); never read into a model request
      const saved = compactViews(views.filter(Boolean))
      // ⛔ LOCAL-RESULT BOUNDARY: the member's transcript keeps the answer; the row says it is LOCAL
      // ONLY (and what was asked — args, never values), so the server never replays it to a model.
      // The server also decides by the action name (turn.LOCAL_ONLY_ACTIONS); this is the second signal.
      const local = queries.filter(o => getCapability(o.action)?.localOnly)
      const localData = local.length ? { local: true, requests: local.map(o => o.args || {}) } : {}
      record({ member, outcome: text || 'Answered.', outcomeData: { kind: 'answered', actions: queries.map(o => o.action), ...localData, ...(saved.length ? { views: saved } : {}) }, telemetry: { path, disposition: 'answer', actions: queries.map(o => o.action), voice } })
    }
    const ops = allOps.filter(o => !getCapability(o?.action)?.query)
    if (!ops.length) return
    // ── F5: one change, several charts — each target planned (and refused) ON ITS OWN, all of them
    // before anything is proposed or written; the Apply re-checks all again, then runs them one by one
    const fan = fanOutOf(ops)
    if (fan) {
      const actions = fan.map(o => o.action)
      const lines = []
      for (const o of fan) {
        const one = planOps(collectTargets(host, kindsOf([o])), [o], await prepareOps([o]), capCtx)
        const guard = one.ok ? protectionRefusal(host, one, [o]) : null
        const why = !one.ok ? refusalText(one.refusals) : (guard ? `I didn't change anything: ${guard}` : null)
        if (why) {
          refusalPush(why)
          record({ member, outcome: why, outcomeData: { kind: 'refused', actions }, telemetry: { path, refused: true, actions, voice } })
          return
        }
        lines.push(...(one.lines.length ? one.lines : one.noops))
      }
      const plines = pendingWording([...lines, 'Each chart is changed separately, with its own receipt and Undo.'])
      if (suggested === 'approved') {
        // only the charts and the change the member approved — else nothing runs
        if (!card || !sameLines(card, plines)) {
          const text = `Something on those charts changed since you approved it, ${STALE_PROPOSAL}`
          refusalPush(text)
          record({ member, outcome: text, outcomeData: { kind: 'refused-stale-proposal', actions }, telemetry: { path, refused: true, actions, voice } })
          return
        }
        return { followUps: fan }
      }
      const pid = nid()
      pendingRef.current = { kind: 'proposal', id: pid, ops: fan, epoch: boardEpoch(host, fan), card: plines, expiresAt: Date.now() + PROPOSAL_TTL_MS }
      push({ id: pid, role: 'proposal', lines: plines, status: 'pending' })
      record({ member, outcome: `Proposed: ${plines.join(' · ')}`, outcomeData: { kind: 'proposed', actions }, telemetry: { path, disposition: 'propose', actions, voice } })
      return
    }
    // ⛔ F6: an Apply plans from what was approved (the seals), never from a fresh read
    const pendingLists = Object.assign({}, ...ops.map(o => o.pendingLists || {}))
    // ⭐ LATENCY: a change that will be applied reads the server's board for the cross-session check NOW,
    // beside the lookups planning waits on (a ticker search), not after them — one network wait less.
    // The SAME check and the same refusal, still before anything is written; a plan that ends up
    // proposed or refused never uses it (one wasted read at most).
    const earlySync = (suggested === 'apply' || suggested === 'approved') && !composing && host?.boardInSync && boardEpoch(host, ops) != null
      ? host.boardInSync() : null
    earlySync?.catch(() => {})                 // awaited below; never an unhandled rejection meanwhile
    const env = { ...(await prepareOps(ops)), ...(suggested === 'approved' ? { approved: true, approval: approval || [] } : {}), ...(Object.keys(pendingLists).length ? { pendingLists } : {}) }
    mark('prepared')
    // A read in THIS request (a screen just run) is visible to the writes after it ("find … and save it"):
    // targets are re-read once the request's own queries have answered.
    const plan = planOps(queries.length ? collectTargets(host, kindsOf(ops)) : targets, ops, env, capCtx)
    mark('planned')
    const actions = ops.map(o => o.action)
    if (!plan.ok) {
      const text = refusalText(plan.refusals)
      refusalPush(text)
      record({ member, outcome: text, outcomeData: { kind: 'refused', actions }, telemetry: { path, refused: true, actions, voice } })
      return
    }
    // PROTECTED LAYOUTS (Main Trading…): checked after planning — so it covers a new request, a
    // proposal's Apply (which re-plans here) and a composed plan alike — and before anything writes.
    const guarded = protectionRefusal(host, plan, ops)
    if (guarded) {
      const text = `I didn't change anything: ${guarded}`
      refusalPush(text)
      record({ member, outcome: text, outcomeData: { kind: 'refused-protected', actions }, telemetry: { path, refused: true, actions, voice } })
      return
    }
    // ⛔ F6: a sealed approval runs only if the plan still reads EXACTLY as the card the member approved
    if (suggested === 'approved' && card && !sameLines(card, pendingWording(plan.lines.length ? plan.lines : plan.noops))) {
      const text = `That proposal no longer matches what you approved, ${STALE_PROPOSAL}`
      refusalPush(text)
      record({ member, outcome: text, outcomeData: { kind: 'refused-stale-proposal', actions }, telemetry: { path, refused: true, actions, voice } })
      return
    }
    if (composing && !composed) {
      const pid = nid()
      pendingRef.current = { kind: 'proposal', id: pid, ops: [...allOps, ...deferred], epoch: boardEpoch(host, [...allOps, ...deferred]) }
      // a proposal says what WILL happen (proposalWording.js), never a success not yet written
      const lines = pendingWording([...pendingLines(allOps, host), ...plan.lines, ...deferredLines])
      push({ id: pid, role: 'proposal', lines, status: 'pending' })
      record({ member, outcome: `Proposed: ${lines.join(' · ')}`, outcomeData: { kind: 'proposed', actions }, telemetry: { path, disposition: 'propose', actions, voice } })
      return
    }
    // Every op came from expansions → the member reads ONE line per request
    // ("Create 4 5-minute charts: SPY, QQQ, …"), not the per-chart steps.
    const wholly = expansion && ops.every(o => o.fromExpand != null)
    // The very plan an interrupted Apply was running: never run it blind — propose it, warned.
    const sig = planSig(wholly ? expansion.lines : plan.lines)
    const repeatOfInterrupted = interruptedRef.current && interruptedRef.current.sig === sig
    if (repeatOfInterrupted) {
      interruptedRef.current = null
      push({ role: 'refusal', text: 'This is the same change that was interrupted a moment ago, and part of it may already be on the board. Check the board first — apply it again only if it is still needed.' })
    }
    // An expansion is always proposed first (it creates several widgets at once).
    const mode = repeatOfInterrupted ? 'propose' : (suggested === 'approved' ? 'apply' : (expansion ? 'propose' : decideMode(suggested, plan)))
    // Any write to the board is preceded by the cross-session check (once per Apply).
    if (mode !== 'propose' && !composed && !(await boardStillOurs(ops, earlySync))) return
    if (mode === 'propose') {
      const pid = nid()
      // The proposal keeps the UNEXPANDED request: Apply expands it again from scratch.
      const keep = [...(expansion ? opsIn.filter(o => !getCapability(o?.action)?.query) : ops), ...deferred]
      const plines = pendingWording([...(wholly ? expansion.proposal : (plan.lines.length ? plan.lines : plan.noops)), ...deferredLines])
      const seals = sealsOf(plan)
      pendingRef.current = { kind: 'proposal', id: pid, ops: keep, epoch: boardEpoch(host, keep),
        ...(seals.length ? { seals, card: plines, expiresAt: Math.min(...seals.map(x => x.expiresAt)) } : {}) }
      push({ id: pid, role: 'proposal', lines: plines, status: 'pending' })
      record({ member, outcome: `Proposed: ${plines.join(' · ')}`, outcomeData: { kind: 'proposed', actions }, telemetry: { path, disposition: 'propose', actions, voice } })
      return
    }
    if (!plan.changed) {
      const text = plan.noops.length ? `Nothing to change — ${plan.noops.join(' · ')}.` : 'Nothing to change.'
      push({ role: 'outcome', text })
      record({ member, outcome: text, outcomeData: { kind: 'noop', actions }, telemetry: { path, disposition: 'apply', actions, voice } })
      if (deferred.length) return { followUps: landDeferred(deferred, {}, {}, suggested === 'approved') }
      return
    }
    if (boardEpoch(host, ops) != null) {
      writeLocal(AGENT_INFLIGHT_KEY, JSON.stringify({ sig, lines: (wholly ? expansion.lines : plan.lines).slice(0, 4), at: Date.now() }))
    }
    mark('commit:start')
    let res, saved
    try {
      res = await commitPlan(host, plan, { env, ctx: capCtx })
      mark('commit:end')
      if (res.ok && wholly) {
        res.lines = expansion.lines
        if (res.undo) res.undo.lines = expansion.lines
      }
      // Persistence acknowledgment (board changes): the receipt and its Undo wait for the server.
      saved = res.ok ? (selfSaved(plan.plans) ? { ok: true } : await persistBoard(host, ops)) : { ok: true }
      if (res.ok && saved.ok) saved = await confirmDrawings(host, drawingRefsOfPlan(plan))
    } finally {
      // Reached an outcome (even a thrown one): no longer in flight. Only a reload/close skips this.
      writeLocal(AGENT_INFLIGHT_KEY, null)
    }
    mark('persist', saved.ok ? 'ok' : saved.reason)
    if (res.undo && saved.ok) {
      undoRef.current = [...undoRef.current, res.undo].slice(-UNDO_MAX)
    }
    if (res.ok) {
      // A composed request says first what its producers actually returned.
      // (the held Save's line FOLLOWS the add's — "Added “X” to QQQ · Saved to your indicators…")
      const lines = [...(composed ? [...composed.lines, ...res.lines] : res.lines), ...leadLines]
      if (lead) lead.used = true
      if (!saved.ok) {
        push({ role: 'receipt', lines, undoId: null, notes: [UNSAVED_NOTE[saved.reason] || UNSAVED_NOTE['not-saved']], unsaved: true })
        record({ member, outcome: `${lines.join(' · ')} · NOT SAVED (${saved.reason})`, outcomeData: { kind: 'applied-unsaved', actions, lines, reason: saved.reason }, telemetry: { path, disposition: 'apply', actions, voice, refused: true } })
        return
      }
      const next = [...(Array.isArray(res.followUps) ? res.followUps : []), ...landDeferred(deferred, res.created, pendingNames, suggested === 'approved')]
      // OWNER 2026-10-12: a Save followed by ONE chart add says both in ONE message — this receipt is
      // HELD and becomes the add's lead (said first in its message; said on its own if the add never runs)
      const holdForAdd = next.length === 1 && !!next[0].awaitDefinition && !deferred.length
      // a target UCT chose for the member (the chart they clicked) is NAMED on the receipt, so a bare
      // "switch to weekly" on a board of several charts never leaves them guessing which one changed
      if (!holdForAdd) push({ role: 'receipt', lines, undoId: res.undo?.id || null, notes: [...(onTarget ? [onTarget] : []), ...(wholly ? [] : plan.noops), ...undoNotesFor(plan, res)] })
      record({ member, outcome: lines.join(' · '), outcomeData: { kind: 'applied', actions, lines }, telemetry: { path, disposition: 'apply', actions, voice } })
      // ⭐ GATE C session memory: what was ACTUALLY committed (targets as chart refs) — "do the same on the
      // right one", "put a 20 EMA on it" resolve from here (agent/references.js), re-validated on use
      rememberChange(memoryRef.current, host, ops)
      if (next.length) return { followUps: next, ...(holdForAdd ? { held: { lines, used: false } } : {}) }
    } else {
      // a failure that carries its own complete sentence (`say`) is said as-is — never wrapped twice
      const text = res.failed.every(f => f.say) ? res.failed.map(f => f.say).join(' ')
        : `Some of that didn't take effect: ${res.failed.map(f => f.say || `${f.label} ${f.reason}`).join('; ')}.`
      if (res.lines.length) push({ role: 'receipt', lines: res.lines, undoId: res.undo?.id || null })
      refusalPush(text)
      const gates = res.failed.map(f => f.gate).filter(Boolean)            // diagnostics only, never shown
      record({ member, outcome: [res.lines.join(' · '), text].filter(Boolean).join(' · '), outcomeData: { kind: 'failed', actions, ...(gates.length ? { gates } : {}) }, telemetry: { path, refused: true, actions, voice } })
    }
  }, [host, push, record, capCtx])

  // Every execution is traced (agent/trace.js): phase timestamps, memory only.
  const execute = useCallback(async (opsIn, { path, mode: suggested, member, voice, chosen = false, approval = null, card = null, onTarget = null }) => {
    // ⛔ M3: with several indicator drafts open, a request on one the member has not selected is
    // never planned — they are shown the drafts and pick one (chooseTarget), nothing changes.
    // ARGUMENT RESOLUTION: a capability may turn the member's WORDS in an argument into a real
    // resource (`resolveArgs`: one match → its id; several → ask which, with the real names). The
    // same rule for instant, model-planned and approved requests — never left to the model alone.
    if (!chosen) {
      for (let i = 0; i < opsIn.length; i++) {
        const cap = getCapability(opsIn[i]?.action)
        if (typeof cap?.resolveArgs !== 'function') continue
        let r = null
        try { r = cap.resolveArgs(opsIn[i].args || {}, host) } catch { r = null }
        if (r?.ask) {
          pendingRef.current = { kind: 'target', ops: opsIn, path, mode: suggested, member, voice, epoch: epochOf(host), pickArg: { action: opsIn[i].action, arg: r.ask.arg } }
          push({ role: 'question', text: r.ask.text, choices: r.ask.choices, local: true })
          record({ member, outcome: r.ask.text, outcomeData: { kind: 'clarify-arg', actions: opsIn.map(o => o?.action) }, telemetry: { path, disposition: 'clarify', voice } })
          return undefined
        }
        if (r?.args) opsIn = opsIn.map((o, j) => (j === i ? { ...o, args: r.args } : o))
      }
    }
    const amb = chosen ? null : draftAmbiguity(host, opsIn)
    if (amb) {
      pendingRef.current = { kind: 'target', ops: opsIn, path, mode: suggested, member, voice, epoch: epochOf(host), draft: true }
      push({ role: 'question', text: amb.text, choices: amb.choices, local: true })
      record({ member, outcome: amb.text, outcomeData: { kind: 'clarify-draft', actions: opsIn.map(o => o?.action) }, telemetry: { path, disposition: 'clarify', voice } })
      return undefined
    }
    // refinement B: retrying the add of the definition the Agent just SAVED — refresh the member's
    // list first (bounded); if it still lags, say so truthfully. Never a second Save.
    const ls = lastSaved()
    const retry = ls && opsIn.find(o => o?.action === 'indicator.add' && o.args?.defId === ls.defId)
    if (retry && !(await definitionListed({ defId: ls.defId, version: ls.version }))) {
      const text = `${ls.name ? `“${ls.name}”` : 'It'} is saved, but your indicator list still hasn’t caught up, so I didn’t add it — try again in a moment (it won’t be saved twice).`
      push({ role: 'refusal', text })
      record({ member, outcome: text, outcomeData: { kind: 'refused', actions: opsIn.map(o => o?.action) }, telemetry: { path, refused: true, voice } })
      return undefined
    }
    // ⭐ R1: "save it as X" — the rename is its own draft step FIRST (own receipt + Undo); the Save is
    // then proposed on the renamed draft, so the card shows the final name and its exact warning
    const split = suggested === 'approved' ? null : splitSaveAs(host, opsIn)
    if (split) {
      if (split.rename) {
        const r = renameBeforeSave(host, split.rename.target, split.rename.name)
        const entry = r.undoData ? undoEntryFor(host, { kind: 'indicatorDrafts', ref: split.rename.target, label: 'the draft', lines: [r.line || 'Renamed the draft'], undoData: r.undoData }) : null
        if (entry) undoRef.current = [...undoRef.current, entry].slice(-UNDO_MAX)
        if (!r.ok) {
          // refused, or (defence in depth) more than a rename: never a Save proposal over it
          push({ role: 'refusal', text: r.text, undoId: entry?.id || null })
          record({ member, outcome: r.text, outcomeData: { kind: 'refused', actions: ['indicator.saveDraft'] }, telemetry: { path, refused: true, voice } })
          return undefined
        }
        if (!r.skipped) {
          push({ role: 'receipt', lines: [r.line], undoId: entry?.id || null })
          record({ member, outcome: r.line, outcomeData: { kind: 'applied', actions: ['indicator.renameDraft'], lines: [r.line] }, telemetry: { path, disposition: 'apply', voice } })
        }
      }
      opsIn = [split.save]
    }
    turnPath(path)
    traceStart(`${path}:${suggested || 'apply'}`)
    let out
    try {
      out = await executeInner(opsIn, { path, mode: suggested, member, voice, approval, card, onTarget })
    } finally { traceEnd('done') }
    // ⭐ M3: the confirmed Save's chart adds — ONE execution per op, each planned, permission-checked,
    // persisted, confirmed and receipted on its own (a failure never undoes another chart or the Save)
    const held = out?.held || null                    // a Save's receipt waiting to lead its chart add
    for (const { awaitDefinition, ...op } of out?.followUps || []) {
      if (awaitDefinition && !(await definitionListed(awaitDefinition))) {
        const chart = (() => { try { return host.charts.read(String(op.target).replace(/^ixe:/, ''))?.label || 'that chart' } catch { return 'that chart' } })()
        // refinement B: the SAVED definition is kept (context `lastSaved`) — a retry adds the same one, never a second Save
        const nm = awaitDefinition.name ? `“${awaitDefinition.name}”` : 'It'
        const text = `${nm} is saved, but your indicator list hasn’t caught up yet, so I didn’t add it to ${chart} — ask me to add it again in a moment (it won’t be saved twice).`
        if (held && !held.used) { held.used = true; push({ role: 'receipt', lines: held.lines, undoId: null }) }
        push({ role: 'refusal', text })
        record({ member, outcome: text, outcomeData: { kind: 'refused', actions: [op.action] }, telemetry: { path: 'followup', refused: true, voice } })
        continue
      }
      traceStart('followup:apply')
      const { followNote, approvedStep, ...one } = op
      try { await executeInner([one], { path: 'followup', mode: approvedStep ? 'approved' : 'apply', member, voice, note: followNote || null, lead: held }) } finally { traceEnd('done') }
    }
    // a held Save receipt is ALWAYS said — on its own if no step used it (never a silent save)
    if (held && !held.used) push({ role: 'receipt', lines: held.lines, undoId: null })
    return undefined
  }, [executeInner, definitionListed, host, push, record])

  const doUndo = useCallback(async (undoId, { member, voice } = {}) => {
    const stack = undoRef.current
    const entry = undoId ? stack.find(e => e.id === undoId) : stack[stack.length - 1]
    if (!entry) {
      const text = 'There is nothing of mine to undo in this session.'
      push({ role: 'outcome', text })
      record({ member, outcome: text, outcomeData: { kind: 'undo-none' }, telemetry: { path: 'fast', undo: true, voice } })
      return
    }
    const guarded = undoProtectionRefusal(host, entry)
    if (guarded) {
      const text = `I didn't undo anything: ${guarded}`
      push({ role: 'refusal', text })
      record({ member, outcome: text, outcomeData: { kind: 'undo-refused-protected' }, telemetry: { path: 'fast', undo: true, refused: true, voice } })
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
      let saved = entry.epoch != null && host?.persist && !selfSaved(entry.items)
        ? await (async () => { try { const r = await host.persist(); return r && r.ok ? { ok: true } : { ok: false, reason: (r && r.reason) || 'not-saved' } } catch { return { ok: false, reason: 'not-saved' } } })()
        : { ok: true }
      if (saved.ok) saved = await confirmDrawings(host, entry.items.filter(it => it.kind === 'drawing').map(it => it.ref))
      if (!saved.ok) {
        push({ role: 'receipt', lines: res.lines, undoId: null, isUndo: true, unsaved: true, notes: [UNSAVED_NOTE[saved.reason] || UNSAVED_NOTE['not-saved']] })
        record({ member, outcome: `${res.lines.join(' · ')} · NOT SAVED (${saved.reason})`, outcomeData: { kind: 'undo-unsaved' }, telemetry: { path: 'fast', undo: true, voice, refused: true } })
        rerender()
        return
      }
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
    // ⛔ F6: an expired proposal is never applied — the member asks again and approves the current version
    if (p.expiresAt != null && !(Date.now() <= p.expiresAt)) {
      patchItem(p.id, { status: 'expired' })
      const text = `That proposal expired (a proposal is good for 10 minutes), ${STALE_PROPOSAL}`
      push({ role: 'refusal', text })
      record({ member, outcome: text, outcomeData: { kind: 'refused-expired', actions: p.ops.map(o => o?.action) }, telemetry: { path: 'approved', refused: true, voice } })
      return
    }
    // a sealed or fanned-out proposal is approved whole (its parts were approved together)
    if (count && p.card) {
      pendingRef.current = p
      push({ role: 'refusal', text: 'That proposal can only be applied as a whole — say “do it”, or dismiss it.' })
      return
    }
    patchItem(p.id, { status: 'approved' })
    const ops = count ? p.ops.slice(0, count) : p.ops
    await execute(ops, { path: 'approved', mode: 'approved', member, voice, approval: p.seals || null, card: p.card || null })
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
    if (!p.draft && p.epoch !== epochOf(host)) {
      push({ role: 'refusal', text: "A different layout is open now, so I didn't change anything. Ask again." })
      return
    }
    if (p.pickArg) {
      const { action, arg } = p.pickArg
      await execute(p.ops.map(o => (o.action === action ? { ...o, args: { ...o.args, [arg]: ref } } : o)), { path: p.path, mode: p.mode === 'propose' ? 'propose' : 'apply', member: `${p.member || ''} → ${label}`, voice: p.voice })
      return
    }
    if (p.draft) {
      // the member picked a draft: it becomes the selected one; only the draft ops are re-aimed
      if (!selectDraft(host, ref)) { push({ role: 'refusal', text: 'That draft is no longer available, so nothing changed.' }); return }
      await execute(p.ops.map(o => (isDraftAction(o.action) ? { ...o, target: ref } : o)), { path: p.path, mode: p.mode === 'propose' ? 'propose' : 'apply', member: `${p.member || ''} → ${label}`, voice: p.voice, chosen: true })
      return
    }
    // (a model PROPOSAL re-aimed by a "which chart?" pick stays a proposal; fast picks set no mode)
    await execute(p.ops.map(o => ({ ...o, target: ref })), { path: p.path, mode: p.mode === 'propose' ? 'propose' : 'apply', member: `${p.member} → ${label}`, voice: p.voice })
  }, [execute, push, host])

  const send = useCallback(async (raw, { voice = false, answering = false } = {}) => {
    const text = String(raw || '').trim()
    if (!text || lockRef.current) return
    lockRef.current = true
    turnStart('send')
    saidRef.current = text
    push({ role: 'member', text, voice })
    setBusy(true)
    try {
      if (gridMode) {
        const t = 'UCT Agent works on the Charts workspace. Switch out of Multi Chart (Layouts ▸ Multi Chart) and ask again.'
        push({ role: 'agent', text: t })
        record({ member: text, outcome: t, outcomeData: { kind: 'unsupported' }, telemetry: { path: 'local', disposition: 'unsupported', unsupported: 'multichart', voice } })
        return
      }
      // A choice clicked under the MODEL's own question answers that question:
      // it goes back to the model (which has the conversation), never through the
      // fast path, which would act on the bare label ("Hide volume") out of context.
      // ⭐ GATE C REFERENCES (agent/references.js): "open the third one", "compare it to the others", "do
      // the same on the right one" — from session memory, re-validated against the live board. Never while
      // a question or an authoring answer is waiting (those words answer THAT). A reference that cannot hold
      // is said plainly (`say`); one it cannot read goes on to the instant path / the model as before.
      const epochNow = epochOf(host)
      // GATE C: the member CORRECTING the Agent ("no, I meant the weekly", "not that one") — kept as context
      // for the model (session memory → conversation_memory.recent_corrections); never acted on by itself
      if (CORRECTION.test(text)) memoryRef.current.noteCorrection(text)
      const memRef = (answering || pendingRef.current || peekAuthoringIntent()) ? null
        : resolveReference(text, { host, memory: memoryRef.current, epoch: epochNow })
      if (memRef?.kind === 'say') {
        push({ role: 'agent', text: memRef.text })
        record({ member: text, outcome: memRef.text, outcomeData: { kind: 'reference-refused' }, telemetry: { path: 'fast', disposition: 'clarify', voice } })
        return
      }
      // "put a 20 EMA on it" with several charts and no click: `it` = the chart this conversation last changed
      const fast = answering ? null : subjectTarget(memRef || fastParse(text, { host }), text, { host, memory: memoryRef.current, epoch: epochNow })
      if (fast?.kind === 'undo') return await doUndo(null, { member: text, voice })
      if (fast?.kind === 'confirm' && pendingRef.current?.kind === 'proposal') return await approve(null, { member: text, voice })
      if (fast?.kind === 'subset' && pendingRef.current?.kind === 'proposal') return await approve(fast.count, { member: text, voice })
      if (fast?.kind === 'dismiss' && pendingRef.current) return dismiss({ member: text })
      // ⭐ INDICATORS ⇄ AGENT — the member is answering "What indicator would you like to build?"
      // (asked when the chart's Create Indicator / Modify door opened the Agent): THIS message is the
      // request, sent to the existing `indicator.draft` for that chart — before the fast path's actions, which
      // would read "a 20 EMA crossover…" as an indicator add, and before "nothing is waiting" (its
      // "never mind" sets THIS question aside). Undo and a pending proposal keep priority. One message answers it.
      const authoring = answering ? null : takeAuthoringIntent()
      if (authoring) {
        if (isCancelWords(text)) {
          const t = 'OK — nothing was built.'
          push({ role: 'agent', text: t })
          record({ member: text, outcome: t, outcomeData: { kind: 'authoring-cancelled' }, telemetry: { path: 'local', voice } })
          return
        }
        lastActionsRef.current = ['indicator.draft']
        return await execute([authoringOp(authoring, text)], { path: 'fast', mode: 'apply', member: text, voice })
      }
      // "do it" / "just the first two" with NOTHING pending never goes to the
      // model: after a reload or a chat switch the history still shows the old
      // proposal, and the model would REGENERATE and apply it. Approval only ever
      // executes a stored, re-validated plan.
      // OWNER 2026-10-12: "Apply it." with NO proposal waiting may be a capability's own phrase (apply the
      // indicator draft) — never an approval of anything; it runs only if that capability claims it.
      if (fast?.kind === 'confirm' && !pendingRef.current) {
        const alt = fastParse(text, { host, controlWords: false })
        if (alt?.kind === 'ops' && alt.ops.every(o => o.target)) {
          lastActionsRef.current = alt.ops.map(o => o.action)
          return await execute(alt.ops, { path: 'fast', mode: 'apply', member: text, voice })
        }
      }
      if (fast?.kind === 'confirm' || fast?.kind === 'subset' || fast?.kind === 'dismiss') {
        const t = fast.kind === 'dismiss' ? 'Nothing is waiting — nothing changed.'
          : "There is no proposal waiting to apply. Tell me what you'd like to change."
        push({ role: 'agent', text: t })
        record({ member: text, outcome: t, outcomeData: { kind: 'nothing-pending' }, telemetry: { path: 'fast', voice } })
        return
      }
      // Ops whose capability already resolved the target (a named saved list) run as-is.
      if (fast?.kind === 'ops' && fast.ops.every(o => o.target)) {
        lastActionsRef.current = fast.ops.map(o => o.action)
        return await execute(fast.ops, { path: 'fast', mode: 'apply', member: text, voice })
      }
      // Phase 2: ops of SEVERAL kinds ("add VWAP and switch to 5 minutes") — each kind must name
      // exactly one target (after a position hint); otherwise the model decides.
      if (fast?.kind === 'ops' && kindsOf(fast.ops).length > 1 && !fast.target?.all) {
        const pick = {}
        for (const k of kindsOf(fast.ops)) {
          let list = getTargetKind(k)?.list(host) || []
          if (fast.target?.position && list.length > 1) list = matchPosition(list, fast.target.position)
          if (list.length === 1) pick[k] = list[0].ref
        }
        if (fast.ops.every(o => o.target || pick[getCapability(o.action)?.target])) {
          const ops = fast.ops.map(o => (o.target ? o : { ...o, target: pick[getCapability(o.action).target] }))
          lastActionsRef.current = ops.map(o => o.action)
          return await execute(ops, { path: 'fast', mode: 'apply', member: text, voice })
        }
      }
      if (fast?.kind === 'ops' && kindsOf(fast.ops).length === 1) {
        const kind = getTargetKind(kindsOf(fast.ops)[0])
        const charts = kind ? kind.list(host) : []
        if (charts.length === 0) {
          const t = 'There is nothing on this workspace for that to change.'
          push({ role: 'agent', text: t })
          record({ member: text, outcome: t, outcomeData: { kind: 'refused', actions: fast.ops.map(o => o?.action) }, telemetry: { path: 'fast', refused: true, voice } })
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
        const noun = kind.noun || kind.name
        let ask = `Which ${noun}?`
        if (fast.target?.position && charts.length > 1) {
          const hit = matchPosition(charts, fast.target.position)
          if (hit.length) candidates = hit
          else ask = `I don't see a ${fast.target.position} ${noun}. Which one?`
        }
        // Context & Awareness 1B: "this chart / this stock / it" → the chart the member last CLICKED
        // (agent/deixis.js). No live selection → the question below, exactly as before.
        let implicitTarget = null
        if (!fast.target?.position && candidates.length > 1) {
          const d = resolveDeictic({ host, kind, candidates, text, chartOp: true })
          if (d?.ref) candidates = candidates.filter(c => c.ref === d.ref)
          if (d?.implicit && candidates.length === 1) implicitTarget = `On ${candidates[0].label || 'the chart you selected'} — the chart you last clicked.`
        }
        const unmatchedHint = fast.target?.position && charts.length > 1 && candidates === charts
        if (candidates.length > 1 || unmatchedHint) {
          pendingRef.current = { kind: 'target', ops: fast.ops, path: 'fast', member: text, voice, epoch: epochOf(host) }
          push({ role: 'question', text: ask, choices: candidates.map(c => ({ ref: c.ref, label: c.label })), local: true })
          record({ member: text, outcome: 'Asked which target.', outcomeData: { kind: 'clarify-target', actions: fast.ops.map(o => o?.action) }, telemetry: { path: 'fast', clarified: true, voice } })
          return
        }
        return await execute(fast.ops.map(o => ({ ...o, target: candidates[0].ref })), { path: 'fast', mode: 'apply', member: text, voice, onTarget: implicitTarget })
      }

      // ⛔ F2b: "save it" with indicator drafts open but none selected — ask what to save (no model call)
      const ref = answering ? null : saveReferent(host, text)
      if (ref && ref.kind === 'ask') {
        push({ role: 'question', text: ref.text, choices: ref.choices, local: true })
        record({ member: text, outcome: ref.text, outcomeData: { kind: 'clarify-save-target' }, telemetry: { path: 'fast', disposition: 'clarify', voice } })
        return
      }
      // ── model path ──
      // Context from every registered provider; actions from every AVAILABLE
      // capability's manifest. Nothing here names a feature. Data that can change outside
      // this panel is re-read first (bounded), so the model never targets a stale list.
      const p = pendingRef.current
      // Capability ROUTING (agent/routing.js): only the action groups this message needs, the
      // others named. If the model needs a group it wasn't given it plans NOTHING and says so
      // (need_groups); we ask ONCE more with those groups. Nothing has executed in between.
      // M2 indicator writes are offered only when some chart on this board can manage indicators.
      const manageIndicators = (() => { try { return host?.charts?.list().some(c => host.charts.canManageIndicators?.(c.ref) === true) } catch { return false } })()
      const full = manifestFor({ ...capCtx, manageIndicators })
      // limit = the server's per-request maximum; budget = what one routed request may carry.
      // Gate B (0C): the member's live names and the lexicon's typo readings route too (routing.js)
      const routeOpts = { enabled: routingEnabled(), pendingActions: p?.kind === 'proposal' ? p.ops.map(o => o.action) : [], recentActions: lastActionsRef.current, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold,
        names: routingNames(host), correct: (t) => (correctTypos(t, lexiconFor(host)) || []).map(v => v.text) }
      let routed = routeManifest(full, text, routeOpts)
      mark('route', routed.routing ? `${routed.manifest.length}/${full.length}` : 'full')
      // Data that can change outside this panel is re-read first (bounded) — Phase 2: only for the
      // action groups this message was routed to (a timeframe change no longer waits on alerts).
      turnPath('model')
      await refreshContext(1500, { groups: routed.routing ? (routed.refresh || routed.routing.selected) : null })
      mark('context:refreshed')
      let { context, refMap } = buildContext(host, { ...capCtx, message: text })
      mark('context:built')
      const back = Object.fromEntries(Object.entries(refMap).map(([k, v]) => [v.ref, k]))
      const pending = p?.kind === 'proposal'
        // Transaction-local aliases (new1…) are not context refs: they pass through.
        ? { ops: p.ops.map(o => ({ ...o, target: back[o.target] || o.target })) }
        : null
      const live = streamLine()
      // ⭐ GATE C: what this chat showed and did (tickers in the order shown, the last change's actions), so a
      // follow-up the instant path could not read still reaches the model with its referent. Never values.
      const memoryFor = () => {
        const m = memoryRef.current.forModel()
        if (!m) return null
        return m.subject_chart ? { ...m, subject_chart: back[m.subject_chart] || null } : m
      }
      const ask = (r, extra = {}) => {
        const mem = memoryFor()
        const b = {
          conversationId: conversationRef.current, message: text, voice, pending,
          context: mem ? { ...context, conversation_memory: mem } : context, capabilities: r.manifest, manifestVersion: MANIFEST_VERSION, routing: r.routing, ...extra,
        }
        return serverStreams() ? agentTurnStream(b, live.onEvent) : agentTurn(b)
      }
      mark('turn:sent')
      let res = await ask(routed)
      mark('turn:received', res.ok ? stagesOf(res.data) : res.status || 'error')
      const need = res.ok ? (res.data.envelope?.need_groups || []).filter(g => !routed.routing?.selected?.includes(g)) : []
      if (res.ok && routed.routing && need.length) {
        if (res.data.conversationId !== conversationRef.current) setConversationId(res.data.conversationId)
        // The groups the model needs come first; whatever no longer fits the budget is dropped
        // from THIS request (named, not sent). If a needed group itself cannot fit, stop honestly.
        routed = routeManifest(full, text, routeOpts, need)
        live.settle(null)
        if (!need.every(g => routed.routing?.selected?.includes(g) || !routed.routing)) {
          push({ role: 'agent', text: 'That touches too many parts of UCT for one request. Try asking for one part at a time.' })
          return
        }
        mark('reroute', need.join(','))
        // the newly needed groups' data is read fresh, and the context rebuilt from it
        await refreshContext(1500, { groups: need });
        ({ context, refMap } = buildContext(host, { ...capCtx, message: text }))
        res = await ask(routed, { conversationId: res.data.conversationId, reroute: true })
        mark('reroute:received', res.ok ? stagesOf(res.data) : res.status || 'error')
        if (res.ok && (res.data.envelope?.need_groups || []).length) {
          live.settle(null)
          push({ role: 'agent', text: 'That needs more of UCT than I can plan in one step. Try asking for one part at a time.' })
          return
        }
      }
      if (!res.ok) { live.settle(null); push({ role: 'error', text: res.error }); return }
      if (res.data.conversationId !== conversationRef.current) setConversationId(res.data.conversationId)
      const env = res.data.envelope
      const sources = res.data.usage?.citations || []
      const talk = env.disposition === 'answer' || env.disposition === 'unsupported'
      // the final reply replaces whatever streamed (or the streamed line goes, for anything else)
      const streamed = live.settle(talk ? { text: env.reply, sources } : null)
      if (talk) {
        if (!streamed) push({ role: 'agent', text: env.reply, sources })
        return
      }
      if (env.disposition === 'clarify') {
        pendingRef.current = p                     // a question doesn't drop a waiting proposal
        push({ role: 'question', text: env.question?.text || env.reply, choices: (env.question?.choices || []).map(c => ({ label: c })) })
        return
      }
      // apply / propose: translate the context refs back to real target refs
      // ⛔ LOCAL-RESULT BOUNDARY: a plan holding a local-only lookup shows UCT's answer, never the
      // model's own words about it (the server blanks that reply too). The one exception is the
      // SERVER's own deterministic notice (`local_notice`) saying which part was not done.
      const localPlan = (env.ops || []).some(o => getCapability(o?.action)?.localOnly)
      // OWNER 2026-10-12: a bare acknowledgement ("On it.") before an APPLY's receipt is a second message
      // that says nothing — the receipt is the confirmation. Anything substantive still shows.
      const bareAck = env.disposition === 'apply' && BARE_ACK.test(String(env.reply || '').trim())
      if (env.reply && !bareAck && (!localPlan || env.local_notice === true)) push({ role: 'agent', text: env.reply, sources })
      if (p?.kind === 'proposal') { pendingRef.current = null; patchItem(p.id, { status: 'replaced' }) }
      // A reference that names a context target (a saved list's ref) is bound to
      // that target's own read-only producer before the refs are translated.
      const bound = translateRefs(bindSourceRefs(env.ops, refMap, { host, message: text }), refMap)
      // ⛔ S6 F1–F3: the model's plan is checked against the member's own words before anything runs
      const screened = screenModelOps(host, bound, text, capCtx)
      if (screened.ask) {
        // a pick that fills one argument of the planned ops (a new draft's chart): chooseTarget runs them with it
        if (screened.ask.pick) pendingRef.current = { kind: 'target', ops: screened.ask.pick.ops, path: 'model', mode: env.disposition, member: text, voice, epoch: epochOf(host), pickArg: screened.ask.pick }
        push({ role: 'question', text: screened.ask.text, choices: screened.ask.choices, local: true })
        record({ member: null, outcome: screened.ask.text, outcomeData: { kind: 'clarify-save-target', actions: bound.map(o => o?.action) }, telemetry: { path: 'model', disposition: 'clarify', voice } })
        return
      }
      for (const n of screened.notes) push({ role: 'agent', text: n })
      // Context & Awareness 1B: a deictic request ("this chart", "this stock", "make it weekly") runs
      // only on the chart the member selected — never on a chart the model picked by itself. Nothing
      // executes before the member answers; their pick resumes THIS plan (no second model call).
      const deictic = screenDeicticOps({ host, ops: screened.ops, text, getTargetKind, getCapability })
      if (deictic?.ask) {
        const kinds = kindsOf(screened.ops)
        if (kinds.length === 1) {
          pendingRef.current = { kind: 'target', ops: screened.ops, path: 'model', mode: env.disposition, member: text, voice, epoch: epochOf(host) }
          push({ role: 'question', text: deictic.ask.text, choices: deictic.ask.choices, local: true })
        } else {
          push({ role: 'agent', text: 'Which chart do you mean? Click it (or say left, right…) and ask again — nothing has changed yet.' })
        }
        record({ member: null, outcome: deictic.ask.text, outcomeData: { kind: 'clarify-deictic', actions: screened.ops.map(o => o?.action) }, telemetry: { path: 'model', disposition: 'clarify', voice } })
        return
      }
      // S6 F4: a new chart for a named ticker is born on it (not linked), even if the plan dropped the ticker
      const ops = screenNewChart(screened.ops, text).ops
      lastActionsRef.current = ops.map(o => o.action)
      await execute(ops, { path: 'model', mode: env.disposition, member: null, voice })
    } finally {
      lockRef.current = false
      setBusy(false)
      setActivity(null)
      turnEnd()
    }
  }, [push, gridMode, host, record, doUndo, approve, dismiss, execute, setConversationId, patchItem, capCtx, streamLine])

  // ⭐ INDICATORS ⇄ AGENT — the chart's Create Indicator / Modify door opened the Agent on a chart:
  // ask the question and hold ONE intent (indicatorEntry.js). No model call; the member's answer is
  // what runs. Create offers the existing builder's doors beside it.
  const prompt = useCallback((request) => {
    if (!request || !request.chartRef || lockRef.current) return false
    const i = beginAuthoringIntent(request)
    if (!i) return false
    const text = authoringPrompt(i)
    push({ role: 'question', text, local: true, authoring: true,
      choices: i.defId ? [] : INDICATOR_DOORS.map(d => ({ label: d.label, door: d.door })) })
    record({ member: null, outcome: text, outcomeData: { kind: 'authoring-prompt', chart: i.chartRef, edit: i.defId }, telemetry: { path: 'local', disposition: 'clarify' } })
    return true
  }, [push, record])
  // A door beside the question: the existing builder, on the intent's chart (the intent is set aside).
  const openDoor = useCallback((door) => {
    const i = peekAuthoringIntent()
    if (!i) return false
    clearAuthoringIntent()
    const r = openIndicatorDoor(host, i.chartRef, door)
    push({ role: 'agent', text: r.text })
    return r.ok
  }, [host, push])

  const newChat = useCallback(() => {
    setConversationId(null)
    pendingRef.current = null
    memoryRef.current.clear()             // GATE C: memory belongs to one chat
    setItems([])
  }, [setConversationId])

  const openConversation = useCallback(async (id) => {
    const conv = await agentConversation(id)
    if (!conv) return
    pendingRef.current = null
    memoryRef.current.clear()             // a reopened chat's old rows are history, not live references
    setConversationId(id)
    setItems(itemsFromTurns(conv.turns))
  }, [setConversationId])

  const canUndo = (undoId) => undoRef.current.some(e => e.id === undoId)

  // ⭐ OPEN CHART (2026-10-13, owner rev. 2). A card's own typed target (present.chartTarget — set by the
  // capability from what it answered; never the card's words) opens by REUSING a chart:
  //   • one chart on the board   → that chart switches to it now (chart.setSymbol: the platform's own
  //                                symbol switch — timeframe, settings, size and place kept; linked
  //                                widgets follow exactly as a manual symbol search does) + Undo;
  //   • several charts           → "Which chart?" with one choice per chart (its position and what it
  //                                shows) and Cancel — only the chart picked changes;
  //   • no chart                 → the safe add (widget.addCharts: one new chart if there is room).
  // A chart already showing it is left as it is (no duplicate). Protected layouts, the symbol check
  // and Undo apply as for any request; a NEW chart only when there is none (or the member asks for one
  // in words: "open NASDAQ:A50 in a new chart").
  const openChart = useCallback(async (raw) => {
    const target = chartTarget(raw)
    if (!target) return
    const sym = target.symbol
    const charts = (() => { try { return host?.charts?.list?.() || [] } catch { return [] } })()
    const member = `Open chart: ${target.label}`
    const said = (text, kind, role = 'agent') => {
      push({ role, text })
      record({ member, outcome: text, outcomeData: { kind }, telemetry: { path: 'card', ...(role === 'refusal' ? { refused: true } : {}) } })
    }
    const shown = charts.find(c => String(c?.symbol || '').toUpperCase() === sym)
    if (shown) return said(`${target.label} is already on your board (${shown.label || 'a chart'}), so nothing changed.`, 'chart-already-open')
    if (!charts.length) {
      lastActionsRef.current = ['widget.addCharts']
      // The click IS the approval of exactly this: ONE new chart on this ONE series. `approved` re-plans
      // and re-validates like an Apply — the room, symbol and protection checks all still decide.
      return execute([{ action: 'widget.addCharts', target: 'workspace', args: { symbols: [sym], timeframe: null, chart_type: null, exact: null } }],
        { path: 'card', mode: 'approved', member, voice: false })
    }
    // a protected layout: said BEFORE asking which chart (the pick could only be refused)
    if (protectedOpenLayout(host)) {
      return said(protectionRefusal(host, { plans: [{ changed: true, kind: 'chart' }] }) || 'This layout is protected, so nothing changed.', 'refused-protected', 'refusal')
    }
    const op = { action: 'chart.setSymbol', args: { symbol: sym } }
    lastActionsRef.current = ['chart.setSymbol']
    if (charts.length === 1) return execute([{ ...op, target: charts[0].ref }], { path: 'card', mode: 'apply', member, voice: false })
    // several: the member picks — labels made unique when two charts read alike ("Top chart (QQQ)" ×2)
    // (each names what it shows now — the host's label carries it; added when a label does not)
    const named = charts.map((c, i) => {
      const base = c.label || `Chart ${i + 1}`
      return c.symbol && !base.includes(c.symbol) ? `${base} (${c.symbol})` : base
    })
    const seen = new Map()
    for (const l of named) seen.set(l, (seen.get(l) || 0) + 1)
    let n = 0
    const choices = charts.map((c, i) => ({ ref: c.ref, label: seen.get(named[i]) > 1 ? `${named[i]} · ${++n}` : named[i] }))
    pendingRef.current = { kind: 'target', ops: [op], path: 'card', member, voice: false, epoch: epochOf(host) }
    push({ role: 'question', text: `Which chart should show ${target.label}?`, choices: [...choices, { label: 'Cancel', cancel: true }], local: true })
    record({ member, outcome: 'Asked which chart.', outcomeData: { kind: 'clarify-target', actions: ['chart.setSymbol'] }, telemetry: { path: 'card', clarified: true } })
  }, [host, push, record, execute])

  return {
    items, busy, activity, restoring, conversationId, send, newChat, openConversation,
    undo: exclusive((undoId) => doUndo(undoId, { member: null })),
    approve: exclusive(() => approve(null, { member: null })), dismiss: () => { if (!lockRef.current) dismiss({ member: null }) },
    chooseTarget: exclusive(chooseTarget), canUndo, openChart: exclusive(openChart),
    prompt, openDoor,
    hasPending: !!pendingRef.current,
  }
}
