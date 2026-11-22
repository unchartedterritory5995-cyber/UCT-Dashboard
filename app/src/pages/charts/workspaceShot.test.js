// Screenshot workspace (owner 11-16): the lazy capture module's pure parts + its one seam to
// modern-screenshot. The library is mocked; the board is a plain element with a measured rect.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { domToBlob, createContext, destroyContext } = vi.hoisted(() => ({
  domToBlob: vi.fn(),
  // a context is a plain object the library mutates; the module sets the per-capture fields on it
  createContext: vi.fn(async (node, opts) => ({ __CONTEXT__: true, node, ...opts })),
  destroyContext: vi.fn(),
}))
vi.mock('modern-screenshot', () => ({ domToBlob, createContext, destroyContext }))

import {
  workspaceShotFilename, shotScale, makeShotFilter, captureWorkspace, copyPng, downloadBlob, SHOT_MAX_EDGE,
  SHOT_STYLE_PROPS, warmWorkspaceShot, _resetShotContext,
} from './workspaceShot'

function boardOf(w, h) {
  const el = document.createElement('main')
  el.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: w, height: h, right: w, bottom: h })
  document.body.appendChild(el)
  return el
}

describe('workspaceShotFilename', () => {
  const when = new Date(2026, 10, 16, 9, 5)
  it('is UCT-workspace-<layout>-<YYYY-MM-DD-HHmm>.png in local time', () => {
    expect(workspaceShotFilename('UCT Default', when)).toBe('UCT-workspace-UCT-Default-2026-11-16-0905.png')
  })
  it('keeps only file-system-safe characters', () => {
    expect(workspaceShotFilename('  Swing / Momentum: “Q4” ✨ Café ', when)).toBe('UCT-workspace-Swing-Momentum-Q4-Cafe-2026-11-16-0905.png')
    expect(workspaceShotFilename('a:b?c*d|e<f>g', when)).toMatch(/^UCT-workspace-a-b-c-d-e-f-g-2026-11-16-0905\.png$/)
  })
  it('falls back to "board" for an empty or symbol-only name, and caps a long one', () => {
    expect(workspaceShotFilename('', when)).toBe('UCT-workspace-board-2026-11-16-0905.png')
    expect(workspaceShotFilename('///', when)).toBe('UCT-workspace-board-2026-11-16-0905.png')
    const long = workspaceShotFilename('x'.repeat(200), when)
    expect(long.length).toBeLessThan(100)
  })
})

describe('shotScale', () => {
  it('is max(2, devicePixelRatio)', () => {
    expect(shotScale(1600, 900, 1)).toBe(2)
    expect(shotScale(1600, 900, 1.25)).toBe(2)
    expect(shotScale(1600, 900, 3)).toBe(3)
  })
  it('caps the long side of the output at SHOT_MAX_EDGE', () => {
    const sc = shotScale(5000, 1000, 2)
    expect(5000 * sc).toBeLessThanOrEqual(SHOT_MAX_EDGE)
    expect(Math.round(5000 * sc)).toBe(SHOT_MAX_EDGE)
  })
})

describe('makeShotFilter', () => {
  const keep = makeShotFilter(['rzHash_1', undefined])
  const el = (tag, attrs = {}, cls = []) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); n.classList.add(...cls); return n }
  it('drops transient UI: menus, tooltips, resize/drag handles, marked nodes', () => {
    expect(keep(el('div', { role: 'menu' }))).toBe(false)
    expect(keep(el('div', { role: 'tooltip' }))).toBe(false)
    expect(keep(el('div', { 'data-guide': 'widget.resize.se' }))).toBe(false)
    expect(keep(el('div', { 'aria-label': 'Drag to move widget' }))).toBe(false)
    expect(keep(el('span', {}, ['react-resizable-handle']))).toBe(false)
    expect(keep(el('div', {}, ['react-grid-placeholder']))).toBe(false)
    expect(keep(el('div', {}, ['rzHash_1']))).toBe(false)
    expect(keep(el('div', { 'data-shot-exclude': '' }))).toBe(false)
  })
  it('drops images that never loaded and display:none subtrees', () => {
    const img = el('img')
    Object.defineProperty(img, 'complete', { value: false })
    expect(keep(img)).toBe(false)
    const hidden = el('div', { style: 'display:none' })
    document.body.appendChild(hidden)
    expect(keep(hidden)).toBe(false)
    hidden.remove()
  })
  it('keeps the board, widget headers, canvases and text', () => {
    expect(keep(el('div', { class: 'widgetHeader' }))).toBe(true)
    expect(keep(el('canvas'))).toBe(true)
    expect(keep(document.createTextNode('AAPL'))).toBe(true)
  })
})

