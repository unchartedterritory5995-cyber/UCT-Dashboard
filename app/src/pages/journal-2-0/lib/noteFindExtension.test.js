import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { NoteFind } from './noteFindExtension'

const EXT = [StarterKit, NoteFind]

let editor
afterEach(() => { editor?.destroy(); editor = null })

function mount(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: EXT, content })
  return editor.view.dom
}

describe('NoteFind extension', () => {
  it('noteFindSet highlights every match with the DOM decoration class', () => {
    const dom = mount('<p>buy the dip, buy the breakout</p>')
    editor.commands.noteFindSet('buy')
    const hits = dom.querySelectorAll('.uct-find-match')
    expect(hits.length).toBe(2)
  })

  it('the first match is marked active by default', () => {
    const dom = mount('<p>buy the dip, buy the breakout</p>')
    editor.commands.noteFindSet('buy')
    const active = dom.querySelectorAll('.uct-find-match-active')
    expect(active.length).toBe(1)
  })

  it('noteFindNext advances the active match, cycling back to the first', () => {
    mount('<p>buy the dip, buy the breakout, buy more</p>')
    editor.commands.noteFindSet('buy')
    expect(editor.storage.noteFind.activeIndex).toBe(0)
    editor.commands.noteFindNext()
    expect(editor.storage.noteFind.activeIndex).toBe(1)
    editor.commands.noteFindNext()
    expect(editor.storage.noteFind.activeIndex).toBe(2)
    editor.commands.noteFindNext()
    expect(editor.storage.noteFind.activeIndex).toBe(0) // wraps
  })

  it('noteFindPrev moves backward, wrapping to the last match', () => {
    mount('<p>buy buy buy</p>')
    editor.commands.noteFindSet('buy')
    editor.commands.noteFindPrev()
    expect(editor.storage.noteFind.activeIndex).toBe(2) // wraps to last
  })

  it('noteFindClear removes all decorations and resets storage', () => {
    const dom = mount('<p>buy the dip</p>')
    editor.commands.noteFindSet('buy')
    expect(dom.querySelectorAll('.uct-find-match').length).toBe(1)
    editor.commands.noteFindClear()
    expect(dom.querySelectorAll('.uct-find-match').length).toBe(0)
    expect(editor.storage.noteFind.term).toBe('')
    expect(editor.storage.noteFind.matches).toEqual([])
  })

  it('a term with zero matches leaves activeIndex at -1 and next/prev are safe no-ops', () => {
    mount('<p>the capex thesis</p>')
    editor.commands.noteFindSet('nonexistent')
    expect(editor.storage.noteFind.activeIndex).toBe(-1)
    expect(() => editor.commands.noteFindNext()).not.toThrow()
    expect(editor.storage.noteFind.activeIndex).toBe(-1)
  })

  it('re-searching (noteFindSet again) replaces the previous highlight set', () => {
    const dom = mount('<p>buy the dip and sell the rip</p>')
    editor.commands.noteFindSet('buy')
    expect(dom.querySelectorAll('.uct-find-match').length).toBe(1)
    editor.commands.noteFindSet('sell')
    const hits = dom.querySelectorAll('.uct-find-match')
    expect(hits.length).toBe(1)
    expect(hits[0].textContent).toBe('sell')
  })

  it('decorations are never written into saved content (getJSON/getHTML stay clean)', () => {
    mount('<p>buy the dip</p>')
    const before = editor.getJSON()
    editor.commands.noteFindSet('buy')
    const after = editor.getJSON()
    expect(after).toEqual(before)
    expect(editor.getHTML()).not.toContain('uct-find-match')
  })

  it('editing the document while find is open does not crash (decorations re-map)', () => {
    mount('<p>buy the dip</p>')
    editor.commands.noteFindSet('buy')
    expect(() => {
      editor.commands.insertContentAt(0, 'X')
    }).not.toThrow()
  })

  it('is case-insensitive end-to-end through the live editor', () => {
    const dom = mount('<p>NVDA breakout</p>')
    editor.commands.noteFindSet('nvda')
    expect(dom.querySelectorAll('.uct-find-match').length).toBe(1)
  })
})
