// The editor's Export menu (wave 8, lane 8C, C4): a real menu button over four formats.
//
// ⛔ Every sentence the member reads is asserted as RENDERED TEXT (the host below renders
// `onMessage` into the DOM the way the editor's chrome line does), never as a spy call alone.
// ⛔ Every assertion on `fetch` reads `fetch.mock.calls` OUTSIDE any mock callback.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import NoteExportControls, {
  EXPORT_UNAVAILABLE, EXPORT_WAITING, UNSENT_BEFORE_EXPORT, exportMenuLoader, exportMenuModule,
} from './NoteExportControls'
import { pageReload } from '../../lib/heldModule'
import { exportNoteAsPng } from '../../lib/exportNote'
import { EXPORT_FORMATS } from './export/exportFormats'
import { featureCalls, telemetryBodies } from '../../lib/testing/telemetryFetch'
import { printNote } from '../../lib/exportNote'
import NoteMoreMenu from './NoteMoreMenu'
import { NOTEBOOK_DOORS, openNotebookDoor } from '../../lib/notebookDoors'
import { expectSecondView } from '../../lib/testing/menuSecondView.testkit'

vi.mock('../../lib/exportNote', () => ({
  exportNoteAsPng: vi.fn(async () => ({ ok: true })),
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
// Simplify pass 2: the menu is a chunk of its own (export/NoteExportMenu.jsx), held once fetched. Every case below
// presses Export with it in hand, as a member does after the editor's idle fetch; the cold press has its own cases.
beforeAll(async () => { await exportMenuModule.warm() })

const trigger = () => screen.getByRole('button', { name: /^export/i })
// Notebook simplify, Task 4: PNG and Print are the Export menu's first two items, above the four formats.
const SCREEN_ITEMS = ['PNG', 'Print']
const pressItem = (name) => {
  if (!screen.queryByRole('menu')) fireEvent.click(trigger())
  fireEvent.click(screen.getByRole('menuitem', { name }))
}

describe('the Export menu button', () => {
  it('is a closed menu button, with PNG and Print inside it rather than beside it', () => {
    render(<Host />)
    expect(screen.queryByRole('button', { name: 'PNG' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull()
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
    // The old single-format button is gone: Markdown is now one item of the menu.
    expect(screen.queryByRole('button', { name: 'Markdown' })).toBeNull()
  })

  it('opens onto PNG, Print and four formats, each named by its label and described by what it keeps', () => {
    render(<Host />)
    fireEvent.click(trigger())
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'Export this note as' })
    expect(trigger()).toHaveAttribute('aria-controls', menu.id)
    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual(
      [...SCREEN_ITEMS, 'Markdown', 'Web page (HTML)', 'JSON', 'Word (.docx)'])
    // The description a screen reader announces is the rendered "keeps" sentence.
    for (const [i, f] of EXPORT_FORMATS.entries()) {
      const describedBy = document.getElementById(items[SCREEN_ITEMS.length + i].getAttribute('aria-describedby'))
      expect(describedBy.textContent).toBe(f.keeps)
    }
    for (const item of items.slice(0, SCREEN_ITEMS.length)) {
      expect(document.getElementById(item.getAttribute('aria-describedby')).textContent).not.toBe('')
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
    expect(document.activeElement).toBe(items[items.length - 1])
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[items.length - 1])
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

  it('a press outside closes it', () => {
    render(<Host />)
    fireEvent.click(trigger())
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  // ⛔ MOVED ON PURPOSE (wave 10 lane K2, walk row S2-26): this rail said "Tab closes it". Tab
  // closed the menu and focus walked on into the note's title, so the keyboard walk's Escape
  // six presses later had nothing to close and focus never came back. The editor's disclosures
  // now share one contract (lib/useDisclosureFocus.js): Tab stays inside while focus is inside.
  it('Tab and Shift+Tab stay inside the open menu (K2): they wrap at the ends and it stays open', () => {
    render(<Host />)
    fireEvent.click(trigger())
    const items = screen.getAllByRole('menuitem')
    items[items.length - 1].focus()
    fireEvent.keyDown(document.activeElement, { key: 'Tab' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(items[items.length - 1])
    expect(screen.getByRole('menu')).toBeInTheDocument()
    // Every item is a Tab stop INSIDE the menu (none is skipped by a roving tabindex, which
    // would let Tab from a middle item leave the menu).
    for (const item of items) expect(item).not.toHaveAttribute('tabindex', '-1')
  })

  it('CONTROL: with focus back outside the open menu, Tab is the page\'s own again', () => {
    render(<><Host /><button type="button">elsewhere</button></>)
    fireEvent.click(trigger())
    const elsewhere = screen.getByRole('button', { name: 'elsewhere' })
    elsewhere.focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    elsewhere.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(elsewhere)
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
      expect(featureCalls(global.fetch).map((c) => c[0])).toEqual([`/api/j2/export/notes/n1?format=${f.id}`])
      expect(featureCalls(global.fetch)[0][1]).toEqual({ credentials: 'include' })
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
    // ONE busy guard for all doors: the trigger is disabled mid-export, so PNG and Print (inside it) wait too.
    expect(trigger()).toBeDisabled()
    expect(screen.queryByRole('menu')).toBeNull()
    await act(async () => { release(fileResponse('attachment; filename="Plan.json"')) })
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('downloaded'))
    expect(trigger()).not.toBeDisabled()
    expect(featureCalls(global.fetch)).toHaveLength(1)
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
    global.fetch.mockImplementation(async (url) => {
      if (url !== '/api/j2/telemetry') order.push('fetch the file')
      return fileResponse('attachment; filename="Plan.json"')
    })
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
    pressItem('PNG')
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('PNG saved'))
    expect(onBeforeExport).not.toHaveBeenCalled()
  })
})

// A too-tall note refuses the PNG export (exportNote.js's own size guard --
// see exportNote.test.js for that guard's numbers). This door's job is only
// to show whatever member-facing reason the guard hands back, in place of
// the generic "export failed" -- asserted as RENDERED TEXT, never state.
describe('a refused PNG shows its OWN reason, not the generic failure message', () => {
  it('renders the reason exportNoteAsPng returns, verbatim', async () => {
    exportNoteAsPng.mockResolvedValueOnce({
      ok: false,
      reason: 'This note is too long for one PNG image. Try Print or the Export menu instead.',
    })
    render(<Host />)
    pressItem('PNG')
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent)
      .toBe('This note is too long for one PNG image. Try Print or the Export menu instead.'))
  })

  it('falls back to "export failed" when the guard gives no reason', async () => {
    exportNoteAsPng.mockResolvedValueOnce({ ok: false })
    render(<Host />)
    pressItem('PNG')
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('export failed'))
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

  // Notebook simplify, Task 4: PNG is an item of the Export menu, which closes when it is picked, so the button
  // that made the image -- and takes focus back -- is Export.
  it('PNG: back on the Export button once the image is saved', async () => {
    let release
    exportNoteAsPng.mockImplementationOnce(() => new Promise((r) => { release = r }))
    render(<Host />)
    pressItem('PNG')
    await waitFor(() => expect(trigger()).toBeDisabled())
    dropFocusToBody()
    expect(document.activeElement).toBe(document.body)
    await act(async () => { release({ ok: true }) })
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('PNG saved'))
    expect(document.activeElement).toBe(trigger())
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
// ⭐ Wave 10 (10D, R-16): the export door's telemetry — fired on SUCCESS, from the rendered
// action, carrying the format and nothing of the note (never its title or id).
describe('export_used — the door says a note left as a file, and nothing about the note', () => {
  it('a downloaded format sends ONE export_used with the format and scope', async () => {
    global.fetch.mockResolvedValue(fileResponse('attachment; filename="Plan.docx"'))
    render(<Host noteId="secret-note-id" />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Word (.docx)' }))
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('downloaded'))
    expect(telemetryBodies(global.fetch)).toEqual([
      { event: 'export_used', props: { format: 'docx', scope: 'note', count: 1 } },
    ])
    expect(JSON.stringify(telemetryBodies(global.fetch))).not.toMatch(/Plan|secret-note-id/)
  })

  it('PNG and Print count too; a refused export sends nothing', async () => {
    render(<Host />)
    pressItem('PNG')
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('PNG saved'))
    pressItem('Print')
    // Tier 1a bytes: the print module is fetched on the press, so the call lands a tick later.
    await waitFor(() => expect(printNote).toHaveBeenCalled())
    await waitFor(() => expect(telemetryBodies(global.fetch).map((b) => b.props.format)).toEqual(['png', 'print']))
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) })
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'JSON' }))
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('export failed'))
    expect(telemetryBodies(global.fetch).map((b) => b.props.format)).toEqual(['png', 'print'])
  })
})

// Lane KEYS3 (Q12): Export sits inside "More note actions", the eighth control of a panel that
// is six stops above the caret (20 keys against a budget of 12). The command palette's
// "Export this note" asks for this door: the panel opens, the Export menu opens, and focus is
// on its first format, exactly where pressing Export puts it.
describe('NoteExportControls: the palette door opens the Export menu (lane KEYS3)', () => {
  function InMore() {
    const [msg, setMsg] = useState('')
    return (
      <div>
        <NoteMoreMenu>
          <button type="button">History</button>
          <NoteExportControls noteId="n1" title="Plan" columnRef={{ current: null }} onMessage={setMsg} />
        </NoteMoreMenu>
        <p data-testid="chrome-msg">{msg}</p>
      </div>
    )
  }

  it('the door opens More, opens the menu and puts focus on the first format', async () => {
    render(<InMore />)
    const panel = document.querySelector('[role="group"][aria-label="More note actions"]')
    expect(panel.hidden).toBe(true)
    let took
    act(() => { took = openNotebookDoor(NOTEBOOK_DOORS.EXPORT) })
    expect(took).toBe(true)
    expect(panel.hidden).toBe(false)
    const items = await screen.findAllByRole('menuitem')
    // Notebook simplify, Task 4: PNG and Print first, then the formats; focus is on the first FORMAT, where pressing
    // Export puts it. Simplify pass 2 (C3): in the panel they are its second view, so "Back" comes first.
    expect(items.map((i) => i.getAttribute('aria-label')))
      .toEqual(['Back to More note actions', ...SCREEN_ITEMS, ...EXPORT_FORMATS.map((f) => f.menuLabel)])
    await waitFor(() => expect(document.activeElement).toBe(items[1]))
  })

  // Simplify pass 2 (C3): one "Export" row in the panel; its formats are a second view of the panel, held to the same
  // contract as the menu engine's second views by the same kit (Review focus 5).
  const morePanel = () => document.querySelector('[role="group"][aria-label="More note actions"]')
  const openPanel = () => { fireEvent.click(screen.getByRole('button', { name: 'More note actions' })); return morePanel() }
  const FORMAT_NAMES = [...SCREEN_ITEMS, ...EXPORT_FORMATS.map((f) => f.menuLabel)]

  it('C3: the panel shows ONE Export row; its formats swap in for the panel content, in today\'s order', async () => {
    render(<InMore />)
    const panel = openPanel()
    expect(within(panel).queryAllByRole('menuitem')).toHaveLength(0)
    fireEvent.click(within(panel).getByRole('button', { name: /^Export/ }))
    // the panel's other rows are hidden (kept, not unmounted), and the formats are drawn INSIDE the panel
    expect(within(panel).getByRole('button', { name: 'History', hidden: true }).closest('[hidden]')).not.toBeNull()
    const menu = within(panel).getByRole('menu', { name: 'Export this note as' })
    expect(within(menu).getAllByRole('menuitem').map((i) => i.getAttribute('aria-label')))
      .toEqual(['Back to More note actions', ...FORMAT_NAMES])
    await waitFor(() => expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'PNG' })))
  })

  it('C3: Export meets the shared second-view contract (Back, Left, Escape; a second Escape closes the panel)', async () => {
    render(<InMore />)
    await expectSecondView({
      openMenu: openPanel, parentRowName: 'Export', childRowNames: FORMAT_NAMES,
      trigger: () => screen.getByRole('button', { name: 'More note actions' }),
    })
  })

  it('C3: a format picked from the panel still downloads, and focus comes back to Export', async () => {
    // Follow-up A: the format press also posts `menu_row_used` to the telemetry door, so the file is answered by URL.
    global.fetch.mockImplementation(async (url) => (url === '/api/j2/telemetry'
      ? { ok: true } : fileResponse('attachment; filename="Plan.json"')))
    render(<InMore />)
    const panel = openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: /^Export/ }))
    fireEvent.click(within(panel).getByRole('menuitem', { name: 'JSON' }))
    await waitFor(() => expect(screen.getByTestId('chrome-msg').textContent).toBe('downloaded'))
    expect(featureCalls(global.fetch)[0][0]).toContain('format=json')
    // Follow-up A: the Export row and the JSON row each count once, by their ids (exactly these props).
    expect(telemetryBodies(global.fetch).filter((b) => b.event === 'menu_row_used')).toEqual([
      { event: 'menu_row_used', props: { menu: 'note_more', row: 'export' } },
      { event: 'menu_row_used', props: { menu: 'note_more', row: 'export_json' } },
    ])
    expect(within(panel).queryByRole('menu')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(within(panel).getByRole('button', { name: /^Export/ })))
  })

  it('C3: a closed panel reopens on its first view', () => {
    render(<InMore />)
    const panel = openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: /^Export/ }))
    fireEvent.mouseDown(document.body)
    expect(panel.hidden).toBe(true)
    openPanel()
    expect(within(panel).queryByRole('menu')).toBeNull()
    expect(within(panel).getByRole('button', { name: 'History' })).toBeTruthy()
  })

  it('outside a More panel the door still opens the menu (the controls alone)', async () => {
    render(<Host />)
    act(() => { openNotebookDoor(NOTEBOOK_DOORS.EXPORT) })
    const items = await screen.findAllByRole('menuitem')
    await waitFor(() => expect(document.activeElement).toBe(items[0]))
  })

  it('CONTROL: another door does nothing here', () => {
    render(<InMore />)
    let took
    act(() => { took = openNotebookDoor('some-other-door') })
    expect(took).toBe(false)
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    expect(document.querySelector('[role="group"][aria-label="More note actions"]').hidden).toBe(true)
  })
})

