import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'

/**
 * The notebook's prose typography must not reach inside a widget embed.
 *
 * A widget embed is a TipTap node view that mounts a whole app component —
 * a chart, a scanner, a calendar — inside the editor. `.proseEditor table`
 * once landed on Lightweight-Charts' internal layout <table>, pushing the
 * chart 14px down inside its own overflow:hidden box (and `td {border:1px}`
 * growing it 4px past the bottom), which clipped 18px of the 29px time axis:
 * the date/time strip under every notebook chart read half-cut.
 *
 * ⛔ THE SELECTOR LIST IS DERIVED FROM THE STYLESHEET, NEVER TYPED HERE.
 * A rail that repeats the element names it guards is a second authority over
 * them, and goes stale the day someone adds `.proseEditor figure`.
 */

// vitest runs from `app/` (never `--root app`); readFileSync throws loudly
// rather than handing the derivation an empty stylesheet.
const CSS_PATH = resolve(
  process.cwd(), 'src/pages/journal-2-0/components/notebook/NoteEditorPage.module.css',
)
const CSS = readFileSync(CSS_PATH, 'utf8')

const GUARD = ':not(:where([data-widget-embed-view] *))'
const PROSE = '.proseEditor'
// Descendant / child / adjacent / general-sibling — the combinators that split
// a selector into compounds.
const COMBINATORS = /\s*[>+~]\s*|\s+/

/** Every selector in the file that is scoped to the prose editor. */
function proseSelectors() {
  const out = []
  postcss.parse(CSS).walkRules((rule) => {
    for (const sel of rule.selectors) {
      const s = sel.trim()
      // Pseudo-ELEMENTS and CSS-Modules :global() are not parseable by the
      // DOM matcher; neither can address an embed's internals anyway.
      if (!s.startsWith(`${PROSE} `) || s.includes('::') || s.includes(':global')) continue
      out.push(s)
    }
  })
  return out
}

/**
 * Blank out every parenthesised pseudo-class argument, keeping the selector's
 * compound/combinator skeleton. ⛔ Do NOT shortcut this by stripping the exact
 * GUARD string: the guard contains a space and a `[`, so ANY variant spelling
 * would survive into the compound split, look "pinned", and be silently
 * exempted — the rail would then pass on the very rule it exists to check.
 * (A mutation writing an over-broad guard did exactly that.)
 */
function stripPseudoArgs(sel) {
  let out = ''
  let depth = 0
  for (const ch of sel) {
    if (ch === '(') { depth += 1; continue }
    if (ch === ')') { depth = Math.max(0, depth - 1); continue }
    if (depth === 0) out += ch
  }
  return out
}

/** The compounds after `.proseEditor`, pseudo-class arguments removed. */
function tail(sel) {
  return stripPseudoArgs(sel)
    .slice(PROSE.length)
    .trim()
    .split(COMBINATORS)
    .filter(Boolean)
}

/** A compound pinned to prose-authored markup (`[data-type=…]`, a class, an id). */
const isPinned = (compound) => /[[.#]/.test(compound)

/** The bare element type a compound selects, or null if it is qualified. */
function bareTag(compound) {
  // `h1`, and `p:not` / `li:first-child` once the arguments are stripped.
  const m = /^([a-z][a-z0-9]*)(:[a-z-]+)*$/i.exec(compound)
  return m ? m[1] : null
}

/**
 * Selectors that can reach ANY markup under the editor — a bare element type
 * as the subject, with nothing in the chain pinning it to prose-authored
 * nodes. These are the ones an embed's internals are exposed to.
 *   `.proseEditor table`          → reaches everything  → must be guarded
 *   `.proseEditor table td`       → reaches everything  → must be guarded
 *   `.proseEditor ul[data-type="taskList"] li` → pinned → exempt
 *   `.proseEditor a[data-type="attachmentChip"]` → qualified subject → exempt
 */
function reachingSelectors() {
  return proseSelectors().filter((sel) => {
    const compounds = tail(sel)
    if (!compounds.length) return false
    if (compounds.some(isPinned)) return false
    return bareTag(compounds[compounds.length - 1]) !== null
  })
}

function mountProbe() {
  const editor = document.createElement('div')
  editor.className = 'proseEditor'
  const frame = document.createElement('div')
  frame.setAttribute('data-widget-embed-view', 'chart')
  editor.appendChild(frame)
  document.body.appendChild(editor)
  return { editor, frame, cleanup: () => editor.remove() }
}

describe('notebook prose typography stops at a widget embed', () => {
  it('has reaching selectors to guard (the probe is not vacuous)', () => {
    // If this ever hits zero, every assertion below passes for the wrong
    // reason — the derivation broke, not the stylesheet.
    expect(reachingSelectors().length).toBeGreaterThan(5)
  })

  it('leaves prose styled and embeds untouched, element by element', () => {
    const selectors = reachingSelectors()
    const tags = [...new Set(selectors.map((s) => bareTag(tail(s).at(-1))))]
    const { editor, frame, cleanup } = mountProbe()
    const styledProse = []
    const leaked = []
    try {
      for (const tag of tags) {
        const inProse = editor.insertBefore(document.createElement(tag), frame)
        const inEmbed = frame.appendChild(document.createElement(tag))
        for (const sel of selectors) {
          // CONTROL: the rule must still reach ordinary prose. Without this the
          // suite would go green on a stylesheet that simply deleted the rules.
          if (inProse.matches(sel)) styledProse.push(tag)
          if (inEmbed.matches(sel)) leaked.push(`${tag} ← ${sel}`)
        }
      }
    } finally {
      cleanup()
    }
    // Names, not counts — a bare number here can't say WHICH element leaked.
    expect(leaked).toEqual([])
    expect([...new Set(styledProse)].sort()).toEqual([...tags].sort())
  })

  it('carries the guard on every reaching selector', () => {
    // The behavioural check above only probes an element sitting directly
    // inside the embed frame. This one is structural, so a rule that needs an
    // ancestor the probe does not build still cannot ship unguarded.
    const missing = reachingSelectors().filter((sel) => !sel.includes(GUARD))
    expect(missing).toEqual([])
  })
})
