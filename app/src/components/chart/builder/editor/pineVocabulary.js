// app/src/components/chart/builder/editor/pineVocabulary.js
//
// ─── A6 — PINE-AWARE EDITING: COMPLETIONS, HOVER DOCS, FOLDING ──────────────
//
// ⛔ THE NAMES ARE `pineVocabulary.json`, which `pineVocabularyDerive.js` derives
// from the engine's own tables and the committed corpus — see that file's header
// for the two authorities and why the result is frozen. `pineVocabulary.test.js`
// re-derives it and fails on drift, and asks the translator to resolve every
// spelling it holds. Nothing in this file adds or removes a name.
//
// ⭐ THE WORDS ARE THE ENGINE'S. A hover or a completion's info is the closed
// table's own `sentence` (the read-back a member already sees), with the
// argument roles the table declares — re-ordered into PINE's argument order by
// the measured `PINE_CALL_SHAPES` plan where one exists, and named by
// `PINE_ARG_NAMES` where that carries evidence — plus the entry's `vendorNote`
// (where this engine deliberately differs from TradingView). No TradingView
// reference text is restated here (`docs/pine/LICENSING.md`).
//
// ⭐ VERSION-AWARE: the script's own `//@version=` (read by the engine's lexer)
// picks the spellings — `sma(` under v4, `ta.sma(` under v5/v6.

import { foldService } from '@codemirror/language'
import { hoverTooltip } from '@codemirror/view'
import { TABLE } from '../../engine/ast/parse'
import { PINE_CALL_SHAPES, PINE_ARG_NAMES, lexPine } from '../../engine/ast/pine'
import VOCAB from './pineVocabulary.json'

/** The newest Pine a script without a `//@version=` line is NOT: Pine reads such
 *  a script as v1, which spells value functions bare like v4. */
const VERSIONLESS = 4

const normalise = (name) => String(name).toLowerCase().replace(/_/g, '')

/** The script's `//@version=` read by the engine's own lexer (over its comment
 *  lines only, so a half-typed line elsewhere cannot make the read throw),
 *  bucketed to 4 / 5 / 6. */
