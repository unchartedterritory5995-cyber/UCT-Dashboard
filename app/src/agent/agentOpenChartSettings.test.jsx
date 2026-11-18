// C1-127 · "open chart settings" through the REAL panel, no model (the fast path): the request → the chart the
// existing targeting rules name → the chart's own Chart Settings door (host.charts.openSettings → ChartWidget →
// ChartPane.openSettings, the gear's) → read back as open. Ambiguous or excluded charts ASK and open nothing.
// The widget half (the adapter really reaching the pane) is pages/charts/widgets/ChartWidget.openSettings.test.jsx.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, TWO, FOUR, MODEL_SENTINEL } from './testing/panelHarness'
import { getCapability } from './capabilities'
import { fastParse } from './fastPath'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

/** The board's charts with the pane's door: `open` = the charts whose dialog is open, `calls` = every door call. */
function withSettings(h, { land = true, can = () => true } = {}) {
  const s = { open: new Set(), calls: [] }
  const base = h.charts
  const dec = (snap) => snap && { ...snap, settingsOpen: s.open.has(snap.ref), canOpenSettings: can(snap.ref) }
  h.charts = {
    ...base,
    read: (ref) => dec(base.read(ref)),
    list: () => base.list().map(dec),
    openSettings: (ref) => {
      s.calls.push(ref)
      if (!can(ref)) return false
      if (land) s.open.add(ref)
      return true
    },
  }
  return s
}

describe('chartSetup.openSettings: the chart\'s own Chart Settings door', () => {
  it('one chart: "open chart settings" opens its dialog, with no model call', async () => {
    const { say, h, board } = p.mount(...ONE('NVDA'))
    const s = withSettings(h)
    const before = JSON.stringify(board.state.widgets)
    const out = await say('open chart settings')
    expect(s.calls).toEqual(['c'])
    expect([...s.open]).toEqual(['c'])
    expect(out).toMatch(/Opened Chart Settings/)
    expect(out).not.toContain(MODEL_SENTINEL)
    expect(p.turns()).toBe(0)
    expect(JSON.stringify(board.state.widgets)).toBe(before)          // nothing was written
  }, 40000)

  it.each([
    ['open the chart settings'], ['show me the chart settings'], ['bring up chart settings'], ['open the settings dialog'],
    ['show me the settings panel'], ['open this chart\'s settings'], ['pull up the settings for this chart'],
  ])('"%s" is the same door', async (said) => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const s = withSettings(h)
    await say(said)
    expect(s.calls).toEqual(['c'])
  }, 40000)

  it('names the AAPL chart: only that chart opens', async () => {
    const { say, h } = p.mount(...TWO('AAPL', 'MSFT'))
    const s = withSettings(h)
    await say('open the settings for the AAPL chart')
    expect(s.calls).toEqual(['cl'])
  }, 40000)

  it('names a position: "show me the settings panel for the top-left chart"', async () => {
    const { say, h } = p.mount(...FOUR())
    const s = withSettings(h)
    await say('show me the settings panel for the top-left chart')
    expect(s.calls).toEqual(['c0'])
  }, 40000)

  it('⛔ two charts, none named or clicked: it asks which, and opens nothing', async () => {
    const { say, h } = p.mount(...TWO('NVDA', 'AMD'))
    const s = withSettings(h)
    const out = await say('open chart settings')
    expect(out).toMatch(/Which chart/i)
    expect(s.calls).toEqual([])
  }, 40000)

  it('two charts, one clicked: "this chart" is the clicked one', async () => {
    const { say, h } = p.mount(...TWO('NVDA', 'AMD'))
    const s = withSettings(h)
    p.select('cr')
    await say('open this chart\'s settings')
    expect(s.calls).toEqual(['cr'])
  }, 40000)

  // The negated / relative wordings are the model's to read (the fast path declines them). The member's words still bind
  // the target: a model op aimed at the chart they excluded never opens it (the existing deixis rule asks instead).
  const OPEN = (target) => p.env('apply', [{ action: 'chartSetup.openSettings', target, args: {} }])
  it('⛔ excluded: "the chart that is not NVDA" — the model aiming at NVDA anyway opens nothing, and asks', async () => {
    const { say, h } = p.mount(...TWO('NVDA', 'AMD'))
    const s = withSettings(h)
    p.st.envelopes.push(OPEN('cl'))
    const out = await say('open the settings on the chart that is not NVDA')
    expect(s.calls).toEqual([])
    expect(out).toMatch(/Which chart/i)
  }, 40000)
  // PRE-EXISTING on master 381f91acbd, every chart action alike (probed with volume.setState too): in "<request>, not the
  // NVDA chart" the lifted qualifier NAMES NVDA and the negation is not read, so a model op on NVDA lands there and one on
  // AMD is asked about. Shared targeting (deixis / the panel's target rule, #988's area) — not special-cased here.
  it.todo('⛔ excluded: "open chart settings, not the NVDA chart" never opens NVDA — GAP: shared qualifier negation (see PR-open-chart-settings.md)')

  it('⛔ excluded: "the other chart" (NVDA clicked) — the model aiming at the clicked chart opens nothing there', async () => {
    const { say, h } = p.mount(...TWO('NVDA', 'AMD'))
    const s = withSettings(h)
    p.select('cl')
    p.st.envelopes.push(OPEN('cl'))
    const out = await say('open the settings for the other chart')
    expect(s.calls).not.toContain('cl')
    expect(out).toMatch(/Which chart|the other|AMD/i)
  }, 40000)
  it('excluded control: "the other chart" (NVDA clicked), the model on AMD: AMD opens', async () => {
    const { say, h } = p.mount(...TWO('NVDA', 'AMD'))
    const s = withSettings(h)
    p.select('cl')
    p.st.envelopes.push(OPEN('cr'))
    await say('open the settings for the other chart')
    expect(s.calls).toEqual(['cr'])
  }, 40000)

  it('a chart with no settings door here (Multi Chart cell, a read-only surface) refuses and calls nothing', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const s = withSettings(h, { can: () => false })
    const out = await say('open chart settings')
    expect(out).toMatch(/can't open Chart Settings for that chart from here/)
    expect(s.calls).toEqual([])
  }, 40000)

  it('⛔ a dialog that did not open gets no success', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    withSettings(h, { land: false })
    const out = await say('open chart settings')
    expect(out).not.toMatch(/Opened Chart Settings/)
  }, 40000)

  it('already open: says so and calls nothing', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const s = withSettings(h)
    s.open.add('c')
    const out = await say('open chart settings')
    expect(out).toMatch(/already open/)
    expect(s.calls).toEqual([])
  }, 40000)

  it('says there is no Undo (nothing changed), and declares none', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    withSettings(h)
    const out = await say('open chart settings')
    expect(out).toMatch(/changes nothing, so there's nothing to undo/)
    const c = getCapability('chartSetup.openSettings')
    expect(c.undo).toBe('none')
    expect(c.target).toBe('chart')
    expect(c.surfaces).toEqual(['charts'])
  }, 40000)
})

