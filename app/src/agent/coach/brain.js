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

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** a name's matcher: hyphens and spaces interchangeable; EP and PEG must be written in caps */
const SETUP_RX = SETUP_TEMPLATES
  .map((name) => {
    const body = esc(name).replace(/[- ]/g, '[- ]')
    const caps = name === 'EP' || name === 'PEG'          // English-word clashes: only the capitalised form names the setup
    return { name, rx: new RegExp(`(?:^|[^A-Za-z0-9])${body}(?:s|es)?(?![A-Za-z0-9])`, caps ? '' : 'i') }
  })
  .sort((a, b) => b.name.length - a.name.length)            // the longest name wins ("Stage 2 Breakout" over "EP"-like overlaps)

/** The canonical template a topic names, or null. */
export function setupNamed(topic) {
  const t = String(topic || '').slice(0, MAX_Q)
  if (!t) return null
  const hit = SETUP_RX.find(({ rx }) => rx.test(t))
  return hit ? hit.name : null
}

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
  const text = `From UCT's playbook${title ? ` — ${title}` : ''}: ${excerpt}${source ? ` (${source})` : ''}`
  return { title, excerpt, source, text }
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
  return { name: shown, text, link }
}
