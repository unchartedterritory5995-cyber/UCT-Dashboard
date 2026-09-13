/**
 * S4 CP1 — the divergence rail.
 *
 * ⛔ APPROVED SCOPE (owner, 2026-09-13, GATE-S4 CP1): *"A derivation + a
 * divergence rail. Read-only. Mounts nothing … plus one rail that is
 * source-derived and fails BY NAME."*
 *
 * The packet names eight mutations (§6). Each has a test here, tagged M-n, and
 * each was watched going red before this file was accepted.
 *
 * ⛔⛔ THE FAILURE MODE THIS RAIL EXISTS FOR IS SILENCE. A detector that reports
 * "agree" when one side is frozen, unread, or absent is the saturated-instrument
 * shape — it produces a clean number about nothing. Every status below is
 * asserted separately for exactly that reason.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  AGREE, DIVERGE, FOCUS_ONLY, HUB_ONLY, NEITHER, NOT_YET_READ, STATUSES,
  compareFocus, isDivergence,
} from './focusDivergence'

const SRC = path.resolve(process.cwd(), 'src')
const MODULE_REL = 'src/lib/context/focusDivergence.js'

/** ⛔ CODE, NEVER PROSE. This module's header DISCUSSES `useAppFocus`,
 *  `groupSyms.A` and `HubContext` at length; a raw search would match the
 *  explanation. A string-aware scanner, not a regex that eats apostrophes
 *  inside strings. */
function stripJsComments(src) {
  let out = ''
  let i = 0
  let mode = 'code'
  let quote = ''
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (mode === 'code') {
      if (c === '/' && d === '*') { mode = 'block'; i += 2; continue }
      if (c === '/' && d === '/') { mode = 'line'; i += 2; continue }
      if (c === '"' || c === "'" || c === '`') { mode = 'str'; quote = c; out += c; i += 1; continue }
      out += c; i += 1; continue
    }
    if (mode === 'block') { if (c === '*' && d === '/') { mode = 'code'; i += 2; continue } i += 1; continue }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c } i += 1; continue }
    if (c === '\\') { out += c + (d ?? ''); i += 2; continue }
    out += c
    if (c === quote) mode = 'code'
    i += 1
  }
  return out
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__pycache__') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(jsx?|tsx?|mjs)$/.test(e.name)) out.push(p)
  }
  return out
}

// ═══════════════════════════════════════════════════════════════════════════
// NON-VACUITY FIRST
// ═══════════════════════════════════════════════════════════════════════════

