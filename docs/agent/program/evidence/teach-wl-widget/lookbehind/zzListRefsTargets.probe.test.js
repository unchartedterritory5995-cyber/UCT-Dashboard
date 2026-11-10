// PROBE (evidence, not a rail): for every guide held-out phrasing in the teach trees plus every string literal in
// app/src/agent's test files that says "list", read with a member's named lists: withListRefs' words, and the walkthrough
// the guide's instant path reaches (guide.show fast route, the host carrying those lists) and its step targets. Run once
// before and once after the listRefs.js no-lookbehind change, then diff.
//   LB_PROBE_CORPUS=<cases json> LB_PROBE_OUT=<file> node node_modules/vitest/vitest.mjs run src/agent/zzListRefsTargets.probe.test.js
import fs from 'node:fs'
import crypto from 'node:crypto'
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { withListRefs } from './guide/listRefs'
import { testFileLiterals } from './__fixtures__/noLookbehind/corpus'

const NAMES = ['Swing Ideas 2', 'Swing Ideas', 'Q4 Leaders', 'Momentum', 'Flagged', 'AI', 'Tech', 'A1', 'my picks', 'Leaders']
const digest = (v) => crypto.createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 12)
const safe = async (f) => { try { return await f() } catch (e) { return { threw: String(e && e.message || e).slice(0, 120) } } }

describe('listRefs probe', () => {
  beforeAll(() => { registerBuiltins() })
  it('records', async () => {
    const held = JSON.parse(fs.readFileSync(process.env.LB_PROBE_CORPUS, 'utf8')).map((c) => c.say)
    const lits = testFileLiterals().literals.filter((s) => /list|swing|momentum|leaders|flagged/i.test(s) && s.length < 200)
    const phrases = [...new Set([...held, ...lits])]
    const host = (surface) => ({ surface, watchlists: { snapshot: () => NAMES.map((name) => ({ name })) } })
    const rows = []
    for (const q of phrases) {
      const words = withListRefs(q, NAMES)
      const routes = {}
      for (const surface of ['charts', 'watchlists']) {
        const r = await safe(() => getCapability('guide.show').fast({ raw: q, host: host(surface) }))
        routes[surface] = { fast: digest(r), steps: r && r.steps ? r.steps.map((s) => s.target) : undefined }
      }
      rows.push({ q, held: held.includes(q), words, routes })
    }
    fs.writeFileSync(process.env.LB_PROBE_OUT, JSON.stringify(rows))
    expect(rows.length).toBeGreaterThan(300)
  }, 600000)
})
