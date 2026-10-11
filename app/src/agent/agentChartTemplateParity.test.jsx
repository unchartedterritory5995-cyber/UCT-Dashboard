// app/src/agent/agentChartTemplateParity.test.jsx
//
// ─── ⭐ CLICK AND AGENT APPLY A SAVED CHART TEMPLATE IDENTICALLY ────────────────
//
// Integrator ruling 2026-10-11 (owner delegated): a member clicking a saved chart
// template and UCT Agent applying the same template must leave the chart in the SAME
// state — the one members already know from clicking (the template's whole saved
// settings, its indicators included). Until that day the click copied the template's
// indicators and the Agent kept the member's (`keepOwned`), so the same request gave two
// different charts depending on how it was asked.
//
// This drives BOTH real paths over one template and one starting chart:
//   · the click — the real ChartSettingsModal, Templates ▾ → the template's name, reading
//     the `chart_templates` pref, and the settings it hands to `onChange`;
//   · the Agent — the real `chart.applyTemplate` capability through plan → commit, and
//     the settings it persists;
// and asserts they are deep-equal. A source rail then holds the third door (the right-click
// flyout in ChartWidget) to the same ONE shared function, so no door can grow its own copy.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

const H = vi.hoisted(() => ({ templates: [] }))

vi.mock('../hooks/useUserDefinitions', () => ({
  useUserDefinitions: () => ({ rows: [], isLoading: false, error: null, refresh: () => {} }),
  useInstalledUserDefinitions: () => ({ installedIds: [], errors: [], generation: 0, isLoading: false, error: null }),
}))
vi.mock('../hooks/usePreferences', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    default: () => ({
      prefs: { chart_templates: JSON.stringify(H.templates) },
      setPref: vi.fn(async () => {}),
      setPrefMerged: vi.fn(async () => {}),
      isLoading: false,
    }),
  }
})

const { default: ChartSettingsModal } = await import('../components/chart/ChartSettingsModal')
const { mergeChartSettings } = await import('../components/chart/chartDefaults')
const { chartTemplateSettings } = await import('../components/chart/chartTemplateApply')
const { registerBuiltins } = await import('./builtins')
const { buildContext } = await import('./capabilities')
const { planOps, collectTargets, prepareOps } = await import('./executor')
const { commitPlan } = await import('./runtime')

registerBuiltins()

// The member's chart: their OWN indicators (an RSI 9) on a line chart.
const MINE = [{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { length: 9 }, hidden: false }]
const STORED = { chartType: 'line', indicatorInstances: MINE }
// The saved template: a different look AND different indicators (a MACD).
const TEMPLATE = {
  id: 'tplswing1', name: 'Swing Dark',
  settings: {
    ...mergeChartSettings({}),
    chartType: 'bars',
    grid: { color: '#111111', visible: false },
    indicatorInstances: [{ instanceId: 'inst:macd:1', defId: 'macd', inputs: {}, hidden: false }],
    paneOrder: ['macd'],
    preset: 'oled',
  },
}

function agentHost() {
  const st = { stored: JSON.parse(JSON.stringify(STORED)) }
  const read = (ref) => (ref === 'c1'
    ? { ref, label: 'Chart (NVDA)', symbol: 'NVDA', tf: 'D', stored: st.stored, cs: mergeChartSettings(st.stored || {}), linkedCount: 0 }
    : null)
  return {
    st,
    prefs: { read: () => ({ chart_templates: JSON.stringify(H.templates) }) },
    charts: {
      list: () => [read('c1')], read,
      commit(ref, patch) { if ('settings' in patch) st.stored = patch.settings; return true },
      goTo() { return true },
    },
    otherWidgets: () => [],
  }
}

async function agentApply(name) {
  const host = agentHost()
  const CTX = { surface: 'charts' }
  const ops = [{ action: 'chart.applyTemplate', target: 'c1', args: { template: name } }]
  buildContext(host, CTX)
  const env = await prepareOps(ops)
  const p = planOps(collectTargets(host, ['chart']), ops, env, CTX)
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  const res = await commitPlan(host, p, { env })
  expect(res.ok).toBe(true)
  return host.st.stored
}

