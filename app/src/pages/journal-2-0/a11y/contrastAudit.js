// app/src/pages/journal-2-0/a11y/contrastAudit.js
//
// A5: every colour pair the Notebook's stylesheets actually declare, measured
// in all three themes (wave 8, lane 8A). Test support; the rail is
// notebookContrast.test.js and the table in docs/notebook/accessibility-
// contrast.md is written from the same rows. ONE formula: contrastMath.js.
//
// What becomes a pair, per rule (comments stripped, the set derived by
// cssAudit.deriveNotebookCss):
//   · TEXT  — the rule's `color` against its own `background(-color)`; a rule
//     with no background of its own against --bg, --bg-surface AND
//     --bg-elevated (it can sit on any of them). A translucent background is
//     composited onto each of those first; a translucent text colour onto the
//     background it sits on. Bar 4.5:1, or 3:1 for large text (>= 24px, or
//     >= 18.66px at weight 700+), read from the SAME rule's font-size/weight.
//   · UI    — non-text contrast, bar 3:1 against the page surfaces: a focus
//     indicator's colour (outline / box-shadow / border in a :focus or
//     :focus-visible rule), an input's border (a rule whose target is an
//     input, select, textarea or a class named for one), and the graph's
//     keyboard selection ring (NoteGraphView `.canvas` colour against its
//     `.canvasWrap` background).
// A keyword colour (inherit, currentColor, transparent, …) is not a pair and
// is COUNTED as such, never dropped. A value the audit cannot resolve is a
// failing row that names the token.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contrast } from '../../../styles/__tests__/contrastMath'
import { J2_DIR } from './population'
import {
  deriveNotebookCss, parseRules, declarations, themeVars, resolveVars,
  parseColor, colorsIn, opaque, THEMES, SURFACES,
} from './cssAudit'

export const BARS = Object.freeze({ text: 4.5, large: 3, ui: 3 })

/**
 * Rules that do not sit on the page. Each is measured against its own
 * translucent background composited over BLACK and over WHITE -- the two
 * extremes of the picture underneath -- instead of the page surfaces, which
 * are not what a member sees behind it. One reason each; a rule named here
 * that no longer exists fails the rail.
 */
export const CONTEXTS = Object.freeze({
  'components/notebook/HeroImagePicker.module.css .iconBtn':
    "Replace / Remove buttons drawn over the note's hero IMAGE",
  'components/notebook/HeroImagePicker.module.css .dropHint':
    'the "drop to replace" hint drawn over the hero IMAGE while a file is dragged',
  'components/notebook/WidgetEmbedView.module.css .asOfChip':
    'the as-of date drawn over a chart SNAPSHOT (its time-axis corner)',
})

/** Stylesheets another lane owns this wave. A failure in one of them that a
 *  Notebook-CSS token switch would fix is that lane's to make; the rail lists
 *  it in OTHER_LANES (notebookContrast.test.js) instead of editing it here. */
export const LANE_OWNED = Object.freeze({
  'components/notebook/NoteExportControls.module.css': '8C',
  'components/notebook/export/ExportDialog.module.css': '8C',
  'components/notebook/ResearchHome.module.css': '8C',
  'components/notebook/onboarding/NotebookTour.module.css': '8C',
  'components/notebook/NoteShareControls.module.css': '8B',
  'components/SharingCard.module.css': '8B',
  'SharedNotePage.module.css': '8B',
})

const BLACK = [0, 0, 0]
const WHITE = [255, 255, 255]
const oneLine = (sel) => sel.replace(/\s+/g, ' ')

const KEYWORD = /^(inherit|currentcolor|initial|unset|revert|transparent|none)$/i

function px(value, vars) {
  if (!value) return null
  const v = resolveVars(value, vars).trim()
  let m = /^([\d.]+)px$/.exec(v)
  if (m) return Number(m[1])
  m = /^([\d.]+)rem$/.exec(v)
  if (m) return Number(m[1]) * 16
  return null
}

const last = (decls, ...props) => [...decls].reverse().find((d) => props.includes(d.prop)) || null

