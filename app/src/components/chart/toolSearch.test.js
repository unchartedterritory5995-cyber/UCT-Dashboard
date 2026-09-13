// @vitest-environment jsdom
/* Can a trader find the tool using the word they actually think in?
 *
 * ⛔ THE VOCABULARY TABLE BELOW IS THE TEST. Every entry is a word that returned
 * "No tool matches" in the shipped picker, and every one of them is a normal
 * thing to type. A search that fails once teaches you not to search — and then
 * the roster's size stops being navigable and starts being a wall.
 */
import { describe, it, expect } from 'vitest'
import { rankTools, matchScore, TOOL_ALIASES } from './toolSearch'
import { DRAW_TOOLS } from './MobileDrawBar'

const top = (q) => (rankTools(DRAW_TOOLS, q)[0] || {}).id
const ids = (q) => rankTools(DRAW_TOOLS, q).map((t) => t.id)

describe('every tool is findable by intent', () => {
  it('the roster is not empty — this file cannot pass vacuously', () => {
    expect(DRAW_TOOLS.length).toBeGreaterThan(15)
  })

  it('⛔ no tool ships without vocabulary', () => {
    const bare = DRAW_TOOLS.filter((t) => !(TOOL_ALIASES[t.id] || []).length).map((t) => t.id)
    expect(bare, `tools with no aliases — invisible to anyone who does not know the name: ${bare.join(', ')}`).toEqual([])
  })

  // Each of these returned NOTHING before aliases existed.
  const VOCAB = [
    ['support', 'horizontal'], ['resistance', 'horizontal'], ['level', 'horizontal'],
    ['box', 'rect'], ['zone', 'rect'], ['supply', 'rect'], ['demand', 'rect'], ['base', 'rect'],
    ['retracement', 'fib'], ['fibonacci', 'fib'], ['golden', 'fib'],
    ['extension', 'fibext'], ['projection', 'fibext'],
    ['parallel', 'channel'], ['rails', 'channel'],
    ['andrews', 'pitchfork'], ['median line', 'pitchfork'],
    ['ruler', 'measure'], ['distance', 'measure'],
    ['risk', 'position'], ['r multiple', 'position'], ['stop', 'position'],
    ['note', 'text'], ['annotation', 'text'], ['comment', 'text'],
    ['vwap', 'avwap'], ['volume weighted', 'avwap'],
    ['earnings', 'vertical'], ['session', 'vertical'],
    ['saucer', 'cup'], ['rounded', 'cup'],
    ['uptrend', 'trendline'], ['diagonal', 'trendline'],
    ['ellipse', 'circle'], ['pointer', 'arrow'],
  ]

  it.each(VOCAB)('“%s” finds %s', (word, expected) => {
    expect(top(word), `“${word}” ranked: ${ids(word).join(', ') || '(nothing)'}`).toBe(expected)
  })
})

describe('ranking', () => {
  it('an exact NAME beats somebody else’s synonym', () => {
    // "target" is honestly both a Fib extension and the Position tool, but
    // "Text" is a real tool name and must not lose to an alias containing it.
    expect(top('text')).toBe('text')
    expect(top('measure')).toBe('measure')
    expect(top('channel')).toBe('channel')
  })

  it('overlapping intent returns BOTH, best first, rather than picking for you', () => {
    const t = ids('target')
    expect(t).toContain('fibext')
    expect(t).toContain('position')
  })

  it('a name prefix beats a name substring', () => {
    expect(matchScore({ id: 'fib', label: 'Fib' }, 'fi')).toBeLessThan(
      matchScore({ id: 'fibext', label: 'Fib Ext' }, 'ext'))
  })

  it('is stable within a tier — a keystroke never reshuffles equal matches', () => {
    const a = ids('support')
    const b = ids('support')
    expect(a).toEqual(b)
    // roster order preserved among equally-good matches
    expect(a.indexOf('horizontal')).toBeLessThan(a.indexOf('hray'))
  })

  it('keeps the old behaviour: space- and case-insensitive on names', () => {
    expect(ids('hray')).toContain('hray')
    expect(ids('h ray')).toContain('hray')
    expect(ids('H RAY')).toContain('hray')
  })

  it('an empty query returns the roster untouched, in authored order', () => {
    expect(rankTools(DRAW_TOOLS, '')).toBe(DRAW_TOOLS)
    expect(rankTools(DRAW_TOOLS, '   ')).toBe(DRAW_TOOLS)
  })

  it('CONTROL — nonsense still matches nothing, so the table above means something', () => {
    expect(rankTools(DRAW_TOOLS, 'zzzqqq')).toEqual([])
  })
})
