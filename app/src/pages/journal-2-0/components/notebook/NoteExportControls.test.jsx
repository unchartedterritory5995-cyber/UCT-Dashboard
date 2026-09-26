// The editor's Export menu (wave 8, lane 8C, C4): a real menu button over four formats.
//
// ⛔ Every sentence the member reads is asserted as RENDERED TEXT (the host below renders
// `onMessage` into the DOM the way the editor's chrome line does), never as a spy call alone.
// ⛔ Every assertion on `fetch` reads `fetch.mock.calls` OUTSIDE any mock callback.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import NoteExportControls, { UNSENT_BEFORE_EXPORT } from './NoteExportControls'
import { exportNoteAsPng } from '../../lib/exportNote'
import { EXPORT_FORMATS } from './export/exportFormats'

vi.mock('../../lib/exportNote', () => ({
  exportNoteAsPng: vi.fn(async () => true),
  printNote: vi.fn(),
}))

function Host({ noteId = 'n1', onBeforeExport = null }) {
  const [msg, setMsg] = useState('')
  return (
    <div>
      <NoteExportControls noteId={noteId} title="Plan" columnRef={{ current: null }} onMessage={setMsg}
        onBeforeExport={onBeforeExport} />
      <p data-testid="chrome-msg">{msg}</p>
      <button type="button">elsewhere in the note</button>
    </div>
  )
}

function fileResponse(disposition, body = 'x') {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob([body]),
    headers: { get: (n) => (n.toLowerCase() === 'content-disposition' ? disposition : null) },
  }
}

let clicked
beforeEach(() => {
  clicked = []
  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag, ...rest) => {
    const el = realCreate(tag, ...rest)
    if (tag === 'a') el.click = () => { clicked.push({ href: el.href, download: el.download }) }
    return el
  })
  global.URL.createObjectURL = vi.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = vi.fn()
  global.fetch = vi.fn()
})
afterEach(() => { vi.restoreAllMocks() })

const trigger = () => screen.getByRole('button', { name: /^export/i })

describe('the Export menu button', () => {
  it('is a closed menu button beside PNG and Print', () => {
    render(<Host />)
    expect(screen.getByRole('button', { name: 'PNG' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument()
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
    // The old single-format button is gone: Markdown is now one item of the menu.
    expect(screen.queryByRole('button', { name: 'Markdown' })).toBeNull()
  })

  it('opens onto four formats, each named by its label and described by what it keeps', () => {
    render(<Host />)
    fireEvent.click(trigger())
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'Export this note as' })
    expect(trigger()).toHaveAttribute('aria-controls', menu.id)
    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual(['Markdown', 'Web page (HTML)', 'JSON', 'Word (.docx)'])
    // The description a screen reader announces is the rendered "keeps" sentence.
    for (const [i, f] of EXPORT_FORMATS.entries()) {
      const describedBy = document.getElementById(items[i].getAttribute('aria-describedby'))
      expect(describedBy.textContent).toBe(f.keeps)
    }
    // Focus lands on the first item.
    expect(document.activeElement).toBe(items[0])
  })

  it('walks with the arrow keys, jumps with Home and End, and wraps', () => {
    render(<Host />)
    fireEvent.click(trigger())
    const items = screen.getAllByRole('menuitem')
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toBe(items[3])
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[3])
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
  })

  it('Escape closes the menu and hands focus back to the button', () => {
    render(<Host />)
    fireEvent.click(trigger())
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger())
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
  })

  it('ArrowDown on the closed button opens it (the keyboard door)', () => {
    render(<Host />)
    trigger().focus()
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0])
  })

  it('a press outside closes it; Tab closes it', () => {
    render(<Host />)
    fireEvent.click(trigger())
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(trigger())
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('each format downloads through the format route', () => {
  for (const f of EXPORT_FORMATS) {
    it(`${f.menuLabel} fetches format=${f.id} and says "downloaded"`, async () => {
      global.fetch.mockResolvedValue(fileResponse(`attachment; filename="Plan.${f.id}"`))
      render(<Host />)
      fireEvent.click(trigger())
      fireEvent.click(screen.getByRole('menuitem', { name: f.menuLabel }))
      await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('downloaded'))
      expect(global.fetch.mock.calls.map((c) => c[0])).toEqual([`/api/j2/export/notes/n1?format=${f.id}`])
      expect(global.fetch.mock.calls[0][1]).toEqual({ credentials: 'include' })
      expect(clicked).toEqual([{ href: 'blob:mock', download: `Plan.${f.id}` }])
      // The menu closed and focus went back to the button before the fetch.
      expect(screen.queryByRole('menu')).toBeNull()
    })
  }

  it('Markdown uses the format route too (the old door 500s on a title outside Latin-1)', async () => {
    global.fetch.mockResolvedValue(fileResponse(
      `attachment; filename="Plan _ NVDA-20260926.md"; filename*=UTF-8''${encodeURIComponent('Plan — NVDA-20260926.md')}`,
    ))
    render(<Host noteId="a b" />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Markdown' }))
    await waitFor(() => expect(clicked.length).toBe(1))
    expect(global.fetch.mock.calls[0][0]).toBe('/api/j2/export/notes/a%20b?format=md')
    // The UTF-8 name wins over the ASCII fallback.
    expect(clicked[0].download).toBe('Plan — NVDA-20260926.md')
  })

  it('says "preparing…" while the file is built', async () => {
    let release
    global.fetch.mockReturnValue(new Promise((r) => { release = r }))
    render(<Host />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'JSON' }))
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('preparing…'))
    // ONE busy guard for all doors: the trigger and PNG are disabled mid-export.
    expect(trigger()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'PNG' })).toBeDisabled()
    await act(async () => { release(fileResponse('attachment; filename="Plan.json"')) })
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('downloaded'))
    expect(trigger()).not.toBeDisabled()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it("shows the server's own sentence when it refuses", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 422,
      headers: { get: () => null },
      json: async () => ({ detail: "That export format isn't available. Choose Markdown, Web page (HTML), JSON or Word." }),
    })
    render(<Host />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Word (.docx)' }))
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent)
      .toBe("That export format isn't available. Choose Markdown, Web page (HTML), JSON or Word."))
    expect(clicked).toEqual([])
  })

  it('says "export failed" when the response carries no sentence, or the network drops', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, headers: { get: () => null }, json: async () => { throw new Error('html') } })
    render(<Host />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Web page (HTML)' }))
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('export failed'))
    global.fetch.mockRejectedValueOnce(new TypeError('offline'))
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'JSON' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('export failed'))
    expect(clicked).toEqual([])
  })
})

