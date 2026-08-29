import { describe, it, expect } from 'vitest'
import { VIEWS_DAY_CHOICES, OTHER_DAY_CHOICES } from '../Breadth'

describe('breadth window choices', () => {
  it('offers deeper windows on the Views tab than the monitor', () => {
    expect(VIEWS_DAY_CHOICES).toEqual([90, 180, 365])
    expect(OTHER_DAY_CHOICES).toEqual([30, 60, 90])
  })
  it('starts the Views tab at the shallowest of its own choices', () => {
    expect(Math.min(...VIEWS_DAY_CHOICES)).toBe(90)
  })
})
