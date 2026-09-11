/**
 * The reproduction channel's own rail. ⛔ Its load-bearing property is not that
 * it records — it is that when DISARMED it does nothing at all, because it is
 * being added to a layer that ships dark and must stay indistinguishable from
 * absent (`project_feature_flag_ledger`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { diag, diagEnabled, shape, hash32, DIAG_KEY, DIAG_MAX } from './diag'

const buf = () => globalThis.__uctNbDiag

beforeEach(() => {
  localStorage.clear()
  delete globalThis.__uctNbDiag
})
afterEach(() => {
  localStorage.clear()
  delete globalThis.__uctNbDiag
})

describe('⛔⛔ disarmed means ABSENT, not quiet', () => {
  it('records nothing and does not even create the buffer', () => {
    diag('x', () => ({ a: 1 }))
    expect(buf()).toBeUndefined()
  })

  it('⛔ never calls the payload builder — an expensive shape costs members nothing', () => {
    const build = vi.fn(() => ({ a: 1 }))
    diag('x', build)
    expect(build).not.toHaveBeenCalled()
  })

  it('a storage that throws reads as disarmed, never as armed', () => {
    const hostile = { getItem() { throw new Error('blocked') } }
    expect(diagEnabled(hostile)).toBe(false)
  })

  it('⛔ only the exact string arms it — a truthy value is not an opt-in', () => {
    for (const v of ['0', 'true', 'yes', '', 'on']) {
      localStorage.setItem(DIAG_KEY, v)
      expect(diagEnabled(), `"${v}" must not arm the channel`).toBe(false)
    }
    localStorage.setItem(DIAG_KEY, '1')
    expect(diagEnabled()).toBe(true)
  })
})

describe('⭐ armed, it records the decision', () => {
  beforeEach(() => localStorage.setItem(DIAG_KEY, '1'))

  it('CONTROL — the same call that recorded nothing above now records', () => {
    const build = vi.fn(() => ({ a: 1 }))
    diag('settle', build)
    expect(build).toHaveBeenCalledTimes(1)
    expect(buf()).toHaveLength(1)
    expect(buf()[0]).toMatchObject({ event: 'settle', a: 1 })
    expect(typeof buf()[0].at).toBe('string')
  })

  it('⛔ caps the buffer rather than growing without bound on the member\'s machine', () => {
    for (let i = 0; i < DIAG_MAX + 25; i += 1) diag('e', () => ({ i }))
    expect(buf()).toHaveLength(DIAG_MAX)
    // the OLDEST are dropped — every round's interesting moment was the last one
    expect(buf()[buf().length - 1].i).toBe(DIAG_MAX + 24)
  })

  it('⛔ a throwing builder cannot break the thing it is diagnosing', () => {
    expect(() => diag('e', () => { throw new Error('boom') })).not.toThrow()
  })
})

describe('⛔⛔ it carries SHAPE, never the member\'s prose', () => {
  it('reports lengths and a hash, and no text', () => {
    const s = shape({
      title: 'NVDA thesis',
      subtitle: '',
      bodyJson: { type: 'doc', content: [{ type: 'text', text: 'SECRET MEMBER PROSE' }] },
      baseUpdatedAt: 'T1',
    })
    const asText = JSON.stringify(s)
    expect(asText).not.toContain('SECRET MEMBER PROSE')
    expect(asText).not.toContain('NVDA thesis')
    expect(s.title).toBe(11)
    expect(s.bodyLen).toBeGreaterThan(0)
    expect(s.bodyHash).toMatch(/^[0-9a-f]{8}$/)
    expect(s.baseUpdatedAt).toBe('T1')
  })

  it('⭐ the hash DISTINGUISHES — otherwise it could not answer "did the body change"', () => {
    const a = shape({ bodyJson: { t: 'one' } })
    const b = shape({ bodyJson: { t: 'two' } })
    expect(a.bodyHash).not.toBe(b.bodyHash)
    expect(hash32('x')).toBe(hash32('x'))
  })

  it('null and undefined survive as themselves — the whole question is which one it was', () => {
    expect(shape(null)).toBeNull()
    expect(shape(undefined)).toBeUndefined()
  })

  it('⛔⛔ an EMPTY-STRING baseline is reported AS an empty string, never flattened to null', () => {
    // ⚰️ This assertion was written the other way round first, and the rail
    // caught it. Collapsing '' to null would make the diagnostic destroy the
    // exact distinction it exists to find: `''` is the value that is PRESENT to
    // `??` and ABSENT to a truthiness check, which is the defect shape this wave
    // already paid for (`lesson_chosen_with_nullish_consumed_with_truthiness`).
    // An instrument that cannot tell '' from absent cannot report the bug.
    expect(shape({ baseUpdatedAt: '' }).baseUpdatedAt).toBe('')
    expect(shape({ baseUpdatedAt: 'T1' }).baseUpdatedAt).toBe('T1')
    // A non-string is not a baseline at all, and says so.
    expect(shape({ baseUpdatedAt: 0 }).baseUpdatedAt).toBeNull()
    expect(shape({}).baseUpdatedAt).toBeNull()
  })
})

describe('⛔⛔ NOTHING IN THE PRODUCT MAY BRANCH ON IT', () => {
  const ROOT = path.join(process.cwd(), 'src', 'pages', 'journal-2-0')

  function sources(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== '__fixtures__') sources(p, out) }
      else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\.[jt]sx?$/.test(e.name)) out.push(p)
    }
    return out
  }

  const files = sources(ROOT)

  it('⭐ NON-VACUITY: the sweep actually found the product files', () => {
    expect(files.length).toBeGreaterThan(40)
    expect(files.some((f) => f.endsWith('NoteEditorPage.jsx'))).toBe(true)
  })

  it('⛔ no product file reads __uctNbDiag — an instrument that is read becomes an authority', () => {
    const offenders = files
      .filter((f) => !f.endsWith(path.join('offline', 'diag.js')))
      .filter((f) => fs.readFileSync(f, 'utf8').includes('__uctNbDiag'))
      .map((f) => path.relative(ROOT, f))
    expect(offenders).toEqual([])
  })

  it('⛔ every call site passes a BUILDER, so a disarmed channel allocates nothing', () => {
    const offenders = []
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      // `diag('name', () => ({...}))` is the only accepted shape at a call site.
      for (const m of src.matchAll(/\bdiag\(\s*'[^']+'\s*,\s*([^)])/g)) {
        if (m[1] !== '(') offenders.push(`${path.relative(ROOT, f)} — diag(…, ${m[1]}…`)
      }
    }
    expect(offenders).toEqual([])
  })
})
