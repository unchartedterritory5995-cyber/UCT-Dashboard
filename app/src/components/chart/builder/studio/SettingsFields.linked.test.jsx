// THE SAME NUMBER IN SEVERAL PLACES (Indicators backlog 45c).
//
// Two settings that hold the same number are never merged: the formula does not say they are one
// idea. When one is changed and others of its kind still hold the old value, one line offers to
// move those too, and nothing moves without a press.
//
// The fields are driven through a small stateful caller that behaves like the real ones: each
// change re-derives the list, and a change made against an out-of-date setting is refused (the
// real door is compare-and-set). The real derivation is used for the end-to-end case.
import { useEffect, useState } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { parseFormula } from '../../engine/ast/parse'
import { applyPatch, openAuthoringState } from '../authoring'
import { settingsOf } from '../authoring/derivedSettings'
import { settingTurn } from '../authoring/authoringSession'
import SettingsFields, { sameNumberElsewhere, linkSentence } from './SettingsFields'

afterEach(() => { cleanup() })

const S = (id, role, value, caption = id) => ({ id, role, value, caption, captionFull: caption, whole: role === 'length', slots: [id] })

/** A caller that keeps the list, applies a change by id, and records every call it was given. */
function Harness({ initial, calls, refuse = () => false }) {
  const [settings, setSettings] = useState(initial)
  const onSet = (setting, value) => {
    calls.push([setting.id, setting.value, value])
    const now = settings.find((s) => s.id === setting.id)
    if (!now || now.value !== setting.value) return { ok: false, stale: true }     // compare-and-set
    if (refuse(setting, value)) return { ok: false, message: 'Not that one.' }
    setSettings(settings.map((s) => (s.id === setting.id ? { ...s, value } : s)))
    return { ok: true }
  }
  return <SettingsFields settings={settings} onSet={onSet} />
}
const fields = () => screen.getAllByTestId('studio-setting').map((r) => r.querySelector('input'))
const values = () => fields().map((f) => f.value)
const type = async (i, text) => {
  fireEvent.change(fields()[i], { target: { value: text } })
  await act(async () => { fireEvent.keyDown(fields()[i], { key: 'Enter' }) })
}
const offer = () => screen.queryByTestId('studio-settings-link')
const press = async (id) => { await act(async () => { fireEvent.click(screen.getByTestId(id)) }); await act(async () => {}) }

const THREE = [S('a', 'length', 50, 'sum of up volume'), S('b', 'length', 50, 'sum of down volume'), S('c', 'level', 50, 'RSI above')]

