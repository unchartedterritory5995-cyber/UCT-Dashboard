/**
 * ⛔⛔ K-R10 — A FLAG REACHES ALL FOUR AUTH PATHS, OR NONE.
 *
 * ⚰️ `AuthContext` applied its server-served flags at FOUR call sites — the
 * initial `/api/auth/me`, login, signup and refresh — as four hand-copied
 * blocks. Three flags meant twelve duplicated lines; Wave K's would have made it
 * sixteen.
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
    // places server-side and the client seats a user at four — the asymmetry is
    // real (one is /smoke-login, which no client code reads), and it is exactly
    // why this asks the code rather than a remembered list.
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

  it('the Notebook capabilities are fed to the LATCH from that same applier', () => {
    // K's flags keep no React state — they are latched — but they must still
    // travel the same four paths, which they do by riding the one applier.
    const at = CODE.indexOf('const applyServerFlags')
    const body = CODE.slice(at, at + 900)
    expect(body, 'the latch must be fed from the applier, not from one path').toContain('latchNotebookFlags')
    for (const k of ['notebook_offline_default_on', 'notebook_offline_read_on',
      'notebook_conflict_ux_on', 'notebook_attachments_on']) {
      expect(body, `${k} must reach the latch`).toContain(k)
    }
  })

  it('⭐ CONTROL — the straggler matcher really can see one', () => {
    const fake = 'function login(d){ setHubPreviewEnabled(d.x !== false) }'
    expect(/\bset[A-Z]\w*(?:Enabled|On)\s*\(/.test(fake)).toBe(true)
  })
})
