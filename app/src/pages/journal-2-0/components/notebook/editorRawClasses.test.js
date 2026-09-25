import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ⛔ A CSS MODULE HASHES EVERY BARE CLASS SELECTOR. Editor nodes write RAW class
// names into the DOM (a DOMOutputSpec's `class:` or a DOM node view's
// `.className =`), so a bare `.uctCalloutIcon` in NoteEditorPage.module.css
// compiles to `._uctCalloutIcon_<hash>` and matches nothing. Measured 2026-09-22
// in the built stylesheet: `._uctToggleChevron_1xnnk_773` and
// `._uctCalloutIcon_1xnnk_725`, while calloutNode.js:71 / toggleNode.js:109 wrote
// the raw names. Callout bodies lost their flex sizing and the Toggle chevron lost
// its 44px touch floor. The names are DERIVED from the node sources, never typed,
// so the next raw class is covered the day it lands.

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB = path.resolve(HERE, '../../lib')
const CSS = fs.readFileSync(path.resolve(HERE, 'NoteEditorPage.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

const RAW_CLASS_RE = /(?:\bclass\s*:\s*|\.className\s*=\s*)['"]([^'"]+)['"]/g

function rawEditorClasses() {
  const out = new Set()
  for (const f of fs.readdirSync(LIB)) {
    if (!/\.(js|jsx)$/.test(f) || /\.test\./.test(f)) continue
    const src = fs.readFileSync(path.join(LIB, f), 'utf8')
    for (const m of src.matchAll(RAW_CLASS_RE)) {
      for (const tok of m[1].split(/\s+/)) if (tok) out.add(tok)
    }
  }
  return out
}

function bareUses(css, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let bare = 0
  for (const m of css.matchAll(new RegExp(`(:global\\(\\s*)?\\.${esc}(?![\\w-])`, 'g'))) {
    if (!m[1]) bare += 1
  }
  return bare
}

describe('raw editor class names are styled through :global()', () => {
  it('reads real node sources (non-vacuity)', () => {
    const names = rawEditorClasses()
    expect(names).toContain('uctCalloutIcon')
    expect(names).toContain('uctToggleChevron')
  })

  it('the checker can see a bare use (control)', () => {
    expect(bareUses('.a .uctX { color: red }', 'uctX')).toBe(1)
    expect(bareUses('.a :global(.uctX) { color: red }', 'uctX')).toBe(0)
    expect(bareUses('.a .uctXY { color: red }', 'uctX')).toBe(0)
  })

  it('no raw editor class appears bare in NoteEditorPage.module.css', () => {
    const offenders = [...rawEditorClasses()].filter((n) => bareUses(CSS, n) > 0).sort()
    expect(offenders).toEqual([])
  })
})
