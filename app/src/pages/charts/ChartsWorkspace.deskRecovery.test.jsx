// A popped board's widgets leave the saved layout, so until it is docked again the desk store's
// record is the only copy that survives a reload, crash or route change. These cases walk the real
// event order: the fake popup's close() fires its own beforeunload listeners (W-01), then
// beforeunload and pagehide on the opener, then a remount.
//
// Same mock shape as ChartsWorkspace.memberSwitch.test.jsx.
import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('./WidgetHost', () => ({
  default: ({ widget, onRemove }) => (
    <div data-testid={`body-${widget.id}`}>
      {widget.type}
      <button data-testid={`remove-${widget.id}`} onClick={onRemove}>x</button>
    </div>
  ),
}))
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div data-testid="mobile-charts-app">MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div data-testid="multichart-grid">GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div data-testid="multichart-menu">MC MENU</div> }))
vi.mock('react-grid-layout', () => ({
  Responsive: ({ children, onLayoutChange }) => (
    <div data-testid="rgl-responsive">
      <button data-testid="rgl-fire-change" onClick={() => onLayoutChange && onLayoutChange([{ i: 'fake', x: 0, y: 0, w: 6, h: 6 }])}>fire</button>
      {children}
    </div>
  ),
  WidthProvider: (C) => C,
}))

const setPref = vi.fn()
const setPrefMerged = vi.fn()
let mockPrefs = {}
let mockPrefsLoading = false
let mockReadFailed = false
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, setPrefMerged, loading: mockPrefsLoading, readFailed: mockReadFailed }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
  refreshPreferences: vi.fn(),
  whenWritesSettle: () => Promise.resolve(),
}))
vi.mock('../../hooks/useMediaQuery', () => ({ default: () => false }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'user' } }) }))
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({
    global: [], mine: [], isLoading: false,
    saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {},
  }),
}))

import ChartsWorkspace from './ChartsWorkspace'
import { publishPrefsUser, __resetPrefsSessionForTests } from '../../lib/prefsSession'

const widget = (id, x = 0) => ({ id, type: 'scanner', color: 'C', x, y: 0, w: 6, h: 10, opts: {} })
const board = (...widgets) => JSON.stringify({ widgets, cols: 24, version: 1 })
const recordKey = (uid, id) => `uct.desk.v1:${uid}:${id}`
const readRecord = (uid, id) => JSON.parse(localStorage.getItem(recordKey(uid, id)))
const recordKeys = () => Object.keys(localStorage).filter((k) => k.startsWith('uct.desk.v1:'))
const seedOrphan = (uid, id, widgets) => localStorage.setItem(recordKey(uid, id), JSON.stringify({
  kind: 'board', id, widgets, windowName: `uct-board-${id}`, tabId: 'a-page-that-is-gone',
}))
const layoutWrites = () => setPref.mock.calls.filter(([k]) => k === 'charts_workspace_layout').map(([, v]) => JSON.parse(v))
const idsOf = (written) => written.widgets.map((w) => w.id)

// Web Locks as the browser runs it: one holder per name, freed by the holder's callback settling.
function installLocks() {
  const held = new Set()
  const waiting = new Map()
  const grant = (name, cb, resolve) => {
    held.add(name)
    Promise.resolve(cb()).then((v) => {
      held.delete(name)
      resolve(v)
      const next = waiting.get(name)?.shift()
      if (next) grant(name, next.cb, next.resolve)
    })
  }
  const locks = {
    request: (name, cb) => new Promise((resolve) => {
      if (held.has(name)) (waiting.get(name) || waiting.set(name, []).get(name)).push({ cb, resolve })
      else grant(name, cb, resolve)
    }),
    query: async () => ({ held: [...held].map((name) => ({ name })) }),
    // What the browser does when a page dies: its locks are gone, nobody released anything.
    killAll: () => { held.clear(); waiting.clear() },
    hold: (name) => held.add(name),
  }
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks })
  return locks
}

// A lock request the browser never answers: saveRecord refuses for as long as that lasts.
function installStuckLocks() {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: () => new Promise(() => {}), query: async () => ({ held: [] }) },
  })
}

