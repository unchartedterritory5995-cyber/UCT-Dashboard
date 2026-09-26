/**
 * Wave 5 — the Notebook's code-block syntax highlighting: ONE curated language
 * roster, ONE lowlight instance.
 *
 * Wave 7 (lane I3): this module is LOADED ON DEMAND. The roster itself (ids, labels,
 * aliases) lives in `./codeLanguages`, which the editor imports eagerly; this file
 * holds the heavy half -- highlight.js core, the 19 grammars and lowlight, ~100 KB --
 * and is reached only through `codeLanguages.loadHighlighter()`, the first time a note
 * holds a code block. A note without one never downloads it. ⛔ Never import this file
 * statically from the editor: that would put it back in every note's first open
 * (`codeBlockNode.lazyHighlighter.test.js` fails if the editor's modules do).
 *
 * ⛔ CURATED, NEVER `lowlight/common` OR `all`. `common` is 37 grammars and `all` is
 * ~190; this roster is the languages a trader's notebook actually holds (strategy
 * code, queries, spreadsheets, config) — add one deliberately (to `codeLanguages.js`
 * AND a grammar here), and re-measure the chunk.
 *
 * ⛔ NO AUTO-DETECTION. A block with no language (every code block written before
 * wave 5, and "Plain text") renders as plain text. Guessing a language means trying
 * every grammar against the whole block, for every code block in the note, on every
 * keystroke; the member picks a language instead.
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
import { CODE_LANGUAGES as ROSTER } from './codeLanguages'

const GRAMMARS = {
  bash, c, cpp, csharp, css, diff, excel, go, java, javascript, json, markdown,
  python, r, rust, sql, typescript, xml, yaml,
}

/** The roster with each language's grammar, in the roster's order. A roster id with
 *  no grammar here throws at load rather than silently highlighting nothing. */
export const CODE_LANGUAGES = Object.freeze(ROSTER.map((l) => {
  const grammar = GRAMMARS[l.id]
  if (!grammar) throw new Error(`codeHighlight: no grammar for roster language ${l.id}`)
  return Object.freeze({ ...l, grammar })
}))

/** alias -> id, derived from each grammar's OWN `aliases` (a grammar is a pure
 *  function of the hljs API object; calling it registers nothing). The roster's
 *  eager copy (`codeLanguages.CODE_LANGUAGE_ALIASES`) is tested against this. */
export function grammarAliases() {
  const out = {}
  for (const lang of CODE_LANGUAGES) {
    for (const alias of lang.grammar(hljs).aliases || []) out[String(alias).toLowerCase()] = lang.id
  }
  return out
}

const base = createLowlight(Object.fromEntries(CODE_LANGUAGES.map((l) => [l.id, l.grammar])))

/**
 * The instance the code block's decoration plugin runs on. Identical to lowlight's own
 * except `highlightAuto`, which returns the block unhighlighted (see the file header:
 * no auto-detection).
 */
export const notebookLowlight = Object.freeze({
  ...base,
  highlightAuto: (value) => ({
    type: 'root',
    children: [{ type: 'text', value: String(value ?? '') }],
    data: { language: undefined, relevance: 0 },
  }),
})
