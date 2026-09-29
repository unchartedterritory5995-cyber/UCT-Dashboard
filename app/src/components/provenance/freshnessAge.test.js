// app/src/components/provenance/freshnessAge.test.js
//
// ─── THE RAILS FOR TERM-006's RULING, AND THE MUTATION PROOFS ARE THE POINT ───
//
//     A panel must show its age when the value is older than TWICE the cadence
//     it was fetched at — never less than 60 seconds, and never more than one
//     trading session.
//
// Five things are pinned here, and each fails for a DIFFERENT reason:
//
//   1. THE BOUNDARY — just under / exactly / just over 2x cadence, and the
//      15s-cadence panel that must stay quiet at 45s and speak at 61s.
//   2. THE CAP — a daily panel whose 2x cadence is 48 hours badges anyway, and
//      the cap is MEASURED FROM S11 rather than restated: on the eve of a
//      half-day the same call yields 3.5 hours, which no literal in this repo
//      could produce.
//   3. ⛔ THE CONTROL — a FRESH value must NOT badge. Without it the whole thing
//      passes by answering "yes" to everything, which is the failure mode this
//      repo logs most often. A discriminator sits beside every control so
//      "always false" cannot pass either.
//   4. HONEST UNKNOWNS — no timestamp is not a claim of freshness; a missing
//      cadence falls to the TIGHTEST rule, not the loosest.
//   5. THE CONSTANTS EXIST IN EXACTLY ONE PLACE — a comment-stripped walk of
//      every module under `app/src` for a competing declaration or a hard-coded
//      trading-session duration, with FOUR positive controls proving the check
//      can see a real occurrence and FOUR real near-misses proving it is not
//      simply answering "yes".
//
//     cd app && npx vitest run src/components/provenance/freshnessAge.test.js
//
// ⚠️ THIS FILE IS DELIBERATELY EXCLUDED FROM ITS OWN REPO SCAN, along with the
// module it guards. Both legitimately contain the very literals the scan hunts:
// the module DECLARES the two constants, and this file PINS the derived
// session-length numbers so the constants cannot be changed and the test
// "fixed" to match. The exclusion is by absolute path and it is named in the
// assertion message, never a quiet filter.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  AGE_CADENCE_MULTIPLE,
  AGE_FLOOR_MS,
  oneTradingSessionMs,
  ageThresholdMs,
  explainMustShowAge,
  mustShowAge,
} from './freshnessAge'

// ── FIXED INSTANTS ──────────────────────────────────────────────────────────
// 2026 is inside `nyseCalendar.js`'s coverage (market_calendar.json, 2025-2028
// since TERM-035 follow-up #1). Every instant below is
// written in UTC so the test says nothing about the machine's timezone.
//
//   REGULAR  Thu 2026-01-15, EST (UTC-5): RTH 14:30Z -> 21:00Z = 6.5 hours.
//   HALF_EVE Wed 2026-11-25, EST: Thanksgiving (11-26) is a holiday and
//            11-27 is an NYSE early close at 13:00 ET, so the NEXT complete
//            session after this instant is 14:30Z -> 18:00Z = 3.5 hours.
const REGULAR_RTH = new Date('2026-01-15T15:00:00Z') // Thu 10:00 ET, market open
const HALF_DAY_EVE_RTH = new Date('2026-11-25T15:00:00Z') // Wed 10:00 ET
const REGULAR_SESSION_MS = 6.5 * 60 * 60 * 1000
const HALF_SESSION_MS = 3.5 * 60 * 60 * 1000

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const CADENCE_15S = 15 * 1000
const CADENCE_5MIN = 5 * MINUTE
const CADENCE_DAILY = 24 * HOUR

/** A value captured `ageMs` before `now`. */
const asOfAged = (ageMs, now = REGULAR_RTH) => new Date(now.getTime() - ageMs)

// ─── 0. "ONE TRADING SESSION" IS MEASURED FROM S11, NEVER RESTATED ──────────

describe('oneTradingSessionMs derives the cap from marketClock', () => {
  it('a regular day is 6.5 hours', () => {
    expect(oneTradingSessionMs(REGULAR_RTH)).toBe(REGULAR_SESSION_MS)
  })

  it('⭐ the eve of an NYSE early close is 3.5 hours — a number no literal here could produce', () => {
    // This is the whole argument for deriving rather than declaring: the module
    // contains no session duration at all, knows nothing about half-days, and
    // still tightens the cap on exactly the days NYSE shortens.
    expect(oneTradingSessionMs(HALF_DAY_EVE_RTH)).toBe(HALF_SESSION_MS)
  })

  it('the two answers differ, so the derivation is not returning one constant', () => {
    expect(oneTradingSessionMs(REGULAR_RTH)).not.toBe(oneTradingSessionMs(HALF_DAY_EVE_RTH))
  })

  it('accepts an epoch-ms instant as well as a Date (one reading of a timestamp)', () => {
    expect(oneTradingSessionMs(REGULAR_RTH.getTime())).toBe(REGULAR_SESSION_MS)
  })
})