export function pineVersionOf(text) {
  const comments = String(text || '').split('\n').filter((l) => /^\s*\/\//.test(l)).join('\n')
  let version = null
  try { version = lexPine(comments).version } catch { version = null }
  if (!Number.isFinite(version)) return VERSIONLESS
  return version >= 6 ? 6 : version === 5 ? 5 : 4
}

/** The table entry's argument roles in PINE's order — the measured shape's plan
 *  read backwards (`{pine: i}` at table slot j means Pine's i-th argument plays
 *  table role j). Slots the shape fills itself (`{series: 'high'}`) are not
 *  Pine arguments and are left out. */
function pineArgsOf(short, key) {
  const named = PINE_ARG_NAMES[short]
  if (named && Array.isArray(named.names)) return named.names
  const entry = key && TABLE.functions[key]
  if (!entry) return null
  const roles = Array.isArray(entry.argRoles) ? entry.argRoles : entry.args
  const shape = Object.prototype.hasOwnProperty.call(PINE_CALL_SHAPES, short) ? PINE_CALL_SHAPES[short] : null
  if (!shape) return roles
  const out = new Array(shape.pineArity).fill(null)
  shape.build.forEach((slot, j) => { if (slot && Number.isInteger(slot.pine)) out[slot.pine] = roles[j] })
  return out.map((r, i) => r || `argument ${i + 1}`)
}

/** `{0}` → the table's own role names (the same rendering `completions.js` uses). */
function sentenceOf(entry) {
  if (!entry || typeof entry.sentence !== 'string') return null
  const roles = Array.isArray(entry.argRoles) ? entry.argRoles : []
  return entry.sentence.replace(/\{(\d+)\}/g, (w, i) => (roles[Number(i)] !== undefined ? roles[Number(i)] : w))
}

/** One vocabulary row → what the editor says about it. */
export function pineDocFor(row) {
  if (!row) return null
  const short = normalise(row.label.split('.').pop())
  const entry = row.key ? TABLE.functions[row.key] : null
  const args = row.call ? pineArgsOf(short, row.key) : null
  const signature = row.call ? `${row.label}(${args ? args.join(', ') : '…'})` : row.label
  const sentence = sentenceOf(entry)
  const note = entry && typeof entry.vendorNote === 'string' ? entry.vendorNote : null
  return {
    signature,
    sentence: sentence ? `Reads as: ${sentence}.` : 'A Pine built-in this engine resolves.',
    note,
  }
}

const ROWS = Object.freeze(VOCAB.map((r) => Object.freeze({ ...r })))

/** The spellings offered under Pine `version` (4/5/6). */
export function pineVocabularyFor(version) {
  const v = version >= 6 ? 6 : version === 5 ? 5 : 4
  return ROWS.filter((r) => r.versions.includes(v))
}

/** Every row, for the rail. */
export const PINE_VOCABULARY = ROWS

function optionOf(row) {
  const doc = pineDocFor(row)
  return {
    label: row.label,
    type: row.call ? 'function' : (row.label.includes('.') ? 'constant' : 'variable'),
    detail: row.call ? doc.signature.slice(row.label.length) : undefined,
    info: [doc.sentence, doc.note].filter(Boolean).join('\n\n'),
    // A call completes WITH its bracket, the way a member types it next.
    apply: row.call ? `${row.label}(` : row.label,
  }
}

const OPTIONS = new Map([4, 5, 6].map((v) => [v, pineVocabularyFor(v).map(optionOf)]))

/** A Pine name under the caret: identifiers joined by dots (`ta.sm`). */
const PINE_WORD = /[A-Za-z_][A-Za-z0-9_.]*/

/** The CodeMirror completion source for the Pine dialect. */
export function pineCompletionSource() {
  return (ctx) => {
    const word = ctx.matchBefore(PINE_WORD)
    if (!word && !ctx.explicit) return null
    // Not inside a comment or a string: the engine reads neither as a name.
    const line = ctx.state.doc.lineAt(ctx.pos)
    const before = line.text.slice(0, ctx.pos - line.from)
    if (/\/\//.test(before) || (before.split('"').length - 1) % 2 === 1) return null
    const typed = word ? word.text.toLowerCase() : ''
    const options = OPTIONS.get(pineVersionOf(ctx.state.doc.toString()))
      .filter((o) => o.label.toLowerCase().startsWith(typed))
    if (!options.length) return null
    return { from: word ? word.from : ctx.pos, options, validFor: /^[A-Za-z_][A-Za-z0-9_.]*$/ }
  }
}

/** The vocabulary row for the Pine name at `pos`, under the doc's version. */
export function pineRowAt(doc, pos) {
  const line = doc.lineAt(pos)
  const text = line.text
  let s = pos - line.from
  let e = s
  while (s > 0 && /[A-Za-z0-9_.]/.test(text[s - 1])) s -= 1
  while (e < text.length && /[A-Za-z0-9_.]/.test(text[e])) e += 1
  const word = text.slice(s, e)
  if (!word) return null
  const row = pineVocabularyFor(pineVersionOf(doc.toString())).find((r) => r.label === word)
  return row ? { row, from: line.from + s, to: line.from + e } : null
}

/** Hover docs: the engine's own sentence for the name under the pointer. */
export const pineHover = hoverTooltip((view, pos) => {
  const hit = pineRowAt(view.state.doc, pos)
  if (!hit) return null
  const doc = pineDocFor(hit.row)
  return {
    pos: hit.from,
    end: hit.to,
    above: true,
    create() {
      const dom = document.createElement('div')
      dom.className = 'cm-pine-doc'
      dom.setAttribute('data-testid', 'pine-hover-doc')
      for (const [cls, text] of [['cm-pine-doc-sig', doc.signature], ['cm-pine-doc-body', doc.sentence], ['cm-pine-doc-note', doc.note]]) {
        if (!text) continue
        const p = document.createElement('div')
        p.className = cls
        p.textContent = text
        dom.appendChild(p)
      }
      return { dom }
    },
  }
})

const indentOf = (text) => {
  const m = /^[ \t]*/.exec(text)[0]
  return m.replace(/\t/g, '    ').length
}
const blank = (text) => /^\s*(\/\/.*)?$/.test(text)

/** Pine blocks are INDENTATION (no braces): a line folds over every following
 *  line indented deeper than it, up to the last such non-blank line. */
export function pineFoldRange(state, lineStart) {
  const line = state.doc.lineAt(lineStart)
  if (blank(line.text)) return null
  const base = indentOf(line.text)
  let last = null
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const next = state.doc.line(n)
    if (blank(next.text)) continue
    if (indentOf(next.text) <= base) break
    last = next
  }
  return last ? { from: line.to, to: last.to } : null
}

export const pineFolding = foldService.of((state, lineStart) => pineFoldRange(state, lineStart))
