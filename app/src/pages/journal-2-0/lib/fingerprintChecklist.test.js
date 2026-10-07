// Wave 13 lane 13I-2 — the fingerprint fills the 12B setup checklist. The templates are BUILT
// here (never retyped), so a checklist that moves, grows or shrinks reds the alignment rail.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CHECKLIST_EVIDENCE, FIELD_LABELS, annotateSetupPlanDoc, checklistEvidence, checklistItems,
  formatFingerprintValue,
} from './fingerprintChecklist'
import { TEMPLATES, getTemplate } from './notebookTemplates'

/** tech_fingerprint.FIELDS, read out of the Python source. */
function fingerprintFields() {
  const src = readFileSync(join(process.cwd(), '..', 'api', 'services', 'journal_two', 'tech_fingerprint.py'), 'utf8')
  const m = src.match(/^FIELDS = \(([\s\S]*?)\n\)/m)
  return [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1])
}

const cell = (value, missing = null) => ({ value, source: 'screener_row', missing })
const FP = {
  as_of: '2026-09-30',
  fields: {
    pole_pct: cell(48.24), ma_stack: cell('full-bull'), base_depth_pct: cell(12.1),
    base_length_bars: cell(null, 'no_flat_base'), close_cv_pct: cell(2.31), vol_nweek_low: cell(15),
    rs_line_trend: cell('down'), rs_rank: cell(null, 'rank_is_nightly_only'),
  },
}
const REASONS = { no_flat_base: 'no flat base ends at this day', rank_is_nightly_only: 'RS rank is nightly only' }

describe('the mapping is aligned with the real templates', () => {
  const setupPlans = TEMPLATES.filter((t) => checklistItems(t.build({})).length > 0)

  it('every setup plan has a mapping, item for item', () => {
    expect(setupPlans.length).toBeGreaterThanOrEqual(5)
    for (const t of setupPlans) {
      expect(Object.keys(CHECKLIST_EVIDENCE), t.key).toContain(t.key)
      expect(CHECKLIST_EVIDENCE[t.key].length, t.key).toBe(checklistItems(t.build({})).length)
    }
    for (const key of Object.keys(CHECKLIST_EVIDENCE)) expect(getTemplate(key), key).toBeTruthy()
  })

  it('every field named is a real fingerprint field with a label', () => {
    const fields = fingerprintFields()
    expect(fields.length).toBeGreaterThan(10)                  // the read found the tuple
    expect(Object.keys(FIELD_LABELS).sort()).toEqual([...fields].sort())
    for (const items of Object.values(CHECKLIST_EVIDENCE)) {
      for (const item of items) for (const f of item?.fields || []) expect(fields, f).toContain(f)
    }
  })
})

describe('the evidence', () => {
  it('shows values, states only the fingerprint\'s own yes/no, labels missing and unmeasured', () => {
    const ev = checklistEvidence('breakout-plan', FP, REASONS)
    expect(ev[0]).toEqual({ state: 'yes', text: 'Prior run (pole) 48.2%, MA stack full-bull' })
    expect(ev[1].state).toBe('shown')                            // depth is evidence, not a verdict
    expect(ev[1].text).toBe('Base depth 12.1%, Tightness (close CV) 2.3% (Base length: no flat base ends at this day)')
    expect(ev[2]).toEqual({ state: 'yes', text: 'Volume dry-up 3-week low' })
    expect(ev[3].state).toBe('no')                               // the RS line is trending down
    expect(ev[4]).toEqual({ state: 'not_measured', text: 'not measured by the fingerprint' })
  })

  it('a fingerprint with nothing for an item says why', () => {
    const ev = checklistEvidence('pullback-plan', { fields: { ema_stack_intact: cell(null, 'not_enough_history') } },
      { not_enough_history: 'too few sessions for this window' })
    expect(ev[3]).toEqual({ state: 'missing', text: 'not available (EMA stack: too few sessions for this window)' })
  })

  it('an unknown template has no mapping', () => {
    expect(checklistEvidence('weekly-review', FP)).toBeNull()
  })

  it('formats every kind of value', () => {
    expect(formatFingerprintValue('pct_vs_sma50', 3.456)).toBe('+3.5%')
    expect(formatFingerprintValue('pct_vs_sma50', -2)).toBe('-2.0%')
    expect(formatFingerprintValue('vol_nweek_low', 0)).toBe('not at a 2-4 week low')
    expect(formatFingerprintValue('ema_stack_intact', false)).toBe('not intact')
    expect(formatFingerprintValue('patterns', [{ setup: 'vcp', confidence: 81.2 }])).toBe('vcp (81%)')
    expect(formatFingerprintValue('patterns', [])).toBe('none confirmed')
    expect(formatFingerprintValue('rs_rank', null)).toBeNull()
  })
})

describe('annotating a built plan', () => {
  it('marks every checklist item and nothing else, without mutating the template doc', () => {
    const built = getTemplate('breakout-plan').build({})
    const before = JSON.stringify(built)
    const out = annotateSetupPlanDoc(built, 'breakout-plan', FP, REASONS)
    expect(JSON.stringify(built)).toBe(before)
    const items = checklistItems(out)
    const plain = checklistItems(built)
    expect(items).toHaveLength(plain.length)
    items.forEach((text, i) => {
      expect(text.startsWith(plain[i])).toBe(true)
      expect(text).toMatch(/ — Fingerprint/)
    })
    expect(items[0]).toContain('as of 2026-09-30: Yes. Prior run (pole) 48.2%')
    expect(items[4]).toContain('not measured by the fingerprint')
    // Everything outside the checklist is byte-identical.
    const strip = (d) => JSON.stringify({ ...d, content: d.content.filter((n) => n.type !== 'bulletList') })
    expect(strip(out)).toBe(strip(built))
  })

  it('a doc without a Checklist comes back unchanged', () => {
    const d = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }
    expect(annotateSetupPlanDoc(d, 'breakout-plan', FP)).toEqual(d)
  })
})
