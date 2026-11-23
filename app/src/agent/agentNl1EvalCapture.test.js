// NL-1 EVAL — request capture for the paid replay. Runs ONLY with AGENT_EVAL_OUT set; makes no model call.
//
//   AGENT_EVAL_OUT=<file> [AGENT_EVAL_MODE=nl1|legacy|both] [AGENT_EVAL_SETS=corpus.json,sealed-v3.json]
//   [AGENT_EVAL_FILES=realModelBench.v1.json,<abs path>@sealed]  other corpus files instead of SETS (testing/bench.js)
//   [AGENT_EVAL_ROUTER=v1|v2]       the legacy request's router (default v1; production's panel = v2, nlm1/flag.js)
//   [AGENT_EVAL_LEGACY_REROUTES=1]  table the legacy panel's need_groups reroute for the replay (testing/capture.js)
//   npx vitest run src/agent/agentNl1EvalCapture.test.js
//
// Writes one item per turn: { key, set, split, caseId, turn, mode, body, history, refMap } — NL-1 items also
// { catalog, selection, reroutes } — and one entry per distinct NL-1 catalog ({ catalog, manifest, ... }). The file holds
// sealed cases' words: it is input for tools/agent_eval_run.py, never something to read through.
import { it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { evalSets, specFor } from './testing/bench'
import { captureCase } from './testing/capture'
import { isProtected } from './protectedLayouts'
import { loadMeta, loadOptions, loadSaved, _resetScreenerCache } from './capabilities/screener'

registerBuiltins()

const env = globalThis.process?.env || {}
const OUT = env.AGENT_EVAL_OUT
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.resolve(HERE, '__fixtures__/nlIntent')

it.skipIf(!OUT)('captures the eval requests', async () => {
  const spec = JSON.parse(fs.readFileSync(path.join(DIR, 'corpus.json'), 'utf8'))
  // the Screener's catalog and starter screens, as a member's panel has them loaded (fixture, not production)
  const scr = JSON.parse(fs.readFileSync(path.join(DIR, 'screener-catalog.json'), 'utf8'))
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/screener/fields') return json({ fields: scr.fields })
    if (url === '/api/screener/fields?options=1') return json({ options: scr.options })
    if (url === '/api/screener/saved-screens') return json({ saved: [], starters: scr.starters })
    return json({})
  })
  _resetScreenerCache()
  await loadMeta(); await loadOptions(); await loadSaved({ force: true })
  const modes = env.AGENT_EVAL_MODE === 'both' ? ['legacy', 'nl1'] : [env.AGENT_EVAL_MODE || 'nl1']
  const only = env.AGENT_EVAL_SETS ? new Set(env.AGENT_EVAL_SETS.split(',')) : null
  const items = []
  const catalogs = new Map()             // NL-1: each distinct full catalog once (the reroute replay assembles from it)
  const router = env.AGENT_EVAL_ROUTER || 'v1'
  const legacyReroutes = env.AGENT_EVAL_LEGACY_REROUTES === '1'
  for (const s of evalSets(env, DIR).filter(x => !only || only.has(x.file))) {
    const data = s.data || JSON.parse(fs.readFileSync(s.path, 'utf8'))
    const sp = specFor(spec, data)
    for (const c of data.cases) {
      for (const mode of modes) {
        for (const t of captureCase(sp, c, mode, { isProtectedLayout: (e) => isProtected(e), catalogs, router, legacyReroutes })) items.push({ ...t, set: s.file, split: s.split })
      }
    }
  }
  // catalog entries ({ catalog, manifest, core, groupOf, groups }) carry no `mode`: never replayed or scored as turns
  fs.writeFileSync(OUT, JSON.stringify([...items, ...catalogs.values()]))
  const by = {}
  for (const i of items) by[`${i.set} ${i.mode}`] = (by[`${i.set} ${i.mode}`] || 0) + 1
  console.log(`\ncaptured ${items.length} requests → ${OUT}\n${Object.entries(by).map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n`)
}, 300000)
