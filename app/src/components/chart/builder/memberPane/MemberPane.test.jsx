// app/src/components/chart/builder/memberPane/MemberPane.test.jsx
//
// ─── ⭐⭐ T5 — THE FLAG, AND WHAT THE PANE IS HANDED ────────────────────────
//
// ⚠️ THE CEILING, STATED FIRST. `ChartPane` is mocked here, so every case below
// is about WHAT the pane is handed — never about pixels. Whether the four series
// paint, whether Scale Padding is invisible and scale-setting, and whether the
// sub-pane is a quarter high are SCREENSHOT questions and are owed against the
// real chart. Nothing in this file may be read as evidence for any of them.
//
// ⛔ WHAT IT DOES PROVE IS THE HALF THAT IS PROVABLE OFFLINE, and the flag-off
// half is the one that matters most today: a member on the default build must
// not be able to reach an unfinished pane through ANY path, including a registry
// entry that outlived a render.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import * as engineRegistry from '../../engine/nativeRegistry'
import { MEMBER_PANE_DEF_PREFIX } from './memberPaneDefinition'

/** ⛔ THE MOCK IS DECLARED, AND SO IS WHAT IT COSTS. It records the props so the
 *  hand-off can be asserted; it draws nothing, which is why the ceiling above is
 *  written at the top of the file rather than at the bottom. */
const paneProps = []
vi.mock('../../pane/ChartPane', () => ({
  default: (props) => { paneProps.push(props); return <div data-testid="mock-chart-pane" /> },
}))

const REPO = path.resolve(process.cwd(), '..')
const V2 = fs.readFileSync(
  path.join(REPO, 'tests/fixtures/member/uncharted-volume-v2.pine'), 'utf8')

const setFlag = (value) => {
  if (value === undefined) delete import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED
  else import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED = value
}

let MemberPane
beforeEach(async () => {
  paneProps.length = 0
  ;({ default: MemberPane } = await import('./MemberPane.jsx'))
})
afterEach(() => {
  cleanup()
  setFlag(undefined)
  engineRegistry.uninstallUserDefinition(MEMBER_PANE_DEF_PREFIX)
})

describe('⛔⛔ flag OFF — nothing, through any path', () => {
  it('renders nothing at all', () => {
    setFlag(undefined)
    const { container } = render(
      <MemberPane sym="SPY" tf="D" source={V2} />)
    // ⛔ NOT "no pane" — NOTHING. An empty wrapper div would still be a surface a
    // member could see a border or a gap from.
    expect(container.innerHTML).toBe('')
    expect(paneProps).toHaveLength(0)
  })

  it('⛔⛔ …and installs NO definition — the registry listing is the assertion', () => {
    // `PreviewPane`'s header records what a leak costs: an entry rides
    // `listUserDefinitions()` onto the member's REAL chart, which is the same
    // list the settings row, the legend and the alert address read. Asserting
    // against the LISTING rather than against a spy is the only form that
    // catches an install by a path this test did not anticipate.
    setFlag(undefined)
    render(<MemberPane sym="SPY" tf="D" source={V2} />)
    const ids = engineRegistry.listUserDefinitions().map((d) => d.id)
    expect(ids).not.toContain(MEMBER_PANE_DEF_PREFIX)
  })

  it('⛔ `\'0\'` and `\'true\'` are OFF — only the exact `\'1\'` opts in', () => {
    // The convention is read off `memberPaneGate.js`: default OFF means `=== '1'`.
    // A test that only tried "unset" would pass against a gate that treated any
    // non-empty value as on, which is the shape a stale per-browser key exploits.
    for (const v of ['0', 'true', '', 'yes']) {
      setFlag(v)
      const { container, unmount } = render(<MemberPane sym="SPY" tf="D" source={V2} />)
      expect(container.innerHTML, `flag=${JSON.stringify(v)}`).toBe('')
      unmount()
    }
  })
})

