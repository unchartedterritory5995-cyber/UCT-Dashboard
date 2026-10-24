// The UCT Intelligence indicator: its state model (uctIntelligence.js), its panel
// (UctIntelligencePanel.jsx) and its row in the Indicators library. Asserted by what RENDERS
// for the panel and the library, and by the blob written for persistence.
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  UCT_INTELLIGENCE_ROW, sanitizeUctIntelligence, isUctIntelligenceAdded, readUctIntelligence,
  addUctIntelligence, removeUctIntelligence, setUctIntelligenceLayer, layerAvailability, effectiveLayers,
} from './uctIntelligence'
import { mergeChartSettings } from './chartDefaults'
import { isRowOn, toggledRow } from './IndicatorLibraryDialog'
import UctIntelligencePanel, { setupDisplayName } from './UctIntelligencePanel'
import PatternToolbarButton from './PatternToolbarButton'

const NONE = layerAvailability({})
const ALL = layerAvailability({ levelsSr: [], candleMarks: [], setupsReleased: true })

describe('state model — a chart that never added it is exactly as before', () => {
  it('defaults: not added, Auto patterns follows showPatterns, labels ON, gated layers OFF', () => {
    expect(readUctIntelligence({})).toEqual({
      added: false, autoPatterns: false, labels: true, supportResistance: false, candles: false, setups: false,
    })
    expect(readUctIntelligence({ showPatterns: true }).autoPatterns).toBe(true)
  })

  it('mergeChartSettings adds NO key for a blob that never carried one (byte-identical merge)', () => {
    expect('uctIntelligence' in mergeChartSettings(JSON.stringify({ showPatterns: true }))).toBe(false)
    expect('uctIntelligence' in mergeChartSettings(null)).toBe(false)
  })

  it('mergeChartSettings keeps a stored block (sanitised) so the widget blob round-trips', () => {
    const m = mergeChartSettings(JSON.stringify({ uctIntelligence: { added: true, labels: false, junk: 1, setups: 'yes' } }))
    expect(m.uctIntelligence).toEqual({ added: true, labels: false })
  })

  it('sanitize: booleans only, null when empty or malformed', () => {
    expect(sanitizeUctIntelligence(null)).toBeNull()
    expect(sanitizeUctIntelligence([])).toBeNull()
    expect(sanitizeUctIntelligence({ x: 1 })).toBeNull()
    expect(sanitizeUctIntelligence({ added: false })).toEqual({ added: false })
  })
})

describe('add / remove / layer writes', () => {
  it('add turns Auto patterns (showPatterns) and labels ON', () => {
    const s = addUctIntelligence({ showPatterns: false })
    expect(s.showPatterns).toBe(true)
    expect(s.uctIntelligence).toEqual({ added: true, labels: true })
    expect(isUctIntelligenceAdded(s)).toBe(true)
  })

  it('add keeps a member\'s earlier labels-off choice', () => {
    expect(addUctIntelligence({ uctIntelligence: { labels: false } }).uctIntelligence.labels).toBe(false)
  })

  it('remove turns every layer off, Auto patterns included, and keeps sub-choices for next time', () => {
    const s = removeUctIntelligence({ showPatterns: true, uctIntelligence: { added: true, setups: true } })
    expect(s.showPatterns).toBe(false)
    expect(s.uctIntelligence).toEqual({ added: false, setups: true })
  })

  it('autoPatterns writes showPatterns — the Patterns button\'s own key, no second copy', () => {
    const s = setUctIntelligenceLayer({ uctIntelligence: { added: true } }, 'autoPatterns', true)
    expect(s.showPatterns).toBe(true)
    expect(s.uctIntelligence).toEqual({ added: true })
  })

  it('an unknown layer is refused BY IDENTITY (nothing to persist)', () => {
    const s = { showPatterns: true }
    expect(setUctIntelligenceLayer(s, 'learnedLines', true)).toBe(s)
  })
})

describe('gating — a released layer is one signal, and unreleased means OFF', () => {
  it('nothing is released today without its signal', () => {
    expect(NONE).toEqual({ supportResistance: false, candles: false, setups: false })
  })

  it('S/R lights from the PRESENCE of levels_sr (even empty), never from a hardcoded flag', () => {
    expect(layerAvailability({ levelsSr: [] }).supportResistance).toBe(true)
    expect(layerAvailability({ levelsSr: null }).supportResistance).toBe(false)
    expect(layerAvailability({ levelsSr: undefined }).supportResistance).toBe(false)
  })

  it('setups need an explicit true release', () => {
    expect(layerAvailability({ setupsReleased: 'true' }).setups).toBe(false)
    expect(layerAvailability({ setupsReleased: true }).setups).toBe(true)
  })

  it('a stored ON for an unreleased layer is OFF in effect', () => {
    const cs = { uctIntelligence: { added: true, supportResistance: true, candles: true, setups: true } }
    expect(effectiveLayers(cs, NONE)).toMatchObject({ supportResistance: false, candles: false, setups: false })
    expect(effectiveLayers(cs, ALL)).toMatchObject({ supportResistance: true, candles: true, setups: true })
  })

  it('a layer is never on for a chart that has not added the indicator', () => {
    const cs = { uctIntelligence: { added: false, setups: true } }
    expect(effectiveLayers(cs, ALL).setups).toBe(false)
  })
})

