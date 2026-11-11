// S13 (audit 2026-11-05): the one-time tips at the moment of need, through a REAL editor (lib/tiptap.js's own
// extensions). The first $TICKER a member writes and the first chart they insert each earn their tip once per account;
// a gate off means no tip; the words are the spec's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => []

const prefsBox = vi.hoisted(() => ({ prefs: {}, setPrefMerged: null }))
vi.mock('../../../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ prefs: prefsBox.prefs, loading: false, setPrefMerged: prefsBox.setPrefMerged }),
}))

import NotebookTipSlot from './NotebookTipSlot'
import NotebookTip from './NotebookTip'
import { buildExtensions } from '../../lib/tiptap'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { TIPS_PREF, insertedChart, seenTips, tipFor, withTipSeen, wroteTicker } from '../../lib/notebookTips'

const ALL_ON = {
  notebook_widgets_w1_enabled: true, notebook_chart_plan_enabled: true, notebook_setups_board_enabled: true,
}
const TICKER_TIP = 'Hover a ticker to see price, averages, earnings and your history.'
const CHART_TIP = 'Draw entry, stop and target to track it on your Setups board.'

let editors = []
function mountEditor(content = '<p>Plan</p>', { editable = true } = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const editor = new Editor({ element: el, extensions: buildExtensions(), content, editable })
  editors.push(editor)
  return editor
}
const typeAtEnd = (editor, text) => act(() => { editor.chain().focus('end').insertContent(text).run() })
const insertChart = (editor) => act(() => {
  editor.chain().focus('end').insertContent({ type: 'widgetEmbed', attrs: { widgetId: 'chart', params: { symbol: 'NVDA', tf: 'D' } } }).run()
})
const tipCard = () => document.querySelector('[data-notebook-tip]')
const status = () => document.querySelector('[data-notebook-tip-status]')

let realMM
beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags(ALL_ON)
  prefsBox.prefs = {}
  prefsBox.setPrefMerged = vi.fn(async () => true)
  realMM = window.matchMedia
})
afterEach(() => {
  editors.forEach((e) => e.destroy()); editors = []
  __resetNotebookFlags()
  window.matchMedia = realMM
})

describe('the ticker tip', () => {
  it('the first $TICKER written shows the tip, records it once per account, and announces it', async () => {
    const editor = mountEditor()
    render(<NotebookTipSlot editor={editor} />)
    expect(status()).toHaveTextContent('')            // mounted empty, before any tip
    typeAtEnd(editor, ' watching $NVDA ')
    expect(await screen.findByText(TICKER_TIP)).toBeInTheDocument()
    expect(tipCard().getAttribute('data-notebook-tip')).toBe('ticker')
    expect(status()).toHaveTextContent(`Tip: ${TICKER_TIP}`)
    expect(prefsBox.setPrefMerged).toHaveBeenCalledTimes(1)
    const [key, updater] = prefsBox.setPrefMerged.mock.calls[0]
    expect(key).toBe(TIPS_PREF)
    expect(updater(undefined)).toEqual({ v: 1, seen: ['ticker'] })
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(tipCard()).toBeNull()
  })

  it('on touch (no hover) it says Tap', async () => {
    window.matchMedia = vi.fn((q) => ({ matches: q === '(hover: none)', media: q, addEventListener() {}, removeEventListener() {} }))
    const editor = mountEditor()
    render(<NotebookTipSlot editor={editor} />)
    typeAtEnd(editor, ' $AMD ')
    expect(await screen.findByText('Tap a ticker to see price, averages, earnings and your history.')).toBeInTheDocument()
  })

  it('already seen on this account: never again', async () => {
    prefsBox.prefs = { [TIPS_PREF]: JSON.stringify({ v: 1, seen: ['ticker'] }) }
    const editor = mountEditor()
    render(<NotebookTipSlot editor={editor} />)
    typeAtEnd(editor, ' $NVDA ')
    await new Promise((r) => setTimeout(r, 30))
    expect(tipCard()).toBeNull()
    expect(prefsBox.setPrefMerged).not.toHaveBeenCalled()
  })

  it('opening a note that already holds tickers is not writing one (CONTROL: no tip, nothing recorded)', async () => {
    const editor = mountEditor('<p>Long $NVDA into earnings</p>')
    render(<NotebookTipSlot editor={editor} />)
    typeAtEnd(editor, ' and more words')
    await new Promise((r) => setTimeout(r, 30))
    expect(tipCard()).toBeNull()
    expect(prefsBox.setPrefMerged).not.toHaveBeenCalled()
  })

  it('with the hover card off (W1), the tip names a door that is not there, so it never shows', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ ...ALL_ON, notebook_widgets_w1_enabled: false })
    const editor = mountEditor()
    render(<NotebookTipSlot editor={editor} />)
    typeAtEnd(editor, ' $NVDA ')
    await new Promise((r) => setTimeout(r, 30))
    expect(tipCard()).toBeNull()
    expect(prefsBox.setPrefMerged).not.toHaveBeenCalled()
  })

  it('a read-only note earns nothing', async () => {
    const editor = mountEditor('<p>x</p>', { editable: false })
    render(<NotebookTipSlot editor={editor} />)
    act(() => { editor.commands.setContent('<p>$NVDA </p>', true) })
    await new Promise((r) => setTimeout(r, 30))
    expect(tipCard()).toBeNull()
  })
})

