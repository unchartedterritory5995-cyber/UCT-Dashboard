// The bull_flag "flagging" tier (lab flag_vocab, 2026-10-18), asserted by what RENDERS.
//
// The server keeps a flagging flag `stale` (the strict round stopped it) and stamps its own key,
// extras.flagging = {tier: 'flagging', draw_round, draw_lanes, draw_anchors?}. The overlay draws it
// light -- dotted, faint lanes and pole, labelled "flagging" (the team's word) -- and NEVER with an
// entry line: its geometry measured at chance against the team's lines. A confirmed (tier 1) flag
// renders byte-for-byte as before: its markup is pinned against a capture taken from the overlay
// BEFORE the tier existed (__fixtures__/flagTier1Markup.json; regenerate only from that code, with
// CAPTURE_FLAG_TIER1=1).
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PatternOverlay, { selectDrawable } from './PatternOverlay'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, '__fixtures__', 'flagTier1Markup.json')

function weekdays(from, to) {
  const out = []
  const d = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)
  while (d <= end) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const BAR_TIMES = weekdays('2026-08-24', '2026-10-16')

function makeDailyChart(barTimes) {
  const index = new Map(barTimes.map((t, i) => [t, i * 10]))
  return {
    timeScale: () => ({
      timeToCoordinate: (t) => (index.has(t) ? index.get(t) : null),
      subscribeVisibleTimeRangeChange: vi.fn(),
      subscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeVisibleTimeRangeChange: vi.fn(),
      unsubscribeVisibleLogicalRangeChange: vi.fn(),
      options: () => ({ barSpacing: 8 }),
    }),
  }
}
const makeSeries = () => ({ priceToCoordinate: (price) => 1000 - price * 10 })
function makeContainerRef() {
  const ref = createRef()
  ref.current = { clientWidth: 800, clientHeight: 400 }
  return ref
}
function renderOverlay(detections, trustedOnly = true) {
  return render(
    <PatternOverlay chart={makeDailyChart(BAR_TIMES)} series={makeSeries()} containerRef={makeContainerRef()}
      enabled={true} tf="D" barTimes={BAR_TIMES} detections={detections} trustedOnly={trustedOnly} />,
  )
}

const ANCHORS = [
  { t: 20261001, price: 52 }, { t: 20261014, price: 50 },
  { t: 20261001, price: 48 }, { t: 20261014, price: 46 },
]
const POLE = [{ t: 20260915, price: 44 }, { t: 20260930, price: 52 }]

// a row as the member route serves it: display_policy stamped (trusted, draw_entry)
function flag(id, extras, over = {}) {
  return {
    id, pattern_id: 'bull_flag', pattern_name: 'Bull Flag', confidence: 70, direction: 'bullish',
    status: 'forming', display_tier: 'trusted', display_layer: 'structures', draw_entry: true,
    levels: { entry: 52.4 },
    geometry: { shape: 'trendline_pair', anchors: ANCHORS, extras: { line_spaces: ['price', 'price'], ...extras } },
    ...over,
  }
}

// Tier 1, as the round-9 code stamps it.
const TIER1 = {
  refit: flag('t1a', {
    draw_round: 9, draw_lanes: true, draw_pole: POLE, draw_entry_price: 52.1,
    draw_anchors: [{ t: 20261002, price: 51.8 }, { t: 20261014, price: 50.2 },
      { t: 20261002, price: 48.1 }, { t: 20261014, price: 46.4 }],
  }),
  plain: flag('t1b', { draw_round: 9, draw_lanes: true, draw_pole: POLE }),
  lanesOff: flag('t1c', { draw_round: 9, draw_lanes: false, lanes_reason: 'overlapped', draw_pole: POLE }),
}

// Tier 2, as display.draw_geometry stamps it: stale on a relaxed reason, its own key.
function tier2(extra = {}, stamp = {}) {
  return flag('t2', {
    stale: true, stale_reason: 'short_flag', draw_lanes: false, draw_pole: POLE,
    flagging: { tier: 'flagging', draw_round: 9, draw_lanes: true, ...stamp },
    ...extra,
  })
}

describe('PatternOverlay — flagging tier: tier 1 is unchanged', () => {
  for (const [name, row] of Object.entries(TIER1)) {
    it(`a confirmed flag (${name}) renders exactly the markup captured before the tier existed`, () => {
      const html = renderOverlay([row]).container.innerHTML
      if (process.env.CAPTURE_FLAG_TIER1 === '1') {
        const cur = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : {}
        cur[name] = html
        fs.mkdirSync(path.dirname(FIXTURE), { recursive: true })
        fs.writeFileSync(FIXTURE, `${JSON.stringify(cur, null, 2)}\n`)
      }
      const golden = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
      expect(html.length).toBeGreaterThan(200)               // something drew
      expect(html).toBe(golden[name])
    })
  }
})

