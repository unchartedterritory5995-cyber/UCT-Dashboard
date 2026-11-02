import { it, vi } from 'vitest'
import fs from 'node:fs'
import { translatePine } from '../components/chart/engine/ast/pine'
import { memberPaneDefinition } from '../components/chart/builder/memberPane/memberPaneDefinition'

const GATE = (rel) => fs.readFileSync(rel, 'utf8')
const flagOf = (src) => (src.match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const OBJ = flagOf(GATE('src/components/chart/engine/objectsOnlyPaneGate.js'))
const RT = flagOf(GATE('src/components/chart/engine/runtimePaneGate.js'))
const V6 = (b) => `//@version=6\nindicator("p")\n${b}`
const CASES = JSON.parse(fs.readFileSync(process.env.W1_CASES, 'utf8'))
it('probe', () => {
  const out = []
  for (const [name, body] of CASES) {
    const src = body.startsWith('//@version') ? body : V6(body)
    for (const rt of ['', '1']) {
      vi.stubEnv(OBJ, '1'); vi.stubEnv(RT, rt)
      let r
      try {
        const d = memberPaneDefinition({ source: src, id: 'u_w1p', name: 'p' })
        const refs = (d.translation?.refusals || []).map((x) => `${x.guard}|${x.token || ''}|${(x.message || '').slice(0, 120)}`)
        r = { ok: d.ok, reason: d.reason && String(d.reason).slice(0, 200), refs, lane: d.lane || d.definition?.lane || d.definition?.kind }
      } catch (e) { r = { err: String(e).slice(0, 200) } }
      out.push({ name, rt, ...r })
    }
    vi.unstubAllEnvs()
  }
  fs.writeFileSync(process.env.W1_OUT, JSON.stringify(out, null, 1))
}, 600000)
