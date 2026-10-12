import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
let STYLES_ON = true
vi.mock('../../../lib/journalStylesFlag', async (orig) => ({ ...(await orig()), journalStylesEnabled: () => STYLES_ON }))
import PriceStampsBlock from './PriceStampsBlock'

afterEach(() => { STYLES_ON = true })

describe('PriceStampsBlock', () => {
  it('a named switch; turning it on is one setParams', () => {
    const setParams = vi.fn(() => true)
    render(<PriceStampsBlock params={{ on: 'no' }} setParams={setParams} editable />)
    const sw = screen.getByRole('switch', { name: 'Stamp prices as I write' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(sw.textContent).toBe('Price stamps: off')
    fireEvent.click(sw)
    expect(setParams).toHaveBeenCalledTimes(1)
    expect(setParams).toHaveBeenCalledWith({ on: 'yes' })
  })
  it('on: the switch says so, and turning it off is one setParams', () => {
    const setParams = vi.fn(() => true)
    render(<PriceStampsBlock params={{ on: 'yes' }} setParams={setParams} editable />)
    const sw = screen.getByRole('switch', { name: 'Stamp prices as I write' })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(sw.textContent).toBe('Price stamps: on')
    fireEvent.click(sw)
    expect(setParams).toHaveBeenCalledWith({ on: 'no' })
  })
  it('says how it works', () => {
    render(<PriceStampsBlock params={{ on: 'yes' }} setParams={vi.fn()} editable />)
    expect(screen.getByText(/Write \$NVDA and press Enter/)).toBeTruthy()
  })
  it('a read-only note: the switch shows its state and cannot be changed', () => {
    const setParams = vi.fn()
    render(<PriceStampsBlock params={{ on: 'yes' }} setParams={setParams} editable={false} />)
    const sw = screen.getByRole('switch', { name: 'Stamp prices as I write' })
    expect(sw.disabled).toBe(true)
    fireEvent.click(sw)
    expect(setParams).not.toHaveBeenCalled()
  })
  it('the switch off: says what it needs, and the toggle is disabled (S24)', () => {
    STYLES_ON = false
    render(<PriceStampsBlock params={{ on: 'yes' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('This block needs Journal styles, which is not on for you.')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Stamp prices as I write' }).disabled).toBe(true)
    expect(screen.queryByText(/Write \$NVDA and press Enter/)).toBeNull()
  })
})
