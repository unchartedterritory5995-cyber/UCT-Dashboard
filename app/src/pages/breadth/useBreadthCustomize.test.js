import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useBreadthCustomize, {
  STORAGE_KEY,
  DEFAULT_PRESET,
  BUILTIN_LABEL,
  templateLabel,
  migrateStored,
  validatePresetName,
} from './useBreadthCustomize'

beforeEach(() => {
  localStorage.clear()
})

describe('useBreadthCustomize', () => {
  it('starts with Default active and empty hidden set on first mount', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.hidden.size).toBe(0)
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET])
    expect(result.current.isDefaultActive).toBe(true)
  })

  it('savePreset creates a custom preset and switches to it', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('MA Only', ['breadth_score', 'vix']))
    expect(result.current.activePreset).toBe('MA Only')
    expect(result.current.hidden.has('breadth_score')).toBe(true)
    expect(result.current.hidden.has('vix')).toBe(true)
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET, 'MA Only'])
  })

  it('toggleHidden flips a key in the active preset', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('MA', ['vix']))
    act(() => result.current.toggleHidden('vix'))
    expect(result.current.hidden.has('vix')).toBe(false)
    act(() => result.current.toggleHidden('vix'))
    expect(result.current.hidden.has('vix')).toBe(true)
  })

  it('toggleHidden on the built-in applies at once as an unsaved edit (never writes the built-in)', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.toggleHidden('vix'))
    expect(result.current.hidden.has('vix')).toBe(true)
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.isEdited).toBe(true)
    // toggling back to exactly UCT Core is not an edit any more
    act(() => result.current.toggleHidden('vix'))
    expect(result.current.isEdited).toBe(false)
  })

  it('setHiddenSet replaces the entire hidden set on the active preset', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('Mix', ['a', 'b']))
    act(() => result.current.setHiddenSet(['c', 'd', 'e']))
    expect([...result.current.hidden].sort()).toEqual(['c', 'd', 'e'])
  })

  it('setHiddenSet on the built-in is an unsaved edit that Revert drops', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.setHiddenSet(['x']))
    expect(result.current.hidden.has('x')).toBe(true)
    expect(result.current.isEdited).toBe(true)
    act(() => result.current.revertDraft())
    expect(result.current.hidden.size).toBe(0)
    expect(result.current.isEdited).toBe(false)
  })

  it('switchPreset switches between Default and custom presets', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('A', ['k1']))
    act(() => result.current.savePreset('B', ['k2']))
    act(() => result.current.switchPreset('A'))
    expect(result.current.activePreset).toBe('A')
    expect(result.current.hidden.has('k1')).toBe(true)
    act(() => result.current.switchPreset(DEFAULT_PRESET))
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.hidden.size).toBe(0)
  })

  it('switchPreset to unknown name is a no-op', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('A', []))
    act(() => result.current.switchPreset('does-not-exist'))
    expect(result.current.activePreset).toBe('A')
  })

  it('renamePreset renames a custom preset and updates active if needed', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('Old', ['k1']))
    act(() => result.current.renamePreset('Old', 'New'))
    expect(result.current.activePreset).toBe('New')
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET, 'New'])
    expect(result.current.hidden.has('k1')).toBe(true)
  })

  it('renamePreset rejects the built-in id and label ("Default", "UCT Core") as a target name', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('A', []))
    act(() => result.current.renamePreset('A', DEFAULT_PRESET))
    act(() => result.current.renamePreset('A', 'uct core'))
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET, 'A'])
  })

  it('renamePreset rejects collisions with another existing preset', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('A', []))
    act(() => result.current.savePreset('B', []))
    act(() => result.current.renamePreset('A', 'B'))
    // 'A' should still exist; presetNames is canonical (Default first, then alphabetical)
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET, 'A', 'B'])
  })

  it('deletePreset removes a custom preset and resets active to Default', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('Doomed', ['x']))
    act(() => result.current.deletePreset('Doomed'))
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET])
  })

  it('deletePreset on inactive preset keeps current active', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('A', []))
    act(() => result.current.savePreset('B', []))
    act(() => result.current.switchPreset('A'))
    act(() => result.current.deletePreset('B'))
    expect(result.current.activePreset).toBe('A')
  })

  it('resetActive clears hidden set on active preset', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('A', ['x', 'y', 'z']))
    act(() => result.current.resetActive())
    expect(result.current.hidden.size).toBe(0)
  })

  it('resetActive is a no-op when Default is active', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.resetActive())
    expect(result.current.hidden.size).toBe(0)
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
  })

  it('persists state across fresh mount', async () => {
    const first = renderHook(() => useBreadthCustomize())
    act(() => first.result.current.savePreset('Persisted', ['a', 'b']))
    first.unmount()  // flush effect
    // The unmount cleanup writes to storage synchronously.
    const second = renderHook(() => useBreadthCustomize())
    expect(second.result.current.activePreset).toBe('Persisted')
    expect(second.result.current.presetNames).toEqual([DEFAULT_PRESET, 'Persisted'])
    expect(second.result.current.hidden.has('a')).toBe(true)
  })

  it('recovers from corrupt JSON in storage', () => {
    localStorage.setItem(STORAGE_KEY, '{ not valid json }')
    const { result } = renderHook(() => useBreadthCustomize())
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET])
  })

  it('drops a "Default" entry from stored presets (reserved name)', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activePreset: DEFAULT_PRESET,
        presets: { [DEFAULT_PRESET]: { hidden: ['x'] }, A: { hidden: ['y'] } },
      }),
    )
    const { result } = renderHook(() => useBreadthCustomize())
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET, 'A'])
    expect(result.current.hidden.size).toBe(0)  // Default is always empty
  })

  it('falls back to Default when activePreset references unknown preset', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ activePreset: 'gone', presets: {} }),
    )
    const { result } = renderHook(() => useBreadthCustomize())
    expect(result.current.activePreset).toBe(DEFAULT_PRESET)
  })

  it('drops non-string entries from stored hidden arrays', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activePreset: 'A',
        presets: { A: { hidden: ['ok', 42, null, 'also'] } },
      }),
    )
    const { result } = renderHook(() => useBreadthCustomize())
    expect([...result.current.hidden].sort()).toEqual(['also', 'ok'])
  })
})

