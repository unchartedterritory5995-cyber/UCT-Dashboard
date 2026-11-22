// app/src/pages/formulas/referenceDownload.js
//
// ─── THE REFERENCE AS ONE FILE, FOR A MEMBER'S OWN ASSISTANT ─────────────────
//
// A member who writes indicators with their own assistant has to teach it this
// vocabulary first, and until now the only way was to copy the page by hand. This
// builds the whole reference as one Markdown file they can attach: every name that
// can be written, what it means, what is deliberately absent and what to write
// instead, and whether each TradingView built-in runs here.
//
// ⛔ NOTHING IS WRITTEN HERE. It takes the SAME objects the page renders
// (`buildVocabulary()` and `buildPineNames()`) and the same sentence helper
// (`referenceSentence`), so the file cannot say something the page does not. The
// only prose of its own is the short "how to use this" at the top.
//
// ⛔ NO GENERATED DATE AND NO BUILD ID. The same data must give the same file, byte
// for byte, so a test can pin it and a member can diff two downloads.

import { reachOf } from '../../components/chart/engine/ast/vocabulary'
import { TABLE } from '../../components/chart/engine/ast/parse'
import { referenceSentence } from './referenceSentence'
import { memberExcluded } from './memberReason'

/** The engine's own reach sentence for a function, or nothing for a kind that declares
 *  none. ⛔ Bar fields, operators and benchmarks have no `lookback`, and inventing "0 bars"
 *  for them would state a fact the manifest never declared. ONE reader, used by the page
 *  and by the file, so the two cannot differ. */
export function reachFor(item) {
  const spec = (TABLE.functions || {})[item.name]
  return spec ? reachOf(spec) : null
}

export const REFERENCE_FILE_NAME = 'uct-formula-reference.md'

/** The only prose this module owns. */
export const HOW_TO_USE = Object.freeze([
  'This file lists everything a UCT formula can use. Give it to your assistant and ask it to',
  'write a UCT formula using ONLY the names below.',
  '',
  'A formula is one expression, for example `sma(close, 50) > sma(close, 200)`. To use what',
  'your assistant wrote: on a UCT chart open Chart Settings, then Indicators, press "Add',
  'indicator", choose "write a formula", and paste it. UCT checks it as you type and says what',
  'it reads, in plain words, before anything is saved.',
  '',
  'If your assistant uses a name that is not in this file, the formula will be refused. The',
  'section "Deliberately not available" lists common names that are absent on purpose, with',
  'what to write instead.',
])

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()

/** One entry as Markdown lines. `reachFor(item)` is the page's own reach reader. */
function entryLines(item, { plain = (s) => s } = {}) {
  const out = [`- \`${item.signature}\`: ${clean(plain(referenceSentence(item)))}`]
  const reach = item.kind === 'function' ? reachFor(item) : null
  if (reach) out.push(`  - ${clean(reach)}`)
  for (const t of item.traits || []) if (t && t.text) out.push(`  - ${clean(t.text)}`)
  return out
}

/**
 * The reference as Markdown.
 * @param {{groups: object[], excluded: object[]}} vocab   `buildVocabulary()`
 * @param {object} [opts]
 * @param {Function} [opts.plain]     the page's text filter (`withoutGuardIds`)
 * @param {{groups: object[], runs: number, total: number}|null} [opts.pine]  `buildPineNames()`
 * @param {string} [opts.pineScope]   the sentence that qualifies the Pine list (`SCOPE_NOTE`)
 * @returns {string}
 */
export function buildReferenceText(vocab, { plain = (s) => s, pine = null, pineScope = '' } = {}) {
  const groups = (vocab && vocab.groups) || []
  // the roster as a member reads it: the engine's own notes are not written into the file
  const excluded = memberExcluded((vocab && vocab.excluded) || [])
  const names = groups.reduce((n, g) => n + g.items.length, 0)
  const lines = ['# UCT formula reference', '', ...HOW_TO_USE, '',
    `${names} names can be written. ${excluded.length} are deliberately not available.`, '']
  for (const g of groups) {
    lines.push(`## ${g.title} (${g.items.length})`, '', clean(g.blurb), '')
    for (const it of g.items) lines.push(...entryLines(it, { plain }))
    lines.push('')
  }
  if (excluded.length) {
    lines.push(`## Deliberately not available (${excluded.length})`, '',
      'These names are absent on purpose. Each says why, and most name what to write instead.', '')
    for (const e of excluded) {
      lines.push(`- \`${e.name}\`: ${clean(e.says)}`)
      if (e.instead) lines.push(`  - Write \`${e.instead}\``)
    }
    lines.push('')
  }
  if (pine && Array.isArray(pine.groups) && pine.groups.length) {
    lines.push(`## TradingView names (${pine.runs} of ${pine.total} run)`, '')
    if (pineScope) lines.push(clean(pineScope), '')
    for (const g of pine.groups) {
      lines.push(`### ${g.title} (${g.runs} of ${g.items.length} run)`, '')
      for (const it of g.items) {
        let line = `- \`${it.name}\`: ${it.words}`
        if (it.example) line += ` as \`${it.example}\``
        if (it.family && it.family.label) line += `: ${it.family.label.charAt(0).toLowerCase() + it.family.label.slice(1)}`
        lines.push(line)
      }
      lines.push('')
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

/**
 * Hand the text to the browser as a file. Returns false where there is no document or
 * no object URLs (the caller then says so instead of appearing to do nothing).
 */
export function saveTextFile(text, name = REFERENCE_FILE_NAME, env = globalThis) {
  try {
    const doc = env.document
    const U = env.URL
    if (!doc || !U || typeof U.createObjectURL !== 'function' || typeof env.Blob !== 'function') return false
    const url = U.createObjectURL(new env.Blob([text], { type: 'text/markdown;charset=utf-8' }))
    const a = doc.createElement('a')
    a.href = url
    a.download = name
    a.rel = 'noopener'
    doc.body.appendChild(a)
    a.click()
    a.remove()
    // released after the click has been handled
    env.setTimeout(() => { try { U.revokeObjectURL(url) } catch { /* already gone */ } }, 0)
    return true
  } catch {
    return false
  }
}
