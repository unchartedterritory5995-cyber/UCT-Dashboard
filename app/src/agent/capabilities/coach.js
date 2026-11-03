// ── UCT Agent COACH capabilities (Wave 3, owner-authorized 2026-11-03) — DARK: UCT_AGENT_COACH, admin-only ──────────
//
//   coach.explain         a QUERY: explain ONE trading concept from the curated knowledge base
//                         (docs/agent/coach/concepts/*.md, served by the server), plus — with a chart open and
//                         served daily bars — exactly ONE grounded observation line built from the envelope
//                         (coach/observe.js). Nothing is improvised; nothing in the workspace changes.
//
// Everything here registers ONLY once /api/agent/config has answered `coach: true` (builtins.registerServerGatedBuiltins):
// on a dark server the registry, the manifest and the golden contract are exactly as before. The Agent itself is
// admin-only (require_admin_dark), so the coach is too.
//
// The `coach` context entry rides with the turn whenever the message is for the coach (a concept's words, coaching
// words, journal words): the model gets the matched concept's TEXT, the latest observation and the consent state as
// DATA, and the server's coach block (coach/prompt.py) tells it to use that text — the server guard (coach/guard.py)
// replaces any reply that still makes an unsupported claim. The browser's own answers run the mirror guard too.
//
// Every coach answer ends with "Educational, not advice." Every figure in one comes from the concept text or the
// envelope: the observation names relations (above / below) and the envelope's own dates, never a value.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import * as agentClient from '../agentClient'
import { GROUPS } from '../routing'
import { explainWords, explainTopic } from '../guide/explain'
import { loadConcepts, conceptsLoaded, conceptFor, conceptTitles, coachFooter } from '../coach/concepts'
import { observe, lastObserved, observedChart, barsServed } from '../coach/observe'
import { enforce as guardEnforce } from '../coach/guard'

export const LABEL = 'Trading coach (educational, not advice — explains concepts; never buy/sell advice, never an order)'

// "coach me on breakouts", "teach me about relative strength", "help me understand expectancy"
const COACH_ASK = /^(?:(?:can|could|would) you |please |ok |okay |hey |so )*(?:coach me (?:on|about|through)|teach me about|help me understand|how (?:should|do) i think about|explain the idea of|walk me through the idea of)\s+(.+?)[?.!]*$/i
/** A message for the coach: a concept's words, or coaching / journal words (the context entry is sent). */
export const COACH_WORDS = /\b(coach|coaching|teach me about|help me understand|how (?:should|do) i think about|my (?:trades|trading|journal|recent trades|win rate|results)|review my|use my journal|stop using my journal|position siz\w+|risk per trade|r[- ]multiple|expectancy|drawdown)\b/i

/** The words that name a concept in the message, or null. */
export function coachTopic(raw) {
  const q = String(raw || '').trim()
  if (!q || q.length > 200) return null
  const m = COACH_ASK.exec(q)
  if (m) return m[1].trim()
  const w = explainWords(q)
  if (w) return w
  return conceptFor(q) ? q : null
}

let registered = false
let lastConceptId = null
let disposers = []

// review B1: the coach routing group's words, live ONLY while the coach capabilities are registered (routing.js keeps
// the group's words empty), so a dark server routes exactly as the base does
export const COACH_ROUTE_WORDS = [/\b(coach|coaching|teach me about|help me understand|how (?:should|do) i think about|my (?:trades|trading|journal|last \d+ trades|recent trades|win rate|results)|review my|use my journal|stop using my journal|position siz\w+|risk per trade|r[- ]multiple|expectancy|drawdown|relative strength|support and resistance|consolidation|tightness|failed breakouts?|earnings gaps?|stop placement|where to put (?:a|my) stop)\b/]
function armRouting(on) {
  const g = GROUPS.find(x => x.id === 'coach')
  if (g) g.words.splice(0, g.words.length, ...(on ? COACH_ROUTE_WORDS : []))
}
export const _resetCoachForTest = () => { for (const d of disposers) { try { d() } catch { /* */ } } disposers = []; registered = false; lastConceptId = null; armRouting(false) }

