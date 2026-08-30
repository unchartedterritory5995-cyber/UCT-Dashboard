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
