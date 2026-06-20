import { describe, it, expect } from 'vitest'
import { LEARNING_PATHS } from './learningPaths'

describe('LEARNING_PATHS', () => {
  it('every path is well-formed', () => {
    const ids = new Set()
    for (const p of LEARNING_PATHS) {
      expect(p.id).toBeTruthy()
      expect(p.name).toBeTruthy()
      expect(p.steps.length).toBeGreaterThanOrEqual(2)
      for (const s of p.steps) expect(s).toMatch(/^[A-Za-z0-9_-]{11}$/)
      expect(ids.has(p.id)).toBe(false) // unique path ids
      ids.add(p.id)
    }
  })
})