/** The concept explanation + one observation (when served) + the footer → { text, title } (mirror-guarded). */
export async function explainConcept(topic, host) {
  const rows = conceptsLoaded() || await loadConcepts()
  const c = conceptFor(topic, rows)
  if (!c) {
    const titles = conceptTitles(rows)
    return { text: titles.length
      ? `I don't have a coach note on that yet. I can explain: ${titles.join('; ')}. ${coachFooter()}`
      : `The coach's concept notes aren't available right now. ${coachFooter()}` }
  }
  lastConceptId = c.id
  const obs = c.observe && c.observe !== 'none' ? await observe(host, c.observe) : null
  const body = obs ? `${c.text}\n\n${obs}` : c.text
  // belt and braces: the browser's own answer passes the mirror guard (its inputs are exactly its sources)
  const g = guardEnforce(body, [c.text, obs || ''])
  return { text: g.text, title: c.title }
}

export function registerCoachCapabilities() {
  if (registered || !agentClient.serverServesCoach()) return
  registered = true
  armRouting(true)
  disposers.push(() => armRouting(false))
  loadConcepts()                                   // once per page; the fast path uses it once it has arrived
  const self = () => ({ ref: 'coach', label: LABEL })
  disposers.push(registerTargetKind({
    name: 'coach', boardScoped: false, selfDescribing: true, undoable: false,
    list: () => [self()], read: (host, ref) => (ref === 'coach' ? self() : null), stateOf: (s) => s,
    patch: () => null, commit: async () => true, landed: () => true, undoPatch: () => null, fingerprint: () => 'coach',
  }))
  // the coach entry rides ONLY on a coaching message (as the guide's does): the matched concept's text as DATA
  disposers.push(registerContextProvider({
    key: 'coach',
    build: (host, refFor, { message = '' } = {}) => {
      const topic = coachTopic(message)
      const c = topic ? conceptFor(topic) : null
      if (!c && !COACH_WORDS.test(String(message || ''))) return undefined
      const obs = lastObserved()
      const chart = observedChart(host)
      const ids = (conceptsLoaded() || []).map(x => x.id)
      return [{
        ref: refFor('coach', 'coach'), label: LABEL,
        ...(c ? { conceptId: c.id, concept: c.text } : {}),
        ...(obs && chart && obs.symbol === chart.symbol ? { observation: obs.text } : {}),
        ...(ids.length ? { concepts: ids.join(', ') } : {}),
        consent: 'unknown',
      }]
    },
  }))

  disposers.push(registerCapability({
    name: 'coach.explain', target: 'coach', query: true, fastWhole: true, surfaces: ['charts'],
    available: (ctx) => ctx.surface === 'charts' && agentClient.serverServesCoach(),
    summary: 'COACH: explain one trading concept from UCT’s curated coach notes (price action, support/resistance, consolidation, breakouts, relative strength, volume, moving averages, risk per trade and sizing, stops, market conditions and breadth, earnings gaps, drawdown, expectancy), with one grounded observation from the open chart when served data exists. Educational, not advice; changes nothing.',
    hints: 'target = the coach entry. topic = the member’s words for the concept (“failed breakouts”, “position sizing”). Use it for coaching questions about trading concepts; use guide.explain for UCT’s own indicators and features. Never for a request to change something.',
    args: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'], additionalProperties: false },
    // instant only when the words name exactly one concept AND the product guide does not claim them (UCT's own terms win)
    fast: ({ raw }) => {
      const topic = coachTopic(raw)
      if (!topic || !conceptFor(topic)) return null
      const g = explainWords(raw)
      if (g && explainTopic(g)?.local) return null
      return { topic }
    },
    answer: async (_snap, { topic }, host) => explainConcept(topic, host),
  }))
}

export const _lastConceptId = () => lastConceptId
export { barsServed }