// ─── 1. THE BOUNDARY — EXACTLY 2x CADENCE, JUST UNDER, JUST OVER ────────────

describe('the 2x-cadence boundary', () => {
  const cadenceMs = CADENCE_5MIN // 2x = 10 min, clear of both the floor and the cap
  const threshold = AGE_CADENCE_MULTIPLE * cadenceMs

  it('the threshold IS twice the cadence, and `bound` says so', () => {
    const t = ageThresholdMs({ cadenceMs, now: REGULAR_RTH })
    expect(t.thresholdMs).toBe(threshold)
    expect(t.bound).toBe('cadence')
  })

  it('just under 2x cadence does NOT badge', () => {
    expect(mustShowAge({ asOf: asOfAged(threshold - 1), cadenceMs, now: REGULAR_RTH })).toBe(false)
  })

  it('EXACTLY 2x cadence does NOT badge — "older than" is strictly greater', () => {
    expect(mustShowAge({ asOf: asOfAged(threshold), cadenceMs, now: REGULAR_RTH })).toBe(false)
  })

  it('just over 2x cadence DOES badge', () => {
    expect(mustShowAge({ asOf: asOfAged(threshold + 1), cadenceMs, now: REGULAR_RTH })).toBe(true)
  })
})

// ─── 2. THE 60-SECOND FLOOR ─────────────────────────────────────────────────

describe('the 60-second floor keeps a fast panel quiet through ordinary jitter', () => {
  it('a 15s-cadence panel is governed by the FLOOR, not by 2x cadence', () => {
    const t = ageThresholdMs({ cadenceMs: CADENCE_15S, now: REGULAR_RTH })
    expect(t.thresholdMs).toBe(AGE_FLOOR_MS)
    expect(t.bound).toBe('floor')
    // The statement the floor exists to make: without it this panel's threshold
    // would be 30s, so the 45s case below would badge on one slow round trip.
    expect(AGE_CADENCE_MULTIPLE * CADENCE_15S).toBeLessThan(45 * 1000)
  })

  it('a 15s-cadence panel does NOT badge at 45s', () => {
    expect(mustShowAge({ asOf: asOfAged(45 * 1000), cadenceMs: CADENCE_15S, now: REGULAR_RTH })).toBe(false)
  })

  it('it does not badge at exactly 60s either', () => {
    expect(mustShowAge({ asOf: asOfAged(AGE_FLOOR_MS), cadenceMs: CADENCE_15S, now: REGULAR_RTH })).toBe(false)
  })

  it('it DOES badge at 61s', () => {
    expect(mustShowAge({ asOf: asOfAged(61 * 1000), cadenceMs: CADENCE_15S, now: REGULAR_RTH })).toBe(true)
  })

  it('the floor is 60 seconds, pinned as a number so it cannot drift silently', () => {
    expect(AGE_FLOOR_MS).toBe(60_000)
    expect(AGE_CADENCE_MULTIPLE).toBe(2)
  })
})

// ─── 3. THE ONE-TRADING-SESSION CAP ─────────────────────────────────────────

describe('the cap: nothing daily-or-slower escapes labelling', () => {
  it('a daily panel is governed by the CAP, not by its 48-hour 2x cadence', () => {
    const t = ageThresholdMs({ cadenceMs: CADENCE_DAILY, now: REGULAR_RTH })
    expect(AGE_CADENCE_MULTIPLE * CADENCE_DAILY).toBe(48 * HOUR) // what the cadence rule alone would give
    expect(t.thresholdMs).toBe(REGULAR_SESSION_MS)
    expect(t.bound).toBe('session_cap')
    expect(t.capMs).toBe(REGULAR_SESSION_MS)
  })

  it('a daily value 7 hours old badges, regardless of cadence', () => {
    expect(mustShowAge({ asOf: asOfAged(7 * HOUR), cadenceMs: CADENCE_DAILY, now: REGULAR_RTH })).toBe(true)
  })

  it('a daily value 6 hours old does not — the cap is a real session, not "anything old"', () => {
    expect(mustShowAge({ asOf: asOfAged(6 * HOUR), cadenceMs: CADENCE_DAILY, now: REGULAR_RTH })).toBe(false)
  })

  it('⭐ a breadth row from Tuesday says so on Thursday', () => {
    const tuesdayClose = new Date('2026-01-13T21:00:00Z') // Tue 16:00 ET
    const thursdayMorning = new Date('2026-01-15T14:00:00Z') // Thu 09:00 ET, pre-market
    const verdict = explainMustShowAge({
      asOf: tuesdayClose, cadenceMs: CADENCE_DAILY, now: thursdayMorning,
    })
    expect(verdict.mustShow).toBe(true)
    expect(verdict.bound).toBe('session_cap')
    expect(verdict.ageMs).toBeGreaterThan(REGULAR_SESSION_MS)
  })

  it('the cap TRACKS the calendar: the same 4-hour-old daily value badges on a half-day eve and not on a regular day', () => {
    const args = { cadenceMs: CADENCE_DAILY }
    expect(mustShowAge({ ...args, asOf: asOfAged(4 * HOUR, REGULAR_RTH), now: REGULAR_RTH })).toBe(false)
    expect(mustShowAge({
      ...args, asOf: asOfAged(4 * HOUR, HALF_DAY_EVE_RTH), now: HALF_DAY_EVE_RTH,
    })).toBe(true)
  })

  it('an hourly panel sits between the two rules — capped by neither floor nor session', () => {
    const t = ageThresholdMs({ cadenceMs: HOUR, now: REGULAR_RTH })
    expect(t.thresholdMs).toBe(2 * HOUR)
    expect(t.bound).toBe('cadence')
  })
})

