// UCT Agent TRADING KNOWLEDGE (KN-1, agent-kn) — the Trading Brain's approved knowledge as three QUERY capabilities.
//
//   playbook.explain  knowledge.search   UCT-specific concepts and craft, from approved team-owned sources, cited
//   playbook.setup    setup.playbook     one UCT setup template (entry, stop, invalidation, common mistakes)
//   playbook.record   setup.record       a setup's historical record: sample size, method, 95 % interval, label
//
// Read-only: nothing is planned or committed, no Undo. Every read goes through marketdata/client.js
// (POST /api/agent/data) for the open turn. DARK BY CONSTRUCTION: a capability registers only while the server lists
// its kind in `data_kinds`, so with the kinds off the model's manifest is byte-identical. Only { text, table, link }
// leave this module — never the envelope or its notes verbatim, except a refusal's own sentence.

import { registerCapability, registerTargetKind, registerContextProvider, getTargetKind } from '../capabilities'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { kindServed } from './marketDataFacts'
import { GROUPS } from '../routing'

export const KNOWLEDGE_CAPS = { 'playbook.explain': 'knowledge.search', 'playbook.setup': 'setup.playbook', 'playbook.record': 'setup.record' }
const NO_TURN = "this needs the Agent's turn, which wasn't available"
const FOOTER = 'Educational, from UCT\'s approved knowledge base — not advice.'
const usable = (env) => !!env && (env.status === 'ok' || env.status === 'partial') && env.data && typeof env.data === 'object'
const day = (iso) => {
  if (!iso) return null
  const d = new Date(String(iso).replace(' ', 'T').replace(/(\d{2}:\d{2}:\d{2})$/, '$1Z'))
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const asOf = (env) => (day(env?.as_of) ? `UCT's playbook as of ${day(env.as_of)}` : 'UCT\'s playbook')
const staleLine = (env) => (env?.stale ? ' It has not been refreshed recently.' : '')
/** A refusal / unavailable read → the server's own one sentence (it is written for the member). */
const refusalText = (env, what) => {
  const why = Array.isArray(env?.notes) && typeof env.notes[0] === 'string' ? env.notes[0] : null
  return why ? `${why}.`.replace(/\.\.$/, '.') : `I couldn't read ${what} right now.`
}
/** a template field (string | list | object) → one plain line */
export function plain(v) {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(plain).filter(Boolean).join('; ')
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k.replace(/_/g, ' ')}: ${plain(x)}`).filter(s => !/: $/.test(s)).join('; ')
  return String(v)
}
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 10) / 10}%` : null)

// ── pure envelope → answer ───────────────────────────────────────────────────────────────────────────
export function answerFromSearch(env) {
  if (!usable(env)) return refusalText(env, "UCT's knowledge base")
  const ps = Array.isArray(env.data.passages) ? env.data.passages : []
  if (!ps.length) return `UCT's approved knowledge base has nothing on that yet (${asOf(env)}).`
  const lines = ps.map(p => {
    const who = [p.source, p.trader && p.trader !== 'UCT Team' ? p.trader : null, p.dated && day(p.as_of_post) ? `posted ${day(p.as_of_post)}` : null].filter(Boolean).join(' · ')
    return `• ${p.title}: ${p.excerpt} (${who})`
  })
  return {
    text: `From ${asOf(env)}:${staleLine(env)}\n${lines.join('\n')}\n${FOOTER}`,
    table: { columns: ['Source', 'Title', 'Category'], rows: ps.map(p => [p.source, p.title, p.category]) },
  }
}

