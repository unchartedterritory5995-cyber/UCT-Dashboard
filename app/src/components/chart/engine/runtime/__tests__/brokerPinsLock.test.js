// app/src/components/chart/engine/runtime/__tests__/brokerPinsLock.test.js
//
// ─── W9-T2: THE PIN LEDGER'S LOCK, AND `pinned()`'S TEST-ONLY ARGUMENT ───────
//
// Design rule 7: a pin landing is an engine change and takes a SCRIPT_ENGINE_VERSION
// bump. This rail does NOT edit the version (the coordinator does); it feeds the
// pure checker fixtures for every case and then the real committed files.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { SCRIPT_ENGINE_VERSION } from '../../scriptEngineVersion.js'
import { pinned } from '../brokerPins.js'
import {
  checkLock, canonicalJson, olderEntriesDigest, pinSetArgumentSites, REASONS,
} from '../brokerPinsLock.js'

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const RT = path.resolve(here, '..')
const SRC = path.resolve(here, '../../../../..') // app/src

// ⭐ The committed digest of every lock entry except the last. The coordinator moves
// it in the same merge that appends an entry (that visible act is the rule).
// sha256('[]'): the lock holds one entry, so there is no older history yet.
const COMMITTED_OLDER_DIGEST = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'

const ledgerA = canonicalJson({ schema: 'uct.broker-pins.resolved/v1', rules: {} })
const ledgerB = canonicalJson({ schema: 'uct.broker-pins.resolved/v1', rules: { 'B-PATH': ['fx-1'] } })
const lockOf = (entries) => '{\n' + entries.map(([k, v]) => ` "${k}": "${v}"`).join(',\n') + '\n}\n'
const check = (o) => checkLock({ sha256, ...o })

// A world at engine version 17: one genesis entry for the empty ledger.
const world = (over = {}) => {
  const lockText = over.lockText ?? lockOf([['17', sha256(ledgerA)]])
  return {
    version: 17,
    lockText,
    resolvedText: ledgerA,
    olderDigest: olderEntriesDigest(lockText, sha256),
    ...over,
  }
}

describe('brokerPins lock: the five cases', () => {
  it('control: an untouched world is green', () => {
    expect(check(world())).toEqual({ ok: true, reasons: [] })
  })

  it('case 1: a ledger change with no bump and no entry is red', () => {
    const w = world({ resolvedText: ledgerB })
    const r = check(w)
    expect(r.ok).toBe(false)
    expect(r.reasons).toContain(REASONS.changedWithoutEntry)
  })

  it('case 1b: a ledger change with a bump but no new entry is red (the older entry governs)', () => {
    const r = check(world({ version: 18, resolvedText: ledgerB }))
    expect(r.reasons).toContain(REASONS.changedWithoutEntry)
  })

  it('case 2: a non-pin bump with no lock edit is green', () => {
    expect(check(world({ version: 18 })).ok).toBe(true)
    expect(check(world({ version: 25 })).ok).toBe(true)
  })

  it('case 3: a pin landing, bump plus a new entry, is green', () => {
    const lockText = lockOf([['17', sha256(ledgerA)], ['18', sha256(ledgerB)]])
    const w = { version: 18, lockText, resolvedText: ledgerB, olderDigest: olderEntriesDigest(lockText, sha256) }
    expect(check(w)).toEqual({ ok: true, reasons: [] })
    // and a later non-pin bump stays green on the same lock
    expect(check({ ...w, version: 21 }).ok).toBe(true)
  })

  it('case 4a: an edited older entry is red', () => {
    const good = lockOf([['17', sha256(ledgerA)], ['18', sha256(ledgerB)]])
    const olderDigest = olderEntriesDigest(good, sha256)
    const edited = lockOf([['17', sha256('something else')], ['18', sha256(ledgerB)]])
    const r = check({ version: 18, lockText: edited, resolvedText: ledgerB, olderDigest })
    expect(r.reasons).toContain(REASONS.olderEdited)
  })

  it('case 4b: a removed older entry is red', () => {
    const good = lockOf([['17', sha256(ledgerA)], ['18', sha256(ledgerB)]])
    const olderDigest = olderEntriesDigest(good, sha256)
    const removed = lockOf([['18', sha256(ledgerB)]])
    const r = check({ version: 18, lockText: removed, resolvedText: ledgerB, olderDigest })
    expect(r.reasons).toContain(REASONS.olderEdited)
  })

  it('case 5: a new entry under a version not above every existing key is red', () => {
    const good = lockOf([['17', sha256(ledgerA)], ['19', sha256(ledgerB)]])
    const bad = lockOf([['17', sha256(ledgerA)], ['19', sha256(ledgerB)], ['18', sha256(ledgerB)]])
    const r = check({ version: 19, lockText: bad, resolvedText: ledgerB, olderDigest: olderEntriesDigest(good, sha256) })
    expect(r.reasons).toContain(REASONS.outOfOrder)
    // a duplicate key (JSON.parse keeps the last) is the same defect
    const dup = '{\n "17": "' + sha256(ledgerA) + '",\n "17": "' + sha256(ledgerB) + '"\n}\n'
    expect(check(world({ lockText: dup })).reasons).toContain(REASONS.outOfOrder)
  })

  it('an entry for a version the engine has not reached is red', () => {
    const lockText = lockOf([['17', sha256(ledgerA)], ['30', sha256(ledgerA)]])
    expect(check(world({ lockText })).reasons).toContain(REASONS.future)
  })

  it('a lock with no entry at or below the version is red', () => {
    const lockText = lockOf([['20', sha256(ledgerA)]])
    expect(check(world({ lockText })).reasons).toContain(REASONS.noGoverning)
  })

  it('a ledger that is not in canonical form is red (hand-edited or re-spaced)', () => {
    const spaced = JSON.stringify(JSON.parse(ledgerA), null, 1) + '\n'
    const lockText = lockOf([['17', sha256(spaced)]])
    expect(check(world({ lockText, resolvedText: spaced })).reasons).toContain(REASONS.notCanonical)
  })

  it('a non-numeric key is red', () => {
    const lockText = lockOf([['17', sha256(ledgerA)], ['v18', sha256(ledgerA)]])
    expect(check(world({ lockText })).reasons).toContain(REASONS.badKey)
  })
})

