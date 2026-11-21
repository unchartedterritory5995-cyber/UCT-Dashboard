// app/src/pages/terminal/panelPhoneFit.rail.test.js
//
// ─── A TABLE FITS ITS PANEL: ON A PHONE, AND IN A NARROW PANEL ON A WIDE SCREEN ───
//
//     cd app && npx vitest run src/pages/terminal/panelPhoneFit.rail.test.js --maxWorkers=2
//
// 2026-11-18, morning: a 390px sweep of 27 Terminal panels in a real browser (sample data, local
// preview) found five whose table was wider than the screen and scrolled sideways: PERF (63px over),
// CONFL (79), ACCUM (116), CEOS (23) and MOST (165). Each was fitted with phone-only rules.
//
// 2026-11-18, later: those rules keyed on the SCREEN (`@media (max-width: 640px)`), and a panel can
// be narrow on a wide screen. A sweep at PANEL widths on a 1600px screen found seven tables wider
// than a 600px panel: RSS (161px over), FLWL (48), ACCUM (41), PERF (26), HILO (22 and 29), the open
// flow board (7) and CONFL (4). Now the shell marks every panel body with the words its own width
// earns (`data-fit`, panelFit.js, ONE shared observer) and every fit rule keys on that mark:
//     narrow   a phone screen, or a panel at most 460px wide: EVERY table folds, as on a phone;
//     foldNNN  the panel is no wider than that step of the FOLD LADDER (FOLD_STEPS);
//     snug     a panel at most 660px wide: the cells of six tables may wrap;
//     medium   a panel at most 780px wide: the same for RSS, the one table wider than a snug panel.
//
// THE FOLD LADDER (the integrator's rule, 2026-11-18): folding a column loses information and
// wrapping does not, so on a screen wider than a phone a table folds only where it would overflow
// even with its cells wrapped. The first cut folded every table at 600px, which took columns away
// from fourteen tables that fitted, on the two-panel boards of the commonest laptops (592px on a
// 1440px screen, 555px on 1366, 512px on 1280). Now each table names its own step on its box
// (`data-fold="550"`) and every fold rule starts with one list: `narrow`, or a step word together
// with that step's `data-fold`. A table with no `data-fold` (it fits a 461px panel, or it has no
// sample rows to measure) folds only in a narrow panel.
//
// 2026-11-20: a sweep of all 120 commands at 340px and at 360px (the small Android phones and the
// folding phones' cover screens; the first sweep stopped at 390px). Eight tables were wider than a
// 340px screen (MOST 48px, UPDG 36, FLWL 20, EXMV 18, CONFL 15, ERNS 15, RSS 11, CEOS 5) and two
// still at 360px (MOST 28, UPDG 16). No column was taken away for it. Where a table folds its cells
// sit 4px a side in place of 8 and the two outer cells give up their outer padding; in MOST the
// words "by size" sit under "% Chg" and the gapper tag starts at the row's left edge; the UPDG
// rating and the EXMV actual move give back their 6rem floor. After it all eight fit 340px.
//
// 2026-11-20, part 2: the 49 commands that sweep could not measure (no sample answers), at 340, 360
// and 390px. Five tables were wider than a 340px screen: RRG (295px over; 245 at 390px), ALRT (277;
// 227), BRKO (73; 23), SENT (37 and 235; 185) and PEER (26). The two stylesheets those sweeps never
// reached (myNamesPanel, comparePanels) got the fold rules marketPanels already had (4px cells, no
// outer padding, `phoneWrap`). ALRT wraps its rule and its "Triggered" time; SENT wraps a series name
// and an economy print's period. Two tables lose columns, because wrapping alone left them wider than
// a 340px screen. RRG wraps the sector's name under its symbol and two headers, and folds RS-Ratio
// and RS-Momentum: the graph above the table already draws those two numbers as each sector's place.
// BRKO wraps "To pivot", its setup gives back its floor, and Tightness folds (it was still 38px over
// with "Plan" cut off; every listed name already passed the tightness test). Two pickers ran past the
// panel's right edge (SCAT's universe by 229px, IMOV's theme by 64px): a picker now shrinks to its
// toolbar. After it all of them fit 340px.
//
// jsdom computes no layout, so this reads SOURCE (like panelPhoneLayout.rail.test.js): it holds the
// mechanism, the helpers' rules and each panel's use of them. The tiers themselves are tested in
// panelFit.test.js, and the rendered widths are measured by the sweep.
//
// The lesson the rule text pins: `overflow-wrap: anywhere` (the desktop `.wrapCell` rule) lets the
// browser squeeze a column to a few letters, which at phone width split "government" and "$640.0M"
// in the middle. The helpers use `break-word`, which breaks between words and does not shrink the
// column below its longest word.

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { FOLD_STEPS, NARROW_MAX, PANEL_FIT_ATTR, PANEL_FIT_TIERS, foldWord } from './panelFit'
import { RS_SCREEN_FOLD } from './panels/rsScreensModel'

const TERMINAL = path.join(process.cwd(), 'src', 'pages', 'terminal')
const PANELS = path.join(TERMINAL, 'panels')
const readAbs = (abs) => fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
const read = (name) => readAbs(path.join(PANELS, name))
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** THE start of every fold rule, built from the ONE list of steps: narrow, or a step with the table's own `data-fold`. */
const FOLD = `:where([data-fit~='narrow'], ${FOLD_STEPS.map((s) => `[data-fit~='${foldWord(s)}'] [data-fold='${s}']`).join(', ')})`
const SNUG = ":where([data-fit~='snug'])"
const MEDIUM = ":where([data-fit~='medium'])"

