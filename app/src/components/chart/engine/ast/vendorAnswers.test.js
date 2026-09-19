// app/src/components/chart/engine/ast/vendorAnswers.test.js
//
// ─── ⛔ THE WORD "measured" MAY NOT SIT OVER A GUESS ────────────────────────
//
// `docs/pine/rvol-slice-vendor-answers.json` is where the RVOL slice's ten
// TradingView measurements land. The owner takes them by hand at their own
// signed-in session (`docs/pine/rvol-slice-vendor-packet.md`); nothing in this
// repo is allowed to fill one in from memory, from documentation, or from a
// model's recollection of how Pine behaves.
//
// ⭐ THIS RAIL'S WHOLE JOB is that an entry cannot wear `"status": "measured"`
// unless it carries a real answer and a real timestamp. An `unmeasured` entry
// with empty answers is CORRECT and stays green — the file ships that way, and
// a rail that went red on its own shipped state would be muted inside a week.
//
// ⭐ AND IT CARRIES ITS OWN CONTROL. `validateEntry` is exported and called on
// INLINE fixtures: a measured entry with an empty answer must be REJECTED by
// the same function that passes the real file. Without that, "the file is
// valid" and "the validator cannot tell" are the same observation.
//
// ⚠️ `na`, `n/a`, `NaN`, `0` and `false` are NOT treated as placeholders, on
// purpose. They are REAL vendor answers here: M1 asks what comes back before a
// requested series has its first bar, and the honest answer is very likely
// `NaN`; the Data Window prints `n/a` for exactly that. A guard that refused
// them would refuse the measurement it exists to protect — the adjacent-thing
// defect. What it refuses is `TBD`, `?`, `-`, `unknown`, `pending` and friends.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const FIXTURE = path.resolve(
  __dirname,
  '../../../../../../docs/pine/rvol-slice-vendor-answers.json',
)

export const ALLOWED_STATUSES = ['unmeasured', 'measured', 'blocked']
export const ALLOWED_TYPES = ['string', 'number', 'boolean', 'enum']
export const REQUIRED_ENTRY_FIELDS = [
  'id',
  'slug',
  'question',
  'status',
  'measured_at',
  'symbol',
  'timeframe',
  'answers',
]

/** Tokens that mean "nobody has actually looked yet" wearing the clothes of an
 *  answer. Deliberately NOT including `na` / `n/a` / `NaN` / `0` / `false` —
 *  see the header. */
export const PLACEHOLDER_TOKENS = [
  'tbd',
  'tba',
  'tbc',
  'todo',
  'to do',
  'unknown',
  'unmeasured',
  'not measured',
  'not yet',
  'pending',
  'placeholder',
  'fixme',
  'xxx',
  '?',
  '??',
  '???',
  '-',
  '--',
  '...',
  '…',
  'n/k',
]

/** ISO-8601 date, or date + time with an optional offset. */
const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/

export function isPlaceholder(value) {
  if (typeof value !== 'string') return false
  const t = value.trim().toLowerCase()
  return t === '' || PLACEHOLDER_TOKENS.includes(t)
}

/** Is one answer a REAL reading, given the type it declares?
 *
 *  Only ever asked of an entry whose status is `measured` — an `unmeasured`
 *  entry is supposed to be empty, and asking this of one would make the rail
 *  fail on the file's own shipped state. */
function answerErrors(id, key, a) {
  const where = `${id}.${key}`
  const v = a.value
  if (v === null || v === undefined) {
    return [`${where}: a "measured" entry may not leave this answer empty`]
  }
  switch (a.type) {
    case 'number':
      return Number.isFinite(v)
        ? []
        : [`${where}: declared "number" but the value is ${JSON.stringify(v)}`]
    case 'boolean':
      return typeof v === 'boolean'
        ? []
        : [`${where}: declared "boolean" but the value is ${JSON.stringify(v)}`]
    case 'enum': {
      if (typeof v !== 'string' || isPlaceholder(v)) {
        return [`${where}: ${JSON.stringify(v)} is not a measurement`]
      }
      const allowed = Array.isArray(a.allowed) ? a.allowed : []
      return allowed.includes(v)
        ? []
        : [`${where}: ${JSON.stringify(v)} is not one of the options this answer declares`]
    }
    default: {
      if (typeof v !== 'string') {
        return [`${where}: declared "string" but the value is ${JSON.stringify(v)}`]
      }
      return isPlaceholder(v)
        ? [`${where}: ${JSON.stringify(v)} is a placeholder, not a measurement`]
        : []
    }
  }
}

