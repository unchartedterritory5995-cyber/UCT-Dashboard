/**
 * Wave 5 — the Notebook's code-block syntax highlighting: ONE curated
 * language roster, ONE lowlight instance.
 *
 * ⛔ CURATED, NEVER `lowlight/common` OR `all`. Every grammar registered here
 * ships in the Notebook's editor chunk for every member who opens a note, code
 * block or not. `common` is 37 grammars and `all` is ~190; this roster is the
 * languages a trader's notebook actually holds (strategy code, queries,
 * spreadsheets, config) — add one deliberately, and re-measure the chunk.
 *
 * ⛔ THE ROSTER IS THE AUTHORITY FOR THE PICKER TOO. The language picker on a
 * code block (codeBlockNode.js) offers exactly `CODE_LANGUAGES`, in this
 * order; the aliases a pasted fence may carry (```py, ```ts, ```sh) are read
 * from each grammar's OWN `aliases`, never retyped here, so they cannot drift
 * from what lowlight actually recognises.
 *
 * ⛔ NO AUTO-DETECTION. A block with no language (every code block written
 * before this wave, and "Plain text") renders as plain text. The stock plugin
 * calls `highlightAuto` for an unlabelled block — every grammar tried against
 * the whole block — and it does that for EVERY code block in the note on every
 * keystroke typed inside any of them. The member picks a language; guessing
 * one per keystroke is a cost with no owner.
 */
import hljs from 'highlight.js/lib/core'
import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import excel from 'highlight.js/lib/languages/excel'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

/**
 * The picker's options after "Plain text", in the order a trader reaches for
 * them. `id` is what the node stores (`codeBlock.attrs.language`) and what a
 * Markdown fence carries (```python), so it is the highlight.js name, never a
 * display label.
 */
export const CODE_LANGUAGES = Object.freeze([
  { id: 'python', label: 'Python', grammar: python },
  { id: 'sql', label: 'SQL', grammar: sql },
  { id: 'javascript', label: 'JavaScript', grammar: javascript },
  { id: 'typescript', label: 'TypeScript', grammar: typescript },
  { id: 'r', label: 'R', grammar: r },
  { id: 'excel', label: 'Excel formula', grammar: excel },
  { id: 'json', label: 'JSON', grammar: json },
  { id: 'bash', label: 'Shell', grammar: bash },
  { id: 'yaml', label: 'YAML', grammar: yaml },
  { id: 'markdown', label: 'Markdown', grammar: markdown },
  { id: 'xml', label: 'HTML / XML', grammar: xml },
  { id: 'css', label: 'CSS', grammar: css },
  { id: 'java', label: 'Java', grammar: java },
  { id: 'csharp', label: 'C#', grammar: csharp },
  { id: 'cpp', label: 'C++', grammar: cpp },
  { id: 'c', label: 'C', grammar: c },
  { id: 'go', label: 'Go', grammar: go },
  { id: 'rust', label: 'Rust', grammar: rust },
  { id: 'diff', label: 'Diff', grammar: diff },
].map(Object.freeze))

/** The option that means "no language": stored as `null`. */
export const PLAIN_TEXT_LABEL = 'Plain text'

const BY_ID = new Map(CODE_LANGUAGES.map((l) => [l.id, l]))

// alias -> canonical id, read from each grammar's own definition (a grammar is
// a pure function of the hljs API object; calling it registers nothing).
const ALIAS_TO_ID = new Map()
for (const lang of CODE_LANGUAGES) {
  for (const alias of lang.grammar(hljs).aliases || []) ALIAS_TO_ID.set(String(alias).toLowerCase(), lang.id)
}

/**
 * The roster id a stored language means, or null when it is none of ours.
 * `py` -> 'python', 'Python' -> 'python', 'pinescript' -> null.
 */
export function canonicalLanguage(language) {
  if (typeof language !== 'string' || !language) return null
  const key = language.toLowerCase()
  if (BY_ID.has(key)) return key
  return ALIAS_TO_ID.get(key) || null
}

/** What the picker shows for a stored language. An unknown one is shown as
 *  itself — never silently mapped to "Plain text", which would read as if the
 *  member's label had been thrown away. */
export function languageLabel(language) {
  if (!language) return PLAIN_TEXT_LABEL
  const id = canonicalLanguage(language)
  return id ? BY_ID.get(id).label : String(language)
}

const base = createLowlight(Object.fromEntries(CODE_LANGUAGES.map((l) => [l.id, l.grammar])))

/**
 * The instance the code block plugin runs on. Identical to lowlight's own
 * except `highlightAuto`, which returns the block unhighlighted (see the file
 * header: no auto-detection). The plugin only calls `highlight` for a language
 * `registered()` confirms, so an unknown stored language lands here too and
 * renders as plain text — never an exception inside a keystroke.
 */
export const notebookLowlight = Object.freeze({
  ...base,
  highlightAuto: (value) => ({
    type: 'root',
    children: [{ type: 'text', value: String(value ?? '') }],
    data: { language: undefined, relevance: 0 },
  }),
})
