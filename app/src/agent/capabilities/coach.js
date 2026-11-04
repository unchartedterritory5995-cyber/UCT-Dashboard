// ── UCT Agent COACH capabilities (Wave 3, owner-authorized 2026-11-03) — DARK: UCT_AGENT_COACH, admin-only ──────────
//
//   coach.explain         a QUERY: explain ONE trading concept from the curated knowledge base
//                         (docs/agent/coach/concepts/*.md, served by the server), plus — with a chart open and
//                         served daily bars — exactly ONE grounded observation line built from the envelope
//                         (coach/observe.js). Nothing is improvised; nothing in the workspace changes.
//   ⭐ W3-3 trade review foundations (the member's OWN journal, consent-gated):
//   coach.consent         a WRITE on the conversation: "yes, use my journal" / "stop using my journal" — the
//                         server-kept state `coachConsent` (coach/consent.js). The member's own words apply it
//                         instantly (explicitOk); a model-routed grant is a card the member approves. No Undo (revoke
//                         is the explicit way back).
//   journal.reviewTrades  a QUERY, only with consent: the newest N (≤ 50) trades through the EXISTING route
//                         GET /api/j2/trades → DESCRIPTIVE stats (coach/review.js): counts, win rate, average R,
//                         holding time, largest win/loss as R, the member's own tags. Never a trade's prices.
//   journal.proposeNote   a WRITE, confirm-risk, always a PROPOSAL: a review note the member approves →
//                         POST /api/j2/notes (the ONLY journal write under coach/, railed). The note's text passes
//                         the mirror guard first (no claim, no order, no figure outside the review).
//   ⭐ W3-4 workflow (single-turn): explain → what to check → one question back is the model's structure
//   (coach/prompt.py); the browser's own answers carry `next` — `coach.next` quick replies (coach/next.js) the
//   panel shows as chips; a tap is the member's own next message. W2-A1 threading replaces the chips at integration.
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
import { enforce as guardEnforce, check as guardCheck } from '../coach/guard'
import { nextFor } from '../coach/next'
import { brainPassage, setupTemplate, setupMatch, knowledgeMarker } from '../coach/brain'
import { consentState, readConsent, writeConsent } from '../coach/consent'
import { reviewStats, reviewText, reviewPresent, modelView, fetchTrades, clampN, DEFAULT_N, MAX_N, DESCRIPTIVE } from '../coach/review'

export const LABEL = 'Trading coach (educational, not advice — explains concepts; never buy/sell advice, never an order)'

// N5: COACHING phrasings — "coach me on breakouts", "teach me about relative strength", "help me understand how to apply
// the VCP", "quiz me on stops", "walk me through position sizing". A bare "what is X?" is not the coach's fast path (a setup
// question belongs to the playbook group; the model may still choose coach.explain).
const COACH_ASK = /^(?:(?:can|could|would) you |please |ok |okay |hey |so )*(?:coach me (?:on|about|through)|teach me(?: about| how to (?:apply|use|spot|read|trade)| how)?|help me understand(?: how to (?:apply|use|spot|read|trade))?|quiz me (?:on|about)|walk me through(?: the idea of| how to (?:apply|use|spot|read|trade))?|how (?:should|do) i (?:think about|apply|use)|explain the idea of)\s+(.+?)[?.!]*$/i
/** A message for the coach: a concept's words, or coaching / journal words (the context entry is sent). */
export const COACH_WORDS = /\b(coach|coaching|teach me|help me understand|quiz me|walk me through|how to apply|how (?:should|do) i think about|my (?:trades|trading|journal|recent trades|win rate|results)|review my|use my journal|stop using my journal|position siz\w+|risk per trade|r[- ]multiple|expectancy|drawdown)\b/i

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
// { stats, text } of the latest consented review PER CONVERSATION (review fix: chat A's stats never ride into chat B)
const reviews = new Map()
const chatKey = () => String(agentClient.activeConversationId() || '')
const lastReviewNow = () => reviews.get(chatKey()) || null
let lastMessage = ''                    // the member's latest coaching message (a note may echo its figures)
let disposers = []

