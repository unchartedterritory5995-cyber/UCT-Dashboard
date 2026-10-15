// Tier 2 part B, item 12 (R-T2B-12): "/remind" makes an unticked task holding "Follow up " and opens
// the EXISTING @ date list; runDateCommand stays the one inserter of the date. On the real roster.
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { dateSuggestPluginKey, runDateCommand } from './dateSuggest'
import { insertReminder, REMINDER_LEAD } from './reminderItem'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const para = (text) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const task = (text) => ({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [para(text)] }] })

describe('insertReminder', () => {
  let editor
  afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })
  function mount(...blocks) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content: blocks } })
    editor.commands.focus('end', { scrollIntoView: false })
    return editor
  }
  const tasks = (ed) => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === 'taskItem') o.push({ checked: n.attrs.checked, text: n.textContent, dates: (() => { const d = []; n.descendants((c) => { if (c.type.name === 'dateMention') d.push(c.attrs.date) }); return d })() }) }); return o }
  const typedRange = (ed, s) => { const to = ed.state.selection.from; return { from: to - s.length, to } }

  it('on an empty line: one unticked task holding the lead, and the date list open', () => {
    const ed = mount(para(''))
    ed.commands.insertContent('/remind')
    expect(insertReminder(ed, typedRange(ed, '/remind'))).toBe(true)
    expect(tasks(ed)).toEqual([{ checked: false, text: `${REMINDER_LEAD}@`, dates: [] }])
    expect(dateSuggestPluginKey.getState(ed.state).active).toBe(true)
  })
  it('the date goes in through runDateCommand, inside the task\'s own paragraph', () => {
    const ed = mount(para(''))
    ed.commands.insertContent('/remind')
    insertReminder(ed, typedRange(ed, '/remind'))
    const s = dateSuggestPluginKey.getState(ed.state)
    expect(runDateCommand(ed, { date: '2026-10-21' }, s.range)).toBe(true)
    const t = tasks(ed)
    expect(t).toHaveLength(1)
    expect(t[0].checked).toBe(false)
    expect(t[0].dates).toEqual(['2026-10-21'])
    expect(t[0].text.startsWith(REMINDER_LEAD.trim())).toBe(true)
    expect(t[0].text).not.toContain('@')
    expect(dateSuggestPluginKey.getState(ed.state).active).toBe(false)
  })
  it('on a line with words, the words stay and the task goes on its own line', () => {
    const ed = mount(para('Buy ORCL '))
    ed.commands.insertContent('/remind')
    insertReminder(ed, typedRange(ed, '/remind'))
    expect(ed.state.doc.firstChild.type.name).toBe('paragraph')
    expect(ed.state.doc.firstChild.textContent).toBe('Buy ORCL ')
    expect(tasks(ed).map((t) => t.text)).toEqual([`${REMINDER_LEAD}@`])
  })
  it('with the caret on the trailing line after a task list, the task goes on its own line (the not-in-a-task path)', () => {
    const ed = mount(task('Call broker '))
    ed.commands.insertContent('/remind')
    insertReminder(ed, typedRange(ed, '/remind'))
    expect(tasks(ed).map((t) => t.text)).toEqual(['Call broker ', `${REMINDER_LEAD}@`])
  })
  // The two tests above that mount a task LAST leave the caret on the trailing paragraph the editor keeps
  // after a list (`focus('end')`), so they exercise the toggleTaskList path, not splitListItem. These put
  // the caret really inside the task's own line.
  const caretAtEndOfTaskText = (ed) => {
    let at = -1
    ed.state.doc.descendants((n, pos) => { if (n.isText && at < 0) at = pos + n.nodeSize })
    ed.commands.setTextSelection(at)
  }
  it('with the caret really inside a task that has words, the new task is a sibling item of the same list', () => {
    const ed = mount(task('Call broker '))
    caretAtEndOfTaskText(ed)
    expect(ed.isActive('taskItem')).toBe(true)
    ed.commands.insertContent('/remind')
    expect(insertReminder(ed, typedRange(ed, '/remind'))).toBe(true)
    expect(tasks(ed)).toEqual([
      { checked: false, text: 'Call broker ', dates: [] },
      { checked: false, text: `${REMINDER_LEAD}@`, dates: [] },
    ])
    expect(ed.state.doc.firstChild.type.name).toBe('taskList')
    expect(ed.state.doc.firstChild.childCount).toBe(2)
    expect(dateSuggestPluginKey.getState(ed.state).active).toBe(true)
  })
  it('with the caret inside an empty task, the task itself takes the lead (no second task)', () => {
    const ed = mount(task(''))
    ed.commands.focus('start', { scrollIntoView: false })
    expect(ed.isActive('taskItem')).toBe(true)
    ed.commands.insertContent('/remind')
    insertReminder(ed, typedRange(ed, '/remind'))
    expect(tasks(ed)).toEqual([{ checked: false, text: `${REMINDER_LEAD}@`, dates: [] }])
  })
  // M8 (final review): pin TODAY's behaviour in two blocks the other cases skip. Whatever the real roster does is
  // what is asserted; the names say what that is. Not a design statement: a change here must be a decision.
  const blockTypes = (ed) => ed.getJSON().content.map((n) => n.type)
  it('inside a bullet-list item: the item becomes a task in place (toggleTaskList converts the list), nothing nests', () => {
    const ed = mount({ type: 'bulletList', content: [{ type: 'listItem', content: [para('')] }] })
    ed.commands.setTextSelection(3)
    expect(ed.isActive('bulletList')).toBe(true)
    ed.commands.insertContent('/remind')
    expect(insertReminder(ed, typedRange(ed, '/remind'))).toBe(true)
    expect(blockTypes(ed)).toEqual(['taskList', 'paragraph']) // the editor's trailing paragraph follows any list
    expect(tasks(ed)).toEqual([{ checked: false, text: `${REMINDER_LEAD}@`, dates: [] }])
    expect(ed.isActive('bulletList')).toBe(false)
    expect(dateSuggestPluginKey.getState(ed.state).active).toBe(true)
  })
  it('inside a bullet-list item with words: the words stay in the bullet and the task is NESTED inside that same bullet item, after them', () => {
    const ed = mount({ type: 'bulletList', content: [{ type: 'listItem', content: [para('Call broker ')] }] })
    ed.commands.setTextSelection(15) // the end of "Call broker "
    expect(ed.isActive('bulletList')).toBe(true)
    ed.commands.insertContent('/remind')
    expect(insertReminder(ed, typedRange(ed, '/remind'))).toBe(true)
    expect(tasks(ed)).toEqual([{ checked: false, text: `${REMINDER_LEAD}@`, dates: [] }])
    const bullets = ed.state.doc.firstChild
    expect(bullets.type.name).toBe('bulletList')
    expect(bullets.childCount).toBe(1) // still ONE bullet item, no sibling
    const item = bullets.firstChild
    expect(item.childCount).toBe(2)
    expect(item.child(0).textContent).toBe('Call broker ')
    expect(item.child(1).type.name).toBe('taskList')
  })
  it('on an empty heading line: the heading line is turned into the task (the heading is replaced, not kept above it)', () => {
    const ed = mount({ type: 'heading', attrs: { level: 2 } })
    ed.commands.setTextSelection(1)
    expect(ed.isActive('heading')).toBe(true)
    ed.commands.insertContent('/remind')
    expect(insertReminder(ed, typedRange(ed, '/remind'))).toBe(true)
    expect(blockTypes(ed)).not.toContain('heading')
    expect(tasks(ed)).toEqual([{ checked: false, text: `${REMINDER_LEAD}@`, dates: [] }])
  })
  it('in a heading that has words: the heading keeps its words and the task goes on its own line after it', () => {
    const ed = mount({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan ' }] })
    ed.commands.setTextSelection(6)
    expect(ed.isActive('heading')).toBe(true)
    ed.commands.insertContent('/remind')
    expect(insertReminder(ed, typedRange(ed, '/remind'))).toBe(true)
    expect(ed.state.doc.firstChild.type.name).toBe('heading')
    expect(ed.state.doc.firstChild.textContent).toBe('Plan ')
    expect(tasks(ed).map((t) => t.text)).toEqual([`${REMINDER_LEAD}@`])
  })
  it('adds no node, mark or attribute', () => {
    const ed = mount(para(''))
    expect(Object.keys(ed.schema.nodes)).not.toContain('reminder')
    expect(Object.keys(ed.schema.nodes.dateMention.spec.attrs)).toEqual(['date'])
  })
})