// ─── 4. ⛔ THE CONTROL — A FRESH VALUE DOES NOT BADGE ───────────────────────

describe('⛔ CONTROL: a fresh value must NOT badge', () => {
  const cases = [
    ['a 15s panel 5 seconds old', CADENCE_15S, 5 * 1000],
    ['a 5-minute panel 30 seconds old', CADENCE_5MIN, 30 * 1000],
    ['a daily panel 10 minutes old', CADENCE_DAILY, 10 * MINUTE],
    ['a value captured this instant', CADENCE_5MIN, 0],
  ]

  for (const [name, cadenceMs, ageMs] of cases) {
    it(`${name} is not badged`, () => {
      const v = explainMustShowAge({ asOf: asOfAged(ageMs), cadenceMs, now: REGULAR_RTH })
      expect(v.mustShow).toBe(false)
      expect(v.reason).toBe('within_threshold')
    })
  }

  it('⛔ DISCRIMINATOR: each of those same panels DOES badge once past its own threshold, so "always false" cannot pass', () => {
    for (const [, cadenceMs] of cases) {
      const t = ageThresholdMs({ cadenceMs, now: REGULAR_RTH }).thresholdMs
      expect(mustShowAge({ asOf: asOfAged(t + 1000), cadenceMs, now: REGULAR_RTH })).toBe(true)
    }
  })

  it('a future-dated value is not stale — clock skew is not evidence', () => {
    const v = explainMustShowAge({
      asOf: new Date(REGULAR_RTH.getTime() + HOUR), cadenceMs: CADENCE_5MIN, now: REGULAR_RTH,
    })
    expect(v.mustShow).toBe(false)
    expect(v.ageMs).toBeLessThan(0)
  })
})

// ─── 5. HONEST UNKNOWNS ─────────────────────────────────────────────────────

describe('a missing timestamp is not a claim of freshness', () => {
  for (const [name, asOf] of [['null', null], ['undefined', undefined], ['unparseable', 'not a date']]) {
    it(`${name} answers false with reason no_timestamp, never a fabricated verdict`, () => {
      const v = explainMustShowAge({ asOf, cadenceMs: CADENCE_5MIN, now: REGULAR_RTH })
      expect(v.mustShow).toBe(false)
      expect(v.reason).toBe('no_timestamp')
      expect(v.ageMs).toBeNull()
    })
  }

  it('a FreshnessClass string handed in as a timestamp cannot become a verdict', () => {
    // The same collision `sessionStale.test.js` pins: D1's `freshnessClass`
    // ("stale") is not a timestamp, and confusing the two must not produce a
    // confident answer in either direction.
    const v = explainMustShowAge({ asOf: 'stale', cadenceMs: CADENCE_5MIN, now: REGULAR_RTH })
    expect(v.mustShow).toBe(false)
    expect(v.reason).toBe('no_timestamp')
  })
})