/** A selector list split at its top-level commas (a comma inside `:where( … )` separates nothing here). */
function splitTop(list) {
  const out = []
  let depth = 0
  let at = 0
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === '(') depth += 1
    else if (list[i] === ')') depth -= 1
    else if (list[i] === ',' && depth === 0) { out.push(list.slice(at, i)); at = i + 1 }
  }
  out.push(list.slice(at))
  return out.map((s) => s.replace(/\s+/g, ' ').trim())
}

/** A stylesheet as its top-level rules and the text inside its at-rule blocks (`@media …`). */
function sheet(cssRaw) {
  const css = stripComments(cssRaw)
  const rules = []
  let atBlocks = ''
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const head = css.slice(i, open).replace(/\s+/g, ' ').trim()
    let depth = 1
    let j = open + 1
    while (j < css.length && depth) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') depth -= 1
      j += 1
    }
    const inner = css.slice(open + 1, j - 1)
    if (head.startsWith('@')) atBlocks += `${head} {${inner}}\n`
    else rules.push({ selectors: splitTop(head), body: inner.replace(/\s+/g, ' ').trim() })
    i = j
  }
  return { rules, atBlocks, text: css }
}

/** The declarations of the top-level rule that lists `selector` (exactly), or ''. */
const ruleFor = (sh, selector) => (sh.rules.find((r) => r.selectors.includes(selector)) || { body: '' }).body

const PANEL_SHEETS = fs.readdirSync(PANELS).filter((f) => f.endsWith('.module.css'))
/** The classes whose rules make a table fit: they may only ever be keyed on the panel's own mark. */
const FIT_CLASSES = ['phoneHide', 'phoneWrap', 'phoneTight', 'snugWrap', 'snugTight', 'mediumWrap', 'mediumTight', 'whyCell', 'asideTag', 'bySize', 'symCol', 'resultCell']

