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
import { OOS_ABSENT, partialNote, itNeedsLocalOnly } from './__tests__/oosLocalOnly.js'

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

/** ⏭ Licence-held pine_oos members absent on this machine, keyed as the artifact
 *  keys them. They cannot be measured here, so the map check leaves them to the
 *  named skip at the bottom rather than reporting them as "gone". */
const ABSENT = new Set(OOS_ABSENT.map((n) => `tests/fixtures/pine_oos/${n}`))

// ⛔⛔ A REGENERATION ON A PARTIAL RIG MUST NOT ERASE WHAT IT COULD NOT READ.
// ⚰️ 2026-09-28: a plain write here, on a checkout without the licence-held
// members, dropped 29 pinned maps — every one of them would then have read as
// "added" on a complete rig, and their old ids would have been lost. So an absent
// licence-held member KEEPS its pinned map, carried over verbatim; only what was
// actually measured is rewritten. Key order follows the pinned file, then new keys.
export function mergeForWrite(pinned, measured, absent) {
  const out = {}
  for (const k of Object.keys(pinned)) {
    if (k in measured) out[k] = measured[k]
    else if (absent.has(k)) out[k] = pinned[k]
  }
  for (const k of Object.keys(measured)) if (!(k in out)) out[k] = measured[k]
  return out
}

if (process.env.PARAM_IDS_WRITE) {
  const pinned = fs.existsSync(ARTIFACT) ? JSON.parse(fs.readFileSync(ARTIFACT, 'utf8')) : {}
  const merged = mergeForWrite(pinned, MEASURED, ABSENT)
  fs.writeFileSync(ARTIFACT, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
}

describe('parameter ids are an address, and addresses do not move', () => {
  it(`⛔⛔ NON-VACUITY — the corpus is here and parameters really are minted${partialNote()}`, () => {
    // Every assertion below is satisfied by an empty corpus or a manifest that
    // never ran, so the premise is pinned first. Named absentees are accounted
    // for in the title, never counted as measured.
    expect(Object.keys(MEASURED).length).toBeGreaterThan(300 - ABSENT.size)
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

  it(`⛔⛔ EVERY SCRIPT'S MAP IS UNCHANGED — reported by NAME, id, old and new${partialNote()}`, () => {
    expect(fs.existsSync(ARTIFACT),
      'the committed map is missing — regeneration is an owner-ruled act').toBe(true)
    const pinned = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'))

    const added = Object.keys(MEASURED).filter((k) => !(k in pinned))
    // ⏭ A licence-held absentee is not "gone" — it is unmeasurable here, and the
    // skip below says so by name. Anything else missing is a real move.
    const gone = Object.keys(pinned).filter((k) => !(k in MEASURED) && !ABSENT.has(k))
    expect({ added, gone }, 'the corpus membership moved').toEqual({ added: [], gone: [] })

    // ⛔ A SET-AND-ORDER DIFF THAT NAMES BOTH TITLES. "The counts match" is the
    // answer that lets two knobs swap ids unnoticed — which is the whole defect.
    const moved = []
    for (const script of Object.keys(pinned).filter((k) => !ABSENT.has(k))) {
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

  // ⏭ The maps the check above could not read: skipped by NAME while any
  // licence-held member is absent, and a real comparison on a complete rig.
  it('⛔ A PARTIAL-RIG REGENERATION CARRIES ABSENT LICENCE-HELD MAPS OVER, AND DROPS ONLY WHAT LEFT', () => {
    const pinned = {
      'a.pine': { __uct_param_1: 'old A' },
      'held.pine': { __uct_param_1: 'kept' },
      'deleted.pine': { __uct_param_1: 'gone' },
    }
    const measured = { 'a.pine': { __uct_param_1: 'new A' }, 'b.pine': {} }
    const out = mergeForWrite(pinned, measured, new Set(['held.pine']))
    // measured wins; the absent licence-held map survives verbatim; a script that
    // left the corpus (not licence-held) is dropped; a new one is appended.
    expect(out).toEqual({
      'a.pine': { __uct_param_1: 'new A' },
      'held.pine': { __uct_param_1: 'kept' },
      'b.pine': {},
    })
    expect(Object.keys(out)).toEqual(['a.pine', 'held.pine', 'b.pine'])
  })

  itNeedsLocalOnly('ALL', 'every licence-held pine_oos script\'s map is unchanged too', () => {
    const pinned = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'))
    const oos = Object.keys(pinned).filter((k) => k.startsWith('tests/fixtures/pine_oos/'))
    const drift = oos.filter((k) => JSON.stringify(pinned[k]) !== JSON.stringify(MEASURED[k]))
    expect(drift).toEqual([])
  })
})