function makeFakeWindow() {
  const doc = document.implementation.createHTMLDocument('popup')
  const listeners = {}
  const fake = {
    document: doc,
    closed: false,
    KeyboardEvent: window.KeyboardEvent,
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn) },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn) },
    history: { replaceState: vi.fn() },
    _fire: (t) => (listeners[t] || []).forEach((fn) => fn()),
    close: vi.fn(() => { fake.closed = true; fake._fire('beforeunload') }),
  }
  return fake
}

const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() })
const tree = () => <MemoryRouter><ChartsWorkspace /></MemoryRouter>
async function renderWS() {
  const view = render(tree())
  await flush()
  return view
}
function popOut() {
  act(() => { fireEvent.click(screen.getByText('Layouts ▾')) })
  act(() => { fireEvent.click(screen.getByText('⧉ Pop Out Layout')) })
}
const restoreButton = () => screen.queryByTestId('workspace-notice-action')
const noticeText = () => screen.queryByTestId('workspace-notice')?.textContent ?? ''
async function clickRestore() {
  fireEvent.click(restoreButton())
  await flush()
}
function unloadOpener() {
  act(() => {
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
    window.dispatchEvent(new Event('pagehide'))
  })
}
const popId = () => recordKeys()[0].split(':').pop()

let openSpy
let locks

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  setPref.mockReset()
  setPref.mockResolvedValue(true)
  setPrefMerged.mockReset()
  localStorage.clear()
  __resetPrefsSessionForTests()
  publishPrefsUser('A')
  mockPrefs = { charts_workspace_layout: board(widget('a1'), widget('a2', 6)) }
  mockPrefsLoading = false
  mockReadFailed = false
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
  locks = installLocks()
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => makeFakeWindow())
})
afterEach(() => {
  openSpy.mockRestore()
  vi.restoreAllMocks()
  vi.useRealTimers()
  delete globalThis.fetch
  delete navigator.locks
  __resetPrefsSessionForTests()
  window.history.replaceState({}, '', '/')
})

describe('popping a board out', () => {
  test('writes the record before the board is saved without its widgets', async () => {
    await renderWS()
    popOut()
    expect(recordKeys()).toHaveLength(1)
    expect(layoutWrites()).toEqual([])                 // the 500 ms save has not run
    const rec = readRecord('A', popId())
    expect(rec).toMatchObject({ kind: 'board', id: popId() })
    expect(rec.widgets.map((w) => w.id)).toEqual(['a1', 'a2'])
  })

  test('a board change inside the window reaches the record, in the last 500 ms too', async () => {
    const fake = makeFakeWindow()
    openSpy.mockImplementation(() => fake)
    await renderWS()
    popOut()
    act(() => { fake.document.querySelector('[data-testid="remove-a1"]').click() })
    await flush()
    act(() => { window.dispatchEvent(new Event('beforeunload', { cancelable: true })) })
    expect(readRecord('A', popId()).widgets.map((w) => w.id)).toEqual(['a2'])
  })

  test('tells the member when the record could not be stored, and still opens the window', async () => {
    const fake = makeFakeWindow()
    openSpy.mockImplementation(() => fake)
    await renderWS()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    popOut()
    expect(screen.getByRole('alert')).toHaveTextContent(/not crash-safe/i)
    expect(fake.document.querySelector('[data-testid="body-a1"]')).toBeTruthy()
  })

  test('tells the member when the owner lock has not been granted, and still opens the window', async () => {
    installStuckLocks()
    const fake = makeFakeWindow()
    openSpy.mockImplementation(() => fake)
    await renderWS()
    popOut()
    expect(recordKeys()).toEqual([])
    expect(screen.getByRole('alert')).toHaveTextContent(/not crash-safe/i)
    expect(fake.document.querySelector('[data-testid="body-a1"]')).toBeTruthy()
  })
})

