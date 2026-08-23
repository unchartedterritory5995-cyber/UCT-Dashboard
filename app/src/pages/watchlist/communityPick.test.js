import { describe, test, expect } from 'vitest'
import { resolveCommunityPick, aliasKey, communityKey, isCommunityPick } from './communityPick'

const AUG9 = { id: 'a9', name: 'Sunday Scans — August 9, 2026', items: [{ sym: 'NBIS' }] }
const AUG16 = { id: 'a16', name: 'Sunday Scans — August 16, 2026', alias: 'sunday-scans-latest', items: [{ sym: 'INTC' }] }
const RAVI = { id: 'cw1', name: "Ravi's Board", items: [] }
const POOL = [RAVI, AUG9, AUG16]

describe('resolveCommunityPick', () => {
  test('an id key resolves that exact row', () => {
    expect(resolveCommunityPick(POOL, communityKey(AUG9))).toBe(AUG9)
    expect(resolveCommunityPick(POOL, 'community:cw1')).toBe(RAVI)
  })

  test('an alias key resolves whichever row carries the alias — not the one it pointed at last week', () => {
    expect(resolveCommunityPick(POOL, aliasKey('sunday-scans-latest'))).toBe(AUG16)
    // Next week the alias moves: the SAME key now resolves the newer row.
    const AUG23 = { id: 'a23', name: 'Sunday Scans — August 23, 2026', alias: 'sunday-scans-latest', items: [] }
    const next = [RAVI, AUG9, { ...AUG16, alias: undefined }, AUG23]
    expect(resolveCommunityPick(next, aliasKey('sunday-scans-latest'))).toBe(AUG23)
  })

  test('an alias nobody carries, an unknown id, a bare prefix, or a non-community key resolve to null', () => {
    expect(resolveCommunityPick(POOL, aliasKey('gone'))).toBeNull()
    expect(resolveCommunityPick(POOL, 'community:nope')).toBeNull()
    expect(resolveCommunityPick(POOL, 'community:alias:')).toBeNull()
    expect(resolveCommunityPick(POOL, 'user:a16')).toBeNull()
    expect(resolveCommunityPick(POOL, null)).toBeNull()
    expect(resolveCommunityPick(undefined, aliasKey('sunday-scans-latest'))).toBeNull()
  })

  test('a row whose id happens to start with "alias:" is never mistaken for an alias pick', () => {
    const odd = { id: 'alias:x', name: 'odd', items: [] }
    expect(resolveCommunityPick([odd], 'community:alias:x')).toBeNull()   // alias lookup, no row carries it
    expect(isCommunityPick('community:alias:x')).toBe(true)
    expect(isCommunityPick('flagged')).toBe(false)
  })
})
