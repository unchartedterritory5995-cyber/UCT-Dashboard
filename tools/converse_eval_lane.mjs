// tools/converse_eval_lane.mjs
//
// THE BROWSER HALF OF `tools/converse_eval.py`, run in node.
//
// ⭐ IT RUNS THE SHIPPED MODULES, NOT A COPY. Every step below is an import of the
// file the browser runs: the authoring session (`localTurn` / `modelTurn`), the
// wire client (`converseBody` / `converseTurn`), the engine (`applyTurn`,
// `prepareSave`, `openAuthoringState`) and the chart compute
// (`validateUserDefinitions` → `computeFor`). The runner bundles this file with the
// esbuild already in `app/node_modules` (the `build-cot-facts.mjs` precedent), so
// vite-only syntax (`import.meta.env`, extensionless and `.jsx` imports) resolves
// exactly as it does in the app.
//
// ⛔ THE SERVER IS NOT CALLED FROM HERE. `modelTurn` is handed a `converse` whose
// fetch answers with the body the PYTHON side already got from the real
// `definition_conversation.converse`, so `converseTurn`'s normalisation still runs
// on the real response. ⛔ `globalThis.fetch` is replaced by a refusal: nothing in
// this process may reach the network (telemetry, bars, anything).
//
// Protocol: one JSON object per line on stdin, one JSON answer per line on stdout,
// `{ok: true, ...}` or `{ok: false, error}`.

import readline from 'node:readline'
import {
  newAuthoringState, openAuthoringState, prepareSave, readback,
} from '../app/src/components/chart/builder/authoring/index.js'
import { localTurn, modelTurn } from '../app/src/components/chart/builder/authoring/authoringSession.js'
import { converseBody, converseTurn } from '../app/src/components/chart/builder/authoring/converseClient.js'
import { astHash } from '../app/src/components/chart/engine/ast/parse.js'
import { validateUserDefinitions, computeFor } from '../app/src/components/chart/engine/nativeRegistry.js'
import { outputsOf, outputTreeOf } from '../app/src/components/chart/engine/outputType.js'

const BLOCKED = []
globalThis.fetch = async (url) => {
  BLOCKED.push(String(url).slice(0, 120))
  throw new Error('converse_eval lane: network is refused in this process')
}

const sessions = new Map()

function gateCtxOf(s) {
  return { symbol: s.sym, tf: s.tf }
}

function summary(s) {
  const rb = s.state.working ? readback(s.state.working, s.state, gateCtxOf(s)) : null
  return {
    revision: s.state.revision,
    working: s.state.working,
    questions: s.state.questions || [],
    readback: rb ? { lines: [...rb.lines], name: rb.name } : null,
  }
}

function columnsOf(def, bars) {
  const { defs, errors } = validateUserDefinitions([def])
  if (!defs.length) return { valid: false, errors, columns: {}, hashes: {} }
  const live = defs[0]
  const raw = computeFor(live, bars, {}, {})
  const columns = {}
  for (const [k, col] of Object.entries(raw || {})) {
    if (col && typeof col.length === 'number') {
      columns[k] = Array.from(col, (v) => (v === null || v === undefined || Number.isNaN(v) ? null : v))
    }
  }
  const hashes = {}
  for (const o of outputsOf(live)) {
    const tree = outputTreeOf(live, o.key)
    try { hashes[o.key] = tree ? astHash(tree) : null } catch { hashes[o.key] = null }
  }
  return { valid: errors.length === 0, errors, columns, hashes }
}

async function handle(req) {
  switch (req.cmd) {
    case 'ping':
      return { pong: true }
    case 'new': {
      sessions.set(req.sid, { state: newAuthoringState(), sym: req.sym || 'TEST', tf: req.tf || 'D' })
      return summary(sessions.get(req.sid))
    }
    case 'open': {
      const s = sessions.get(req.sid) || { sym: req.sym || 'TEST', tf: req.tf || 'D' }
      s.state = openAuthoringState(req.def, { defId: req.defId, version: req.version })
      sessions.set(req.sid, s)
      return summary(s)
    }
    case 'local': {
      // the client's deterministic half: pre-flight and a name-only rename, no model call
      const s = sessions.get(req.sid)
      const out = localTurn(s.state, req.words, { sym: s.sym, tf: s.tf, gateCtx: gateCtxOf(s) })
      if (out === null) return { handled: false }
      if (out.state) s.state = out.state
      return { handled: true, turnOk: out.ok, changed: !!out.changed, entries: out.entries,
        renameOnly: !!out.renameOnly, ...summary(s) }
    }
    case 'body': {
      const s = sessions.get(req.sid)
      return { body: converseBody({ message: req.words, state: s.state, gateCtx: gateCtxOf(s), snippets: [] }) }
    }
    case 'model': {
      const s = sessions.get(req.sid)
      const before = s.state
      const server = req.serverBody
      const converse = (args) => converseTurn({
        ...args,
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => server }),
      })
      const out = await modelTurn(before, () => s.state, req.words,
        { snippets: [], gateCtx: gateCtxOf(s), converse })
      if (out.state) s.state = out.state
      return { turnOk: out.ok, changed: !!out.changed, outcome: out.outcome || null,
        entries: out.entries, changes: out.changes || [], errors: out.errors || [], ...summary(s) }
    }
    case 'save': {
      const s = sessions.get(req.sid)
      const r = prepareSave(s.state, { draftId: req.draftId || null })
      return { doc: r.doc, defId: r.defId, errors: r.errors, needsAck: r.needsAck }
    }
    case 'evaluate':
      return columnsOf(req.def, req.bars)
    case 'hash':
      return { hash: astHash(req.tree) }
    case 'blocked':
      return { blocked: [...BLOCKED] }
    default:
      throw new Error(`unknown command ${JSON.stringify(req.cmd)}`)
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.trim()) continue
  let answer
  try {
    const req = JSON.parse(line)
    answer = { ok: true, ...(await handle(req)) }
  } catch (err) {
    answer = { ok: false, error: String((err && err.stack) || err).slice(0, 4000) }
  }
  process.stdout.write(JSON.stringify(answer) + '\n')
}