describe('the real unload order', () => {
  test('popup beforeunload, opener beforeunload, pagehide, remount: the board is still offered', async () => {
    const fake = makeFakeWindow()
    openSpy.mockImplementation(() => fake)
    const first = await renderWS()
    popOut()
    const id = popId()

    unloadOpener()
    expect(fake.close).toHaveBeenCalled()
    expect(screen.queryByTestId('body-a1')).toBeNull()   // the closing popup did not dock itself

    act(() => { vi.advanceTimersByTime(1000) })           // the blank board's save lands
    await flush()
    expect(recordKeys()).toEqual([recordKey('A', id)])

    first.unmount()
    locks.killAll()
    mockPrefs = { charts_workspace_layout: board() }
    await renderWS()

    expect(restoreButton()).toBeTruthy()
    expect(noticeText()).toMatch(/2 widgets/)
    expect(screen.queryByTestId('body-a1')).toBeNull()    // offered, never auto-docked
    await clickRestore()
    expect(screen.getByTestId('body-a1')).toBeInTheDocument()
    expect(screen.getByTestId('body-a2')).toBeInTheDocument()
    expect(idsOf(layoutWrites().at(-1))).toEqual(['a1', 'a2'])
    expect(recordKeys()).toEqual([])
  })

  test('the offer stays up: it is not on a timer', async () => {
    seedOrphan('A', 'pl-1', [widget('r1')])
    await renderWS()
    act(() => { vi.advanceTimersByTime(60000) })
    expect(restoreButton()).toBeTruthy()
  })

  test('a live tab\'s board is not offered', async () => {
    localStorage.setItem(recordKey('A', 'pl-1'), JSON.stringify({ kind: 'board', id: 'pl-1', widgets: [widget('r1')], tabId: 'live' }))
    locks.hold('uct.desk.owner:A:live')
    await renderWS()
    expect(restoreButton()).toBeNull()
  })
})

describe('leaving /charts without a reload', () => {
  test('the record survives the unmount and is offered on the way back', async () => {
    const first = await renderWS()
    popOut()
    const id = popId()
    first.unmount()                                       // a NavBar click: no beforeunload, no pagehide
    await flush()
    expect(recordKeys()).toEqual([recordKey('A', id)])

    mockPrefs = { charts_workspace_layout: board() }
    await renderWS()
    expect(noticeText()).toMatch(/2 widgets/)
  })

  test('another tab can pick it up as soon as the workspace is gone', async () => {
    const first = await renderWS()
    popOut()
    first.unmount()
    await flush()
    const snap = await navigator.locks.query()
    expect(snap.held).toEqual([])
  })
})

describe('closing the window yourself', () => {
  test('docks the board, and the record goes only once the save has landed', async () => {
    const fake = makeFakeWindow()
    openSpy.mockImplementation(() => fake)
    let landed
    setPref.mockImplementation(() => new Promise((r) => { landed = r }))
    await renderWS()
    popOut()
    act(() => { fake._fire('beforeunload') })
    expect(screen.getByTestId('body-a1')).toBeInTheDocument()
    expect(recordKeys()).toHaveLength(1)

    act(() => { vi.advanceTimersByTime(600) })
    await flush()
    expect(recordKeys()).toHaveLength(1)                  // written, not yet confirmed
    await act(async () => { landed(true) })
    await flush()
    expect(recordKeys()).toEqual([])
  })

  test('a refused save keeps the record', async () => {
    const fake = makeFakeWindow()
    openSpy.mockImplementation(() => fake)
    setPref.mockResolvedValue(false)
    await renderWS()
    popOut()
    act(() => { fake._fire('beforeunload') })
    act(() => { vi.advanceTimersByTime(600) })
    await flush()
    expect(recordKeys()).toHaveLength(1)
  })

  describe('a record goes only with a save that holds its widgets', () => {
    async function dockWithRefusedSave() {
      const fake = makeFakeWindow()
      openSpy.mockImplementation(() => fake)
      setPref.mockResolvedValue(false)
      await renderWS()
      popOut()
      act(() => { fake._fire('beforeunload') })
      act(() => { vi.advanceTimersByTime(600) })
      await flush()
      expect(recordKeys()).toHaveLength(1)
      setPref.mockResolvedValue(true)
    }
    async function drag() {
      const before = layoutWrites().length
      act(() => { fireEvent.click(screen.getByTestId('rgl-fire-change')) })
      act(() => { vi.advanceTimersByTime(600) })
      await flush()
      expect(layoutWrites().length).toBeGreaterThan(before)    // the save really ran
    }

    test('dock, refused save, board replaced, later confirmed save: the record stays', async () => {
      await dockWithRefusedSave()
      act(() => { fireEvent.click(screen.getByText('Layouts ▾')) })
      act(() => { fireEvent.click(screen.getByText('Open Layout ▸')) })
      act(() => { fireEvent.click(screen.getAllByText('UCT Default')[0]) })
      await flush()
      act(() => { vi.advanceTimersByTime(3000) })
      await flush()
      expect(screen.queryByTestId('body-a1')).toBeNull()       // the docked widgets are off the board

      await drag()
      expect(idsOf(layoutWrites().at(-1))).not.toContain('a1')
      expect(recordKeys()).toHaveLength(1)
      expect(readRecord('A', popId()).widgets.map((w) => w.id)).toEqual(['a1', 'a2'])
    })

    test('control: dock, refused save, later confirmed save that holds them: the record goes', async () => {
      await dockWithRefusedSave()
      await drag()
      expect(idsOf(layoutWrites().at(-1))).toEqual(['a1', 'a2'])
      expect(recordKeys()).toEqual([])
    })

    test('a save holding only some of its widgets keeps the record', async () => {
      await dockWithRefusedSave()
      act(() => { fireEvent.click(screen.getByTestId('remove-a1')) })
      act(() => { vi.advanceTimersByTime(600) })
      await flush()
      expect(idsOf(layoutWrites().at(-1))).toEqual(['a2'])
      expect(recordKeys()).toHaveLength(1)
    })
  })

  test('a widget edit after the dock cannot write the record back', async () => {
    const fake = makeFakeWindow()
    openSpy.mockImplementation(() => fake)
    await renderWS()
    popOut()
    act(() => { fake._fire('beforeunload') })
    act(() => { vi.advanceTimersByTime(600) })
    await flush()
    act(() => { window.dispatchEvent(new Event('beforeunload', { cancelable: true })) })
    expect(recordKeys()).toEqual([])
  })
})

