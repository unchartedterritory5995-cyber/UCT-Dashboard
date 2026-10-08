// Wave 13 lane 13B — the snapshot note stays frozen.
//
//  * it is built of static node types only (no widget, no embed, nothing that re-reads the server);
//  * a doc already built is untouched by a later payload, and the builder is pure;
//  * it carries the R3 wording and the pattern caption in words;
//  * it never names an Entry or a Stop, so 13A's matcher cannot read it as a plan;
//  * it is created through the one create door, tagged, and its revision landed.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./noteCreation', () => ({ createNoteViaApi: vi.fn(async (args) => ({ id: 'snap-1', ...args })) }))
vi.mock('./offline/settleNoteWrite', () => ({ settleNoteWrite: vi.fn(async () => {}) }))

import { buildSnapshotDoc, createPlaybookSnapshotNote, SNAPSHOT_NODE_TYPES, SNAPSHOT_TAG } from './playbookSnapshot'
import { createNoteViaApi } from './noteCreation'
import { settleNoteWrite } from './offline/settleNoteWrite'

const rec = (setup, n, band, rate, range = null) => ({
  setup, tradeCount: n, winRate: rate, profitFactor: 1.5, totalPnlDollar: 120.5,
  sample: { n, band, wording: band === 'too_few' ? 'too few to judge' : band === 'thin' ? 'thin sample' : null },
  winRateStat: { k: Math.round(rate * n), n, rate, band, range },
  avgRStat: { n, mean: 0.25, band, range: band === 'thin' ? [-0.1, 0.6] : null },
  expectancyStat: { n, mean: 12.5, band, range: band === 'thin' ? [-5, 30] : null },
})

const PAYLOAD = {
  asOf: '2026-10-03T12:00:00+00:00',
  setups: [rec('Breakout', 12, 'thin', 0.5833, [0.32, 0.807]), rec('EP', 9, 'too_few', 0.6667), rec('Pullback', 25, 'normal', 0.4)],
  untagged: { count: 2 },
  patterns: {
    caption: 'Patterns, not proof', status: 'ok',
    findings: [{ term: 'FOMO', leans: 'losses', losses: { k: 4, n: 6 }, wins: { k: 1, n: 6 }, citations: [] }],
  },
}

function nodeTypes(node, out = new Set()) {
  out.add(node.type)
  for (const c of node.content || []) nodeTypes(c, out)
  return out
}
const flatText = (node) => (node.text || '') + (node.content || []).map(flatText).join(' ')

describe('the playbook snapshot note (13B)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is built of static node types only', () => {
    const types = nodeTypes(buildSnapshotDoc(PAYLOAD))
    for (const t of types) expect(SNAPSHOT_NODE_TYPES).toContain(t)
    expect(types.has('table')).toBe(true)                 // non-vacuity: the table is there
  })

  it('stays frozen: a later payload never touches a doc already built, and the builder is pure', () => {
    const doc = buildSnapshotDoc(PAYLOAD)
    const frozen = JSON.stringify(doc)
    const later = structuredClone(PAYLOAD)
    later.setups[0].winRateStat.rate = 0.9
    later.asOf = '2027-01-01T00:00:00+00:00'
    const laterDoc = buildSnapshotDoc(later)
    expect(JSON.stringify(doc)).toBe(frozen)
    expect(JSON.stringify(laterDoc)).not.toBe(frozen)     // control: the builder does read the payload
    expect(JSON.stringify(buildSnapshotDoc(PAYLOAD))).toBe(frozen)
  })

  it('carries the R3 wording, the ranges and the caption in words', () => {
    const t = flatText(buildSnapshotDoc(PAYLOAD))
    expect(t).toContain('58% (n=12; thin sample, likely 32% to 81%)')
    expect(t).toContain('too few to judge (n=9; 67%)')
    expect(t).toContain('40% (n=25)')
    expect(t).toContain('Patterns, not proof')
    expect(t).toContain('“FOMO”: before 4 of 6 losses and 1 of 6 wins')
    expect(t).toContain('Frozen on 2026-10-03')
    expect(t).not.toMatch(/\b(Entry|Stop)\s*:/)
  })

  it('is created through the one create door, tagged, and its revision landed', async () => {
    const note = await createPlaybookSnapshotNote(PAYLOAD)
    expect(createNoteViaApi).toHaveBeenCalledTimes(1)
    const args = createNoteViaApi.mock.calls[0][0]
    expect(args.title).toBe('My Playbook snapshot 2026-10-03')
    expect(args.tags).toEqual([SNAPSHOT_TAG])
    expect(args.bodyJson.type).toBe('doc')
    expect(settleNoteWrite).toHaveBeenCalledWith('snap-1', note)
  })
})
