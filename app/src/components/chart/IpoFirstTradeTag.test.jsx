// N2: the IPO "First trade" tag closes on Escape and is not modal, so it marks itself as an Escape
// layer for lib/topLayer.js. Rendered here exactly as StockChart renders it.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { isTopmostLayer } from '../../lib/topLayer'
import IpoFirstTradeTag from './IpoFirstTradeTag'

describe('IpoFirstTradeTag', () => {
  it('reads the first-trade day and carries data-escape-layer', () => {
    render(<IpoFirstTradeTag date="2021-03-10" x={10} y={20} />)
    const tag = screen.getByTestId('ipo-first-trade-tag')
    expect(tag).toHaveTextContent('IPOFirst trade · Mar 10, 2021')
    expect(tag).toHaveAttribute('data-escape-layer')
  })

  it('counts as a layer above a lightbox opened before it', () => {
    render(<><div role="dialog" aria-modal="true" data-testid="below" /><IpoFirstTradeTag date="2021-03-10" x={0} y={0} /></>)
    expect(isTopmostLayer(screen.getByTestId('below'))).toBe(false)
  })
})
