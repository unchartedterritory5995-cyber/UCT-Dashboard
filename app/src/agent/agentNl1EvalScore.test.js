// NL-1 EVAL — scores a paid replay's results. Runs ONLY with AGENT_EVAL_BODIES and AGENT_EVAL_RESULTS set.
//
//   AGENT_EVAL_BODIES=bodies.json AGENT_EVAL_RESULTS=results.json [AGENT_EVAL_REPORT=report.json]
//   [AGENT_EVAL_FILES=realModelBench.v1.json,<abs path>@sealed]   the same corpus files the capture used (testing/bench.js)
//
// Every row also gets ONE outcome (testing/bench.js benchOutcome: success / wrong_action / wrong_chart /
// unnecessary_ask / missed_ask / refusal / unsafe / error) and the replay's latency (model wall time, rounds).
//   npx vitest run src/agent/agentNl1EvalScore.test.js
//
// Interpretation and execution are scored SEPARATELY (testing/score.js). Sealed sets print AGGREGATES ONLY;
// their per-case rows are written only with AGENT_EVAL_UNSEAL=1 (the owner's final report).
// The acceptance gates (docs/agent/nl-intent/NL1-EVAL.md) are checked and printed; the test fails only
// on an UNSAFE plan — every other threshold is a reported result, not a test failure.
import { it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { turnsOf } from './testing/sets'
import { evalSets, specFor, benchOutcome, outcomeTable, latencyOf, OUTCOMES } from './testing/bench'
import { hostFor, nameToId } from './testing/fixtureHost'
import { scoreTurn, aggregate, selectionOutcome } from './testing/score'
import { assembleNl1 } from './nl1/selection'
import { GATES, checkGates } from './testing/acceptance'

registerBuiltins()

const env = globalThis.process?.env || {}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.resolve(HERE, '__fixtures__/nlIntent')

const groupOutcomes = (rows, k) => Object.fromEntries([...new Set(rows.map(r => r[k]).filter(Boolean))].sort().map(v => [v, outcomeTable(rows.filter(r => r[k] === v))]))
const pct = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] }

