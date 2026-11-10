// DATA-WIDGET ACTIONS (pl-widget, agent/pl/exec-widget-actions): HELD-OUT phrasings for the widgets' own BUTTONS and the
// Scanner's way back to its picker, written as FAMILIES (templates × the widget's names) BEFORE the change and never used to
// tune it. Rows: C3-112 refresh a scan, C3-208 refresh a Period Sort ranking, C3-108 leave a scan (back to the picker).
// args = what a correct plan carries (widget.setOption { key, value }).
const fill = (tpls, names, make) => tpls.flatMap(t => names.map(n => make(t.replace('{w}', n))))

export const REFRESH_HELD_OUT = [
  ...fill(['refresh the {w}', 'reload my {w} results', 'rerun the {w} now', 'can you update the {w}'], ['scanner', 'scanner widget'],
    (text) => ({ row: 'C3-112', type: 'scanner', text, args: { key: 'refresh', value: 'run' } })),
  ...fill(['refresh the {w}', 'reload the {w} ranking', 'update my {w} results'], ['period sort', 'period sort widget'],
    (text) => ({ row: 'C3-208', type: 'periodsort', text, args: { key: 'refresh', value: 'run' } })),
]
export const LEAVE_HELD_OUT = [
  'leave this scan in the scanner', 'take the scanner back to its picker', 'exit the scan on my scanner widget',
  'go back to the scan picker in the scanner',
].map(text => ({ row: 'C3-108', type: 'scanner', text, args: { key: 'scan', value: 'picker' } }))
// what must NOT happen: a button that is not offered, an off-value for a button, a widget that is not mounted
export const ACTION_REFUSE_HELD_OUT = [
  { row: 'C3-112', type: 'scanner', text: 'stop refreshing the scanner', args: { key: 'refresh', value: 'off' }, refuse: /button/ },
  { row: 'C3-112', type: 'scanner', text: 'retry the scanner', args: { key: 'retry', value: 'run' }, refuse: /no option “retry”/ },
]

import { describe, it, expect } from 'vitest'
describe('data-widget action held-out sets are frozen data', () => {
  it('no phrasing appears twice', () => {
    const all = [...REFRESH_HELD_OUT, ...LEAVE_HELD_OUT, ...ACTION_REFUSE_HELD_OUT]
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