describe('PatternOverlay — flagging tier: what a flagging flag draws', () => {
  it('a stamped flagging flag is drawable; the same row unstamped is not (it is stale)', () => {
    expect(selectDrawable([tier2()], { tf: 'D', trustedOnly: true })).toHaveLength(1)
    const unstamped = tier2()
    delete unstamped.geometry.extras.flagging
    expect(selectDrawable([unstamped], { tf: 'D', trustedOnly: true })).toHaveLength(0)
  })

  it('a near-miss stamp draws nothing', () => {
    for (const stamp of [{ tier: 'flag' }, { tier: undefined }]) {
      expect(selectDrawable([tier2({}, stamp)], { tf: 'D', trustedOnly: true }), JSON.stringify(stamp))
        .toHaveLength(0)
    }
    const notADict = tier2()
    notADict.geometry.extras.flagging = 'flagging'
    expect(selectDrawable([notADict], { tf: 'D', trustedOnly: true })).toHaveLength(0)
    const otherPattern = tier2()
    otherPattern.pattern_id = 'flat_base'
    expect(selectDrawable([otherPattern], { tf: 'D', trustedOnly: true })).toHaveLength(0)
  })

  it('draws its lanes dotted and faint, labelled "flagging", with no entry line', () => {
    const { container } = renderOverlay([tier2()])
    const g = container.querySelector('[data-detection="bull_flag"]')
    expect(g).not.toBeNull()
    expect(g.getAttribute('data-flag-tier')).toBe('flagging')
    const upper = g.querySelector('[data-role="upper"]')
    const lower = g.querySelector('[data-role="lower"]')
    expect(upper).not.toBeNull()
    expect(lower).not.toBeNull()
    expect(upper.getAttribute('stroke-dasharray')).toBe('2,4')
    expect(Number(upper.getAttribute('opacity'))).toBeLessThan(0.5)
    expect(g.textContent).toContain('flagging')
    expect(g.textContent).not.toContain('Bull Flag')
    expect(g.textContent).not.toMatch(/Entry/)
    expect(container.querySelector('[data-shape="level-segment"]')).toBeNull()   // no entry line at all
  })

  it('its pole is drawn dotted and faint too', () => {
    const pole = renderOverlay([tier2()]).container.querySelector('[data-role="pole"]')
    expect(pole).not.toBeNull()
    expect(pole.getAttribute('stroke-dasharray')).toBe('2,4')
    expect(Number(pole.getAttribute('opacity'))).toBeLessThan(0.5)
  })

  it('never draws an entry line even when the row carries one', () => {
    const { container } = renderOverlay([tier2({ draw_entry_price: 51.9 })])
    expect(container.querySelector('[data-shape="level-segment"]')).toBeNull()
    expect(container.textContent).not.toMatch(/Entry/)
  })

  it('draws the lanes the stamp carries, and none when the stamp turns lanes off', () => {
    const refit = [{ t: 20261002, price: 51.7 }, { t: 20261014, price: 50.3 },
      { t: 20261002, price: 48.2 }, { t: 20261014, price: 46.5 }]
    const withRefit = selectDrawable([tier2({}, { draw_anchors: refit })], { tf: 'D', trustedOnly: true })[0]
    expect(withRefit.geometry.extras.draw_anchors).toEqual(refit)
    const off = renderOverlay([tier2({}, { draw_lanes: false })]).container
    expect(off.querySelector('[data-role="upper"]')).toBeNull()
    expect(off.querySelector('[data-role="pole"]')).not.toBeNull()       // the pole still shows
  })

  it('a row that is not stale is never read as flagging, whatever it carries', () => {
    const odd = flag('odd', { draw_round: 9, draw_lanes: true, draw_pole: POLE,
      flagging: { tier: 'flagging', draw_round: 9, draw_lanes: true } })
    const [row] = selectDrawable([odd], { tf: 'D', trustedOnly: true })
    expect(row.flag_tier).toBeUndefined()
    expect(row.draw_entry).toBe(true)
  })

  it('an admin (not trustedOnly) sees both tiers', () => {
    const rows = selectDrawable([TIER1.plain, tier2()], { tf: 'D', trustedOnly: false })
    expect(rows.map((r) => r.id)).toEqual(['t1b', 't2'])
    const { container } = renderOverlay([TIER1.plain, tier2()], false)
    const tiers = [...container.querySelectorAll('[data-detection="bull_flag"]')]
      .map((g) => g.getAttribute('data-flag-tier'))
    expect(tiers).toEqual([null, 'flagging'])
    // control: the confirmed one keeps its entry line
    expect(container.textContent).toMatch(/Entry 52\.40/)
  })
})
