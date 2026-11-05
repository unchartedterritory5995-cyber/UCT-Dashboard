// Audit 2026-11-05, spec S9: a note a template's Use made opens with the caret in its first field -- the first empty
// line after the template's headings -- never in the title (already named) or past everything at the end.
import { describe, it, expect } from 'vitest'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { firstFieldPos } from './firstFieldPos'

const schema = getSchema([StarterKit, TaskList, TaskItem])
const doc = (content) => schema.nodeFromJSON({ type: 'doc', content })
const h = (text) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
const p = (text) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const tasks = (...items) => ({ type: 'taskList', content: items.map((t) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(t)] })) })

/** The textblock the caret position is inside. */
const blockAt = (d, pos) => d.resolve(pos).parent

describe('firstFieldPos', () => {
  it('lands in the first empty line after a heading, past the template\'s prompts', () => {
    const d = doc([p('Pre-market plan'), h('The plan'), p('What would make today a good day?'), p(''), h('Levels'), p('')])
    const at = firstFieldPos(d)
    expect(at).not.toBeNull()
    expect(blockAt(d, at).type.name).toBe('paragraph')
    expect(blockAt(d, at).content.size).toBe(0)
    // The first empty line, not the second: it sits before the "Levels" heading.
    expect(at).toBeLessThan(d.content.size - 2)
  })

  it('an empty checklist line counts as a field', () => {
    const d = doc([h('Checklist'), tasks('Read the wire', ''), p('')])
    const at = firstFieldPos(d)
    expect(d.resolve(at).node(-1).type.name).toBe('taskItem')
  })

  it('with no heading, the first empty line anywhere; with no empty line, null (the caller goes to the end)', () => {
    const d = doc([p('A'), p(''), p('B')])
    expect(blockAt(d, firstFieldPos(d)).content.size).toBe(0)
    expect(firstFieldPos(doc([h('Only'), p('text')]))).toBeNull()
    expect(firstFieldPos(null)).toBeNull()
  })

  it('an empty heading is not a field', () => {
    const d = doc([{ type: 'heading', attrs: { level: 2 } }, p('x')])
    expect(firstFieldPos(d)).toBeNull()
  })
})
