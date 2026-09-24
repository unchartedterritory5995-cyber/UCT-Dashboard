// Tasks across notes — the client half. The ordinal walk is held to the SAME
// fixture the server's extractor is (tests/fixtures_note_tasks.json), so the
// row a member clicks and the task the editor scrolls to cannot disagree.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Schema, Node as PMNode } from '@tiptap/pm/model'
import {
  TASK_GROUPS, noteTaskPath, taskIndexFromParams, dueBucket, dueLabel, groupTasks,
  taskIndexesFromJson, findTaskItemPos,
} from './noteTasks'

const REPO = path.resolve(__dirname, '../../../../..')
const FIXTURE = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures_note_tasks.json'), 'utf8'))

// The node shapes the fixture uses, as a real ProseMirror schema — so
// `findTaskItemPos` is exercised over a real document, not a stand-in.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    heading: { attrs: { level: { default: 1 } }, content: 'inline*', group: 'block' },
    text: { group: 'inline' },
    // leafText mirrors the server, which reads both atoms as a space.
    hardBreak: { inline: true, group: 'inline', leafText: () => ' ' },
    dateMention: { inline: true, atom: true, group: 'inline', attrs: { date: { default: null } }, leafText: () => ' ' },
    bulletList: { content: 'listItem+', group: 'block' },
    listItem: { content: 'paragraph block*' },
    taskList: { content: 'taskItem+', group: 'block' },
    taskItem: { content: 'paragraph block*', attrs: { checked: { default: false } } },
  },
  marks: { bold: {} },
})

describe('the ordinal contract, over the shared fixture', () => {
  it('the fixture is read and is not vacuous', () => {
    expect(FIXTURE.cases.length).toBeGreaterThan(3)
    expect(FIXTURE.cases.some((c) => c.expected.length > 2)).toBe(true)
  })

  for (const c of FIXTURE.cases) {
    it(`JSON walk: ${c.name}`, () => {
      const got = taskIndexesFromJson(c.doc)
      expect(got).toEqual(c.expected.map(({ index, checked, depth }) => ({ index, checked, depth })))
    })

    it(`editor position: ${c.name}`, () => {
      const doc = PMNode.fromJSON(schema, c.doc)
      c.expected.forEach((t) => {
        const pos = findTaskItemPos(doc, t.index)
        expect(pos, `task ${t.index}`).not.toBeNull()
        const node = doc.nodeAt(pos)
        expect(node.type.name).toBe('taskItem')
        expect(node.attrs.checked).toBe(t.checked)
        // The node's OWN first paragraph is the text the server extracted.
        expect(node.firstChild.textContent.replace(/\s+/g, ' ').trim()).toBe(t.text)
      })
      expect(findTaskItemPos(doc, c.expected.length)).toBeNull()
    })
  }
})

describe('findTaskItemPos guards', () => {
  it('answers null for anything that is not a doc or a real index', () => {
    const doc = PMNode.fromJSON(schema, FIXTURE.cases[0].doc)
    expect(findTaskItemPos(null, 0)).toBeNull()
    expect(findTaskItemPos(doc, -1)).toBeNull()
    expect(findTaskItemPos(doc, 1.5)).toBeNull()
  })
})

describe('deep link', () => {
  it('opens the note at a task, and reads the index back', () => {
    expect(noteTaskPath('n 1', 3)).toBe('/journal/notebook?note=n%201&task=3')
    expect(noteTaskPath('n1', undefined)).toBe('/journal/notebook?note=n1')
    const p = new URLSearchParams('note=n1&task=3')
    expect(taskIndexFromParams(p)).toBe(3)
    expect(taskIndexFromParams(new URLSearchParams('task=-1'))).toBeNull()
    expect(taskIndexFromParams(new URLSearchParams('task=abc'))).toBeNull()
    expect(taskIndexFromParams(new URLSearchParams(''))).toBeNull()
  })
})

describe('due dates', () => {
  const today = '2026-09-23'

  it('buckets like the server', () => {
    expect(dueBucket('2026-09-20', today)).toBe('overdue')
    expect(dueBucket('2026-09-23', today)).toBe('today')
    expect(dueBucket('2026-09-24', today)).toBe('upcoming')
    expect(dueBucket(null, today)).toBe('none')
    expect(dueBucket('2026-02-30', today)).toBe('none')     // an impossible date is no date
  })

  it('labels in plain words, never shifted a day by a UTC reading', () => {
    expect(dueLabel('2026-09-23', today)).toBe('Due today')
    expect(dueLabel('2026-09-24', today)).toBe('Due tomorrow')
    expect(dueLabel('2026-09-22', today)).toBe('Due yesterday')
    expect(dueLabel('2026-09-20', today)).toBe('3 days overdue')
    expect(dueLabel('2026-09-25', today)).toBe('Due Fri, Sep 25')
    expect(dueLabel(null, today)).toBe('')
  })

  it('groups in the four fixed groups, keeping the order it was given', () => {
    const tasks = [
      { text: 'a', due: '2026-09-25', bucket: 'upcoming' },
      { text: 'b', due: '2026-09-01', bucket: 'overdue' },
      { text: 'c', due: null, bucket: 'none' },
      { text: 'd', due: '2026-09-23' },                         // no bucket: derived
      { text: 'e', due: '2026-09-02', bucket: 'overdue' },
    ]
    const g = groupTasks(tasks, today)
    expect(g.overdue.map((t) => t.text)).toEqual(['b', 'e'])
    expect(g.today.map((t) => t.text)).toEqual(['d'])
    expect(g.upcoming.map((t) => t.text)).toEqual(['a'])
    expect(g.none.map((t) => t.text)).toEqual(['c'])
    expect(TASK_GROUPS.map((x) => x.label)).toEqual(['Overdue', 'Today', 'Upcoming', 'No date'])
  })
})
