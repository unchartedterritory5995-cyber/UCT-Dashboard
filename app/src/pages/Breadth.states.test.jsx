// BRD: a failed or paid-gated read never shows the developer command "Run python
// scripts/breadth_collector.py", never the raw error text, never a false "Retrying in 5m".
import { describe, expect, it } from 'vitest'
import { breadthErrorText } from './Breadth'

describe('breadth failure copy', () => {
  it('a 402 names the plan, anything else is a read gap', () => {
    expect(breadthErrorText({ status: 402 })).toBe('Breadth data requires a paid plan.')
    const t = breadthErrorText(new Error('Unexpected token < in JSON'))
    expect(t).toMatch(/could not be read right now/)
    expect(t).not.toMatch(/Unexpected token|Retrying in 5m/)
  })
})
