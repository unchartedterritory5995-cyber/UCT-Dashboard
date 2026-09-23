import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const create = vi.fn(async () => ({ id: 1 }))
vi.mock('../hooks/useSavedScreens', () => ({
  default: () => ({ create, saved: [], starters: [], update: vi.fn(), remove: vi.fn() }),
}))

import SaveScanButton from './SaveScanButton'

beforeEach(() => create.mockClear())

describe('SaveScanButton', () => {
  it('renders nothing until there is a selection to save', () => {
    const { container } = render(<SaveScanButton spec={{ filters: [] }} hasFilters={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('saves the CURRENT spec under a typed name, via the shared create door', async () => {
    const spec = { filters: [{ key: 'price', op: 'gte', min: 5 }], view: 'overview' }
    render(<SaveScanButton spec={spec} hasFilters />)
    fireEvent.click(screen.getByRole('button', { name: /Save as scan/ }))
    fireEvent.change(screen.getByPlaceholderText('Name this scan…'), { target: { value: 'RS + price' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith('RS + price', spec))
  })

  it('a blank name saves nothing', () => {
    render(<SaveScanButton spec={{ filters: [] }} hasFilters />)
    fireEvent.click(screen.getByRole('button', { name: /Save as scan/ }))
    // Save is disabled on an empty name
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(create).not.toHaveBeenCalled()
  })
})
