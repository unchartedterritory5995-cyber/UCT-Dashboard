// The editor's Export menu (wave 8, lane 8C, C4): a real menu button over four formats.
//
// ⛔ Every sentence the member reads is asserted as RENDERED TEXT (the host below renders
// `onMessage` into the DOM the way the editor's chrome line does), never as a spy call alone.
// ⛔ Every assertion on `fetch` reads `fetch.mock.calls` OUTSIDE any mock callback.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import NoteExportControls from './NoteExportControls'
import { EXPORT_FORMATS } from './export/exportFormats'

vi.mock('../../lib/exportNote', () => ({
  exportNoteAsPng: vi.fn(async () => true),
  printNote: vi.fn(),
}))

function Host({ noteId = 'n1' }) {
  const [msg, setMsg] = useState('')
  return (
    <div>
      <NoteExportControls noteId={noteId} title="Plan" columnRef={{ current: null }} onMessage={setMsg} />
      <p data-testid="chrome-msg">{msg}</p>
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