describe('validatePresetName', () => {
  it('rejects empty / whitespace-only', () => {
    expect(validatePresetName('', [])).toBe('Name cannot be empty.')
    expect(validatePresetName('   ', [])).toBe('Name cannot be empty.')
  })

  it('rejects the built-in names', () => {
    expect(validatePresetName('Default', [])).toBe('"Default" is a built-in template.')
    expect(validatePresetName(' UCT Core ', [])).toBe('"UCT Core" is a built-in template.')
    expect(validatePresetName('uct core', [])).toMatch(/built-in/)
  })

  it('rejects collisions (any case)', () => {
    expect(validatePresetName('A', ['A', 'B'])).toBe('A template with that name already exists.')
    expect(validatePresetName('a', ['A'])).toBe('A template with that name already exists.')
  })

  it('rejects names longer than 40 chars', () => {
    expect(validatePresetName('x'.repeat(41), [])).toMatch(/40 characters or fewer/)
  })

  it('accepts valid names', () => {
    expect(validatePresetName('MA Only', [])).toBeNull()
    expect(validatePresetName('  MA Only  ', [])).toBeNull()  // trims
  })
})

// The Monitor's column-header menu (2026-11-17): Move left / right writes the
// active preset's `order`; Default stays immutable; order survives a reload.
describe('useBreadthCustomize column order', () => {
  it('has no order on a bare built-in; setOrder there is an unsaved edit', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    expect(result.current.order).toBeNull()
    act(() => result.current.setOrder(['vix', 'breadth_score']))
    expect(result.current.order).toEqual(['vix', 'breadth_score'])
    expect(result.current.isEdited).toBe(true)
    act(() => result.current.revertDraft())
    expect(result.current.order).toBeNull()
  })

  it('setOrder writes the active preset and keeps its hidden set', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('Mine', ['vix']))
    act(() => result.current.setOrder(['uct_exposure', 'breadth_score', 'uct_exposure']))
    expect(result.current.order).toEqual(['uct_exposure', 'breadth_score'])
    expect(result.current.hidden.has('vix')).toBe(true)
    // hiding afterwards keeps the order
    act(() => result.current.toggleHidden('breadth_score'))
    expect(result.current.order).toEqual(['uct_exposure', 'breadth_score'])
  })

  it('savePreset can carry an order (the Default save prompt), and it persists', () => {
    const first = renderHook(() => useBreadthCustomize())
    act(() => first.result.current.savePreset('Moved', [], ['uct_exposure', 'breadth_score']))
    first.unmount()
    const again = renderHook(() => useBreadthCustomize())
    expect(again.result.current.activePreset).toBe('Moved')
    expect(again.result.current.order).toEqual(['uct_exposure', 'breadth_score'])
  })

  it('resetActive clears the order with the hidden set', () => {
    const { result } = renderHook(() => useBreadthCustomize())
    act(() => result.current.savePreset('R', ['vix'], ['uct_exposure']))
    act(() => result.current.resetActive())
    expect(result.current.order).toBeNull()
    expect(result.current.hidden.size).toBe(0)
  })

  it('ignores a malformed stored order', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activePreset: 'X', presets: { X: { hidden: [], order: 'nope' } } }))
    const { result } = renderHook(() => useBreadthCustomize())
    expect(result.current.order).toBeNull()
  })
})

