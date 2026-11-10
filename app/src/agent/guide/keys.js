// ── UCT Agent PRODUCT GUIDE: a chart's keyboard shortcuts, taught from their own declaration ─────────────────────────
//
// One row per entry of components/chart/keyboardShortcuts.js SHORTCUTS (the list the chart's own `?` help overlay shows):
// nothing here restates a key. The card names the key EXACTLY as declared and says when it works: the chart must be the one
// in focus (click it first). The chart's matcher reads Ctrl as Ctrl OR ⌘ (matchShortcut: ctrlKey || metaKey), so a Ctrl
// key also names ⌘ on a Mac; nothing else is platform-specific there, so nothing else says so.
// A row is reached two ways, both only when the words are about a KEY (key, shortcut, hotkey, keyboard, press, or a chord
// written out): the chord itself ("Shift+L", "Alt+Shift+A", "?"), or the words of what it does ("log scale", "go to date").
// Read only. Teaching only: the member presses every key.

import { SHORTCUTS } from '../../components/chart/keyboardShortcuts'

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// what a member says to ask about a key at all
// ('key' alone is not enough: "the key levels", "a key reversal"; nor 'press': "a press release")
export const KEY_WORDS = /\b(short ?cuts?|hot ?keys?|keyboard|keystrokes?|key ?binds?|chords?)\b|\b(which|what|a|any|the|its|that) keys?\b(?! (levels?|reversals?|dates?|support|resistance|points?|areas?|stocks?|names?|themes?|takeaways?|events?|data))|\bkeys? (for|to|that|which|does|do)\b|\bpress(ing|es)?\b(?! (releases?|conferences?|coverage))|\b(alt|shift|ctrl|cmd|option)\s*\+\s*\S|(^|\s)\?(\s|$)/i
// ⭐ a key is asked about AS a question, not only as "how do I": "what is the shortcut for…", "which key…", "is there a hotkey…",
// "what does Alt+G do". capabilities/guide.js takes these words to the key family ONLY (never to another walkthrough).
export const KEY_ASK = /^(?:(?:can|could) you (?:tell me )?|please |ok |okay |so |hey )*(?:what(?:'s| is| are)? (?:the |a )?(?:keyboard )?(?:short ?cuts?|hot ?keys?|keys?)\b|which (?:keyboard )?(?:keys?|short ?cuts?|hot ?keys?)\b|is there (?:a|any) (?:keyboard )?(?:short ?cut|hot ?key|key)\b|what does (?:the )?(?:\S+\s*\+\s*)*\S+ (?:key |shortcut )?do\b|what (?:happens|does it do) (?:when|if) i press\b)/i
// a key written out: then the chord alone decides which row
const CHORD_WRITTEN = /\b(alt|shift|ctrl|control|cmd|option)\s*\+\s*\S|(^|\s)\?(\s|$)|\bquestion mark\b|\b(esc|escape)\b/i
// words of a description that say what kind of thing it is, not which (an ask can leave them out)
const GENERIC = new Set(['toggle', 'show', 'open', 'add', 'this', 'the', 'and', 'go', 'to', 'at', 'of', 'a', 'an', 'on', 'off', 'overlay', 'chart'])
// a member's word for what the declaration names another way
const SAME = { cursor: '(cursor|mouse|pointer)', date: 'dates?', help: '(help|all (the )?(keyboard )?shortcuts|every shortcut|list of (the )?shortcuts)', watchlist: 'watch ?lists?', indicator: 'indicators?', ticker: '(ticker|symbol|stock)s?', cancel: 'cancel\\w*', scale: 'scales?' }
const stem = (w) => SAME[w] || `${esc(w.replace(/s$/, ''))}\\w*`

// "Ctrl+M" → its written forms: ctrl+m, ctrl + m, control+m (and ⌘M / cmd+m on a Mac)
function chordRe(keys) {
  const k = String(keys).toLowerCase()
  if (k === '?') return /(^|\s)\?(\s|$)|\bquestion mark\b/
  if (k === 'esc') return /\b(esc|escape)\b/
  if (!k.includes('+')) return null
  const parts = k.split('+').map(p => (p === 'ctrl' ? '(ctrl|control|cmd|⌘)' : p === 'alt' ? '(alt|option|⌥)' : esc(p)))
  // the WHOLE chord: "Ctrl+Alt+J" is not Alt+J, and "Alt+Shift+A" is not Alt+Shift
  return new RegExp(`(?<![a-z0-9])(?<!\\+\\s*)${parts.join('\\s*\\+\\s*')}(?![a-z0-9])(?!\\s*\\+)`)
}
// what it does, in its own words: every content word of one alternative ("Cursor / cancel" is either)
function wordsRe(description) {
  const alts = String(description).toLowerCase().replace(/\(.*?\)/g, ' ').split('/').map(a => a.split(/[^a-z0-9-]+/).filter(w => w.length > 1 && !GENERIC.has(w)))
    .filter(ws => ws.length)
  if (!alts.length) return null
  return new RegExp(alts.map(ws => `^${ws.map(w => `(?=.*\\b${stem(w)})`).join('')}`).join('|'))
}
/** How the card writes the key: exactly as declared, and ⌘ for Ctrl on a Mac (the chart reads either). */
export const keyAsSaid = (keys) => (/^Ctrl\+/.test(keys) ? `${keys} (⌘${keys.slice(5)} on a Mac)` : keys)
// when a key does something only in a state: said on the card
const WHEN = { 'tool:cursor': ' It works while a drawing tool is armed or something is being drawn.', 'replay:playpause': ' It works while replay is running.', 'replay:back': ' It works while replay is running.', 'replay:forward': ' It works while replay is running.', gridcycle: ' It works on a Multi Chart grid.' }

// how many words a description must find: the row that needs most is tried first ("price alert at cursor" before "cursor")
const need = (d) => Math.min(...String(d).toLowerCase().replace(/\(.*?\)/g, ' ').split('/').map(a => a.split(/[^a-z0-9-]+/).filter(w => w.length > 1 && !GENERIC.has(w)).length || 99))
export const CHART_KEY_ACTIONS = SHORTCUTS.filter(s => s.keys && s.description && !/^\+ \/ -$/.test(s.keys))
  .map((s, i) => ({ s, i, n: need(s.description) })).sort((a, b) => (b.n % 99) - (a.n % 99) || a.i - b.i).map(({ s }) => {
  const chord = chordRe(s.keys)
  const words = wordsRe(s.description)
  const re = { test: (q) => KEY_WORDS.test(q) && (CHORD_WRITTEN.test(q) ? !!chord && chord.test(q) : !!words && words.test(q)) }
  const said = keyAsSaid(s.keys)
  return {
    id: `key.${s.command}`,
    label: `${s.description} (${s.keys})`,
    re,
    steps: [{ target: 'chart.plot', name: 'the chart', text: `Click the chart, then press ${said}: ${s.description.replace(/^./, c => c.toLowerCase())}.${WHEN[s.command] || ''}` }],
  }
})
const NEED = new Map(SHORTCUTS.map(s => [`key.${s.command}`, need(s.description) % 99]))
/** The words name ONE key: of the rows they reach, one asks for more words than the rest ("price alert at cursor" over
 *  "cursor"). Several keys asked about at once ("the keys for RSI, MACD and VWAP") are not one card: the family steps aside. */
export function oneKey(text) {
  const q = String(text || '').toLowerCase()
  const hits = CHART_KEY_ACTIONS.filter(r => r.re.test(q)).map(r => NEED.get(r.id))
  return hits.length > 0 && hits.filter(n => n === Math.max(...hits)).length === 1
}