describe('brokerPins lock: the real committed files', () => {
  // A Windows checkout with autocrlf holds CRLF; the committed blob (and the sha) is LF.
  const lf = (t) => t.replace(/\r\n/g, '\n')
  const resolvedText = lf(fs.readFileSync(path.join(RT, 'brokerPins.resolved.json'), 'utf8'))
  const lockText = lf(fs.readFileSync(path.join(RT, 'brokerPins.lock.json'), 'utf8'))

  it('the committed ledger, lock and engine version agree', () => {
    const r = checkLock({
      version: SCRIPT_ENGINE_VERSION, lockText, resolvedText, olderDigest: COMMITTED_OLDER_DIGEST, sha256,
    })
    expect(r).toEqual({ ok: true, reasons: [] })
  })

  it('the committed older-entries digest is the real lock\'s', () => {
    expect(olderEntriesDigest(lockText, sha256)).toBe(COMMITTED_OLDER_DIGEST)
  })

  it('the resolved ledger holds only pinned-rule -> fixture-id lists', () => {
    const doc = JSON.parse(resolvedText)
    expect(doc.schema).toBe('uct.broker-pins.resolved/v1')
    for (const [rule, ids] of Object.entries(doc.rules)) {
      expect(typeof rule).toBe('string')
      expect(Array.isArray(ids) && ids.length > 0).toBe(true)
    }
  })
})

describe('pinned(): the reader, and its test-only argument', () => {
  it('asks the committed ledger, and an unknown rule is unpinned', () => {
    expect(pinned('NO-SUCH-RULE')).toBe(false)
    expect(pinned(String())).toBe(false)
    expect(pinned(undefined)).toBe(false)
  })

  it('an explicit pin set (object or Set) answers instead of the ledger', () => {
    expect(pinned('B-PATH', { 'B-PATH': ['fx'] })).toBe(true)
    expect(pinned('B-PATH', new Set(['B-PATH']))).toBe(true)
    expect(pinned('B-PATH', new Set())).toBe(false)
    expect(pinned('toString', {})).toBe(false)
  })

  it('the scanner flags a second argument in source and ignores prose, the definition and tests', () => {
    const sources = [
      { path: 'a/engine.js', text: "if (pinned('B-PATH', new Set(['B-PATH']))) go()" },
      { path: 'a/nested.js', text: 'x = pinned(f(a, b), set)' },
      { path: 'a/ok.js', text: "if (pinned('B-PATH') && pinned(rule)) go()" },
      { path: 'a/nestedOk.js', text: 'pinned(pick(a, b))' },
      { path: 'a/prose.js', text: "// pinned(rule, explicitSet) is for tests\n/* pinned('x', y) */ const s = \"pinned('x', y)\"" },
      { path: 'a/def.js', text: 'export function pinned(ruleId, explicitPinSet) { return 1 }' },
      { path: 'a/__tests__/t.test.js', text: "pinned('B', new Set())" },
      { path: 'a/__tests__/helper.js', text: "pinned('B', new Set())" },
      { path: 'a/other.test.js', text: "pinned('B', new Set())" },
      { path: 'a/method.js', text: "obj.pinned('B', 2)" },
    ]
    expect(pinSetArgumentSites(sources).map((s) => s.path)).toEqual(['a/engine.js', 'a/nested.js'])
  })

  it('RAIL: no source file outside a test passes pinned() a second argument', () => {
    const files = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules') continue
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(js|jsx|mjs|cjs)$/.test(e.name)) files.push(p)
      }
    }
    walk(SRC)
    expect(files.length).toBeGreaterThan(100) // a walk that found nothing proves nothing
    const sources = files.map((p) => ({ path: p, text: fs.readFileSync(p, 'utf8') }))
    expect(pinSetArgumentSites(sources)).toEqual([])
  })
})
