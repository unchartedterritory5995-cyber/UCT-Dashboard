// app/src/pages/terminal/a11y/terminalA11yStatic.test.js
//
// RAIL: the terminal's own markup and stylesheets keep the accessibility floor the 2026-10-06
// audit set (docs/terminal-research/14-visual/a11y-audit-2026-10-06.md). Static by necessity —
// jsdom performs no layout — and DERIVED: every .jsx / .css under pages/terminal and
// components/terminal is walked each run, so a panel added tomorrow is covered the day it lands.
//
//   1. every <table> has an accessible name (aria-label / aria-labelledby / <caption>);
//   2. every <svg> is either a named image (role="img" + aria-label) or aria-hidden;
//   3. no aria-label sits on a bare <span>/<div> (generic role: screen readers drop the name);
//   4. every class a stylesheet makes clickable (cursor: pointer) is a 44px finger target at
//      phone AND tablet width (<=1024px is touch in this repo — styles/tapFloor.test.js).
//
// ⛔ Necessary, not sufficient: this reads source, not the accessibility tree. The behavioural
// rails (TerminalShell.*.test.jsx, the panel tests) and a real screen reader remain the truth.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SRC = join(process.cwd(), 'src')
const ROOTS = [join(SRC, 'pages', 'terminal'), join(SRC, 'components', 'terminal')]
const posix = (p) => relative(SRC, p).split(sep).join('/')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const FILES = ROOTS.flatMap((r) => walk(r)).filter((f) => !/\.test\.|__tests__|__fixtures__/.test(f))
const JSX = FILES.filter((f) => f.endsWith('.jsx'))
const CSS = FILES.filter((f) => f.endsWith('.css'))

/** Every opening tag `<name …>` in `src`, braces respected (a `>` inside `{…}` is not the end). */
function openingTags(src, name) {
  const out = []
  const re = new RegExp(`<${name}\\b`, 'g')
  let m
  while ((m = re.exec(src))) {
    let depth = 0
    let i = m.index + name.length + 1
    for (; i < src.length; i += 1) {
      const ch = src[i]
      if (ch === '{') depth += 1
      else if (ch === '}') depth -= 1
      else if (ch === '>' && depth === 0) break
    }
    out.push({ tag: src.slice(m.index, i + 1), at: src.slice(0, m.index).split('\n').length, end: i + 1 })
  }
  return out
}

const hasAttr = (tag, attr) => new RegExp(`\\s${attr}=`).test(tag)

function tableOffenders(file, src) {
  return openingTags(src, 'table')
    .filter(({ tag, end }) => !hasAttr(tag, 'aria-label') && !hasAttr(tag, 'aria-labelledby')
      && !/^\s*<caption\b/.test(src.slice(end)))
    .map(({ at }) => `${file}:${at}`)
}

function svgOffenders(file, src) {
  return openingTags(src, 'svg')
    .filter(({ tag }) => !(/\srole="img"/.test(tag) && hasAttr(tag, 'aria-label')) && !/\saria-hidden=/.test(tag))
    .map(({ at }) => `${file}:${at}`)
}

function genericLabelOffenders(file, src) {
  return ['span', 'div'].flatMap((n) => openingTags(src, n))
    .filter(({ tag }) => hasAttr(tag, 'aria-label') && !hasAttr(tag, 'role'))
    .map(({ at }) => `${file}:${at}`)
}

// ── CSS: clickable classes vs the touch floor ────────────────────────────────────────────

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** Bodies of the @media blocks that APPLY at `width` (same semantics as tapFloor.test.js). */
function mediaBodies(css, width) {
  const out = []
  const re = /@media([^{]+)\{/g
  let m
  while ((m = re.exec(css))) {
    const max = /max-width:\s*(\d+)px/.exec(m[1])
    const min = /min-width:\s*(\d+)px/.exec(m[1])
    let depth = 1
    let i = re.lastIndex
    while (i < css.length && depth) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
      i += 1
    }
    if ((!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))) out.push(css.slice(re.lastIndex, i - 1))
  }
  return out.join('\n')
}
const withoutMedia = (css) => css.replace(/@media[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, '')

/** Last class of each selector part in rules whose body matches `pred`. */
function classesWhere(text, pred) {
  const found = new Set()
  const rule = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = rule.exec(text))) {
    if (!pred(m[2])) continue
    for (const part of m[1].split(',')) {
      if (/:(hover|focus|active|focus-visible|disabled)/.test(part)) continue
      const classes = part.match(/\.[A-Za-z][A-Za-z0-9_-]*/g)
      if (classes) found.add(classes[classes.length - 1])
    }
  }
  return found
}

