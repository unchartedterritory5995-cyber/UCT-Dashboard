// F2 cleanup: when the lazy fetch chunk cannot load (lost after a deploy), a snapshot insert says so in one
// sentence and inserts nothing; it never fails silently. The chunk is made unloadable for this whole file, and the
// capture kinds' own module answers a payload, so the LAST step (the insert, which lives in the lost chunk) is the
// one that fails. Asserted by the sentence the member sees.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import Toast from '../Toast'
import { snapshotWidgetItems } from './SlashMenu'
import { buildExtensions } from '../../lib/tiptap'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

vi.mock('../../lib/notebookWidgetsFetch', () => { throw new Error('chunk') })
const capture = vi.hoisted(() => ({ breadth: async () => ({ ok: true, payload: { updated: '1:26 PM ET' } }) }))
vi.mock('../../../charts/widgets/captures/slashCaptures', () => ({ breadth: (p) => capture.breadth(p) }))
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

const LOST = "This widget couldn't load. Reload the page to try again."
let editor
afterEach(() => { __resetNotebookFlags(); editor?.destroy(); editor = null })

function mount(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content })
  const set = { current: null }
  function Host() {
    const [t, setT] = useState(null)
    set.current = setT
    return <Toast message={t?.message} tone={t?.tone} onDismiss={() => setT(null)} />
  }
  render(<Host />)
  editor.storage.uctJournalWidgets = { ...(editor.storage.uctJournalWidgets || {}),
    notify: (message, tone) => act(() => set.current({ message, tone })) }
  return editor
}
const slashRange = (ed) => {
  const text = ed.state.doc.firstChild.textContent
  const at = text.lastIndexOf('/')
  return { from: 1 + at, to: 1 + text.length }
}
const embeds = (ed) => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === 'widgetEmbed') o.push(n) }); return o }

describe('a lost lazy chunk', () => {
  it('a snapshot kind whose fetch chunk cannot load says to reload, and inserts nothing', async () => {
    latchNotebookFlags({ notebook_widgets_w1_enabled: true })
    const ed = mount('<p>Plan /ticker NVDA</p>')
    const out = await snapshotWidgetItems('ticker NVDA')[0].command({ editor: ed, range: slashRange(ed) })
    expect(out).toEqual({ ok: false, message: LOST })
    expect(screen.getByRole('status')).toHaveTextContent(LOST)
    expect(embeds(ed)).toHaveLength(0)
  })

  it('a capture kind that fetched fine but whose insert chunk cannot load says to reload (it was silent)', async () => {
    latchNotebookFlags({ notebook_widgets_w4_enabled: true })
    const ed = mount('<p>/breadth</p>')
    const item = snapshotWidgetItems('breadth').find((i) => i.title === 'Breadth heatmap')
    expect(item).toBeTruthy()                                         // non-vacuity: the capture row exists
    const out = await item.command({ editor: ed, range: slashRange(ed) })
    expect(out).toEqual({ ok: false, message: LOST })
    expect(screen.getByRole('status')).toHaveTextContent(LOST)
    expect(embeds(ed)).toHaveLength(0)
  })

  it('review m-2: a capture that rejects inside its own code keeps the failed sentence, never "reload"', async () => {
    latchNotebookFlags({ notebook_widgets_w4_enabled: true })
    const ok = capture.breadth
    capture.breadth = async () => { throw new Error('vendor said no') }
    try {
      const ed = mount('<p>/breadth</p>')
      const item = snapshotWidgetItems('breadth').find((i) => i.title === 'Breadth heatmap')
      expect(await item.command({ editor: ed, range: slashRange(ed) }))
        .toEqual({ ok: false, message: 'Breadth heatmap could not be loaded just now, so nothing was added.' })
      expect(screen.getByRole('status')).toHaveTextContent('Breadth heatmap could not be loaded just now, so nothing was added.')
      expect(screen.getByRole('status')).not.toHaveTextContent('Reload the page')
    } finally { capture.breadth = ok }
  })

  it('review m-3: offline at the insert step (a capture fetched, its insert chunk lost) says the offline sentence', async () => {
    latchNotebookFlags({ notebook_widgets_w4_enabled: true })
    const ok = capture.breadth
    capture.breadth = async () => {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
      return { ok: true, payload: { updated: '1:26 PM ET' } }
    }
    try {
      const ed = mount('<p>/breadth</p>')
      const item = snapshotWidgetItems('breadth').find((i) => i.title === 'Breadth heatmap')
      expect((await item.command({ editor: ed, range: slashRange(ed) })).message)
        .toBe("You're offline, so Breadth heatmap was not added.")
      expect(screen.getByRole('status')).toHaveTextContent("You're offline, so Breadth heatmap was not added.")
      expect(embeds(ed)).toHaveLength(0)
    } finally {
      capture.breadth = ok
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
    }
  })

  it('offline, the same lost chunk is said as offline, not as a reload', async () => {
    latchNotebookFlags({ notebook_widgets_w1_enabled: true })
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
    try {
      const ed = mount('<p>Plan /ticker NVDA</p>')
      await snapshotWidgetItems('ticker NVDA')[0].command({ editor: ed, range: slashRange(ed) })
      expect(screen.getByRole('status')).toHaveTextContent("You're offline, so Ticker card was not added.")
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
    }
  })
})
