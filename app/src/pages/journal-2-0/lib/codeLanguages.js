/**
 * Wave 7 (lane I3) — the code-block language ROSTER, without the highlighter.
 *
 * The picker, the read-only label and a pasted fence's alias all need to know the
 * languages the moment a code block renders. Highlighting them does not: that needs
 * highlight.js core, 19 grammars and lowlight, ~100 KB of JS (measured with esbuild,
 * minified, 2026-09-25), and until this wave all of it sat in the editor chunk every
 * member downloads to open ANY note -- code block or not. So the roster lives here,
 * eagerly, and the highlighter (`./codeHighlight`) is loaded on demand, the first time
 * a note holds a code block (`loadHighlighter`, used by codeBlockNode.js).
 *
 * ⛔ ONE ROSTER. `codeHighlight.js` builds its grammar table FROM this list (by id), so
 * the picker and the highlighter cannot disagree about which languages exist.
 *
 * ⛔ THE ALIAS TABLE IS A CHECKED COPY, not an authority. The aliases a pasted fence
 * may carry (```py, ```ts, ```sh) belong to each grammar's OWN `aliases`; they are
 * written out here only so the picker can resolve one without downloading the
 * grammars. `codeBlockNode.test.js` re-derives the table from the grammars and fails
 * on any difference, so a grammar upgrade that adds or drops an alias cannot drift
 * past it silently.
 */

/**
 * The picker's options after "Plain text", in the order a trader reaches for them.
 * `id` is what the node stores (`codeBlock.attrs.language`) and what a Markdown fence
 * carries (```python), so it is the highlight.js name, never a display label.
 */
export const CODE_LANGUAGES = Object.freeze([
  { id: 'python', label: 'Python' },
  { id: 'sql', label: 'SQL' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'r', label: 'R' },
  { id: 'excel', label: 'Excel formula' },
  { id: 'json', label: 'JSON' },
  { id: 'bash', label: 'Shell' },
  { id: 'yaml', label: 'YAML' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'xml', label: 'HTML / XML' },
  { id: 'css', label: 'CSS' },
  { id: 'java', label: 'Java' },
  { id: 'csharp', label: 'C#' },
  { id: 'cpp', label: 'C++' },
  { id: 'c', label: 'C' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'diff', label: 'Diff' },
].map(Object.freeze))

/** The option that means "no language": stored as `null`. */
export const PLAIN_TEXT_LABEL = 'Plain text'

/** alias -> roster id. A CHECKED COPY of the grammars' own aliases (see the header). */
export const CODE_LANGUAGE_ALIASES = Object.freeze({
  py: 'python', gyp: 'python', ipython: 'python',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  xlsx: 'excel', xls: 'excel',
  jsonc: 'json',
  sh: 'bash', zsh: 'bash',
  yml: 'yaml',
  md: 'markdown', mkdown: 'markdown', mkd: 'markdown',
  html: 'xml', xhtml: 'xml', rss: 'xml', atom: 'xml', xjb: 'xml', xsd: 'xml', xsl: 'xml', plist: 'xml', wsf: 'xml', svg: 'xml',
  jsp: 'java',
  cs: 'csharp', 'c#': 'csharp',
  cc: 'cpp', 'c++': 'cpp', 'h++': 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', cxx: 'cpp',
  h: 'c',
  golang: 'go',
  rs: 'rust',
  patch: 'diff',
})

const BY_ID = new Map(CODE_LANGUAGES.map((l) => [l.id, l]))

/**
 * The roster id a stored language means, or null when it is none of ours.
 * `py` -> 'python', 'Python' -> 'python', 'pinescript' -> null.
 */
export function canonicalLanguage(language) {
  if (typeof language !== 'string' || !language) return null
  const key = language.toLowerCase()
  if (BY_ID.has(key)) return key
  return Object.prototype.hasOwnProperty.call(CODE_LANGUAGE_ALIASES, key) ? CODE_LANGUAGE_ALIASES[key] : null
}

/** What the picker shows for a stored language. An unknown one is shown as itself —
 *  never silently mapped to "Plain text", which would read as if the member's label
 *  had been thrown away. */
export function languageLabel(language) {
  if (!language) return PLAIN_TEXT_LABEL
  const id = canonicalLanguage(language)
  return id ? BY_ID.get(id).label : String(language)
}

/**
 * The highlighter, loaded ONCE per page, on demand. `load` is a property (not a bare
 * function) so a test can spy on the one door the chunk is fetched through: a note
 * with no code block must never call it.
 */
export const highlighterLoader = {
  load: () => import('./codeHighlight'),
}

let pending = null
let ready = null

/** The loaded lowlight instance, or null while it has not arrived. */
export function loadedHighlighter() {
  return ready
}

/** Start (or join) the one load. Resolves to the lowlight instance; a failed load is
 *  forgotten so the next code block can try again, and code stays plain text. */
export function loadHighlighter() {
  if (ready) return Promise.resolve(ready)
  if (!pending) {
    pending = highlighterLoader.load().then(
      (mod) => { ready = mod.notebookLowlight; return ready },
      (err) => { pending = null; throw err },
    )
  }
  return pending
}
