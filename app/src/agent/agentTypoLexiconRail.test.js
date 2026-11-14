// TYPO-LEXICON RAIL (AUDIT #1234, 2026-11-14): correctTypos (nl/lexicon.js) must never "correct" a REAL word.
//
// The lexicon is generated from capability prose (summaries, hints, the catalog), so a hint that merely says "Sending a
// chart to the Journal" put "sending" one edit from "ascending", and "sort the themes ascending" was routed as "… sending"
// (#1234: agentExecReach widget tune v2 moved 21 → 22). On master 68a117516f the capreg corpus had 99 utterances with such
// rewrites ("clone" → close, "drag" → draw, "fell" → fill, "file" → fire, "ping" → pin…), 11 of which changed routing.
//
// Two layers, over EVERY utterance of the capreg baseline corpora (corpus.json, goldenWorkflows.json, reachPhrasings.json,
// routingCollisions.json) and the NL-1 parity fixture:
//   A · OUTPUT: correctTypos as production calls it rewrites no word that is a real word (nl/commonWords.js, or an
//       inflection of one or of a lexicon word) or a lexicon word — unless the utterance is a recorded DELIBERATE typo case.
//       Reading an inflection of a lexicon word as its OWN base ("stochastics" → stochastic) is normalisation and allowed.
//   B · EXPOSURE (generated, may only shrink): with the real-word guard OFF, the rewrites the lexicon WOULD make are pinned in
//       __fixtures__/typoExposure.json. A new capability text that puts a lexicon word one edit from a corpus word (re-adding
//       "Sending…") grows it and fails here, even though layer A's guard still holds. UPDATE_TYPO_EXPOSURE=1 re-pins; a growth
//       is a decision (say why in the PR), a shrink is free.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { registerBuiltins } from './builtins'
import { lexiconFor, correctTypos } from './nl/lexicon'
import { isRealWord, stemsOf } from './nl/commonWords'
import corpus from './qa/capabilityRegression/baseline/corpus.json'
import golden from './qa/capabilityRegression/baseline/goldenWorkflows.json'
import reach from './qa/capabilityRegression/baseline/reachPhrasings.json'
import collisions from './qa/capabilityRegression/baseline/routingCollisions.json'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const ROOT = path.resolve(HERE, '..', '..', '..')
const PARITY = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'nl1_assemble_parity.json'), 'utf8'))
const EXPOSURE = path.join(HERE, '__fixtures__', 'typoExposure.json')

// DELIBERATE typo cases: utterances whose rewrite IS the point (a recorded typo test). None in these corpora today — the
// typo cases live in agentNlTypos.test.js, and their typos are not real words, so they never need listing here.
export const DELIBERATE_TYPOS = new Set([])

/** Every member utterance in a corpus document: `text` / `say` strings and `phrasings` entries, at any depth. */
export function utterancesOf(doc, src, out = []) {
  if (Array.isArray(doc)) { for (const x of doc) utterancesOf(x, src, out); return out }
  if (!doc || typeof doc !== 'object') return out
  for (const [k, v] of Object.entries(doc)) {
    if ((k === 'text' || k === 'say' || k === 'message' || k === 'utterance') && typeof v === 'string') out.push({ src, text: v })
    else if (k === 'phrasings' && Array.isArray(v)) for (const p of v) { if (typeof p === 'string') out.push({ src, text: p }); else utterancesOf(p, src, out) }
    else if (v && typeof v === 'object') utterancesOf(v, src, out)
  }
  return out
}
const ALL = [
  ...utterancesOf(corpus, 'corpus'), ...utterancesOf(golden, 'golden'), ...utterancesOf(reach, 'reach'),
  ...utterancesOf(collisions, 'collisions'), ...utterancesOf(PARITY, 'nl1Parity'),
]
const lex = lexiconFor({})
const realOrLexicon = (w) => lex.words.has(w) || isRealWord(w, lex.words)
const rewritesOf = (text, opts) => [...new Set((correctTypos(text, lex, opts) || []).flatMap(v => v.changes.map(c => `${String(c.from).toLowerCase()}→${c.to}`)))]
/** The pinned exposure: { "from→to": [utterance…] } with the guard off. */
export function exposure() {
  const out = {}
  for (const { text } of ALL) for (const r of rewritesOf(text, { realWords: false })) (out[r] ||= []).includes(text) || out[r].push(text)
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.sort()]))
}

describe('typo-lexicon rail: correctTypos never rewrites a real word', () => {
  it('reads a real corpus (and the NL-1 parity fixture carries no utterance of its own today)', () => {
    expect(ALL.length).toBeGreaterThan(1000)
    expect(utterancesOf(PARITY, 'nl1Parity')).toEqual([])
  })
  it('A · OUTPUT: no utterance has a real or lexicon word rewritten (deliberate typo cases excepted)', () => {
    const bad = []
    for (const { src, text } of ALL) {
      if (DELIBERATE_TYPOS.has(text)) continue
      for (const v of correctTypos(text, lex) || []) for (const c of v.changes) {
        const w = String(c.from).toLowerCase()
        // an inflection read as its OWN base ("stochastics" → stochastic) is normalisation, not a rewrite
        const ownBase = stemsOf(w).some(st => st === c.to || stemsOf(st).includes(c.to))
        if (realOrLexicon(w) && !ownBase) bad.push(`${src}: "${text}" — ${c.from} → ${c.to}`)
      }
    }
    expect(bad, 'a real word was "corrected": add it to nl/commonWords.js (or fix the prose that put a lexicon word one edit away)').toEqual([])
  })
  it('B · EXPOSURE: the rewrites the lexicon would make without the guard may only shrink (UPDATE_TYPO_EXPOSURE=1 re-pins)', () => {
    const now = exposure()
    if (globalThis.process?.env?.UPDATE_TYPO_EXPOSURE === '1') fs.writeFileSync(EXPOSURE, JSON.stringify({ about: 'generated by agentTypoLexiconRail.test.js (UPDATE_TYPO_EXPOSURE=1): with the real-word guard OFF, the lexicon rewrites each corpus utterance would get. Growth = a capability text put a lexicon word one edit from a member word; it fails the rail.', rewrites: now }, null, 1) + '\n')
    const pinned = JSON.parse(fs.readFileSync(EXPOSURE, 'utf8')).rewrites
    const grown = Object.entries(now).flatMap(([r, texts]) => texts.filter(t => !(pinned[r] || []).includes(t)).map(t => `${r} in "${t}"`))
    expect(grown, 'NEW lexicon exposure: a capability\'s words now sit one edit from a member\'s real word (see the rail header)').toEqual([])
  })
  it('real typos are still corrected (the agentNlTypos cases, through the production lexicon)', () => {
    for (const [typo, want] of [['weeky', 'weekly'], ['swtich to daily', 'switch to daily'], ['hide volumn', 'hide volume'], ['candels', 'candles'], ['what layuot am i on', 'what layout am i on']]) {
      expect((correctTypos(typo, lex) || []).map(v => v.text), typo).toContain(want)
    }
  })
  it('the #1234 case: "ascending" is never read as "sending"', () => {
    expect((correctTypos('sort the themes ascending', lex) || []).map(v => v.text)).not.toContain('sort the themes sending')
    expect(isRealWord('ascending')).toBe(true)
  })
})
