// UCT Agent research — `research.ask` over the MD-1 `research.company` kind (owner: agent-rs, W2-B1). Contract:
// docs/agent/program/contracts/RS-1-research.md.
//
// "Why is NVDA down today", "what's driving strength in AMD", "what catalysts next week for TSLA": ONE gateway read
// (purpose 'research') of the server's composed research envelope, rendered as the three sections the contract names —
// FACTS (only figures UCT's gateway returned, each with its source and as_of), INTERPRETATION (web commentary, figures
// the gateway did not return already stripped by the server), NOT KNOWN — plus the dated SOURCES. No model call, no
// fetch of its own, no web call from the browser: the server made the turn's one web search.
//
// Every freshness word comes from the envelope's own flags and the facts' own as_of (never its notes, agent-qa F-20):
// "live" appears only inside a fact the server worded live from a live, non-stale trade; the freshness line names
// the oldest contributing fact's time and says it is not a real-time price. Only { text, present, link, chart } leave.
//
// Dark by construction: unless the server serves data AND lists `research.company` and `instrument.resolve`
// (`data_kinds`, fail-closed), `match` returns null and `registerResearchCapability` registers nothing.

import { registerCapability } from '../capabilities'
import * as agentClient from '../agentClient'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'
import { stampET, dayOf } from './marketDataFacts'
import { RESOLVE_KIND, toCandidates, resolveInstruments, isFundLabel, FUND_NOTE } from './marketDataResolve'

export const CAPABILITY = 'research.ask'
export const KIND = 'research.company'
export const TOPICS = ['move', 'strength', 'catalysts', 'general']
export const MAX_QUESTION = 200
export const SECTION = { facts: "What UCT's data shows", interpretation: 'Interpretation (web commentary, not UCT data)', unknown: 'Not known / not available', sources: 'Sources' }
const NOT_REAL_TIME = 'Not a real-time price.'
// review (#726): a fact the SERVER worded live must not sit above "Not a real-time price."
export const LIVE_ONLY_MARKED = 'Only a fact marked live is a real-time price; the rest are as of their own times.'