describe('an unusable cadence falls to the TIGHTEST rule, never the loosest', () => {
  for (const [name, cadenceMs] of [
    ['missing', null], ['undefined', undefined], ['zero', 0],
    ['negative', -5000], ['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY],
  ]) {
    it(`${name} cadence yields the 60s floor, and says cadenceMs is null`, () => {
      const t = ageThresholdMs({ cadenceMs, now: REGULAR_RTH })
      expect(t.thresholdMs).toBe(AGE_FLOOR_MS)
      expect(t.bound).toBe('floor')
      expect(t.cadenceMs).toBeNull()
    })
  }

  it('so an undeclared-cadence value older than a minute badges', () => {
    expect(mustShowAge({ asOf: asOfAged(90 * 1000), now: REGULAR_RTH })).toBe(true)
    expect(mustShowAge({ asOf: asOfAged(30 * 1000), now: REGULAR_RTH })).toBe(false)
  })
})

describe('the timestamp shapes D1 actually emits all read the same', () => {
  const ageMs = 11 * MINUTE // past a 5-minute panel's 10-minute threshold
  const instant = asOfAged(ageMs)
  const shapes = {
    Date: instant,
    'ISO string': instant.toISOString(),
    'epoch seconds': instant.getTime() / 1000,
    'epoch milliseconds': instant.getTime(),
  }
  for (const [name, asOf] of Object.entries(shapes)) {
    it(`${name}`, () => {
      const v = explainMustShowAge({ asOf, cadenceMs: CADENCE_5MIN, now: REGULAR_RTH })
      expect(v.mustShow).toBe(true)
      expect(v.ageMs).toBe(ageMs)
    })
  }
})

describe('mustShowAge is DERIVED from explainMustShowAge, never a second answer', () => {
  it('the two agree on every case in this file', () => {
    const table = [
      { asOf: asOfAged(0), cadenceMs: CADENCE_15S },
      { asOf: asOfAged(45 * 1000), cadenceMs: CADENCE_15S },
      { asOf: asOfAged(61 * 1000), cadenceMs: CADENCE_15S },
      { asOf: asOfAged(10 * MINUTE), cadenceMs: CADENCE_5MIN },
      { asOf: asOfAged(10 * MINUTE + 1), cadenceMs: CADENCE_5MIN },
      { asOf: asOfAged(7 * HOUR), cadenceMs: CADENCE_DAILY },
      { asOf: null, cadenceMs: CADENCE_DAILY },
      { asOf: asOfAged(90 * 1000) },
    ]
    // Non-vacuity: the table must contain both answers, or "they agree" is free.
    const answers = table.map((c) => mustShowAge({ ...c, now: REGULAR_RTH }))
    expect(answers).toContain(true)
    expect(answers).toContain(false)
    for (const c of table) {
      const args = { ...c, now: REGULAR_RTH }
      expect(mustShowAge(args)).toBe(explainMustShowAge(args).mustShow)
    }
  })

  it('every result is frozen, so a consumer cannot mutate the derivation it was handed', () => {
    const v = explainMustShowAge({ asOf: asOfAged(0), cadenceMs: CADENCE_5MIN, now: REGULAR_RTH })
    expect(Object.isFrozen(v)).toBe(true)
  })
})

// ─── 6. THE CONSTANTS EXIST IN EXACTLY ONE PLACE ────────────────────────────

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'api'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`freshnessAge.test: could not find the repo root from ${process.cwd()}`)
})()

const SRC = path.join(ROOT, 'app', 'src')
const SELF = fileURLToPath(import.meta.url)
const OWNER = path.join(SRC, 'components', 'provenance', 'freshnessAge.js')

/** ⚠️ CRLF normalised at the door — `core.autocrlf` is on in this checkout. */
const read = (abs) => fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
const key = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')

/**
 * Remove `//` and block comments WITHOUT eating a string that happens to
 * contain `//`. A naive stripper cuts `'https://…'` in half and then reads the
 * rest of the file as a comment, which would make this whole rail pass by
 * seeing nothing — the empty-result failure this repo logs as its own rule.
 */
function stripComments(src) {
  let out = ''
  let i = 0
  let quote = null
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (quote) {
      if (c === '\\') { out += '  '; i += 2; continue }
      if (c === quote) quote = null
      out += c
      i += 1
      continue
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; out += c; i += 1; continue }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && n === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n'
        i += 1
      }
      i += 2
      continue
    }
    out += c
    i += 1
  }
  return out
}

// ⛔ SEGMENT MATCHING, NOT SUBSTRING MATCHING. `COVERAGE` contains "AGE" and
// `IMAGE` contains "AGE", and this repo really declares `DURATION_COVERAGE_MIN`
// and `INLINE_IMAGE_MAX_BYTES`. A substring test flags both, the rail goes red
// on arrival, and a red that fires on the right answer is muted within a week.
const AGE_SEGMENTS = new Set(['AGE', 'AGES', 'STALE', 'STALENESS', 'FRESH', 'FRESHNESS'])
// ⛔ `MAX` is deliberately ABSENT. `ROW_TIME_MAX_AGE_MS`, `DAILY_MAX_AGE_MS` and
// `LAST_NOTE_MAX_AGE_MS` are real cache-eviction limits in this repo and are not
// second authorities over the age-disclosure decision. The three words below are
// the ruling's OWN vocabulary.
const BOUND_SEGMENTS = new Set(['FLOOR', 'CAP', 'MULTIPLE'])
const OWNED_CONSTANTS = ['AGE_CADENCE_MULTIPLE', 'AGE_FLOOR_MS']

const SIXTY_SECONDS = /^\s*(60_?000|60\s*\*\s*1_?000|1_?000\s*\*\s*60)\s*$/
const SESSION_DURATION = /\b23_?400_?000\b|\b12_?600_?000\b|6\.5\s*\*\s*60\s*\*\s*60\s*\*\s*1_?000|6\.5\s*\*\s*3_?600_?000|\b390\s*\*\s*60_?000\b|\b390\s*\*\s*60\s*\*\s*1_?000\b/
const DECLARATION = /(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=\s*([^;\n]*)/g

/** Every way a second authority over this ruling's three numbers could appear. */
function findCompetingAgeAuthority(source) {
  const code = stripComments(source)
  const hits = []
  for (const m of code.matchAll(DECLARATION)) {
    const name = m[1]
    const value = m[2]
    const segments = name.split('_')
    const namesAge = segments.some((s) => AGE_SEGMENTS.has(s))
    if (OWNED_CONSTANTS.includes(name)) {
      hits.push(`re-declares the ruling's own constant ${name}`)
    } else if (namesAge && segments.some((s) => BOUND_SEGMENTS.has(s))) {
      hits.push(`declares a rival age bound ${name}`)
    } else if (namesAge && SIXTY_SECONDS.test(value)) {
      hits.push(`declares a rival 60-second age floor ${name} = ${value.trim()}`)
    }
  }
  const duration = code.match(SESSION_DURATION)
  if (duration) hits.push(`hard-codes a trading-session duration: ${duration[0]}`)
  return hits
}

function walkJs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) walkJs(abs, out)
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(abs)
  }
  return out
}

