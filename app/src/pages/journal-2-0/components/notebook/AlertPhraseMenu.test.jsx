// app/src/pages/journal-2-0/components/notebook/AlertPhraseMenu.test.jsx
// Tier 2 part A, item 8 -- the "Set alert" chip. Every case asserts what is ON SCREEN (rendered text and
// roles), never the plugin's state alone: the chip is the half that talks to the member.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

vi.mock('../../lib/smartChipsFlag', () => ({ smartChipsEnabled: vi.fn(() => true) }))
vi.mock('../../lib/smartChipsApi', async (orig) => ({ ...(await orig()), tickersIn: vi.fn() }))
// The sheet is covered by TextAlertSheet.test.jsx; here it is a stub, so this file checks only the wiring.
vi.mock('./TextAlertSheet', () => ({
  default: ({ initial, onClose, onDone }) => (
    <div role="dialog" aria-label="Set an alert">
      <span data-testid="sheet-initial">{JSON.stringify(initial)}</span>
      <button type="button" onClick={onClose}>stub close</button>
      <button type="button" onClick={() => onDone('Alert set: stub.')}>stub done</button>
    </div>
  ),
}))

import { smartChipsEnabled } from '../../lib/smartChipsFlag'
import { tickersIn } from '../../lib/smartChipsApi'
import { ALERT_OFFER_EVENT, AlertPhraseOffer, alertPhraseKey } from '../../lib/alertPhraseOffer'
import AlertPhraseMenu, { ALERT_MENU_LABEL, CHECK_DELAY_MS } from './AlertPhraseMenu'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const NVDA = 'alert me if NVDA closes below 120'
let editor
const make = () => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: [StarterKit, AlertPhraseOffer], content: '<p></p>' })
  return editor
}
const typeSentence = async (text) => {
  await act(async () => {
    editor.commands.focus('end', { scrollIntoView: false })
    editor.commands.insertContent(text)
  })
}
const settle = async (ms = CHECK_DELAY_MS) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const toolbar = () => screen.queryByRole('toolbar', { name: ALERT_MENU_LABEL })