// Simplify pass 2 (first-open bytes): the menu's rows, keys and outside press are a chunk of their own, fetched on idle
// into a module slot (lib/heldModule.js). A press before it lands opens the menu when it lands; a fetch that fails says
// so on the chrome line and opens nothing.
describe('NoteExportControls: the menu is a held chunk', () => {
  afterEach(async () => { exportMenuModule.resetForTests(); await exportMenuModule.warm() })

  it('a cold press opens the menu once the chunk is in hand, focus on the first format', async () => {
    exportMenuModule.resetForTests()
    render(<Host />)
    fireEvent.click(trigger())
    const items = await screen.findAllByRole('menuitem')
    expect(items[0]).toHaveAttribute('aria-label', 'PNG')
    await waitFor(() => expect(document.activeElement).toBe(items[0]))
  })

  it('CONTROL: with the chunk in hand the press opens it in the same commit (no wait)', () => {
    render(<Host />)
    fireEvent.click(trigger())
    expect(screen.getByRole('menu', { name: 'Export this note as' })).toBeTruthy()
    expect(trigger()).not.toHaveAttribute('aria-busy')
    expect(trigger().textContent).toBe('Export')
  })

  // Final fix M8: a cold press is heard at once, opens only where the member still is, and a failed fetch says so with
  // a Reload the member presses.
  const hold = () => {
    let open
    const gate = new Promise((r) => { open = r })
    const real = exportMenuLoader.load
    exportMenuLoader.load = () => gate.then(() => real())
    return { release: () => open(), restore: () => { exportMenuLoader.load = real } }
  }

  it('M8: a cold press shows "Export…" with aria-busy at once; the formats open when the chunk lands', async () => {
    exportMenuModule.resetForTests()
    const h = hold()
    try {
      render(<Host />)
      trigger().focus()
      fireEvent.click(trigger())
      expect(trigger().textContent).toBe(EXPORT_WAITING)
      expect(trigger()).toHaveAttribute('aria-busy', 'true')
      expect(screen.queryByRole('menu')).toBeNull()
      await act(async () => { h.release() })
      const items = await screen.findAllByRole('menuitem')
      await waitFor(() => expect(document.activeElement).toBe(items[0]))
      expect(trigger()).not.toHaveAttribute('aria-busy')
    } finally { h.restore() }
  })

  it('M8: a member who moved on while the chunk loaded keeps their place: nothing opens under them', async () => {
    exportMenuModule.resetForTests()
    const h = hold()
    try {
      render(<Host />)
      trigger().focus()
      fireEvent.click(trigger())
      const elsewhere = screen.getByRole('button', { name: 'elsewhere in the note' })
      elsewhere.focus()
      await act(async () => { h.release() })
      await waitFor(() => expect(trigger().textContent).toBe('Export'))
      expect(screen.queryByRole('menu')).toBeNull()
      expect(document.activeElement).toBe(elsewhere)
    } finally { h.restore() }
  })

  it('M8: in the More panel, focus still inside the panel: the formats open when the chunk lands', async () => {
    exportMenuModule.resetForTests()
    const h = hold()
    try {
      render(
        <NoteMoreMenu>
          <button type="button">History</button>
          <NoteExportControls noteId="n1" title="Plan" columnRef={{ current: null }} onMessage={() => {}} />
        </NoteMoreMenu>,
      )
      fireEvent.click(screen.getByRole('button', { name: 'More note actions' }))
      const exp = screen.getByRole('button', { name: /^Export/ })
      exp.focus()
      fireEvent.click(exp)
      screen.getByRole('button', { name: 'History' }).focus()            // still inside the panel
      await act(async () => { h.release() })
      expect(await screen.findByRole('menu', { name: 'Export this note as' })).toBeTruthy()
    } finally { h.restore() }
  })

  it('M8: ArrowRight on the panel’s Export row opens the formats', async () => {
    render(
      <NoteMoreMenu>
        <NoteExportControls noteId="n1" title="Plan" columnRef={{ current: null }} onMessage={() => {}} />
      </NoteMoreMenu>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'More note actions' }))
    const exp = screen.getByRole('button', { name: /^Export/ })
    exp.focus()
    fireEvent.keyDown(exp, { key: 'ArrowRight' })
    const menu = await screen.findByRole('menu', { name: 'Export this note as' })
    await waitFor(() => expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'PNG' })))
  })

  it('CONTROL: alone (no panel) ArrowRight is not the door; ArrowDown is', () => {
    render(<Host />)
    trigger().focus()
    fireEvent.keyDown(trigger(), { key: 'ArrowRight' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    expect(screen.getByRole('menu', { name: 'Export this note as' })).toBeTruthy()
  })

  it('M8: a chunk that cannot be fetched says so beside Export, with a Reload the member presses', async () => {
    exportMenuModule.resetForTests()
    const real = exportMenuLoader.load
    exportMenuLoader.load = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'))
    const reload = vi.spyOn(pageReload, 'run').mockImplementation(() => {})
    try {
      render(<Host />)
      trigger().focus()
      fireEvent.click(trigger())
      const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
      expect(alert).toHaveTextContent(EXPORT_UNAVAILABLE)
      expect(EXPORT_UNAVAILABLE).toBe('Export could not be loaded. Reload the page to get this back.')   // Find's and Ask's words
      expect(screen.getByTestId('chrome-msg').textContent).not.toBe('export failed')
      expect(screen.queryByRole('menu')).toBeNull()
      expect(trigger().textContent).toBe('Export')
      expect(reload).not.toHaveBeenCalled()                                  // never an automatic reload
      fireEvent.click(within(alert).getByRole('button', { name: 'Reload' }))
      expect(reload).toHaveBeenCalledTimes(1)
    } finally { exportMenuLoader.load = real }
  })
})
