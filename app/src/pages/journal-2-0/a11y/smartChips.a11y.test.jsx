// app/src/pages/journal-2-0/a11y/smartChips.a11y.test.jsx
//
// Notebook P2 Tier 2 part A, Task 11: the alert chip, the alert sheet and the screenshot chip through
// 8A's axe harness. All three are dark behind notebook_smart_chips_enabled (the screenshot chip also
// needs the image-and-document switch on the page), so no editor recipe renders them -- hence recipes of
// their own, each proving its state rendered BEFORE axe runs, so an empty screen can never pass as a
// clean one. Each also asserts the accessible names the plan promises:
//   * smart-alert-chip       — a typed sentence, the server confirms NVDA: the toolbar "Alert suggestion",
//                              its "Set alert…" and "Dismiss alert suggestion" buttons, the polite status;
//   * smart-alert-sheet      — the dialog "Set an alert", filled in, with its four labelled fields;
//   * smart-screenshot-chip  — an image in a real editor: the toolbar "Screenshot tag", its "Tag NVDA ·
//                              Daily" button and "Dismiss screenshot tag".
//
// ⛔ The chip recipe mounts the REAL menu: the alert plugin acts only on a HOSTED editor, and mounting
// AlertPhraseMenu is what hosts it (AlertPhraseMenu.jsx, setAlertOfferHosted). A recipe that only built an
// editor would render nothing and pass.
import { afterEach, describe, expect } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { AUTH, Providers, installFetch, landPendingAutosave } from './fixtures'
import { axeSurface } from './surface'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import { __clearTickerCacheForTests } from '../lib/smartChipsApi'
import { AlertPhraseOffer } from '../lib/alertPhraseOffer'
import { buildExtensions } from '../lib/tiptap'
import AlertPhraseMenu, { ALERT_MENU_LABEL, CHECK_DELAY_MS } from '../components/notebook/AlertPhraseMenu'
import TextAlertSheet from '../components/notebook/TextAlertSheet'
import ScreenshotTagOffer, { SCREENSHOT_OFFER_LABEL } from '../components/notebook/ScreenshotTagOffer'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

const SENTENCE = 'alert me if NVDA closes below 120'
const COND = (...v) => v.map((value) => ({ value, label: value, needs_threshold: true }))
const CATALOG = {
  catalog: [{
    indicator: 'close', label: 'Price (Close)', conditions: COND('above', 'below', 'cross_above', 'cross_below'),
    plots: [{ value: 'close', label: 'Price (Close)', conditions: COND('above', 'below', 'cross_above', 'cross_below') }],
  }],
  refusals: [],
}

let editor = null
const makeEditor = (extensions, content) => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  // the page names its body 'Note body' (NoteEditorPage editorProps); a bare editor has no name for axe to read
  editor = new Editor({
    element: el, extensions, content,
    editorProps: { attributes: { 'aria-label': 'Note body' } },
  })
  return editor
}
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

afterEach(() => {
  editor?.destroy()
  editor = null
  __resetNotebookFlags()
})

describe('Tier 2 part A surfaces (the smart chips)', () => {
  axeSurface('smart-alert-chip', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_smart_chips_enabled: true })
    __clearTickerCacheForTests()
    installFetch([[/^\/api\/j2\/smart-chips\/tickers$/, { tickers: [{ symbol: 'NVDA', tier: 'exact' }] }]])
    makeEditor([StarterKit, AlertPhraseOffer], '<p></p>')
    render(<Providers><AlertPhraseMenu editor={editor} /></Providers>)
    await act(async () => {
      editor.commands.focus('end', { scrollIntoView: false })
      editor.commands.insertContent(SENTENCE)
    })
    // The chip waits for typing to pause, then asks the server once.
    await wait(CHECK_DELAY_MS + 200)
    const bar = await screen.findByRole('toolbar', { name: ALERT_MENU_LABEL })
    expect(ALERT_MENU_LABEL).toBe('Alert suggestion')
    expect(bar.textContent).toContain('NVDA closes below $120.00 (daily)')
    screen.getByRole('button', { name: 'Set alert…' })
    screen.getByRole('button', { name: 'Dismiss alert suggestion' })
    // The polite status says it once, with the keys.
    expect(screen.getByRole('status').textContent).toBe(
      'Alert suggestion: NVDA closes below $120.00 (daily). Press Alt+Enter to set it, or Escape to dismiss.',
    )
    await landPendingAutosave()
  })

  axeSurface('smart-alert-sheet', async () => {
    __resetNotebookFlags()
    installFetch([[/^\/api\/indicator-alerts\/catalog$/, CATALOG]])
    render(
      <Providers auth={AUTH}>
        <TextAlertSheet
          open
          initial={{ symbol: 'NVDA', mode: 'close', direction: 'below', price: 120, tf: 'D' }}
          onClose={() => {}}
          onDone={() => {}}
        />
      </Providers>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Set an alert' })
    expect(dialog).toBeTruthy()
    expect(screen.getByLabelText('Ticker').value).toBe('NVDA')
    expect(screen.getByLabelText('Price').value).toBe('120')
    const when = screen.getByLabelText('When')
    expect(when.options[when.selectedIndex].textContent).toBe('Closes below')
    screen.getByLabelText('Chart')
    screen.getByRole('button', { name: 'Cancel' })
    screen.getByRole('button', { name: 'Set alert' })
    await wait(30) // let the catalog answer so the dialog is axe-read in its settled state
  })

  axeSurface('smart-screenshot-chip', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_smart_chips_enabled: true })
    installFetch()
    makeEditor(buildExtensions(), '<p>x</p><img src="/a.png" alt="">')
    render(
      <Providers>
        <ScreenshotTagOffer
          editor={editor}
          offer={{ url: '/a.png', symbol: 'NVDA', timeframe: { tf: 'D', label: 'Daily' } }}
          noteTicker={null}
          onAccept={() => {}}
          onDismiss={() => {}}
        />
      </Providers>,
    )
    await screen.findByRole('toolbar', { name: SCREENSHOT_OFFER_LABEL })
    expect(SCREENSHOT_OFFER_LABEL).toBe('Screenshot tag')
    screen.getByRole('button', { name: 'Tag NVDA · Daily' })
    screen.getByRole('button', { name: 'Dismiss screenshot tag' })
  })
})
