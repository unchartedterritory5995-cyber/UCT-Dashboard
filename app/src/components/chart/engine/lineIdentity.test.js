// app/src/components/chart/engine/lineIdentity.test.js
//
// The browser half of line identity (owner decision 2026-11-02): the vocabulary is the
// SERVER's, read from its source as text — never retyped here as a second authority.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  PLOT_UID_PATTERN, PLOT_UID_RE, LEGACY_LINE_PREFIX, NEW_LINE_FLAG, RETIRED_LINE,
  lineIdentity, plotLineOf, lineMatches, recordableLine, rowIsNewLine,
  withLocalLineIdentities, withoutNewLineMarkers, servedLineIdentities,
} from './lineIdentity'

const PY = path.resolve(process.cwd(), '..', 'api', 'services', 'user_definitions.py')

describe('parity with api/services/user_definitions.py (read as text)', () => {
  const py = fs.readFileSync(PY, 'utf8')

  it('the file is the one that declares line identity (non-vacuity control)', () => {
    expect(py).toMatch(/^PLOT_UID_RE\s*=/m)
    expect(py).toMatch(/^NEW_LINE_FLAG\s*=/m)
  })

  it('the uid pattern is byte-identical', () => {
    const m = py.match(/^PLOT_UID_RE\s*=\s*re\.compile\(r"([^"]+)"\)/m)
    expect(m, 'PLOT_UID_RE not found in the Python source').toBeTruthy()
    expect(m[1]).toBe(PLOT_UID_PATTERN)
    expect(PLOT_UID_RE.source).toBe(PLOT_UID_PATTERN)
  })

  it('the legacy prefix is the same', () => {
    const m = py.match(/^LEGACY_LINE_PREFIX\s*=\s*"([^"]*)"/m)
    expect(m).toBeTruthy()
    expect(m[1]).toBe(LEGACY_LINE_PREFIX)
  })

  it('the draft marker has the same name', () => {
    const m = py.match(/^NEW_LINE_FLAG\s*=\s*"([^"]*)"/m)
    expect(m).toBeTruthy()
    expect(m[1]).toBe(NEW_LINE_FLAG)
  })
})

const doc = (plots, kind = 'ast') => ({ id: 'u_x', compute: { kind }, plots })

describe('lineIdentity', () => {
  it('a valid uid is the identity; anything else is k:<key>; a non-plot is null', () => {
    expect(lineIdentity({ key: 'fast', uid: 'p_0123456789ab' })).toBe('p_0123456789ab')
    expect(lineIdentity({ key: 'fast' })).toBe('k:fast')
    expect(lineIdentity({ key: 'fast', uid: 'p_XYZ' })).toBe('k:fast')
    expect(lineIdentity({ key: 'fast', uid: 'p_0123456789abc' })).toBe('k:fast')
    expect(lineIdentity(null)).toBeNull()
    expect(lineIdentity({ uid: 'p_0123456789ab' })).toBeNull()
    expect(plotLineOf(doc([{ key: 'a', uid: 'p_aaaaaaaaaaaa' }]), 'a')).toBe('p_aaaaaaaaaaaa')
    expect(plotLineOf(doc([{ key: 'a' }]), 'b')).toBeNull()
  })

  it('lineMatches: nothing recorded binds by key; a different line, a pending line or a missing key does not', () => {
    const d = doc([{ key: 'fast', uid: 'p_aaaaaaaaaaaa' }, { key: 'slow', newLine: true }])
    expect(lineMatches(null, d, 'fast')).toBe(true)
    expect(lineMatches('p_aaaaaaaaaaaa', d, 'fast')).toBe(true)
    expect(lineMatches('p_bbbbbbbbbbbb', d, 'fast')).toBe(false)
    expect(lineMatches('k:fast', d, 'fast')).toBe(false)
    expect(lineMatches('k:slow', d, 'slow')).toBe(false)
    expect(lineMatches('k:gone', d, 'gone')).toBe(false)
    expect(lineMatches(RETIRED_LINE, d, 'fast')).toBe(false)
    expect(lineMatches('p_aaaaaaaaaaaa', null, 'fast')).toBe(true)
  })

  it('recordableLine: member lanes only, never a pending line; retired only when asked', () => {
    const d = doc([{ key: 'fast', uid: 'p_aaaaaaaaaaaa' }, { key: 'slow', newLine: true }, { key: 'old' }])
    expect(recordableLine(d, 'fast')).toBe('p_aaaaaaaaaaaa')
    expect(recordableLine(d, 'old')).toBe('k:old')
    expect(recordableLine(d, 'slow')).toBeNull()
    expect(recordableLine(d, 'gone')).toBeNull()
    expect(recordableLine(d, 'gone', { retiredWhenMissing: true })).toBe(RETIRED_LINE)
    expect(recordableLine(doc([{ key: 'rsi' }], 'native'), 'rsi')).toBeNull()
  })

  it('rowIsNewLine: an added row, or a saved row whose key changed', () => {
    expect(rowIsNewLine({ key: 'a', newLine: true })).toBe(true)
    expect(rowIsNewLine({ key: 'a', savedKey: 'a' })).toBe(false)
    expect(rowIsNewLine({ key: 'b', savedKey: 'a' })).toBe(true)
    expect(rowIsNewLine({ key: 'a' })).toBe(false)
  })
})

