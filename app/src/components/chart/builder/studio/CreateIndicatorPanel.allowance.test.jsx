// F1 (Studio plan, section 6): the dock says how much of today's allowance is left once less
// than half is, so a member learns it is running out before it has.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { scriptedConverse } from '../../../../testing/createIndicator/scriptedConverse'
import { allowanceOf } from '../authoring/converseClient'

vi.mock('../authoring/studioTelemetry', async (orig) => ({ ...(await orig()), logStudioAction: vi.fn() }))

import CreateIndicatorPanel, { allowanceLine, ALLOWANCE_NOTE_BELOW } from './CreateIndicatorPanel'

afterEach(() => { cleanup(); registry.clearUserDefinitions() })

const withLeft = (left) => async (args) => ({ ...(await scriptedConverse(args)), ...(left == null ? {} : { allowanceLeft: left }) })

function mount(converse) {
  render(<CreateIndicatorPanel settings={mergeChartSettings({})} onChange={() => {}} sym="AAPL" tf="D"
    onPreview={() => {}} onClose={() => {}} converse={converse} />)
}
async function say(text) {
  fireEvent.change(screen.getByTestId('create-indicator-input'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-send')) })
  await act(async () => {})
}

describe('the allowance line', () => {
  it('says nothing while half or more is left', async () => {
    mount(withLeft(0.5))
    await say('Add a 20 EMA')
    expect(screen.queryByTestId('create-indicator-allowance')).toBeNull()
  })

  it('says about how much is left once less than half is, and follows each answer', async () => {
    let left = 0.35
    mount(async (args) => ({ ...(await scriptedConverse(args)), allowanceLeft: left }))
    await say('Add a 20 EMA')
    expect(screen.getByTestId('create-indicator-allowance').textContent)
      .toBe("About 35% of today's UCT Intelligence allowance is left.")
    left = 0.1
    await say('Make it 50')
    expect(screen.getByTestId('create-indicator-allowance').textContent).toMatch(/About 10%/)
  })

  it('a spent allowance says so without promising a time', async () => {
    mount(async () => ({ ok: false, gate: 'cost:user', reason: '', notUnderstood: [], unavailable: [] }))
    await say('Add a 20 EMA')
    const line = screen.getByTestId('create-indicator-allowance').textContent
    expect(line).toBe("Today's UCT Intelligence allowance is used up. It renews each day.")
    expect(line).not.toMatch(/\d{1,2}(:\d\d)?\s?(am|pm)|midnight|in \d+ (hours|minutes)/i)
  })

  it('an answer without the figure leaves the line as it was (an older server says nothing)', async () => {
    mount(withLeft(null))
    await say('Add a 20 EMA')
    expect(screen.queryByTestId('create-indicator-allowance')).toBeNull()
  })
})

describe('the pieces', () => {
  it('allowanceLine: nothing at or above the threshold, a floor of 5% while anything is left', () => {
    expect(ALLOWANCE_NOTE_BELOW).toBe(0.5)
    expect(allowanceLine(0.5)).toBeNull()
    expect(allowanceLine(1)).toBeNull()
    expect(allowanceLine(null)).toBeNull()
    expect(allowanceLine(0.01)).toMatch(/About 5%/)
    expect(allowanceLine(0)).toMatch(/used up/)
  })

  it('allowanceOf reads only a share between 0 and 1', () => {
    expect(allowanceOf({ allowance_left: 0.4 })).toEqual({ allowanceLeft: 0.4 })
    for (const v of [undefined, null, -0.1, 1.5, 'half', Number.NaN]) expect(allowanceOf({ allowance_left: v })).toEqual({})
    expect(allowanceOf(null)).toEqual({})
  })
})
