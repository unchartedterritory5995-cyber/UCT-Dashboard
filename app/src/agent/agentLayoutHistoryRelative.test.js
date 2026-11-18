// #1248 AUDIT T2 HOLD (words must cover the target): a restore's RELATIVE, TIME and POINTER words license ONLY the version
// they resolve to against the history the plan was made on — never "any planned version". Generated: phrasings of each
// word class × the planned version (the one the words mean / an older one / a newer one / a tombstone / the current one) ×
// histories of 2–6 versions with mixed dates. The number path ("version 4") and the named-layout rule are unchanged.
// A FIXED fake clock (12:00 ET on a synthetic January day — no DST, so ET day bounds are NOW−12h ± 24h·k); no real dates.
// Evidence: LOCAL (unit) — the state rail over synthetic plans.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { stateEffects, stateRailRefusal, stateRailDecision } from './stateRail'
import { restoreWordsTarget, timeWindowOf } from './versionWords'
import { registerBuiltins } from './builtins'

registerBuiltins()
const NOW = Date.UTC(2030, 0, 15, 17, 0)                       // 12:00 ET
const HOUR = 3_600_000
const sec = (hoursAgo) => Math.floor((NOW - hoursAgo * HOUR) / 1000)
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterAll(() => { vi.useRealTimers() })

const planOf = (restore) => ({ ok: true, plans: [{ kind: 'layoutHistory', ref: 'boardVersions', before: {}, after: {}, patch: { restore } }] })
const LICENSED = null
const REFUSED = /^I didn’t (?:change|restore) anything/

// ── histories: 2–6 versions, mixed dates (hours ago, newest = the current base), some with a tombstone ──
const POOL = [0.1, 0.6, 2, 3.2, 5, 9, 10.5, 14, 20, 23, 30, 34, 40, 49, 52, 60, 63, 74, 80, 100, 130]
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32 } }
function historyOf(n, seed, tomb) {
  const r = lcg(seed)
  const hours = [...POOL].sort(() => r() - 0.5).slice(0, n).sort((a, b) => a - b)   // newest first
  // version n is the newest (current); a tombstone (when asked) sits right under the current one
  return hours.map((h, i) => ({ version: n - i, createdAt: sec(h), hoursAgo: h, tombstone: tomb && i === 1 && n >= 3 }))
}
const HISTORIES = []
for (let n = 2; n <= 6; n++) for (const seed of [1, 7, 23]) for (const tomb of [false, true]) if (!(tomb && n < 3)) HISTORIES.push({ n, seed, tomb, h: historyOf(n, seed * 31 + n, tomb) })
const usableOlder = (h) => h.filter(v => !v.tombstone && v.version < h[0].version)      // newest first
// the planned versions to try: every version in the history (the correct one, older ones, the tombstone, the current one)
const plannedOf = (h) => h.map(v => v.version)
const restoreOf = (h, version, offered = null) => ({ version, sha: `h${version}`, base: h[0].version, baseSha: `h${h[0].version}`, createdAt: h.find(v => v.version === version)?.createdAt ?? null,
  history: h.map(({ version: v, createdAt, tombstone }) => ({ version: v, createdAt, tombstone })), offered })

// ── what the words mean, computed independently of versionWords (ET day k days ago = [NOW−12h−24k, NOW−12h−24(k−1)) ) ──
const inHours = (lo, hi) => (h) => usableOlderOrAll(h).filter(v => v.hoursAgo > lo && v.hoursAgo <= hi).map(v => v.version)
const usableOlderOrAll = (h) => h.filter(v => !v.tombstone && v.version !== h[0].version)
const dayAgo = (k) => inHours(12 + 24 * (k - 1), 12 + 24 * k)

const PREV_WORDS = ['revert to the previous version', 'restore the previous version', 'roll back my board to the last save', 'restore the version before this one',
  'go back to the one before', 'take the board back to the previous version', 'restore my board to the prior version', 'put it back to the previous version',
  'restore the last saved version', 'revert my board to how it was before my last change']
