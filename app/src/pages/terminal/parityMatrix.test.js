// @vitest-environment node
// MG-7 rail — every capability of today's `/calendar` page is CARRIED in the shell, or is a
// GAP with a named owner. The rows are DERIVED (tools/terminal_parity_matrix.mjs); this rail fails when:
//   * a carry fact stops holding (each verdict is computed from one, never asserted);
//   * a GAP appears that KNOWN_GAPS does not name (a new uncovered capability);
//   * the committed doc drifts from the derivation.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
// ⛔ The derivation lives in tools/ (dev tooling is not part of the app bundle); this rail
// imports the SAME module the tool runs, so the two cannot disagree.
import { SOURCE_FILES, DOC_PATH, KNOWN_GAPS, deriveRows, renderMarkdown } from '../../../../tools/terminal_parity_matrix.mjs'

const SRC = path.join(process.cwd(), 'src')
const REPO = path.resolve(process.cwd(), '..')
const src = Object.fromEntries(Object.entries(SOURCE_FILES)
  .map(([k, rel]) => [k, fs.readFileSync(path.join(SRC, rel), 'utf8')]))
const derived = deriveRows(src)

describe('MG-7 — the /calendar parity matrix', () => {
  it('non-vacuity: the derivation found the page\'s views, keys and URL contract', () => {
    const ids = derived.rows.map((r) => r.id)
    for (const must of ['module:WeekView', 'module:MonthView', 'module:WireView', 'module:TodaysBrief',
      'module:DayDetailDrawer', 'module:EarningsResearchModal', 'pref:calendar_view_v3',
      'pref:calendar_mystocks_sources', 'param:earnings', 'param:week', 'param:d']) {
      expect(ids, must).toContain(must)
    }
    expect(derived.rows.length).toBeGreaterThan(20)
  })

  it.each(Object.entries(derived.facts))('carry fact %s holds', (fact, holds) => {
    expect(holds, fact).toBe(true)
  })

  it('every row is CARRIED or UNAFFECTED, except the GAPs KNOWN_GAPS names', () => {
    const gaps = derived.rows.filter((r) => r.verdict === 'GAP').map((r) => r.id)
    expect(gaps.sort()).toEqual(Object.keys(KNOWN_GAPS).sort())
    for (const r of derived.rows) expect(['CARRIED', 'UNAFFECTED', 'GAP']).toContain(r.verdict)
  })

  it('the committed doc IS the derivation (regenerate: node tools/terminal_parity_matrix.mjs)', () => {
    const doc = fs.readFileSync(path.join(REPO, DOC_PATH), 'utf8').replace(/\r\n/g, '\n')
    expect(doc).toBe(renderMarkdown(derived))
  })

  it('the controls: a broken carry fact turns rows to GAP (the rail can fail)', () => {
    const broken = deriveRows({ ...src, modalRouteSrc: src.modalRouteSrc.replace(/'\/terminal\/calendar'/g, "'/nope'") })
    expect(broken.rows.filter((r) => r.id.startsWith('param:')).every((r) => r.verdict === 'GAP')).toBe(true)
    const unembedded = deriveRows({ ...src, panelsSrc: src.panelsSrc.replace("import('../Calendar')", "import('./CalendarFork')") })
    expect(unembedded.facts.embedsSameModule).toBe(false)
    expect(unembedded.rows.filter((r) => r.id.startsWith('module:')).every((r) => r.verdict === 'GAP')).toBe(true)
  })
})