describe('the threshold constants live in exactly one place', () => {
  const files = walkJs(SRC)

  // The two whole-tree checks below walk every file under app/src: ~14 s alone, so
  // the default 15 s ceiling timed them out whenever the box was busy (2026-09-29,
  // 77/77 alone each time). A timeout says nothing about the code.
  const WHOLE_TREE_TIMEOUT_MS = 60_000

  it('NON-VACUITY: the walk actually read the tree', () => {
    expect(files.length).toBeGreaterThan(300)
    const keys = files.map(key)
    expect(keys).toContain('app/src/components/provenance/sessionStale.js')
    expect(keys).toContain('app/src/utils/marketSession.js')
    expect(keys).toContain('app/src/components/provenance/freshnessAge.js')
  })

  it('⛔ CONTROL: the check SEES the real declarations in the real owning module', () => {
    // The brief's requirement, and the only thing that separates this rail from
    // a check that cannot fail: run it against the file that legitimately holds
    // the constants and prove both are found.
    const hits = findCompetingAgeAuthority(read(OWNER))
    expect(hits.join(' | ')).toMatch(/AGE_FLOOR_MS/)
    expect(hits.join(' | ')).toMatch(/AGE_CADENCE_MULTIPLE/)
  })

  it('no other module under app/src declares a competing constant or a session duration', () => {
    const offenders = []
    for (const abs of files) {
      if (abs === OWNER || abs === SELF) continue // excluded by path, and why is in this file's header
      const hits = findCompetingAgeAuthority(read(abs))
      if (hits.length) offenders.push(`${key(abs)}: ${hits.join('; ')}`)
    }
    expect(offenders, `a second authority over TERM-006's numbers:\n${offenders.join('\n')}`).toEqual([])
  }, WHOLE_TREE_TIMEOUT_MS)

  it('each constant is EXPORT-declared in exactly one file', () => {
    for (const name of OWNED_CONSTANTS) {
      const declaring = files.filter((abs) => {
        if (abs === SELF) return false
        return new RegExp(`export\\s+const\\s+${name}\\s*=`).test(stripComments(read(abs)))
      })
      expect(declaring.map(key), `${name} is declared in ${declaring.length} files`)
        .toEqual(['app/src/components/provenance/freshnessAge.js'])
    }
  }, WHOLE_TREE_TIMEOUT_MS)

  it('the owning module hard-codes NO session duration — the cap is derived', () => {
    expect(stripComments(read(OWNER))).not.toMatch(SESSION_DURATION)
  })
})

describe('the competing-authority check can actually fail', () => {
  const positives = [
    ['a verbatim copy of the floor', 'export const AGE_FLOOR_MS = 60_000\n'],
    ['a verbatim copy of the multiple', 'const AGE_CADENCE_MULTIPLE = 2\n'],
    ['a differently-named floor', 'const STALE_FLOOR_MS = 60_000\n'],
    ['a differently-named cap', 'export const FRESHNESS_CAP_MS = 6 * 3600 * 1000\n'],
    ['an age constant set to 60 seconds', 'const PANEL_AGE_LIMIT_MS = 60 * 1000\n'],
    ['a hard-coded trading session', 'const SESSION_LENGTH = 23_400_000\n'],
  ]
  for (const [name, source] of positives) {
    it(`FLAGS ${name}`, () => {
      expect(findCompetingAgeAuthority(source).length).toBeGreaterThan(0)
    })
  }

  // ⛔ The discriminator half. Every line below is real, lifted from this repo,
  // and every one of them would be flagged by an obvious-looking version of
  // this check.
  const negatives = [
    ['COVERAGE contains "AGE"', 'export const DURATION_COVERAGE_MIN = 0.7\n'],
    ['IMAGE contains "AGE"', 'export const INLINE_IMAGE_MAX_BYTES = 5 * 1024 * 1024\n'],
    ['REFRESH contains "FRESH"', 'const REFRESH_MS = 60000\n'],
    ['a cache-eviction age limit is not this decision', 'export const ROW_TIME_MAX_AGE_MS = 24 * 60 * 60 * 1000\n'],
    ['a 60s poll interval is not a staleness floor', "const { data } = useSWR(url, f, { refreshInterval: 60_000 })\n"],
    ['an unrelated 60s constant', 'const COOLDOWN_MS = 60_000\n'],
  ]
  for (const [name, source] of negatives) {
    it(`does NOT flag ${name}`, () => {
      expect(findCompetingAgeAuthority(source)).toEqual([])
    })
  }
})