const STEP_WORDS = [['go back 2 saves', 2], ['restore two versions back', 2], ['roll back 3 saves', 3], ['restore one version back', 1]]
const TIME_WORDS = [
  ['restore my board to yesterday', dayAgo(1)], ['go back to how it was yesterday', dayAgo(1)], ['revert to the version from yesterday', dayAgo(1)],
  ['restore the board from this morning', inHours(0, 12)], ['restore how it was 2 days ago', dayAgo(2)], ['revert to three days ago', dayAgo(3)],
  ['restore the board as it was on Jan 13', dayAgo(2)], ['restore my board as it was on 2030-01-12', dayAgo(3)], ['roll back to 1/14', dayAgo(1)],
  ['restore how it was 5 hours ago', inHours(4.5, 5.5)], ['restore how it was an hour ago', inHours(0.5, 1.5)], ['revert to how it was 10 hours ago', inHours(9.5, 10.5)],
]
const AMBIG_WORDS = ['restore an earlier version', 'revert to an older one', 'restore how it was a while ago', 'restore an old version', 'go back to an earlier save',
  'roll back to how it was before', 'restore my board to how it was', 'restore a saved version', 'revert my board to an older save', 'take my board back to an earlier version']
const POINTER_WORDS = ['restore that one', 'restore it', 'restore this one', 'revert to that version']

describe('relative words ("previous", "the one before", "N saves back"): exactly the newest usable version older than the base', () => {
  for (const H of HISTORIES) {
    const older = usableOlder(H.h)
    for (const w of PREV_WORDS) {
      const want = older[0]?.version ?? null
      for (const v of plannedOf(H.h)) {
        const ok = v === want
        it(`${H.n} versions (seed ${H.seed}${H.tomb ? ', tombstone' : ''}) · "${w}" · planned v${v} → ${ok ? 'the card' : 'refused'}`, () => {
          const out = stateRailRefusal(planOf(restoreOf(H.h, v)), { words: w })
          if (ok) expect(out).toBe(LICENSED)
          else { expect(out).toMatch(REFUSED); expect(stateRailDecision(planOf(restoreOf(H.h, v)), { words: w })?.text).toMatch(REFUSED) }
        })
      }
    }
    for (const [w, k] of STEP_WORDS) {
      const want = older[k - 1]?.version ?? null
      for (const v of plannedOf(H.h)) it(`${H.n} versions (seed ${H.seed}${H.tomb ? ', tombstone' : ''}) · "${w}" · planned v${v}`, () => {
        const out = stateRailRefusal(planOf(restoreOf(H.h, v)), { words: w })
        if (v === want) expect(out).toBe(LICENSED)
        else expect(out).toMatch(REFUSED)
      })
    }
  }
  it('a tombstone directly under the current version is skipped: "previous" is the one below it', () => {
    const h = [{ version: 5, createdAt: sec(1) }, { version: 4, createdAt: sec(2), tombstone: true }, { version: 3, createdAt: sec(3) }]
    const r = (v) => ({ version: v, base: 5, history: h })
    expect(stateRailRefusal(planOf(r(3)), { words: 'restore the previous version' })).toBe(LICENSED)
    expect(stateRailRefusal(planOf(r(4)), { words: 'restore the previous version' })).toMatch(REFUSED)
  })
  it('the AUDIT case: board at v5, a plan restoring v1 — "revert to the previous version" / "the version before this one" refused, honestly', () => {
    const h = [5, 4, 3, 2, 1].map((v, i) => ({ version: v, createdAt: sec(i * 7 + 1) }))
    for (const w of ['revert to the previous version', 'restore the version before this one']) {
      const out = stateRailRefusal(planOf({ version: 1, base: 5, history: h }), { words: w })
      expect(out).toMatch(/^I didn’t restore anything: those words mean version 4, not version 1\./)
      expect(stateRailRefusal(planOf({ version: 4, base: 5, history: h }), { words: w })).toBe(LICENSED)
    }
  })
  it('no history on the plan: a relative or time word resolves to nothing (fails closed); the number path still works', () => {
    for (const w of ['restore the previous version', 'restore my board to yesterday', 'restore that one']) expect(stateRailRefusal(planOf({ version: 4, base: 5 }), { words: w })).toMatch(REFUSED)
    expect(stateRailRefusal(planOf({ version: 4, base: 5 }), { words: 'restore version 4' })).toBe(LICENSED)
  })
})

