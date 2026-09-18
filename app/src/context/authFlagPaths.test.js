/**
 * ⛔⛔ K-R10 — A FLAG REACHES ALL FOUR AUTH PATHS, OR NONE.
 *
 * ⚰️ `AuthContext` applied its server-served flags at FOUR call sites — the
 * initial `/api/auth/me`, login, the TOTP second factor and signup — as four
 * hand-copied blocks. Three flags meant twelve duplicated lines; Wave K's would
 * have made it sixteen.
 *
 * ⛔ THE FAILURE MODE IS SILENT AND IT PICKS ITS VICTIM. A flag wired into three
 * paths and missed in the fourth works everywhere except one entry point — and
 * the one people forget is signup, which is the path a NEW member takes. The
 * flag would look correct to everyone who already had an account.
 *
 * So the mapping lives in one place and this rail reads the SOURCE to prove it:
 * one map, one applier, four call sites, no stragglers.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { FLAG_FALLBACKS } from '../pages/journal-2-0/lib/offline/notebookFlags'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, 'AuthContext.jsx'), 'utf8')
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

describe('⛔⛔ K-R10 — one map, four paths', () => {
  it('there is exactly ONE applier, and every flag goes through it', () => {
    expect((CODE.match(/const applyServerFlags\s*=/g) || []).length,
      'one definition, or there are two authorities again').toBe(1)
    expect((CODE.match(/const SERVER_FLAGS\s*=/g) || []).length).toBe(1)
  })

  it('the applier is called from all FOUR auth paths', () => {
    // ⛔ COUNT THE CALLS, NOT THE MENTIONS. The definition reads
    // `const applyServerFlags = (data) => {`, so `name(` does NOT match it —
    // an earlier version of this rail expected 5 and reported the correct code
    // as broken. The definition's existence is asserted separately above.
    const calls = (CODE.match(/applyServerFlags\s*\(/g) || []).length
    expect(calls, `expected 4 call sites (/me · login · TOTP verify · signup), got ${calls}`).toBe(4)
  })

  it('⛔⛔ EVERY auth response that seats a user applies the flags — DERIVED, not counted', () => {
    // ⭐ THE ONE THAT SURVIVES A FIFTH PATH. The count above pins today's shape;
    // this pins the PROPERTY, so an auth path added tomorrow (a magic-link, an
    // SSO callback, a second factor) cannot seat a member with stale flags and
    // leave every other assertion green. `_access_payload` is spliced at FIVE
    // places server-side and the client seats a user at four. ⭐ THE ASYMMETRY IS
    // REAL AND BENIGN, measured rather than assumed: the fifth is /smoke-login,
    // and `SmokeLogin.jsx` DOES call it — it discards the response body and calls
    // `refetch()`, so its flags arrive through the /me seat. Nothing reads the
    // PAYLOAD from it, which is the only sense in which four is the right number,
    // and it is exactly why this asks the code rather than a remembered list.
    const seats = [...CODE.matchAll(/setUser\s*\(\s*data\.user\s*\)/g)]
    expect(seats.length, 'no seat-the-user call found — this rail would pass over an empty set').toBe(4)
    const unflagged = []
    for (const m of seats) {
      const line = CODE.slice(0, m.index).split('\n').length
      // The applier is called within the same handler, right after the seat.
      const window = CODE.slice(m.index, m.index + 700)
      if (!/applyServerFlags\s*\(\s*data\s*\)/.test(window)) unflagged.push(`line ${line}`)
    }
    expect(unflagged, '⛔ an auth path seats a user without applying the server flags').toEqual([])
  })

  it('⛔ NO flag is set outside the map — a straggler setter is the defect', () => {
    // ⭐ Reads the source rather than the behaviour: a setter called directly
    // from one path is exactly the shape that works for three members in four.
    const stragglers = []
    for (const m of CODE.matchAll(/\b(set[A-Z]\w*(?:Enabled|On))\s*\(/g)) {
      const at = m.index
      const line = CODE.slice(0, at).split('\n').length
      const inMap = CODE.slice(Math.max(0, at - 400), at).includes('SERVER_FLAGS')
      const isDecl = /const \[[^\]]*\] = useState/.test(CODE.split('\n')[line - 1] || '')
      if (!inMap && !isDecl) stragglers.push(`${m[1]} at line ${line}`)
    }
    expect(stragglers, '⛔ a server-served flag is set outside the one map').toEqual([])
  })

  it('⛔⛔ the latch is fed by DERIVATION over FLAG_FALLBACKS, not a hand-copied list', () => {
    // K's flags keep no React state — they are latched — but they must still
    // travel the same four paths, which they do by riding the one applier.
    //
    // ⚰️ THIS RAIL USED TO LIST THE FOUR KEYS AND ASSERT EACH APPEARED HERE.
    // That pinned the old SHAPE: it passed only while the applier hand-copied
    // every key, which is the very duplication K-R10's own header calls the
    // hazard. Adding a fifth (`notebook_door_guard`, Q1 fix 6's rollback lever)
    // meant typing it in two files — `notebookFlags.js`, which owns the list,
    // and here. The applier now DERIVES the list, so the property this rail
    // wants holds by construction and cannot be missed for a new key.
    //
    // ⛔ So the assertion inverts: no capability key may be hand-typed in the
    // applier at all. Revert to a hand-copied list and this goes red on the
    // first key, which is the mutation proof.
    const at = CODE.indexOf('const applyServerFlags')
    const body = CODE.slice(at, at + 900)
    expect(body, 'the latch must be fed from the applier, not from one path').toContain('latchNotebookFlags')
    expect(body, 'the key list must come from the module that owns it').toContain('FLAG_FALLBACKS')

    const keys = Object.keys(FLAG_FALLBACKS)
    // ⛔ NON-VACUITY. An empty fallback table would make the loop below prove
    // nothing while reading as coverage.
    expect(keys.length, 'FLAG_FALLBACKS must actually carry capabilities').toBeGreaterThan(3)
    expect(keys, 'the mode flag is the one that motivated the derivation')
      .toContain('notebook_door_guard')
    for (const k of keys) {
      expect(body, `${k} is hand-typed in the applier again — the module owns the list`)
        .not.toContain(k)
    }
  })

  it('⭐ CONTROL — the straggler matcher really can see one', () => {
    const fake = 'function login(d){ setHubPreviewEnabled(d.x !== false) }'
    expect(/\bset[A-Z]\w*(?:Enabled|On)\s*\(/.test(fake)).toBe(true)
  })
})