describe('comments are stripped before matching, and strings are not', () => {
  it('a competing declaration that exists only in a line comment is not a violation', () => {
    expect(findCompetingAgeAuthority('// const STALE_FLOOR_MS = 60_000\n')).toEqual([])
  })

  it('...nor one that exists only in a block comment', () => {
    expect(findCompetingAgeAuthority('/* const STALE_CAP_MS = 23_400_000 */\n')).toEqual([])
  })

  it('but the SAME text in code is a violation — so stripping cannot hide a real one', () => {
    expect(findCompetingAgeAuthority('const STALE_FLOOR_MS = 60_000\n').length).toBeGreaterThan(0)
    expect(findCompetingAgeAuthority('const STALE_CAP_MS = 23_400_000\n').length).toBeGreaterThan(0)
  })

  it('a URL in a string does not blind the stripper to the rest of the file', () => {
    const src = "const U = 'https://example.com/a/b'\nconst STALE_FLOOR_MS = 60_000\n"
    expect(findCompetingAgeAuthority(src).length).toBeGreaterThan(0)
  })

  it('a `//` inside a string survives stripping intact', () => {
    expect(stripComments("const U = 'https://x/y'\n")).toContain('https://x/y')
  })
})

// ─── 7. ITS CONSUMERS — BY NAME, STATED AS A RAIL, NOT AS A SENTENCE ─────────
//
// ⚰️ This section was "NO CONSUMER YET" and asserted the importer list was
// EMPTY, with the instruction that TERM-059's first panel would turn it red and
// that the red was the signal to name the adopters here. TERM-059 (2026-09-29)
// is that red: the Breadth Monitor's NAAIM column asks this authority whether
// its weekly survey must show its as-of, through `pages/breadth/naaimAge.js`.
//
// ⚠️ A NEW IMPORTER STILL TURNS THIS RED, ON PURPOSE. Adoption of the age ruling
// is a decision per panel (the census measures hundreds of non-adopters), so a
// panel that starts asking is named here in the commit that wires it.

