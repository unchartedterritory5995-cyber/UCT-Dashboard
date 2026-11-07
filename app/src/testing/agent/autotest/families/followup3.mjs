// UCT Agent AUTOTEST: FOLLOW-UP read-backs for unseen batch 3, written 2026-11-07 AFTER seeing its results (so NOT unseen: they are
// not counted with the unseen sets). A door-written control (the widget's own React state, the Theme Tracker's period, the
// Terminal's TBD section) writes no pref, so batch 3 could see only the receipt. Here each change is read back through the
// widget's OWN door read (widget.readOptions → the mounted widget's read()), in the same page, after the change: a success
// receipt whose read-back still shows the old value is a receipt without a real change.
import { family, op, say } from './dsl.mjs'

const b = '$list:board'
const set = (widget, key, value) => op('widget.setOption', b, { widget, key, value })
const readOpts = (widget) => op('widget.readOptions', b, { widget })
const keep = { settleMs: 1500 }

export function followup3(L) {
  const f = family(L, 'f3-door-readback', { inv: ['C3-169'], board: 'WIDGETS', select: null })
  const pair = (kind, setText, ops, readText, widget, says, inv) => f(kind, [say(setText, ops, keep), say(readText, [readOpts(widget)])], null,
    { outcome: 'change', expect: [], says, receipt: true }, { inventory: inv, unverifiable: ['the value is checked through the widget\'s own read (its door), shown in the Agent\'s read-back reply'] })
  pair('followup', 'theme tracker over the past week', [set('w-themes', 'period', '1w')], 'what is the theme tracker set to now', 'w-themes', 'period 1w', ['C3-169'])
  pair('followup', 'themes year to date please', [set('w-themes', 'period', 'ytd')], 'and what period is the theme tracker on', 'w-themes', 'period ytd', ['C3-169'])
  pair('followup', 'flip the theme tracker sort to worst first', [set('w-themes', 'sortDir', 'asc')], 'how is the theme tracker sorted now', 'w-themes', 'sortDir asc', ['C3-170'])
  pair('followup', 'themes measured from the open', [set('w-themes', 'todayBasis', 'open')], 'read me the theme tracker settings', 'w-themes', 'todayBasis open', ['C3-171'])
  pair('followup', 'expand the TBD earnings in the terminal', [set('w-term', 'tbdOpen', true)], 'what is the terminal set to', 'w-term', 'tbdOpen (on|true)', ['C3-152'])
  pair('followup', 'add the sector universe to new highs lows', [set('w-nhnl', 'universes', '+Sector')], 'which universes does new highs lows show now', 'w-nhnl', 'Sector', ['C3-187'])
}
