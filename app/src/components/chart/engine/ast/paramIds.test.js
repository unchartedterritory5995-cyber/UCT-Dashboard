// app/src/components/chart/engine/ast/paramIds.test.js
//
// ─── ⭐⭐ EVERY SCRIPT'S `__uct_param_N` → TITLE MAP, PINNED ─────────────────
//
// ⛔⛔ A PARAMETER ID IS AN ADDRESS INTO A SAVED MEMBER DEFINITION. `__uct_param_N`
// is POSITIONAL, so anything that adds, removes or reorders a minted parameter
// RENUMBERS every parameter after it and silently re-points whatever was saved
// against those ids.
//
// ⚰️ THIS RAIL EXISTS BECAUSE A SHIFT WAS FOUND BY ACCIDENT. R35c made an input
// foldable, foldability was treated as use, and `uncharted-volume-v2` went from 3
// parameters to 4 with `HVE lookback (bars)` moving from `__uct_param_3` to
// `__uct_param_4`. Nothing was watching for that. It surfaced only because a
// DIFFERENT test addressed a knob by hard-coded id and silently began testing a
// different knob — the guard fired, on the adjacent thing. R36 restored the map;
// this file is what makes the next shift a named failure instead of a discovery.
//
// ⛔ REGENERATION IS AN OWNER-RULED ACT, NOT A FIX FOR A RED. If this rail goes
// red, the question is "which ruling moved an id, and what happens to definitions
// saved against the old one?" — never "regenerate the artifact". H.11 (stable ids
// keyed by declared NAME rather than position, plus a migration) is the standing
// item that would retire the hazard; until it lands, a red here is a migration
// question.
//
//   OWNER-RULED REGENERATION:
//   PARAM_IDS_WRITE=1 npx vitest run src/components/chart/engine/ast/paramIds.test.js
//
// ⭐ ONE RECIPE. The map is built HERE and nowhere else, so the artifact and the
// assertion cannot drift into two opinions about what a parameter map is — the
// same reason `build_pr_body.py` owns its parts list (R31).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const ARTIFACT = path.join(REPO, 'docs/pine/param-ids.json')
const SOURCES = ['corpus/committed', 'tests/fixtures/pine_oos', 'tests/fixtures/member']

/** The ORDERED `id → declared title` map one script declares. */
function paramMap(src) {
  let t
  try {
    t = translatePine(src, { strict: true, paramManifest: true })
  } catch (e) {
    return { threw: String((e && e.message) || e).slice(0, 100) }
  }
  const out = {}
  for (const p of (t.inputParams || [])) out[p.id] = String(p.label || p.title || '')
  return out
}

const MEASURED = {}
for (const dir of SOURCES) {
  const abs = path.join(REPO, dir)
  if (!fs.existsSync(abs)) continue
  for (const f of fs.readdirSync(abs).filter((x) => x.endsWith('.pine')).sort()) {
    MEASURED[`${dir}/${f}`] = paramMap(fs.readFileSync(path.join(abs, f), 'utf8'))
  }
}

if (process.env.PARAM_IDS_WRITE) {
  fs.writeFileSync(ARTIFACT, `${JSON.stringify(MEASURED, null, 2)}\n`, 'utf8')
}

describe('parameter ids are an address, and addresses do not move', () => {
  it('⛔⛔ NON-VACUITY — the corpus is here and parameters really are minted', () => {
    // Every assertion below is satisfied by an empty corpus or a manifest that
    // never ran, so the premise is pinned first.
    expect(Object.keys(MEASURED).length).toBeGreaterThan(300)
    const withParams = Object.values(MEASURED).filter((m) => Object.keys(m).length > 0)
    expect(withParams.length, 'nothing mints — the manifest is off').toBeGreaterThan(50)
  })

  it('⛔⛔ VOLUME v2 IS THE NAMED SPECIMEN — 3 params, HVE lookback at _3', () => {
    // ⭐ The script the shift was measured on, asserted by NAME and by ID rather
    // than by count: a count of 3 is also satisfied by three knobs in the wrong
    // order, which is the failure this rail is about.
    const m = MEASURED['tests/fixtures/member/uncharted-volume-v2.pine']
    expect(m, 'the specimen left the corpus — this rail is vacuous').toBeTruthy()
    expect(Object.keys(m).length, 'a presentation fold minted a parameter again').toBe(3)
    expect(m.__uct_param_3, '__uct_param_3 no longer addresses the HVE lookback')
      .toMatch(/HVE lookback/i)
  })

  it('⛔⛔ EVERY SCRIPT\'S MAP IS UNCHANGED — reported by NAME, id, old and new', () => {
    expect(fs.existsSync(ARTIFACT),
      'the committed map is missing — regeneration is an owner-ruled act').toBe(true)
    const pinned = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'))

    const added = Object.keys(MEASURED).filter((k) => !(k in pinned))
    const gone = Object.keys(pinned).filter((k) => !(k in MEASURED))
    expect({ added, gone }, 'the corpus membership moved').toEqual({ added: [], gone: [] })

    // ⛔ A SET-AND-ORDER DIFF THAT NAMES BOTH TITLES. "The counts match" is the
    // answer that lets two knobs swap ids unnoticed — which is the whole defect.
    const moved = []
    for (const script of Object.keys(pinned)) {
      const was = pinned[script]
      const now = MEASURED[script]
      const ids = [...new Set([...Object.keys(was), ...Object.keys(now)])].sort()
      for (const id of ids) {
        if (was[id] !== now[id]) {
          moved.push({ script, id, was: was[id] ?? '(absent)', now: now[id] ?? '(absent)' })
        }
      }
    }
    expect(moved, `parameter ids moved:\n${JSON.stringify(moved, null, 2)}`).toEqual([])
  })
})
