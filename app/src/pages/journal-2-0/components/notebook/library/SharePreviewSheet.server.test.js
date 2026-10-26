// @vitest-environment node
// Wave 11 Task 11.15 (review I-2): the share preview's field limits and the sentences beside them are the SERVER's,
// read from the server's own source text, never restated in a test. A field that let the author type past the
// server's cap would come back `invalid` and hide what travels.
//
// The server files land on the backend branch and reach this branch at the be -> impl merge. Until then the source
// is read from that branch with `git show`, never skipped: a twin rail that passes because the other side is absent
// proves nothing. After the merge the working tree holds it and git is not consulted. (GIT_* is scrubbed from the
// child's environment: an inherited GIT_DIR once corrupted the shared repo config.) The readers tolerate CRLF.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  NAME_MAX, DESCRIPTION_MAX, ITEM_MAX, UNIT_MAX, FIELD_NAME_MAX,
  NAME_HINT, DESCRIPTION_HINT, ITEM_HINT, UNIT_HINT, FIELD_NAME_HINT,
} from './SharePreviewSheet'

const REPO = path.resolve(__dirname, '../../../../../../..')
const BE_BRANCH = 'origin/feat/notebook-widgets-p2-be'
const SHARE = 'api/services/journal_two/widget_engine/share.py'
const FORMULA = 'api/services/journal_two/widget_formula.py'
const PLAN = 'api/services/journal_two/widget_engine/plan.py'

function serverSource(rel, marker) {
  const abs = path.join(REPO, rel)
  const local = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : ''
  if (marker.test(local)) return local
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
  return execFileSync('git', ['-C', REPO, 'show', `${BE_BRANCH}:${rel}`], { env, encoding: 'utf8' })
}

/** A top-level `NAME = <int>` or `NAME = "<text>"` of a Python module (CRLF-tolerant, trailing comment allowed). */
export function pyConst(src, name) {
  const m = new RegExp(`^${name} = (?:(\\d+)|"([^"]*)")[^\\r\\n]*\\r?$`, 'm').exec(src)
  if (!m) return undefined
  return m[1] !== undefined ? Number(m[1]) : m[2]
}

const share = serverSource(SHARE, /^S_NAME_LONG = /m)
const formula = serverSource(FORMULA, /^NAME_MAX = /m)
const plan = serverSource(PLAN, /^S_FORMULA_NAME_LONG = /m)

describe('the share preview limits are the server reducer\'s', () => {
  it('NON-VACUITY: the server sources were read', () => {
    expect(share).toMatch(/^def share_plan\(/m)
    expect(formula).toMatch(/^NAME_MAX = /m)
    expect(plan).toMatch(/^S_FORMULA_NAME_LONG = /m)
  })

  it.each([
    ['NAME_MAX', NAME_MAX, 'S_NAME_LONG', NAME_HINT],
    ['DESCRIPTION_MAX', DESCRIPTION_MAX, 'S_DESCRIPTION_LONG', DESCRIPTION_HINT],
    ['ITEM_TEXT_MAX', ITEM_MAX, 'S_ITEM_LONG', ITEM_HINT],
    ['UNIT_MAX', UNIT_MAX, 'S_UNIT_LONG', UNIT_HINT],
  ])('share.%s and its sentence', (cap, mine, sentence, hint) => {
    expect(pyConst(share, cap)).toBe(mine)
    expect(pyConst(share, sentence)).toBe(hint)
  })

  it('a field name is capped by widget_formula.NAME_MAX with plan.S_FORMULA_NAME_LONG, as share_plan applies it', () => {
    // The pairing itself is read from share_plan, so a reducer that moved field names to another cap goes red here.
    expect(share).toMatch(/_edit_text\(formula_edits\.get\(f\["id"\]\), wf\.NAME_MAX, wplan\.S_FORMULA_NAME_LONG\)/)
    expect(pyConst(formula, 'NAME_MAX')).toBe(FIELD_NAME_MAX)
    expect(pyConst(plan, 'S_FORMULA_NAME_LONG')).toBe(FIELD_NAME_HINT)
  })

  it('CONTROL: the reader sees a moved cap, a moved sentence and CRLF endings', () => {
    expect(pyConst('NAME_MAX = 81\n', 'NAME_MAX')).toBe(81)
    expect(pyConst('UNIT_MAX = 16    # comment\r\n', 'UNIT_MAX')).toBe(16)
    expect(pyConst('S_NAME_LONG = "A name can be at most 81 characters."\r\n', 'S_NAME_LONG')).not.toBe(NAME_HINT)
    expect(pyConst('X = 1\n', 'NAME_MAX')).toBeUndefined()
  })
})
