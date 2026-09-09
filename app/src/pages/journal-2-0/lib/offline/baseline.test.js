/**
 * Wave Q1 — the one authority on what counts as a baseline.
 *
 * ⚰️ The defect: producers chose the baseline with `??` (nullish) while
 * consumers tested it for truthiness. An empty string therefore survived as a
 * "baseline" and was then silently dropped at send time — a PUT with no
 * compare-and-set. Found by a test that passed alone and failed in the full
 * suite, because the ordering of the durable write against `markSynced` decides
 * which value lands.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { usableBaseline, isUsableBaseline } from './baseline'

describe('usableBaseline', () => {
  it('⛔ treats the EMPTY STRING as no baseline — the whole point', () => {
    expect(usableBaseline('')).toBeNull()
    expect(usableBaseline('   ')).toBeNull()
    expect(isUsableBaseline('')).toBe(false)
  })

  it('⛔ treats null and undefined the same way, and normalises both to null', () => {
    expect(usableBaseline(null)).toBeNull()
    expect(usableBaseline(undefined)).toBeNull()
    expect(usableBaseline()).toBeNull()
  })

  it('⭐ returns the first USABLE candidate, not merely the first non-nullish one', () => {
    // This is the exact shape of the defect: `'' ?? fallback` is `''`.
    expect(usableBaseline('', 'T1')).toBe('T1')
    expect(usableBaseline(null, '', 'T2')).toBe('T2')
    expect(usableBaseline('T0', 'T1')).toBe('T0')
  })

  it('⛔ refuses a non-string that happens to be truthy', () => {
    // A number or an object here would be sent as a compare-and-set and the
    // server would reject or, worse, coerce it.
    expect(usableBaseline(12345)).toBeNull()
    expect(usableBaseline({ updatedAt: 'T1' })).toBeNull()
    expect(usableBaseline(true)).toBeNull()
  })

  it('⭐ CONTROL — an ordinary ISO timestamp passes through untouched', () => {
    expect(usableBaseline('2026-09-09T17:00:00.123456')).toBe('2026-09-09T17:00:00.123456')
    expect(isUsableBaseline('2026-09-09T17:00:00.123456')).toBe(true)
  })
})

/* ── the source contract: nobody may choose a baseline any other way ──────── */

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//')
      return i >= 0 && line[i - 1] !== ':' ? line.slice(0, i) : line
    })
    .join('\n')
}

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__fixtures__') continue
      sourceFiles(full, out)
    } else if (/\.jsx?$/.test(name) && !/\.test\.jsx?$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

describe('⛔ every baseline choice goes through the one authority', () => {
  const OFFLINE = dirname(fileURLToPath(import.meta.url))
  const WAVE = dirname(dirname(OFFLINE))           // …/journal-2-0
  const files = sourceFiles(WAVE).filter((f) => !f.endsWith('baseline.js'))

  // `X ?? Y` where X or Y mentions a baseline — the exact defect shape.
  const NULLISH_BASELINE = /(updatedAt|baseUpdatedAt)[^\n]*\?\?|\?\?[^\n]*(updatedAt|baseUpdatedAt)/

  it('⭐ the sweep reads this wave (non-vacuity control)', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => f.endsWith('outboxDrain.js'))).toBe(true)
    expect(files.some((f) => f.endsWith('NoteEditorPage.jsx'))).toBe(true)
  })

  it('⛔ no `?? ` coalescing over a baseline anywhere under journal-2-0', () => {
    const offenders = []
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'))
      src.split('\n').forEach((line, i) => {
        if (NULLISH_BASELINE.test(line)) {
          offenders.push(`${file.split(/[\\/]/).slice(-1)[0]}:${i + 1} — ${line.trim().slice(0, 80)}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it('⭐ the matcher SEES the defect shape, and ignores an unrelated `??`', () => {
    // Two controls: a matcher that finds nothing passes the assertion above,
    // and so does one that flags every `??` in the wave.
    expect(NULLISH_BASELINE.test('const b = saved?.updatedAt ?? entry.baseUpdatedAt ?? null')).toBe(true)
    expect(NULLISH_BASELINE.test('baseUpdatedAt: updatedAt ?? current?.baseUpdatedAt ?? null')).toBe(true)
    expect(NULLISH_BASELINE.test("title: entry.patch?.title ?? ''")).toBe(false)
    expect(NULLISH_BASELINE.test('lastStatus: error?.status ?? null')).toBe(false)
  })
})
