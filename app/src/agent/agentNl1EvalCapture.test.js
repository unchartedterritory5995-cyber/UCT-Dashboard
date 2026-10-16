// NL-1 EVAL — request capture for the paid replay. Runs ONLY with AGENT_EVAL_OUT set; makes no model call.
//
//   AGENT_EVAL_OUT=<file> [AGENT_EVAL_MODE=nl1|legacy|both] [AGENT_EVAL_SETS=corpus.json,sealed-v3.json]
//   npx vitest run src/agent/agentNl1EvalCapture.test.js
//
// Writes one item per turn: { key, set, split, caseId, turn, mode, body, history, refMap }. The file holds
// sealed cases' words: it is input for tools/agent_eval_run.py, never something to read through.
import { it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { SETS } from './eval/sets'
import { captureCase } from './eval/capture'

registerBuiltins()

const env = globalThis.process?.env || {}
const OUT = env.AGENT_EVAL_OUT
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.resolve(HERE, '__fixtures__/nlIntent')

it.skipIf(!OUT)('captures the eval requests', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(DIR, 'corpus.json'), 'utf8'))
  const modes = env.AGENT_EVAL_MODE === 'both' ? ['legacy', 'nl1'] : [env.AGENT_EVAL_MODE || 'nl1']
  const only = env.AGENT_EVAL_SETS ? new Set(env.AGENT_EVAL_SETS.split(',')) : null
  const items = []
  for (const s of SETS.filter(x => !only || only.has(x.file))) {
    const data = JSON.parse(fs.readFileSync(path.join(DIR, s.file), 'utf8'))
    for (const c of data.cases) {
      for (const mode of modes) {
        for (const t of captureCase(spec, c, mode)) items.push({ ...t, set: s.file, split: s.split })
      }
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(items))
  const by = {}
  for (const i of items) by[`${i.set} ${i.mode}`] = (by[`${i.set} ${i.mode}`] || 0) + 1
  console.log(`\ncaptured ${items.length} requests → ${OUT}\n${Object.entries(by).map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n`)
}, 300000)
