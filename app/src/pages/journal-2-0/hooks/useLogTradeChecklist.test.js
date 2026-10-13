// Log Trade's checklist, the dialog's half: N-4 wiring (Notebook P2b Task 8, ruling R-PF-B9). The body
// shows a carried rule tick only on a list the member has answered, so the hook must say which lists
// those are. The saving half is railed through both dialogs (AddTradeModal / AddPositionModal tests).
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: { journal_log_trade_checklist: 'on' } }) }))
vi.mock('../lib/journalStylesFlag', () => ({ journalStylesEnabled: () => true }))
vi.mock('../lib/blocks/logTradeChecklist', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, checklistMode: () => ({ show: true, requireAll: 'no' }) }
})
import useLogTradeChecklist from './useLogTradeChecklist'

describe('useLogTradeChecklist: N-4', () => {
  it('slotProps.touched is false until the member answers the list on screen, and per setup', () => {
    const { result, rerender } = renderHook(({ setup }) => useLogTradeChecklist({ preEntryChecklist: true, kind: 'trade', setup }),
      { initialProps: { setup: 'VCP' } })
    expect(result.current.on).toBe(true)
    expect(result.current.slotProps.touched).toBe(false)
    act(() => result.current.slotProps.onChange(['rule:x1']))
    expect(result.current.slotProps.touched).toBe(true)
    rerender({ setup: 'Flag' })
    expect(result.current.slotProps.touched).toBe(false)          // another list, not yet answered
    expect(result.current.slotProps.checked).toEqual(['rule:x1']) // and the tick is kept, never erased
    rerender({ setup: 'VCP' })
    expect(result.current.slotProps.touched).toBe(true)
  })
})
