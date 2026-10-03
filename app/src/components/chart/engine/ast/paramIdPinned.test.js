// ─── H1 — the pinned lane cannot grow a pinned script's parameter map ──────────
//
// `paramIdPinned.js` lists the scripts `docs/pine/param-ids.json` pins. In the
// plain strict lane (the one that artifact records) such a script mints only the
// ids its frozen entry names — so a script that refused when the map was frozen and
// translates now (`twin-range-filter`, a helper's range filter, since H1) adds no id
// there, while the member door still hands out its knobs at source ids.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine, lexPine } from './pine.js'
import { memberInputTranslation } from '../../builder/builderInputs.js'
import { scriptKey } from './paramIdSource.js'
import { PINNED_SCRIPT_KEYS } from './paramIdPinned.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const PINNED = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/pine/param-ids.json'), 'utf8'))
const read = (k) => fs.readFileSync(path.join(REPO, k), 'utf8')

describe('H1 — the pinned lane is fixed for every script param-ids.json lists', () => {
  it('⛔ DERIVED: the list is exactly the present, non-throwing scripts of param-ids.json', () => {
    const want = new Set()
    for (const k of Object.keys(PINNED)) {
      if (!fs.existsSync(path.join(REPO, k)) || PINNED[k].threw) continue
      want.add(scriptKey(lexPine(read(k)).tokens))
    }
    expect(want.size).toBeGreaterThan(250) // non-vacuity: the artifact was found
    expect([...PINNED_SCRIPT_KEYS].sort()).toEqual([...want].sort())
  })

  const TWIN = 'corpus/committed/twin-range-filter__xF3L2PeXm7.pine'
  it('⭐ twin-range-filter translates, mints nothing in the pinned lane, and keeps its knobs at the member door', () => {
    expect(PINNED[TWIN]).toEqual({})
    const plain = translatePine(read(TWIN), { paramManifest: true, strict: true })
    expect(plain.ok).toBe(true)
    expect(plain.inputParams || []).toEqual([])
    const member = memberInputTranslation(translatePine, read(TWIN), { paramManifest: true, strict: true })
    const knobs = [...(member.declared || []), ...(member.inputParams || []).map((p) => p.sourceName)]
    expect(knobs.length).toBeGreaterThan(0)
  })

  it('⛔ control: a script param-ids.json does NOT list still mints source ids in the pinned lane', () => {
    const src = '//@version=5\nindicator("unlisted")\nlen = input.int(14, "Len")\nplot(ta.sma(close, len))\n'
    const t = translatePine(src, { paramManifest: true, strict: true })
    expect((t.inputParams || []).map((p) => p.id)).toEqual(['__uct_param_1001'])
  })
})
