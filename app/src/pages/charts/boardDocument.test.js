// TERM-021 read-new — the board-change recorder, its two runners, and the one-write commit.
import { vi } from 'vitest'
import {
  recordBoardWrites, replayBoardWrites, applyColumnsSteps, boardDocumentPatch,
  commitBoardDocument, planColumnsFold, parseColumns, BOARD_APPLY_URL, WATCHLIST_COLUMNS_KEY,
} from './boardDocument'
import { WORKSPACE_DOC_URL } from './VersionHistory'

const COLS = { order: ['sym', 'chg'], widths: { sym: 80 } }
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

function build(setPref, setWatchlistColumns) {
  setPref('charts_workspace_layout', '{"widgets":[]}')
  setPref('chart_settings', { settingsVersion: 2 })        // an object: setPref serializes it
  setWatchlistColumns(COLS)
  setPref('charts_theme', 'default')
  setPref('charts_theme', 'sunrise')                         // a later write to the same key
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { delete global.fetch })

describe('the recorder', () => {
  test('records every write in call order, raw and as stored TEXT', () => {
    const steps = recordBoardWrites(build)
    expect(steps.map(s => s.kind === 'pref' ? `${s.key}=${s.serialized}` : `cols=${JSON.stringify(s.cols)}`)).toEqual([
      'charts_workspace_layout={"widgets":[]}',
      'chart_settings={"settingsVersion":2}',
      `cols=${JSON.stringify(COLS)}`,
      'charts_theme=default',
      'charts_theme=sunrise',
    ])
    expect(steps[1].value).toEqual({ settingsVersion: 2 })     // the raw value survives for replay
  })

  test('the DARK runner replays through the writer in the same order with the SAME values, and writes localStorage', () => {
    const write = vi.fn()
    replayBoardWrites(recordBoardWrites(build), write)
    expect(write.mock.calls).toEqual([
      ['charts_workspace_layout', '{"widgets":[]}'],
      ['chart_settings', { settingsVersion: 2 }],
      ['charts_theme', 'default'],
      ['charts_theme', 'sunrise'],
    ])
    expect(JSON.parse(localStorage.getItem('uct.watchlist.cols'))).toEqual(COLS)
  })

  test('a recorded CLEAR removes the localStorage copy, exactly as the old code did', () => {
    localStorage.setItem('uct.watchlist.cols', JSON.stringify(COLS))
    replayBoardWrites(recordBoardWrites((_p, cols) => cols(null)), vi.fn())
    expect(localStorage.getItem('uct.watchlist.cols')).toBeNull()
  })

  test('the patch is what sequential writes would leave: last write wins, columns become watchlist_columns', () => {
    expect(boardDocumentPatch(recordBoardWrites(build))).toEqual({
      charts_workspace_layout: '{"widgets":[]}',
      chart_settings: '{"settingsVersion":2}',
      [WATCHLIST_COLUMNS_KEY]: JSON.stringify(COLS),
      charts_theme: 'sunrise',
    })
    expect(boardDocumentPatch(recordBoardWrites((_p, cols) => cols(null)))).toEqual({ [WATCHLIST_COLUMNS_KEY]: '' })
  })

  test('applyColumnsSteps runs ONLY the localStorage half (the prefs half is already in the document)', () => {
    applyColumnsSteps(recordBoardWrites(build))
    expect(JSON.parse(localStorage.getItem('uct.watchlist.cols'))).toEqual(COLS)
  })
})

describe('commitBoardDocument — one compare-and-set write on the head read just before it', () => {
  function server({ head = res(200, { version: 7, doc: {} }), apply = res(200, { version: 8, appended: true }) } = {}) {
    return vi.fn(async (url, init) => {
      const method = (init?.method || 'GET').toUpperCase()
      if (method === 'GET' && String(url) === `${WORKSPACE_DOC_URL}?board=charts`) return head
      if (method === 'POST' && String(url) === BOARD_APPLY_URL) return apply
      return res(500, {})
    })
  }

  test('applied: ONE apply POST, carrying every key, on the head version it read', async () => {
    global.fetch = server()
    const patch = { charts_theme: 'default', watchlist_columns: '' }
    const r = await commitBoardDocument(patch)
    expect(r.status).toBe('applied')
    const posts = global.fetch.mock.calls.filter(([, i]) => i?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(JSON.parse(posts[0][1].body)).toEqual({ board: 'charts', base_version: 7, prefs: patch })
  })

  test('409 is a CONFLICT and is not retried', async () => {
    global.fetch = server({ apply: res(409, { detail: { error: 'version_conflict', base_version: 7, head_version: 8 } }) })
    const r = await commitBoardDocument({ charts_theme: 'x' })
    expect(r.status).toBe('conflict')
    expect(global.fetch.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1)
  })

  test('a 404 on either request means the store is DARK — the caller takes the per-key path', async () => {
    global.fetch = server({ head: res(404, { detail: 'Not Found' }) })
    expect((await commitBoardDocument({ charts_theme: 'x' })).status).toBe('dark')
    expect(global.fetch.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(0)
    global.fetch = server({ apply: res(404, { detail: 'Not Found' }) })
    expect((await commitBoardDocument({ charts_theme: 'x' })).status).toBe('dark')
  })

  test('anything else is FAILED and claims nothing', async () => {
    global.fetch = server({ apply: res(500, {}) })
    expect((await commitBoardDocument({ charts_theme: 'x' })).status).toBe('failed')
    global.fetch = server({ head: res(200, { version: 'x' }) })
    expect((await commitBoardDocument({ charts_theme: 'x' })).status).toBe('failed')
    global.fetch = vi.fn(async () => { throw new TypeError('network') })
    expect((await commitBoardDocument({ charts_theme: 'x' })).status).toBe('failed')
  })
})

describe('the Watchlist-columns fold is NON-DESTRUCTIVE', () => {
  const raw = JSON.stringify(COLS)

  test('the migration READ: localStorage holds columns the document lacks → copy them in, remove nothing', () => {
    expect(planColumnsFold(undefined, raw)).toEqual({ write: raw, fill: null })
    expect(planColumnsFold('', raw)).toEqual({ write: raw, fill: null })          // cleared by a prebuilt, edited since
  })

  test('already in step → nothing to do', () => {
    expect(planColumnsFold(raw, raw)).toEqual({ write: null, fill: null })
    expect(planColumnsFold(JSON.stringify(COLS, null, 2), raw)).toEqual({ write: null, fill: null })
  })

  test('a newer local edit is copied in; the local value is never replaced from the document', () => {
    const edited = JSON.stringify({ order: ['sym'] })
    expect(planColumnsFold(raw, edited)).toEqual({ write: edited, fill: null })
  })

  test('a new device (nothing local) is filled from the document', () => {
    expect(planColumnsFold(raw, null)).toEqual({ write: null, fill: raw })
  })

  test('an unreadable local value is neither copied nor overwritten', () => {
    expect(planColumnsFold(raw, '{not json')).toEqual({ write: null, fill: null })
    expect(planColumnsFold(undefined, '[1,2]')).toEqual({ write: null, fill: null })
  })

  test('the plan has no removal in it — no input yields anything but a write or a fill', () => {
    for (const stored of [undefined, null, '', raw, '{bad']) {
      for (const local of [null, '', raw, '{bad', '[]']) {
        const p = planColumnsFold(stored, local)
        expect(Object.keys(p).sort()).toEqual(['fill', 'write'])
        if (p.fill != null) expect(parseColumns(p.fill)).toBeTruthy()
        if (p.write != null) expect(parseColumns(p.write)).toBeTruthy()
      }
    }
  })
})
