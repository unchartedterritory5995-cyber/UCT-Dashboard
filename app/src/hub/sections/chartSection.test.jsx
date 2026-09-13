// Chart's controller — §3.5, and the two actions it deliberately refuses to ship.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  createChartSection, buildChartFan, timeframeLadder, CHART_MODE_ID,
} from './chartSection'
import { modesById, fanFor, PREVIEW_MODES } from '../registry'
import { validateSectionConfig } from '../contracts'
import { tfSortKey } from '../../components/chart/timeframes'
import { TF_ORDER } from '../../components/chart/keyboardShortcuts'

const CTX = { mode: 'chart', symbol: 'NVDA', navigate: vi.fn() }
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

function make(over = {}) {
  const onTf = vi.fn()
  const onFlag = vi.fn()
  const onNote = vi.fn()
  const onPlanTrade = vi.fn()
  const scrubRef = { current: null }
  const tfs = timeframeLadder([], 'D')
  const config = createChartSection({
    tf: 'D', tfs, symbol: 'NVDA', onTf, onFlag, onNote, onPlanTrade, scrubRef, ...over,
  })
  return { config, onTf, onFlag, onNote, onPlanTrade, scrubRef, tfs }
}

describe('the mode is live, and its chip must now be true', () => {
  it('⛔⛔ chart has LEFT PREVIEW_MODES', () => {
    expect(PREVIEW_MODES.has('chart'), 'chart is still preview-hidden, so nothing below describes '
      + 'what a member sees').toBe(false)
  })

  it('⛔ the registry hint it must now keep', () => {
    expect(modesById[CHART_MODE_ID].tapHint).toBe('tap: next timeframe')
  })

  it('the config passes the section contract', () => {
    const { config } = make()
    expect(() => validateSectionConfig(config, 'chartSection')).not.toThrow()
    expect(config.id).toBe('chart')
    expect(config.scrubAxis).toBe('y')
  })
})

