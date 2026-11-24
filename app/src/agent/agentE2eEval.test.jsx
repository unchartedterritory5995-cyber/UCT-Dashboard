// E2E EVAL — one ARM of the end-to-end, three-arm comparison (no model call here; the paid step is
// tools/agent_eval_run.py on the bodies this writes). Runs ONLY with AGENT_E2E_ARM set.
//
//   AGENT_E2E_ARM=A|B|C            A legacy + routing v2 + fast paths/compound · B NL-1 · C NL-1 (the model is the paid run's)
//   AGENT_EVAL_FILES=<f>[@split],… corpus files (default realModelBench.v1.json,e2eBench.v1.json); an ABSOLUTE path works
//                                  from any checkout (AUDIT's sealed file: <abs>@sealed → aggregates and case ids only)
//   AGENT_E2E_SUBSET=<file>        the paired stratified subset ({ cases: { <file>: [ids] } }); default every case
//   AGENT_E2E_BANK=<dir>           every earlier round's runner results (*.json); AGENT_E2E_NEW_RESULTS=<file> is copied in first
//   AGENT_E2E_OUT=<file>           the NEXT round's paid input: every request the bank cannot answer yet ([] = complete)
//   AGENT_E2E_REPORT=<file>        the arm's report (aggregates, per-class tables, per-turn rows for dev files)
//   AGENT_E2E_PROXY=1              FREE cost proxy: every turn answered with its EXPECTED envelope and every request
//                                  written to AGENT_E2E_OUT — the whole dialogue's bodies, for the runner's dry-run estimate
//
// Rounds: round 1 = the dialogues' first requests; each paid round answers what the last replay could not, and the next
// replay runs turn N+1 on the board turn N really produced. The arm is complete when AGENT_E2E_OUT is [].
import { it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { evalSets, specFor } from './testing/bench'
import { evaluateCase, expectedResponder } from './testing/e2eEval'
import { ARMS, loadBank, bankFiles, collectingResponder, stepsOf } from './testing/e2eRun'
import { armTable } from './testing/e2eScore'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
vi.mock('./nl1/interpreter', async (orig) => {
  const m = await orig()
  return { ...m, buildNl1Request: (args) => { const r = m.buildNl1Request(args); if (!args?.need) (globalThis.__e2eTap ||= {}).nl1 = r; return r } }
})
vi.mock('./runtime', async (orig) => {
  const m = await orig()
  // the plans the runtime actually COMMITTED (what reached the writers): the executed plan of a turn
  return { ...m, commitPlan: async (host, plan, o) => { const res = await m.commitPlan(host, plan, o); ((globalThis.__e2eTap ||= {}).committed ||= []).push({ ops: (plan?.plans || []).flatMap(p => (p.items || []).map(i => i.op?.action)).filter(Boolean), ok: !!res?.ok }); return res } }
})
vi.mock('./nlm1/flag', async (orig) => {
  const m = await orig()
  return { ...m, pickRouter: () => { const route = m.pickRouter(); return (full, text, routeOpts, need) => { const routed = route(full, text, routeOpts, need); if (need === undefined) (globalThis.__e2eTap ||= {}).route = { route, full, text, routeOpts, routed }; return routed } } }
})

registerBuiltins()
const env = globalThis.process?.env || {}
const ARM = env.AGENT_E2E_ARM
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.resolve(HERE, '__fixtures__/nlIntent')
const PRICES = path.resolve(HERE, '../../../tools/agent_eval_prices.json')

const groupBy = (rows, f) => { const m = {}; for (const r of rows) { const k = f(r) || '-'; (m[k] ||= []).push(r) } return m }
const line = (k, t) => `  ${k.padEnd(22)} n ${String(t.turns).padStart(3)}  ok ${String(t.successPct ?? '-').padStart(5)}%  SILENT-DROPS ${t.silentDrops} WRONG-CHART-WRITES ${t.wrongChartWrites}  wrongChart ${t.wrong_chart} wrongAct ${t.wrong_action} unsafe ${t.unsafe}  partial ${t.partial_reported}+${t.partial_silent}silent residue ${t.residue}  ask- ${t.unnecessary_ask} ask+ ${t.missed_ask} refusal ${t.refusal}  cancelled ${t.cancelled}  pending ${t.pending}`

it.skipIf(!ARM)('e2e arm', async () => {
  if (!ARMS[ARM]) throw new Error(`AGENT_E2E_ARM must be one of ${Object.keys(ARMS).join(', ')}`)
  const spec = JSON.parse(fs.readFileSync(path.join(DIR, 'corpus.json'), 'utf8'))
  const prices = JSON.parse(fs.readFileSync(PRICES, 'utf8'))
  if (env.AGENT_E2E_BANK) fs.mkdirSync(env.AGENT_E2E_BANK, { recursive: true })
  if (env.AGENT_E2E_NEW_RESULTS && fs.existsSync(env.AGENT_E2E_NEW_RESULTS) && env.AGENT_E2E_BANK) {
    const dest = path.join(env.AGENT_E2E_BANK, `${String(Date.now())}-${path.basename(env.AGENT_E2E_NEW_RESULTS)}`)
    fs.copyFileSync(env.AGENT_E2E_NEW_RESULTS, dest)
  }
  const bank = loadBank(env.AGENT_E2E_BANK ? bankFiles(env.AGENT_E2E_BANK) : [])
  const subset = env.AGENT_E2E_SUBSET ? JSON.parse(fs.readFileSync(path.isAbsolute(env.AGENT_E2E_SUBSET) ? env.AGENT_E2E_SUBSET : path.join(DIR, env.AGENT_E2E_SUBSET), 'utf8')) : null
  const files = env.AGENT_EVAL_FILES ? env : { ...env, AGENT_EVAL_FILES: 'realModelBench.v1.json,e2eBench.v1.json' }
  const collect = new Map(), catalogs = new Map()
  const report = { arm: ARM, ...ARMS[ARM], bankRows: bank.size, files: [] }
  let sealedAny = false
  for (const s of evalSets(files, DIR)) {
    const data = s.data
    const sp = specFor(spec, data)
    const ids = subset?.cases?.[s.file] || null
    const cases = data.cases.filter(c => !ids || ids.includes(c.id))
    const rows = []
    for (const c of cases) {
      const meta = { caseId: c.id, turn: 0 }
      const opts = env.AGENT_E2E_PROXY === '1'
        ? { responderFor: (m) => collectingResponder(expectedResponder(), { arm: ARM, collect, catalogs, set: s.file, split: s.split, meta: m || meta }) }
        : { bank, collect, catalogs }
      const r = await evaluateCase({ spec: sp, c, arm: ARM, set: s.file, split: s.split, prices, ...opts })
      rows.push(...r.rows.map(x => ({ ...x, set: s.file, cls: c.cls || (c.mix === 'single' ? 'single' : c.mix === 'multi' ? 'multi' : c.mix === 'followup' ? 'followup' : c.mix === 'ask' ? 'ask' : c.mix) })))
    }
    const sealed = s.split === 'sealed'
    sealedAny ||= sealed
    const table = armTable(rows)
    const byCls = Object.fromEntries(Object.entries(groupBy(rows, r => r.cls)).map(([k, v]) => [k, armTable(v)]))
    report.files.push({ file: s.file, split: s.split, cases: cases.length, table, byClass: byCls,
      // sealed: aggregates and case ids only (never a case's words or its per-turn detail)
      ...(sealed ? { ids: Object.fromEntries(Object.entries(groupBy(rows, r => r.outcome)).map(([k, v]) => [k, [...new Set(v.map(x => x.caseId))]])) }
        : { rows }) })
    console.log(`\n── E2E arm ${ARM} (${ARMS[ARM].about}) · ${s.file} [${s.split}] · ${cases.length} cases, ${rows.length} turns, bank ${bank.size}`)
    console.log(line('all', table))
    for (const [k, t] of Object.entries(byCls)) console.log(line(k, t))
    console.log(`  dialogues ${table.dialogues} complete, ${table.dialogueSuccessPct ?? '-'}% wholly right · lanes deterministic ${table.lanes.deterministic} (${table.deterministicSuccessPct ?? '-'}% ok) model ${table.lanes.model} (${table.modelSuccessPct ?? '-'}% ok)`)
    console.log(`  latency model p50 ${table.latency.modelMsP50 ?? '-'} ms p95 ${table.latency.modelMsP95 ?? '-'} ms rounds mean ${table.latency.roundsMean ?? '-'} max ${table.latency.roundsMax ?? '-'} · cost $${table.cost.usd} (${table.cost.requests} requests, $${table.cost.perRequest ?? '-'}/request, $${table.cost.perTurn ?? '-'}/turn)`)
    // e2-sb05 (explicit replace + side by side): ask vs act, its own line (AUDIT 11-24: an ask is not wrong, but unneeded)
    for (const r of rows.filter(x => x.key === 'e2-sb05#0')) console.log(`  e2-sb05 ask/act split   ${r.asked ? 'ASKED' : 'ACTED'} -> ${r.outcome}${r.why ? ` (${r.why})` : ''}`)
    if (!sealed && env.AGENT_E2E_VERBOSE) for (const r of rows.filter(x => x.outcome !== 'success')) console.log(`    ${r.key} ${r.outcome} ${r.why || ''}`)
  }
  const items = [...collect.values()]
  report.nextRound = { requests: items.length, complete: items.length === 0 && env.AGENT_E2E_PROXY !== '1' }
  if (env.AGENT_E2E_OUT) fs.writeFileSync(env.AGENT_E2E_OUT, JSON.stringify([...items, ...catalogs.values()]))
  if (env.AGENT_E2E_REPORT) fs.writeFileSync(env.AGENT_E2E_REPORT, JSON.stringify(report, null, 1))
  console.log(`\nnext round: ${items.length} requests${env.AGENT_E2E_OUT ? ` → ${env.AGENT_E2E_OUT}` : ''}${sealedAny ? ' (holds sealed words: runner input only)' : ''}`)
  void stepsOf
}, 4 * 3600 * 1000)