function clickApply(name) {
  const onChange = vi.fn()
  render(<ChartSettingsModal open settings={mergeChartSettings(STORED)} onChange={onChange} />)
  fireEvent.click(screen.getByTitle('Open a saved chart-settings template'))
  fireEvent.click(screen.getByTitle(`Apply “${name}” to this chart`))
  expect(onChange).toHaveBeenCalledTimes(1)
  return onChange.mock.calls[0][0]
}

beforeEach(() => {
  H.templates = [TEMPLATE]
  globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('⭐ parity — clicking a saved chart template and asking the Agent give the identical chart', () => {
  it('the click and the Agent write deep-equal settings (indicators included)', async () => {
    const clicked = clickApply('Swing Dark')
    const asked = await agentApply('swing dark')        // the Agent matches names case-insensitively
    expect(asked).toEqual(clicked)
    // …and that shared state is the TEMPLATE's, indicators included — not the member's
    expect(clicked.indicatorInstances).toEqual(TEMPLATE.settings.indicatorInstances)
    expect(clicked.indicatorInstances).not.toEqual(MINE)
    expect(clicked).toMatchObject({ chartType: 'bars', preset: 'custom', paneOrder: ['macd'] })
    // and it is exactly the one shared apply's answer
    expect(clicked).toEqual(chartTemplateSettings(TEMPLATE))
  })

  it('CONTROL — the parity is not vacuous: two different templates give two different charts', async () => {
    const other = { ...TEMPLATE, id: 'tplother', name: 'Other', settings: { ...TEMPLATE.settings, chartType: 'line', indicatorInstances: [] } }
    H.templates = [TEMPLATE, other]
    const a = clickApply('Swing Dark'); cleanup()
    const b = await agentApply('Other')
    expect(b).not.toEqual(a)
  })

  it('the shared apply is a deep COPY — writing the result never mutates the saved template', () => {
    const out = chartTemplateSettings(TEMPLATE)
    out.indicatorInstances.push({ instanceId: 'x' })
    out.grid.color = '#000000'
    expect(TEMPLATE.settings.indicatorInstances).toHaveLength(1)
    expect(TEMPLATE.settings.grid.color).toBe('#111111')
    expect(chartTemplateSettings(null)).toBe(null)
    expect(chartTemplateSettings({ name: 'no settings' })).toBe(null)
  })
})

describe('⛔ every saved-template door calls the ONE shared apply', () => {
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..')
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
  // `{ ...<obj>.settings, preset: 'custom' }` — a template's settings spread by hand
  const RECIPE = /[\w$\])]\.settings\s*,\s*preset\s*:\s*['"]custom['"]/
  const DOORS = [
    'app/src/components/chart/ChartSettingsModal.jsx',
    'app/src/pages/charts/widgets/ChartWidget.jsx',
    'app/src/agent/capabilities/chart.js',
  ]
  it.each(DOORS)('%s calls chartTemplateSettings and builds no template blob of its own', (file) => {
    const src = read(file)
    expect(src).toMatch(/\bchartTemplateSettings\s*\(/)
    // the old per-door recipe: `{ ...t.settings, preset: 'custom' }` (a template's
    // settings, read off an object; the modal's SAVE snapshots its own `settings`, which
    // is not this shape and is allowed)
    expect(src).not.toMatch(RECIPE)
  })
  it('CONTROL — the recipe pattern sees the old door code, and the shared function still holds the recipe', () => {
    expect(RECIPE.test("x = { ...t.settings, preset: 'custom' }")).toBe(true)
    expect(RECIPE.test("x = { ...settings, preset: 'custom' }")).toBe(false)
    expect(read('app/src/components/chart/chartTemplateApply.js')).toMatch(/\.\.\.\s*settings\s*,\s*preset\s*:\s*['"]custom['"]/)
  })
})
