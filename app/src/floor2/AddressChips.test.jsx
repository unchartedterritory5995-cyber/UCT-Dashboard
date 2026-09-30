// TERM-056 — addresses in a Floor post: shared objects link, private ones never show a name.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AddressChips from './AddressChips'

afterEach(cleanup)

const renderChips = (links) => render(<MemoryRouter><AddressChips links={links} /></MemoryRouter>)

describe('AddressChips', () => {
  it('a shared object is a link to the door every reader can use', () => {
    renderChips([{ address: 'L:12', kind: 'layout', kind_label: 'Chart layout', shared: true,
                   name: 'Swing Board', to: '/charts?openShared=tok123' }])
    const a = screen.getByRole('link', { name: 'Chart layout: Swing Board' })
    expect(a.getAttribute('href')).toBe('/charts?openShared=tok123')
  })

  it('a private object is the address marked private, not a link and not named', () => {
    renderChips([{ address: 'L:7', kind: 'layout', kind_label: 'Chart layout', shared: false }])
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByTestId('address-chips').textContent).toBe('L:7 · private')
  })

  it('renders nothing when a post names no address', () => {
    renderChips([])
    expect(screen.queryByTestId('address-chips')).toBeNull()
  })
})