describe('the ladder is the PICKER\'S ladder', () => {
  it('non-vacuity — it is a real, ordered list of more than a couple of codes', () => {
    const l = timeframeLadder([], 'D')
    expect(l.length, 'the ladder is empty or trivial, so every step assertion is vacuous')
      .toBeGreaterThan(4)
    expect(l).toContain('D')
  })

  it('⛔⛔ THE MIRROR: it matches what MobileTfSheet builds, expression for expression', () => {
    // ⭐ `lesson_rail_the_mirror_not_just_the_lane`. The FUNCTIONS are shared (`TF_ORDER`,
    // `tfSortKey`), but the union expression is duplicated in the sheet. The day they diverge,
    // "next timeframe" and the picker stop describing the same ladder and the member taps into a
    // gap. This reproduces the sheet's own line and requires the same answer.
    const customs = ['3', '45']
    const tf = 'D'
    const sheetsWay = [...new Set([...TF_ORDER, ...customs, ...(tf ? [tf] : [])])]
      .sort((a, b) => tfSortKey(a) - tfSortKey(b))
    expect(timeframeLadder(customs, tf), 'the gesture and the picker are on different ladders')
      .toEqual(sheetsWay)
  })

  it('⛔ THE CONTROL: the sheet really does build it that way — read, not remembered', () => {
    const sheet = readFileSync(path.join(HERE, '..', '..', 'pages', 'charts', 'mobile',
      'MobileTfSheet.jsx'), 'utf8')
    expect(sheet, 'MobileTfSheet no longer unions TF_ORDER with the customs, so the mirror above '
      + 'is comparing against a shape that has moved').toMatch(/new Set\(\[\s*\.\.\.TF_ORDER/)
    expect(sheet).toMatch(/tfSortKey/)
  })

  it('a custom timeframe the member built is on the ladder, in order', () => {
    const l = timeframeLadder(['45'], 'D')
    expect(l).toContain('45')
    const sorted = [...l].sort((a, b) => tfSortKey(a) - tfSortKey(b))
    expect(l, 'the ladder is not in the picker\'s order').toEqual(sorted)
  })
})

describe('tap is "next timeframe", through the page\'s own setter', () => {
  it('⛔⛔ tap advances one rung and calls onTf', () => {
    const { config, onTf, tfs } = make()
    const i = tfs.indexOf('D')
    config.onTap(CTX)
    expect(onTf, 'tap did not change the timeframe — the hint promises it does')
      .toHaveBeenCalledWith(tfs[i + 1])
  })

  it('⛔ double-tap goes back one rung', () => {
    const { config, onTf, tfs } = make()
    const i = tfs.indexOf('D')
    config.onDoubleTap(CTX)
    expect(onTf).toHaveBeenCalledWith(tfs[i - 1])
  })

  it('⛔ it CLAMPS at both ends — 1m does not wrap to 1M', () => {
    // Wrapping would answer "next" with the largest move on the ladder.
    const { tfs } = make()
    const top = make({ tf: tfs[tfs.length - 1] })
    top.config.onTap(CTX)
    expect(top.onTf, 'the top of the ladder wrapped').not.toHaveBeenCalled()
    const bottom = make({ tf: tfs[0] })
    bottom.config.onDoubleTap(CTX)
    expect(bottom.onTf, 'the bottom of the ladder wrapped').not.toHaveBeenCalled()
  })

  it('⛔ it never re-sets the timeframe it is already on', () => {
    // `handleTf` early-returns on an unchanged code, but firing anyway would make the gesture look
    // like it did something in every log and trace.
    const { config, onTf } = make({ tfs: ['D'] })
    config.onTap(CTX)
    expect(onTf).not.toHaveBeenCalled()
  })

  it('an empty ladder is inert rather than throwing', () => {
    const { config, onTf } = make({ tfs: [] })
    expect(() => config.onTap(CTX)).not.toThrow()
    expect(onTf).not.toHaveBeenCalled()
    expect(config.readout()).toBe('No chart')
  })
})

describe('the scrub previews and commits', () => {
  it('⛔ a drag moves the chip WITHOUT refetching bars', () => {
    const { config, onTf, tfs } = make({ tf: tfs => tfs })
    const c = make()
    c.config.onScrub(CTX, { delta: 1, axis: 'y' })
    expect(c.onTf, 'a mid-drag step changed the timeframe — one request per pointer move')
      .not.toHaveBeenCalled()
    expect(c.config.readout()).toContain('NVDA')
  })

  it('⛔⛔ release commits the previewed rung', () => {
    const { config, onTf, tfs } = make()
    config.onScrub(CTX, { delta: 1, axis: 'y' })
    config.onScrubCommit(CTX)
    expect(onTf).toHaveBeenCalledWith(tfs[tfs.length - 1])
  })

  it('⛔ the wrong axis is ignored and a NaN delta is refused', () => {
    const { config, scrubRef } = make()
    config.onScrub(CTX, { delta: 1, axis: 'x' })
    expect(scrubRef.current).toBeNull()
    config.onScrub(CTX, { delta: Number.NaN, axis: 'y' })
    expect(scrubRef.current).toBeNull()
  })

  it('the chip speaks the picker\'s words and names the symbol', () => {
    const { config } = make()
    // `tfLabel('D')` is the picker's own label for the daily timeframe.
    expect(config.readout()).toMatch(/^NVDA · /)
    expect(make({ symbol: null }).config.readout()).not.toContain('·')
  })
})

describe('the fan ships only what this surface can perform', () => {
  it('⛔⛔ chart.compare and chart.logTrade are DROPPED from the shipped fan', () => {
    const ids = fanFor(make().config).map((a) => a.id)
    expect(ids, 'chart.compare is live. Its only write path is CompareSymbolsPanel, which mounts '
      + 'AFTER ChartsWorkspace\'s `if (isMobile)` return — it structurally cannot mount on any '
      + 'viewport the hub runs on, so the bubble can only be silent.').not.toContain('chart.compare')
    expect(ids, 'chart.logTrade is live. Logging an EXECUTED trade lives under '
      + 'pages/journal-2-0/**, which rule 12 forbids this branch from touching.')
      .not.toContain('chart.logTrade')
  })

  it('⭐ but they are still DECLARED — dropped by the controller, not deleted', () => {
    // The distinction matters: `calendar.earnings` was DELETED because its behaviour is impossible
    // (the page locks the toggle). These two are merely unreachable from THIS surface, so the
    // declaration stays and a future surface can honour them.
    const declared = (modesById[CHART_MODE_ID].fan || []).map((a) => a.id)
    expect(declared).toContain('chart.compare')
    expect(declared).toContain('chart.logTrade')
  })

  it('⛔ THE CONTROL: the compare panel really is behind the isMobile return', () => {
    // The justification for dropping an action must stay checkable, or it rots into folklore.
    // ⚰️ THIS CONTROL'S FIRST VERSION SEARCHED FOR `CompareSymbolsPanel` AND FOUND THE IMPORT —
    // char 2806, line 39, which is of course before everything. It failed, and what it was failing
    // was itself. The MOUNT is what the claim is about, so match the JSX open tag.
    const ws = readFileSync(path.join(HERE, '..', '..', 'pages', 'charts', 'ChartsWorkspace.jsx'), 'utf8')
    const mobileReturn = ws.indexOf('if (isMobile)')
    const mount = ws.indexOf('<CompareSymbolsPanel')
    expect(mobileReturn, 'ChartsWorkspace no longer has an isMobile early return').toBeGreaterThan(0)
    expect(mount, 'CompareSymbolsPanel is no longer mounted in ChartsWorkspace at all').toBeGreaterThan(0)
    expect(mount, 'CompareSymbolsPanel now mounts BEFORE the isMobile return — compare may be '
      + 'reachable on a hub viewport after all, and dropping it should be revisited')
      .toBeGreaterThan(mobileReturn)
  })

  it('⛔⛔ Flag, Note and Plan trade all carry real bodies', () => {
    const { config, onFlag, onNote, onPlanTrade } = make()
    const byId = Object.fromEntries(config.fan.map((a) => [a.id, a]))
    for (const id of ['chart.flag', 'chart.note', 'chart.planTrade']) {
      expect(typeof byId[id]?.run, `${id} is kind:run with no body — a silent bubble`).toBe('function')
    }
    byId['chart.flag'].run(CTX); expect(onFlag).toHaveBeenCalled()
    byId['chart.planTrade'].run(CTX); expect(onPlanTrade).toHaveBeenCalled()
  })

  it('⛔ EVERY run action in the shipped fan has a body — no silent bubbles', () => {
    const naked = fanFor(make().config)
      .filter((a) => a.kind === 'run' && !/\.voice$/.test(a.id) && typeof a.run !== 'function')
      .map((a) => a.id)
    expect(naked, 'these bubbles are LIVE and answer a deliberate gesture with silence').toEqual([])
  })

  it('the flag label says which way it will go', () => {
    expect(buildChartFan({ flagged: false }).find((a) => a.id === 'chart.flag').label).toBe('Flag')
    expect(buildChartFan({ flagged: true }).find((a) => a.id === 'chart.flag').label).toBe('Unflag')
  })

  it('non-vacuity — the built fan is not empty and came from the registry', () => {
    const built = buildChartFan({})
    expect(built.length, 'the fan builder returned nothing').toBeGreaterThan(2)
    expect(built.map((a) => a.id)).toContain('chart.flag')
  })
})