// The core Default (2026-11-19): Default is computed from the caller's defaults, never
// stored; members' presets are untouched; save-from-Default and reset keep working.
describe('useBreadthCustomize with a core Default', () => {
  const defaults = { hidden: ['vix', 'naaim'], order: ['uct_exposure', 'breadth_score', 'vix', 'naaim'] }

  it('Default shows the core set and its order, and nothing is written for it', () => {
    const { result } = renderHook(() => useBreadthCustomize({ defaults }))
    expect(result.current.isDefaultActive).toBe(true)
    expect([...result.current.hidden].sort()).toEqual(['naaim', 'vix'])
    expect(result.current.order).toEqual(defaults.order)
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"presets":{}}')
    expect(stored.presets[DEFAULT_PRESET]).toBeUndefined()
  })

  it('a member’s saved preset is untouched by the new Default', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activePreset: 'Mine', presets: { Mine: { hidden: ['breadth_score'] } } }))
    const { result } = renderHook(() => useBreadthCustomize({ defaults }))
    expect(result.current.activePreset).toBe('Mine')
    expect([...result.current.hidden]).toEqual(['breadth_score'])
    expect(result.current.order).toBeNull()
  })

  it('a member who was on Default gets the new core set (Default is never stored)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activePreset: DEFAULT_PRESET, presets: { Keep: { hidden: [] } } }))
    const { result } = renderHook(() => useBreadthCustomize({ defaults }))
    expect([...result.current.hidden].sort()).toEqual(['naaim', 'vix'])
    expect(result.current.presetNames).toEqual([DEFAULT_PRESET, 'Keep'])
  })

  it('Reset to defaults puts a custom preset back to the core set and order', () => {
    const { result } = renderHook(() => useBreadthCustomize({ defaults }))
    act(() => result.current.savePreset('Mine', [], ['vix']))
    act(() => result.current.resetActive())
    expect([...result.current.hidden].sort()).toEqual(['naaim', 'vix'])
    expect(result.current.order).toEqual(defaults.order)
  })
})

