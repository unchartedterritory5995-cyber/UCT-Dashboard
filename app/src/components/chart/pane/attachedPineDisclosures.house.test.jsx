// app/src/components/chart/pane/attachedPineDisclosures.house.test.jsx
//
// ⭐ (owner ruling 2026-11-24, on Fred RS: "hide all that crap") UCT's own house indicators carry no data-source notes
// under the chart: not their document's disclosures, not a withheld-read note (the chart-clock store, which carries the
// first-page and `sym` notes), not the index-history note. A house script that STOPPED still says so, with its Retry.
// CONTROL: the same notes on a member's own script (and on an EDITED house copy) still show, so the rail cannot pass
// by the strip printing nothing at all.
import { render, cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AttachedPineDisclosures, { withoutHouseInstances } from './AttachedPineDisclosures'
import { setChartClockNotes, resetChartClockNotes } from '../engine/chartClockNotice'
import { setIndexHistoryNote, _resetIndexHistoryNotes } from '../engine/indexHistoryNotice'
import { setRuntimeErrorNotice, resetRuntimeErrorNotices } from '../engine/runtimeErrorNotice'

const DOC_NOTE = { name: 'Reads', note: 'This script reads `syminfo.industry`, and it uses UCT data for it.' }
const CLOCK = { code: 'other-symbol:seed', reason: 'This script reads `SEED_FRED6725_RS_RATING:RSRATING`.' }
const defs = {
  fred: { meta: { name: 'Fred RS', disclosures: [DOC_NOTE] } },
  edited: { meta: { name: 'Fred RS', scriptEdited: true, disclosures: [DOC_NOTE] } },
  mine: { meta: { name: 'My RS', disclosures: [DOC_NOTE] } },
}
const registry = { getDefinition: (id) => defs[id] || null, registryGeneration: () => 1 }
const one = (defId) => ({ indicatorInstances: [{ instanceId: `i-${defId}`, defId }] })
const publish = (defId) => {
  setChartClockNotes(`i-${defId}`, 'plots', [CLOCK])
  setIndexHistoryNote(`i-${defId}`, true)
}

afterEach(() => { cleanup(); resetChartClockNotes(); _resetIndexHistoryNotes(); resetRuntimeErrorNotices() })

describe('⭐ UCT house indicators show no data notes under the chart', () => {
  it('Fred RS (an unedited house copy): the strip prints nothing', () => {
    publish('fred')
    const { container } = render(<AttachedPineDisclosures settings={one('fred')} registry={registry} />)
    expect(container.textContent).toBe('')
  })

  it('CONTROL: the same notes on a member\'s own script, and on an EDITED house copy, still show', () => {
    for (const id of ['mine', 'edited']) {
      publish(id)
      const { container, unmount } = render(<AttachedPineDisclosures settings={one(id)} registry={registry} />)
      expect(container.textContent).toContain('syminfo.industry')
      expect(container.textContent).toContain('SEED_FRED6725_RS_RATING')
      unmount()
      resetChartClockNotes(); _resetIndexHistoryNotes()
    }
  })

  it('a house script that STOPPED still says so (it explains an empty pane)', () => {
    setRuntimeErrorNotice('i-fred', 'the script stopped itself here')
    render(<AttachedPineDisclosures settings={one('fred')} registry={registry} />)
    expect(screen.getByTestId('pine-attached-disclosures').textContent).toContain('the script stopped itself here')
  })

  it('withoutHouseInstances drops only the house copy and keeps the settings object when there is none', () => {
    const both = { indicatorInstances: [...one('fred').indicatorInstances, ...one('mine').indicatorInstances] }
    expect(withoutHouseInstances(both, registry).indicatorInstances.map((i) => i.defId)).toEqual(['mine'])
    const mine = one('mine')
    expect(withoutHouseInstances(mine, registry)).toBe(mine)
  })
})