// review B1: the coach routing group's words, live ONLY while the coach capabilities are registered (routing.js keeps
// the group's words empty), so a dark server routes exactly as the base does
// N5 (2026-11-03): COACHING phrasings only — a bare setup / concept question routes to the playbook group
export const COACH_ROUTE_WORDS = [/\b(coach|coaching|teach me|help me understand|quiz me|walk me through|how (?:should|do) i (?:think about|apply|use)|how to apply|my (?:trades|trading|journal|last \d+ trades|recent trades|win rate|results)|review my|use my journal|stop using my journal)\b/]
function armRouting(on) {
  const g = GROUPS.find(x => x.id === 'coach')
  if (g) g.words.splice(0, g.words.length, ...(on ? COACH_ROUTE_WORDS : []))
}
export const _resetCoachForTest = () => { for (const d of disposers) { try { d() } catch { /* */ } } disposers = []; registered = false; lastConceptId = null; reviews.clear(); lastMessage = ''; armRouting(false) }
export const _lastReview = () => lastReviewNow()

export const JOURNAL_MARKER = 'Reviewed your journal in this chat (shown here only: not saved, never sent to the model).'
const CONSENT_NEEDED = `I can only look at your journal after you allow it in this chat — say “yes, use my journal” (and “stop using my journal” whenever you want me to stop). ${coachFooter()}`
const NOTE_MAX_TITLE = 120
const NOTE_MAX_BODY = 2000
/** The texts a proposed note's figures may come from: the latest review, the loaded concept texts, the member's words. */
const noteInputs = () => [lastReviewNow()?.text || '', ...((conceptsLoaded() || []).map(c => c.text)), lastMessage]
/** A TipTap doc of plain paragraphs — the journal's own body shape (api/services/journal_two/notes._validate_body_json). */
export const noteBody = (text) => ({ type: 'doc', content: String(text || '').split(/\n{2,}|\n/).map(s => s.trim()).filter(Boolean)
  .map(t => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) })

/** The consented review of the member's own trades → { text, present } (or the consent sentence). */
export async function reviewTrades(count) {
  const st = consentState() === 'unknown' ? await readConsent() : consentState()
  if (st !== 'granted') return { text: CONSENT_NEEDED }
  let rows
  try { rows = await fetchTrades(clampN(count ?? DEFAULT_N)) } catch (e) {
    return { text: e?.status === 402 ? `The journal needs a paid UCT plan. ${coachFooter()}` : `I couldn't read your journal right now (${e?.message || 'error'}). ${coachFooter()}` }
  }
  const stats = reviewStats(rows, clampN(count ?? DEFAULT_N))
  const text = `${reviewText(stats)}\n\n${coachFooter()}`
  reviews.set(chatKey(), { stats, text })
  const present = reviewPresent(stats)
  const next = nextFor({ after: 'review', consent: 'granted', concepts: conceptsLoaded() || [] })
  return present ? { text, present: { ...present, details: { text } }, title: present.title, next } : { text, next }
}

// ── coach.explain (W3-1) × the Trading Brain (W3-4b, owner rule + decision N5, 2026-11-03) ──────────────────────────
// N5: the approved UCT playbook and the Wisdom vocabulary are authoritative for setup definitions; the coach TEACHES
// FROM them and never writes a competing definition. So:
//   * a named setup (one of the Brain's 48 template names) → its `setup.playbook` template when served, cited, with the
//     coach's "applying it" teaching around it; else an approved `knowledge.search` passage, cited; else the coach says
//     the definition lives in the playbook and (when a concept note is related) offers it as GENERIC background only;
//   * any other topic → an approved passage leads when served, and the curated generic note follows.
// Every composed text passes the mirror guard over exactly its sources; when it would be replaced, or a kind is not
// served, or a read is refused / empty / fails, the answer falls back as above. Nothing here imports the knowledge
// package (coach/brain.js reads through the MD-1 gateway only).
export const APPLY = 'Applying it: take each line above to your own chart and check whether every condition is actually there — a chart that meets only some of them is a different situation. A template says what to look for; it may not fit every chart, and the decision stays yours.'
/** The plain statement when no approved playbook definition can be read (the coach never invents one). */
export const noDefinition = (setup) => `UCT can't currently retrieve an approved playbook definition for ${setup}, so I won't give one here.`
export const BACKGROUND_HEADING = 'General background (not the UCT playbook definition):'
/** Source policy for the optional background: the note exists, is a generic concept note and names no setup at all. */
const namesASetup = (text) => String(text || '').split(/[.\n]/).some(part => setupMatch(part))
const backgroundAllowed = (c) => !!c && typeof c.text === 'string' && !namesASetup(`${c.title}. ${c.text}`)

