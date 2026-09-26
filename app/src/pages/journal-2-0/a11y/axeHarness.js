// app/src/pages/journal-2-0/a11y/axeHarness.js
//
// The ONE way a Notebook rail asks axe-core whether a rendered surface is
// accessible (wave 8, lane 8A, item A0). Lanes 8B and 8C use it for their own
// surfaces; nothing here is Notebook-specific except where it lives.
//
//   import { expectNoAxeViolations } from '<relative>/a11y/axeHarness'
//   await expectNoAxeViolations(container)                  // component level
//   await expectNoAxeViolations(container, { level: 'page' })
//
// ⛔ axe-core is a devDependency (ruling D-A1). Only test files import this
// module, so it never reaches `dist`.
//
// WHAT IT RUNS. `axe.run` directly, no wrapper package, over the WCAG tag set
// the 10/10 bar names (2.0 A/AA, 2.1 A/AA, 2.2 AA). Best-practice rules are
// NOT in that set, so they never run here.
//
// ⛔⛔ THE EXCLUSION LIST IS FROZEN (ruling D-A5), and it is the whole risk of
// this file: an exclusion list that can grow is a mute button. It is:
//   · `color-contrast` at BOTH levels. jsdom computes no layout and no
//     cascade, so axe can only answer "incomplete". Contrast is measured by
//     `notebookContrast.test.js` (A5) over the real token values, and in a
//     real browser by the lane's browser check.
//   · `region` and every `landmark-*` rule at COMPONENT level only. A single
//     component rendered alone has no page around it, so "content is not in a
//     landmark" is a statement about the test, not about the product.
// `axeHarness.contract.test.js` pins the list to exactly that set and keeps a
// known-bad fixture that MUST still produce each violation id. Adding an id
// here turns that rail red; so does a harness that stops reporting.
//
// ⚠️ MEASURED, axe-core 4.13.0: `region` and all nine `landmark-*` rules are
// tagged `best-practice`, not WCAG, so under this tag set they do not run at
// either level. Their component-level exclusion is therefore inert today; it
// is kept exactly as ruled so that widening the tag set later cannot switch
// them on for a lone component by accident.
//
// ⛔ axe refuses to run twice at once ("Axe is already running"). Every run is
// chained onto one module-level queue, so two rails in one file (or one rail
// that forgets to await) wait their turn instead of failing each other.
import axe from 'axe-core'

export const WCAG_TAGS = Object.freeze(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])

/** Region + the landmark family, excluded for a lone component only. */
const COMPONENT_ONLY = Object.freeze([
  'region',
  'landmark-banner-is-top-level',
  'landmark-complementary-is-top-level',
  'landmark-contentinfo-is-top-level',
  'landmark-main-is-top-level',
  'landmark-no-duplicate-banner',
  'landmark-no-duplicate-contentinfo',
  'landmark-no-duplicate-main',
  'landmark-one-main',
  'landmark-unique',
])

/** The frozen D-A5 exclusion list, per level. */
export const AXE_EXCLUSIONS = Object.freeze({
  component: Object.freeze(['color-contrast', ...COMPONENT_ONLY]),
  page: Object.freeze(['color-contrast']),
})

export const LEVELS = Object.freeze(Object.keys(AXE_EXCLUSIONS))

let queue = Promise.resolve()

function enqueue(job) {
  const run = queue.then(job, job)
  // The queue itself must never reject, or every later run would inherit a
  // failure that is not its own.
  queue = run.then(() => undefined, () => undefined)
  return run
}

function optionsFor(level) {
  const excluded = AXE_EXCLUSIONS[level]
  if (!excluded) {
    throw new Error(`axeHarness: unknown level "${level}" (expected one of ${LEVELS.join(', ')})`)
  }
  return {
    runOnly: { type: 'tag', values: [...WCAG_TAGS] },
    rules: Object.fromEntries(excluded.map((id) => [id, { enabled: false }])),
    resultTypes: ['violations'],
  }
}

/** Run axe over `container` at `level`. Resolves to axe's own result object. */
export function runAxe(container, { level = 'component' } = {}) {
  if (!container || typeof container !== 'object' || container.nodeType !== 1) {
    // A run over nothing reports nothing, which reads exactly like a pass.
    throw new Error('axeHarness: runAxe needs a rendered element (got ' + String(container) + ')')
  }
  const options = optionsFor(level)
  return enqueue(() => axe.run(container, options))
}

/** One readable block per violation: the rule id, every target selector and
 *  axe's own failure summary, so a red rail names the element. */
export function formatViolations(violations) {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .map((n) => {
          const target = Array.isArray(n.target) ? n.target.join(' ') : String(n.target)
          const summary = String(n.failureSummary || '').replace(/\s+/g, ' ').trim()
          return `    target: ${target}\n    html:   ${String(n.html || '').slice(0, 160)}\n    ${summary}`
        })
        .join('\n')
      return `  [${v.impact || 'n/a'}] ${v.id}: ${v.help}\n${nodes}`
    })
    .join('\n')
}

/** Resolve when axe finds no violation; reject with every violation named. */
export async function expectNoAxeViolations(container, { level = 'component' } = {}) {
  const results = await runAxe(container, { level })
  const { violations } = results
  if (violations.length > 0) {
    throw new Error(
      `axe found ${violations.length} violation(s) at level "${level}":\n${formatViolations(violations)}`,
    )
  }
  return results
}