export function researchServed() {
  if (!agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes(KIND) && kinds.includes(RESOLVE_KIND)
}

const NO_RESEARCH = {
  refused: "that request wasn't allowed for this question, so no research answer is available",
  unavailable: "neither UCT's data nor a web lookup could contribute, so no research answer is available",
}
export function noResearchSentence(env, sym) {
  const why = NO_RESEARCH[env?.status] || NO_RESEARCH.unavailable
  return `I couldn't research ${sym || 'that'}: ${why}. No figure is stated.`
}

const usable = (env) => !!env && (env.status === 'ok' || env.status === 'partial') && env.data && typeof env.data === 'object'
const strs = (xs, n, max) => (Array.isArray(xs) ? xs : []).map(x => (typeof x === 'string' ? x : x?.text)).filter(s => typeof s === 'string' && s.trim()).slice(0, n).map(s => s.trim().slice(0, max))

/** A dated source line: "Nov 3, 2026 · title" or "date not given · title". */
export function sourceLine(s, fetchedAt) {
  const when = s?.published_at ? (whenOf(s.published_at, fetchedAt) || dayOf(s.published_at)) : 'date not given'
  return { title: String(s?.title || s?.url || 'source').slice(0, 140), url: typeof s?.url === 'string' && /^https?:\/\//.test(s.url) ? s.url : null, when }
}

// a date-only source time (a statement period end, "2026-07-31T00:00:00Z") is a DAY, never a clock time
const DATE_ONLY = /T00:00:00Z$/
export const whenOf = (iso, fetchedAt) => (DATE_ONLY.test(String(iso || '')) ? dayOf(iso) : stampET(iso, fetchedAt))

/** The freshness line, from the envelope's flags and the facts' own times — never from its notes. */
export function freshnessLine(env) {
  const facts = Array.isArray(env.data?.facts) ? env.data.facts : []
  const times = facts.map(f => f?.as_of).filter(Boolean).sort()
  const stale = facts.some(f => f?.stale)
  const oldest = times.length ? whenOf(times[0], env.fetched_at) : null
  const newest = times.length > 1 ? whenOf(times[times.length - 1], env.fetched_at) : null
  const span = oldest ? `UCT's facts are as of ${oldest}${newest && newest !== oldest ? ` to ${newest}` : ''} (each fact names its own time)` : 'the facts carry no source time (each says what it describes)'
  const parts = [span]
  if (stale) parts.push('at least one source is behind its usual refresh')
  if (env.status === 'partial') parts.push('some sources were not available (listed under Not known)')
  const live = facts.some(f => / — live, /.test(String(f?.text || '')))
  return `${parts.join('; ')}. ${live ? LIVE_ONLY_MARKED : NOT_REAL_TIME}`
}

/**
 * A `research.company` envelope → the member's answer. Pure; exported for tests.
 * → { text, present: { kind: 'research', title, facts, interpretation, unknown, cited, note }, link, chart }
 */
export function answerFromResearch(env, { symbol, name = null, topic = 'general' }) {
  const bare = String(symbol || '').toUpperCase()
  const sym = name ? `${bare} (${name})` : bare
  if (!usable(env)) return { text: noResearchSentence(env, bare) }
  const d = env.data
  const facts = strs(d.facts, 12, 400)
  const interpretation = strs(d.interpretation, 6, 300)
  const unknown = strs(d.unknown, 8, 200)
  const cited = (Array.isArray(d.sources) ? d.sources : []).slice(0, 8).map(s => sourceLine(s, env.fetched_at))
  if (isFundLabel(name)) unknown.push(FUND_NOTE)
  const fresh = freshnessLine(env)
  const titleWord = { move: "why it's moving", strength: "what's driving it", catalysts: 'catalysts ahead', general: 'research' }[topic] || 'research'
  const lines = [`${sym} — ${titleWord}`]
  lines.push(`${SECTION.facts}:`, ...(facts.length ? facts.map(f => `• ${f}`) : ['• No UCT data contributed to this answer.']))
  lines.push(`${SECTION.interpretation}:`, ...(interpretation.length ? interpretation.map(s => `• ${s}`) : ['• No web commentary was available.']))
  if (unknown.length) lines.push(`${SECTION.unknown}:`, ...unknown.map(u => `• ${u}`))
  if (cited.length) lines.push(`${SECTION.sources}:`, ...cited.map(c => `• ${c.when} · ${c.title}${c.url ? ` — ${c.url}` : ''}`))
  lines.push(fresh)
  return {
    text: lines.join('\n'),
    present: { kind: 'research', title: `${bare} — ${titleWord}`, short: bare, facts, interpretation, unknown, cited, note: fresh },
    link: { href: `/research/${encodeURIComponent(bare)}`, label: `Open ${bare} in Research` },
    chart: { symbol: bare, label: bare },
  }
}

function cleanArgs(args) {
  const symbol = String(args?.symbol || '').trim()
  const topic = TOPICS.includes(args?.topic) ? args.topic : 'general'
  const question = typeof args?.question === 'string' && args.question.trim() ? args.question.trim().slice(0, MAX_QUESTION) : null
  return { symbol, topic, question }
}

export async function answerResearch(args) {
  const { symbol, topic, question } = cleanArgs(args)
  if (!researchServed()) return "UCT's research answers aren't available to the Agent here."
  const candidates = toCandidates([symbol])
  if (candidates.length !== 1) return "Which ticker? I couldn't find a symbol in that."
  // MD-1 §4.7: the word is resolved against UCT's symbol index BEFORE anything is read or searched
  const r = await resolveInstruments(candidates)
  if (!r.ok) return r.text
  const resolved = r.symbols[0]
  const turnId = currentTurnId()
  if (!turnId) return "I couldn't research that: this needs the Agent's turn, which wasn't available."
  // ONE read, purpose 'research' (the server composes the served kinds and makes the turn's single web search).
  // The kind is a string LITERAL at the call: agent-qa's isolation rail checks every readData kind statically.
  const env = await readData('research.company', { symbol: resolved, topic, ...(question ? { question } : {}) }, { purpose: 'research', turnId })
  return answerFromResearch(env, { symbol: resolved, name: r.names[resolved], topic })
}

// ── fast path: the default questions (RS-1 §5), pure and fail-closed ──────────────────────────────────────────────
const SYM = '(\\$?[A-Za-z][A-Za-z0-9.]{0,5})'
const MOVE = new RegExp(`^why (?:is|are|was|did) ${SYM}(?: stock| shares)? (?:down|up|falling|dropping|rallying|moving|selling off|tanking|ripping|surging|jumping|gapping (?:up|down)|so (?:weak|strong)|drop|fall|rally|jump|move|dropping so much|up so much|down so much)(?: today| so much| this morning| right now| rn| this week)?$`, 'i')
const STRENGTH = new RegExp(`^what(?:'s| is) (?:driving|behind) (?:the )?(?:strength|weakness|move|rally|selloff|sell-off|surge|drop) in ${SYM}(?: today| this week| lately)?$`, 'i')
const CATALYSTS = new RegExp(`^(?:what|any|which) catalysts?(?: are| is)?(?: there| coming| ahead| coming up| upcoming)?(?: next week| this week| soon| ahead)? for ${SYM}(?: next week| this week| soon)?$`, 'i')
const normalise = (t) => String(t || '').replace(/[’`]/g, "'").trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()

/** The default questions → { action, params } with the candidate word exactly as typed; null otherwise. */
export function match(text) {
  if (!researchServed()) return null
  const s = normalise(text)
  if (!s || s.length > 120) return null
  const q = String(text || '').trim().slice(0, MAX_QUESTION)
  let m
  if ((m = MOVE.exec(s))) return { action: CAPABILITY, params: { symbol: m[1], topic: 'move', question: q } }
  if ((m = STRENGTH.exec(s))) return { action: CAPABILITY, params: { symbol: m[1], topic: 'strength', question: q } }
  if ((m = CATALYSTS.exec(s))) return { action: CAPABILITY, params: { symbol: m[1], topic: 'catalysts', question: q } }
  return null
}

let registered = false
let unregister = null
/** Idempotent; registers nothing unless `research.company` (and `instrument.resolve`) are served. */
export function registerResearchCapability() {
  if (registered || !researchServed()) return false
  registered = true
  unregister = registerCapability({
    name: CAPABILITY,
    surfaces: ['charts'],
    target: 'market', query: true,
    summary: 'Research ONE stock\'s current situation — why it is moving today, what is driving its strength or weakness, what catalysts are ahead — as facts from UCT\'s own data (price, stored news, earnings, statements), '
      + 'web commentary kept apart as interpretation, what is not known, and dated sources. UCT makes the one web search itself. Use this (disposition apply, research null) for "why is NVDA down today", '
      + '"what\'s driving strength in AMD", "what catalysts next week for TSLA", "what\'s going on with X".',
    hints: 'target = the ref of the stockData entry; symbol uppercase; topic = move ("why is it down/up today") | strength ("what\'s driving …") | catalysts ("what\'s coming next week") | general; '
      + 'question = the member\'s own words (at most 200 characters) or null. Never set research: UCT runs the web lookup inside this action. A follow-up like "same for AMD" is this action again with the new symbol.',
    args: {
      type: 'object',
      properties: { symbol: { type: 'string' }, topic: { type: 'string', enum: TOPICS }, question: { type: ['string', 'null'] } },
      required: ['symbol', 'topic', 'question'],
      additionalProperties: false,
    },
    fastWhole: true,
    fastCorrect: false,
    fast: ({ raw }) => { const m = match(raw); return m ? m.params : null },
    answer: (_snap, args) => answerResearch(args),
  })
  return true
}
export const _resetResearchForTest = () => { if (unregister) unregister(); unregister = null; registered = false }
