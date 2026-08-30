// app/src/pages/Dashboard.zones.test.jsx
//
// ⛔ THE INVARIANT: no dashboard tile may be a bare child of the desktop
// container. TileCard sets height:100%, which needs a parent whose height is
// defined. `.desktopOnly` is display:block/height:auto, so a bare tile child
// expands without limit — SectorRotation did exactly this and ate 2,714px
// (47% of the page). jsdom computes no layout, so this rail asserts STRUCTURE,
// not pixels; the pixel rail lives in tools/mobile_audit.py.
//
// ⭐ AN AST NOW, NOT A REGEX — the hardening the task-3 review deferred to
// "when Task 13 rewrites Dashboard.jsx". The old check was
// `/^ {10}<([A-Z]\w+)\s*\/>/gm`, which encoded THREE incidental facts about
// the old file: that the container's children sit at exactly ten spaces, that
// a mount is written on one line, and that it is self-closing. The cockpit
// rewrite changes the indent, so that regex would have gone permanently,
// silently GREEN — a rail that passes because it can no longer see its subject
// (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). The AST asks the
// real question instead: is every DIRECT child of `.desktopOnly` a host
// element (a `<div>`/`<aside>` that supplies a height track), or a component?
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { test, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

// `new URL('./Dashboard.jsx', import.meta.url)` throws "The URL must be of
// scheme file" under this repo's Windows vitest setup — fileURLToPath +
// join is the established pattern (see AlertBell.delivery.test.jsx).
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'Dashboard.jsx'), 'utf8')

const parse = (s) => Parser.extend(jsx()).parse(s, {
  ecmaVersion: 'latest', sourceType: 'module',
})

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return }
  if (typeof node.type === 'string') visit(node)
  for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, visit)
}

const tagOf = (el) => {
  const n = el?.openingElement?.name
  if (!n) return null
  if (n.type === 'JSXIdentifier') return n.name
  if (n.type === 'JSXMemberExpression') return `${n.object?.name}.${n.property?.name}`
  return null
}

/** Does this opening element carry `className={styles.<name>}`? */
function hasStyleClass(el, name) {
  return (el.openingElement?.attributes || []).some((a) => (
    a.type === 'JSXAttribute'
    && a.name?.name === 'className'
    && a.value?.type === 'JSXExpressionContainer'
    && a.value.expression?.type === 'MemberExpression'
    && a.value.expression.object?.name === 'styles'
    && a.value.expression.property?.name === name
  ))
}

/**
 * Every DIRECT child element of `<div className={styles.<container>}>`, by tag.
 * Exported so the control below can run it against a synthetic source and
 * prove it actually flags the defect shape.
 */
export function directChildTags(source, container) {
  const out = { found: false, tags: [] }
  walk(parse(source), (n) => {
    if (n.type !== 'JSXElement' || !hasStyleClass(n, container)) return
    out.found = true
    out.tags = (n.children || [])
      .filter((c) => c.type === 'JSXElement')
      .map(tagOf)
  })
  return out
}

/** A component is a capitalised (or dotted) tag; a host element is lowercase. */
const isComponent = (t) => typeof t === 'string' && /^[A-Z]/.test(t)

test('the rail can see its subject — .desktopOnly is found and has children', () => {
  // ⛔ THE VACUITY GUARD. The old regex silently stopped matching when the
  // file was reformatted; this asserts the container was located at all and
  // that it is not empty, so "no bare component children" cannot be true
  // because nothing was examined.
  const { found, tags } = directChildTags(src, 'desktopOnly')
  expect(found, 'Dashboard.jsx no longer has a <div className={styles.desktopOnly}> '
    + '— this rail is measuring nothing').toBe(true)
  expect(tags.length, '.desktopOnly renders no child elements').toBeGreaterThan(0)
})

test('no tile component is rendered as a bare child of desktopOnly', () => {
  const { tags } = directChildTags(src, 'desktopOnly')
  expect(tags.filter(isComponent),
    'these components are DIRECT children of .desktopOnly, which is '
    + 'display:block/height:auto — a TileCard\'s height:100% resolves against '
    + 'nothing there and expands without limit. Wrap each one in a zone div '
    + 'that declares a height track.').toEqual([])
})

test('and the same holds inside the cockpit\'s zone column', () => {
  // The zones live one level deeper than the old rows did, so the invariant
  // has to follow them: `.main` is the grid that owns 120/440/300, and a bare
  // component there would resolve its height against a track it does not own.
  const { found, tags } = directChildTags(src, 'main')
  expect(found, 'the cockpit no longer renders <div className={styles.main}>').toBe(true)
  expect(tags.filter(isComponent)).toEqual([])
})

