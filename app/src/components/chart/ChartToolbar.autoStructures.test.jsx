// The Patterns / Auto Structures toggle: ADMIN-ONLY while AUTO_STRUCTURES_ENABLED is on (the
// server carries `auto_structures_enabled` on the auth payload only for an admin while on);
// hidden for members and for everyone while the flag is off. Asserted by what RENDERS.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChartToolbar from './ChartToolbar'
import { AuthContext } from '../../context/AuthContext'
import { autoStructuresAllowed } from './autoStructuresGate'

function mount(auth, extra = {}) {
  return render(
    <AuthContext.Provider value={{ isPaid: true, loading: false, ...auth }}>
      <ChartToolbar
        activeTool="cursor"
        setActiveTool={() => {}}
        showPatterns={false}
        onTogglePatterns={vi.fn()}
        showLevels={false}
        onToggleLevels={vi.fn()}
        {...extra}
      />
    </AuthContext.Provider>,
  )
}

const ADMIN = { user: { role: 'admin' } }
const MEMBER = { user: { role: 'member' } }

describe('ChartToolbar — Auto Structures toggle gate', () => {
  it('admin + flag ON: the Patterns and Levels toggles render', () => {
    mount({ ...ADMIN, autoStructuresEnabled: true })
    expect(screen.getByLabelText('Toggle chart patterns overlay')).toBeTruthy()
    expect(screen.getByText('Patterns')).toBeTruthy()
    expect(screen.getByLabelText('Toggle key levels layer')).toBeTruthy()
  })

  it('admin + flag OFF: hidden', () => {
    mount({ ...ADMIN, autoStructuresEnabled: false })
    expect(screen.queryByLabelText('Toggle chart patterns overlay')).toBeNull()
    expect(screen.queryByLabelText('Toggle key levels layer')).toBeNull()
  })

  it('member, even if a payload claimed the flag: hidden (members unchanged until a later flip)', () => {
    mount({ ...MEMBER, autoStructuresEnabled: true })
    expect(screen.queryByLabelText('Toggle chart patterns overlay')).toBeNull()
  })

  it('no AuthProvider at all (bot renderers): hidden, and the toolbar still renders', () => {
    render(<ChartToolbar activeTool="cursor" setActiveTool={() => {}} onTogglePatterns={vi.fn()} />)
    expect(screen.queryByLabelText('Toggle chart patterns overlay')).toBeNull()
  })

  it('hidePatterns wins even for an enabled admin', () => {
    mount({ ...ADMIN, autoStructuresEnabled: true }, { hidePatterns: true })
    expect(screen.queryByLabelText('Toggle chart patterns overlay')).toBeNull()
  })

  it('autoStructuresAllowed: admin AND an explicit true, nothing else', () => {
    expect(autoStructuresAllowed({ ...ADMIN, autoStructuresEnabled: true })).toBe(true)
    expect(autoStructuresAllowed({ ...ADMIN, autoStructuresEnabled: 'true' })).toBe(false)
    expect(autoStructuresAllowed({ ...MEMBER, autoStructuresEnabled: true })).toBe(false)
    expect(autoStructuresAllowed(null)).toBe(false)
  })
})
