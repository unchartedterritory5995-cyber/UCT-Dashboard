// W1 (Tier 2 part B final wave): the `@` date list inside a TASK, on the REAL roster (buildExtensions).
// TipTap builds plugins from the REVERSED extension list, so DateSuggest listed BEFORE TaskItem lost
// Enter to TaskItem's keymap (splitListItem): "@" inside a task + ArrowDown + Enter split the task and
// picked no date. The position in buildExtensions() is the fix; these cases are its rail. Driven as a
// member drives it: type, wait for the drawn list, press the keys through the view.
import { describe, it, expect, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { EditorContent } from '@tiptap/react'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { todayET } from './calendar'
import { dateSuggestPluginKey } from './dateSuggest'
import { REMINDER_LEAD } from './reminderItem'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const para = (text) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const task = (text) => ({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [para(text)] }] })

describe('the date list inside a task, on the real roster', () => {
  let editor
  afterEach(() => { cleanup(); editor?.destroy(); editor = null; document.body.innerHTML = '' })

  function mount(...blocks) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content: blocks } })
    render(createElement(EditorContent, { editor }))
    return editor
  }
  const press = (ed, key) => ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key })))
  const mentions = (ed) => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === 'dateMention') o.push(n.attrs.date) }); return o }
  const taskItems = (ed) => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === 'taskItem') o.push({ text: n.textContent, dates: (() => { const d = []; n.descendants((c) => { if (c.type.name === 'dateMention') d.push(c.attrs.date) }); return d })() }) }); return o }
  const listMounted = () => [...document.body.children].some((el) => el.style?.position === 'fixed' && el.querySelector('.react-renderer'))
  const waitForList = async () => {
    await act(async () => { for (let i = 0; i < 300 && !listMounted(); i += 1) await new Promise((r) => setTimeout(r, 10)) })
    expect(document.getElementById('uct-date-suggest')).not.toBeNull() // non-vacuity: the list IS drawn
  }
  const caretAtEndOfTaskText = (ed) => {
    let at = -1
    ed.state.doc.descendants((n, pos) => { if (n.isText && at < 0) at = pos + n.nodeSize })
    ed.commands.setTextSelection(at)
  }

  it('"@" typed inside an existing task, ArrowDown, Enter: ONE date in that task, and still ONE task', async () => {
    const ed = mount(task('Call broker '))
    caretAtEndOfTaskText(ed)
    expect(ed.isActive('taskItem')).toBe(true) // non-vacuity: the caret is really inside the task
    await act(async () => { ed.commands.insertContent('@') })
    expect(dateSuggestPluginKey.getState(ed.state).active).toBe(true)
    await waitForList()
    await act(async () => { expect(press(ed, 'ArrowDown')).toBe(true) })
    await act(async () => { expect(press(ed, 'Enter')).toBe(true) })
    expect(mentions(ed)).toEqual([todayET()])
    expect(taskItems(ed)).toEqual([{ text: 'Call broker  ', dates: [todayET()] }])
    expect(ed.state.doc.firstChild.type.name).toBe('taskList')
    expect(ed.state.doc.firstChild.childCount).toBe(1)
  })

  it('"/remind" from the slash menu, then ArrowDown and Enter on the date list: one task holding the lead and a date', async () => {
    const ed = mount(para(''))
    ed.commands.focus('end', { scrollIntoView: false })
    await act(async () => { ed.commands.insertContent('/remind') })
    await waitFor(() => expect(document.getElementById('uct-slash-menu')).not.toBeNull())
    // The slash menu starts on its first row, "remind" (it ranks first for "remind"): Enter takes it.
    await act(async () => { expect(press(ed, 'Enter')).toBe(true) })
    expect(dateSuggestPluginKey.getState(ed.state).active).toBe(true) // the slash item opened the date list
    await waitForList()
    await act(async () => { expect(press(ed, 'ArrowDown')).toBe(true) })
    await act(async () => { expect(press(ed, 'Enter')).toBe(true) })
    expect(mentions(ed)).toEqual([todayET()])
    const items = taskItems(ed)
    expect(items).toHaveLength(1)
    expect(items[0].text.startsWith(REMINDER_LEAD.trim())).toBe(true)
    expect(items[0].text).toContain('Follow up')
    expect(items[0].dates).toEqual([todayET()])
  })

  it('outside a task, "@" + ArrowDown + Enter still picks the date (the move cost nothing there)', async () => {
    const ed = mount(para('Due '))
    ed.commands.focus('end', { scrollIntoView: false })
    await act(async () => { ed.commands.insertContent('@') })
    await waitForList()
    await act(async () => { press(ed, 'ArrowDown') })
    await act(async () => { press(ed, 'Enter') })
    expect(mentions(ed)).toEqual([todayET()])
    expect(ed.getJSON().content.map((n) => n.type)).toEqual(['paragraph'])
  })
})