describe('⭐⭐ flag ON — the pane is handed the member\'s own script', () => {
  beforeEach(() => setFlag('1'))

  it('⭐ THE CONTROL FOR THE WHOLE FILE — with the flag on, it DOES render', () => {
    // Without this, every flag-off assertion above is equally satisfied by a
    // component that renders nothing ever.
    const { getByTestId } = render(<MemberPane sym="SPY" tf="D" source={V2} />)
    expect(getByTestId('pine-member-pane')).toBeTruthy()
    expect(getByTestId('mock-chart-pane')).toBeTruthy()
    expect(paneProps).toHaveLength(1)
  })

  it('⭐ the symbol, the timeframe, and the mini chrome reach ChartPane', () => {
    render(<MemberPane sym="SPY" tf="D" source={V2} />)
    const p = paneProps[0]
    expect(p.sym).toBe('SPY')
    expect(p.tf).toBe('D')
    expect(p.density).toBe('mini')
    expect(p.showTfBar).toBe(false)
    // ⛔ NO SECOND STREAM AND NO SECOND WARM. The member's real chart already
    // does both for this symbol.
    expect(p.stockChartProps.liveUpdates).toBe(false)
    expect(p.stockChartProps.backgroundWarm).toBe(false)
    // ⭐ AND THE BAR COUNT COMES BACK, because the window-dependent badge names
    // it. `_requirement_tags.window_dependent.why_the_pane_may` is why the pane
    // is allowed to serve `ta.cum` at all: "the pane additionally shows a
    // disclosure badge naming the bar count when the value is DISPLAYED."
    // ⛔ `onDrawnBarCount`, not `onBarsReady` — ready fires on a fatal error too,
    // so a badge built on it would read "0 bars here" on a dead ticker.
    expect(typeof p.stockChartProps.onDrawnBarCount).toBe('function')
    // The prop set is still CLOSED: a fourth key is a second stream or a second
    // warm sneaking back in, which is what this assertion has always been for.
    expect(Object.keys(p.stockChartProps).sort())
      .toEqual(['backgroundWarm', 'liveUpdates', 'onDrawnBarCount'])
  })

  it('⛔⛔ the pane holds the member\'s definition and NOTHING ELSE', () => {
    render(<MemberPane sym="SPY" tf="D" source={V2} />)
    const list = paneProps[0].stored.indicatorInstances
    expect(list).toHaveLength(1)
    expect(list[0].defId).toBe(MEMBER_PANE_DEF_PREFIX)
    // …and the definition really is installed while the pane is up.
    expect(engineRegistry.listUserDefinitions().map((d) => d.id))
      .toContain(MEMBER_PANE_DEF_PREFIX)
  })

  it('⭐⭐ the D1 alert note is ON SCREEN, verbatim', () => {
    // Ruling D1 owes the member a sentence saying where their condition went.
    // A pane that quietly dropped `HVE Trigger` and said nothing would look
    // identical to one that never had it.
    const { getByTestId } = render(<MemberPane sym="SPY" tf="D" source={V2} />)
    const notes = getByTestId('pine-member-pane-notes').textContent
    expect(notes).toContain("alert condition 'HVE Trigger'")
    expect(notes).toContain('not drawn on the chart')
  })

  it('⛔ a refused script shows the REASON, not a blank', () => {
    const { getByTestId, queryByTestId } = render(
      <MemberPane sym="SPY" tf="D"
        source={'//@version=6\nindicator("x")\nplot(request.security(syminfo.tickerid, "60", close))\n'} />)
    expect(queryByTestId('pine-member-pane')).toBe(null)
    expect(getByTestId('pine-member-pane-refusal').textContent.length).toBeGreaterThan(0)
  })

  it('⛔ no symbol, no timeframe, no source ⇒ inert, and each one alone', () => {
    // Three reasons for one observable, cut one at a time — `PreviewPane`'s
    // header calls a shared `null` the thing that makes a broken pane read as
    // "correctly inert" from every negative test.
    for (const props of [
      { sym: null, tf: 'D', source: V2 },
      { sym: 'SPY', tf: null, source: V2 },
      { sym: 'SPY', tf: 'D', source: null },
    ]) {
      const { container, unmount } = render(<MemberPane {...props} />)
      expect(container.innerHTML, JSON.stringify(Object.keys(props))).toBe('')
      unmount()
    }
  })

  it('⛔⛔ unmount UNINSTALLS — a leaked definition reaches the real chart', () => {
    const { unmount } = render(<MemberPane sym="SPY" tf="D" source={V2} />)
    expect(engineRegistry.listUserDefinitions().map((d) => d.id))
      .toContain(MEMBER_PANE_DEF_PREFIX)
    unmount()
    expect(engineRegistry.listUserDefinitions().map((d) => d.id))
      .not.toContain(MEMBER_PANE_DEF_PREFIX)
  })
})
