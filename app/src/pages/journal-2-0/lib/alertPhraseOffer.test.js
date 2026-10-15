// app/src/pages/journal-2-0/lib/alertPhraseOffer.test.js
// Tier 2 part A, item 8: the offer behind the "Set alert" chip. The plugin sits on the TYPING PATH, so
// half of this file is about what it does NOT do: allocate when nothing it reads changed, run when
// the switch is off, or take a key a suggestion menu should see first.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { SuggestionPluginKey } from '@tiptap/suggestion'

vi.mock('./smartChipsFlag', () => ({ smartChipsEnabled: vi.fn(() => true) }))
import { smartChipsEnabled } from './smartChipsFlag'
import { ALERT_OFFER_EVENT, AlertPhraseOffer, alertPhraseKey, dismissAlertOffer } from './alertPhraseOffer'
import { buildExtensions } from './tiptap'

// jsdom has no Range geometry; the slash popup positions itself off the caret.
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

let editor
const make = (html = '<p></p>') => {
  editor = new Editor({ extensions: [StarterKit, AlertPhraseOffer], content: html })
  return editor
}
const offer = () => alertPhraseKey.getState(editor.state).offer
const typeAtEnd = (text) => { editor.commands.focus('end'); editor.commands.insertContent(text) }

beforeEach(() => { smartChipsEnabled.mockReturnValue(true) })
afterEach(() => { editor?.destroy(); editor = null })