describe('the restore', () => {
  test('waits for the board to load, and late preferences do not overwrite it', async () => {
    seedOrphan('A', 'pl-1', [widget('r1', 12)])
    mockPrefsLoading = true
    mockPrefs = {}
    const view = await renderWS()
    expect(restoreButton()).toBeNull()

    mockPrefsLoading = false
    mockPrefs = { charts_workspace_layout: board(widget('a1')) }
    view.rerender(tree())
    await flush()
    expect(restoreButton()).toBeTruthy()

    await clickRestore()
    expect(screen.getByTestId('body-a1')).toBeInTheDocument()
    expect(screen.getByTestId('body-r1')).toBeInTheDocument()
    expect(idsOf(layoutWrites().at(-1))).toEqual(['a1', 'r1'])

    mockPrefs = { charts_workspace_layout: board(widget('a1')) }   // a revalidation answers late
    view.rerender(tree())
    await flush()
    expect(screen.getByTestId('body-r1')).toBeInTheDocument()
  })

  test('a failed preferences read offers nothing, and a later good read does', async () => {
    seedOrphan('A', 'pl-1', [widget('r1', 12)])
    mockReadFailed = true                                   // between SWR retries: not loading, no stored board
    mockPrefs = {}
    const view = await renderWS()
    expect(restoreButton()).toBeNull()

    mockReadFailed = false
    mockPrefs = { charts_workspace_layout: board(widget('a1')) }
    view.rerender(tree())
    await flush()
    expect(restoreButton()).toBeTruthy()

    await clickRestore()
    expect(idsOf(layoutWrites().at(-1))).toEqual(['a1', 'r1'])   // the real board, not the default
    expect(recordKeys()).toEqual([])
  })

  test('deletes the record only after the save resolves', async () => {
    seedOrphan('A', 'pl-1', [widget('r1')])
    await renderWS()
    let landed
    setPref.mockImplementation((key) => (key === 'charts_workspace_layout' ? new Promise((r) => { landed = r }) : Promise.resolve(true)))
    await clickRestore()
    expect(recordKeys()).toHaveLength(1)
    await act(async () => { landed(true) })
    await flush()
    expect(recordKeys()).toEqual([])
  })

  test('a save answering false keeps the record, takes the widgets back off, and says so', async () => {
    seedOrphan('A', 'pl-1', [widget('r1')])
    mockPrefs = { charts_workspace_layout: board(widget('a1')) }
    await renderWS()
    setPref.mockResolvedValue(false)
    await clickRestore()
    expect(recordKeys()).toHaveLength(1)
    expect(screen.queryByTestId('body-r1')).toBeNull()
    expect(noticeText()).toMatch(/not restored/i)
  })

  test('a board at the bound keeps the record and says why', async () => {
    const full = Array.from({ length: 16 }, (_, i) => widget(`f${i}`))
    seedOrphan('A', 'pl-1', [widget('r1')])
    mockPrefs = { charts_workspace_layout: board(...full) }
    await renderWS()
    await clickRestore()
    expect(recordKeys()).toHaveLength(1)
    expect(screen.queryByTestId('body-r1')).toBeNull()
    expect(layoutWrites()).toEqual([])
    expect(noticeText()).toMatch(/at most 16 widgets/)
    expect(restoreButton()).toBeTruthy()                   // close one and try again
  })

  test('a widget already on the board is not duplicated', async () => {
    seedOrphan('A', 'pl-1', [widget('a1'), widget('r1', 12)])
    mockPrefs = { charts_workspace_layout: board(widget('a1')) }
    await renderWS()
    await clickRestore()
    expect(idsOf(layoutWrites().at(-1))).toEqual(['a1', 'r1'])
    expect(recordKeys()).toEqual([])
  })

  test('a board entirely on the board already still needs its save before the record goes', async () => {
    seedOrphan('A', 'pl-1', [widget('a1')])
    mockPrefs = { charts_workspace_layout: board(widget('a1')) }
    await renderWS()
    setPref.mockResolvedValue(false)
    await clickRestore()
    expect(recordKeys()).toHaveLength(1)
  })

  test('a second orphan is offered once the first is done', async () => {
    seedOrphan('A', 'pl-1', [widget('r1')])
    seedOrphan('A', 'pl-2', [widget('r2', 6), widget('r3', 12)])
    await renderWS()
    await clickRestore()
    expect(restoreButton()).toBeTruthy()
    await clickRestore()
    expect(screen.getByTestId('body-r1')).toBeInTheDocument()
    expect(screen.getByTestId('body-r2')).toBeInTheDocument()
    expect(screen.getByTestId('body-r3')).toBeInTheDocument()
    expect(recordKeys()).toEqual([])
  })

  test('a record another tab restored first is not restored twice', async () => {
    seedOrphan('A', 'pl-1', [widget('r1')])
    await renderWS()
    localStorage.removeItem(recordKey('A', 'pl-1'))
    await clickRestore()
    expect(screen.queryByTestId('body-r1')).toBeNull()
    expect(layoutWrites()).toEqual([])
  })
})