describe('the same number in several places', () => {
  it('changing one offers the others of its KIND that still hold the old value, and names them', async () => {
    const calls = []
    render(<Harness initial={THREE} calls={calls} />)
    expect(offer()).toBeNull()
    await type(0, '60')
    expect(values()).toEqual(['60', '50', '50'])                      // nothing else moved
    expect(offer().textContent).toContain('1 other length is also 50: sum of down volume.')
    expect(offer().textContent).not.toContain('RSI above')            // a level of 50 is a different kind
    expect(screen.getByTestId('studio-settings-link-yes').textContent).toBe('Set it to 60 too')
    expect(calls).toEqual([['a', 50, 60]])
  })

  it('"Set it too" moves exactly those, through the caller’s own door, one change at a time', async () => {
    const calls = []
    const four = [...THREE, S('d', 'length', 50, 'average volume')]
    render(<Harness initial={four} calls={calls} />)
    await type(0, '60')
    expect(offer().textContent).toContain('2 other lengths are also 50: sum of down volume, average volume.')
    await press('studio-settings-link-yes')
    expect(values()).toEqual(['60', '60', '50', '60'])                // the level of 50 is untouched
    expect(calls).toEqual([['a', 50, 60], ['b', 50, 60], ['d', 50, 60]])
    expect(offer()).toBeNull()
  })

  it('"Leave them" changes nothing, and the next change makes its own offer or none', async () => {
    const calls = []
    render(<Harness initial={THREE} calls={calls} />)
    await type(0, '60')
    await press('studio-settings-link-no')
    expect(offer()).toBeNull()
    expect(values()).toEqual(['60', '50', '50'])
    expect(calls).toHaveLength(1)
    await type(2, '70')                                               // the only level: nothing to offer
    expect(offer()).toBeNull()
  })

  it('an offer goes away when the other field is changed by hand, and a refused change offers nothing', async () => {
    const calls = []
    render(<Harness initial={THREE} calls={calls} refuse={(s, v) => v === 99} />)
    await type(0, '99')                                               // refused: another length is 50, and still no offer
    expect(offer()).toBeNull()
    expect(values()[0]).toBe('99')                                    // still typed, with the refusal beside it
    expect(screen.getByRole('alert').textContent).toBe('Not that one.')
    await type(0, '60')
    expect(offer()).not.toBeNull()
    await type(1, '55')                                               // the member set the other one themselves
    expect(offer()).toBeNull()
  })

  it('⛔ a caller whose list catches up a render LATER never has a move built from the list before the last one', async () => {
    // The form parses its formulas after its text changes, so its settings lag the change by a
    // render, and each change it makes is built from the list it is showing. A second move made
    // against the lagging list would be built from before the first and undo it.
    function Lagging() {
      const [text, setText] = useState([S('a', 'length', 50, 'A'), S('b', 'length', 50, 'B'), S('d', 'length', 50, 'D')])
      const [shown, setShown] = useState(text)
      useEffect(() => { setShown(text) }, [text])                     // one render behind
      const onSet = (setting, value) => {
        const now = shown.find((s) => s.id === setting.id)
        if (!now || now.value !== setting.value) return { ok: false, stale: true }
        setText(shown.map((s) => (s.id === setting.id ? { ...s, value } : s)))   // built from what is SHOWN
        return { ok: true }
      }
      return <SettingsFields settings={shown} onSet={onSet} />
    }
    render(<Lagging />)
    await type(0, '60')
    await act(async () => {})
    expect(values()).toEqual(['60', '50', '50'])
    await press('studio-settings-link-yes')
    await act(async () => {})
    await act(async () => {})
    expect(values()).toEqual(['60', '60', '60'])                      // every move kept, none undone
  })

  it('CONTROL: different numbers, or one setting, never produce an offer', async () => {
    const calls = []
    render(<Harness initial={[S('a', 'length', 50), S('b', 'length', 20)]} calls={calls} />)
    await type(0, '60')
    expect(offer()).toBeNull()
    expect(sameNumberElsewhere([S('a', 'length', 50)], S('a', 'length', 50))).toEqual([])
    expect(sameNumberElsewhere(null, S('a', 'length', 50))).toEqual([])
  })

  it('the sentence counts, names up to two and says how many more', () => {
    const o = [S('b', 'length', 50, 'B'), S('c', 'length', 50, 'C'), S('d', 'length', 50, 'D'), S('e', 'length', 50, 'E')]
    expect(linkSentence(o.slice(0, 1), 'length', 50)).toBe('1 other length is also 50: B.')
    expect(linkSentence(o, 'length', 50)).toBe('4 other lengths are also 50: B, C, and 2 more.')
    expect(linkSentence(o.slice(0, 2), 'bars back', 5)).toBe('2 other bars-back values are also 5: B, C.')
    expect(linkSentence([], 'length', 50)).toBe('')
  })
})

describe('with the real derivation and the real edit', () => {
  const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(`${src}: ${r.error}`); return r.ast }
  const GATE = { tf: 'D', symbol: 'AAPL' }

  function Real({ onState }) {
    const [state, setState] = useState(() => {
      const r = applyPatch(null, { contract: 'uct.authoring.patch/1', baseRevision: 0, assumptions: [], ops: [{ op: 'create', name: 'x',
        outputs: [{ key: 'value', label: 'value', tree: P('sum(close > open ? volume : 0, 50) / sum(close < open ? volume : 0, 50)') }] }] }, { gateCtx: GATE })
      expect(r.status, JSON.stringify(r.errors)).toBe('applied')
      return openAuthoringState(r.definition)
    })
    onState(state)
    const onSet = (setting, value) => {
      const out = settingTurn(state, setting, value, { gateCtx: GATE })
      if (out.ok) setState(out.state)
      return out
    }
    return <SettingsFields settings={settingsOf(state.working)} onSet={onSet} />
  }

  it('two 50-session sums are two settings; changing one and saying yes moves both, as two undoable steps', async () => {
    let last = null
    render(<Real onState={(s) => { last = s }} />)
    expect(values()).toEqual(['50', '50'])
    const before = last.history.length
    await type(0, '30')
    expect(values()).toEqual(['30', '50'])
    expect(offer().textContent).toMatch(/^1 other length is also 50: /)
    await press('studio-settings-link-yes')
    expect(values()).toEqual(['30', '30'])
    expect(settingsOf(last.working).map((s) => s.value)).toEqual([30, 30])
    expect(last.history.length).toBe(before + 2)
  })
})
