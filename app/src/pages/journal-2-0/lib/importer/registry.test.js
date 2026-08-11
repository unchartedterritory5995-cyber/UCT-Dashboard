import { describe, it, expect } from 'vitest'
import { detectAdapter } from './registry'

const vf = (path) => ({ path, size: 1, lastModified: null, bytes: async () => new Uint8Array() })

describe('detectAdapter', () => {
  it('routes an Obsidian vault (has .obsidian/) to obsidian', () => {
    expect(detectAdapter([vf('.obsidian/app.json'), vf('note.md')]).adapter.id).toBe('obsidian')
  })
  it('routes hex-suffixed files to notion', () => {
    expect(detectAdapter([vf('Page abc123def456789012345678abcdef01.md')]).adapter.id).toBe('notion')
  })
  it('routes .enex to evernote', () => {
    expect(detectAdapter([vf('My Notebook.enex')]).adapter.id).toBe('evernote')
  })
  it('falls back to generic for loose markdown', () => {
    expect(detectAdapter([vf('a.md'), vf('b/c.txt')]).adapter.id).toBe('file')
  })
})
