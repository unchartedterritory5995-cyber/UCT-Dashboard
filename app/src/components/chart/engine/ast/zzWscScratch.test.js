import { it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'
const REPO = path.resolve(process.cwd(), '..')
it('x', () => {
  for (const n of ['uncharted-volume-v2.pine', 'uncharted-volume.pine']) {
    const s = fs.readFileSync(path.join(REPO, 'tests/fixtures/member', n), 'utf8')
    const r = buildRuntimeIr(s, { bars: [{ t: 1761570600, o: 1, h: 2, l: 1, c: 2, v: 10 }, { t: 1761657000, o: 2, h: 3, l: 2, c: 3, v: 11 }], inputs: {}, ...runtimeClockOpts(false) })
    console.log(n, r.ok, r.refusal && r.refusal.guard, r.refusal && r.refusal.line, r.refusal && r.refusal.message.slice(0, 300), r.diagnostics.statements, JSON.stringify(r.diagnostics.skippedFunctions))
  }
})
