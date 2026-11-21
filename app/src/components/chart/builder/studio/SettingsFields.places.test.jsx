// app/src/components/chart/builder/studio/SettingsFields.places.test.jsx
//
// "length · 2 places" (2026-11-20). A setting that holds ONE number in several places of the formula said
// "· 2 places" under its caption, which reads as two decimal places. It says what it means: the number is used
// in that many places, and changing it moves all of them.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { parseFormula } from '../../engine/ast/parse'
import { applyPatch } from '../authoring'
import { settingsOf } from '../authoring/derivedSettings'
import SettingsFields from './SettingsFields'

afterEach(() => { cleanup() })

const S = (id, role, value, slots) => ({ id, role, value, caption: id, captionFull: id, whole: role === 'length', slots })
const roleLine = (row) => row.querySelector('label').lastElementChild.textContent
const rows = () => screen.getAllByTestId('studio-setting')

describe('how many places a setting sits in', () => {
  it('one place says only what the number is; several say how many places use it', () => {
    render(<SettingsFields onSet={() => ({ ok: true })} settings={[
      S('a', 'length', 20, ['p1']), S('b', 'multiple', 0.997, ['p1', 'p2']), S('c', 'level', 70, ['p1', 'p2', 'p3']),
    ]} />)
    expect(rows().map(roleLine)).toEqual(['length', 'multiple · used in 2 places', 'level · used in 3 places'])
    // never the bare count, which read as decimal places
    for (const row of rows()) expect(roleLine(row)).not.toMatch(/· \d+ places/)
  })

  it('on a real indicator: one condition in two outputs is ONE setting, and its row says so', () => {
    const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(r.error); return r.ast }
    const made = applyPatch(null, { contract: 'uct.authoring.patch/1', baseRevision: 0, assumptions: [], ops: [{ op: 'create', name: 'x', outputs: [
      { key: 'count', label: 'count', tree: P('sum(((close <= close[1] * 0.997) && (volume > volume[1])) ? 1 : 0, 20)') },
      { key: 'isDay', label: 'isDay', tree: P('(close <= close[1] * 0.997) && (volume > volume[1])') },
    ] }] }, { gateCtx: { tf: 'D', symbol: 'AAPL' } })
    expect(made.status, JSON.stringify(made.errors)).toBe('applied')
    const settings = settingsOf(made.definition)
    const shared = settings.find((s) => s.value === 0.997)
    expect(shared.slots.length).toBe(2)                                   // (the fixture really shares it)
    render(<SettingsFields onSet={() => ({ ok: true })} settings={settings} />)
    const said = rows().map(roleLine)
    expect(said.filter((t) => t.endsWith('· used in 2 places')).length).toBe(1)
    expect(said.some((t) => t === 'length')).toBe(true)                   // the 20-bar window sits in one place
  })
})