beforeEach(() => {
  vi.useFakeTimers()
  smartChipsEnabled.mockReturnValue(true)
  tickersIn.mockReset()
  tickersIn.mockResolvedValue([{ symbol: 'NVDA', tier: 'exact' }])
})
afterEach(() => {
  cleanup()
  editor?.destroy(); editor = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('the Set alert chip', () => {
  it('a confirmed ticker shows the chip, in words, with a "Set alert…" button', async () => {
    make(); render(<AlertPhraseMenu editor={editor} />)
    await typeSentence(NVDA)
    await settle()
    const bar = toolbar()
    expect(bar).not.toBeNull()
    expect(bar.textContent).toContain('NVDA closes below $120.00 (daily)')
    expect(screen.getByRole('button', { name: 'Set alert…' })).toBeTruthy()
    // The question went to the server about the ORIGINAL sentence (so "nvda" / "we" are filtered by the resolver).
    expect(tickersIn).toHaveBeenCalledWith(NVDA)
  })

  it('shows nothing until typing has paused (the check waits)', async () => {
    make(); render(<AlertPhraseMenu editor={editor} />)
    await typeSentence(NVDA)
    await settle(CHECK_DELAY_MS - 50)
    expect(toolbar()).toBeNull()
    expect(tickersIn).not.toHaveBeenCalled()
    await settle(100)
    expect(toolbar()).not.toBeNull()
  })

  it('a word the server does not confirm shows nothing', async () => {
    tickersIn.mockResolvedValue([])
    make(); render(<AlertPhraseMenu editor={editor} />)
    await typeSentence('alert me if RS closes below 120')
    await settle()
    expect(tickersIn).toHaveBeenCalledTimes(1) // control: it WAS asked, and the answer was no
    expect(toolbar()).toBeNull()
  })

  it('a failed check shows nothing and leaves the note alone', async () => {
    tickersIn.mockResolvedValue(null)
    make(); render(<AlertPhraseMenu editor={editor} />)
    await typeSentence(NVDA)
    await settle()
    expect(tickersIn).toHaveBeenCalledTimes(1)
    expect(toolbar()).toBeNull()
    expect(editor.getText()).toBe(NVDA)
  })

  it("a pronoun uses the note's ticker, with no network", async () => {
    make(); render(<AlertPhraseMenu editor={editor} noteTicker="amd" />)
    await typeSentence('alert me if it closes below 150')
    await settle(0)
    expect(tickersIn).not.toHaveBeenCalled()
    expect(toolbar().textContent).toContain('AMD closes below $150.00 (daily)')
  })

  it('a pronoun with no note ticker shows nothing', async () => {
    make(); render(<AlertPhraseMenu editor={editor} noteTicker={null} />)
    await typeSentence('alert me if it closes below 150')
    await settle()
    expect(tickersIn).not.toHaveBeenCalled()
    expect(toolbar()).toBeNull()
  })

  it('"Dismiss alert suggestion" removes the chip and the sentence is remembered as dismissed', async () => {
    make(); render(<AlertPhraseMenu editor={editor} />)
    await typeSentence(NVDA)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss alert suggestion' }))
    expect(toolbar()).toBeNull()
    expect(alertPhraseKey.getState(editor.state).dismissed).toContain(NVDA)
    await settle()
    expect(toolbar()).toBeNull() // and it does not come back by itself
  })

  it('the live region speaks once per offer, and not again when the caret moves inside it', async () => {
    make(); render(<AlertPhraseMenu editor={editor} />)
    const region = () => screen.getByRole('status').textContent
    expect(region()).toBe('')
    await typeSentence(NVDA)
    await settle()
    const said = 'Alert suggestion: NVDA closes below $120.00 (daily). Press Alt+Enter to set it, or Escape to dismiss.'
    expect(region()).toBe(said)
    await act(async () => { editor.commands.setTextSelection(4) })
    await act(async () => { editor.commands.setTextSelection(10) })
    await settle()
    expect(region()).toBe(said)
    expect(toolbar()).not.toBeNull()
  })

  it("Alt+Enter (the plugin's event) opens the sheet, filled in from the confirmed sentence", async () => {
    make(); render(<AlertPhraseMenu editor={editor} />)
    await typeSentence(NVDA)
    await settle()
    await act(async () => { editor.view.dom.dispatchEvent(new CustomEvent(ALERT_OFFER_EVENT, { bubbles: true })) })
    vi.useRealTimers() // the lazy sheet resolves on real microtasks
    const dialog = await screen.findByRole('dialog', { name: 'Set an alert' })
    expect(dialog).toBeTruthy()
    expect(JSON.parse(screen.getByTestId('sheet-initial').textContent)).toMatchObject({
      symbol: 'NVDA', mode: 'close', direction: 'below', price: 120, tf: 'D',
    })
    expect(toolbar()).toBeNull() // the chip steps aside while the sheet is open
  })

  it('Alt+Enter before the ticker is confirmed opens nothing', async () => {
    make(); render(<AlertPhraseMenu editor={editor} />)
    await typeSentence(NVDA) // no settle: the server has not answered
    await act(async () => { editor.view.dom.dispatchEvent(new CustomEvent(ALERT_OFFER_EVENT, { bubbles: true })) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('finishing the sheet clears the chip and says what happened, once', async () => {
    const notify = vi.fn()
    make(); editor.storage.uctJournalWidgets = { notify }
    render(<AlertPhraseMenu editor={editor} />)
    await typeSentence(NVDA)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Set alert…' }))
    vi.useRealTimers()
    fireEvent.click(await screen.findByRole('button', { name: 'stub done' }))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Alert set: stub.', 'success')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(toolbar()).toBeNull()
  })

  it('mounting hosts the plugin, and unmounting un-hosts it (no key is swallowed with no chip on screen)', () => {
    make()
    expect(editor.storage.alertPhraseOffer.hosted).toBe(false)
    const { unmount } = render(<AlertPhraseMenu editor={editor} />)
    expect(editor.storage.alertPhraseOffer.hosted).toBe(true)
    unmount()
    expect(editor.storage.alertPhraseOffer.hosted).toBe(false)
  })

  it('an editor whose view is not mounted yet is hosted without throwing, and works once the view arrives', async () => {
    // R5-1: `editor.view` is a THROWING getter until the view mounts, and the page's first render comes first.
    make()
    editor.unmount()
    expect(editor.isDestroyed).toBe(true) // control: tiptap says "no live view", as the page's first render sees it
    expect(() => render(<AlertPhraseMenu editor={editor} />)).not.toThrow()
    expect(editor.storage.alertPhraseOffer.hosted).toBe(true)
    const el = document.createElement('div')
    document.body.appendChild(el)
    await act(async () => { editor.mount(el) })
    await typeSentence(NVDA)
    await settle()
    expect(toolbar()).not.toBeNull()
    // and the Alt+Enter listener was attached to the view that arrived late
    await act(async () => { editor.view.dom.dispatchEvent(new CustomEvent(ALERT_OFFER_EVENT, { bubbles: true })) })
    vi.useRealTimers()
    expect(await screen.findByRole('dialog', { name: 'Set an alert' })).toBeTruthy()
  })

  it('the switch off: no chip and no request', async () => {
    smartChipsEnabled.mockReturnValue(false)
    make(); render(<AlertPhraseMenu editor={editor} />)
    await typeSentence(NVDA)
    await settle()
    expect(toolbar()).toBeNull()
    expect(tickersIn).not.toHaveBeenCalled()
  })
})
