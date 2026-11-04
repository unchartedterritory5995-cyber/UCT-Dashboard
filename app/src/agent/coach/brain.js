// ── UCT Agent COACH × Trading Brain (W3-4b; owner rule 2026-11-03 and decision N5) ─────────────────────────────────
//
// N5: the approved UCT playbook (the Trading Brain kinds `setup.playbook` / `knowledge.search`) and the Wisdom vocabulary
// are AUTHORITATIVE for setup definitions and methodology. The coach does educational interpretation, interactive
// teaching and helping the member APPLY those definitions — it never writes a competing setup definition
// (docs/agent/coach/VOCABULARY-MAP.md). So:
//   * a named setup (one of the Brain's 48 canonical template names) is taught FROM its `setup.playbook` template, cited;
//   * any other coaching topic may lead with an approved `knowledge.search` passage, cited, before the generic note.
// Every read goes strictly through the MD-1 door (marketdata/client.readData, the open turn's id). Nothing here imports
// the knowledge package: the Brain is a gateway kind like any other, and while the server does not list a kind in
// `data_kinds` (UCT_AGENT_KNOWLEDGE off, the kind not enabled, or the gateway dark) this module makes NO request for it.
//
// Only a template's own fields and a passage's own title / excerpt / source leave this module — never the envelope or
// its notes; the caller's mirror guard checks every composed answer against exactly these texts.

import * as agentClient from '../agentClient'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'

export const BRAIN_KIND = 'knowledge.search'
export const PLAYBOOK_KIND = 'setup.playbook'
const MAX_Q = 400

/** The Brain's 48 canonical setup template names (#735). Update together with the Brain and VOCABULARY-MAP.md. */
export const SETUP_TEMPLATES = ['20EMA Hold', '7-Week Short Rule', 'Ascending Triangle', 'BGU', 'Base-on-Base', 'Box Theory',
  'Cup with Handle', 'Descending Triangle', 'Double Bottom', 'EMA Crossback', 'EMA Crossover', 'EP', 'FTD', 'Flat Base', 'Gap-and-Go',
  'Go Signal', 'Green Line Breakout', 'HTF', 'HVC', 'Head & Shoulders', 'Kicker Candle', 'Late-Stage Climax', 'Launchpad', 'Low-Cheat',
  'Mean Reversion', 'Measured Move', 'Oops Reversal', 'Open Bull Gap Support', 'PEG', 'Parabolic Short', 'Pocket Pivot', 'Power Play',
  'Rectangle', 'Red to Green', 'Remount', 'Short Squeeze', 'Stage 2 Breakout', 'Stage 2 Momentum', 'Stage 4 Breakdown',
  'Symmetrical Triangle', 'Tight Flag', 'U&R', 'VCP', 'Wedge Pop', 'Wyckoff Accumulation', 'Wyckoff Distribution', 'Wyckoff LPSY',
  'Wyckoff SOS']

/** review B4: the spelled-out forms of the templates (a member rarely types the abbreviation). Mirrored server-side in
 *  api/services/uct_agent/coach/setups.py (a pytest keeps the two identical). */
export const SETUP_ALIASES = {
  PEG: ['power earnings gap'], EP: ['episodic pivot'], VCP: ['volatility contraction pattern'],
  'U&R': ['undercut and rally', 'undercut & rally'], FTD: ['follow-through day', 'follow through day'],
  HVC: ['high volume close', 'high-volume close'], BGU: ['big gap up'], 'Cup with Handle': ['cup and handle', 'cup & handle'],
  'Head & Shoulders': ['head and shoulders'], 'Wyckoff LPSY': ['last point of supply'], 'Wyckoff SOS': ['sign of strength'],
  '20EMA Hold': ['20 ema hold', '20-day ema hold'], 'Low-Cheat': ['low cheat entry'], 'Red to Green': ['red-to-green move'],
}
/** agent-kn (2026-11-03): a form that is an alias of MORE THAN ONE template — setup.playbook refuses it as ambiguous, so
 *  the coach never resolves it to either one: it is a named setup with no approved definition, and the coach asks which. */
