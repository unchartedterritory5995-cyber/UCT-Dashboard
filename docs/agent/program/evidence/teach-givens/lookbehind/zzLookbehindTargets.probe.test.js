// PROBE (evidence, not a rail): records, for every guide held-out phrasing in the teach trees plus every string literal in
// app/src/agent's test files, its concepts (conceptsOf), the walkthrough the instant path reaches (guide.show fast route)
// and that walkthrough's step targets. Run it once before and once after the words.js answer-piece change, then diff.
//   LB_PROBE_OUT=<file> node node_modules/vitest/vitest.mjs run src/agent/zzLookbehindTargets.probe.test.js
import fs from 'node:fs'
import crypto from 'node:crypto'
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { conceptsOf } from './guide/words'
import { matchFeature } from './guide/registry'
import { guideSteps } from './capabilities/guide'
import { testFileLiterals } from './__fixtures__/noLookbehind/corpus'

const CORPUS = process.env.LB_PROBE_CORPUS
const OUT = process.env.LB_PROBE_OUT
const digest = (v) => crypto.createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 12)
const safe = (f) => { try { return f() } catch (e) { return { threw: String(e && e.message || e).slice(0, 120) } } }

describe('lookbehind probe', () => {
  beforeAll(() => { registerBuiltins() })
  it('records', async () => {
    const held = JSON.parse(fs.readFileSync(CORPUS, 'utf8')).map((c) => c.say)
    // every test literal that carries "respons" (the only words the change can touch), plus every held-out phrasing
    const lits = testFileLiterals().literals.filter((s) => /respons/i.test(s) && s.length < 200)
    const phrases = [...new Set([...held, ...lits])]
    const rows = []
    for (const q of phrases) {
      const concepts = [...conceptsOf(q)].sort()
      const routes = {}
      for (const surface of ['charts', 'watchlists', 'dashboard']) {
        const r = await safe(() => getCapability('guide.show').fast({ raw: q, host: { surface } }))
        const f = safe(() => matchFeature(q, null, surface))
        const steps = f && !f.threw ? safe(() => guideSteps(f, q).steps.map((s) => s.target)) : null
        routes[surface] = { fast: digest(r), feature: f && (f.id || f.threw) || null, targets: steps }
      }
      rows.push({ q, held: held.includes(q), concepts, routes })
    }
    fs.writeFileSync(OUT, JSON.stringify(rows))
    expect(rows.length).toBeGreaterThan(300)
  }, 600000)
})