describe('captureWorkspace', () => {
  beforeEach(() => {
    domToBlob.mockReset(); createContext.mockClear(); destroyContext.mockClear()
    _resetShotContext(); window.devicePixelRatio = 1
  })
  afterEach(() => { document.body.innerHTML = '' })

  it('rasterizes exactly the element it is given, at scale >= 2, as PNG', async () => {
    domToBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    const board = boardOf(1500, 800)
    const res = await captureWorkspace(board, { layoutName: 'My board', now: new Date(2026, 0, 2, 3, 4) })
    expect(createContext).toHaveBeenCalledTimes(1)
    expect(createContext.mock.calls[0][0]).toBe(board)
    expect(createContext.mock.calls[0][1].includeStyleProperties).toBe(SHOT_STYLE_PROPS)
    expect(createContext.mock.calls[0][1].autoDestruct).toBe(false)
    expect(createContext.mock.calls[0][1].fetch.placeholderImage).toMatch(/^data:image\/png/)
    expect(domToBlob).toHaveBeenCalledTimes(1)
    const [ctx] = domToBlob.mock.calls[0]
    expect(ctx.node).toBe(board)
    expect(ctx.type).toBe('image/png')
    expect(ctx).toMatchObject({ scale: 2, width: 1500, height: 800, dpi: 192 })
    expect(typeof ctx.filter).toBe('function')
    expect(res).toMatchObject({ width: 3000, height: 1600, filename: 'UCT-workspace-My-board-2026-01-02-0304.png' })
  })
  it('reuses one context per board across clicks (and from the hover warm-up), re-sizing it each time', async () => {
    domToBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    const board = boardOf(1000, 500)
    await warmWorkspaceShot(board)
    expect(createContext).toHaveBeenCalledTimes(1)
    await captureWorkspace(board)
    board.getBoundingClientRect = () => ({ width: 1200, height: 600 })
    await captureWorkspace(board)
    expect(createContext).toHaveBeenCalledTimes(1)
    expect(domToBlob.mock.calls[1][0]).toMatchObject({ width: 1200, height: 600 })
    // a different board element gets its own context; the old one is released
    await captureWorkspace(boardOf(800, 400))
    expect(createContext).toHaveBeenCalledTimes(2)
    expect(destroyContext).toHaveBeenCalledTimes(1)
  })
  it('throws (never resolves garbage) on a missing board, a zero-size board or a failed raster, and recovers after', async () => {
    await expect(captureWorkspace(null)).rejects.toThrow()
    await expect(captureWorkspace(boardOf(0, 0))).rejects.toThrow()
    const board = boardOf(800, 600)
    domToBlob.mockRejectedValueOnce(new Error('SecurityError: tainted'))
    await expect(captureWorkspace(board)).rejects.toThrow(/tainted/)
    expect(destroyContext).toHaveBeenCalledTimes(1)
    domToBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    await expect(captureWorkspace(board)).resolves.toMatchObject({ width: 1600 })
    expect(createContext).toHaveBeenCalledTimes(2)
  })
})

describe('copyPng / downloadBlob', () => {
  afterEach(() => { delete window.ClipboardItem; vi.restoreAllMocks() })
  it('copyPng writes one image/png ClipboardItem', async () => {
    const write = vi.fn(async () => {})
    window.ClipboardItem = class { constructor(items) { this.items = items } }
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true })
    const blob = new Blob(['x'], { type: 'image/png' })
    await expect(copyPng(blob)).resolves.toBe(true)
    expect(write.mock.calls[0][0][0].items['image/png']).toBe(blob)
  })
  it('copyPng resolves false where the browser cannot copy images', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn(async () => { throw new Error('denied') }) }, configurable: true })
    await expect(copyPng(new Blob(['x']))).resolves.toBe(false)          // no ClipboardItem
    window.ClipboardItem = class {}
    await expect(copyPng(new Blob(['x']))).resolves.toBe(false)          // write rejected
  })
  it('downloadBlob clicks an anchor carrying the file name', () => {
    URL.createObjectURL = vi.fn(() => 'blob:shot')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      expect(this.download).toBe('UCT-workspace-x-2026-11-16-0905.png')
      expect(this.href).toBe('blob:shot')
    })
    downloadBlob(new Blob(['x']), 'UCT-workspace-x-2026-11-16-0905.png')
    expect(click).toHaveBeenCalledTimes(1)
  })
})