it.skipIf(!env.AGENT_EVAL_BODIES || !env.AGENT_EVAL_RESULTS)('scores the replay', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(DIR, 'corpus.json'), 'utf8'))
  const captured = JSON.parse(fs.readFileSync(env.AGENT_EVAL_BODIES, 'utf8'))
  const bodies = new Map(captured.filter(i => i.mode).map(i => [`${i.mode}|${i.key}|${i.set}`, i]))
  const catalogs = new Map(captured.filter(i => !i.mode && i.catalog && i.manifest).map(i => [i.catalog, i]))
  const run = JSON.parse(fs.readFileSync(env.AGENT_EVAL_RESULTS, 'utf8'))
  const cases = new Map()
  const SETS = evalSets(env, DIR)
  for (const s of SETS) {
    const data = s.data || JSON.parse(fs.readFileSync(s.path, 'utf8'))
    const sp = specFor(spec, data)
    for (const c of data.cases) for (const t of turnsOf(c)) cases.set(`${t.key}|${s.file}`, { c, t, split: s.split, spec: sp })
  }
  const rows = []
  for (const r of run.results) {
    const item = bodies.get(`${r.mode}|${r.key}|${r.set}`)
    const k = cases.get(`${r.key}|${r.set}`)
    if (!item || !k) continue
    const { host, selected, lib } = hostFor(k.spec, k.c.fx, { state: k.t.state, libExtra: k.c.libExtra })
    const selectedLabel = selected ? host.charts.list().find(s => s.ref === selected || String(s.ref).endsWith(selected))?.label || null : null
    // NL-1: the action selection's outcome, and the envelope as the PANEL acts on it (an apply made while the words
    // pointed at a group the request could not carry is proposed — useAgent)
    const sel = r.mode === 'nl1' && !r.error ? selectionOutcome({ expect: k.t.expect, item, result: r, catalog: catalogs.get(item.catalog), assemble: assembleNl1 }) : null
    const s = r.error
      ? { interp: 'error', correct: false, disposition: null, actions: [], clarify: null, choicesOk: null, execution: { planned: false, refused: [r.error] }, wrongRunsNow: false, unsafe: [] }
      : scoreTurn({ expect: k.t.expect, env: sel ? sel.env : r.envelope, refMap: item.refMap, host, selectedLabel, names: nameToId(lib) })
    const o = benchOutcome({ expect: k.t.expect, env: sel ? sel.env : r.envelope, error: r.error, score: s, refMap: item.refMap, host, selectedLabel, names: nameToId(lib) })
    rows.push({ key: r.key, set: r.set, split: k.split, cat: k.c.cat, fam: k.c.fam || null, mix: k.c.mix || null, ms: r.ms, modelMs: r.model_ms, rounds: r.rounds, callMs: r.call_ms, usage: r.usage, ...s,
      outcome: o.outcome, outcomeWhy: o.why, forbidden: o.forbidden,
      ...(sel ? { selection: { firstCall: sel.firstCall, rerouted: sel.rerouted, escalated: sel.escalated, substitution: sel.substitution } } : {}) })
  }
  const bySet = {}
  for (const s of SETS) {
    const rs = rows.filter(x => x.set === s.file)
    if (!rs.length) continue
    bySet[s.file] = { split: s.split, ...aggregate(rs), p50ms: pct(rs.map(x => x.ms), 0.5), p95ms: pct(rs.map(x => x.ms), 0.95),
      outcomes: outcomeTable(rs), latency: latencyOf(rs),
      // per mix / family breakdowns only for visible sets (a sealed set's slices would narrow toward its cases)
      ...(s.split !== 'sealed' ? { byMix: groupOutcomes(rs, 'mix'), byFam: groupOutcomes(rs, 'fam') } : {}) }
  }
  const sealed = rows.filter(x => x.split === 'sealed')
  const headline = sealed.length ? { ...aggregate(sealed), p50ms: pct(sealed.map(x => x.ms), 0.5), p95ms: pct(sealed.map(x => x.ms), 0.95) } : null
  const all = aggregate(rows)
  const conv = sealed.filter(x => x.cat === 'conv')
  const gates = headline ? checkGates(headline, all, { spentUsd: run.spent_usd, requests: run.results.length, convInterpretation: conv.length ? aggregate(conv).interpretation : null }) : null
  const lines = [
    `model ${run.model}  mode ${run.mode}  effort ${run.effort || 'default'}  spent $${(run.spent_usd || 0).toFixed(4)}  scored ${rows.length}`,
    ...Object.entries(bySet).map(([f, a]) => `${f.padEnd(16)} ${a.split.padEnd(8)} n ${String(a.n).padStart(3)}  interp ${a.interpretation}%  clarify recall ${a.clarifyRecall}%  unneeded ${a.unnecessaryClarify}%  choices ${a.choicesCorrect}%  wrong-runs ${a.wrongRunsNow}  UNSAFE ${a.unsafe}  p50 ${a.p50ms}ms p95 ${a.p95ms}ms`
      + (a.firstCallCoverage != null ? `\n${''.padEnd(26)}selection: first-call coverage ${a.firstCallCoverage}%  reroutes ${a.rerouteRate}%  substitutions ${a.substitutions}  escalated ${a.escalated}` : '')
      + (a.tokens ? `  tokens/request in ${a.tokens.input} read ${a.tokens.cacheRead} write ${a.tokens.cacheWrite} out ${a.tokens.output} calls ${a.tokens.modelCalls}` : '')
      + `
${''.padEnd(26)}outcomes: success ${a.outcomes.successPct}%  ${OUTCOMES.filter(x => x !== 'success').map(x => `${x} ${a.outcomes[x]}`).join('  ')}  forbidden-hits ${a.outcomes.forbiddenHits}`
      + `
${''.padEnd(26)}latency: model p50 ${a.latency.modelMsP50}ms p95 ${a.latency.modelMsP95}ms max ${a.latency.modelMsMax}ms  per call p50 ${a.latency.callMsP50}ms p95 ${a.latency.callMsP95}ms  rounds mean ${a.latency.roundsMean} max ${a.latency.roundsMax} (multi-round ${a.latency.multiRound})`
      + (a.byMix ? Object.entries(a.byMix).map(([m, t]) => `
${''.padEnd(26)}mix ${m.padEnd(10)} n ${String(t.n).padStart(3)}  success ${t.successPct}%`).join('') : '')
      + (a.byFam ? Object.entries(a.byFam).map(([m, t]) => `
${''.padEnd(26)}fam ${m.padEnd(10)} n ${String(t.n).padStart(3)}  success ${t.successPct}%`).join('') : '')),
    ...(gates ? ['ACCEPTANCE (sealed sets):', ...gates.map(g => `  ${g.pass ? 'PASS' : 'FAIL'} ${g.name}: ${g.value} (bar ${g.bar})`)] : []),
  ]
  // per-case rows: dev / exposed always; sealed only when the owner unseals for the final report
  const visible = rows.filter(x => x.split !== 'sealed' || env.AGENT_EVAL_UNSEAL === '1')
  const misses = visible.filter(x => !x.correct || x.unsafe.length || x.outcome !== 'success').map(x => `${x.key} [${x.set}] ${x.outcome} (${x.interp}) ${x.disposition} ${x.actions.join(',')}${x.outcomeWhy ? ` — ${x.outcomeWhy}` : ''}${x.unsafe.length ? ` UNSAFE: ${x.unsafe.join('; ')}` : ''}`)
  console.log(`\n── NL-1 eval ──\n${lines.join('\n')}\n${misses.length ? `misses (visible sets):\n  ${misses.join('\n  ')}` : ''}\n`)
  if (env.AGENT_EVAL_REPORT) fs.writeFileSync(env.AGENT_EVAL_REPORT, JSON.stringify({ model: run.model, mode: run.mode, effort: run.effort, spent_usd: run.spent_usd, bySet, headline, gates, rows: visible }, null, 1))
  // the one hard failure: a plan that would run a change where it must not
  expect(rows.filter(x => x.unsafe.length).map(x => (x.split === 'sealed' && env.AGENT_EVAL_UNSEAL !== '1' ? `${x.set} (sealed case)` : x.key))).toEqual([])
  void GATES
}, 300000)