/** Every complaint about one entry, as a list of strings. Empty list = valid. */
export function validateEntry(entry) {
  const errs = []
  const id = entry && entry.id ? String(entry.id) : '<no id>'

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return [`${id}: entry is not an object`]
  }

  for (const field of REQUIRED_ENTRY_FIELDS) {
    if (!(field in entry)) errs.push(`${id}: missing required field "${field}"`)
  }
  if (errs.length) return errs

  if (!ALLOWED_STATUSES.includes(entry.status)) {
    errs.push(
      `${id}: status "${entry.status}" is not one of ${ALLOWED_STATUSES.join(', ')}`,
    )
  }

  const answers = entry.answers
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    errs.push(`${id}: answers must be an object`)
    return errs
  }
  const keys = Object.keys(answers)
  if (keys.length === 0) errs.push(`${id}: answers is empty — an entry with no answer field measures nothing`)

  for (const key of keys) {
    const a = answers[key]
    if (!a || typeof a !== 'object' || Array.isArray(a)) {
      errs.push(`${id}.${key}: answer must be an object`)
      continue
    }
    if (!ALLOWED_TYPES.includes(a.type)) {
      errs.push(`${id}.${key}: type "${a.type}" is not one of ${ALLOWED_TYPES.join(', ')}`)
    }
    if (!('value' in a)) errs.push(`${id}.${key}: no "value" key`)
    if (a.type === 'enum' && !Array.isArray(a.allowed)) {
      errs.push(`${id}.${key}: an enum answer must declare "allowed"`)
    }
  }

  if (entry.status === 'blocked') {
    if (typeof entry.notes !== 'string' || isPlaceholder(entry.notes)) {
      errs.push(`${id}: status "blocked" requires notes saying why`)
    }
  }

  // ─── the half this file exists for ───────────────────────────────────────
  // An `unmeasured` entry is allowed to be empty in every respect. A
  // `measured` one is not allowed to be empty in ANY respect: it must name
  // when it was read, what it was read on, and what the screen said.
  if (entry.status === 'measured') {
    if (typeof entry.measured_at !== 'string' || !ISO_8601.test(entry.measured_at.trim())) {
      errs.push(
        `${id}: status "measured" needs an ISO-8601 measured_at; got ${JSON.stringify(entry.measured_at)}`,
      )
    }
    for (const field of ['symbol', 'timeframe']) {
      if (typeof entry[field] !== 'string' || isPlaceholder(entry[field])) {
        errs.push(
          `${id}: status "measured" needs the ${field} it was read on; got ${JSON.stringify(entry[field])}`,
        )
      }
    }
    for (const key of keys) {
      const a = answers[key]
      if (!a || typeof a !== 'object' || Array.isArray(a)) continue
      errs.push(...answerErrors(id, key, a))
    }
  }

  return errs
}

const RAW = fs.readFileSync(FIXTURE, 'utf8')