describe('library row', () => {
  it('is on only while added; toggling adds then removes', () => {
    expect(isRowOn(UCT_INTELLIGENCE_ROW, {})).toBe(false)
    const added = toggledRow(UCT_INTELLIGENCE_ROW, {}, null)
    expect(isRowOn(UCT_INTELLIGENCE_ROW, added)).toBe(true)
    expect(added.showPatterns).toBe(true)
    const removed = toggledRow(UCT_INTELLIGENCE_ROW, added, null)
    expect(isRowOn(UCT_INTELLIGENCE_ROW, removed)).toBe(false)
    expect(removed.showPatterns).toBe(false)
  })

  it('a chart whose Patterns button is on but never added the indicator reads NOT added', () => {
    expect(isRowOn(UCT_INTELLIGENCE_ROW, { showPatterns: true })).toBe(false)
  })

  it('is one per chart (no "Add another")', () => {
    expect(UCT_INTELLIGENCE_ROW.singleton).toBe(true)
  })
})

function panel(props = {}) {
  const onSetLayer = vi.fn()
  const onRemove = vi.fn()
  render(
    <UctIntelligencePanel
      state={readUctIntelligence({ showPatterns: true, uctIntelligence: { added: true, labels: true } })}
      availability={NONE}
      onSetLayer={onSetLayer}
      onRemove={onRemove}
      {...props}
    />,
  )
  return { onSetLayer, onRemove }
}

describe('UctIntelligencePanel', () => {
  it('shows Auto patterns + labels, both checked on add', () => {
    panel()
    expect(screen.getByLabelText('Auto patterns').checked).toBe(true)
    expect(screen.getByLabelText('Pattern labels & numbers').checked).toBe(true)
  })

  it('HIDES (never disables) every unreleased toggle', () => {
    panel()
    expect(screen.queryByLabelText('Support & resistance')).toBeNull()
    expect(screen.queryByLabelText('Candlestick patterns')).toBeNull()
    expect(screen.queryByLabelText('Setups')).toBeNull()
    expect(screen.queryByTestId('uct-intel-admin')).toBeNull()
  })

  it('a released layer\'s toggle appears from its gate', () => {
    panel({ availability: ALL })
    expect(screen.getByLabelText('Support & resistance')).toBeTruthy()
    expect(screen.getByLabelText('Candlestick patterns')).toBeTruthy()
    expect(screen.getByLabelText('Setups')).toBeTruthy()
  })

  it('toggles report their layer key', () => {
    const { onSetLayer } = panel({ availability: ALL })
    fireEvent.click(screen.getByLabelText('Auto patterns'))
    expect(onSetLayer).toHaveBeenLastCalledWith('autoPatterns', false)
    fireEvent.click(screen.getByLabelText('Pattern labels & numbers'))
    expect(onSetLayer).toHaveBeenLastCalledWith('labels', false)
    fireEvent.click(screen.getByLabelText('Support & resistance'))
    expect(onSetLayer).toHaveBeenLastCalledWith('supportResistance', true)
  })

  it('remove button calls onRemove', () => {
    const { onRemove } = panel()
    fireEvent.click(screen.getByLabelText('Remove UCT Intelligence'))
    expect(onRemove).toHaveBeenCalled()
  })

  it('setups list: member names and one-line definitions, never a raw id when a name exists', () => {
    panel({
      availability: ALL,
      state: readUctIntelligence({ uctIntelligence: { added: true, setups: true } }),
      setups: {
        loading: false, error: false,
        setups: [
          { setup: 'macd_bullish_cross', setup_name: 'MACD Bullish Cross', setup_definition: 'MACD line crosses above signal line.', asof_date: '2026-10-22' },
          { setup: 'some_new_id', setup_name: null, asof_date: '2026-10-21' },
        ],
      },
    })
    const items = screen.getAllByTestId('uct-intel-setup')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('MACD Bullish Cross')
    expect(items[0].textContent).toContain('MACD line crosses above signal line.')
    expect(items[0].textContent).not.toContain('macd_bullish_cross')
    expect(items[1].textContent).toContain('Some New Id')
  })

  it('setups empty state says so', () => {
    panel({
      availability: ALL,
      state: readUctIntelligence({ uctIntelligence: { added: true, setups: true } }),
      setups: { setups: [], loading: false, error: false },
    })
    expect(screen.getByTestId('uct-intel-setups-empty')).toBeTruthy()
  })

  it('admin section only when the host passes it; Key levels only under All tiers', () => {
    const admin = { showAll: false, onShowAll: vi.fn(), showLevels: false, onShowLevels: vi.fn(), showLearned: true, onShowLearned: vi.fn() }
    panel({ admin })
    expect(screen.getByTestId('uct-intel-admin')).toBeTruthy()
    expect(screen.getByLabelText('Learned levels & trendlines').checked).toBe(true)
    expect(screen.queryByLabelText('Key levels layer')).toBeNull()
    fireEvent.click(screen.getByLabelText('All tiers'))
    expect(admin.onShowAll).toHaveBeenCalledWith(true)
  })

  it('setupDisplayName prefers the server name', () => {
    expect(setupDisplayName({ setup: 'a_b', setup_name: 'X' })).toBe('X')
    expect(setupDisplayName({ setup: 'a_b' })).toBe('A B')
  })
})