test('CONTROL: the checker really does flag a bare component child', () => {
  // Without this, every assertion above would be satisfied by a checker that
  // returns [] for any input at all.
  const planted = `
    import styles from './x.module.css'
    export default function X() {
      return (
        <div className={styles.desktopOnly}>
          <SectorRotation />
          <div className={styles.zoneA}><FuturesStrip /></div>
        </div>
      )
    }
  `
  const { found, tags } = directChildTags(planted, 'desktopOnly')
  expect(found).toBe(true)
  expect(tags.filter(isComponent)).toEqual(['SectorRotation'])
  // …and the correctly-wrapped sibling is NOT flagged, so the checker is not
  // simply reporting every component it can see.
  expect(tags).toEqual(['SectorRotation', 'div'])
})

test('CONTROL: a mount split across lines is caught too — the old regex missed it', () => {
  const planted = `
    import styles from './x.module.css'
    export default function X() {
      return (
        <div className={styles.desktopOnly}>
          <DeskVideoRail
            variant="wide"
          />
        </div>
      )
    }
  `
  expect(directChildTags(planted, 'desktopOnly').tags.filter(isComponent))
    .toEqual(['DeskVideoRail'])
})

// ─── THE HEIGHT BUDGET, AS A SOURCE RAIL ────────────────────────────────────
//
// ⛔ jsdom COMPUTES NO LAYOUT, so none of this can measure pixels — the pixel
// rail is tools/mobile_audit.py. What it CAN measure is the two structural
// properties the budget depends on, both of which were real defects:
//
//   I1  `.rail` had a 240px WIDTH and no height bound. `.cockpit`'s row was
//       implicit and auto-sized, so it resolved to max(.main, .rail) and
//       `.rail > * { max-height: 100% }` computed to `none` against an
//       indefinite parent — the "no track to resolve against" shape, in the
//       change that fixed it. An EXPLICIT cockpit row is the fix.
//   I2  `.zoneB:empty { display: none }` did not do what its comment claimed:
//       `.main`'s three FIXED tracks survive the item, so Zone C auto-placed
//       into the 440px track and a 300px void sat at the bottom.
//
// And one property that keeps the numbers honest: each zone height is WRITTEN
// ONCE and everything else derives from it by calc().
// ⛔ COMMENTS STRIPPED BEFORE MATCHING. The header below deliberately QUOTES the
// old `.zoneB:empty { display: none }` rule in its ⚰️ note, and the first draft
// of this rail matched that prose and reported the deleted rule as still live —
// `lesson_probe_names_must_be_derived_not_typed`, in miniature.
const cssRaw = readFileSync(join(here, 'Dashboard.module.css'), 'utf8')
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '')

// ⛔ `String.raw`, NOT A PLAIN TEMPLATE LITERAL. The first cut of these helpers
// interpolated into a bare `` `${name}\s*:\s*...` ``, where the escape is eaten
// before RegExp ever sees it: the compiled source was `--zone-as*:s*([^;]+);`,
// which passed only because `s*` can match empty — and it then matched
// whitespace EXACTLY, so a Prettier run would have reddened this rail with no
// defect present. Same escape family as the word-boundary-became-a-backspace
// bug fixed in 23f13b23b. The control below fails on that shape.
const declRe = (name) => new RegExp(String.raw`${name}\s*:\s*([^;]+);`, 'g')
const gridRowRe = (cls, row) => new RegExp(String.raw`\.${cls}\s*\{\s*grid-row:\s*${row}\s*;\s*\}`)

test('CONTROL: the rail’s own regexes survived their escapes', () => {
  // If `\s` decayed to a literal `s`, neither of these reformatted snippets
  // matches — which is exactly how the broken version would have gone red on a
  // formatting change instead of on a real defect.
  // ⛔ `String.raw`, NOT `'\s'`. In a plain single-quoted string `'\s'` IS
  // `'s'`, so the first cut of this very line passed against the FIXED and the
  // BROKEN source alike — the escape-eating bug, inside the assertion that
  // names it.
  expect(declRe('--zone-a').source).toContain(String.raw`\s`)
  expect([...'  --zone-a :  120px;'.matchAll(declRe('--zone-a'))]).toHaveLength(1)
  expect(gridRowRe('zoneA', 1).test('.zoneA {\n  grid-row: 1;\n}')).toBe(true)
  // …and it still discriminates: a different row number must NOT match.
  expect(gridRowRe('zoneA', 2).test('.zoneA { grid-row: 1; }')).toBe(false)
})

