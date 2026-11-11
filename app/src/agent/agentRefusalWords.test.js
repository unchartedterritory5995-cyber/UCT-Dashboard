// A refusal reads as one sentence: the prefix is said once, however whole the reason already was.
import { describe, it, expect, vi } from 'vitest'
import { refusalText } from './useAgent'
import { refusalSentence } from './capabilities/indicatorEdits'
import { REASONS } from '../components/chart/builder/agentMutations'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

describe('refusalText', () => {
  it('a whole sentence is not wrapped in a second prefix or left with a second ending', () => {
    const reason = refusalSentence({ reason: REASONS.BAD_INPUT, detail: { why: 'Relative Strength Index has no line width setting', options: [] } }, { op: 'setAppearance' })
    expect(reason).toBe("I didn't change it: Relative Strength Index has no line width setting. Nothing was changed.")
    expect(refusalText([{ reason }])).toBe("I didn't change anything: Relative Strength Index has no line width setting.")
  })
  it('the curly apostrophe and the add wording read the same', () => {
    expect(refusalText([{ reason: 'I didn’t add it: that is not valid. Nothing has changed.' }])).toBe("I didn't change anything: that is not valid.")
  })
  it('a plain reason is untouched', () => {
    expect(refusalText([{ reason: 'Save the layout on its own, then ask for any other changes.' }])).toBe("I didn't change anything: Save the layout on its own, then ask for any other changes.")
  })
  it('two reasons that differ only by the wrapper are one reason', () => {
    expect(refusalText([{ reason: "I didn't change it: x. Nothing was changed." }, { reason: 'x.' }])).toBe("I didn't change anything: x.")
  })
  it('several reasons stay a list', () => {
    expect(refusalText([{ reason: 'a' }, { reason: 'b' }])).toBe("I didn't change anything:\n- a\n- b")
  })
})
