// FIRST-CALL RATCHET (owner 11-11: "new action families cannot silently displace existing capabilities").
//
// Every request with an expectation (an expected plan / action) is routed through v1 (`routeManifest`) and v2
// (`routeManifestV2`) exactly as the browser's first call would be (charts ctx, production limit + budget, lexicon typo
// readings, the registered catalog). A request is IN when some expected plan is fully inside the first call's manifest.
//
// RULE (shrink-only, never silent growth):
//   - an id the committed baseline holds as IN that is now OUT → FAIL, naming id / set / router / expected / groups.
//   - an id that is now IN but not in the baseline → PASS, printed; it is NOT added. Only a deliberate regen adds it.
//
// REGEN (from master only; see docs/agent/program/PR-first-call-ratchet.md):
//   git fetch origin && (app/) UPDATE_FIRST_CALL_RATCHET=1 npx vitest run src/agent/qa/firstCallRatchet.test.js
// It refuses under CI, and refuses unless app/src is byte-identical to origin/master (this rail's own files aside),
// and records origin/master's SHA in the baseline header.
//
// Ids only — never request text (held-out sets are listed by id, as everywhere else).
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { manifestFor, MANIFEST_CONTRACT } from '../capabilities'
import { routeManifest, routingNames } from '../routing'
import { routeManifestV2 } from '../nlm1/routingV2'
import { correctTypos, lexiconFor } from '../nl/lexicon'
import dev from '../nlm1/dev/paraphrases.json'
import { WIDGET_HELD_OUT, LIST_HELD_OUT } from '../agentExecHeldOut.test.js'
import { WIDGET_TUNE, LIST_TUNE, WIDGET_TUNE2, JOURNAL_TUNE } from '../agentExecTune.js'
import { NAME_HELD_OUT, DOOR_HELD_OUT, JOURNAL_HELD_OUT } from '../agentExecHeldOut2.test.js'
import { SEARCH_HELD_OUT, SEARCH_CLEAR_HELD_OUT } from '../agentExecHeldOut7.test.js'
import { registerCatalog } from './capabilityRegression/testing/registry'

await registerCatalog()

const BASELINE = path.join(__dirname, 'firstCallRatchet.baseline.json')
const NL_DIR = path.join(__dirname, '..', '__fixtures__', 'nlIntent')
const NL_FILES = ['corpus.json', 'dev-nl1.json', 'heldout-v1.json', 'heldout-v2.json']

/** Every request with an expectation: { id, set, plans: string[][], text, recentActions?, after? }. */
function requests() {
  const rows = []
  dev.cases.forEach((c, i) => rows.push({ id: `nlm1-dev[${i}]`, set: 'nlm1 dev paraphrases', text: c.text, recentActions: c.recentActions, after: c.after, plans: c.needs ? [c.needs] : null }))
  for (const f of NL_FILES) {
    const data = JSON.parse(fs.readFileSync(path.join(NL_DIR, f), 'utf8'))
    for (const c of data.cases) {
      const turns = Array.isArray(c.turns) ? c.turns : [c]
      turns.forEach((t, i) => {
        const e = t.expect || {}
        const plans = [e.ops, ...(e.alt || [])].filter(p => Array.isArray(p) && p.length).map(p => p.map(o => o.a))
        rows.push({ id: `${f}:${c.id}${turns.length > 1 ? '#' + i : ''}`, set: f, text: t.text ?? t.say ?? t.message, plans: plans.length ? plans : null })
      })
    }
  }
  const ex = (name, cases, action) => cases.forEach((c, i) => rows.push({ id: `${name}[${i}]${c.row ? ':' + c.row : ''}`, set: name, text: c.text, plans: [[action]] }))
  ex('agentExec widget held-out', WIDGET_HELD_OUT, 'widget.setOption')
  ex('agentExec widget tune', WIDGET_TUNE, 'widget.setOption')
  ex('agentExec widget tune2', WIDGET_TUNE2, 'widget.setOption')
  ex('agentExec list held-out', LIST_HELD_OUT, 'chart.setSetting')
  ex('agentExec list tune', LIST_TUNE, 'chart.setSetting')
  ex('agentExec name held-out2', NAME_HELD_OUT, 'widget.setOption')
  ex('agentExec door held-out2', DOOR_HELD_OUT, 'widget.setOption')
  ex('agentExec journal held-out2', JOURNAL_HELD_OUT, 'widget.sendToJournal')
  ex('agentExec journal tune2', JOURNAL_TUNE, 'widget.sendToJournal')
  ex('agentExec search held-out7', [...SEARCH_HELD_OUT, ...SEARCH_CLEAR_HELD_OUT], 'widget.setOption')
  return rows.filter(r => r.plans && typeof r.text === 'string')
}

