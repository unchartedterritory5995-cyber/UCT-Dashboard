// @vitest-environment jsdom
// ⭐⭐ THE DEVICE STORE IS DEFAULT ON FOR DESKTOP ONLY (owner, 2026-11-21; #2537), INSIDE master's switch (#2549,
// #2554, #2563): the rule lives in `_defaultOn()` alone, so it decides only when NO key is stored, once per page load.
//   no key:  ON when the browser gives POSITIVE evidence of a desktop (the desktop app's bridge, or
//            DEVICE_STORE_DESKTOP_QUERY matching: styles/breakpoints MQ.desktop, a window of 1025 CSS px or more, AND a
//            primary pointer that is a mouse or a trackpad, `(hover: hover) and (pointer: fine)`: review of #2537 head
//            107dea1ee1, P-4 T2, so a touch-first tablet in landscape is not a desktop) AND the connection is not metered
//            (saveData, a cellular type, a slow-2g / 2g / 3g effectiveType where the browser reports one); otherwise OFF
//            with the reason 'default-off', which KEEPS the packs (a narrow window today, a wide one tomorrow costs no
//            download; the 30-day rule still applies)
//   '1' on (a tester's explicit choice, a phone included); '0' off AND deleted; any other stored value off, kept
//   the kills win over everything: the chart-speed kill and the device kill keep the packs, the purge deletes them
// Every case is its own page load (vi.resetModules): a resize or a connection change mid-session changes nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MQ } from '../../styles/breakpoints'

const getDeviceClient = vi.fn(() => ({ start() { return this } }))
vi.mock('./client', () => ({ getDeviceClient }))

const KEY = 'uct.deviceStore'
const FILES_KEY = 'uct.deviceStore.files'
const LAST_RUN_KEY = 'uct.deviceStore.lastRun'
const DIR = 'uct-device-store'
const NOW = Date.UTC(2026, 10, 24, 15, 0)
const DAY = 86_400_000

const realMatchMedia = window.matchMedia
/** A browser's screen: its window's `width` (CSS px) and its PRIMARY input's `pointer` ('fine' | 'coarse' | 'none') and
 *  `hover` ('hover' | 'none'). Its matchMedia EVALUATES the query it is given, every `and`-joined feature below; a
 *  query it cannot evaluate THROWS, so a new query is modelled here or the test fails by name, never answered "not a
 *  desktop" in silence (review of #2537 head 107dea1ee1, P-6: the old fake answered only the exact MQ.desktop string). */