describe('the one mechanism: the shell marks each panel body, the stylesheets key on the mark', () => {
  const shell = readAbs(path.join(TERMINAL, 'TerminalShell.jsx'))
  const module_ = readAbs(path.join(TERMINAL, 'panelFit.js'))

  it('the shell watches every panel BODY with the shared watcher', () => {
    expect(shell).toContain("import { watchPanelFit } from './panelFit'")
    expect(shell).toContain('useLayoutEffect(() => watchPanelFit(bodyRef.current), [])')
    expect(shell).toMatch(/<div ref=\{bodyRef\} className=\{`\$\{styles\.panelBody\}/)
    expect((shell.match(/watchPanelFit\(/g) || []).length).toBe(1)
  })

  it('there is ONE observer for the whole board, and no panel makes its own', () => {
    expect((module_.match(/new ResizeObserver\(/g) || []).length).toBe(1)
    for (const f of fs.readdirSync(PANELS).filter((n) => /\.jsx?$/.test(n) && !/\.test\./.test(n))) {
      expect([f, /data-fit|watchPanelFit|panelFit/.test(read(f))]).toEqual([f, false])
    }
  })

  it('it measures the border box (the content width moves with a scrollbar and would flap a tier)', () => {
    expect(module_).toContain('panelFitFor(el.offsetWidth, isPhoneScreen())')
    expect(module_).not.toMatch(/clientWidth|contentRect|contentBoxSize/)
  })

  it('every stylesheet keys on a real word, always inside :where() so the rule keeps its old specificity', () => {
    expect(PANEL_FIT_ATTR).toBe('data-fit')
    let seen = 0
    for (const f of [...PANEL_SHEETS.map((n) => path.join(PANELS, n)), path.join(TERMINAL, 'TerminalShell.module.css')]) {
      const css = stripComments(readAbs(f))
      for (const m of css.matchAll(/\[data-fit([^\]]*)\]/g)) {
        seen += 1
        const word = (m[1].match(/^~='(\w+)'$/) || [])[1]
        expect([path.basename(f), m[0], PANEL_FIT_TIERS.includes(word)]).toEqual([path.basename(f), m[0], true])
      }
      // take every `:where( … )` out: nothing left may mention the mark or a table's step
      const outside = css.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '')
      expect([path.basename(f), /data-fit|data-fold/.test(outside)]).toEqual([path.basename(f), false])
    }
    expect(seen).toBe(48 * (FOLD_STEPS.length + 1) + 10)
  })

  it('no fit rule is left on the SCREEN, and there is no second mechanism (one rule serves a phone and a narrow panel)', () => {
    for (const f of PANEL_SHEETS) {
      const sh = sheet(read(f))
      for (const cls of FIT_CLASSES) expect([f, cls, new RegExp(`\\.${cls}\\b`).test(sh.atBlocks)]).toEqual([f, cls, false])
      expect([f, /@container|container-type/.test(sh.text)]).toEqual([f, false])
    }
  })

  it('snug and medium hide nothing: only a fold rule takes a column away', () => {
    let checked = 0
    for (const f of PANEL_SHEETS) {
      for (const r of sheet(read(f)).rules) {
        if (!r.selectors.some((s) => s.startsWith(SNUG) || s.startsWith(MEDIUM))) continue
        checked += 1
        expect([f, r.selectors[0], /display:\s*none/.test(r.body)]).toEqual([f, r.selectors[0], false])
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2)
  })
})

// Each measured table: the width it needs with its cells wrapped and every column showing, beside
// the app's 5px scrollbar (the panel-width sweep, sample data, 2026-11-18), and the step it names.
// A table not listed here names no step: it fits a 461px panel, or it has no sample rows.
const MEASURED = [
  // file, code, need px, step(s) in source order
  ['MyHistoryPanel.jsx', 'MYH', [575], [590]],
  ['SeasonalityBoardPanel.jsx', 'SEASB', [566], [590]],     // measured 2026-11-20, twelve month columns
  ['PerformancePanel.jsx', 'PERF', [571], [590]],
  ['ExpectedMovePanel.jsx', 'EXMV', [545], [550]],
  ['EarningsSeasonPanel.jsx', 'ERNS', [531], [550]],
  ['TopFlowPanel.jsx', 'TOPF', [527], [550]],
  ['UpgradesPanel.jsx', 'UPDG', [526], [550]],
  ['MoversPanel.jsx', 'MOST', [524], [550]],
  ['RepeatContractsPanel.jsx', 'ACCUM', [522], [550]],
  ['ConfluencePanel.jsx', 'CONFL', [513], [530]],
  ['FlowListsPanel.jsx', 'FLWL, FLWL OPEN', [499, 458], [510, 480]],
  ['UnusualVolumePanel.jsx', 'UNVOL', [499], [510]],
  ['ShortListPanel.jsx', 'SHRTS (all four ranks)', [492], [510]],
  ['Highs52Panel.jsx', 'H52 HIGHS / H52 LOWS (the one-list view; the paired lists fit and name none)', [488], [510]],
]
/** RSS draws five screens in one table, each with its own columns: every screen names its own step (rsScreensModel.js). */
const RSS_MEASURED = { starter_rs_leaders: [552, 570], starter_rs_nh_before_price: [513, 530], starter_rs_new_high: [511, 530],
  starter_rs_top_rating: [496, 510], starter_rs_exit_warning_5: [464, 480] }
/** How a table box may name its step: a literal, H52's one-list view, or RSS's screen. */
const BOX_STEP = /className=\{styles\.tableBox\} data-fold=(?:"\d+"|\{paired \? undefined : '\d+'\}|\{RS_SCREEN_FOLD\[screen\.id\]\})/
/** Measured tables that name NO step, and the width each needs: all fit a 461px panel with room to spare.
 *  (RSL, SCTR, HILO, H52, WIRE and HELP fit a 341px panel and are not listed.) CEOS needed 515px until its
 *  two wrap columns gave back their floor (snugTight): wrapping instead of folding. */
const FITS_THE_BOTTOM = [
  ['ThemeRotationPanel.jsx', 'TROT', 448], ['CheckPanel.jsx', 'CHK', 444], ['LevelsPanel.jsx', 'LVL', 440],
  ['CallThemesPanel.jsx', 'CEOS', 418], ['LongRunPanel.jsx', 'LEAD', 418], ['PeriodChangePanel.jsx', 'PCHG', 418],
  ['CallSearchPanel.jsx', 'TSRC', 346],
]
/** Tables with no sample rows: never measured, so they must not fold on a desktop panel above the bottom of the ladder. */
const NOT_MEASURED = ['AlertsPanel.jsx', 'BreakoutPanel.jsx', 'CongressLatestPanel.jsx', 'EarningsReactionsPanel.jsx', 'EtfPanel.jsx',
  'GroupDrillPanel.jsx', 'InsiderPanel.jsx', 'PeerPanel.jsx', 'SentimentPanel.jsx', 'ThemeBoardPanel.jsx', 'WatchlistPanel.jsx',
  // Market wave A (2026-11-20): built without a browser, so not measured yet
  'AnaloguesPanel.jsx', 'CotPanel.jsx', 'MarketsBoardPanel.jsx']
const FOLD_SHEETS = ['marketPanels.module.css', 'moversPanel.module.css', 'myNamesPanel.module.css', 'earningsSeason.module.css', 'comparePanels.module.css']
const stepsIn = (src) => [...src.matchAll(/data-fold=(?:"([^"]*)"|\{paired \? undefined : '([^']*)'\})/g)].map((m) => m[1] ?? m[2])

describe('the fold ladder: a table folds only from its own step down', () => {
  it('EVERY fold rule starts with the one list: narrow, or each step together with that step on the table', () => {
    let rules = 0
    for (const f of FOLD_SHEETS) {
      for (const r of sheet(read(f)).rules) {
        for (const s of r.selectors) {
          if (!/data-fit~='(narrow|fold\d+)'|data-fold/.test(s)) continue
          rules += 1
          expect([f, s.slice(s.lastIndexOf(')') + 1), s.startsWith(`${FOLD} `)]).toEqual([f, s.slice(s.lastIndexOf(')') + 1), true])
        }
      }
    }
    expect(rules).toBe(48)
  })

  it('a step word never stands alone: it folds only the table that names that step (no table folds by default above the bottom)', () => {
    for (const f of PANEL_SHEETS) {
      const css = stripComments(read(f))
      for (const m of css.matchAll(/\[data-fit~='fold(\d+)'\]([^,)]*)/g)) {
        expect([f, m[1], m[2]]).toEqual([f, m[1], ` [data-fold='${m[1]}']`])
        expect([f, FOLD_STEPS.includes(Number(m[1]))]).toEqual([f, true])
      }
      for (const m of css.matchAll(/(.{0,22})\[data-fold='(\d+)'\]/g)) {
        expect([f, m[1]]).toEqual([f, `[data-fit~='${foldWord(Number(m[2]))}'] `])
      }
    }
  })

  it('each measured table names a real step, on its table box, and the pinned one', () => {
    for (const [file, code, , steps] of MEASURED) {
      const src = read(file)
      expect([code, stepsIn(src)]).toEqual([code, steps.map(String)])
      for (const line of src.split('\n').filter((l) => l.includes('data-fold='))) {
        expect([code, line.trim().slice(0, 50), BOX_STEP.test(line)]).toEqual([code, line.trim().slice(0, 50), true])
      }
    }
    // no box names a step any other way (a step the rail cannot read is a step nobody checks)
    for (const f of fs.readdirSync(PANELS).filter((n) => /\.jsx$/.test(n) && !/\.test\./.test(n))) {
      for (const line of read(f).split('\n').filter((l) => l.includes('data-fold'))) expect([f, line.trim().slice(0, 50), BOX_STEP.test(line)]).toEqual([f, line.trim().slice(0, 50), true])
    }
    for (const f of fs.readdirSync(PANELS).filter((n) => /\.jsx$/.test(n) && !/\.test\./.test(n))) {
      for (const step of stepsIn(read(f))) expect([f, step, FOLD_STEPS.includes(Number(step))]).toEqual([f, step, true])
    }
  })

  it('the step is just above the need: never under it plus 5px, never more than 30px over it', () => {
    const pairs = MEASURED.flatMap(([, code, needs, steps]) => needs.map((need, i) => [code, need, steps[i]]))
    for (const [id, [need, step]] of Object.entries(RSS_MEASURED)) pairs.push([`RSS ${id}`, need, step])
    for (const [code, need, step] of pairs) {
      expect([code, need, step, step - need >= 5]).toEqual([code, need, step, true])
      expect([code, need, step, step - need <= 30]).toEqual([code, need, step, true])
    }
    expect(pairs.length).toBe(20)
  })

  it('RSS: each of its five screens names its own step, and a screen nobody measured names none', () => {
    expect({ ...RS_SCREEN_FOLD }).toEqual(Object.fromEntries(Object.entries(RSS_MEASURED).map(([id, [, step]]) => [id, step])))
    for (const step of Object.values(RS_SCREEN_FOLD)) expect([step, FOLD_STEPS.includes(step)]).toEqual([step, true])
    expect(RS_SCREEN_FOLD.a_screen_added_later).toBeUndefined()
    const src = read('RsScreensPanel.jsx')
    expect(src).toContain('<div className={styles.tableBox} data-fold={RS_SCREEN_FOLD[screen.id]}>')
    expect((src.match(/data-fold/g) || []).length).toBe(1)
  })

  it('a table that was never measured names no step, so on a desktop it folds only at the bottom of the ladder', () => {
    const named = new Set([...MEASURED.map(([file]) => file), 'RsScreensPanel.jsx'])
    for (const f of NOT_MEASURED) {
      expect([f, fs.existsSync(path.join(PANELS, f))]).toEqual([f, true])
      expect([f, named.has(f), stepsIn(read(f))]).toEqual([f, false, []])
    }
    // and nobody else does either: the measured list is the whole list
    for (const f of fs.readdirSync(PANELS).filter((n) => /\.jsx$/.test(n) && !/\.test\./.test(n))) {
      if (!named.has(f)) expect([f, stepsIn(read(f))]).toEqual([f, []])
    }
    expect(NARROW_MAX).toBeLessThan(Math.min(...FOLD_STEPS))
  })

  it('the bottom of the ladder is above every measured table that names no step, by 10px or more', () => {
    for (const [file, code, need] of FITS_THE_BOTTOM) {
      expect([code, stepsIn(read(file))]).toEqual([code, []])
      expect([code, need, NARROW_MAX - need >= 10]).toEqual([code, need, true])
    }
  })

  it('H52: its two four-column tables stack until each has 280px, so no column has to fold for them to fit', () => {
    expect(read('Highs52Panel.jsx')).toContain('<div className={`${styles.split} ${styles.splitFair}`}>')
    // only the one-list view (six columns) names a step: the paired lists fit, so they must name none
    expect(read('Highs52Panel.jsx')).toContain("<div className={styles.tableBox} data-fold={paired ? undefined : '510'}>")
    expect(ruleFor(sheet(read('marketPanels.module.css')), '.splitFair')).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(17\.5rem,\s*1fr\)\)/)
    const css = read('marketPanels.module.css')
    expect(css.indexOf('.splitFair {')).toBeGreaterThan(css.indexOf('.split {'))
  })
})

describe('the shared helpers (marketPanels.module.css)', () => {
  const css = read('marketPanels.module.css')
  const sh = sheet(css)

  it('where a table folds, its phoneHide columns go and a wrap cell keeps a 6rem floor', () => {
    expect(ruleFor(sh, `${FOLD} .phoneHide`)).toMatch(/display:\s*none/)
    expect(ruleFor(sh, `${FOLD} .table td.wrapCell`)).toMatch(/min-width:\s*6rem/)
  })

  it('where a table folds its cells sit closer (4px a side) and the two outer cells give up their outer padding', () => {
    const cells = ruleFor(sh, `${FOLD} .table td`)
    expect(cells).toBe('padding-inline: var(--space-xs);')
    expect(ruleFor(sh, `${FOLD} .table th`)).toBe(cells)
    for (const cell of ['th', 'td']) {
      expect([cell, ruleFor(sh, `${FOLD} .table ${cell}:first-child`)]).toEqual([cell, 'padding-left: 0;'])
      expect([cell, ruleFor(sh, `${FOLD} .table ${cell}:last-child`)]).toEqual([cell, 'padding-right: 0;'])
    }
  })

  it('a wide panel keeps its 8px: the closer cells are fold rules only, declared after the base cell rule', () => {
    expect(ruleFor(sh, '.table td')).toMatch(/padding:[^;]*var\(--space-sm\)/)
    const base = css.indexOf('.table th,\n.table td {')
    expect(base).toBeGreaterThan(-1)
    expect(css.indexOf(`${FOLD} .table td {`)).toBeGreaterThan(base)
    expect(css.indexOf(`${FOLD} .table td:first-child`)).toBeGreaterThan(css.indexOf(`${FOLD} .table td {`))
    let seen = 0
    for (const r of sh.rules) {
      if (!/padding-(inline|left|right):\s*(0|var\(--space-xs\))/.test(r.body)) continue
      for (const sel of r.selectors) {
        if (!/\.table t[hd](:(first|last)-child)?$/.test(sel)) continue
        seen += 1
        expect([sel, sel.startsWith(`${FOLD} `)]).toEqual([sel, true])
      }
    }
    expect(seen).toBe(6)
  })

  it('phoneWrap lets a cell, or one span in a cell, take a second line, breaking between words', () => {
    const rule = ruleFor(sh, `${FOLD} .table td.phoneWrap`)
    expect(rule).toMatch(/white-space:\s*normal/)
    expect(rule).toMatch(/overflow-wrap:\s*break-word/)
    expect(ruleFor(sh, `${FOLD} .table td span.phoneWrap`)).toBe(rule)
    expect(ruleFor(sh, `${FOLD} .table th.phoneWrap`)).toBe(rule)
  })

  it('phoneTight gives back the wrap cell floor and never breaks inside a word', () => {
    const rule = ruleFor(sh, `${FOLD} .table td.phoneTight`)
    expect(rule).toMatch(/min-width:\s*0/)
    expect(rule).toMatch(/overflow-wrap:\s*break-word/)
    expect(rule).not.toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('the snug and medium helpers are the same two treatments, each for its own tier', () => {
    const wrap = ruleFor(sh, `${FOLD} .table td.phoneWrap`)
    const tight = ruleFor(sh, `${FOLD} .table td.phoneTight`)
    for (const [tier, name] of [[SNUG, 'snug'], [MEDIUM, 'medium']]) {
      expect([name, ruleFor(sh, `${tier} .table td.${name}Wrap`)]).toEqual([name, wrap])
      expect([name, ruleFor(sh, `${tier} .table th.${name}Wrap`)]).toEqual([name, wrap])
      expect([name, ruleFor(sh, `${tier} .table td span.${name}Wrap`)]).toEqual([name, wrap])
      expect([name, ruleFor(sh, `${tier} .table td.${name}Tight`)]).toEqual([name, tight])
      expect([name, ruleFor(sh, `${tier} .table th.${name}Tight`)]).toEqual([name, tight])
    }
    expect(ruleFor(sh, `${SNUG} .table td.snugTight`)).toMatch(/min-width:\s*0/)
    expect(ruleFor(sh, `${MEDIUM} .table td.mediumWrap`)).toMatch(/white-space:\s*normal/)
  })

  it('none of them touches a wide panel: every rule for a helper is keyed on its own tier', () => {
    let seen = 0
    for (const r of sh.rules) {
      for (const s of r.selectors) {
        if (/\.phone(Hide|Wrap|Tight)\b/.test(s)) { seen += 1; expect([s, s.startsWith(`${FOLD} `)]).toEqual([s, true]) }
        if (/\.snug(Wrap|Tight)\b/.test(s)) { seen += 1; expect([s, s.startsWith(`${SNUG} `)]).toEqual([s, true]) }
        if (/\.medium(Wrap|Tight)\b/.test(s)) { seen += 1; expect([s, s.startsWith(`${MEDIUM} `)]).toEqual([s, true]) }
      }
    }
    expect(seen).toBe(16)
  })

  it('the helpers come after the desktop wrap cell rule, so they win at equal specificity', () => {
    const base = css.indexOf('.table td.wrapCell,')
    expect(base).toBeGreaterThan(-1)
    expect(css.indexOf(`${FOLD} .table td.wrapCell`)).toBeGreaterThan(base)
    expect(css.indexOf(`${FOLD} .table td.phoneTight`)).toBeGreaterThan(css.indexOf(`${FOLD} .table td.wrapCell`))
    expect(css.indexOf(`${SNUG} .table td.snugTight`)).toBeGreaterThan(base)
    expect(css.indexOf(`${MEDIUM} .table td.mediumTight`)).toBeGreaterThan(base)
  })

  it('the other two table stylesheets fold their phoneHide columns on the same mark', () => {
    for (const f of ['moversPanel.module.css', 'myNamesPanel.module.css']) {
      expect([f, /display:\s*none/.test(ruleFor(sheet(read(f)), `${FOLD} .phoneHide`))]).toEqual([f, true])
    }
    const erns = sheet(read('earningsSeason.module.css'))
    expect(ruleFor(erns, `${FOLD} .symCol`)).toMatch(/min-width:\s*0\s*!important/)
    expect(ruleFor(erns, `${FOLD} .resultCell`)).toMatch(/white-space:\s*normal\s*!important/)
  })
})

describe('each fitted panel still opts in', () => {
  const uses = (src, cls) => (src.match(new RegExp(`styles\\.${cls}\\b`, 'g')) || []).length

  // fold: the five tables that were wider than a phone (MOST is below).
  it.each([
    ['PerformancePanel.jsx', { phoneTight: 2, phoneWrap: 2 }],
    ['ConfluencePanel.jsx', { phoneTight: 2, phoneWrap: 4 }],
    ['RepeatContractsPanel.jsx', { phoneTight: 2, phoneWrap: 2 }],
    ['CallThemesPanel.jsx', { phoneTight: 4, phoneWrap: 2 }],
    ['UpgradesPanel.jsx', { phoneTight: 1, phoneWrap: 0 }],        // UPDG: the rating (340 and 360px, 2026-11-20)
    ['ExpectedMovePanel.jsx', { phoneTight: 2, phoneWrap: 0 }],    // EXMV: the actual move, header and cell (340px)
  ])('fold: %s', (file, want) => {
    const src = read(file)
    for (const [cls, n] of Object.entries(want)) expect([file, cls, uses(src, cls)]).toEqual([file, cls, n])
  })

  // snug and medium: the tables that were wider than a 600 to 700px panel (HILO is below). In each
  // the cells that ALREADY wrap take the squeeze (they give back their floor), so the one-line cells
  // stay on one line; FLWL also lets its two longest headers take a second line.
  it.each([
    ['PerformancePanel.jsx', { snugTight: 2, snugWrap: 0, mediumTight: 0, mediumWrap: 0 }],       // PERF: Setup
    ['ConfluencePanel.jsx', { snugTight: 4, snugWrap: 0, mediumTight: 0, mediumWrap: 0 }],        // CONFL: Dark pool, Largest contract
    ['RepeatContractsPanel.jsx', { snugTight: 4, snugWrap: 0, mediumTight: 0, mediumWrap: 0 }],   // ACCUM: Contract, Grade and pace
    ['FlowListsPanel.jsx', { snugTight: 8, snugWrap: 2, mediumTight: 0, mediumWrap: 0 }],         // FLWL and FLWL OPEN
    ['RsScreensPanel.jsx', { snugTight: 0, snugWrap: 0, mediumTight: 2, mediumWrap: 1 }],         // RSS (its columns are mapped)
    ['CallThemesPanel.jsx', { snugTight: 4, snugWrap: 0, mediumTight: 0, mediumWrap: 0 }],        // CEOS: Phrase, Companies (it then fits a 461px panel and never folds on a laptop)
  ])('snug and medium: %s', (file, want) => {
    const src = read(file)
    for (const [cls, n] of Object.entries(want)) expect([file, cls, uses(src, cls)]).toEqual([file, cls, n])
  })

  it('RSS: every wrap column gives back its floor and every other header may take two lines, up to 780px', () => {
    const src = read('RsScreensPanel.jsx')
    expect(src).toContain("c.wrap ? `${styles.wrapCell} ${styles.mediumTight}` : styles.mediumWrap].join(' ')")
    expect(src).toContain("c.wrap ? `${styles.wrapCell} ${styles.mediumTight}` : '', tone(cell.toneOf) || ''].join(' ')")
  })

  it('FLWL: both lists opt in (Cream of the Crop and the open flow board)', () => {
    const src = read('FlowListsPanel.jsx')
    const cream = src.slice(src.indexOf('data-testid="terminal-flwl-cream"'), src.indexOf('function OpenBoard'))
    const open = src.slice(src.indexOf('data-testid="terminal-flwl-open"'))
    expect([uses(cream, 'snugTight'), uses(cream, 'snugWrap')]).toEqual([2, 2])
    expect([uses(open, 'snugTight'), uses(open, 'snugWrap')]).toEqual([6, 0])
  })

  it('every phoneTight, snugTight or mediumTight cell is a wrap cell (the helper only loosens a cell that already wraps)', () => {
    const files = ['PerformancePanel.jsx', 'ConfluencePanel.jsx', 'RepeatContractsPanel.jsx', 'CallThemesPanel.jsx', 'FlowListsPanel.jsx', 'RsScreensPanel.jsx']
    let cells = 0
    for (const file of files) {
      for (const line of read(file).split('\n').filter((l) => /styles\.(phone|snug|medium)Tight\b/.test(l))) {
        cells += 1
        expect([file, line.trim().slice(0, 60), line.includes('styles.wrapCell')]).toEqual([file, line.trim().slice(0, 60), true])
      }
    }
    expect(cells).toBeGreaterThanOrEqual(20)
  })

  it('HILO: its two five-column tables stack until each has about 311px', () => {
    expect(read('HighsLowsPanel.jsx')).toContain('<div className={`${styles.split} ${styles.splitRoomy}`}>')
    const sh = sheet(read('marketPanels.module.css'))
    expect(ruleFor(sh, '.splitRoomy')).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(19\.5rem,\s*1fr\)\)/)
    expect(ruleFor(sh, '.split')).toMatch(/minmax\(16rem,\s*1fr\)/)
    const css = read('marketPanels.module.css')
    expect(css.indexOf('.splitRoomy {')).toBeGreaterThan(css.indexOf('.split {'))
  })
})

describe('MOST where it folds (moversPanel.module.css)', () => {
  const sh = sheet(read('moversPanel.module.css'))
  const jsx = read('MoversPanel.jsx')

  it('the share count steps aside, header and cell together, and Vol x avg stays', () => {
    expect(ruleFor(sh, `${FOLD} .phoneHide`)).toMatch(/display:\s*none/)
    expect(jsx).toMatch(/key: 'volume',[^}]*phoneHide: true/)
    expect(jsx).not.toMatch(/key: 'volVsAvg',[^}]*phoneHide/)
    expect(jsx).toContain('className={c.phoneHide ? styles.phoneHide : undefined}')
    expect(jsx).toContain('<td className={styles.phoneHide}>{formatCompactTerminal(r.volume)}</td>')
  })

  it('the Why label may take two lines and the gapper tag drops under the symbol', () => {
    expect(ruleFor(sh, `${FOLD} .table td.whyCell`)).toMatch(/white-space:\s*normal/)
    expect(ruleFor(sh, `${FOLD} .asideTag`)).toMatch(/display:\s*block/)
    expect(ruleFor(sh, `${FOLD} .table td`)).toMatch(/padding-inline:\s*var\(--space-xs\)/)
    expect(jsx).toContain('styles.asideTag')
  })

  it('small phones: "by size" sits under "% Chg", the tag starts at the row edge and the outer cells give up their outer padding', () => {
    expect(ruleFor(sh, `${FOLD} .bySize`)).toBe('display: block;')
    expect(jsx).toContain('className={`${styles.muted} ${styles.bySize}`} data-testid="terminal-movers-by-size"')
    expect(ruleFor(sh, `${FOLD} .asideTag`)).toMatch(/padding-left:\s*0;/)
    for (const cell of ['th', 'td']) {
      expect([cell, ruleFor(sh, `${FOLD} .table ${cell}:first-child`)]).toEqual([cell, 'padding-left: 0;'])
      expect([cell, ruleFor(sh, `${FOLD} .table ${cell}:last-child`)]).toEqual([cell, 'padding-right: 0;'])
    }
    // the base rule that left-aligns the first and the last column is still there, and is no fold rule
    expect(ruleFor(sh, '.table td:last-child')).toBe('text-align: left;')
    expect((jsx.match(/styles\.whyCell/g) || []).length).toBe(2)
  })

  it('none of it applies to a wide panel', () => {
    for (const r of sh.rules) {
      for (const s of r.selectors) {
        if (/\.(phoneHide|whyCell|asideTag|bySize)\b/.test(s)) expect([s, s.startsWith(`${FOLD} `)]).toEqual([s, true])
      }
    }
  })
})

describe('small phones, part 2: the tables the first sweeps could not measure', () => {
  const uses = (src, cls) => (src.match(new RegExp(`styles\\.${cls}\\b`, 'g')) || []).length
  const market = sheet(read('marketPanels.module.css'))

  it.each(['myNamesPanel.module.css', 'comparePanels.module.css'])('%s: a folded table sits 4px a side, its outer cells give up their outer padding and a phoneWrap cell may wrap', (f) => {
    const css = read(f)
    const sh = sheet(css)
    const cells = ruleFor(sh, `${FOLD} .table td`)
    expect(cells).toBe('padding-inline: var(--space-xs);')
    expect(ruleFor(sh, `${FOLD} .table th`)).toBe(cells)
    for (const cell of ['th', 'td']) {
      expect([cell, ruleFor(sh, `${FOLD} .table ${cell}:first-child`)]).toEqual([cell, 'padding-left: 0;'])
      expect([cell, ruleFor(sh, `${FOLD} .table ${cell}:last-child`)]).toEqual([cell, 'padding-right: 0;'])
    }
    // the same wrap as marketPanels: between words, never inside one
    const wrap = ruleFor(sh, `${FOLD} .table td.phoneWrap`)
    expect(wrap).toBe('white-space: normal; overflow-wrap: break-word;')
    expect(wrap).toBe(ruleFor(market, `${FOLD} .table td.phoneWrap`))
    expect(ruleFor(sh, `${FOLD} .table th.phoneWrap`)).toBe(wrap)
    expect(ruleFor(sh, `${FOLD} .phoneHide`)).toBe('display: none;')
    // a wide panel keeps its 8px: the base rule is still there, and the fold rules come after it
    expect(ruleFor(sh, '.table td')).toMatch(/padding:[^;]*var\(--space-sm\)/)
    const base = css.indexOf('.table th,\n.table td {')
    expect(base).toBeGreaterThan(-1)
    expect(css.indexOf(`${FOLD} .table td {`)).toBeGreaterThan(base)
    // and nothing here touches a wide panel: every helper and every closer cell is a fold rule
    let seen = 0
    for (const r of sh.rules) {
      for (const s of r.selectors) {
        const closer = /\.table t[hd](:(first|last)-child)?$/.test(s) && /padding-(inline|left|right):/.test(r.body)
        if (!closer && !/\.phone(Hide|Wrap|Tight)\b/.test(s)) continue
        seen += 1
        expect([f, s.slice(s.lastIndexOf(')') + 1), s.startsWith(`${FOLD} `)]).toEqual([f, s.slice(s.lastIndexOf(')') + 1), true])
      }
    }
    expect([f, seen]).toEqual([f, 9])
  })

  it('ALRT: the alert rule and its status may take a second line (the table ran 277px past a 340px screen)', () => {
    const src = read('AlertsPanel.jsx')
    expect([uses(src, 'phoneWrap'), uses(src, 'phoneHide')]).toEqual([2, 2])
    expect(src).toMatch(/<td className=\{styles\.phoneWrap\}>\s*\{r\.direction === 'above' \? 'Above' : 'Below'\}/)
    expect(src).toMatch(/<td className=\{styles\.phoneWrap\}>\s*\{r\.active \? 'Active'/)
  })

  it('RRG: the name wraps under its symbol, two headers wrap, and the two numbers the graph already draws fold away, header and cell together', () => {
    const src = read('RrgPanel.jsx')
    expect([uses(src, 'phoneWrap'), uses(src, 'phoneHide')]).toEqual([3, 4])
    expect(src).toContain('<th scope="col" className={styles.phoneHide}>RS-Ratio</th><th scope="col" className={styles.phoneHide}>RS-Momentum</th>')
    expect(src).toContain('<td className={styles.phoneHide}>{formatNumber(r.ratio, { decimals: 2 })}</td>')
    expect(src).toContain('<td className={styles.phoneHide}>{formatNumber(r.momentum, { decimals: 2 })}</td>')
    expect(src).toMatch(/<td className=\{styles\.phoneWrap\}>\s*<button type="button" className=\{styles\.rowBtn\}/)
    expect(src).toContain("<th scope=\"col\" className={styles.phoneWrap}>{unit === 'week' ? 'Weeks' : 'Sessions'} in it</th>")
    expect(src).toContain('<th scope="col" className={styles.phoneWrap}>vs {RRG_BENCHMARK}, last {RRG_METHOD.tail} {unit}s</th>')
    // the quadrant, the time in it and the return against the benchmark never fold
    expect(src).toContain('<th scope="col">Symbol</th><th scope="col">Quadrant</th>')
    // the graph that draws the two folded numbers is still drawn above the table
    expect(src.indexOf('<RrgGraph')).toBeGreaterThan(-1)
    expect(src.indexOf('<RrgGraph')).toBeLessThan(src.indexOf('RS-Ratio</th>'))
  })

  it('BRKO: the setup gives back its floor, the distance to the pivot may wrap, and Tightness folds, header and cell', () => {
    const src = read('BreakoutPanel.jsx')
    expect([uses(src, 'phoneWrap'), uses(src, 'phoneTight'), uses(src, 'phoneHide')]).toEqual([2, 1, 4])
    expect(src).toMatch(/key: 'tight', label: 'Tightness', phoneHide: true/)
    expect(src).toContain("<td className={styles.phoneHide}>{formatPercent(x.tight, { decimals: 1, absent: 'n/a' })}</td>")
    // what a phone keeps: the symbol, the setup, the distance to the pivot, the RS rank and the Plan link
    for (const key of ['order', 'sym', 'setup', 'near', 'rs']) {
      expect([key, new RegExp(`key: '${key}'[^}]*phoneHide`).test(src)]).toEqual([key, false])
    }
    expect(src).toMatch(/<td><PanelCommand cmd=\{planCmd\(x\)\}/)
    expect(src).toContain('<td className={`${styles.wrapCell} ${styles.phoneTight}`}>{x.setup}</td>')
    expect(src).toContain('<td className={styles.phoneWrap}>{pivotText(x.dist)}</td>')
    expect(src).toMatch(/key: 'near', label: 'To pivot', phoneWrap: true/)
    expect(src).toContain('className={c.phoneHide ? styles.phoneHide : c.phoneWrap ? styles.phoneWrap : undefined}')
    expect(ruleFor(market, `${FOLD} .table td.phoneTight`)).toMatch(/min-width:\s*0/)
  })

  it('SENT: a series name and an economy print\'s period may take a second line', () => {
    const src = read('SentimentPanel.jsx')
    expect(uses(src, 'phoneWrap')).toBe(3)
    expect(src).toContain('<td className={styles.phoneWrap}>{r.label} <span className={styles.muted}>{r.cadence}</span></td>')
    expect(src).toContain('<td className={styles.phoneWrap}>{name}</td>')
    expect(src).toContain('<td className={styles.phoneWrap}>{out.period}{out.released ?')
  })

  it('SCAT and IMOV: a labelled picker is never wider than its toolbar, in any panel (no fold rule: a picker can be too wide anywhere)', () => {
    expect(ruleFor(market, '.pick')).toBe('min-width: 0; max-width: 100%;')
    expect(ruleFor(market, '.pick select')).toBe('min-width: 0; max-width: 100%;')
    expect(ruleFor(market, '.toolbar')).toMatch(/flex-wrap:\s*wrap/)
    const scat = read('ScatterPanel.jsx')
    expect(uses(scat, 'pick')).toBe(2)
    expect((scat.match(/<label className=\{`\$\{styles\.muted\} \$\{styles\.pick\}`\}>/g) || []).length).toBe(2)
    expect(scat).not.toContain('<label className={styles.muted}>')
    const imov = sheet(read('imovPanel.module.css'))
    expect(ruleFor(imov, '.filter')).toMatch(/min-width:\s*0;\s*max-width:\s*100%;/)
    expect(ruleFor(imov, '.filter select')).toMatch(/min-width:\s*0;/)
    expect(ruleFor(imov, '.filter select')).toMatch(/max-width:\s*22em;/)
    expect(ruleFor(imov, '.toolbar')).toMatch(/flex-wrap:\s*wrap/)
  })
})
