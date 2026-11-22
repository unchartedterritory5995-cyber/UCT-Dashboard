// RS screens, unit U6: Table mode and the `hidden` starters. The server marks seven starters
// `hidden: true` while the five RS screens are served (CONTRACT-SCREENS.md section 2). The Focus
// menu left them out from the start (U5); the Table mode's two lists, the "Screener" menu's UCT
// Preset Scans and the preset chips, printed every starter they were sent, so the retired screens
// were back the moment a member switched to Table. The starters below are the SERVER'S payload
// (rsScreensFixture reads the suite's goldens), never a typed copy.
import { render, screen, within, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { STARTERS_ON, RS_STARTERS, HIDDEN_STARTERS, PLAIN_STARTERS } from './focus/__tests__/rsScreensFixture'

const state = vi.hoisted(() => ({ saved: [], starters: [], error: null }))
vi.mock('./hooks/useSavedScreens', () => ({ default: () => ({ ...state, create: vi.fn(), update: vi.fn(), remove: vi.fn(), refresh: vi.fn() }) }))
vi.mock('../../hooks/useUserDefinitions', () => ({ useUserDefinitions: () => ({ rows: [], error: null, refresh: vi.fn() }), deleteUserDefinition: vi.fn() }))
vi.mock('../../components/screener/ScanResults', () => ({ default: () => null }))
vi.mock('./hooks/useScreenerMeta', () => ({ default: () => ({ meta: { filters: [] }, isLoading: false }), META_KEY: '/api/screener/meta' }))
let prefsValue = {}
const setPrefMerged = vi.fn()
vi.mock('../../hooks/usePreferences', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, default: () => ({ prefs: prefsValue, setPrefMerged, setPref: vi.fn(), loading: false }) }
})

import ScreensManager from './ScreensManager'
import PresetChips from './shell/PresetChips'
import { offeredStarters } from './focus/screenGroups'

const QUICKSAND = HIDDEN_STARTERS.find(s => s.id === 'starter_rs_quicksand_5')
const VISIBLE = [...PLAIN_STARTERS, ...RS_STARTERS].map(s => s.name)

beforeEach(() => { state.starters = STARTERS_ON; state.saved = []; prefsValue = {}; setPrefMerged.mockClear() })

describe('offeredStarters', () => {
  test('leaves out every hidden starter, keeps the payload order, and keeps the ones a member chose', () => {
    expect(offeredStarters(STARTERS_ON).map(s => s.name)).toEqual(VISIBLE)
    expect(offeredStarters(STARTERS_ON, new Set([QUICKSAND.id])).map(s => s.id)).toContain(QUICKSAND.id)
    expect(offeredStarters(STARTERS_ON, new Set([QUICKSAND.id]))).toHaveLength(VISIBLE.length + 1)
  })
  test('a payload with no hidden starter is returned whole (the flag is off)', () => {
    expect(offeredStarters(PLAIN_STARTERS)).toEqual(PLAIN_STARTERS)
    expect(offeredStarters(null)).toEqual([])
  })
})

describe('the Table mode\'s "Screener" menu', () => {
  const open = () => { render(<ScreensManager currentSpec={{}} onApply={vi.fn()} onUseScan={vi.fn()} />); fireEvent.click(screen.getByText('Screener ▾')) }
  const presets = () => screen.getByText('UCT Preset Scans').parentElement

  test('UCT Preset Scans lists the five RS screens and no hidden starter', () => {
    open()
    const rs = within(presets()).getByRole('group', { name: 'Relative strength' })
    expect([...rs.children].slice(1).map(r => r.querySelector('button').textContent)).toEqual(RS_STARTERS.map(s => s.name))
    for (const h of HIDDEN_STARTERS) expect(within(presets()).queryByText(h.name), h.id).toBeNull()
  })
  test('a hidden starter the member favourited still shows under Favorites', () => {
    prefsValue = { screener_favorite_screens: JSON.stringify([`starter:${QUICKSAND.id}`]) }
    open()
    expect(screen.getAllByText(QUICKSAND.name)).toHaveLength(1)
    expect(within(presets()).queryByText(QUICKSAND.name)).toBeNull()
  })
})

describe('the Table mode\'s preset chips', () => {
  const chips = () => within(screen.getByRole('group', { name: 'Preset scans' })).getAllByRole('button').map(b => b.textContent).filter(t => !/Edit/.test(t))

  test('with nothing chosen there is a chip per offered starter, and none for a hidden one', () => {
    render(<PresetChips currentSpec={{ filters: [] }} onApply={vi.fn()} />)
    expect(chips()).toEqual(VISIBLE)
    fireEvent.click(screen.getByRole('button', { name: /Choose which preset scans show/ }))
    const menu = screen.getByRole('menu')
    for (const h of HIDDEN_STARTERS) expect(within(menu).queryByText(h.name), h.id).toBeNull()
    // the first edit materialises the selection from what is OFFERED, never from a hidden starter
    fireEvent.click(within(menu).getAllByRole('checkbox')[0])
    const next = setPrefMerged.mock.calls[0][1](undefined)
    for (const h of HIDDEN_STARTERS) expect(next, h.id).not.toContain(h.id)
    expect(next).toHaveLength(VISIBLE.length - 1)
  })
  test('a hidden starter a stored selection names keeps its chip and can be unticked', () => {
    prefsValue = { screener_preset_chips: JSON.stringify([QUICKSAND.id, 'starter_rs_leaders']) }
    render(<PresetChips currentSpec={{ filters: [] }} onApply={vi.fn()} />)
    expect(chips().sort()).toEqual([QUICKSAND.name, 'UCT RS Leaders'].sort())
    fireEvent.click(screen.getByRole('button', { name: /Choose which preset scans show/ }))
    expect(within(screen.getByRole('menu')).getByText(QUICKSAND.name)).toBeInTheDocument()
  })
})
