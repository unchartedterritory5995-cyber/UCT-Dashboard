/**
 * StudyMark rails: the product mark falls back to the exported still whenever the live renderer cannot run
 * (no WebGL, as in jsdom; or prefers-reduced-motion), the still is decorative, and the still asset the code
 * points at actually exists in public/ (a path typed in one file and a file in another is the drift this pins).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import StudyMark from './StudyMark'
import { canRender3D, STILL_SRC } from './studyMarkSupport'

const here = path.dirname(fileURLToPath(import.meta.url))
const stillOnDisk = path.resolve(here, '../../../public', STILL_SRC.replace(/^\//, ''))

let getContext
beforeEach(() => {
  getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('StudyMark', () => {
  it('renders the decorative still when the browser has no WebGL (jsdom)', () => {
    const { container } = render(<StudyMark size={64} />)
    const img = container.querySelector('img[data-study-mark="still"]')
    expect(img).not.toBeNull()
    expect(img.getAttribute('src')).toBe(STILL_SRC)
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('aria-hidden')).toBe('true')
    expect(img.getAttribute('width')).toBe('64')
    expect(container.querySelector('canvas')).toBeNull()
  })

  it('canRender3D is true with WebGL and no motion preference, false under prefers-reduced-motion', () => {
    getContext.mockImplementation(() => ({}))
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
    expect(canRender3D()).toBe(true)
    mm.mockImplementation((q) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
    expect(canRender3D()).toBe(false)
  })

  it('the still the code points at exists in public/ (the fallback is a real file, not a 404)', () => {
    expect(fs.existsSync(stillOnDisk)).toBe(true)
    expect(fs.statSync(stillOnDisk).size).toBeGreaterThan(1000)
  })
})
