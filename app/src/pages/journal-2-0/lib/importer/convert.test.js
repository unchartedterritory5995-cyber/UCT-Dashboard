import { describe, it, expect } from 'vitest'
import { sanitizeHtml, htmlToNote } from './convert'

describe('sanitizeHtml', () => {
  it('strips scripts, event handlers, and javascript: URLs', () => {
    const out = sanitizeHtml(
      '<p onclick="x()">hi</p><script>evil()</script><a href="javascript:alert(1)">z</a>')
    expect(out).not.toContain('script')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('hi')
  })

  it('removes scripts from SVG/MathML foreign content', () => {
    const out = sanitizeHtml('<svg><script>alert(2)</script></svg>')
    expect(out.toLowerCase()).not.toContain('script')
  })
})

describe('htmlToNote', () => {
  it('converts GFM checkbox HTML into real taskItems with state', () => {
    const { bodyJson } = htmlToNote(
      '<ul class="contains-task-list">' +
      '<li class="task-list-item"><input type="checkbox" checked> done</li>' +
      '<li class="task-list-item"><input type="checkbox"> todo</li></ul>')
    const list = bodyJson.content[0]
    expect(list.type).toBe('taskList')
    expect(list.content[0].attrs.checked).toBe(true)
    expect(list.content[1].attrs.checked).toBe(false)
  })

  it('keeps tables and produces searchable plain text', () => {
    const { bodyJson, bodyPlain } = htmlToNote(
      '<h1>Title</h1><table><tr><td>alpha</td></tr></table>')
    expect(bodyJson.content.map((n) => n.type)).toEqual(['heading', 'table'])
    expect(bodyPlain).toContain('alpha')
  })

  it('converts label-wrapped checkboxes to taskItems with correct state', () => {
    const { bodyJson } = htmlToNote(
      '<ul class="contains-task-list">' +
      '<li class="task-list-item"><label><input type="checkbox" checked>done task</label></li>' +
      '<li class="task-list-item"><label><input type="checkbox">todo task</label></li></ul>')
    const list = bodyJson.content[0]
    expect(list.type).toBe('taskList')
    expect(list.content[0].attrs.checked).toBe(true)
    expect(list.content[1].attrs.checked).toBe(false)
  })
})