export const SETUP_AMBIGUOUS = { 'high tight flag': ['HTF', 'Tight Flag'] }

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const formRx = (form) => {
  const body = esc(form).replace(/[- ]/g, '[- ]')
  const caps = form === 'EP' || form === 'PEG'              // English-word clashes: only the capitalised form names the setup
  return new RegExp(`(?:^|[^A-Za-z0-9])${body}(?:s|es)?(?![A-Za-z0-9])`, caps ? '' : 'i')
}
/** every form (names, aliases, ambiguous forms), LONGEST first: "high tight flag" is the ambiguous form, never Tight Flag */
const SETUP_RX = [
  ...SETUP_TEMPLATES.flatMap((name) => [name, ...(SETUP_ALIASES[name] || [])].map((form) => ({ name, form, rx: formRx(form) }))),
  ...Object.entries(SETUP_AMBIGUOUS).map(([form, candidates]) => ({ name: null, candidates, form, rx: formRx(form) })),
].sort((a, b) => b.form.length - a.form.length)

/** The setup a topic names: { name } | { ambiguous: [names], form } | null (the longest form wins). */
export function setupMatch(topic) {
  const t = String(topic || '').slice(0, MAX_Q)
  if (!t) return null
  const hit = SETUP_RX.find(({ rx }) => rx.test(t))
  if (!hit) return null
  return hit.name ? { name: hit.name } : { ambiguous: [...hit.candidates], form: hit.form }
}
/** The ONE canonical template a topic names, or null (an ambiguous form names none). */
export const setupNamed = (topic) => setupMatch(topic)?.name || null

function served(kind) {
  if (!agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes(kind)
}
/** True only while /api/agent/config lists `knowledge.search` in `data_kinds`. */
export const brainServed = () => served(BRAIN_KIND)
/** True only while /api/agent/config lists `setup.playbook` in `data_kinds`. */
export const playbookServed = () => served(PLAYBOOK_KIND)

const usable = (env) => !!env && (env.status === 'ok' || env.status === 'partial') && env.data && typeof env.data === 'object'
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)
/** a template field (string | list | object) → one plain line */
export function plain(v) {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(plain).filter(Boolean).join('; ')
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k.replace(/_/g, ' ')}: ${plain(x)}`).filter(s => !/: $/.test(s)).join('; ')
  return String(v)
}

/** The top approved passage for the member's words → { title, excerpt, source, text } | null (never throws). */
export async function brainPassage(question) {
  const q = clean(question, MAX_Q)
  if (!q || !brainServed()) return null
  let env
  try {
    env = await readData('knowledge.search', { question: q, k: 1 }, { purpose: 'answer', turnId: currentTurnId() })
  } catch { return null }
  if (!usable(env)) return null
  const p = Array.isArray(env.data.passages) ? env.data.passages[0] : null
  if (!p || typeof p !== 'object') return null
  const title = clean(p.title, 160), excerpt = clean(p.excerpt, 900), source = clean(p.source, 80)
  if (!excerpt) return null
  // #751 review B-1: a passage the Brain flags as COMMENTARY (it mentions an excluded setup; never a definition) is
  // labelled as team commentary — never "From UCT's playbook", never a citation of a definition. Absent flags (master
  // today) = an ordinary passage, byte-identical to before.
  const mentions = Array.isArray(p.mentions_excluded_setup) ? p.mentions_excluded_setup.map(x => clean(x, 60)).filter(Boolean) : []
  const commentary = p.commentary_only === true || mentions.length > 0
  const text = commentary
    ? `UCT team commentary that mentions ${mentions.length ? mentions.join(', ') : 'this setup'} (not UCT's definition of it)${title ? ` — ${title}` : ''}: ${excerpt}${source ? ` (${source})` : ''}`
    : `From UCT's playbook${title ? ` — ${title}` : ''}: ${excerpt}${source ? ` (${source})` : ''}`
  const cite = { kind: 'knowledge.search', kb_id: Number.isInteger(p.kb_id) ? p.kb_id : null, title, source, ...versions(env),
    ...(p.epoch ? { epoch: clean(p.epoch, 40) } : {}), ...(commentary ? { commentary: true } : {}) }
  return { title, excerpt, source, text, cite, ...(commentary ? { commentary: true, mentions } : {}) }
}

