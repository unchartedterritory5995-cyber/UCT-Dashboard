// The Patterns / Auto Structures toggle: ADMIN-ONLY while AUTO_STRUCTURES_ENABLED is on (the
// server carries `auto_structures_enabled` on the auth payload only for an admin while on);
// hidden for members and for everyone while the flag is off. Asserted by what RENDERS.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChartToolbar from './ChartToolbar'
import { AuthContext } from '../../context/AuthContext'
import { autoStructuresAllowed, autoStructuresScope } from './autoStructuresGate'

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

// AUTO_STRUCTURES_MEMBERS_ENABLED: the server carries `auto_structures_members_enabled` only for a
// PAID non-admin while both flags are on. Members get the Patterns toggle (trusted tier only);
// the Levels layer stays admin-only.
describe('ChartToolbar — Auto Structures member flip', () => {
  const PATTERNS = 'Toggle chart patterns overlay'
  const LEVELS = 'Toggle key levels layer'

  it('paid member + member flag ON: the Patterns toggle renders, Levels does not', () => {
    mount({ ...MEMBER, isPaid: true, autoStructuresMembersEnabled: true })
    expect(screen.getByLabelText(PATTERNS)).toBeTruthy()
    expect(screen.queryByLabelText(LEVELS)).toBeNull()
  })

  it('paid member + member flag OFF: nothing new', () => {
    mount({ ...MEMBER, isPaid: true, autoStructuresMembersEnabled: false })
    expect(screen.queryByLabelText(PATTERNS)).toBeNull()
    expect(screen.queryByLabelText(LEVELS)).toBeNull()
  })

  it('free member, even if a payload claimed the member flag: hidden', () => {
    mount({ ...MEMBER, isPaid: false, autoStructuresMembersEnabled: true })
    expect(screen.queryByLabelText(PATTERNS)).toBeNull()
  })

  it('signed out, even if a payload claimed the member flag: hidden', () => {
    mount({ user: null, isPaid: false, autoStructuresMembersEnabled: true })
    expect(screen.queryByLabelText(PATTERNS)).toBeNull()
  })

  it('admin is unchanged by the member flag', () => {
    const a = mount({ ...ADMIN, autoStructuresEnabled: true, autoStructuresMembersEnabled: true })
    expect(screen.getByLabelText(PATTERNS)).toBeTruthy()
    expect(screen.getByLabelText(LEVELS)).toBeTruthy()
    a.unmount()
    mount({ ...ADMIN, autoStructuresEnabled: false, autoStructuresMembersEnabled: true })
    expect(screen.queryByLabelText(PATTERNS)).toBeNull()
  })

  it('autoStructuresScope: all / trusted / null', () => {
    expect(autoStructuresScope({ ...ADMIN, autoStructuresEnabled: true })).toBe('all')
    expect(autoStructuresScope({ ...ADMIN, autoStructuresMembersEnabled: true })).toBe(null)
    expect(autoStructuresScope({ ...MEMBER, isPaid: true, autoStructuresMembersEnabled: true })).toBe('trusted')
    expect(autoStructuresScope({ ...MEMBER, isPaid: true, autoStructuresMembersEnabled: 'true' })).toBe(null)
    expect(autoStructuresScope({ ...MEMBER, isPaid: true, autoStructuresEnabled: true })).toBe(null)
    expect(autoStructuresScope({ ...MEMBER, isPaid: false, autoStructuresMembersEnabled: true })).toBe(null)
    expect(autoStructuresScope(null)).toBe(null)
    expect(autoStructuresAllowed({ ...MEMBER, isPaid: true, autoStructuresMembersEnabled: true })).toBe(false)
  })
})
