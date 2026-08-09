// ⛔ THIS FILE IS STRUCTURALLY BLIND TO THE WIRE, AND SAYS SO. Every case here
// renders `StarterLibrary` on its own; all of them would stay green for the
// entire time the library was mounted nowhere, which is exactly how a dozen
// features shipped this branch built, tested, green and unreachable. The
// reachability claim is `BuilderSheet.starters.test.jsx`'s and only its.
//
// ⛔ AND EVERY EXPECTATION IS TAKEN FROM THE SHIPPED MODULE, NEVER FROM A COPY.
// The taxonomy is `SETUP_GROUPS`; the tree is `parseFormula`'s; the blurb is
// `sentenceFor`'s; the identity is `astHash`'s. A test that retyped any of them
// would be a second authority over a value the source already owns — this
// repo's most repeated defect.

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

import StarterLibrary, {
  STARTERS, STARTER_LIST, UNGROUNDED, UNDECIDED, NOT_IN_TAXONOMY,
  CATALOG_VERSION, starterHash, buildFrom,
} from './StarterLibrary'
import { SETUP_GROUPS, SETUPS } from '../../../constants/setupGroups'
import { parseFormula, astHash } from '../engine/ast/parse'
import { sentenceFor } from '../engine/ast/sentence'
import { lintRepaint, REPAINT_MODES } from '../engine/ast/lint'
import { freshnessFor, FRESHNESS_MODES } from '../engine/ast/freshness'
import CATALOG from '../engine/ast/starterScans.json'

afterEach(cleanup)

const names = new Set(SETUPS)

describe('the catalogue is DERIVED from the taxonomy', () => {
  it('every shipped starter names a setup SETUP_GROUPS declares, and carries its family', () => {
    expect(STARTER_LIST.length).toBeGreaterThan(0)
    for (const entry of STARTER_LIST) {
      expect(names.has(entry.setup), entry.setup).toBe(true)
      const group = SETUP_GROUPS.find((g) => g.setups.includes(entry.setup))
      expect(entry.family).toBe(group.label)
    }
  })

  it('⭐ the partition is TOTAL — every setup is shipped or NAMED, and never both', () => {
    // ⛔ THE COUNT IS READ, NEVER ASSERTED AS A LITERAL. A literal here would rot
    // the day somebody adds a setup, which is a thing that happens; AMENDMENT 2
    // stated this count twice and was wrong both times.
    const shipped = new Set(STARTER_LIST.map((e) => e.setup))
    const refused = new Set(UNGROUNDED.map((r) => r.setup))
    expect(UNDECIDED, 'a taxonomy entry nobody decided about').toEqual([])
    expect(NOT_IN_TAXONOMY, 'a starter for a setup the firm does not declare').toEqual([])
    expect([...shipped].filter((n) => refused.has(n))).toEqual([])
    expect(new Set([...shipped, ...refused])).toEqual(names)
  })

  it('🔴 every DECLARED starter actually ships — a silent degradation is a defect', () => {
    // A starter the builder refuses degrades gracefully into a named refusal,
    // which is right for a tree that rotted underneath us and wrong for a
    // catalogue somebody just edited. Filling a refused setup's slot with a
    // plausible-looking scan would otherwise leave every other assertion here
    // green, with the only trace being a machine sentence where a reviewed one
    // used to be.
    const declared = Object.keys(CATALOG.starters).sort()
    const shipping = Object.keys(STARTERS).sort()
    expect(shipping, UNGROUNDED.map((r) => r.reason).join(' | ')).toEqual(declared)
  })

  it('the catalogue itself hand-lists no family and no read-back', () => {
    // The three things the file must not own: the family is the taxonomy's, the
    // sentence is `sentence.js`'s, the handle is `astHash`'s.
    for (const [setup, spec] of Object.entries(CATALOG.starters)) {
      for (const key of ['family', 'sentence', 'blurb', 'description', 'def_hash', 'fn', 'hash']) {
        expect(spec, `${setup}.${key}`).not.toHaveProperty(key)
      }
    }
    expect(CATALOG_VERSION).toBeTruthy()
  })
})