// ── retention (owner decision; #735 review B-1): Brain text is SHOWN, never stored or replayed ───────────────────────
/** #735's frame marker (knowledge/frame.REF). Not on this base yet: the same literal is used so that, at integration,
 *  frame.seen() recognises a stored coach row as a knowledge turn (and keeps web research blocked). */
export const KNOWLEDGE_REF = '<uct_knowledge_ref/>'
function versions(env) {
  const c = env?.coverage && typeof env.coverage === 'object' ? env.coverage : {}
  return { ...(c.policy_version != null ? { policy: clean(c.policy_version, 40) } : {}), ...(c.pack_ts != null ? { pack: clean(c.pack_ts, 40) } : {}) }
}
const safe = (s) => clean(s, 120).replace(/[<>]/g, '')
/** The citation-only transcript text for a Brain-led answer: ids, titles, sources and versions — never passage text. */
export function knowledgeMarker(cites) {
  const parts = (cites || []).filter(Boolean).map((c) => {
    const v = [c.policy ? `policy ${safe(c.policy)}` : null, c.pack ? `pack ${safe(c.pack)}` : null].filter(Boolean).join(', ')
    const who = [c.source ? `source: ${safe(c.source)}` : null, v || null].filter(Boolean).join('; ')
    return c.kind === 'setup.playbook'
      ? `setup template "${safe(c.template)}"${who ? ` (${who})` : ''}`
      : `${c.commentary ? 'team commentary ' : ''}knowledge base entry${c.kb_id != null ? ` #${c.kb_id}` : ''}${c.title ? ` "${safe(c.title)}"` : ''}${who ? ` (${who})` : ''}`
  })
  return `${KNOWLEDGE_REF} UCT showed the member an answer from its approved knowledge here (not stored or replayed; retrieve it again to use it).${parts.length ? ` Cited: ${parts.join('; ')}.` : ''}`
}

const TEMPLATE_LINES = [['description', 'What it is'], ['entry_triggers', 'Entry'], ['stop_methods', 'Stop'],
  ['invalidation', 'Invalidation'], ['common_mistakes', 'Common mistakes']]

/** UCT's template for a named setup → { name, text, link? } | null (never throws). `text` is the template's own words,
 *  labelled and cited; the caller adds the teaching around it. */
export async function setupTemplate(name) {
  const setup = clean(name, 60)
  if (!setup || !playbookServed()) return null
  let env
  try {
    env = await readData('setup.playbook', { setup }, { purpose: 'answer', turnId: currentTurnId() })
  } catch { return null }
  if (!usable(env)) return null
  const d = env.data
  const lines = TEMPLATE_LINES.map(([k, label]) => { const v = clean(plain(d[k]), 600); return v ? `${label}: ${v}` : null }).filter(Boolean)
  if (!lines.length) return null
  const shown = clean(d.name, 80) || setup
  const text = `${shown} — from UCT's setup template (the approved playbook):\n${lines.join('\n')}`
  const link = d.link && typeof d.link.href === 'string' && /^\/|^https:\/\//.test(d.link.href)
    ? { href: d.link.href, label: clean(d.link.label, 60) || 'Open the Setup Library' } : undefined
  const cite = { kind: 'setup.playbook', template: shown, source: clean(d.source, 80), ...versions(env),
    ...(d.approved_by_policy != null ? { policy: clean(d.approved_by_policy, 40) } : {}) }
  return { name: shown, text, link, cite }
}
