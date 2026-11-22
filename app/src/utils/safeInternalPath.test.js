import { describe, it, expect } from 'vitest'
import { safeInternalPath } from './safeInternalPath'

const O = 'https://app.example.com'

describe('safeInternalPath', () => {
  it('accepts a relative path, keeping search and hash', () => {
    expect(safeInternalPath('/research/AAPL', O)).toBe('/research/AAPL')
    expect(safeInternalPath('/research/AAPL?tab=x#top', O)).toBe('/research/AAPL?tab=x#top')
  })
  it('accepts an absolute same-origin URL and returns only the path', () => {
    expect(safeInternalPath('https://app.example.com/flow?a=1#b', O)).toBe('/flow?a=1#b')
  })
  it('rejects protocol-relative, backslash, javascript: and other origins', () => {
    expect(safeInternalPath('//evil.example/x', O)).toBeNull()
    expect(safeInternalPath('/\\evil.example', O)).toBeNull()
    expect(safeInternalPath('/.//evil.com', O)).toBeNull()
    expect(safeInternalPath('/a/..//evil.com', O)).toBeNull()
    expect(safeInternalPath('/	/evil.com', O)).toBeNull()
    expect(safeInternalPath('javascript:alert(1)', O)).toBeNull()
    expect(safeInternalPath('https://evil.example/research/AAPL', O)).toBeNull()
    expect(safeInternalPath('http://app.example.com/x', O)).toBeNull()
  })
  it('rejects empty and non-string input', () => {
    expect(safeInternalPath('', O)).toBeNull()
    expect(safeInternalPath(null, O)).toBeNull()
    expect(safeInternalPath(undefined, O)).toBeNull()
    expect(safeInternalPath(42, O)).toBeNull()
  })
})