// ⛔ Wave 8 final review, M-9: every format is built from the SERVER's copy of the note, so the
// editor's pending edits go first (`onBeforeExport`, the editor's `sendPendingEdits` -- wave
// 7's Save-as-template precedent). JSON promises "every note exactly as stored, with nothing
// left out"; a file missing the member's last sentence would break that promise.
describe("the editor's pending edits are sent before the file is built (M-9)", () => {
  it('asks the editor to send first, THEN fetches the file', async () => {
    const order = []
    const onBeforeExport = vi.fn(async () => { order.push('send pending edits'); return true })
    global.fetch.mockImplementation(async () => { order.push('fetch the file'); return fileResponse('attachment; filename="Plan.json"') })
    render(<Host onBeforeExport={onBeforeExport} />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'JSON' }))
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('downloaded'))
    expect(order).toEqual(['send pending edits', 'fetch the file'])
  })

  it('with words still unsent, nothing is downloaded -- and the member is told why', async () => {
    const onBeforeExport = vi.fn(async () => false)
    render(<Host onBeforeExport={onBeforeExport} />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Word (.docx)' }))
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe(UNSENT_BEFORE_EXPORT))
    expect(UNSENT_BEFORE_EXPORT).toBe(
      "Your latest edits haven't reached the server yet, so the file would miss them. Nothing was downloaded — try again in a moment.")
    expect(global.fetch).not.toHaveBeenCalled()
    expect(clicked).toEqual([])
    expect(trigger()).not.toBeDisabled()
  })

  it('PNG reads the note on screen, so it asks nothing first', async () => {
    const onBeforeExport = vi.fn(async () => false)
    render(<Host onBeforeExport={onBeforeExport} />)
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('PNG saved'))
    expect(onBeforeExport).not.toHaveBeenCalled()
  })
})

// ⛔ Wave 8 final review, M-1: PNG and Export are DISABLED while a file is made, and a browser
// moves focus off a disabled button (to <body>). jsdom does not, so each rail drops focus the
// way the browser does, at the moment the button is disabled -- and asserts where it lands.
// (jsdom will not blur a disabled button, so focus is parked on a throwaway field and the field
// removed: jsdom's own removal fix-up then leaves it on <body>, where the browser leaves it.)
const dropFocusToBody = () => act(() => {
  const tmp = document.createElement('input')
  document.body.appendChild(tmp)
  tmp.focus()
  tmp.remove()
})

describe('focus comes back to the button that made the file (M-1)', () => {
  it('Export: back on the Export button once the download ends', async () => {
    let release
    global.fetch.mockReturnValue(new Promise((r) => { release = r }))
    render(<Host />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'JSON' }))
    await waitFor(() => expect(trigger()).toBeDisabled())
    dropFocusToBody()                                            // the browser's focus fix-up
    expect(document.activeElement).toBe(document.body)
    await act(async () => { release(fileResponse('attachment; filename="Plan.json"')) })
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('downloaded'))
    expect(document.activeElement).toBe(trigger())
  })

  it('PNG: back on PNG once the image is saved', async () => {
    let release
    exportNoteAsPng.mockImplementationOnce(() => new Promise((r) => { release = r }))
    render(<Host />)
    const png = screen.getByRole('button', { name: 'PNG' })
    png.focus()
    fireEvent.click(png)
    await waitFor(() => expect(png).toBeDisabled())
    dropFocusToBody()
    expect(document.activeElement).toBe(document.body)
    await act(async () => { release(true) })
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('PNG saved'))
    expect(document.activeElement).toBe(png)
  })

  it('a member who moved on meanwhile keeps their place', async () => {
    let release
    global.fetch.mockReturnValue(new Promise((r) => { release = r }))
    render(<Host />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Markdown' }))
    await waitFor(() => expect(trigger()).toBeDisabled())
    const elsewhere = screen.getByRole('button', { name: 'elsewhere in the note' })
    elsewhere.focus()
    await act(async () => { release(fileResponse('attachment; filename="Plan.md"')) })
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('downloaded'))
    expect(document.activeElement).toBe(elsewhere)
  })
})