/** Teach a named setup FROM UCT's playbook, or say plainly that its approved definition can't be retrieved. A generic
 *  concept note is offered ONLY under BACKGROUND_HEADING and only when the source policy allows it. (coach.explain is
 *  itself the teach / explain request: there is no separate gate.) */
async function explainSetup(setup, topic, c, rows, host) {
  const bg = backgroundAllowed(c) ? c : null
  const next = bg ? nextFor({ after: 'explain', conceptId: bg.id, consent: consentState(), hasChart: !!observedChart(host), concepts: rows }) : undefined
  const t = await setupTemplate(setup)
  if (t) {
    const g = guardEnforce(`${t.text}\n\n${APPLY}`, [t.text, APPLY])
    if (!g.violations.length) return { text: g.text, title: t.name, storedAs: knowledgeMarker([t.cite]), ...(t.link ? { link: t.link } : {}), ...(next ? { next } : {}) }
  }
  const p = await brainPassage(topic)
  if (p) {
    // #751 B-1: a COMMENTARY passage (it mentions an excluded setup) is never "the closest approved passage" — its own
    // text already says it is team commentary, not UCT's definition
    const lead = p.commentary ? 'Related UCT team commentary:' : 'The closest approved passage:'
    const g = guardEnforce(`${noDefinition(setup)} ${lead}\n${p.text}${bg ? `\n\n${BACKGROUND_HEADING}\n${bg.text}` : ''}`,
      [p.text, bg?.text || '', setup])
    if (!g.violations.length) return { text: g.text, title: p.title || setup, storedAs: knowledgeMarker([p.cite]), ...(next ? { next } : {}) }
  }
  if (bg) {
    const g = guardEnforce(`${noDefinition(setup)}\n\n${BACKGROUND_HEADING}\n${bg.text}`, [bg.text, setup])
    if (!g.violations.length) { lastConceptId = bg.id; return { text: g.text, title: setup, next } }
  }
  return { text: `${noDefinition(setup)} ${coachFooter()}`, title: setup }
}

/** The concept explanation + one observation (when served) + the footer → { text, title } (mirror-guarded). */
export async function explainConcept(topic, host) {
  const rows = conceptsLoaded() || await loadConcepts()
  const c = conceptFor(topic, rows)
  const m = setupMatch(topic)
  // agent-kn: a form that names MORE THAN ONE template ("high tight flag": HTF and Tight Flag) is resolved to neither —
  // no read, no background: the no-definition statement and a question back (which one?)
  if (m?.ambiguous) return { text: `${noDefinition(`“${m.form}”`)} UCT uses that name for more than one setup (${m.ambiguous.join(', ')}) — which one do you mean? ${coachFooter()}`, title: m.form }
  const setup = m?.name || null
  if (setup) return explainSetup(setup, topic, c, rows, host)
  const brain = await brainPassage(topic)
  if (!c && brain) {
    const g = guardEnforce(brain.text, [brain.text])
    if (!g.violations.length) return { text: g.text, title: brain.title || undefined, storedAs: knowledgeMarker([brain.cite]) }
  }
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
  const next = nextFor({ after: 'explain', conceptId: c.id, consent: consentState(), hasChart: !!observedChart(host), concepts: rows })
  if (brain) {
    // #751 B-1: team commentary never leads the coach note (it follows it, labelled); an approved passage still leads
    const b = guardEnforce(brain.commentary ? `${body}\n\n${brain.text}` : `${brain.text}\n\n${body}`, [brain.text, c.text, obs || ''])
    if (!b.violations.length) return { text: b.text, title: c.title, next, storedAs: knowledgeMarker([brain.cite]) }
  }
  return { text: g.text, title: c.title, next }
}

/** Is this message for the coach (the coach context entry rides with it)? Exactly the context provider's condition —
 *  the server then serves the turn on planner v1 (C1), so under a v2 browser useAgent sends it down the v1 path, where the
 *  coach's actions (explain, consent, review, a note card) are shown, not just the reply. False while not registered. */
export function isCoachMessage(message) {
  if (!registered) return false
  const topic = coachTopic(message)
  return !!(topic && conceptFor(topic)) || COACH_WORDS.test(String(message || ''))
}

