// NEWS FILTER PRESETS (agent/pl/news-filter-presets, C3-140) — HELD-OUT phrasings, written as FAMILIES before the change and
// never used to tune it. The News (Trade Exchange) widget's own Filters menu → Presets: apply one, save the widget's current
// filters as a named one, rename one, delete one (TradeExchangeNewsWidget applyPreset / savePreset / renamePreset / deletePreset).
// args = what a correct plan carries (widget.setOption { key, value }); the outcome test reads the widget back.
// The member's presets in the fixture: "Macro" (category Macro, search "fed") and "Earnings Watch" (category Earnings).
export const APPLY_HELD_OUT = [
  { row: 'C3-140', text: 'use my macro preset on the news', args: { key: 'preset', value: 'Macro' }, applies: 'Macro' },
  { row: 'C3-140', text: 'switch the news widget to the Earnings Watch filters', args: { key: 'preset', value: 'Earnings Watch' }, applies: 'Earnings Watch' },
  { row: 'C3-140', text: 'apply my earnings preset to the trade exchange news', args: { key: 'preset', value: 'earnings' }, applies: 'Earnings Watch' },
  { row: 'C3-140', text: 'load the Macro news preset', args: { key: 'preset', value: 'macro' }, applies: 'Macro' },
]
export const SAVE_HELD_OUT = [
  { row: 'C3-140', text: 'save these news filters as Tariffs', args: { key: 'presets', value: 'create:Tariffs' }, saves: 'Tariffs' },
  { row: 'C3-140', text: 'store the current news filter as a preset called Opening Bell', args: { key: 'presets', value: 'create:Opening Bell' }, saves: 'Opening Bell' },
]
export const RENAME_HELD_OUT = [
  { row: 'C3-140', text: 'rename my Macro news preset to Fed Watch', args: { key: 'presets', value: 'rename:Macro=>Fed Watch' }, from: 'Macro', to: 'Fed Watch' },
  { row: 'C3-140', text: 'call the earnings watch preset Reports instead', args: { key: 'presets', value: 'rename:Earnings Watch=>Reports' }, from: 'Earnings Watch', to: 'Reports' },
]
export const DELETE_HELD_OUT = [
  { row: 'C3-140', text: 'delete the Earnings Watch news preset', args: { key: 'presets', value: 'delete:Earnings Watch' }, deletes: 'Earnings Watch' },
  { row: 'C3-140', text: 'get rid of my macro filter preset', args: { key: 'presets', value: 'delete:macro' }, deletes: 'Macro' },
]
export const PRESET_REFUSE_HELD_OUT = [
  // a preset the member does not have: refused with the widget's own presets, nothing applied
  { row: 'C3-140', text: 'use my Biotech news preset', args: { key: 'preset', value: 'Biotech' }, refuse: /Macro/ },
  // a name already taken: the widget's own Save would make a second preset of the same name, so it is refused, not guessed
  { row: 'C3-140', text: 'save these news filters as Macro', args: { key: 'presets', value: 'create:Macro' }, refuse: /already have a filter preset named “Macro”/ },
  // the widget's own name box takes 40 characters
  { row: 'C3-140', text: 'save the news filters as a preset with a very long name', args: { key: 'presets', value: `create:${'x'.repeat(41)}` }, refuse: /at most 40 characters/ },
  { row: 'C3-140', text: 'save these news filters', args: { key: 'presets', value: 'create' }, refuse: /name/ },
  { row: 'C3-140', text: 'rename the macro preset to Earnings Watch', args: { key: 'presets', value: 'rename:Macro=>Earnings Watch' }, refuse: /already have a filter preset named “Earnings Watch”/ },
  { row: 'C3-140', text: 'delete my Crypto news preset', args: { key: 'presets', value: 'delete:Crypto' }, refuse: /no “Crypto”/ },
]

import { describe, it, expect } from 'vitest'
describe('news filter preset held-out sets are frozen data', () => {
  it('no phrasing appears twice', () => {
    const all = [...APPLY_HELD_OUT, ...SAVE_HELD_OUT, ...RENAME_HELD_OUT, ...DELETE_HELD_OUT, ...PRESET_REFUSE_HELD_OUT]
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
