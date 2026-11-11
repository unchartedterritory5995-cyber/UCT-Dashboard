// AUDIT #1027 point 2: the header drag (moveColumn) and the gridline drag (startColResize's mouseup) were moved out of
// Watchlists.jsx into pure functions (watchlist/watchlistColumns.js movedColumnCfg / resizedColumnCfg) so the member's drag and
// UCT Agent's watchlist.arrangeColumns are ONE rule. This rail pins the extracted functions to the inline code they replaced,
// copied VERBATIM below from master b2300e547d (Watchlists.jsx moveColumn / startColResize), over a fixture set of column
// configs × every drag pair × a spread of widths. COL_META is read from Watchlists.jsx itself, never retyped.
// Evidence: LOCAL, vitest (node), pure functions.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { movedColumnCfg, resizedColumnCfg, DEFAULT_COL_ORDER } from './watchlist/watchlistColumns'

const HERE = dirname(fileURLToPath(import.meta.url))
// line endings normalised first: a Windows checkout (core.autocrlf) has CRLF, and the block regex below reads LF
const SRC = readFileSync(resolve(HERE, 'Watchlists.jsx'), 'utf8').replace(/\r\n/g, '\n')
const block = /\nconst COL_META = (\{[\s\S]*?\n\})\n/.exec(SRC)
const COL_META = new Function(`return ${block[1]}`)()   // eslint-disable-line no-new-func -- the product's own literal

// ── master b2300e547d, verbatim (only `saveColCfg` is captured instead of written, and colCfg / colOrder are passed in) ──
function oldMoveColumn(colCfg, fromKey, toKey) {
  let saved = null
  const saveColCfg = (c) => { saved = c }
  const colOrder = (Array.isArray(colCfg.order) && colCfg.order.length ? colCfg.order : DEFAULT_COL_ORDER).filter(k => COL_META[k])
  const moveColumn = (fromKey, toKey) => {
    if (!fromKey || fromKey === toKey) return
    const order = [...colOrder]
    DEFAULT_COL_ORDER.forEach(k => { if (!order.includes(k)) order.push(k) })
    const from = order.indexOf(fromKey)
    const to = order.indexOf(toKey)
    if (from < 0 || to < 0) return
    order.splice(from, 1)
    order.splice(to, 0, fromKey)
    saveColCfg({ ...colCfg, order })
  }
  moveColumn(fromKey, toKey)
  return saved
}
function oldResizeUp(colCfg, key, startW, dx, scale) {
  let saved = null
  const saveColCfg = (c) => { saved = c }
  const min = COL_META[key]?.min || 40
  const calc = (ev) => Math.max(min, Math.round(startW + (ev.clientX - 0) / (scale || 1)))
  const w = calc({ clientX: dx })
  saveColCfg({ ...colCfg, widths: { ...(colCfg.widths || {}), [key]: w } })
  return saved
}
// the head's mouseup: the same calc, then the extracted rule
function newResizeUp(colCfg, key, startW, dx, scale) {
  const min = COL_META[key]?.min || 40
  const w = Math.max(min, Math.round(startW + (dx - 0) / (scale || 1)))
  return resizedColumnCfg(colCfg, key, w, COL_META)
}

const CFGS = [
  {},
  { order: [] },
  { order: ['flag', 'sym', 'chg', 'price', 'vol'] },
  { order: ['sym', 'flag', 'price', 'vol', 'chg', 'rvol', 'sector'], hidden: { vol: true }, sort: { key: 'rvol', dir: 'desc' } },
  { order: ['flag', 'sym', 'rvol', 'notAColumn', 'chg'], widths: { sym: 120 } },
  { order: ['flag', 'sym', 'price', 'vol', 'chg', 'perf30d', 'theme'], widths: { theme: 200, chg: 60 } },
]
const KEYS = [null, '', 'flag', 'sym', 'price', 'vol', 'chg', 'rvol', 'sector', 'theme', 'perf30d', 'notAColumn', 'weight']

describe('the extracted column rules equal the inline drag code they replaced (master b2300e547d, verbatim)', () => {
  it('COL_META was read from Watchlists.jsx', () => {
    expect(COL_META.sym).toEqual({ def: 96, min: 56 })
    expect(Object.keys(COL_META).length).toBeGreaterThan(20)
  })
  it('header drop: every config × every from / to pair (no move = no write, both ways)', () => {
    let n = 0
    for (const cfg of CFGS) for (const from of KEYS) for (const to of KEYS) {
      const want = oldMoveColumn(JSON.parse(JSON.stringify(cfg)), from, to)
      expect(movedColumnCfg(JSON.parse(JSON.stringify(cfg)), from, to, COL_META), `${JSON.stringify(cfg)} ${from}→${to}`).toEqual(want)
      n++
    }
    expect(n).toBe(CFGS.length * KEYS.length * KEYS.length)
  })
  it('gridline let go: every config × every column × a spread of drags and scales (under the minimum, fractional, wide)', () => {
    for (const cfg of CFGS) for (const key of Object.keys(COL_META).concat(['notAColumn'])) {
      for (const [startW, dx, scale] of [[96, 0, 1], [62, -100, 1], [62, 13.4, 1], [68, 7, 0.75], [150, 400, 1.3], [40, 1, 0], [56, -3.5, 2]]) {
        expect(newResizeUp(cfg, key, startW, dx, scale), `${key} ${startW}+${dx}/${scale}`).toEqual(oldResizeUp(cfg, key, startW, dx, scale))
      }
    }
  })
  it('the input config is never mutated', () => {
    const cfg = { order: ['flag', 'sym', 'chg', 'price', 'vol'], widths: { sym: 100 } }
    const before = JSON.stringify(cfg)
    movedColumnCfg(cfg, 'chg', 'sym', COL_META); resizedColumnCfg(cfg, 'sym', 140, COL_META)
    expect(JSON.stringify(cfg)).toBe(before)
  })
})