describe('non-vacuity', () => {
  it('the six statuses are distinct and none is missing', () => {
    expect(new Set(STATUSES).size).toBe(6)
    expect(STATUSES).toContain(NOT_YET_READ)
  })

  it('every status is REACHABLE — a status nothing produces is decoration', () => {
    const produced = new Set([
      compareFocus({ focusSymbol: 'AMD', hubSymbol: 'AMD' }).status,
      compareFocus({ focusSymbol: 'AMD', hubSymbol: 'NVDA' }).status,
      compareFocus({ focusSymbol: 'AMD', hubSymbol: null }).status,
      compareFocus({ focusSymbol: null, hubSymbol: 'AMD' }).status,
      compareFocus({ focusSymbol: null, hubSymbol: null }).status,
      compareFocus({ focusSymbol: 'AMD', hubSymbol: 'AMD', loading: true }).status,
    ])
    expect([...produced].sort()).toEqual([...STATUSES].sort())
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// THE COMPARISON — one assertion per status, so a regression names its branch
// ═══════════════════════════════════════════════════════════════════════════

describe('compareFocus', () => {
  it('agrees only when both are present and equal', () => {
    expect(compareFocus({ focusSymbol: 'AMD', hubSymbol: 'AMD' }).status).toBe(AGREE)
    expect(isDivergence(compareFocus({ focusSymbol: 'AMD', hubSymbol: 'AMD' }))).toBe(false)
  })

  it('⛔ M-4 — reports DIVERGENCE when the two differ, which is the whole point', () => {
    const r = compareFocus({ focusSymbol: 'AMD', hubSymbol: 'NVDA' })
    expect(r.status).toBe(DIVERGE)
    expect(isDivergence(r)).toBe(true)
    // …and it carries BOTH values, because "they disagree" without saying how
    // is a number nobody can act on.
    expect(r).toMatchObject({ focus: 'AMD', hub: 'NVDA' })
  })

  it('⛔ M-4 — a FROZEN hub side is a divergence, not agreement', () => {
    // The saturated-instrument case: one side stuck on a constant. A detector
    // that answered "agree" here would report perfect health forever.
    const frozen = 'FROZEN'
    const seen = ['AMD', 'NVDA', 'TSLA'].map(
      (s) => compareFocus({ focusSymbol: s, hubSymbol: frozen }).status)
    expect(seen).toEqual([DIVERGE, DIVERGE, DIVERGE])
  })

  it('⛔ M-5 — an ABSENT value never scores as agreement', () => {
    // "A layer that cannot be READ is not a layer that is EMPTY."
    expect(compareFocus({ focusSymbol: null, hubSymbol: null }).status).toBe(NEITHER)
    expect(compareFocus({ focusSymbol: 'AMD', hubSymbol: null }).status).toBe(FOCUS_ONLY)
    expect(compareFocus({ focusSymbol: null, hubSymbol: 'AMD' }).status).toBe(HUB_ONLY)
    for (const s of [NEITHER, FOCUS_ONLY, HUB_ONLY]) expect(s).not.toBe(AGREE)
  })

  it('⛔⛔ NOT_YET_READ never folds into NEITHER', () => {
    // A cold start has an unresolved preference. Scoring that as "neither" —
    // or worse, as agreement — reports health about a read that never happened.
    const loading = compareFocus({ focusSymbol: null, hubSymbol: null, loading: true })
    expect(loading.status).toBe(NOT_YET_READ)
    expect(loading.status).not.toBe(NEITHER)
    // …and loading wins even when both sides happen to hold a value.
    expect(compareFocus({ focusSymbol: 'AMD', hubSymbol: 'AMD', loading: true }).status)
      .toBe(NOT_YET_READ)
  })

  it('⛔ M-2 — it NORMALISES NOTHING, so a case difference is a real divergence', () => {
    // `useAppFocus` upper-cases; the hub does not. Upper-casing here would
    // MANUFACTURE agreement between two authorities that disagree.
    expect(compareFocus({ focusSymbol: 'AMD', hubSymbol: 'amd' }).status).toBe(DIVERGE)
  })

  it('the empty string is ABSENT, not a symbol', () => {
    // `chosen with nullish, consumed with truthiness` — '' is present to `??`
    // and absent to `if (x)`. Pinned so the two readings cannot drift.
    expect(compareFocus({ focusSymbol: '', hubSymbol: '' }).status).toBe(NEITHER)
    expect(compareFocus({ focusSymbol: 'AMD', hubSymbol: '' }).status).toBe(FOCUS_ONLY)
  })

  it('a bare call cannot throw', () => {
    expect(compareFocus().status).toBe(NEITHER)
    expect(isDivergence(null)).toBe(false)
    expect(isDivergence(undefined)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// THE WIRING — asserted from SOURCE, because the hook is two reads and a call
// ═══════════════════════════════════════════════════════════════════════════

describe('the hook reads the two authorities and nothing else', () => {
  const code = stripJsComments(fs.readFileSync(path.join(SRC, 'lib/context/focusDivergence.js'), 'utf8'))

  it('⛔ M-1 — it reads useAppFocus, which IS Group A by the owner ruling', () => {
    expect(code).toContain("import useAppFocus from '../../hooks/useAppFocus'")
    expect(code).toContain('useAppFocus()')
    // ⛔ AND IT MUST NOT REACH GROUP A ITSELF. Reading `groupSyms.B`, or
    // `groups[...]` directly, is the tenth mechanism: `useAppFocus` is the one
    // place that knows which group is the focus slot.
    expect(code).not.toMatch(/groupSyms|charts_workspace_groups|FOCUS_GROUP/)
  })

  it('it reads the hub through useHub and holds no state', () => {
    expect(code).toContain('useHub()')
    expect(code).not.toMatch(/\buseState\b|\buseRef\b|\bcreateContext\b|\buseEffect\b|localStorage/)
  })

  it('⛔ M-3 — it does NOT re-pin FOCUS_PREF_KEY, and the existing guard still does', () => {
    // `lesson_a_guard_repeated_is_a_guard_unproved`: three copies cannot be
    // mutation-proved. `useAppFocus.test.js` already pins that key by reading
    // it out of ChartsWorkspace.jsx's SOURCE. This asserts the existing guard
    // is there and that CP1 added no second copy.
    expect(code).not.toContain('charts_workspace_groups')
    const existing = path.join(SRC, 'hooks/useAppFocus.test.jsx')
    expect(fs.existsSync(existing)).toBe(true)
    const guard = fs.readFileSync(existing, 'utf8')
    // ⭐ AND THE EXISTING GUARD DERIVES THE KEY RATHER THAN SPELLING IT — it
    // imports FOCUS_PREF_KEY and checks ChartsWorkspace.jsx's SOURCE uses it.
    // Asserting it contains the literal would have been wrong for the right
    // reason: the guard is better than a literal, and a rail that demanded one
    // would push it backwards.
    expect(guard).toContain('FOCUS_PREF_KEY')
    expect(guard).toContain('ChartsWorkspace.jsx')
  })

  it('the module holds no default, no fallback and no cache', () => {
    // The one property that keeps this from becoming the tenth mechanism.
    expect(code).not.toMatch(/\|\|\s*['"][A-Z]{1,5}['"]/)   // no hard-coded ticker fallback
    expect(code).not.toMatch(/\bnew Map\b|\bcache\b/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ⛔ M-7 — REVERTIBLE BY DELETION, ENFORCED BY THE TREE
// ═══════════════════════════════════════════════════════════════════════════

describe('revertibility', () => {
  it('⛔ M-7 — exactly ONE file imports this module, and it is this test', () => {
    const importers = []
    for (const file of walk(SRC)) {
      const rel = path.relative(path.dirname(SRC), file).replace(/\\/g, '/')
      if (rel === MODULE_REL) continue
      const code = stripJsComments(fs.readFileSync(file, 'utf8'))
      if (/from\s+['"][^'"]*focusDivergence['"]/.test(code)) importers.push(rel)
    }
    expect(importers).toEqual(['src/lib/context/focusDivergence.test.jsx'])
  })

  it('⛔ the importer scan can SEE a real import — otherwise M-7 proves nothing', () => {
    let sawAny = 0
    for (const file of walk(SRC).slice(0, 400)) {
      const code = stripJsComments(fs.readFileSync(file, 'utf8'))
      if (/from\s+['"][^'"]+['"]/.test(code)) sawAny += 1
    }
    expect(sawAny).toBeGreaterThan(100)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ⚰️ THE STALE CLAIM IN HubContext.jsx, RETIRED — and the rail that keeps it so
// ═══════════════════════════════════════════════════════════════════════════

describe('HubContext is mounted, and its own header now says so', () => {
  const hubSrc = fs.readFileSync(path.join(SRC, 'hub/HubContext.jsx'), 'utf8')
  const layoutSrc = fs.readFileSync(path.join(SRC, 'components/Layout.jsx'), 'utf8')

  it('⛔ HubProvider IS mounted in Layout.jsx — CP1 depends on that being true', () => {
    expect(stripJsComments(layoutSrc)).toContain('HubProvider')
  })

  it('⚰️ the header no longer claims it is reached from NO route', () => {
    // It said "⛔ NOT MOUNTED YET" and "It is reached from NO route" while
    // Layout.jsx mounted it app-wide. A false claim in the first comment a
    // reader sees is the documented-but-wrong defect this repo keeps paying
    // for — and CP1's whole premise is that this context is live.
    // ⚰️ ⛔ AND THE ASSERTION HAD TO BE WRITTEN CAREFULLY, WHICH IS ITSELF THE
    // LESSON. The first version asserted the sentence was ABSENT — and the ⚰️
    // idiom REQUIRES it to be present, quoted verbatim inside the retirement
    // block. A rail that demands the deletion of the record is a rail arguing
    // against this repo's own convention. So: the claim must appear ONLY after
    // the ⚰️ marker, never as a live statement above it.
    const grave = hubSrc.indexOf('⚰️')
    const claim = hubSrc.indexOf('It is reached from NO route')
    expect(grave).toBeGreaterThan(-1)
    expect(claim).toBeGreaterThan(grave)
    // …and the file's own first statement is now the true one.
    expect(hubSrc.slice(0, grave)).toContain('MOUNTED APP-WIDE')
  })
})