// Tier 2 fix round 1 (review minors 6 and 8).
describe('the ticker tip waits for a whole ticker, and is recorded only once its card is on screen', () => {
  it('the first letter after $ is not a ticker; the boundary after 2+ letters is', async () => {
    const editor = mountEditor()
    render(<NotebookTipSlot editor={editor} />)
    typeAtEnd(editor, ' $N')
    typeAtEnd(editor, 'V')
    await new Promise((r) => setTimeout(r, 30))
    expect(tipCard()).toBeNull()                         // "$NV" with the caret on it: still being written
    typeAtEnd(editor, 'DA')
    await new Promise((r) => setTimeout(r, 30))
    expect(tipCard()).toBeNull()
    typeAtEnd(editor, ' ')
    expect(await screen.findByText(TICKER_TIP)).toBeInTheDocument()
  })

  it('a one-letter symbol ($F) never earns it', async () => {
    const editor = mountEditor()
    render(<NotebookTipSlot editor={editor} />)
    typeAtEnd(editor, ' $F ')
    await new Promise((r) => setTimeout(r, 30))
    expect(tipCard()).toBeNull()
  })

  it('an inline atom earlier in the line (a line break) does not shift the match', async () => {
    const editor = mountEditor()
    render(<NotebookTipSlot editor={editor} />)
    act(() => { editor.chain().focus('end').setHardBreak().insertContent('$AMD ').run() })
    expect(await screen.findByText(TICKER_TIP)).toBeInTheDocument()
  })

  it('the record is made by the CARD on mount (onShown), so a card that never arrives never burns the tip', async () => {
    const onShown = vi.fn()
    render(<NotebookTip id="ticker" text="x" onDismiss={() => {}} onShown={onShown} />)
    expect(onShown).toHaveBeenCalledTimes(1)
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const slot = readFileSync(join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook', 'NotebookTipSlot.jsx'), 'utf8')
    const calls = slot.match(/setPrefMerged\(TIPS_PREF/g) || []
    expect(calls).toHaveLength(1)
    expect(slot).toMatch(/onShown=\{\(\) => setPrefMerged\(TIPS_PREF/)
  })
})

describe('the chart tip', () => {
  it('the first chart inserted shows the Setups board tip, once', async () => {
    const editor = mountEditor()
    render(<NotebookTipSlot editor={editor} />)
    insertChart(editor)
    expect(await screen.findByText(CHART_TIP)).toBeInTheDocument()
    expect(prefsBox.setPrefMerged.mock.calls[0][1](undefined)).toEqual({ v: 1, seen: ['chart'] })
  })

  it('needs the chart plan AND the Setups board (either off: no tip)', async () => {
    for (const off of ['notebook_chart_plan_enabled', 'notebook_setups_board_enabled']) {
      __resetNotebookFlags()
      latchNotebookFlags({ ...ALL_ON, [off]: false })
      const editor = mountEditor()
      const { unmount } = render(<NotebookTipSlot editor={editor} />)
      insertChart(editor)
      await new Promise((r) => setTimeout(r, 30))
      expect(tipCard(), off).toBeNull()
      unmount()
    }
    expect(prefsBox.setPrefMerged).not.toHaveBeenCalled()
  })
})

describe('the rules (lib/notebookTips.js)', () => {
  it('withTipSeen adds an id once, keeping the others; a repeat abandons the write', () => {
    expect(withTipSeen(JSON.stringify({ v: 1, seen: ['chart'] }), 'ticker')).toEqual({ v: 1, seen: ['chart', 'ticker'] })
    expect(withTipSeen({ v: 1, seen: ['ticker'] }, 'ticker')).toBeUndefined()
    expect([...seenTips('not json')]).toEqual([])
  })

  it('tipFor: a chart insert wins; a selection-only change earns nothing', () => {
    const editor = mountEditor('<p>$NVDA now</p>')
    let seen = null
    editor.on('transaction', ({ transaction }) => { seen = tipFor(transaction, editor.state) })
    act(() => { editor.commands.setTextSelection(7) })   // after "$NVDA " (the paragraph starts at 1)
    expect(seen).toBeNull()
    expect(wroteTicker(editor.state)).toBe(true)          // the caret IS after a ticker, but nothing was written
    insertChart(editor)
    expect(seen).toBe('chart')
    expect(insertedChart({ steps: [] })).toBe(false)
  })
})

describe('the tip card loads on demand (first-open bytes)', () => {
  it('NotebookTipSlot reaches the card only through one dynamic import; nothing imports it statically', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook')
    const slot = readFileSync(join(dir, 'NotebookTipSlot.jsx'), 'utf8')
    expect(slot.match(/import\(\s*'\.\/NotebookTip'\s*\)/g)).toHaveLength(1)
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsx') && !n.includes('.test.'))) {
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/^import [^\n]* from '\.\/NotebookTip'$/m)
    }
  })
})