describe('the words: what is and is not this door', () => {
  const host = { surface: 'charts', charts: { list: () => [] } }
  const action = (t) => { const r = fastParse(t, { host }); return r?.kind === 'ops' && r.ops.length === 1 ? r.ops[0].action : null }
  it('bare "open settings" stays the Settings PAGE (app.open), as before', () => {
    expect(action('open settings')).not.toBe('chartSetup.openSettings')
  })
  it('a question about HOW is the walkthrough (guide.show → the settings row), never the door', () => {
    const r = fastParse('how do i open chart settings', { host })
    expect(r?.ops?.map(o => [o.action, o.args.feature])).toEqual([['guide.show', 'settings']])
  })
  it('a setting change is not the door', () => {
    expect(action('open chart settings and turn off the grid')).not.toBe('chartSetup.openSettings')
    expect(action('change the chart settings')).not.toBe('chartSetup.openSettings')
  })
})

describe('the walkthrough: "how do I open chart settings" teaches the same door', () => {
  it('matches the existing "Finding chart settings" guide row, whose first step points at the gear', async () => {
    const { matchFeature } = await import('./guide/registry')
    for (const said of ['how do i open chart settings', 'how do i open the settings for a chart', 'where are the chart settings']) {
      const f = matchFeature(said, null, 'charts')
      expect(f?.id, said).toBe('settings')
      expect(f.steps[0].target).toBe('chart.settings')
      expect(f.steps[0].waitFor).toBe('chartSettings')
    }
  })
  it('the gear the walkthrough points at calls the very openSettings the Agent\'s door calls', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve, dirname } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../components/chart/pane/ChartPane.jsx'), 'utf8')
    const gear = src.slice(src.indexOf('data-guide="chart.settings"') - 200, src.indexOf('data-guide="chart.settings"') + 200)
    expect(gear).toMatch(/onClick=\{openSettings\}/)
    // the handle the Agent reaches (ChartWidget adapter → paneRef) hands out that same function
    const handle = src.slice(src.indexOf('useImperativeHandle(ref, () => ({'), src.indexOf('useImperativeHandle(ref, () => ({') + 400)
    expect(handle).toMatch(/^\s*openSettings,$/m)
  })
  it('the row\'s "do it" line names the Agent\'s door', async () => {
    const { matchFeature } = await import('./guide/registry')
    expect(matchFeature('how do i open chart settings', null, 'charts').doIt.say).toMatch(/open chart settings/i)
  })
})
