import { describe, it, expect } from 'vitest'
import {
  ancestorKeys, buildTagTree, fallbackNodes, hasNestedTags, normalizeTagPath, suggestTags, tagKey,
} from './tagTree'

const NODES = [
  { path: 'research', key: 'research', own: 1, total: 4 },
  { path: 'research/semis', key: 'research/semis', own: 2, total: 3 },
  { path: 'research/semis/nvda', key: 'research/semis/nvda', own: 1, total: 1 },
  { path: 'research/software', key: 'research/software', own: 1, total: 1 },
  { path: 'swing', key: 'swing', own: 6, total: 6 },
  { path: 'Semiconductors', key: 'semiconductors', own: 1, total: 1 },
  // contains "semi" mid-word: the only candidate that tells a LEVEL-start
  // match (rank 1) from a merely-contains match (rank 2)
  { path: 'hemisemi', key: 'hemisemi', own: 1, total: 1 },
]

describe('normalizeTagPath — mirrors notes.py _normalize_tag_path', () => {
  it.each([
    ['Research / Semis', 'Research/Semis'],
    ['research//semis/', 'research/semis'],
    ['/a/b/', 'a/b'],
    ['  swing  ', 'swing'],
    ['///', ''],
  ])('%s -> %s', (raw, want) => {
    expect(normalizeTagPath(raw)).toBe(want)
  })
  it('keys are case-folded', () => {
    expect(tagKey(' Research / Semis ')).toBe('research/semis')
  })
})

describe('buildTagTree', () => {
  it('hangs every child under its parent and orders siblings by subtree size, then name', () => {
    const roots = buildTagTree(NODES)
    expect(roots.map((r) => r.key)).toEqual(['swing', 'research', 'hemisemi', 'semiconductors'])
    const research = roots.find((r) => r.key === 'research')
    expect(research.children.map((c) => c.label)).toEqual(['semis', 'software'])
    expect(research.children[0].children.map((c) => c.path)).toEqual(['research/semis/nvda'])
    expect(research.children[0].depth).toBe(1)
  })
  it('hasNestedTags is false for a flat library', () => {
    expect(hasNestedTags([{ path: 'a', key: 'a' }, { path: 'b', key: 'b' }])).toBe(false)
    expect(hasNestedTags(NODES)).toBe(true)
  })
  it('ancestorKeys', () => {
    expect(ancestorKeys('a/b/c')).toEqual(['a', 'a/b'])
    expect(ancestorKeys('a')).toEqual([])
  })
})

describe('fallbackNodes — only for an answer with no tree', () => {
  it('a flat tag is exact; an implied parent is created; a parent total is the subtree SUM', () => {
    const nodes = fallbackNodes([
      { tag: 'swing', count: 3 },
      { tag: 'macro/rates', count: 2 },
      { tag: 'macro', count: 1 },
    ])
    const by = Object.fromEntries(nodes.map((n) => [n.key, n]))
    expect(by.swing).toMatchObject({ own: 3, total: 3 })
    expect(by.macro).toMatchObject({ own: 1, total: 3 })
    expect(by['macro/rates']).toMatchObject({ own: 2, total: 2 })
  })
})

describe('suggestTags — hierarchy first', () => {
  it('a typed start offers the tag and everything below it, shallow first', () => {
    expect(suggestTags('res', NODES)).toEqual([
      'research', 'research/semis', 'research/software', 'research/semis/nvda',
    ])
  })
  it('"parent/" offers only what sits below the parent, children before grandchildren', () => {
    expect(suggestTags('research/', NODES)).toEqual([
      'research/semis', 'research/software', 'research/semis/nvda',
    ])
  })
  it('a LEVEL that starts with the text ranks above a path that merely contains it', () => {
    expect(suggestTags('semi', NODES)).toEqual([
      'Semiconductors', 'research/semis', 'research/semis/nvda', 'hemisemi',
    ])
  })
  it('ignores a leading # and never re-offers exactly what was typed', () => {
    expect(suggestTags('#swing', NODES)).toEqual([])
    expect(suggestTags('#sw', NODES)).toEqual(['swing'])
  })
  it('nothing typed, nothing offered', () => {
    expect(suggestTags('  ', NODES)).toEqual([])
  })
})