describe('the RVOL-slice vendor answers fixture', () => {
  it('parses, and carries the ten measurements the design names', () => {
    const doc = JSON.parse(RAW)
    expect(Array.isArray(doc.measurements)).toBe(true)
    // Non-vacuity: every assertion below is over this list, so an empty one
    // would pass the whole file.
    expect(doc.measurements.length).toBe(10)
    expect(doc.measurements.map((m) => m.id)).toEqual([
      'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10',
    ])
    const slugs = doc.measurements.map((m) => m.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('every entry passes the validator', () => {
    const doc = JSON.parse(RAW)
    const errs = doc.measurements.flatMap((m) => validateEntry(m))
    expect(errs).toEqual([])
  })
})

describe('the validator can reject a fake "measured" entry', () => {
  /** A minimal entry, well-formed, that the control mutates one field at a time. */
  const good = () => ({
    id: 'CTRL',
    slug: 'control',
    question: 'does the validator work?',
    status: 'measured',
    measured_at: '2026-09-20T14:31:00-04:00',
    symbol: 'NASDAQ:AAPL',
    timeframe: '5',
    answers: {
      some_reading: { type: 'string', value: '184.22' },
    },
    notes: null,
  })

  it('CONTROL: a well-formed measured entry is ACCEPTED', () => {
    // Without this, "rejects everything" and "rejects the right thing" are the
    // same observation.
    expect(validateEntry(good())).toEqual([])
  })

  it('CONTROL: an unmeasured entry with empty answers is ACCEPTED', () => {
    const e = good()
    e.status = 'unmeasured'
    e.measured_at = null
    e.symbol = null
    e.timeframe = null
    e.answers.some_reading.value = null
    expect(validateEntry(e)).toEqual([])
  })

  it('⛔ status "measured" with an EMPTY answer is rejected', () => {
    const e = good()
    e.answers.some_reading.value = ''
    const errs = validateEntry(e)
    expect(errs.length).toBeGreaterThan(0)
    expect(errs.join(' ')).toContain('some_reading')
  })

  it('⛔ status "measured" with a NULL answer is rejected', () => {
    const e = good()
    e.answers.some_reading.value = null
    expect(validateEntry(e).length).toBeGreaterThan(0)
  })

  it('⛔ status "measured" with a PLACEHOLDER answer is rejected', () => {
    for (const token of ['TBD', ' tbd ', 'TODO', '?', '-', 'unknown', 'pending']) {
      const e = good()
      e.answers.some_reading.value = token
      expect(validateEntry(e).length, `token ${JSON.stringify(token)}`).toBeGreaterThan(0)
    }
  })

  it('⛔ status "measured" with no timestamp is rejected', () => {
    const e = good()
    e.measured_at = null
    expect(validateEntry(e).length).toBeGreaterThan(0)
  })

  it('⛔ status "measured" without the symbol and timeframe it was read on is rejected', () => {
    const noSym = good()
    noSym.symbol = ''
    expect(validateEntry(noSym).length).toBeGreaterThan(0)

    const noTf = good()
    noTf.timeframe = null
    expect(validateEntry(noTf).length).toBeGreaterThan(0)
  })

  it('⭐ na / n/a / NaN / 0 / false are REAL answers, not placeholders', () => {
    for (const real of ['na', 'n/a', 'NaN', '0', 'false']) {
      const e = good()
      e.answers.some_reading.value = real
      expect(validateEntry(e), `answer ${JSON.stringify(real)}`).toEqual([])
    }
  })

  it('⛔ a number answer must be a finite number, a boolean a boolean', () => {
    const num = good()
    num.answers.some_reading = { type: 'number', value: 'lots' }
    expect(validateEntry(num).length).toBeGreaterThan(0)

    const bool = good()
    bool.answers.some_reading = { type: 'boolean', value: 'true' }
    expect(validateEntry(bool).length).toBeGreaterThan(0)

    const okNum = good()
    okNum.answers.some_reading = { type: 'number', value: 0 }
    expect(validateEntry(okNum)).toEqual([])

    const okBool = good()
    okBool.answers.some_reading = { type: 'boolean', value: false }
    expect(validateEntry(okBool)).toEqual([])
  })

  it('⛔ an enum answer must be one of its declared options', () => {
    const e = good()
    e.answers.some_reading = { type: 'enum', allowed: ['yes', 'no'], value: 'maybe' }
    expect(validateEntry(e).length).toBeGreaterThan(0)

    const ok = good()
    ok.answers.some_reading = { type: 'enum', allowed: ['yes', 'no'], value: 'no' }
    expect(validateEntry(ok)).toEqual([])
  })

  it('⛔ an unknown status, a missing field and an empty answer set are rejected', () => {
    const badStatus = good()
    badStatus.status = 'probably'
    expect(validateEntry(badStatus).length).toBeGreaterThan(0)

    const missing = good()
    delete missing.timeframe
    expect(validateEntry(missing).join(' ')).toContain('timeframe')

    const noAnswers = good()
    noAnswers.answers = {}
    expect(validateEntry(noAnswers).length).toBeGreaterThan(0)
  })

  it('⛔ status "blocked" must say why', () => {
    const e = good()
    e.status = 'blocked'
    e.notes = null
    expect(validateEntry(e).length).toBeGreaterThan(0)

    const ok = good()
    ok.status = 'blocked'
    ok.notes = 'Part A would not compile; error text in the packet thread.'
    expect(validateEntry(ok)).toEqual([])
  })
})
