import { describe, it, expect } from 'vitest'
import linkifyTimestamps from './linkifyTimestamps'

const para = (children) => ({ type: 'paragraph', content: children })
const txt = (text, bold) => ({ type: 'text', ...(bold ? { marks: [{ type: 'bold' }] } : {}), text })

describe('linkifyTimestamps', () => {
  it('converts a legacy bold [M:SS] prefix into a videoTimestamp node', () => {
    const doc = { type: 'doc', content: [para([txt('[1:15] ', true), txt('Breakout retest')])] }
    const out = linkifyTimestamps(doc)
    const p = out.content[0]
    expect(p.content[0]).toEqual({ type: 'videoTimestamp', attrs: { seconds: 75 } })
    expect(p.content[p.content.length - 1].text).toBe('Breakout retest')
  })

  it('handles H:MM:SS', () => {
    const doc = { type: 'doc', content: [para([txt('[1:02:03] ', true), txt('Late note')])] }
    expect(linkifyTimestamps(doc).content[0].content[0]).toEqual({
      type: 'videoTimestamp', attrs: { seconds: 3723 },
    })
  })

  it('handles prefix + text in one node', () => {
    const doc = { type: 'doc', content: [para([txt('[0:30] inline text', true)])] }
    const p = linkifyTimestamps(doc).content[0]
    expect(p.content[0]).toEqual({ type: 'videoTimestamp', attrs: { seconds: 30 } })
    expect(p.content[1].text).toBe('inline text')
  })

  it('leaves non-matching paragraphs untouched', () => {
    const doc = { type: 'doc', content: [para([txt('Just a plain note')])] }
    expect(linkifyTimestamps(doc)).toEqual(doc)
  })

  it('leaves already-converted docs untouched', () => {
    const doc = {
      type: 'doc',
      content: [para([{ type: 'videoTimestamp', attrs: { seconds: 10 } }, txt(' x')])],
    }
    expect(linkifyTimestamps(doc)).toEqual(doc)
  })

  it('returns input unchanged when not a doc', () => {
    expect(linkifyTimestamps(null)).toBe(null)
    expect(linkifyTimestamps({})).toEqual({})
  })
})
