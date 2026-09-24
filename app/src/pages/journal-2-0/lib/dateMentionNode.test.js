// Wave 6 item 7 — @date mentions: the day words, the relative label, the input
// rule on the REAL roster, the node's HTML and text, its citation text, and the
// contract with lane F's task reader (tests/fixtures_note_tasks.json +
// note_tasks.extract_tasks, run for real through tools/note_tasks_bridge.py).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Editor, generateJSON } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { buildExtensions } from './tiptap'
import { todayET } from './calendar'
import {
  addDays, dateMentionLabel, dateMentionLongLabel, isIsoDate, resolveDateWord,
} from './dateMentionNode'
import { citationText } from './askCitation'
import { REPO_ROOT, extractTasks, pythonAvailable } from './testing/exportBridge'

let editor
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })

function mount(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content } })
  return editor
}
const P = (t) => (t ? { type: 'paragraph', content: [{ type: 'text', text: t }] } : { type: 'paragraph' })

/** Type `text` one character at a time through the editor's own text-input door. */
function type(ed, text) {
  for (const ch of text) {
    const { from, to } = ed.state.selection
    const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)))
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to))
  }
}
const caretEnd = (ed) => {
  let end = null
  ed.state.doc.descendants((n, pos) => { if (n.isTextblock) end = pos + n.nodeSize - 1 })
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, end)))
}
const mentions = (ed) => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === 'dateMention') o.push(n.attrs.date) }); return o }

describe('the day words (never new Date(str))', () => {
  const THU = '2026-09-24' // a Thursday
  it.each([
    ['today', '2026-09-24'], ['tomorrow', '2026-09-25'], ['yesterday', '2026-09-23'],
    ['next monday', '2026-09-28'], ['Next  Monday', '2026-09-28'], ['monday', '2026-09-28'],
    ['next thursday', '2026-10-01'], ['friday', '2026-09-25'], ['sunday', '2026-09-27'],
    ['2026-10-02', '2026-10-02'],
  ])('%s -> %s', (word, want) => {
    expect(resolveDateWord(word, THU)).toBe(want)
  })

  it('refuses what is not a day', () => {
    for (const w of ['2026-02-30', '2026-13-01', '26-10-02', 'someday', 'next week', '', null]) {
      expect(resolveDateWord(w, THU), String(w)).toBeNull()
    }
  })

  it('crosses month, year and both DST changes by DAYS, not hours', () => {
    expect(resolveDateWord('tomorrow', '2026-12-31')).toBe('2027-01-01')
    expect(resolveDateWord('tomorrow', '2026-03-07')).toBe('2026-03-08')
    expect(resolveDateWord('tomorrow', '2026-03-08')).toBe('2026-03-09')
    expect(resolveDateWord('tomorrow', '2026-11-01')).toBe('2026-11-02')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
  })

  it('reads relative to the day it is shown on', () => {
    expect(dateMentionLabel('2026-09-24', '2026-09-24')).toBe('Today')
    expect(dateMentionLabel('2026-09-25', '2026-09-24')).toBe('Tomorrow')
    expect(dateMentionLabel('2026-09-23', '2026-09-24')).toBe('Yesterday')
    expect(dateMentionLabel('2026-10-02', '2026-09-24')).toBe('Fri Oct 2')
    expect(dateMentionLabel('2027-01-08', '2026-09-24')).toBe('Fri Jan 8, 2027')
    expect(dateMentionLongLabel('2026-10-02')).toBe('Friday, October 2, 2026')
    expect(dateMentionLabel('nope', '2026-09-24')).toBe('Date')
  })
})