describe('every starter is a real, sayable, non-repainting condition', () => {
  it('⭐ the FROZEN tree is what the SHIPPED parser produces from its own source', () => {
    // The server walks that frozen tree with no parser of its own (decision
    // D-A1), so the two lanes agree only for as long as this freeze holds.
    for (const [setup, spec] of Object.entries(CATALOG.starters)) {
      const parsed = parseFormula(spec.source)
      expect(parsed.ok, `${setup}: ${parsed.error || ''}`).toBe(true)
      expect(parsed.ast, setup).toEqual(spec.ast)
    }
  })

  it('the badge and the freshness verdict come from the SHIPPED linters', () => {
    for (const entry of STARTER_LIST) {
      const repaint = lintRepaint(entry.ast).mode
      expect(REPAINT_MODES).toContain(repaint)
      // ⭐ READ OFF THE SHIPPED VOCABULARY RATHER THAN TYPED: a starter that
      // needs a repaint acknowledgement before it can be saved is a broken front
      // door in the other direction.
      expect(repaint, entry.setup).toBe(REPAINT_MODES[0])
      expect(FRESHNESS_MODES).toContain(freshnessFor(entry.ast, {}).mode)
    }
  })

  it('⛔ the blurb is `sentenceFor(tree)` — never a hand-written one', () => {
    render(<StarterLibrary />)
    const cards = screen.getAllByTestId('starter-card')
    expect(cards.length).toBe(STARTER_LIST.length)
    for (const card of cards) {
      const setup = card.getAttribute('data-setup')
      const entry = STARTERS[setup]
      expect(entry, setup).toBeTruthy()
      expect(within(card).getByTestId('starter-sentence')).toHaveTextContent(
        sentenceFor(parseFormula(entry.source).ast, {}))
    }
  })

  it('the identity is astHash over the tree, and it is derived on demand', () => {
    for (const entry of STARTER_LIST) {
      expect(starterHash(entry.setup)).toBe(astHash(parseFormula(entry.source).ast))
    }
    // ⛔ …and nowhere in the catalogue file.
    expect(JSON.stringify(CATALOG)).not.toMatch(/sha256:/)
  })
})

describe('a setup with no expressible condition is NAMED, never approximated', () => {
  it('every refusal spells its own setup and gives a real reason', () => {
    expect(UNGROUNDED.length).toBeGreaterThan(0)
    for (const { setup, reason } of UNGROUNDED) {
      expect(names.has(setup)).toBe(true)
      expect(reason).toContain(setup)
      expect(reason.length).toBeGreaterThan(40)
    }
    // …and they are not one sentence with the name substituted in.
    const tails = new Set(UNGROUNDED.map((r) => r.reason.split(r.setup).join('')))
    expect(tails.size).toBe(UNGROUNDED.length)
  })

  it('and the surface SHOWS them rather than hiding an empty half of the taxonomy', () => {
    render(<StarterLibrary />)
    expect(screen.queryByTestId('starter-refusals')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /no starter scan yet/i }))
    const rows = within(screen.getByTestId('starter-refusals')).getAllByRole('listitem')
    expect(rows.length).toBe(UNGROUNDED.length)
    expect(rows[0]).toHaveTextContent(UNGROUNDED[0].setup)
  })
})

describe('the card hands back a SOURCE and nothing else', () => {
  it('picking one calls `onPick` with the entry whose source is the catalogue\'s', () => {
    const picked = []
    render(<StarterLibrary onPick={(e) => picked.push(e)} />)
    const first = STARTER_LIST[0]
    fireEvent.click(screen.getByRole('button', { name: new RegExp(escapeRe(first.setup)) }))
    expect(picked).toHaveLength(1)
    expect(picked[0].source).toBe(CATALOG.starters[first.setup].source)
    // ⛔ NO HASH, NO DOCUMENT, NO ROW. Installing is the member's action through
    // the shipped save path; a card that handed over a prebuilt document would
    // be a second write door with a second set of gates to keep in step.
    expect(Object.keys(picked[0]).sort())
      .toEqual(['ast', 'family', 'sentence', 'setup', 'source'])
  })

  it('the active card is marked from the SHARED source, not from its own state', () => {
    const first = STARTER_LIST[0]
    const { container } = render(<StarterLibrary activeSource={first.source} />)
    const active = container.querySelectorAll('[data-setup][class*="cardActive"]')
    expect(active).toHaveLength(1)
    expect(active[0].getAttribute('data-setup')).toBe(first.setup)
  })

  it('renders nothing that is not a UIcon glyph or text', () => {
    // `feedback_no_generic_emoji` — the registry is the single source of icons.
    const { container } = render(<StarterLibrary />)
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
  })
})

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

