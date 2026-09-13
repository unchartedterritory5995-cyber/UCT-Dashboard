// app/src/components/chart/ChartSettingsModal.conditions.test.jsx
//
// ─── THE CONDITIONS TAB, AS A MEMBER READS IT ───────────────────────────────
//
// ⭐ THE COLLAPSED ROW IS THE WHOLE LIST'S JOB. A member scanning their
// conditions is asking one question of each — *"what does this draw?"* — and the
// row has to answer it without being opened. These cases hold that answer;
// nothing here touches truth, first-match, action priority or alert durability,
// which are the engine's and are tested where they live.
//
// ⚠️ THIS FILE EXISTS BECAUSE THERE WAS NO OTHER. The Conditions tab had no
// component test at all, which is why a row could badge `0 actions` and three
// identical "＋ Add" chips could render three different shapes without anything
// going red.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import { addCondition } from './engine/conditionControls'

// ⚠️ THE CONDITIONS TAB MOUNTS THE ALERT DOOR, which reads `useAuth`. The alert
// relationship is not what these cases are about, and the same double every
// other chart suite uses keeps the provider out of the fixture.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

const openConditions = () => fireEvent.click(screen.getByRole('tab', { name: /Conditions/i }))

/** Settings carrying one condition, with whatever actions the case needs. */
const withCondition = (actions = []) => {
  const cs = addCondition(mergeChartSettings({}), {
    name: 'Trend up', formula: 'close > open', actions,
  })
  return cs
}

/** The collapsed row's own summary — the text beside the name. */
const summaryOf = (name) => {
  const toggle = screen.getByRole('switch', { name: new RegExp(`Toggle ${name}`, 'i') })
  const row = toggle.parentElement
  const expander = within(row).getByRole('button', { expanded: false })
  return expander.textContent.replace(name, '').trim()
}

// ⚠️ AND A ROUTER, for the same reason: the alert door links out to Alert Centre.
const show = (cs) => render(
  <MemoryRouter>
    <ChartSettingsModal open settings={cs} onChange={() => {}} onClose={() => {}} />
  </MemoryRouter>,
)

describe('a collapsed condition row says what it DRAWS', () => {
  it('⭐⭐ it NAMES the action rather than counting actions', () => {
    // ⚰️ MEASURED 2026-09-13: the row read `2 actions`, which answers a question
    // nobody asked and still needs the row opened to learn anything.
    show(withCondition([
      { type: 'candleColor', color: '#4ade80' },
      { type: 'marker', shape: 'dot', position: 'aboveBar', color: '#4ade80' },
    ]))
    openConditions()
    expect(summaryOf('Trend up')).toBe('Candle colour · Marker')
    cleanup()
  })

  it('⭐ one action reads as that one action', () => {
    show(withCondition([{ type: 'candleColor', color: '#4ade80' }]))
    openConditions()
    expect(summaryOf('Trend up')).toBe('Candle colour')
    cleanup()
  })

  it('⛔ …and DUPLICATE types are one answer, not two', () => {
    // "What does this draw?" is answered once by "Candle colour", however many
    // candle-colour actions are behind it.
    show(withCondition([
      { type: 'candleColor', color: '#4ade80' },
      { type: 'candleColor', color: '#ef4444' },
    ]))
    openConditions()
    expect(summaryOf('Trend up')).toBe('Candle colour')
    cleanup()
  })

  it('⛔⛔ ZERO ACTIONS IS THE NEXT STEP, NOT A BADGE READING ZERO', () => {
    // A condition with no action evaluates and draws nothing. That is worth
    // saying once — as a prompt, not as a count of things that are not there.
    show(withCondition([]))
    openConditions()
    const summary = summaryOf('Trend up')
    expect(summary).toBe('No action yet')
    expect(summary, 'the empty state was reported as a count').not.toMatch(/\d/)
    cleanup()
  })

  it('⭐ a third KIND is capped rather than wrapped', () => {
    show(withCondition([
      { type: 'candleColor', color: '#4ade80' },
      { type: 'marker', shape: 'dot', position: 'aboveBar', color: '#4ade80' },
      { type: 'background', color: '#4ade80' },
    ]))
    openConditions()
    expect(summaryOf('Trend up')).toBe('Candle colour · Marker +1')
    cleanup()
  })
})

describe('the starter rows offer one shape of affordance', () => {
  it('⛔ every "Add" chip carries an accessible name and none of them wraps', () => {
    // ⚰️ MEASURED IN A BROWSER: the starter whose hint ran to two lines squeezed
    // its chip into a two-line button — 37px tall against its neighbours' 25px,
    // and three pixels further right. Three identical actions, three shapes.
    //
    // ⚠️ THE PIXEL PROOF IS THE BROWSER'S; jsdom has no layout. What this holds is
    // the half that CAN be asserted here — that the class carrying `white-space:
    // nowrap` is the one every chip uses, and that each is separately nameable.
    show(mergeChartSettings({}))
    openConditions()
    const adds = screen.getAllByRole('button', { name: /^Add .* condition$/ })
    expect(adds.length, 'no starter rows to check').toBeGreaterThan(2)
    const classes = new Set(adds.map((b) => b.className))
    expect(classes.size, 'the starter chips do not share one class').toBe(1)
    for (const b of adds) expect(b.getAttribute('aria-label')).toMatch(/^Add .+ condition$/)
    cleanup()
  })
})