describe('time words ("yesterday", "this morning", "N hours / days ago", "as it was on <date>"): EXACTLY one version saved then, the planned one', () => {
  for (const H of HISTORIES) for (const [w, meant] of TIME_WORDS) {
    const m = meant(H.h)
    for (const v of plannedOf(H.h)) {
      const ok = m.length === 1 && m[0] === v
      it(`${H.n} versions (seed ${H.seed}${H.tomb ? ', tombstone' : ''}) · "${w}" (${m.length} saved then) · planned v${v} → ${ok ? 'the card' : 'refused'}`, () => {
        const out = stateRailRefusal(planOf(restoreOf(H.h, v)), { words: w })
        if (ok) expect(out).toBe(LICENSED)
        else expect(out).toMatch(REFUSED)
      })
    }
  }
  // explicit 0 / 1 / 2 matches in the window
  const base = { version: 9, createdAt: sec(0.2) }
  const cases = [
    ['0 saved yesterday', [base, { version: 8, createdAt: sec(3) }, { version: 7, createdAt: sec(40) }], []],
    ['1 saved yesterday', [base, { version: 8, createdAt: sec(3) }, { version: 7, createdAt: sec(20) }, { version: 6, createdAt: sec(40) }], [7]],
    ['2 saved yesterday', [base, { version: 8, createdAt: sec(14) }, { version: 7, createdAt: sec(30) }, { version: 6, createdAt: sec(40) }], [8, 7]],
    ['1 saved yesterday + a tombstone then', [base, { version: 8, createdAt: sec(14), tombstone: true }, { version: 7, createdAt: sec(30) }], [7]],
  ]
  for (const [name, h, meant] of cases) for (const v of h.map(x => x.version)) {
    const ok = meant.length === 1 && meant[0] === v
    it(`"restore my board to yesterday" · ${name} · planned v${v} → ${ok ? 'the card' : 'refused'}`, () => {
      const out = stateRailRefusal(planOf({ version: v, base: 9, history: h }), { words: 'restore my board to yesterday' })
      if (ok) expect(out).toBe(LICENSED)
      else {
        expect(out).toMatch(REFUSED)
        if (meant.length === 2) expect(out).toMatch(/2 saved versions match those words \(version 8, version 7\)/)
        if (meant.length === 0) expect(out).toMatch(/no single saved version matches those words/)
      }
    })
  }
  it('the windows (fixed clock): yesterday / this morning / N days ago / a date / N hours ago', () => {
    const at = (w) => timeWindowOf(w, NOW).win
    expect(at('yesterday')).toEqual([NOW - 36 * HOUR, NOW - 12 * HOUR])
    expect(at('this morning')).toEqual([NOW - 12 * HOUR, NOW])
    expect(at('2 days ago')).toEqual([NOW - 60 * HOUR, NOW - 36 * HOUR])
    expect(at('as it was on Jan 13')).toEqual([NOW - 60 * HOUR, NOW - 36 * HOUR])
    expect(at('on 2030-01-13')).toEqual([NOW - 60 * HOUR, NOW - 36 * HOUR])
    expect(at('3 hours ago')).toEqual([NOW - 3.5 * HOUR, NOW - 2.5 * HOUR])
    expect(timeWindowOf('the previous version', NOW)).toBe(null)
    expect(timeWindowOf('on 13/45', NOW)).toEqual({ bad: true })
  })
  it('a relative and a time word together must agree', () => {
    const h = [{ version: 5, createdAt: sec(1) }, { version: 4, createdAt: sec(3) }, { version: 3, createdAt: sec(20) }]
    expect(stateRailRefusal(planOf({ version: 4, base: 5, history: h }), { words: 'restore the previous version from yesterday' })).toMatch(REFUSED)
    expect(stateRailRefusal(planOf({ version: 3, base: 5, history: h }), { words: 'restore the previous version from yesterday' })).toMatch(REFUSED)
    expect(stateRailRefusal(planOf({ version: 4, base: 5, history: h }), { words: 'restore the previous version from this morning' })).toBe(LICENSED)
  })
})