function isLargeText(decls, vars) {
  const size = px(last(decls, 'font-size')?.value, vars)
  const weight = last(decls, 'font-weight')?.value || ''
  const bold = /bold/.test(weight) || Number(weight) >= 700
  return size != null && (size >= 24 || (size >= 18.66 && bold))
}

/** The surfaces a rule can sit on, per theme: its own background (composited
 *  onto each page surface when translucent), else the three page surfaces.
 *  `overImage`: composited onto black and white instead (see CONTEXTS). */
function surfacesFor(bgDecl, vars, overImage = false) {
  const page = overImage
    ? [{ name: 'a black image', rgb: BLACK }, { name: 'a white image', rgb: WHITE }]
    : SURFACES.map((s) => ({ name: s, rgb: parseColor(resolveVars(`var(${s})`, vars)).rgb }))
  if (!bgDecl) return page
  const resolved = resolveVars(bgDecl.value, vars)
  if (KEYWORD.test(resolved.trim())) return page
  const colours = colorsIn(resolved).map(parseColor).filter((c) => c.alpha > 0)
  if (!colours.length) return page // an image with no colour: the page shows through
  const out = []
  for (const c of colours) {
    if (c.alpha >= 1) out.push({ name: bgDecl.value, rgb: c.rgb })
    else for (const p of page) out.push({ name: `${bgDecl.value} over ${p.name}`, rgb: opaque(c, p.rgb) })
  }
  return out
}

/** Worst ratio of one foreground value against a set of surfaces. */
function worstRatio(fgValue, surfaces, vars) {
  const resolved = resolveVars(fgValue, vars)
  const colours = colorsIn(resolved).map(parseColor).filter((c) => c.alpha > 0)
  if (!colours.length) throw new Error(`no colour in "${fgValue}" (resolved "${resolved}")`)
  let worst = { ratio: Infinity, on: '' }
  for (const c of colours) {
    for (const s of surfaces) {
      const ratio = contrast(opaque(c, s.rgb), s.rgb)
      if (ratio < worst.ratio) worst = { ratio, on: s.name }
    }
  }
  return worst
}

const INPUTISH = /(^|[\s>+~])(input|select|textarea)\b|\.[A-Za-z0-9_-]*(input|Input|field|Field|select|Select|textarea|Textarea)\b/
const targetOf = (part) => part.trim().split(/[\s>+~]+/).pop() || ''

/** Every measured row for one stylesheet. */
export function auditFile(rel, allVars = themeVars()) {
  const css = readFileSync(join(J2_DIR, rel), 'utf8')
  const rows = []
  const push = (r, kind, prop, value, fn) => {
    const row = { file: rel, line: r.line, selector: r.selector.replace(/\s+/g, ' '), kind, prop, value, themes: {} }
    for (const theme of THEMES) {
      try {
        const out = fn(allVars[theme])
        row.themes[theme] = out
      } catch (e) {
        row.themes[theme] = { error: e.message }
      }
    }
    rows.push(row)
  }

  for (const r of parseRules(css)) {
    const decls = declarations(r)
    const bg = last(decls, 'background', 'background-color')
    const parts = r.selector.split(',')
    const overImage = Object.hasOwn(CONTEXTS, `${rel} ${oneLine(r.selector)}`)

    // TEXT
    const fg = last(decls, 'color')
    if (fg) {
      if (KEYWORD.test(fg.value.trim())) {
        rows.push({ file: rel, line: r.line, selector: r.selector.replace(/\s+/g, ' '), kind: 'keyword', prop: 'color', value: fg.value, themes: {} })
      } else {
        push(r, 'text', 'color', fg.value, (v) => {
          const large = isLargeText(decls, v)
          const w = worstRatio(fg.value, surfacesFor(bg, v, overImage), v)
          return { ratio: w.ratio, on: w.on, bar: large ? BARS.large : BARS.text, large }
        })
      }
    }

    // UI: a focus indicator -- ONE row per rule. A rule that draws focus with a
    // gold border AND a faint glow is visible through the border, so the rule
    // is judged by its BEST indicator (the focus-suppression rail's reading),
    // each indicator measured at its worst surface.
    const isFocus = parts.some((p) => /:focus(-visible|-within)?\b/.test(p) && !/:focus:not\(:focus-visible\)/.test(p))
    if (isFocus) {
      const indicators = decls.filter((d) => ['outline', 'outline-color', 'box-shadow', 'border', 'border-color'].includes(d.prop)
        && !/^(none|0)$/.test(d.value.trim())
        && THEMES.some((t) => { try { return colorsIn(resolveVars(d.value, allVars[t])).length > 0 } catch { return true } }))
      if (indicators.length) {
        push(r, 'ui-focus', indicators.map((d) => d.prop).join('+'), indicators.map((d) => d.value).join(' | '), (v) => {
          let best = null
          for (const d of indicators) {
            const w = worstRatio(d.value, surfacesFor(null, v), v)
            if (!best || w.ratio > best.ratio) best = { ...w, via: d.prop }
          }
          return { ratio: best.ratio, on: `${best.on} (via ${best.via})`, bar: BARS.ui }
        })
      }
    }

    // UI: an input's border (its resting state; focus rules are measured above)
    if (!isFocus && parts.some((p) => INPUTISH.test(targetOf(p)) && !/:(hover|disabled|placeholder)/.test(p))) {
      for (const d of decls) {
        if (!['border', 'border-color', 'border-bottom', 'border-bottom-color'].includes(d.prop)) continue
        if (/^(none|0)$/.test(d.value.trim())) continue
        const hasColour = (v) => colorsIn(resolveVars(d.value, v)).some((c) => parseColor(c).alpha > 0)
        if (!THEMES.some((t) => { try { return hasColour(allVars[t]) } catch { return true } })) continue
        push(r, 'ui-input-border', d.prop, d.value, (v) => {
          const w = worstRatio(d.value, surfacesFor(null, v), v)
          return { ratio: w.ratio, on: w.on, bar: BARS.ui }
        })
      }
    }
  }
  return rows
}

