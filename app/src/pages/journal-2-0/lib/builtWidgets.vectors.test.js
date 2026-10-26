// Notebook widgets phase 2, wave 11 (Task 11.5): the client twin of the server's template fill
// (api/services/journal_two/slot_fill: refresh_params, normalize_params, search_text, BUILT_PARAM_FIELDS;
// tests/test_slot_fill_built.py), run over the ONE vector file both sides read. A built widget a template places
// must carry exactly the params and search line the member's own insert writes (buildWidgetEmbedAttrs over
// builtRefreshParams). The expected values are typed by hand in that file.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { builtRefreshParams } from './builtWidgets'
import { WIDGET_REGISTRY, normalizeParams, paramsPlainText } from '../../../widgets/registry'

const FILE = path.resolve(__dirname, '../../../../../tests/fixtures/builtRefreshParamsVectors.json')
const VECTORS = JSON.parse(fs.readFileSync(FILE).toString('utf8'))

describe('the shared builtWidget vectors', () => {
  it('reads version 2 with enough cases to mean something', () => {
    expect(VECTORS.version).toBe(2)
    expect(VECTORS.cases.length).toBeGreaterThanOrEqual(8)          // non-vacuity: the loop below passes over []
  })

  it('the fields are the registry builtWidget paramsSchema, in order', () => {
    const fields = WIDGET_REGISTRY.builtWidget.paramsSchema.map((f) => [f.key, f.type, f.default ?? null])
    expect(fields).toEqual(VECTORS.fields)
  })

  for (const c of VECTORS.cases) {
    it(c.name, () => {
      const refreshed = builtRefreshParams(c.old, c.payload)
      expect(refreshed).toEqual(c.expected)
      const params = normalizeParams('builtWidget', refreshed)
      expect(params).toEqual(c.params)
      expect(paramsPlainText('builtWidget', params)).toBe(c.searchText)
    })
  }
})