describe('the copy this tab installs after a save', () => {
  const prior = doc([{ key: 'fast', uid: 'p_aaaaaaaaaaaa' }, { key: 'old' }, { key: 'wait', newLine: true }])

  it('a continuing line keeps the prior uid; a new / re-added / still-pending line is pending; a stale client uid is dropped', () => {
    const sent = doc([
      { key: 'fast', uid: 'p_cccccccccccc' },
      { key: 'old' },
      { key: 'added' },
      { key: 'wait' },
      { key: 'fast2', newLine: true },
    ])
    const out = withLocalLineIdentities(sent, prior)
    const by = Object.fromEntries(out.plots.map((p) => [p.key, p]))
    expect(by.fast).toEqual({ key: 'fast', uid: 'p_aaaaaaaaaaaa' })
    expect(by.old).toEqual({ key: 'old' })
    expect(by.added).toEqual({ key: 'added', newLine: true })
    expect(by.wait).toEqual({ key: 'wait', newLine: true })
    expect(by.fast2).toEqual({ key: 'fast2', newLine: true })
  })

  it('a re-added key sent with newLine is pending, never the old uid', () => {
    const out = withLocalLineIdentities(doc([{ key: 'fast', uid: 'p_aaaaaaaaaaaa', newLine: true }]), prior)
    expect(out.plots[0]).toEqual({ key: 'fast', newLine: true })
  })

  it("the store's answer wins whenever it gives one", () => {
    const served = servedLineIdentities({ plot_identities: { fast: 'p_dddddddddddd', old: 'k:old' } })
    const out = withLocalLineIdentities(doc([{ key: 'fast', newLine: true }, { key: 'old', newLine: true }]), prior, served)
    expect(out.plots).toEqual([{ key: 'fast', uid: 'p_dddddddddddd' }, { key: 'old' }])
  })

  it('a create (no prior) is pending throughout', () => {
    const out = withLocalLineIdentities(doc([{ key: 'value' }]), null)
    expect(out.plots).toEqual([{ key: 'value', newLine: true }])
  })

  it('withoutNewLineMarkers removes the marks, and is identity when there are none', () => {
    const d = doc([{ key: 'a', newLine: true }, { key: 'b' }])
    expect(withoutNewLineMarkers(d).plots).toEqual([{ key: 'a' }, { key: 'b' }])
    const clean = doc([{ key: 'a' }])
    expect(withoutNewLineMarkers(clean)).toBe(clean)
  })
})