describe('two members on one machine', () => {
  test('A\'s orphan is not offered to B and stays A\'s', async () => {
    seedOrphan('A', 'pl-1', [widget('r1')])
    publishPrefsUser('B')
    mockPrefs = { charts_workspace_layout: board(widget('b1')) }
    await renderWS()
    expect(restoreButton()).toBeNull()
    expect(recordKeys()).toEqual([recordKey('A', 'pl-1')])
  })

  test('B signing in under A\'s open pop-out files nothing under B', async () => {
    await renderWS()
    popOut()
    const id = popId()
    mockPrefs = { charts_workspace_layout: board(widget('b1')) }
    act(() => { publishPrefsUser('B') })
    await flush()
    expect(recordKeys()).toEqual([recordKey('A', id)])
    expect(readRecord('A', id).widgets.map((w) => w.id)).toEqual(['a1', 'a2'])
    expect(restoreButton()).toBeNull()
  })

  test('the same, where Web Locks is missing and no lock stands between A\'s flush and B', async () => {
    delete navigator.locks
    await renderWS()
    popOut()
    const id = popId()
    mockPrefs = { charts_workspace_layout: board(widget('b1')) }
    act(() => { publishPrefsUser('B') })
    await flush()
    expect(recordKeys()).toEqual([recordKey('A', id)])
  })

  test('no member known: no record and no offer', async () => {
    __resetPrefsSessionForTests()
    seedOrphan('A', 'pl-1', [widget('r1')])
    await renderWS()
    expect(restoreButton()).toBeNull()
    popOut()
    expect(recordKeys()).toEqual([recordKey('A', 'pl-1')])
    expect(screen.getByRole('alert')).toHaveTextContent(/not crash-safe/i)
  })
})