/** The graph's keyboard selection ring: `.canvas` colour against the
 *  `.canvasWrap` background it is drawn on (NoteGraphView reads the colour
 *  with getComputedStyle). Both values are READ from the stylesheet. */
export function graphRingRow(allVars = themeVars()) {
  const rel = 'components/notebook/NoteGraphView.module.css'
  const rules = parseRules(readFileSync(join(J2_DIR, rel), 'utf8'))
  const find = (sel, prop) => {
    const r = rules.find((x) => x.selector === sel)
    const d = r && last(declarations(r), prop)
    if (!d) throw new Error(`${rel}: no ${prop} on ${sel}`)
    return { r, d }
  }
  const ring = find('.canvas', 'color')
  const wrap = find('.canvasWrap', 'background')
  const row = { file: rel, line: ring.r.line, selector: '.canvas (ring) on .canvasWrap', kind: 'ui-graph-ring', prop: 'color', value: ring.d.value, themes: {} }
  for (const theme of THEMES) {
    const v = allVars[theme]
    try {
      const w = worstRatio(ring.d.value, surfacesFor(wrap.d, v), v)
      row.themes[theme] = { ratio: w.ratio, on: w.on, bar: BARS.ui }
    } catch (e) {
      row.themes[theme] = { error: e.message }
    }
  }
  return row
}

/** Every row across the derived Notebook stylesheet set, plus the ring. */
export function auditNotebook() {
  const vars = themeVars()
  const files = deriveNotebookCss()
  const rows = files.flatMap((f) => auditFile(f, vars))
  rows.push(graphRingRow(vars))
  return { files, rows }
}

export const pairKey = (row) => `${row.file} ${row.selector} [${row.kind} ${row.prop}]`

/** A literal colour on the `color` property (G-104 said none remain). */
export function literalTextColours(files = deriveNotebookCss()) {
  const out = []
  for (const rel of files) {
    const css = readFileSync(join(J2_DIR, rel), 'utf8')
    for (const r of parseRules(css)) {
      for (const d of declarations(r)) {
        // A var() FALLBACK is not the colour -- the token always resolves. The
        // literal that counts is the one standing outside every var().
        const bare = d.value.replace(/var\((?:[^()]|\([^()]*\))*\)/g, '')
        if (d.prop === 'color' && /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(bare)) out.push(`${rel}:${d.line} ${r.selector.replace(/\s+/g, ' ')} { color: ${d.value} }`)
      }
    }
  }
  return out
}
