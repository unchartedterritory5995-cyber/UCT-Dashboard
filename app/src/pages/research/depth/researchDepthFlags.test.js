// The client's Depth keys are the server's: read the Python tuples, never restate them.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  RESEARCH_DEPTH_KEYS, readResearchDepth, anyResearchDepth,
} from './researchDepthFlags'

const AUTH = path.resolve(__dirname, '../../../../../api/routers/auth.py')

function tupleKeys(src, name) {
  const m = src.match(new RegExp(`^${name} = \\(([\\s\\S]*?)^\\)`, 'm'))
  if (!m) return null
  return [...m[1].matchAll(/^\s*\("([a-z_]+)",/gm)].map((x) => x[1])
}

describe('Research > Depth flag keys mirror auth.py', () => {
  const src = fs.readFileSync(AUTH, 'utf8')

  it('RESEARCH_DEPTH_KEYS is exactly _RESEARCH_DEPTH_SURFACES, in order', () => {
    const py = tupleKeys(src, '_RESEARCH_DEPTH_SURFACES')
    expect(py?.length).toBeGreaterThan(9)   // non-vacuity: the parser found the tuple
    expect(RESEARCH_DEPTH_KEYS).toEqual(py)
  })

  it('the interim awaiting-code tuple is gone, and the payload loop reads the one tuple', () => {
    expect(tupleKeys(src, '_RESEARCH_DEPTH_AWAITING_CODE_SURFACES')).toBeNull()
    expect(src).toMatch(/for key, mod in _RESEARCH_DEPTH_SURFACES:/)
  })

  it('a folded-in panel opens the Depth tab, and only literal true counts', () => {
    expect(anyResearchDepth(readResearchDepth({ call_replay_enabled: true }))).toBe(true)
    expect(readResearchDepth({ news_read_state_enabled: true }).news_read_state_enabled).toBe(true)
    expect(anyResearchDepth(readResearchDepth({ call_replay_enabled: 'true' }))).toBe(false)
    expect(anyResearchDepth(readResearchDepth({}))).toBe(false)
  })
})