const isTapFloor = (body) => /min-height:\s*var\(--tap-min/.test(body) || /(^|[^-])height:\s*var\(--tap-min/.test(body)

function clickableWithoutFloor(cssText) {
  const css = stripComments(cssText)
  const clickable = classesWhere(withoutMedia(css), (b) => /cursor:\s*pointer/.test(b))
  const base = classesWhere(withoutMedia(css), isTapFloor)
  const out = []
  for (const width of [390, 820]) {
    const floored = classesWhere(mediaBodies(css, width), isTapFloor)
    for (const c of clickable) if (!base.has(c) && !floored.has(c)) out.push(`${c}@${width}`)
  }
  return out.sort()
}

describe('terminal markup — names and roles', () => {
  it('walks real files (non-vacuity)', () => {
    expect(JSX.map(posix)).toContain('pages/terminal/TerminalShell.jsx')
    expect(JSX.map(posix)).toContain('pages/terminal/panels/MoversPanel.jsx')
    const tables = JSX.flatMap((f) => openingTags(readFileSync(f, 'utf8'), 'table'))
    expect(tables.length).toBeGreaterThanOrEqual(6)
  })

  it('every <table> has an accessible name', () => {
    expect(JSX.flatMap((f) => tableOffenders(posix(f), readFileSync(f, 'utf8')))).toEqual([])
  })

  it('every <svg> is a named image or hidden', () => {
    expect(JSX.flatMap((f) => svgOffenders(posix(f), readFileSync(f, 'utf8')))).toEqual([])
  })

  it('no aria-label on a bare <span>/<div>', () => {
    expect(JSX.flatMap((f) => genericLabelOffenders(posix(f), readFileSync(f, 'utf8')))).toEqual([])
  })

  it('CONTROL: each check SEES its defect', () => {
    expect(tableOffenders('x', '<table className={a}>\n<tbody/></table>')).toEqual(['x:1'])
    expect(tableOffenders('x', '<table>\n  <caption>Name</caption></table>')).toEqual([])
    expect(svgOffenders('x', '<svg viewBox={`0 0 ${W} ${H}`}>')).toEqual(['x:1'])
    expect(svgOffenders('x', '<svg role="img" aria-label={label}>')).toEqual([])
    expect(genericLabelOffenders('x', '<span className={s} aria-label="Dot" />')).toEqual(['x:1'])
    expect(genericLabelOffenders('x', '<span role="img" aria-label="Dot" />')).toEqual([])
  })
})

describe('terminal stylesheets — every clickable class is a finger target on touch', () => {
  it('walks real stylesheets that declare clickable classes (non-vacuity)', () => {
    const clickable = CSS.filter((f) => /cursor:\s*pointer/.test(readFileSync(f, 'utf8')))
    expect(clickable.map(posix)).toContain('pages/terminal/TerminalShell.module.css')
    expect(clickable.map(posix)).toContain('pages/terminal/panels/moversPanel.module.css')
  })

  it('no clickable class is under 44px at phone (390) or tablet (820) width', () => {
    const offenders = CSS.flatMap((f) => clickableWithoutFloor(readFileSync(f, 'utf8')).map((c) => `${posix(f)} ${c}`))
    expect(offenders, `clickable classes with no --tap-min floor on touch:\n${offenders.join('\n')}`).toEqual([])
  })

  it('CONTROL: a clickable class floored on the phone only is reported at tablet width', () => {
    const css = '.a { cursor: pointer; }\n@media (max-width: 640px) { .a { min-height: var(--tap-min); } }'
    expect(clickableWithoutFloor(css)).toEqual(['.a@820'])
    const ok = '.a { cursor: pointer; }\n@media (max-width: 1024px) { .a { min-height: var(--tap-min); } }'
    expect(clickableWithoutFloor(ok)).toEqual([])
  })
})
