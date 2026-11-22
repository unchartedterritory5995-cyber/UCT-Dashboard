// Removing the line a run-over-a-list reads moves the scan to another line. It used to do that in
// silence (Indicators backlog 7): the next run answered a different question and nothing on screen
// had said it would. The engine now discloses it, and both places that render engine disclosures
// (the dock and the builder's Ask tab) say it in a member's words.

import { describe, it, expect } from 'vitest'
import { parseFormula } from '../../engine/ast/parse'
import { newAuthoringState, applyTurn } from './index'
import { replyLines } from './authoringSession'
import CONVERSE_BOX_SRC from '../ConverseBox.jsx?raw'

const C = 'uct.authoring.patch/1'
const GATE = { symbol: 'NVDA', tf: 'D' }
const P = (text) => parseFormula(text).ast
const env = (rev, ops) => ({ contract: C, baseRevision: rev, disposition: 'change', ops })
function turn(state, ops) {
  const out = applyTurn(state, env(state.revision, ops), { gateCtx: GATE, memberWords: 'x' })
  expect(out.result.status, JSON.stringify(out.result.errors)).toBe('applied')
  return out
}
const made = (primary) => turn(newAuthoringState(), [{
  op: 'create', name: 'Two lines', primary,
  outputs: [{ key: 'fast', tree: P('ema(close, 10)') }, { key: 'slow', tree: P('ema(close, 21)') }],
}]).state
const moved = (changes) => (changes || []).filter((c) => c.kind === 'scan-moved')

describe('removing the scanned line', () => {
  it('moves the scan to a remaining line AND discloses it', () => {
    const out = turn(made('slow'), [{ op: 'remove_output', output: 'slow' }])
    expect(moved(out.result.changes)).toEqual([expect.objectContaining({ kind: 'scan-moved', output: 'fast', from: 'slow' })])
    const lines = replyLines({ outputs: [] }, out.state, out.result.changes)
    expect(lines.join('\n')).toMatch(/Running this over a list now reads fast: the line it read \(slow\) was removed\./)
  })

  it('CONTROL: removing a line the scan does not read says nothing about the scan', () => {
    const out = turn(made('slow'), [{ op: 'remove_output', output: 'fast' }])
    expect(moved(out.result.changes)).toEqual([])
    expect(replyLines({ outputs: [] }, out.state, out.result.changes).join('\n')).not.toMatch(/over a list/)
  })

  it('the builder\'s Ask tab renders the same disclosure', () => {
    const code = CONVERSE_BOX_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(code).toMatch(/case 'scan-moved': return `Running this over a list now reads \$\{c\.output\}/)
  })
})
