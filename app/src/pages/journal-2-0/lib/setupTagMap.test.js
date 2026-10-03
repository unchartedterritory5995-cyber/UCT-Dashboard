// Wave 13 lane 13I-2 — the one alias map between the setup vocabularies (plan R-14) and the
// pattern suggestion. Both setup lists and the pattern engine's judged ids are READ from their
// own files, never retyped here.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SETUP_TAGS, GROUP_TO_CATALOG, PATTERN_TO_TAG, SETUP_FAMILIES,
  canonicalSetupTag, setupFamily, tagsInFamily, suggestTags, planTemplateForTag,
} from './setupTagMap'
import { SETUP_CATALOG } from '../../modelbook/setupCatalog'
import { SETUPS } from '../../../constants/setupGroups'
import { TEMPLATES, getTemplate } from './notebookTemplates'
import { checklistItems } from './fingerprintChecklist'

const REPO = join(process.cwd(), '..')

/** FOCUSED_SETUPS, read out of the Python source (the ids the confirmed store judges). */
function focusedSetups() {
  const src = readFileSync(join(REPO, 'api', 'services', 'pattern_vision', 'rubrics.py'), 'utf8')
  const m = src.match(/FOCUSED_SETUPS\s*=\s*\[([\s\S]*?)\]/)
  return [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1])
}

describe('the alias map covers both setup lists', () => {
  it('every catalog name and every taxonomy name resolves to a canonical tag', () => {
    expect(SETUP_CATALOG.length).toBeGreaterThan(10)
    expect(SETUPS.length).toBeGreaterThan(10)
    for (const name of [...SETUP_CATALOG.map((s) => s.name), ...SETUPS]) {
      const tag = canonicalSetupTag(name)
      expect(tag, name).not.toBeNull()
      expect(SETUP_TAGS).toContain(tag)
    }
  })

  it('every alias names a real taxonomy setup and a real catalog setup', () => {
    const catalog = SETUP_CATALOG.map((s) => s.name)
    for (const [alias, tag] of Object.entries(GROUP_TO_CATALOG)) {
      expect(SETUPS, alias).toContain(alias)
      expect(catalog, tag).toContain(tag)
      expect(SETUP_TAGS).not.toContain(alias)             // an alias is never a second tag
    }
  })

  it('every tag has a field-guide family, and the family filter partitions the tags', () => {
    for (const tag of SETUP_TAGS) expect(SETUP_FAMILIES, tag).toContain(setupFamily(tag))
    const union = SETUP_FAMILIES.flatMap((f) => tagsInFamily(f))
    expect(union.slice().sort()).toEqual(SETUP_TAGS.slice().sort())
  })

  it('is case-insensitive and refuses what is in neither list', () => {
    expect(canonicalSetupTag('  classic u&r ')).toBe('U&R (Undercut & Rally)')
    expect(canonicalSetupTag('vcp')).toBe('VCP')
    expect(canonicalSetupTag('Moon Shot')).toBeNull()
    expect(canonicalSetupTag(null)).toBeNull()
  })
})

describe('the pattern engine maps to tags, and a suggestion is only a suggestion', () => {
  it('every id the confirmed store judges is mapped (to a tag, or explicitly null)', () => {
    const ids = focusedSetups()
    expect(ids.length).toBeGreaterThan(5)                 // the read found the list
    for (const id of ids) {
      expect(Object.keys(PATTERN_TO_TAG), id).toContain(id)
      const tag = PATTERN_TO_TAG[id]
      if (tag !== null) expect(SETUP_TAGS, id).toContain(tag)
    }
  })

  it('suggestTags maps, keeps the most confident per tag, sorts by confidence, skips candles', () => {
    const fp = { fields: { patterns: { value: [
      { setup: 'vcp', asof_date: '2026-09-29', confidence: 61 },
      { setup: 'hammer', asof_date: '2026-09-29', confidence: 99 },
      { setup: 'pullback_to_10ema', asof_date: '2026-09-29', confidence: 70 },
      { setup: 'pullback_to_50sma', asof_date: '2026-09-28', confidence: 75 },
      { setup: 'vcp', asof_date: '2026-09-30', confidence: 82 },
      { setup: 'not_a_detector', confidence: 90 },
    ] } } }
    const before = JSON.stringify(fp)
    expect(suggestTags(fp)).toEqual([
      { tag: 'VCP', patternId: 'vcp', confidence: 82, asOf: '2026-09-30' },
      { tag: 'Classic Flag/Pullback', patternId: 'pullback_to_50sma', confidence: 75, asOf: '2026-09-28' },
    ])
    expect(JSON.stringify(fp)).toBe(before)               // reads, never writes
  })

  it('a missing or empty patterns field suggests nothing', () => {
    expect(suggestTags(null)).toEqual([])
    expect(suggestTags({ fields: { patterns: { value: null, missing: 'patterns_current_window_only' } } })).toEqual([])
  })
})

describe('a tag starts from a real 12B setup plan', () => {
  it('every template a tag names exists, and every setup plan is reachable from some tag', () => {
    const named = new Set()
    for (const tag of SETUP_TAGS) {
      const key = planTemplateForTag(tag)
      if (key == null) continue
      expect(getTemplate(key), `${tag} -> ${key}`).toBeTruthy()
      named.add(key)
    }
    // A setup plan is a template whose body carries the 12B Checklist (setupPlanBody).
    const setupPlans = TEMPLATES.filter((t) => checklistItems(t.build({})).length > 0).map((t) => t.key)
    expect(setupPlans.length).toBeGreaterThan(0)
    for (const key of setupPlans) expect([...named], key).toContain(key)
  })
})
