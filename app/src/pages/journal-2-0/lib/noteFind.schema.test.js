import { describe, it, expect } from 'vitest'
import { getSchema, Node } from '@tiptap/core'
import { buildExtensions } from './tiptap'

// ─────────────────────────────────────────────────────────────────────────
// noteFind's FLAG PARITY RESTS ON A SCHEMA FACT: EVERY INLINE NODE IS A LEAF.
//
// makeFlagSplitAt (noteFind.js) decides whether a match boundary splits a
// country flag by reading the textblock ONCE with
// `doc.textBetween(start, end, '\n', '\n')` and indexing the result by
// `pos - start`. That index is only a document position while each position
// inside a textblock is exactly one character: a text node's code units, and
// an inline LEAF read as one '\n'. An inline node WITH CONTENT (a wrapper
// holding text) spends two positions on its own open and close that
// textBetween never emits, so every offset after it is off by two and the
// parity answer belongs to the wrong character -- silently: find still runs,
// it just matches inside a flag or refuses a clean one.
//
// Wave-5 re-review, round 4 (concern 4). Today every inline type is a leaf
// (text, hardBreak, videoTimestamp, noteLink, inlineMath, askCitation). This
// pins it, so the day someone adds an inline node with content the failure
// names the code that must change with it.
// ─────────────────────────────────────────────────────────────────────────

const nonLeafInlineTypes = (schema) => Object.values(schema.nodes)
  .filter((type) => type.isInline && !type.isLeaf)
  .map((type) => type.name)

// An inline node that HOLDS text -- the shape the rail exists to refuse.
const FakeInlineWrapper = Node.create({
  name: 'fakeInlineWrapper',
  group: 'inline',
  inline: true,
  content: 'text*',
})

const WHY = 'noteFind.js makeFlagSplitAt reads a textblock with textBetween and '
  + 'indexes it by document position, which is only valid while every inline node '
  + 'is a leaf (one position, one character). An inline node with content shifts '
  + 'every offset after it: change the flag parity to walk positions before '
  + 'adding one.'

describe("the editor schema keeps noteFind's flag parity valid", () => {
  it('every inline node type in the real editor schema is a leaf', () => {
    const schema = getSchema(buildExtensions())
    expect(nonLeafInlineTypes(schema), WHY).toEqual([])
  })

  it('non-vacuity: the probe reads the real editor schema, inline types included', () => {
    const schema = getSchema(buildExtensions())
    const inline = Object.values(schema.nodes).filter((t) => t.isInline).map((t) => t.name)
    expect(inline).toEqual(expect.arrayContaining(['text', 'hardBreak', 'inlineMath', 'askCitation']))
    // ...and in it, positions and textBetween characters agree one for one
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' },
      ] }],
    })
    const para = doc.firstChild
    expect(doc.textBetween(1, 1 + para.content.size, '\n', '\n')).toHaveLength(para.content.size)
  })

  it('control: an inline node with content IS caught, and it IS what breaks the parity', () => {
    const schema = getSchema([...buildExtensions(), FakeInlineWrapper])
    expect(nonLeafInlineTypes(schema)).toEqual(['fakeInlineWrapper'])
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'x' },
        { type: 'fakeInlineWrapper', content: [{ type: 'text', text: 'ab' }] },
        { type: 'text', text: 'y' },
      ] }],
    })
    const para = doc.firstChild
    // six positions, four characters: `pos - start` no longer indexes the text
    expect(para.content.size).toBe(6)
    expect(doc.textBetween(1, 1 + para.content.size, '\n', '\n')).toBe('xaby')
  })
})