const TEMPLATE_LINES = [
  ['description', 'What it is'], ['ideal_regime', 'Best market'], ['entry_triggers', 'Entry'], ['stop_methods', 'Stop'],
  ['max_stop_pct', 'Max stop'], ['profit_logic', 'Taking profits'], ['invalidation', 'Invalidation'], ['common_mistakes', 'Common mistakes'],
]
export function answerFromPlaybook(env) {
  if (!usable(env)) return refusalText(env, "UCT's setup templates")
  const d = env.data
  const head = `${d.name} — UCT setup template${d.family ? ` (${d.family}` : ''}${d.origin_trader ? `${d.family ? ', ' : ' ('}origin: ${d.origin_trader})` : (d.family ? ')' : '')}`
  const rows = TEMPLATE_LINES.map(([k, label]) => {
    if (d[k] == null) return null
    const v = k === 'max_stop_pct' ? pct(Number(d[k])) : plain(d[k])
    return v ? `${label}: ${v}` : null
  }).filter(Boolean)
  return {
    text: `${head}. ${asOf(env)}.${staleLine(env)}\n${rows.join('\n')}\n${FOOTER}`,
    link: d.link && d.link.href ? { href: d.link.href, label: d.link.label || 'Open the Setup Library' } : undefined,
  }
}

function recordLine(b) {
  if (!b) return null
  const m = b.method || 'record'
  if (b.label === 'insufficient_sample') return `${m}: not enough sample${b.n ? ` (${b.n} outcomes; UCT states a figure from ${b.n_min})` : ''}, so no figure is stated.`
  if (b.label === 'stale_record' || b.label === 'undated_record') return `${m}: ${b.label_text}.`
  const wr = b.win_rate_pct ?? b.win_rate_20d_pct
  const ci = b.win_rate_ci95 || b.win_rate_20d_ci95
  const fig = wr != null ? `win rate ${pct(wr)}${ci ? ` (95% interval ${ci[0]}–${ci[1]}%)` : ''}` : null
  const z = typeof b.edge_z === 'number' ? `, z = ${b.edge_z > 0 ? '+' : ''}${b.edge_z}` : ''
  return `${m}: n = ${b.n}${fig ? `, ${fig}` : ''}${z}. ${b.label_text}.`
}
export function answerFromRecord(env) {
  if (!usable(env)) return refusalText(env, "UCT's setup records")
  const d = env.data
  const lines = [recordLine(d.engine), recordLine(d.triggers), d.team_archive ? recordLine(d.team_archive) : null].filter(Boolean)
  return `${d.setup}${d.regime && d.regime !== 'ALL' ? ` in a ${d.regime} market` : ''} — UCT's historical record (${asOf(env)}).${staleLine(env)}\n`
    + `${lines.map(l => `• ${l}`).join('\n')}\n${d.caution || ''}`.trim()
}

// ── the reads ────────────────────────────────────────────────────────────────────────────────────────
export async function answerExplain(args = {}) {
  const turnId = currentTurnId()
  const env = turnId ? await readData('knowledge.search', { question: String(args.question || '').slice(0, 400), k: 3 }, { purpose: 'answer', turnId }) : null
  return env ? answerFromSearch(env) : `I couldn't read UCT's knowledge base: ${NO_TURN}.`
}
export async function answerSetup(args = {}) {
  const turnId = currentTurnId()
  const env = turnId ? await readData('setup.playbook', { setup: String(args.setup || '').slice(0, 60) }, { purpose: 'answer', turnId }) : null
  return env ? answerFromPlaybook(env) : `I couldn't read UCT's setup templates: ${NO_TURN}.`
}
export async function answerRecord(args = {}) {
  const params = { setup: String(args.setup || '').slice(0, 60) }
  if (args.regime) params.regime = String(args.regime).toUpperCase()
  const turnId = currentTurnId()
  const env = turnId ? await readData('setup.record', params, { purpose: 'answer', turnId }) : null
  return env ? answerFromRecord(env) : `I couldn't read UCT's setup records: ${NO_TURN}.`
}

