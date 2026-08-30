// app/src/pages/Dashboard.zones.test.jsx
//
// ⛔ THE INVARIANT: no dashboard tile may be a bare child of the desktop
// container. TileCard sets height:100%, which needs a parent whose height
// is defined. `.desktopOnly` is display:block/height:auto, so a bare tile
// child expands without limit — SectorRotation did exactly this and ate
// 2,714px (47% of the page). jsdom computes no layout, so this rail asserts
// STRUCTURE, not pixels; the pixel rail lives in tools/mobile_audit.py.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { test, expect } from 'vitest'

// `new URL('./Dashboard.jsx', import.meta.url)` throws "The URL must be of
// scheme file" under this repo's Windows vitest setup — fileURLToPath +
// join is the established pattern (see AlertBell.delivery.test.jsx).
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'Dashboard.jsx'), 'utf8')

test('no tile component is rendered as a bare child of desktopOnly', () => {
  const block = src.split('styles.desktopOnly')[1]?.split('styles.mobileOnly')[0] ?? ''
  // A bare self-closing component at the container's own indent level (10
  // spaces inside .desktopOnly) is the defect shape.
  const bare = [...block.matchAll(/^ {10}<([A-Z]\w+)\s*\/>/gm)].map(m => m[1])
  expect(bare).toEqual([])
})