/** First call per router: { v1: Map(id → {in, groups}), v2: … }. */
function firstCalls(rows) {
  const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
  const names = routingNames(null)
  const lex = lexiconFor(null)
  const correct = (t) => (correctTypos(t, lex) || []).map(v => v.text)
  const opts = (r) => ({ enabled: true, recentActions: r.recentActions || [], pendingActions: [], limit: MANIFEST_CONTRACT.limits.maxCapabilities,
    budget: MANIFEST_CONTRACT.routingThreshold, names, correct, ...(r.after ? { after: r.after } : {}) })
  const out = { v1: new Map(), v2: new Map() }
  for (const r of rows) {
    for (const [router, fn] of [['v1', routeManifest], ['v2', routeManifestV2]]) {
      const x = fn(full, r.text, opts(r))
      const have = new Set(x.manifest.map(c => c.name))
      out[router].set(r.id, { in: r.plans.some(p => p.every(n => have.has(n))), groups: x.routing ? x.routing.selected : ['FULL'] })
    }
  }
  return out
}

const APP = path.join(__dirname, '..', '..', '..')
const git = (...a) => execFileSync('git', a, { cwd: APP, encoding: 'utf8' }).trim()

describe('first-call ratchet: no request that was in the first call silently falls out', () => {
  const t0 = Date.now()
  const rows = requests()
  const calls = firstCalls(rows)
  const byId = new Map(rows.map(r => [r.id, r]))

  it('request ids are unique', () => {
    expect(byId.size).toBe(rows.length)
  })

  if (process.env.UPDATE_FIRST_CALL_RATCHET === '1') {
    it('REGEN the baseline (local only, from master)', () => {
      if (byId.size !== rows.length) throw new Error('request ids are not unique — fix requests() before regenerating')
      if (process.env.CI) throw new Error('UPDATE_FIRST_CALL_RATCHET is refused under CI: the baseline is only ever regenerated by hand, from master')
      const sha = git('rev-parse', 'origin/master')
      // the routed source must be master's, byte for byte (this rail's own two files aside) — never a branch's
      const drift = git('diff', '--name-only', 'origin/master', '--', '.', ':(exclude)src/agent/qa/firstCallRatchet.test.js', ':(exclude)src/agent/qa/firstCallRatchet.baseline.json')
      if (drift) throw new Error(`app/ differs from origin/master ${sha} (committed or not) — regenerate from master only:\n${drift}`)
      const ids = (router) => [...calls[router]].filter(([, v]) => v.in).map(([id]) => id).sort()
      const base = {
        header: {
          rule: 'shrink-only first-call ratchet: an id listed here that is OUT of its first call fails CI; new IN ids are printed, never auto-added',
          generatedFrom: 'origin/master', masterSha: sha, generatedAt: new Date().toISOString().slice(0, 10),
          regen: 'git fetch origin; cd app; UPDATE_FIRST_CALL_RATCHET=1 npx vitest run src/agent/qa/firstCallRatchet.test.js (only with the Lead\'s / AUDIT\'s OK)',
          withExpectation: rows.length, v1In: ids('v1').length, v2In: ids('v2').length,
        },
        v1: ids('v1'),
        v2: ids('v2'),
      }
      fs.writeFileSync(BASELINE, JSON.stringify(base, null, 1) + '\n')
      console.log(`[first-call ratchet] baseline written from origin/master ${sha}: v1 ${base.header.v1In} / v2 ${base.header.v2In} in, of ${rows.length}`)
    })
    return
  }

  it('every baseline IN id is still IN on its first call (v1 and v2)', () => {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
    const lost = []
    const gained = []
    for (const router of ['v1', 'v2']) {
      const want = new Set(base[router])
      for (const id of want) {
        const now = calls[router].get(id)
        const r = byId.get(id)
        if (!r) { lost.push(`${id} · [${router}] · request no longer exists (a baseline id was removed from its set)`); continue }
        if (!now.in) lost.push(`${id} · set ${r.set} · [${router}] · expected ${r.plans.map(p => p.join(' + ')).join(' | ')} · groups ${now.groups.join(',')}`)
      }
      for (const [id, v] of calls[router]) if (v.in && !want.has(id)) gained.push(`${id} [${router}]`)
    }
    const ms = Date.now() - t0
    console.log(`[first-call ratchet] ${rows.length} requests with an expectation · baseline master ${base.header.masterSha} · ` +
      `v1 ${[...calls.v1.values()].filter(v => v.in).length} in (baseline ${base.v1.length}) · v2 ${[...calls.v2.values()].filter(v => v.in).length} in (baseline ${base.v2.length}) · routed in ${ms} ms`)
    if (gained.length) {
      console.log(`[first-call ratchet] ${gained.length} id(s) newly IN — NOT added (the baseline grows only by a deliberate ` +
        `UPDATE_FIRST_CALL_RATCHET=1 regen from master):\n  ${gained.join('\n  ')}`)
    }
    if (lost.length) {
      throw new Error(`[first-call ratchet] ${lost.length} request(s) DISPLACED from the first call (in on the baseline, out now). ` +
        `A new or grown group pushed them out — fix the routing, or, if the move is deliberate, regenerate the baseline from master ` +
        `with the Lead's / AUDIT's OK:\n  ${lost.join('\n  ')}`)
    }
  })
})
