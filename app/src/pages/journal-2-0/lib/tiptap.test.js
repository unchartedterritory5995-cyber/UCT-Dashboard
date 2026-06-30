import { describe, it, expect } from 'vitest'
import { buildExtensions, extractPlainText } from './tiptap'

describe('tiptap config', () => {
  it('registers the videoTimestamp node', () => {
    const names = buildExtensions().map((e) => e.name)
    expect(names).toContain('videoTimestamp')
  })

  it('extractPlainText renders a videoTimestamp as [m:ss]', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'videoTimestamp', attrs: { seconds: 75 } }, { type: 'text', text: ' note' }],
      }],
    }
    expect(extractPlainText(doc)).toBe('[1:15]  note')
  })
})