describe('the age authority has named consumers, and only those', () => {
  it('its importers outside this module and its test are exactly the adopting panels', () => {
    const importers = walkJs(SRC)
      .filter((abs) => abs !== OWNER && abs !== SELF)
      .filter((abs) => /from\s+['"][^'"]*freshnessAge['"]/.test(stripComments(read(abs))))
      .map(key)
    expect(importers, 'a panel adopted (or dropped) the age ruling; name it here by path')
      .toEqual(['app/src/pages/breadth/naaimAge.js'])
  })

  it('and the adopter is itself rendered by a page, not a helper nobody calls', () => {
    // An importer that no member-facing surface reaches would be the "built,
    // tested, green and unreachable" shape the empty assertion above used to
    // guard against. The Monitor imports the helper and hands it to the cell.
    const breadth = stripComments(read(path.join(SRC, 'pages', 'Breadth.jsx')))
    expect(breadth).toMatch(/from\s+['"]\.\/breadth\/naaimAge['"]/)
    expect(breadth).toMatch(/age:\s*naaimAge/)
  })
})

// ─── 8. RM-N03 — CARD 33 §2 IS THE RULING; THIS MODULE IS ITS READER ────────
//
// ⛔⛔ THE DEFECT THIS SECTION EXISTS FOR. "What is the maximum age a panel may
// display without saying so" was decided TWICE on 2026-09-26, eight hours apart
// — `fac059c23` 13:01:42 (CARD 33 §2) and `eb6eb247d` 21:46:40 (the module
// under test) — and for a day NOTHING reconciled them: a search for "CARD 33"
// over the module and over this file returned zero. Both shipped; both are
// ancestors of `origin/production`.
//
// ⭐ THEY DO NOT DISAGREE, and the test that settles it is worth more than the
// verdict: ASK WHETHER ANY ONE RENDERING SATISFIES BOTH. The card sets a
// CEILING on silence ("One session is a ceiling") and mandates silence nowhere;
// this module is tighter inside that permission. So on a 15s-cadence panel 90
// seconds old — the case that looks like divergence — the card requires nothing
// and the module requires the age, and SHOWING THE AGE satisfies both. Same for
// the card's slower-than-daily carve-out: "weekly · as of Fri" satisfies the
// carve-out (it states its cadence) AND this module's cap. Two rules genuinely
// disagree only when no rendering satisfies both, and there is no such case
// here. The fix was therefore a citation and this rail — NO behaviour changed,
// and `AGE_CADENCE_MULTIPLE` / `AGE_FLOOR_MS` / the derived ceiling are
// untouched shipped values.
//
// ⚠️ A CITATION ROTS EXACTLY LIKE THE CELL IT REPLACES, which is why this is a
// rail and not a comment. It goes red on THREE independent edits:
//   (1) the citation in `freshnessAge.js` is broken or removed;
//   (2) the module's ceiling derivation changes, or any cadence's threshold is
//       let past the derived session;
//   (3) CARD 33 §2's ceiling sentence is edited out of the decision card.
// Mutation-proved on (1) and (2) rather than asserted: breaking the cited path
// reds 2 of 77 by name, and removing the ceiling from the clamp reds 7 of 77
// (three of them below, four in §3).
//
// ⚠️ HONEST CONSTRAINT, STATED SO A FUTURE READER CANNOT ASSUME THE OPPOSITE:
// everything below is about the card's TEXT and this authority's ARITHMETIC.
// ⚰️ It used to add "THIS GUARDS A RULE NOBODY RENDERS" — the module landed
// unconsumed and `reachable.test.js` parked it by name until TERM-059. Since
// 2026-09-29 one panel renders it (§7 names it: the Breadth Monitor's NAAIM
// column); the member-visible half is railed in `pages/breadth/naaimAge.test.jsx`
// by RENDERED TEXT, not here.
//
// ⛔ ONE DELIBERATE ASYMMETRY IN HOW SOURCE IS READ HERE. The CITATION is
// matched in the module's COMMENTS — a pointer to a ruling is exactly what a
// comment is for. Every check over a LITERAL still strips comments first, and
// §6 owns all of those; this section adds no second copy of them, because a
// checker that matches its own prose is a failure this repo has recorded six
// times.

const CARD_33_REL = 'docs/terminal-research/12-decisions/DECISION_CARDS_2026-09-26.md'
const CARD_33_PATH = path.join(ROOT, ...CARD_33_REL.split('/'))
const CARD_33_HEADING = '## CARD 33'
const CARD_33_SECTION_2 = '### 2. MAX AGE A PANEL MAY DISPLAY SILENTLY'

/**
 * CARD 33 §2, sliced out of the REAL decision-card file by its own headings.
 *
 * ⛔ Every step THROWS rather than returning an empty string. An empty slice
 * satisfies every check written over it, which is this repo's "an empty result
 * is a failed invocation until proven otherwise" rule — and the reason a missing
 * card must be a red, never a quiet pass.
 */
function card33Section2() {
  if (!fs.existsSync(CARD_33_PATH)) {
    throw new Error(`RM-N03: the decision card named by freshnessAge.js is gone from ${CARD_33_REL}`)
  }
  const src = read(CARD_33_PATH)
  const card = src.indexOf(CARD_33_HEADING)
  if (card < 0) throw new Error(`RM-N03: "${CARD_33_HEADING}" not found in ${CARD_33_REL}`)
  const start = src.indexOf(CARD_33_SECTION_2, card)
  if (start < 0) throw new Error(`RM-N03: "${CARD_33_SECTION_2}" not found under CARD 33 in ${CARD_33_REL}`)
  const end = src.indexOf('\n### ', start + 1)
  if (end < 0) throw new Error('RM-N03: CARD 33 §2 has no following section — the slice would run to end of file')
  return src.slice(start, end)
}

// The card's own words for the ceiling, each NAMED so a red says which sentence
// moved rather than "the card changed".
const CEILING_CLAIMS = [
  ['the ceiling is one expected session', /one expected session/],
  ['it is a CEILING, not a mandate to stay silent', /One session is a ceiling/],
  ['the obligation past it is ON THE SURFACE', /anything older must state its as-of/],
  ['silence inside it is PERMITTED, never required', /may render data from the CURRENT expected session with no annotation/],
]

/** Which of CARD 33 §2's ceiling claims are MISSING from `section`. */
function missingCeilingClaims(section) {
  return CEILING_CLAIMS.filter(([, re]) => !re.test(section)).map(([name]) => name)
}

// Each element of the citation, so a red names the half that rotted.
const CITATION_PARTS = [
  ['the card file, by path', CARD_33_REL],
  ['the card, by number', 'CARD 33'],
  ['the section, by number', '§2'],
]

/** Which parts of the citation are MISSING from `moduleSource`. */
function missingCitationParts(moduleSource) {
  return CITATION_PARTS.filter(([, needle]) => !moduleSource.includes(needle)).map(([name]) => name)
}

describe('RM-N03: the module CITES CARD 33 §2 rather than restating it', () => {
  it('NON-VACUITY: the decision card was read and §2 was actually sliced out', () => {
    const section = card33Section2()
    expect(section.startsWith(CARD_33_SECTION_2)).toBe(true)
    expect(section.length).toBeGreaterThan(400)
    expect(section).toContain('NG-17') // the card's own reason the ceiling has a number at all
  })

  it('⛔ CONTROL: the claim matcher SEES all four of the card\'s ceiling claims in the real section', () => {
    expect(missingCeilingClaims(card33Section2())).toEqual([])
  })

  it('⛔ CONTROL: ...and REPORTS the one that is absent — so an absence is evidence', () => {
    const gutted = card33Section2().replace('One session is a ceiling', 'One session is a suggestion')
    expect(missingCeilingClaims(gutted)).toEqual(['it is a CEILING, not a mandate to stay silent'])
  })

  it('⛔ CONTROL: an empty section reports ALL FOUR missing, so nothing passes vacuously', () => {
    expect(missingCeilingClaims('')).toHaveLength(CEILING_CLAIMS.length)
  })

  it('⛔ CONTROL: the citation check SEES the real citation in the real module', () => {
    expect(missingCitationParts(read(OWNER))).toEqual([])
  })

  it('⛔ CONTROL: ...and names the part that is gone when the citation rots', () => {
    const broken = read(OWNER).split(CARD_33_REL).join('docs/terminal-research/somewhere-else.md')
    expect(missingCitationParts(broken)).toEqual(['the card file, by path'])
  })

  it('the module cites the card, and the cited path resolves to a file that exists', () => {
    expect(missingCitationParts(read(OWNER))).toEqual([])
    expect(fs.existsSync(CARD_33_PATH)).toBe(true)
  })
})

describe('RM-N03: the ceiling the card NAMES is the ceiling this module CLAMPS to', () => {
  // ⛔ BOTH SIDES DERIVED. No session duration is written in this section: §6
  // already reds if one appears in the module, and writing one here would make
  // this rail the third authority over the very number it exists to protect.
  //
  // ⚠️⚠️ SO THIS SECTION PINS THE CEILING'S *SHAPE* AND §0/§3 PIN ITS *VALUE*.
  // Both halves are required and NEITHER COVERS THE OTHER. Measured, not
  // assumed: scaling `oneTradingSessionMs`'s derivation by 2 reds SIX tests in
  // §0 and §3 and NOT ONE of the tests below — because every assertion here
  // compares the module against `oneTradingSessionMs`, so a scaled derivation
  // moves both sides together
  // (`lesson_an_identity_join_is_not_a_correctness_check`).
  // ⛔ Do NOT delete §0 or §3 on the grounds that this section guards the cap.
  for (const [label, now] of [
    ['a regular day', REGULAR_RTH],
    ['the eve of an NYSE early close', HALF_DAY_EVE_RTH],
  ]) {
    it(`${label}: a daily-cadence panel is bounded by the DERIVED session, and \`bound\` says so`, () => {
      const cap = oneTradingSessionMs(now)
      expect(cap).toBeGreaterThan(0)
      const t = ageThresholdMs({ cadenceMs: CADENCE_DAILY, now })
      expect(t.capMs).toBe(cap)
      expect(t.thresholdMs).toBe(cap)
      expect(t.bound).toBe('session_cap')
    })
  }

  it('the two instants yield DIFFERENT ceilings, so this is not one constant wearing a derivation', () => {
    expect(oneTradingSessionMs(REGULAR_RTH)).not.toBe(oneTradingSessionMs(HALF_DAY_EVE_RTH))
  })

  it('⛔ NO CADENCE ESCAPES THE CEILING — the card\'s word "ceiling", as an invariant', () => {
    // ⚠️ `weekly` and `quarterly` are the card's own carve-out examples (weekly
    // COT, quarterly fundamentals), which it says "state their own cadence
    // instead". This module is TIGHTER there, deliberately — "nothing
    // daily-or-slower escapes labelling entirely" — and a rendering that states
    // the cadence AND the as-of satisfies both, which is why the carve-out is a
    // tension in strictness and not a competing answer. Recorded here so the
    // next reader does not rediscover it as a defect.
    const cap = oneTradingSessionMs(REGULAR_RTH)
    const cadences = [
      ['15s', CADENCE_15S],
      ['5min', CADENCE_5MIN],
      ['hourly', HOUR],
      ['daily', CADENCE_DAILY],
      ['weekly (the card\'s carve-out)', 7 * CADENCE_DAILY],
      ['quarterly (the card\'s carve-out)', 90 * CADENCE_DAILY],
      ['undeclared', null],
    ]
    for (const [name, cadenceMs] of cadences) {
      const t = ageThresholdMs({ cadenceMs, now: REGULAR_RTH })
      expect(t.thresholdMs, `${name} is allowed past CARD 33 §2's ceiling`).toBeLessThanOrEqual(cap)
    }
  })

  it('⭐ the ONE branch that could be more permissive than the card is not reachable through S11', () => {
    // `ageThresholdMs` is wider than the ruling in exactly one case — `capMs:
    // null`, when S11's walk finds no complete open->close pair — and the module
    // surfaces that rather than hiding it behind a literal. MEASURED here rather
    // than argued: `marketClock._dayBoundaries` DEGRADES to weekday boundaries
    // for a year its calendar does not cover (it stops asking about holidays; it
    // does not stop emitting events), so a date well past `COVERED_YEARS` still
    // yields a cap, and the null branch stays defensive.
    const beyondCoverage = new Date('2031-03-05T15:00:00Z') // a Wednesday, years past the calendar
    expect(oneTradingSessionMs(beyondCoverage)).toBe(oneTradingSessionMs(REGULAR_RTH))
    expect(ageThresholdMs({ cadenceMs: CADENCE_DAILY, now: beyondCoverage }).capMs).not.toBeNull()
  })
})
