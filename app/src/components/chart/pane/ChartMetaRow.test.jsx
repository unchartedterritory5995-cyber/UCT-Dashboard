// The info row (owner 11-17): clickable stats + per-stat looks; with neither, the exact old markup.
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import ChartMetaRow from './ChartMetaRow'

const styles = new Proxy({}, { get: (_, k) => String(k) })
const items = [
  { key: 'mcap', label: 'Market Cap', value: '1.00B', color: '#ededed' },
  { key: 'earn', label: 'Next Earnings', value: '1/1/2030', style: { labelColor: '#ff0000', box: true, size: 'l' } },
]

describe('ChartMetaRow', () => {
  it('without a click handler: no control semantics, no look on an unstyled stat', () => {
    const { container } = render(<ChartMetaRow items={[items[0]]} styles={styles} />)
    const item = container.querySelector('.chartMetaItem')
    expect(item.getAttribute('role')).toBeNull()
    expect(item.getAttribute('style')).toBeNull()
    expect(item.getAttribute('tabindex')).toBeNull()
  })
  it('paints the look: label color, shaded box, size', () => {
    const { container } = render(<ChartMetaRow items={items} styles={styles} />)
    const earn = container.querySelectorAll('.chartMetaItem')[1]
    expect(earn.style.zoom).toBe('1.15')
    expect(earn.style.background).toBeTruthy()
    expect(earn.querySelector('.chartMetaLabel').style.color).toBe('rgb(255, 0, 0)')
  })
  it('with a click handler each stat is a control: click, Enter and Space open it', () => {
    const onItemClick = vi.fn()
    const { container } = render(<ChartMetaRow items={items} styles={styles} onItemClick={onItemClick} openKey="earn" />)
    const [mcap, earn] = container.querySelectorAll('[data-stat-item]')
    expect(mcap.getAttribute('role')).toBe('button')
    expect(earn.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(mcap)
    fireEvent.keyDown(earn, { key: 'Enter' })
    fireEvent.keyDown(earn, { key: ' ' })
    expect(onItemClick.mock.calls.map((c) => c[0])).toEqual(['mcap', 'earn', 'earn'])
  })
})

describe('ChartMetaRow thickness (owner 11-17)', () => {
  it('a stored weight paints label and value; none leaves no inline weight', () => {
    const { container } = render(<ChartMetaRow styles={styles} items={[
      { key: 'mcap', label: 'Market Cap', value: '1.00B', style: { weight: 'heavy' } },
      { key: 'earn', label: 'Next Earnings', value: '1/1/2030' },
    ]} />)
    const [heavyLabel, heavyVal, plainLabel, plainVal] = container.querySelectorAll('span > span')
    expect(heavyLabel.style.fontWeight).toBe('700')
    expect(heavyVal.style.fontWeight).toBe('700')
    expect(plainLabel.getAttribute('style')).toBeNull()
    expect(plainVal.getAttribute('style')).toBeNull()
  })
})
