import { describe, it, expect } from 'vitest'
import { diffNoteBodies, diffHasChanges, DIFF_MAX_WORDS_PRODUCT } from './noteVersionDiff'

function reconstruct(ops, types) {
  return ops.filter((o) => types.includes(o.type)).map((o) => o.text).join('')
}

describe('diffNoteBodies', () => {
  it('identical text produces a single equal span and no changes', () => {
    const { ops, tooLargeToDiff } = diffNoteBodies('the thesis is intact', 'the thesis is intact')
    expect(tooLargeToDiff).toBe(false)
    expect(ops.every((o) => o.type === 'equal')).toBe(true)
    expect(diffHasChanges(ops)).toBe(false)
  })

  it('detects a pure addition', () => {
    const { ops } = diffNoteBodies('buy the dip', 'buy the dip carefully')
    expect(diffHasChanges(ops)).toBe(true)
    expect(reconstruct(ops, ['added'])).toContain('carefully')
    expect(reconstruct(ops, ['removed'])).toBe('')
  })

  it('detects a pure removal', () => {
    const { ops } = diffNoteBodies('buy the dip carefully', 'buy the dip')
    expect(reconstruct(ops, ['removed'])).toContain('carefully')
    expect(reconstruct(ops, ['added'])).toBe('')
  })

  it('detects a word-level change (removed + added, not a wholesale rewrite)', () => {
    const { ops } = diffNoteBodies('the setup is bullish', 'the setup is bearish')
    expect(reconstruct(ops, ['removed'])).toContain('bullish')
    expect(reconstruct(ops, ['added'])).toContain('bearish')
    // The shared prefix "the setup is " must still show as unchanged, not
    // get swallowed into a wholesale removed/added rewrite.
    expect(reconstruct(ops, ['equal'])).toContain('the setup is')
  })

  it('reconstructing OLD (equal + removed) matches the original old text', () => {
    const oldText = 'NVDA breakout above resistance confirmed'
    const newText = 'NVDA breakout above support confirmed with volume'
    const { ops } = diffNoteBodies(oldText, newText)
    expect(reconstruct(ops, ['equal', 'removed'])).toBe(oldText)
  })

  it('reconstructing NEW (equal + added) matches the new text', () => {
    const oldText = 'NVDA breakout above resistance confirmed'
    const newText = 'NVDA breakout above support confirmed with volume'
    const { ops } = diffNoteBodies(oldText, newText)
    expect(reconstruct(ops, ['equal', 'added'])).toBe(newText)
  })

  it('handles an empty old body (brand-new content)', () => {
    const { ops } = diffNoteBodies('', 'first thesis draft')
    expect(reconstruct(ops, ['added'])).toBe('first thesis draft')
    expect(ops.some((o) => o.type === 'removed')).toBe(false)
  })

  it('handles an empty new body (content fully cleared)', () => {
    const { ops } = diffNoteBodies('everything here was deleted', '')
    expect(reconstruct(ops, ['removed'])).toBe('everything here was deleted')
    expect(ops.some((o) => o.type === 'added')).toBe(false)
  })

  it('handles both bodies empty', () => {
    const { ops, tooLargeToDiff } = diffNoteBodies('', '')
    expect(tooLargeToDiff).toBe(false)
    expect(diffHasChanges(ops)).toBe(false)
  })

  it('preserves whitespace/newline structure in equal spans', () => {
    const text = 'line one\nline two'
    const { ops } = diffNoteBodies(text, text)
    expect(reconstruct(ops, ['equal'])).toBe(text)
  })

  it('merges consecutive same-type tokens into one span rather than many tiny ones', () => {
    const { ops } = diffNoteBodies('a b c d', 'w x y z')
    // Every old word is removed, every new word is added -- should collapse
    // into exactly one removed span and one added span, not 4+4.
    const removedSpans = ops.filter((o) => o.type === 'removed')
    const addedSpans = ops.filter((o) => o.type === 'added')
    expect(removedSpans.length).toBe(1)
    expect(addedSpans.length).toBe(1)
  })

  it('refuses (tooLargeToDiff) past the defensive word-count product cap', () => {
    const big = Array.from({ length: 3000 }, (_, i) => `word${i}`).join(' ')
    expect(3000 * 3000).toBeGreaterThan(DIFF_MAX_WORDS_PRODUCT)
    const { ops, tooLargeToDiff } = diffNoteBodies(big, big + ' extra')
    expect(tooLargeToDiff).toBe(true)
    expect(ops).toEqual([])
  })

  it('stays under the cap for a realistic long note (well under 2000 words each side)', () => {
    const long = Array.from({ length: 1500 }, (_, i) => `word${i}`).join(' ')
    const { tooLargeToDiff } = diffNoteBodies(long, long + ' one more word')
    expect(tooLargeToDiff).toBe(false)
  })
})

describe('diffHasChanges', () => {
  it('false for an all-equal ops list', () => {
    expect(diffHasChanges([{ type: 'equal', text: 'a' }])).toBe(false)
  })

  it('true when any non-equal op exists', () => {
    expect(diffHasChanges([{ type: 'equal', text: 'a' }, { type: 'added', text: 'b' }])).toBe(true)
  })

  it('false for an empty ops list', () => {
    expect(diffHasChanges([])).toBe(false)
  })
})