function screen({ width, pointer, hover }) {
  const feature = (f) => {
    const m = /^\(\s*([a-z-]+)\s*:\s*([a-z0-9-]+)\s*\)$/.exec(f.trim())
    const px = (v) => { if (!/^\d+px$/.test(v)) throw new Error(`the fake screen cannot read ${v}`); return Number(v.slice(0, -2)) }
    if (m && m[1] === 'min-width') return width >= px(m[2])
    if (m && m[1] === 'max-width') return width <= px(m[2])
    if (m && m[1] === 'pointer') return pointer === m[2]
    if (m && m[1] === 'hover') return hover === m[2]
    throw new Error(`the fake screen cannot evaluate ${JSON.stringify(f)}`)
  }
  window.matchMedia = (q) => ({ matches: String(q).split(/\band\b/).map(feature).every(Boolean), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
}
/** The screens below. Pointer and hover are the PRIMARY input's, which is what `(pointer: ...)` / `(hover: ...)` read. */
const MOUSE_DESKTOP = { width: 1440, pointer: 'fine', hover: 'hover' }
const PHONE = { width: 390, pointer: 'coarse', hover: 'none' }
/** `desktop`: a mouse desktop, else a phone. */
const viewport = (desktop) => screen(desktop ? MOUSE_DESKTOP : PHONE)
function connection(c) { Object.defineProperty(navigator, 'connection', { value: c, configurable: true }) }
const clearKills = () => { document.cookie = 'uct_chart_speed=; max-age=0; path=/'; document.cookie = 'uct_device_store=; max-age=0; path=/' }

/** A new page load: the switch, the kills and source.js's once-per-page look, all evaluated afresh. */
async function pageLoad() {
  vi.resetModules()
  const sw = await import('./switch')
  const src = await import('./source')
  return { sw, src }
}
function opfs() {
  const root = { removeEntry: vi.fn(async () => {}) }
  return { storage: { getDirectory: vi.fn(async () => root) }, root }
}
/** What this page load does with a seed the store left here (the marker, and a run stamp `ranDaysAgo` days old):
 *  'deleted' | 'kept'. The BarStore asks deviceSource; the first chart paints; the page goes idle. */
async function packsAfter(src, { ranDaysAgo = 1 } = {}) {
  localStorage.setItem(FILES_KEY, '1')
  localStorage.setItem(LAST_RUN_KEY, String(NOW - ranDaysAgo * DAY))
  const painted = []
  const o = opfs()
  src.deviceSource({ afterPaint: (fn) => painted.push(fn), idle: (fn) => fn(), storage: o.storage, now: () => NOW })
  for (const fn of painted.splice(0)) fn()
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  return o.root.removeEntry.mock.calls.some((c) => c[0] === DIR) ? 'deleted' : 'kept'
}

beforeEach(() => { localStorage.clear(); clearKills(); connection(undefined); delete window.uctDesktop; getDeviceClient.mockClear() })
afterEach(() => { window.matchMedia = realMatchMedia; connection(undefined); delete window.uctDesktop; localStorage.clear(); clearKills() })

describe('the fake screen evaluates queries (it is not a string match)', () => {
  it('width, pointer and hover each decide; a feature it does not model throws', () => {
    screen(MOUSE_DESKTOP)
    expect(window.matchMedia(MQ.desktop).matches).toBe(true)
    expect(window.matchMedia(`${MQ.desktop} and (hover: hover) and (pointer: fine)`).matches).toBe(true)
    expect(window.matchMedia(`${MQ.desktop} and (pointer: coarse)`).matches).toBe(false)
    expect(window.matchMedia('(max-width: 1024px)').matches).toBe(false)
    screen({ width: 1180, pointer: 'coarse', hover: 'none' })
    expect(window.matchMedia(MQ.desktop).matches).toBe(true)
    expect(window.matchMedia(`${MQ.desktop} and (hover: hover) and (pointer: fine)`).matches).toBe(false)
    expect(() => window.matchMedia('(orientation: landscape)')).toThrow(/cannot evaluate/)
    expect(() => window.matchMedia('(min-width: 64em)')).toThrow(/cannot read/)
    screen(PHONE)                                                         // every feature is read, a false one first too
    expect(() => window.matchMedia(`${MQ.desktop} and (orientation: landscape)`)).toThrow(/cannot evaluate/)
  })
})

describe('no key: the desktop default (#2537), decided inside _defaultOn()', () => {
  it('THE one switch: DEVICE_STORE_DEFAULT_ON is true, and deviceStoreDefaultOn() is what the default reads', async () => {
    const { sw } = await pageLoad()
    expect(sw.DEVICE_STORE_DEFAULT_ON).toBe(true)
    expect(typeof sw.deviceStoreDefaultOn).toBe('function')
  })

  it('THE query (T2): the desktop width AND a mouse or trackpad as the primary pointer, the pairing the CSS uses', async () => {
    const { sw } = await pageLoad()
    expect(sw.DEVICE_STORE_DESKTOP_QUERY).toBe(`${MQ.desktop} and (hover: hover) and (pointer: fine)`)
    expect(sw.DEVICE_STORE_DESKTOP_QUERY).toBe('(min-width: 1025px) and (hover: hover) and (pointer: fine)')
  })

  it.each([
    ['a touch-first tablet in landscape (an iPad without a trackpad: coarse, no hover)', { width: 1180, pointer: 'coarse', hover: 'none' }],
    ['a wide touch screen that also reports hover', { width: 1366, pointer: 'coarse', hover: 'hover' }],
    ['a fine pointer that cannot hover (a pen as the primary input)', { width: 1280, pointer: 'fine', hover: 'none' }],
  ])('a WIDE screen whose primary pointer is not a mouse, %s: OFF, default-off, packs KEPT', async (_name, s) => {
    screen(s)
    const { sw, src } = await pageLoad()
    expect([sw.deviceStoreEnabled(), sw.deviceStoreOffReason()]).toEqual([false, 'default-off'])
    expect(await packsAfter(src)).toBe('kept')
  })

  it('a NARROW window with a mouse (a half-snapped laptop window): OFF, default-off', async () => {
    screen({ width: 900, pointer: 'fine', hover: 'hover' })
    const { sw } = await pageLoad()
    expect([sw.deviceStoreEnabled(), sw.deviceStoreOffReason()]).toEqual([false, 'default-off'])
  })

  it('a matchMedia that THROWS (a sandboxed frame, a broken polyfill): OFF, default-off', async () => {
    window.matchMedia = () => { throw new Error('blocked') }
    const { sw } = await pageLoad()
    expect([sw.deviceStoreEnabled(), sw.deviceStoreOffReason()]).toEqual([false, 'default-off'])
  })

  it('the desktop app on a narrow TOUCH window: still ON (the bridge decides, not the screen)', async () => {
    screen({ width: 800, pointer: 'coarse', hover: 'none' })
    window.uctDesktop = { bridgeVersion: 1, capabilities: [] }
    const { sw } = await pageLoad()
    expect(sw.deviceStoreEnabled()).toBe(true)
  })

  it('a desktop browser (a wide window, an unmetered connection): ON', async () => {
    viewport(true)
    const { sw } = await pageLoad()
    expect([sw.deviceStoreEnabled(), sw.deviceStoreOffReason()]).toEqual([true, null])
  })

  it('a desktop on a fast unmetered connection (4g, wifi): ON', async () => {
    viewport(true)
    connection({ effectiveType: '4g', type: 'wifi', saveData: false })
    const { sw } = await pageLoad()
    expect(sw.deviceStoreEnabled()).toBe(true)
  })

  it('a NARROW window (a phone, a touch-tier tablet, a half-snapped desktop): OFF, default-off, and the packs are KEPT', async () => {
    viewport(false)
    const { sw, src } = await pageLoad()
    expect([sw.deviceStoreEnabled(), sw.deviceStoreOffReason()]).toEqual([false, 'default-off'])
    expect(await packsAfter(src)).toBe('kept')
  })

  it.each([
    ['saveData', { saveData: true, effectiveType: '4g' }],
    ['cellular', { type: 'cellular', effectiveType: '4g' }],
    ['3g', { effectiveType: '3g' }],
    ['2g', { effectiveType: '2g' }],
    ['slow-2g', { effectiveType: 'slow-2g' }],
  ])('a desktop on a metered connection (%s): OFF, default-off, packs KEPT', async (_name, c) => {
    viewport(true)
    connection(c)
    const { sw, src } = await pageLoad()
    expect([sw.deviceStoreEnabled(), sw.deviceStoreOffReason()]).toEqual([false, 'default-off'])
    expect(await packsAfter(src)).toBe('kept')
  })

  it('a browser that cannot say (no matchMedia): OFF, default-off', async () => {
    window.matchMedia = undefined
    const { sw } = await pageLoad()
    expect([sw.deviceStoreEnabled(), sw.deviceStoreOffReason()]).toEqual([false, 'default-off'])
  })

  it('the desktop app: ON whatever its window width; on a metered connection OFF (the connection is read first)', async () => {
    viewport(false)
    window.uctDesktop = { bridgeVersion: 1, capabilities: [] }
    let { sw } = await pageLoad()
    expect(sw.deviceStoreEnabled()).toBe(true)
    connection({ saveData: true })
    ;({ sw } = await pageLoad())
    expect([sw.deviceStoreEnabled(), sw.deviceStoreOffReason()]).toEqual([false, 'default-off'])
  })
})

describe("a stored key wins over the default", () => {
  it('a value that is not a choice ("off", "true", "") on a DESKTOP viewport: OFF, not-a-choice, packs KEPT', async () => {
    viewport(true)
    for (const v of ['off', 'true', '', ' 1']) {
      localStorage.setItem(KEY, v)
      const { sw, src } = await pageLoad()
      expect([sw.deviceStoreEnabled(), sw.deviceStoreOffReason()], JSON.stringify(v)).toEqual([false, 'not-a-choice'])
      expect(await packsAfter(src, { ranDaysAgo: 90 }), JSON.stringify(v)).toBe('kept')
    }
  })

  it("'0' on a desktop: OFF, member-off, and the packs are DELETED", async () => {
    viewport(true)
    localStorage.setItem(KEY, '0')
    const { sw, src } = await pageLoad()
    expect([sw.deviceStoreEnabled(), sw.deviceStoreOffReason()]).toEqual([false, 'member-off'])
    expect(await packsAfter(src)).toBe('deleted')
  })

  it("'1' on a phone: ON (a tester's explicit choice)", async () => {
    viewport(false)
    connection({ saveData: true })
    localStorage.setItem(KEY, '1')
    const { sw } = await pageLoad()
    expect(sw.deviceStoreEnabled()).toBe(true)
  })
})

describe('the kills win over the desktop default', () => {
  it.each([
    ['the chart-speed kill', 'uct_chart_speed=0', 'chart-speed-kill', 'kept'],
    ['the device kill', 'uct_device_store=0', 'device-kill', 'kept'],
    ['the device purge', 'uct_device_store=purge', 'device-purge', 'deleted'],
  ])('%s on a default-ON desktop: OFF (%s), packs %s', async (_label, cookie, reason, packs) => {
    viewport(true)
    document.cookie = `${cookie}; path=/`
    const { sw, src } = await pageLoad()
    expect([sw.deviceStoreEnabled(), sw.deviceStoreOffReason()]).toEqual([false, reason])
    expect(await packsAfter(src)).toBe(packs)
  })
})

describe('one answer per page load', () => {
  it('a resize or a connection change mid-session flips nothing until the next load, either way', async () => {
    viewport(true)
    let { sw } = await pageLoad()
    expect(sw.deviceStoreEnabled()).toBe(true)
    viewport(false)
    connection({ saveData: true })
    expect([sw.deviceStoreEnabled(), sw.deviceStoreOffReason()]).toEqual([true, null])
    ;({ sw } = await pageLoad())
    expect([sw.deviceStoreEnabled(), sw.deviceStoreOffReason()]).toEqual([false, 'default-off'])
    viewport(true)
    connection(undefined)
    expect([sw.deviceStoreEnabled(), sw.deviceStoreOffReason()]).toEqual([false, 'default-off'])
    ;({ sw } = await pageLoad())
    expect(sw.deviceStoreEnabled()).toBe(true)
  })
})

describe('first-open bytes: the default is computed without the heavy client', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const importsOf = (file) => [...readFileSync(file, 'utf8').matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])

  it('switch.js imports exactly three small modules, and none of them imports anything', () => {
    const own = importsOf(path.join(here, 'switch.js')).sort()
    expect(own).toEqual(['../../lib/chartSpeed', '../../lib/desktopBridge', '../../styles/breakpoints'])
    for (const dep of own) expect(importsOf(path.join(here, `${dep}.js`)), dep).toEqual([])
  })

  it('deciding ON on a desktop loads no client (the client loads only on a device ask)', async () => {
    viewport(true)
    const { sw } = await pageLoad()
    expect(sw.deviceStoreEnabled()).toBe(true)
    expect(sw.deviceStoreOffReason()).toBeNull()
    await new Promise((r) => setTimeout(r, 0))
    expect(getDeviceClient).not.toHaveBeenCalled()
  })
})