describe('typing @… makes a date (the input rule, on the real roster)', () => {
  it('@tomorrow then a space becomes one date atom and the space stays', () => {
    const ed = mount([P('Earnings')])
    caretEnd(ed)
    type(ed, ' @tomorrow ')
    expect(mentions(ed)).toEqual([addDays(todayET(), 1)])
    const para = ed.state.doc.firstChild
    expect(para.textContent).toBe('Earnings  ')
    expect(para.child(1).type.name).toBe('dateMention')
  })

  it.each([
    ['@today.', 0, '.'], ['@next monday,', null, ','], ['@2026-10-02)', null, ')'],
  ])('%s keeps its punctuation', (typed, offset, punct) => {
    const ed = mount([P('x')])
    caretEnd(ed)
    type(ed, ` ${typed}`)
    const want = offset === null ? resolveDateWord(typed.slice(1, -1), todayET()) : addDays(todayET(), offset)
    expect(mentions(ed)).toEqual([want])
    expect(ed.state.doc.firstChild.lastChild.text).toBe(punct)
  })

  it('an email address, a bad date, and a code block stay text', () => {
    const ed = mount([P('mail'), { type: 'codeBlock', content: [{ type: 'text', text: 'CODE' }] }])
    let codeEnd = null
    ed.state.doc.descendants((n, pos) => { if (n.type.name === 'codeBlock') codeEnd = pos + n.nodeSize - 1 })
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, codeEnd)))
    type(ed, ' @today ')
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 5)))
    type(ed, ' me@today and @2026-02-30 ')
    expect(mentions(ed)).toEqual([])
    expect(ed.state.doc.textContent).toContain('me@today and @2026-02-30')
    expect(ed.state.doc.textContent).toContain('CODE @today ')
  })
})

describe('the node', () => {
  const M = (date) => ({ type: 'dateMention', attrs: { date } })

  it('shows the relative day, and says the full date in its title and label', () => {
    const tomorrow = addDays(todayET(), 1)
    const ed = mount([{ type: 'paragraph', content: [{ type: 'text', text: 'Due ' }, M(tomorrow)] }])
    const chip = ed.view.dom.querySelector('.uctDateMention')
    expect(chip.textContent).toBe('Tomorrow')
    expect(chip.getAttribute('data-date')).toBe(tomorrow)
    expect(chip.getAttribute('title')).toBe(dateMentionLongLabel(tomorrow))
    expect(chip.getAttribute('aria-label')).toBe(`Date: ${dateMentionLongLabel(tomorrow)}`)
  })

  it('its HTML, plain text and citation text carry the ABSOLUTE date', () => {
    const ed = mount([{ type: 'paragraph', content: [{ type: 'text', text: 'Due ' }, M('2026-10-02'), { type: 'text', text: '.' }] }])
    expect(ed.getHTML()).toContain('<span data-date="2026-10-02" data-type="date-mention">2026-10-02</span>')
    expect(ed.getText()).toBe('Due 2026-10-02.')
    expect(citationText(ed.state.doc, 0, ed.state.doc.content.size)).toBe('Due 2026-10-02.')
  })

  it('parses its own HTML back; a date that is not a real day is dropped, never guessed', () => {
    const json = generateJSON('<p><span data-type="date-mention" data-date="2026-10-02">x</span>'
      + '<span data-type="date-mention" data-date="2026-02-30">y</span></p>', buildExtensions())
    expect(json.content[0].content).toEqual([M('2026-10-02'), M(null)])
    expect(isIsoDate('2026-02-30')).toBe(false)
  })
})

describe('⭐ the contract with lane F (tasks read a dateMention as the due date)', () => {
  const FIXTURE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tests/fixtures_note_tasks.json'), 'utf8'))

  it('the node the editor makes has EXACTLY the fixture\'s shape', () => {
    const inFixture = []
    const walk = (n) => { if (n && typeof n === 'object') { if (n.type === 'dateMention') inFixture.push(n); (n.content || []).forEach(walk) } }
    FIXTURE.cases.forEach((c) => walk(c.doc))
    expect(inFixture.length).toBeGreaterThan(0)
    const ed = mount([P('x')])
    caretEnd(ed)
    type(ed, ' @2026-09-25 ')
    let made = null
    ed.getJSON().content[0].content.forEach((n) => { if (n.type === 'dateMention') made = n })
    expect(Object.keys(made).sort()).toEqual(Object.keys(inFixture[0]).sort())
    expect(Object.keys(made.attrs)).toEqual(Object.keys(inFixture[0].attrs))
  })

  it.runIf(pythonAvailable())('a date TYPED into a task is read by note_tasks.extract_tasks as its due date', () => {
    const ed = mount([{ type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked: false }, content: [P('Earnings prep')] },
      { type: 'taskItem', attrs: { checked: false }, content: [P('No date')] },
    ] }])
    const first = ed.state.doc.firstChild.firstChild
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 2 + first.firstChild.nodeSize - 1)))
    type(ed, ' @tomorrow ')
    const tasks = extractTasks(ed.getJSON())
    expect(tasks.map((t) => t.due)).toEqual([addDays(todayET(), 1), null])
    expect(tasks[0].text.replace(/\s+/g, ' ').trim()).toBe('Earnings prep')
  })
})