// ⭐ The Columns menu (owner 2026-11-19): UCT Core (stored id `Default`) is never written;
// edits to it are an unsaved draft with Revert / Save as new; the member's own templates
// autosave; old stored presets migrate without loss.
describe('useBreadthCustomize templates', () => {
  const defaults = { hidden: ['vix', 'naaim'], order: ['uct_exposure', 'breadth_score', 'vix', 'naaim'] }
  const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY))

  it('labels the built-in "UCT Core" while its stored id stays "Default"', () => {
    const { result } = renderHook(() => useBreadthCustomize({ defaults }))
    expect(BUILTIN_LABEL).toBe('UCT Core')
    expect(result.current.activePreset).toBe('Default')
    expect(result.current.activeLabel).toBe('UCT Core')
    expect(templateLabel('Mine')).toBe('Mine')
  })

  it('an edit to UCT Core shows at once, is marked edited, survives a reload, and Revert drops it', () => {
    const first = renderHook(() => useBreadthCustomize({ defaults }))
    act(() => first.result.current.toggleHidden('vix'))  // vix on
    expect(first.result.current.hidden.has('vix')).toBe(false)
    expect(first.result.current.isEdited).toBe(true)
    expect(first.result.current.differsFromDefault).toBe(true)
    first.unmount()
    expect(stored().presets.Default).toBeUndefined()      // the built-in is never written
    expect(stored().draft.hidden).toEqual(['naaim'])
    const again = renderHook(() => useBreadthCustomize({ defaults }))
    expect(again.result.current.isEdited).toBe(true)
    expect(again.result.current.hidden.has('vix')).toBe(false)
    act(() => again.result.current.revertDraft())
    expect(again.result.current.isEdited).toBe(false)
    expect([...again.result.current.hidden].sort()).toEqual(['naaim', 'vix'])
    again.unmount()
    expect(stored().draft).toBeUndefined()
  })

  it('Save as new from an edited UCT Core keeps its columns and order, becomes active, clears the edit', () => {
    const { result } = renderHook(() => useBreadthCustomize({ defaults }))
    act(() => result.current.toggleHidden('vix'))
    act(() => result.current.setOrder(['breadth_score', 'uct_exposure', 'vix', 'naaim']))
    act(() => result.current.savePreset('Swing'))
    expect(result.current.activePreset).toBe('Swing')
    expect(result.current.isEdited).toBe(false)
    expect([...result.current.hidden]).toEqual(['naaim'])
    expect(result.current.order).toEqual(['breadth_score', 'uct_exposure', 'vix', 'naaim'])
    act(() => result.current.switchPreset('Default'))
    expect(result.current.isEdited).toBe(false)
    expect([...result.current.hidden].sort()).toEqual(['naaim', 'vix'])
  })

  it('the member’s own template autosaves every change (no draft, no edited mark)', () => {
    const first = renderHook(() => useBreadthCustomize({ defaults }))
    act(() => first.result.current.savePreset('Mine'))
    act(() => first.result.current.toggleHidden('breadth_score'))
    act(() => first.result.current.setOrder(['vix', 'uct_exposure']))
    expect(first.result.current.isEdited).toBe(false)
    first.unmount()
    expect(stored().presets.Mine.hidden.sort()).toEqual(['breadth_score', 'naaim', 'vix'])
    expect(stored().presets.Mine.order).toEqual(['vix', 'uct_exposure'])
    expect(stored().draft).toBeUndefined()
  })

  it('rename keeps the columns; duplicate copies them as "<name> copy" and makes it active', () => {
    const { result } = renderHook(() => useBreadthCustomize({ defaults }))
    act(() => result.current.savePreset('A', ['x'], ['y']))
    act(() => result.current.renamePreset('A', 'B'))
    expect(result.current.presetNames).toEqual(['Default', 'B'])
    expect([...result.current.hidden]).toEqual(['x'])
    let copy
    act(() => { copy = result.current.duplicatePreset('B') })
    expect(copy).toBe('B copy')
    expect(result.current.activePreset).toBe('B copy')
    expect(result.current.presets['B copy']).toEqual({ hidden: ['x'], order: ['y'] })
    act(() => { copy = result.current.duplicatePreset('B') })
    expect(copy).toBe('B copy 2')
    // the copy is independent
    act(() => result.current.toggleHidden('x'))
    expect(result.current.presets.B.hidden).toEqual(['x'])
  })

  it('deleting the active template goes back to UCT Core; the built-in cannot be deleted or renamed', () => {
    const { result } = renderHook(() => useBreadthCustomize({ defaults }))
    act(() => result.current.savePreset('Gone'))
    act(() => result.current.deletePreset('Default'))
    act(() => result.current.renamePreset('Default', 'X'))
    expect(result.current.presetNames).toEqual(['Default', 'Gone'])
    act(() => result.current.deletePreset('Gone'))
    expect(result.current.activePreset).toBe('Default')
    expect(result.current.presetNames).toEqual(['Default'])
  })

  it('Reset to UCT Core: reverts an edited built-in; puts an own template back to the core set', () => {
    const { result } = renderHook(() => useBreadthCustomize({ defaults }))
    expect(result.current.differsFromDefault).toBe(false)
    act(() => result.current.toggleHidden('naaim'))
    act(() => result.current.resetActive())
    expect(result.current.isEdited).toBe(false)
    act(() => result.current.savePreset('Mine', ['breadth_score'], null))
    expect(result.current.differsFromDefault).toBe(true)
    act(() => result.current.resetActive())
    expect(result.current.differsFromDefault).toBe(false)
    expect(result.current.activePreset).toBe('Mine')
  })

  it('migrates old stored presets without loss (order-less, ordered, a "UCT Core"-named one, junk)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      activePreset: 'UCT Core',
      presets: {
        Default: { hidden: ['dropped'] },
        Old: { hidden: ['vix', 7] },
        Ordered: { hidden: [], order: ['vix', 'breadth_score'] },
        'UCT Core': { hidden: ['naaim'] },
        Broken: { nope: true },
      },
      draft: { hidden: 'bad' },
    }))
    const { result, unmount } = renderHook(() => useBreadthCustomize({ defaults }))
    expect(result.current.presetNames).toEqual(['Default', 'Old', 'Ordered', 'UCT Core (mine)'])
    expect(result.current.activePreset).toBe('UCT Core (mine)')
    expect([...result.current.hidden]).toEqual(['naaim'])
    expect(result.current.presets.Old).toEqual({ hidden: ['vix'] })
    expect(result.current.presets.Ordered).toEqual({ hidden: [], order: ['vix', 'breadth_score'] })
    expect(result.current.isEdited).toBe(false)
    unmount()
    const s = stored()
    expect(Object.keys(s.presets).sort()).toEqual(['Old', 'Ordered', 'UCT Core (mine)'])
    expect(s.draft).toBeUndefined()
    expect(migrateStored({ activePreset: 'Default', presets: {} })).toEqual({ activePreset: 'Default', presets: {}, draft: null })
  })
})