// The Patterns button and the panel's Auto patterns toggle are two doors onto ONE key.
function Both() {
  const [cs, setCs] = useState({ showPatterns: false, uctIntelligence: { added: true, labels: true } })
  return (
    <>
      <PatternToolbarButton active={!!cs.showPatterns} onToggle={(v) => setCs({ ...cs, showPatterns: v })} />
      <UctIntelligencePanel state={readUctIntelligence(cs)} availability={NONE}
        onSetLayer={(k, v) => setCs(setUctIntelligenceLayer(cs, k, v))} onRemove={() => {}} />
    </>
  )
}

describe('Patterns button ⇄ Auto patterns — one source of truth', () => {
  it('the button lights the toggle, and the toggle lights the button', () => {
    render(<Both />)
    const btn = screen.getByLabelText('Toggle chart patterns overlay')
    const box = screen.getByLabelText('Auto patterns')
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(box.checked).toBe(false)
    fireEvent.click(btn)
    expect(screen.getByLabelText('Auto patterns').checked).toBe(true)
    fireEvent.click(screen.getByLabelText('Auto patterns'))
    expect(screen.getByLabelText('Toggle chart patterns overlay').getAttribute('aria-pressed')).toBe('false')
  })
})

// ─── The Indicators library: the row exists only where the host offers it ─────
import IndicatorLibraryDialog from './IndicatorLibraryDialog'
import * as engineRegistry from './engine/nativeRegistry'

const uctRow = () => document.querySelector('[data-def-id="uctIntelligence"]')

describe('Indicators library — UCT Intelligence entry', () => {
  it('absent when the host offers no extra rows (members without the pattern layer, every other surface)', () => {
    render(<IndicatorLibraryDialog open onClose={() => {}} settings={mergeChartSettings(null)}
      onChange={vi.fn()} registry={engineRegistry} />)
    expect(uctRow()).toBeNull()
  })

  it('offered by the host: one row; clicking it adds the indicator with Auto patterns + labels ON', () => {
    const onChange = vi.fn()
    render(<IndicatorLibraryDialog open onClose={() => {}} settings={mergeChartSettings(null)}
      onChange={onChange} registry={engineRegistry} extraRows={[UCT_INTELLIGENCE_ROW]} />)
    expect(document.querySelectorAll('[data-def-id="uctIntelligence"]')).toHaveLength(1)
    expect(uctRow().getAttribute('aria-selected')).toBe('false')
    fireEvent.click(uctRow())
    const written = onChange.mock.calls.at(-1)[0]
    expect(written.showPatterns).toBe(true)
    expect(written.uctIntelligence).toEqual({ added: true, labels: true })
  })

  it('ticked when added; clicking again removes it', () => {
    const onChange = vi.fn()
    const added = addUctIntelligence(mergeChartSettings(null))
    render(<IndicatorLibraryDialog open onClose={() => {}} settings={added}
      onChange={onChange} registry={engineRegistry} extraRows={[UCT_INTELLIGENCE_ROW]} />)
    expect(uctRow().getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByLabelText('Add another UCT Intelligence')).toBeNull()
    fireEvent.click(uctRow())
    const written = onChange.mock.calls.at(-1)[0]
    expect(written.uctIntelligence.added).toBe(false)
    expect(written.showPatterns).toBe(false)
  })

  it('findable by search ("patterns")', () => {
    render(<IndicatorLibraryDialog open onClose={() => {}} settings={mergeChartSettings(null)}
      onChange={vi.fn()} registry={engineRegistry} extraRows={[UCT_INTELLIGENCE_ROW]} />)
    fireEvent.change(screen.getByLabelText('Search indicators'), { target: { value: 'patterns' } })
    expect(uctRow()).toBeTruthy()
  })
})