// ─── the SOURCE rail ─────────────────────────────────────────────────────────

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`StarterLibrary.test: could not find the repo root from ${process.cwd()}`)
})()

// ⚠️ JSX-CAPABLE, BECAUSE THE SUBJECT IS A COMPONENT. Bare `acorn` raises on the
// first `<section>` — and a rail that throws is a rail that gets deleted.
const JsxParser = Parser.extend(jsx())

/** Every string LITERAL in a module, by AST. ⛔ Not a grep: a grep reported five
 *  call sites once and all five were prose. */
function stringLiterals(source) {
  const found = new Set()
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'Literal' && typeof node.value === 'string') found.add(node.value)
    if (node.type === 'JSXText' && typeof node.value === 'string') found.add(node.value)
    for (const key of Object.keys(node)) {
      const child = node[key]
      if (Array.isArray(child)) child.forEach(walk)
      else if (child && typeof child === 'object' && child.type) walk(child)
    }
  }
  walk(JsxParser.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }))
  return found
}

describe('⭐ THE SOURCE RAIL — a hand-list that AGREES with today\'s taxonomy is invisible', () => {
  const rel = 'app/src/components/chart/builder/StarterLibrary.jsx'

  it('the module spells NO setup name', () => {
    // E-4's M10 measured why this is not a style point: a hand-list that
    // REPLACES a derivation is caught behaviourally, but one that AGREES with
    // today's taxonomy leaves every behavioural test green — 825 of 826 in that
    // measurement, with only the source rail red. ⛔ Full equality, never
    // containment, so a comment or a sentence can neither satisfy nor defeat it.
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
    const spelled = [...stringLiterals(source)].filter((s) => names.has(s))
    expect(spelled, 'the taxonomy gains an entry and the library silently does not')
      .toEqual([])
  })

  it('and the rail is NOT vacuous — a planted hand-list is found BY NAME', () => {
    const planted = `const SETUPS = ['VCP', 'Wick Play']\nexport default SETUPS\n`
    const spelled = [...stringLiterals(planted)].filter((s) => names.has(s))
    expect(spelled.sort()).toEqual(['VCP', 'Wick Play'])
  })
})

describe('the builder REFUSES rather than rendering half a truth', () => {
  const groups = [{ label: 'Swing', setups: ['VCP', 'HVC'] }]

  it('a frozen tree that is not what the parser produces is REFUSED, not rendered', () => {
    const first = STARTER_LIST[0]
    const planted = {
      version: 'x',
      starters: {
        [first.setup]: {
          source: first.source,
          // A tree that parses to something else entirely.
          ast: parseFormula('close > open').ast,
        },
      },
      _ungrounded: {},
    }
    const built = buildFrom(planted, [{ label: 'Swing', setups: [first.setup] }])
    expect(Object.keys(built.shipped)).toEqual([])
    expect(built.refused[0].setup).toBe(first.setup)
    expect(built.refused[0].reason).toMatch(/frozen tree/)
  })

  it('a source that no longer parses is REFUSED by name', () => {
    const built = buildFrom({
      version: 'x',
      starters: { VCP: { source: 'rs_rank >>> 80', ast: { type: 'num', value: 1 } } },
      _ungrounded: {},
    }, groups)
    expect(built.refused.map((r) => r.setup)).toContain('VCP')
    expect(built.refused[0].reason).toContain('VCP')
  })

  it('a setup with neither a starter nor a reason lands in UNDECIDED', () => {
    const built = buildFrom({ version: 'x', starters: {}, _ungrounded: {} }, groups)
    expect(built.undecided.sort()).toEqual(['HVC', 'VCP'])
  })

  it('a catalogue entry naming a setup the taxonomy does not declare is SURFACED', () => {
    const built = buildFrom({
      version: 'x',
      starters: { 'Not A Firm Setup': { source: 'close > open', ast: parseFormula('close > open').ast } },
      _ungrounded: {},
    }, groups)
    expect(built.notInTaxonomy).toEqual(['Not A Firm Setup'])
  })
})
