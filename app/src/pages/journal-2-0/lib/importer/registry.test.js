import { describe, it, expect } from 'vitest'
import { detectAdapter } from './registry'

const vf = (path, text = '') => ({ path, size: text.length, lastModified: null,
                                    bytes: async () => new TextEncoder().encode(text) })

describe('detectAdapter', () => {
  it('routes an Obsidian vault (has .obsidian/) to obsidian', async () => {
    expect((await detectAdapter([vf('.obsidian/app.json'), vf('note.md')])).adapter.id).toBe('obsidian')
  })
  it('routes hex-suffixed files to notion', async () => {
    expect((await detectAdapter([vf('Page abc123def456789012345678abcdef01.md')])).adapter.id).toBe('notion')
  })
  it('routes .enex to evernote', async () => {
    expect((await detectAdapter([vf('My Notebook.enex')])).adapter.id).toBe('evernote')
  })
  it('falls back to generic for loose markdown', async () => {
    expect((await detectAdapter([vf('a.md'), vf('b/c.txt')])).adapter.id).toBe('file')
  })
  it('defaults to generic (not evernote) when nothing scores above zero', async () => {
    expect((await detectAdapter([])).adapter.id).toBe('file')
  })

  // Task 9 review carry-forward: the 0.6 content-detection heuristic. No
  // `.obsidian/` marker present, so the only signal is `[[wiki-link]]`
  // syntax sampled from the dropped `.md` files' actual content.
  it('routes a vault without .obsidian/ but with wiki-link content to obsidian at 0.6', async () => {
    const result = await detectAdapter([vf('note.md', 'see [[Other Note]] for more')])
    expect(result.adapter.id).toBe('obsidian')
    expect(result.confidence).toBe(0.6)
  })
  it('falls back to generic for plain markdown with no wiki-link content', async () => {
    const result = await detectAdapter([vf('note.md', 'just plain text, no links here')])
    expect(result.adapter.id).toBe('file')
  })
})
