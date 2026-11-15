// AUDIT #1027 point 2: screenWatchlistWidget (watchlistTarget.js, run on the MODEL path in useAgent: it can REPLACE screened.ops)
//   (a) never retargets an op that is not a Watchlist widget op — a chart / indicator / alert op passes through byte-identical;
//   (b) never picks a widget the words EXCLUDE ("not the left watchlist", "anything but the right watchlist", "the other one").
// Written before any fix; run first against the code as it stood. LOCAL, vitest (node), pure function over a fake host.
import { describe, it, expect } from 'vitest'
import { screenWatchlistWidget } from './watchlistTarget'

const wl = (id, x) => ({ id, type: 'watchlist', x, y: 0, w: 6, h: 20, color: 'N', opts: { watchKey: 'user:w1', watchName: 'Momentum', watchTab: 'mine' } })
const host = (widgets) => ({ widgets: { snapshot: () => ({ raw: widgets }) } })
const TWO = host([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'N', opts: {} }, wl('L', 12), wl('R', 18)])
const show = (widget = 'L') => ({ action: 'watchlist.showList', target: 'board', args: { widget, source: 'prebuilt', name: 'Leaders' } })
const OTHERS = [
  { action: 'chart.setSymbol', target: 'c1', args: { symbol: 'NVDA' } },
  { action: 'indicator.add', target: 'c1', args: { indicator: 'rsi' } },
  { action: 'widget.setOption', target: 'board', args: { widget: 'L', key: 'showLogos', value: false } },
  { action: 'alert.create', target: 'c1', args: { price: 1, direction: 'above' } },
]

describe('(a) only Watchlist widget ops are ever retargeted', () => {
  it('a plan with no Watchlist op is not screened at all', () => {
    expect(screenWatchlistWidget({ host: TWO, ops: OTHERS, text: 'show Leaders in the right watchlist' })).toBe(null)
  })
  it.each(['show Leaders in the right watchlist', 'put Leaders in the left watchlist'])('"%s": every non-watchlist op in a mixed plan comes back byte-identical', (text) => {
    const ops = [...OTHERS, show('L')]
    const before = JSON.stringify(OTHERS)
    const out = screenWatchlistWidget({ host: TWO, ops, text })
    expect(out?.ops, 'aimed, not asked').toBeTruthy()
    expect(JSON.stringify(out.ops.slice(0, OTHERS.length))).toBe(before)
    expect(out.ops.at(-1).args.widget).toBe(/right/.test(text) ? 'R' : 'L')
  })
})

describe('(b) a widget the words exclude is never picked', () => {
  it.each([
    ['show Leaders, but not in the left watchlist', 'L'],
    ['put Leaders anywhere except the left watchlist', 'L'],
    ['not the right watchlist, show Leaders', 'R'],
    ['show Leaders in anything but the right watchlist widget', 'R'],
  ])('"%s": never %s (asked, or aimed at the other)', (text, excluded) => {
    for (const planned of ['L', 'R']) {
      const out = screenWatchlistWidget({ host: TWO, ops: [show(planned)], text })
      if (out?.ops) expect(out.ops[0].args.widget, `${text} (planned ${planned})`).not.toBe(excluded)
      else expect(out?.ask, `${text} (planned ${planned})`).toBeTruthy()
    }
  })
  it.each(['show Leaders in the other one', 'use the other watchlist for Leaders'])('"%s": "the other" names no widget: asked', (text) => {
    expect(screenWatchlistWidget({ host: TWO, ops: [show('L')], text })?.ask).toBeTruthy()
  })
  it('control: a plain name still acts (no regression)', () => {
    expect(screenWatchlistWidget({ host: TWO, ops: [show('L')], text: 'show Leaders in the right watchlist' })?.ops?.[0].args.widget).toBe('R')
  })
})