// ── registration (server-gated, idempotent) ──────────────────────────────────────────────────────────
const SELF = { ref: 'playbook', label: "UCT's trading playbook (approved knowledge base)" }
const common = { surfaces: ['charts'], target: 'playbook', query: true }
const SPECS = {
  'playbook.explain': {
    summary: 'Answer a question about a trading concept, rule or craft from UCT\'s OWN approved knowledge base (the team\'s posts and playbook), cited. '
      + 'Use for "what does UCT mean by an EP?", "how does the team think about patience?", "where does UCT put the stop on a flag?". Never for prices or today\'s market.',
    hints: 'target = playbook. question: the member\'s question in their words.',
    args: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'], additionalProperties: false },
    answer: (_s, a) => answerExplain(a || {}),
  },
  'playbook.setup': {
    summary: 'Show one of UCT\'s setup templates by name or alias (EP, VCP, U&R, kicker…): entry, stop, max stop, invalidation, common mistakes. '
      + 'Use for "UCT\'s rules for a VCP", "max stop on an EP".',
    hints: 'target = playbook. setup: the setup name or alias as the member said it. If two templates share the name, UCT asks which.',
    args: { type: 'object', properties: { setup: { type: 'string' } }, required: ['setup'], additionalProperties: false },
    answer: (_s, a) => answerSetup(a || {}),
  },
  'playbook.record': {
    summary: 'Show a setup\'s historical record from UCT\'s data: sample size, method, a 95% interval and a reliability label; '
      + 'no figure below the minimum sample. Use for "how often does the EP work?", "win rate of the U&R in a red market".',
    hints: 'target = playbook. setup: name or alias. regime: ALL|GREEN|YELLOW|ORANGE|RED (null = ALL). Never call a figure a proven edge.',
    args: { type: 'object', properties: { setup: { type: 'string' }, regime: { type: ['string', 'null'], enum: ['ALL', 'GREEN', 'YELLOW', 'ORANGE', 'RED', null] } },
      required: ['setup', 'regime'], additionalProperties: false },
    answer: (_s, a) => answerRecord(a || {}),
  },
}

// the routing words, live only while a knowledge capability is registered (routing.js keeps the group's words empty)
export const PLAYBOOK_WORDS = [
  /\b(playbook|setup templates?|template for|rules? for|max(imum)? stop|invalidation|common mistakes|win ?rates?|hit rate|track record|how often does|sample size)\b/,
  /\b(what (is|are|does)|define|definition of|explain|teach me|how does (uct|the team))\b.*\b(ep|eps|episodic pivots?|vcp|u&r|undercut|kicker|htf|high tight flag|tight flags?|flags?|bases?|pivots?|setups?|breakouts?|pullbacks?|patience|discipline)\b/,
  /\b(according to|in) (uct|the team|the playbook)\b/,
]
const playbookGroup = () => GROUPS.find(g => g.id === 'playbook')
function armRouting(on) {
  const g = playbookGroup()
  if (g) g.words.splice(0, g.words.length, ...(on ? PLAYBOOK_WORDS : []))
}
const unregs = {}
let kindRegistered = false
/** Registers each playbook.* capability ONLY while the server serves its kind. Returns the names THIS call registered. */
export function registerKnowledgeCapabilities() {
  const added = []
  for (const [name, kind] of Object.entries(KNOWLEDGE_CAPS)) {
    if (unregs[name] || !kindServed(kind)) continue
    if (!kindRegistered && !getTargetKind('playbook')) {
      registerTargetKind({
        name: 'playbook', boardScoped: false, selfDescribing: true, undoable: false,
        list: () => [SELF], read: (_h, ref) => (ref === 'playbook' ? SELF : null), stateOf: (s) => s,
        patch: () => null, commit: async () => true, landed: () => true, undoPatch: () => null, fingerprint: () => 'playbook',
      })
      registerContextProvider({ key: 'playbook', build: (_host, refFor) => [{ ref: refFor('playbook', 'playbook'), label: SELF.label }] })
      kindRegistered = true
    }
    unregs[name] = registerCapability({ name, ...common, ...SPECS[name] })
    added.push(name)
  }
  if (Object.keys(unregs).length) armRouting(true)
  return added
}
export function _resetKnowledgeForTest() {
  for (const k of Object.keys(unregs)) { try { unregs[k]?.() } catch { /* already gone */ } delete unregs[k] }
  armRouting(false)
}