describe('the alert offer', () => {
  it('appears for the caret paragraph once the sentence parses', () => {
    make(); typeAtEnd('alert me if NVDA closes below 12')
    const first = offer()
    typeAtEnd('0')
    expect(offer()).toMatchObject({ parsed: { symbol: 'NVDA', price: 120 } })
    expect(offer()).not.toBe(first)
  })
  it('keeps the SAME state object while nothing it reads changes (the menu bails on identity)', () => {
    make('<p>alert me if NVDA closes below 120</p><p>other</p>')
    editor.commands.setTextSelection(5)
    const s1 = alertPhraseKey.getState(editor.state)
    editor.commands.setTextSelection(6)
    // The menu's reducer bails on the STATE object, so that is what is pinned (a copy would keep `.offer`).
    expect(alertPhraseKey.getState(editor.state)).toBe(s1)
    expect(alertPhraseKey.getState(editor.state).offer).toBe(s1.offer)
  })
  it('a paragraph without the word costs one identity return', () => {
    make(); typeAtEnd('just some notes')
    const s1 = alertPhraseKey.getState(editor.state)
    typeAtEnd(' more')
    expect(alertPhraseKey.getState(editor.state)).toBe(s1)
  })
  it('goes away when the caret leaves the paragraph', () => {
    make('<p>alert me if NVDA closes below 120</p><p>other</p>')
    editor.commands.setTextSelection(5); expect(offer()).not.toBeNull()
    editor.commands.setTextSelection(editor.state.doc.content.size - 1); expect(offer()).toBeNull()
  })
  it('a dismissed sentence is not offered again until its text changes', () => {
    make(); typeAtEnd('alert me if NVDA closes below 120')
    dismissAlertOffer(editor); expect(offer()).toBeNull()
    editor.commands.setTextSelection(3); expect(offer()).toBeNull()
    typeAtEnd('.5'); expect(offer()).not.toBeNull()
  })
  it('Escape dismisses; Alt+Enter dispatches the open event on the editor DOM', () => {
    make(); typeAtEnd('alert me if NVDA closes below 120')
    const seen = vi.fn(); editor.view.dom.addEventListener(ALERT_OFFER_EVENT, seen)
    editor.view.someProp('handleKeyDown', (f) => f(editor.view, new KeyboardEvent('keydown', { key: 'Enter', altKey: true })))
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0][0].detail).toMatchObject({ parsed: { symbol: 'NVDA', price: 120 } })
    editor.view.someProp('handleKeyDown', (f) => f(editor.view, new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(offer()).toBeNull()
  })
  it('plain Enter is never taken', () => {
    make(); typeAtEnd('alert me if NVDA closes below 120')
    // ⛔ Asked of THIS plugin's own handler, not of `someProp`: across the whole stack a plain Enter IS
    // taken -- by StarterKit's split-block keymap, which is how a paragraph ends (dateSuggest's rule:
    // ENTER ENDS A LINE). The question here is whether the OFFER takes it, and it must not.
    const plugin = editor.state.plugins.find((p) => p.spec.key === alertPhraseKey)
    expect(offer()).not.toBeNull()   // control: the offer is showing, so a "false" below is a refusal, not a no-op
    const key = (init) => plugin.props.handleKeyDown(editor.view, new KeyboardEvent('keydown', init))
    expect(key({ key: 'Enter' })).toBe(false)
    expect(key({ key: 'Enter', shiftKey: true })).toBe(false)
    expect(key({ key: 'Enter', altKey: true, shiftKey: true })).toBe(false)
    expect(key({ key: 'Enter', altKey: true, ctrlKey: true })).toBe(false)
    expect(key({ key: 'Enter', altKey: true, metaKey: true })).toBe(false)
    expect(key({ key: 'Enter', altKey: true })).toBe(true)   // control: the one chord it does take
  })
  it('with no offer showing it takes no key at all', () => {
    make(); typeAtEnd('just some notes')
    const plugin = editor.state.plugins.find((p) => p.spec.key === alertPhraseKey)
    expect(plugin.props.handleKeyDown(editor.view, new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(false)
    expect(plugin.props.handleKeyDown(editor.view, new KeyboardEvent('keydown', { key: 'Enter', altKey: true }))).toBe(false)
  })
  it('switch off: no offer, ever', () => {
    smartChipsEnabled.mockReturnValue(false)
    make(); typeAtEnd('alert me if NVDA closes below 120')
    expect(offer()).toBeNull()
  })
  it('a read-only editor offers nothing', () => {
    make('<p>alert me if NVDA closes below 120</p>'); editor.setEditable(false)
    editor.commands.setTextSelection(5)
    expect(offer()).toBeNull()
  })
})

// ⛔ Review Focus 1 (R-T2A-10): the plugin's priority is 50, below every suggestion menu, so an open
// slash menu gets Escape FIRST. Driven the way a member drives it: the REAL slash extension on the REAL
// roster (buildExtensions), the menu as rendered (SlashMenu.blocks.test.jsx does the same).
describe('Escape goes to an open suggestion menu before the offer', () => {
  const pressKey = (k) => editor.view.someProp('handleKeyDown', (f) => f(editor.view, new KeyboardEvent('keydown', { key: k })))
  const slashOpen = () => SuggestionPluginKey.getState(editor.state)?.active === true
  const rows = () => document.querySelectorAll('#uct-slash-menu [role="option"]').length

  afterEach(() => { cleanup(); document.body.innerHTML = '' })

  it('the first Escape closes the slash session and keeps the offer; the second dismisses the offer', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({
      element: el,
      extensions: buildExtensions(),
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    render(createElement(EditorContent, { editor }))
    editor.commands.focus('end', { scrollIntoView: false })
    await act(async () => { editor.commands.insertContent('alert me if NVDA closes below 120 /') })
    await waitFor(() => expect(rows()).toBeGreaterThan(0))

    // Control: the slash session is open AND the offer is present, so the two Escapes below are a real race.
    expect(slashOpen()).toBe(true)
    expect(offer()).toMatchObject({ parsed: { symbol: 'NVDA', price: 120 } })

    await act(async () => { pressKey('Escape') })
    expect(slashOpen()).toBe(false)
    expect(offer()).not.toBeNull()

    await act(async () => { pressKey('Escape') })
    expect(offer()).toBeNull()
  })
})
