// TYPO-LEXICON RAIL (AUDIT #1234, 2026-11-14): correctTypos (nl/lexicon.js) must never "correct" a REAL word.
//
// The lexicon is generated from capability prose (summaries, hints, the catalog), so a hint that merely said "Sending a
// chart to the Journal" put "sending" one edit from "ascending", and "sort the themes ascending" was routed as "… sending"
// (#1234: agentExecReach widget tune v2 moved 21 → 22). On master 68a117516f the capreg corpora alone had 99 utterances
// with such rewrites ("clone" → close, "drag" → draw, "fell" → fill, "file" → fire, "ping" → pin…), 12 of which changed
// the groups routing v1 or v2 sent.
//
// Over EVERY utterance of the capreg baseline corpora (corpus.json, goldenWorkflows.json, reachPhrasings.json,
// routingCollisions.json), the NL-1 parity fixture, the NL intent sets the first-call ratchet reads (never the sealed one),
// the NLM-1 dev paraphrases and the agentExec tune sets:
//   A  · OUTPUT: correctTypos as production calls it rewrites no real word (nl/commonWords.js, or an inflection of one or of
//        a lexicon word) and no lexicon word — except a DELIBERATE typo case (an NL intent case `"cat": "typo"`). Reading an
//        inflection of a lexicon word as its OWN base ("stochastics" → stochastic) is normalisation and allowed.
//   A2 · OUTPUT may only shrink (pinned in __fixtures__/typoExposure.json): a word dropped from the common list, or a weaker
//        guard, adds a rewrite production would make, and fails.
//   B  · EXPOSURE may only shrink (same file): with the guard OFF (master's behaviour), the rewrites the lexicon WOULD make.
//        A new capability text that puts a lexicon word one edit from a member's word (re-adding "Sending…") grows it and
//        fails, even though the guard still holds.
// UPDATE_TYPO_EXPOSURE=1 re-pins both. A growth is a decision (say why in the PR); a shrink is free.
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
import dev from './nlm1/dev/paraphrases.json'
import { WIDGET_TUNE, LIST_TUNE, WIDGET_TUNE2, JOURNAL_TUNE } from './agentExecTune.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const ROOT = path.resolve(HERE, '..', '..', '..')
const PARITY = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'nl1_assemble_parity.json'), 'utf8'))
const EXPOSURE = path.join(HERE, '__fixtures__', 'typoExposure.json')
const NL_DIR = path.join(HERE, '__fixtures__', 'nlIntent')
const NL = ['corpus.json', 'dev-nl1.json', 'heldout-v1.json', 'heldout-v2.json'].map(f => [f, JSON.parse(fs.readFileSync(path.join(NL_DIR, f), 'utf8'))])
const turnsOf = (c) => (Array.isArray(c.turns) ? c.turns : [c]).map(t => t.text ?? t.say ?? t.message).filter(Boolean)

/** DELIBERATE typo cases: an NL intent case marked `"cat": "typo"` (its rewrite IS the point). */
export const DELIBERATE_TYPOS = new Set(NL.flatMap(([, d]) => d.cases.filter(c => c.cat === 'typo').flatMap(turnsOf)))

/** Every member utterance in a corpus document: `text` / `say` / `message` strings and `phrasings` entries, at any depth. */
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
  ...utterancesOf(corpus, 'capreg corpus'), ...utterancesOf(golden, 'golden'), ...utterancesOf(reach, 'reach'),
  ...utterancesOf(collisions, 'collisions'), ...utterancesOf(PARITY, 'nl1 parity'),
  ...NL.flatMap(([f, d]) => utterancesOf(d.cases, f)), ...utterancesOf(dev.cases, 'nlm1 dev'),
  ...utterancesOf([WIDGET_TUNE, LIST_TUNE, WIDGET_TUNE2, JOURNAL_TUNE], 'agentExec tune'),
]
const lex = lexiconFor({})
const realOrLexicon = (w) => lex.words.has(w) || isRealWord(w, lex.words)
// suffix stems only: "unlink" → link is a different word, never normalisation
const sufStems = (x) => stemsOf(x).filter(st => !/^(?:re|up|un)/.test(x) || !x.endsWith(st))
const ownBase = (w, to) => sufStems(w).some(st => st === to || sufStems(st).includes(to))
const rewritesOf = (text, opts) => [...new Set((correctTypos(text, lex, opts) || []).flatMap(v => v.changes.map(c => `${String(c.from).toLowerCase()}→${c.to}`)))]
/** { "from→to": [utterance…] } over every utterance; `{ realWords: false }` = the guard OFF (master 68a117516f's behaviour). */
export function rewriteMap(opts) {
  const out = {}
  for (const { text } of ALL) for (const r of rewritesOf(text, opts)) { out[r] ||= []; if (!out[r].includes(text)) out[r].push(text) }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.sort()]))
}
if (globalThis.process?.env?.UPDATE_TYPO_EXPOSURE === '1') {
  fs.writeFileSync(EXPOSURE, JSON.stringify({
    about: 'generated by agentTypoLexiconRail.test.js (UPDATE_TYPO_EXPOSURE=1). exposure: with the real-word guard OFF (master 68a117516f behaviour), the lexicon rewrite each utterance would get. output: what correctTypos does now (own-base normalisation and deliberate typos only). Both may only SHRINK: a growth fails the rail.',
    exposure: rewriteMap({ realWords: false }), output: rewriteMap(),
  }, null, 1) + '\n')
}
const pinned = () => JSON.parse(fs.readFileSync(EXPOSURE, 'utf8'))
const grownOver = (now, was) => Object.entries(now).flatMap(([r, texts]) => texts.filter(t => !(was[r] || []).includes(t)).map(t => `${r} in "${t}"`))

describe('typo-lexicon rail: correctTypos never rewrites a real word', () => {
  it('reads every corpus (the NL-1 parity fixture carries no utterance of its own today), and the deliberate typo cases', () => {
    expect(ALL.length).toBeGreaterThan(1900)
    expect(utterancesOf(PARITY, 'nl1 parity')).toEqual([])
    expect(DELIBERATE_TYPOS.size).toBeGreaterThan(10)
  })
  it('A · OUTPUT: no utterance has a real or lexicon word rewritten (deliberate typo cases excepted)', () => {
    const bad = []
    for (const { src, text } of ALL) {
      if (DELIBERATE_TYPOS.has(text)) continue
      for (const v of correctTypos(text, lex) || []) for (const c of v.changes) {
        const w = String(c.from).toLowerCase()
        if (realOrLexicon(w) && !ownBase(w, c.to)) bad.push(`${src}: "${text}" — ${c.from} → ${c.to}`)
      }
    }
    expect(bad, 'a real word was "corrected": add it to nl/commonWords.js (or fix the prose that put a lexicon word one edit away)').toEqual([])
  })
  it('A2 · OUTPUT may only shrink: no rewrite production makes today is new', () => {
    expect(grownOver(rewriteMap(), pinned().output), 'NEW rewrite in correctTypos output (see the rail header)').toEqual([])
  })
  it('B · EXPOSURE may only shrink: no capability text put a lexicon word newly one edit from a member\'s word', () => {
    expect(grownOver(rewriteMap({ realWords: false }), pinned().exposure), 'NEW lexicon exposure (see the rail header)').toEqual([])
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