export function registerCoachCapabilities() {
  if (registered || !agentClient.serverServesCoach()) return
  registered = true
  armRouting(true)
  disposers.push(() => armRouting(false))
  loadConcepts()                                   // once per page; the fast path uses it once it has arrived
  const self = () => ({ ref: 'coach', label: LABEL, consent: consentState(), note: null })
  disposers.push(registerTargetKind({
    name: 'coach', boardScoped: false, selfDescribing: true, undoable: false,
    list: () => [self()], read: (host, ref) => (ref === 'coach' ? self() : null),
    stateOf: (s) => ({ consent: s.consent, note: s.note || null }),
    patch: (before, after) => {
      const p = {}
      if (after.consent !== before.consent) p.consent = after.consent
      if (after.note && after.note !== before.note) p.note = after.note
      return Object.keys(p).length ? p : null
    },
    async commit(host, ref, patch) {
      if (patch.consent) await writeConsent(patch.consent === 'granted')
      if (patch.note) {
        // ⭐ the ONLY journal write under coach/ (railed by agentCoachJournal.test.jsx): the note the member approved
        const r = await fetch('/api/j2/notes', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: patch.note.title, bodyJson: noteBody(patch.note.body), tags: ['uct-agent-coach'] }) })
        const b = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(b.detail || `HTTP ${r.status}`)
        return { created: { note: String(b?.note?.id || '') } }
      }
      return true
    },
    landed: (snap, patch) => (!patch.consent || snap?.consent === patch.consent),
    undoPatch: () => null, fingerprint: (s) => `coach:${s?.consent || 'unknown'}`,
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
      lastMessage = String(message || '')
      const consent = consentState()
      const mine = lastReviewNow()
      const review = consent === 'granted' && mine ? modelView(mine.stats) : null
      return [{
        ref: refFor('coach', 'coach'), label: LABEL,
        ...(c ? { conceptId: c.id, concept: c.text } : {}),
        ...(obs && chart && obs.symbol === chart.symbol ? { observation: obs.text } : {}),
        ...(ids.length ? { concepts: ids.join(', ') } : {}),
        consent,
        ...(review ? { review } : {}),
      }]
    },
  }))

  disposers.push(registerCapability({
    name: 'coach.explain', target: 'coach', query: true, fastWhole: true, surfaces: ['charts'],
    available: (ctx) => ctx.surface === 'charts' && agentClient.serverServesCoach(),
    summary: 'COACH: explain one trading concept from UCT’s curated coach notes (price action, support/resistance, consolidation, breakouts, relative strength, volume, moving averages, risk per trade and sizing, stops, market conditions and breadth, earnings gaps, drawdown, expectancy), with one grounded observation from the open chart when served data exists. Educational, not advice; changes nothing.',
    hints: 'target = the coach entry. topic = the member’s words for the concept (“failed breakouts”, “position sizing”). Use it for coaching questions about trading concepts; use guide.explain for UCT’s own indicators and features. A named UCT setup (VCP, EP, U&R…) is taught FROM UCT’s approved playbook template, never from the coach’s own definition. Never for a request to change something.',
    args: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'], additionalProperties: false },
    // instant only when the words name exactly one concept AND the product guide does not claim them (UCT's own terms win)
    // instant only for a COACHING phrasing (N5) whose topic is one concept or one named setup
    fast: ({ raw }) => {
      const m = COACH_ASK.exec(String(raw || '').trim())
      const topic = m ? m[1].trim() : null
      if (!topic || topic.length > 200 || !(conceptFor(topic) || setupMatch(topic))) return null
      const g = explainWords(raw)
      if (g && explainTopic(g)?.local) return null
      return { topic }
    },
    answer: async (_snap, { topic }, host) => explainConcept(topic, host),
  }))

  // ── W3-3: the member's own journal ──
  const GRANT = /^(?:(?:yes|ok|okay|sure|fine)[,.!]?\s+)*(?:(?:you|the coach) (?:can|may) |please |go ahead and |i allow you to |i consent to |)(?:use|read|access) my (?:journal|trades|trading journal|trade journal)(?: (?:for|in) this (?:chat|conversation))?[.!]*$/i
  const REVOKE = /^(?:(?:ok|okay|please)[,.!]?\s+)*(?:stop (?:using|reading|looking at)|don'?t use|do not use|no longer use|revoke (?:access to|consent (?:for|to))) my (?:journal|trades|trading journal|trade journal)[.!]*$/i
  const REVIEW = /^(?:(?:can|could|would) you |please |coach,? )*(?:review|look at|go over|summari[sz]e|what do you (?:see|think) (?:of|about)) my (?:last (\d{1,2}) |recent |latest |)(?:trades|journal|trading)(?: please)?[?.!]*$/i
  const common = { target: 'coach', surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts' && agentClient.serverServesCoach() }

  disposers.push(registerCapability({
    ...common, name: 'coach.consent', risk: 'confirm', reversible: true, undo: 'none', explicitOk: true, fastWhole: true,
    summary: 'COACH: allow (or stop) the coach using the member’s OWN journal in THIS chat — “yes, use my journal” / “stop using my journal”. Consent is per conversation; nothing is read before it. Revoke is the way back (no Undo).',
    hints: 'target = the coach entry. granted = true to allow, false to stop. Only when the member says so in their own words; never grant it on your own.',
    args: { type: 'object', properties: { granted: { type: 'boolean' } }, required: ['granted'], additionalProperties: false },
    fast: ({ raw }) => (GRANT.test(String(raw || '').trim()) ? { granted: true, __explicit: true } : REVOKE.test(String(raw || '').trim()) ? { granted: false, __explicit: true } : null),
    check: () => (agentClient.activeConversationId() ? null : 'ask me something first — consent belongs to a conversation, and this chat has not started yet'),
    apply: (state, { granted }) => (state.consent === (granted ? 'granted' : 'revoked') ? state : { ...state, consent: granted ? 'granted' : 'revoked' }),
    describe: (before, after) => (after.consent === 'granted'
      ? 'Allowed the coach to use your journal in this chat (descriptive review only; say “stop using my journal” to stop).'
      : 'Stopped the coach using your journal in this chat.'),
    noop: (before, after) => (after.consent === 'granted' ? 'The coach may already use your journal in this chat.' : 'The coach was not using your journal in this chat.'),
  }))

  disposers.push(registerCapability({
    ...common, name: 'journal.reviewTrades', query: true, fastWhole: true,
    // ⛔ review B3: the member SEES the review; it is never replayed to a model (localOnly + turn.LOCAL_ONLY_ACTIONS) and
    // never stored as text — the transcript keeps only this value-free marker (useAgent). The model gets journal stats only
    // through the consent-checked coach context entry.
    localOnly: true,
    storedAs: JOURNAL_MARKER,
    summary: `COACH, with the member’s consent in this chat: a DESCRIPTIVE review of their own recent journal trades (last N, default ${DEFAULT_N}, max ${MAX_N}): count, win rate, average R, holding time, largest win/loss as R, their own tags. Never a recommendation, never a single trade’s prices.`,
    hints: 'target = the coach entry. count = how many recent trades (null = default). Without consent the answer asks for it — never read the journal another way.',
    args: { type: 'object', properties: { count: { type: ['integer', 'null'] } }, required: ['count'], additionalProperties: false },
    fast: ({ raw }) => { const m = REVIEW.exec(String(raw || '').trim()); return m ? { count: m[1] ? Number(m[1]) : null } : null },
    answer: async (_snap, { count }) => reviewTrades(count),
  }))

  disposers.push(registerCapability({
    ...common, name: 'journal.proposeNote', risk: 'confirm', reversible: false, undo: 'none',
    summary: 'COACH: PROPOSE a short review note for the member’s journal (a title and a few plain sentences about their process, written from the review and the concept they discussed). Always a proposal the member approves; saved through the journal’s own notes route only then.',
    hints: 'target = the coach entry. title ≤ 120 chars; body ≤ 2000 chars, plain sentences (no markdown), descriptive and educational: no buy/sell, no targets, no figure that is not in the review or the member’s own words.',
    args: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'], additionalProperties: false },
    createsResource: true,
    check: (state, { title, body }) => {
      const t = String(title || '').trim(), b = String(body || '').trim()
      if (!t || t.length > NOTE_MAX_TITLE) return `a note needs a title of up to ${NOTE_MAX_TITLE} characters`
      if (!b || b.length > NOTE_MAX_BODY) return `a note body is up to ${NOTE_MAX_BODY} characters`
      const codes = guardCheck(`${t}. ${b}`, noteInputs())
      if (codes.includes('unsupported') || codes.includes('order')) return 'I can’t propose a note that makes a claim about what will happen or tells you to trade'
      if (codes.includes('figure')) return 'a review note can only carry figures from your own review or your own words'
      return null
    },
    apply: (state, { title, body }) => ({ ...state, note: { title: String(title).trim(), body: String(body).trim() } }),
    describe: (before, after) => `Proposed a journal note “${after.note.title}” — saved to your journal only when you approve it. ${DESCRIPTIVE}`,
  }))
}

export const _lastConceptId = () => lastConceptId
export { barsServed }