test('each zone height is declared exactly once, as a custom property', () => {
  for (const [name, px] of [['--zone-a', '120px'], ['--zone-b', '440px'],
    ['--zone-c', '300px'], ['--zone-d', '90px']]) {
    const decls = [...css.matchAll(declRe(name))].map(m => m[1].trim())
    // The property may be REDECLARED to collapse a zone (see the :has rule),
    // but the real height literal must appear exactly once.
    expect(decls.filter(v => v === px),
      `${name} is not declared exactly once as ${px} — a second copy is a second `
      + 'authority over the budget').toHaveLength(1)
  }
})

test('the cockpit row is DERIVED from the zone heights, never a typed sum', () => {
  const m = css.match(/--zone-stack:\s*([^;]+);/)
  expect(m, '--zone-stack is gone; the cockpit row has no derived height').toBeTruthy()
  const expr = m[1]
  for (const name of ['--zone-a', '--zone-b', '--zone-c']) {
    expect(expr, `--zone-stack does not read ${name}`).toContain(name)
  }
  // A hand-summed 860px would not track a change to any zone.
  // ⚠️ A word boundary typed through a heredoc became a literal BACKSPACE
  // byte here (0x08) and src/__tests__/sourcesAreText.test.js caught it: the
  // file read as BINARY to git and ripgrep. This pattern needs no boundary.
  expect(expr, 'a literal pixel sum crept into --zone-stack').not.toMatch(/\d{3,}px/)
})

test('I1: the cockpit declares an EXPLICIT row, so the rail has a height to resolve against', () => {
  const cockpit = css.split('.cockpit {')[1]?.split('}')[0] ?? ''
  expect(cockpit, '.cockpit no longer declares an explicit row, so its single row '
    + 'is auto-sized to max(.main, .rail) again and the rail is unbounded')
    .toContain('grid-template-rows: var(--zone-stack)')
  // …and the rail is still capped against it.
  expect(css).toMatch(/\.zoneB > \*, \.zoneC > \*, \.rail > \* \{[^}]*max-height: 100%/)
})

test('I2: an empty Zone B COLLAPSES ITS TRACK — and the false display:none rule is gone', () => {
  expect(css, 'the old `.zoneB:empty { display: none }` is back — it hides the item '
    + 'and leaves the 440px track standing, which is the defect it claimed to fix')
    .not.toMatch(/\.zoneB:empty\s*\{\s*display:\s*none/)
  const has = css.match(/\.desktopOnly:has\(\.zoneB:empty\)\s*\{([^}]*)\}/)
  expect(has, 'nothing collapses the Zone B track when the hero renders null').toBeTruthy()
  expect(has[1]).toContain('--zone-b')
})

test('ALL FOUR zones are inside the height invariant — Zone D included', () => {
  // 🔴 Zone D used to be outside it: `.zoneD` declared only a margin, and its
  // 90px lived in ZoneDoors.module.css with no `overflow` — so the one zone
  // whose content is variable-width labels was the one nothing bounded, on a
  // page with ~45px of headroom. A wrapping door label was what would have
  // eaten it.
  const zoneD = css.split('.zoneD {')[1]?.split('}')[0] ?? ''
  expect(zoneD, '.zoneD is gone').not.toBe('')
  expect(zoneD, '.zoneD declares no height cap').toMatch(/max-height:\s*var\(--zone-d\)/)
  expect(zoneD, '.zoneD does not clip, so a wrapping door label grows the page')
    .toMatch(/overflow:\s*hidden/)
})

test('and Zone D height is not restated in ZoneDoors.module.css', () => {
  // The copy that made it a second authority over one number.
  const doors = readFileSync(join(here, 'dashboard', 'ZoneDoors.module.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  expect(doors, 'ZoneDoors.module.css caps its own height again — that number now '
    + 'lives once, as --zone-d').not.toMatch(/max-height:\s*90px/)
})

test('each zone owns an explicit grid row, so hiding one never shifts the others', () => {
  for (const [cls, row] of [['zoneA', 1], ['zoneB', 2], ['zoneC', 3]]) {
    expect(css, `.${cls} no longer owns grid-row ${row}`).toMatch(gridRowRe(cls, row))
  }
})