describe('words with no single version ("earlier", "an older one", "a while ago", "an old version"): ASKED, never applied', () => {
  for (const H of HISTORIES) for (const w of AMBIG_WORDS) {
    it(`${H.n} versions (seed ${H.seed}${H.tomb ? ', tombstone' : ''}) · "${w}": every planned version refused; the recent versions are the choices`, () => {
      for (const v of plannedOf(H.h)) {
        const plan = planOf(restoreOf(H.h, v))
        expect(stateRailRefusal(plan, { words: w })).toMatch(REFUSED)
        const d = stateRailDecision(plan, { words: w })
        expect(d?.text).toMatch(REFUSED)
        const older = usableOlder(H.h)
        if (older.length) {
          expect(d.text).toMatch(/^I didn’t restore anything: which version do you mean\?/)
          expect(d.ask?.kind).toBe('versions')
          expect(d.ask.versions.map(x => x.version)).toEqual(older.slice(0, 5).map(x => x.version))
        } else expect(d.ask?.kind).not.toBe('versions')
      }
    })
  }
  it('the classifier: each ambiguous phrasing is an ask (never resolved)', () => {
    const e = restoreOf(HISTORIES[10].h, HISTORIES[10].h[1].version)
    for (const w of AMBIG_WORDS) expect(restoreWordsTarget(w, e, NOW).kind, w).toBe('ask')
  })
  it('a version PICKED from those choices is licensed — exactly that version, never another', () => {
    const h = [5, 4, 3].map((v, i) => ({ version: v, createdAt: sec(i * 30 + 1) }))
    expect(stateRailRefusal(planOf({ version: 3, base: 5, history: h }), { words: 'restore an earlier version', picked: new Set(['ver:3']) })).toBe(LICENSED)
    expect(stateRailRefusal(planOf({ version: 4, base: 5, history: h }), { words: 'restore an earlier version', picked: new Set(['ver:3']) })).toMatch(REFUSED)
  })
})

describe('pointers ("it", "that one", "this one"): only the ONE version the Agent last listed / offered in this conversation', () => {
  for (const H of HISTORIES) for (const w of POINTER_WORDS) {
    const older = usableOlder(H.h)
    for (const v of plannedOf(H.h)) {
      const other = older.find(x => x.version !== v)?.version
      // (offered the planned one: licensed only when it is a usable OLDER version — never the current one or a tombstone)
      const offers = [[[], false], [[v], older.some(x => x.version === v)], ...(other != null ? [[[other], false], [[v, other], false]] : [])]
      for (const [offered, ok] of offers) it(`${H.n} versions (seed ${H.seed}${H.tomb ? ', tombstone' : ''}) · "${w}" · planned v${v} · offered [${offered}] → ${ok ? 'the card' : 'refused'}`, () => {
        const out = stateRailRefusal(planOf(restoreOf(H.h, v, offered)), { words: w })
        if (ok) expect(out).toBe(LICENSED)
        else expect(out).toMatch(REFUSED)
      })
    }
  }
  it('several offered: asked with those versions as the choices', () => {
    const h = [5, 4, 3, 2].map((v, i) => ({ version: v, createdAt: sec(i * 30 + 1) }))
    const d = stateRailDecision(planOf({ version: 3, base: 5, history: h, offered: [4, 3] }), { words: 'restore that one' })
    expect(d.ask).toMatchObject({ kind: 'versions' })
    expect(d.ask.versions.map(x => x.version)).toEqual([4, 3])
  })
  it('"put it back" is the board, not a pointer — with "the previous version" it resolves; alone it licenses nothing', () => {
    const h = [5, 4, 3].map((v, i) => ({ version: v, createdAt: sec(i * 30 + 1) }))
    expect(stateRailRefusal(planOf({ version: 4, base: 5, history: h }), { words: 'put it back to the previous version' })).toBe(LICENSED)
    expect(stateRailRefusal(planOf({ version: 3, base: 5, history: h }), { words: 'put it back to the previous version' })).toMatch(REFUSED)
    expect(stateRailRefusal(planOf({ version: 4, base: 5, history: h }), { words: 'put it back' })).toMatch(REFUSED)
  })
})

describe('unchanged: the number path and the effect', () => {
  const h = [5, 4, 3, 2, 1].map((v, i) => ({ version: v, createdAt: sec(i * 10 + 1) }))
  for (const v of [1, 2, 3, 4]) for (const n of [1, 2, 3, 4, 9]) {
    it(`"restore version ${n}" with v${v} planned → ${n === v ? 'the card' : 'refused'}`, () => {
      const out = stateRailRefusal(planOf({ version: v, base: 5, history: h }), { words: `restore version ${n}` })
      if (n === v) expect(out).toBe(LICENSED)
      else expect(out).toMatch(REFUSED)
    })
  }
  it('the effect carries the base, createdAt, the history and what was offered', () => {
    const [e] = stateEffects(planOf({ version: 3, base: 5, createdAt: h[2].createdAt, history: h, offered: [3] }))
    expect(e).toMatchObject({ own: 'restoreVersion', version: 3, base: 5, createdAt: h[2].createdAt, offered: [3] })
    expect(e.history).toHaveLength(5)
  })
})
