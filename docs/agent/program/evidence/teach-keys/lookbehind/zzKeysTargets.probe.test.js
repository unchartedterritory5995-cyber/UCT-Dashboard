// PROBE (evidence, not a rail): for the keys held-out phrasings, every guide held-out phrasing in the teach trees and every
// string literal in app/src/agent's test files that writes a chord or names a key (as written and lowercased): the key rows
// (CHART_KEY_ACTIONS) whose re says yes, and the guide's instant route on 2 surfaces. Once on the old keys.js, once on the new.
//   LB_PROBE_CORPUS=<cases json> LB_PROBE_OUT=<file> node node_modules/vitest/vitest.mjs run src/agent/zzKeysTargets.probe.test.js
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { CHART_KEY_ACTIONS } from './guide/keys'
import { testFileLiterals } from './__fixtures__/noLookbehind/corpus'

const digest = (v) => crypto.createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 12)
const safe = async (f) => { try { return await f() } catch (e) { return { threw: String(e && e.message || e).slice(0, 120) } } }

describe('keys probe', () => {
  beforeAll(() => { registerBuiltins() })
  it('records', async () => {
    const keysHeld = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../docs/agent/program/evidence/teach-keys/heldout.cases.json'), 'utf8')).map((c) => c.say)
    const held = [...keysHeld, ...JSON.parse(fs.readFileSync(process.env.LB_PROBE_CORPUS, 'utf8')).map((c) => c.say)]
    const lits = testFileLiterals().literals.filter((s) => /\+|\bkeys?\b|shortcut|hot ?key|esc|\?/i.test(s) && s.length < 200 && !/agentGuideKeysNoLookbehind/.test(s))
    const phrases = [...new Set([...held, ...lits].flatMap((q) => [q, q.toLowerCase()]))]
    const rows = []
    for (const q of phrases) {
      const rowsHit = CHART_KEY_ACTIONS.filter((a) => a.re.test(q)).map((a) => a.id)
      const routes = {}
      for (const surface of ['charts', 'watchlists']) routes[surface] = digest(await safe(() => getCapability('guide.show').fast({ raw: q, host: { surface } })))
      rows.push({ q, held: held.includes(q), rowsHit, routes })
    }
    fs.writeFileSync(process.env.LB_PROBE_OUT, JSON.stringify(rows))
    expect(rows.length).toBeGreaterThan(300)
  }, 600000)
})
