// Lane A2 review I-1: every body the journal-styles composer (api/services/journal_two/journal_styles.py
// compose, and "save as style") produces must be buildable by the REAL editor schema, content
// expressions included. tests/test_journal_styles_schema.py composes the hard cases and pins them in
// __fixtures__/journalStylesComposed.json (and fails when the composer's output moves); this file runs
// `editorSchema().nodeFromJSON(body).check()` on every pinned body -- the call TipTap's content check
// makes. ⭐ The server's notes._refuse_unbuildable is not equivalent: it mirrors the throws of
// nodeFromJSON only, so `listItem[widgetEmbed]` or an empty `column` passes it and opens broken here.
import { describe, it, expect } from 'vitest'
import { editorSchema } from './tiptap'
import bodies from './__fixtures__/journalStylesComposed.json'

describe('journal styles: composed bodies are buildable by the real editor schema', () => {
  const schema = editorSchema()

  it('non-vacuity: the fixture holds the probed shapes and every built-in style', () => {
    const names = Object.keys(bodies)
    expect(names.length).toBeGreaterThanOrEqual(24)
    for (const n of ['list_item_first_child_placeholder', 'task_item_first_child_placeholder',
      'blockquote_only_child_disabled', 'column_only_child_placeholder', 'save_two_charts_in_columns_outline',
      'save_two_charts_in_columns_composed', 'builtin_trade_plan']) {
      expect(names, n).toContain(n)
    }
  })

  it('every composed body passes nodeFromJSON(...).check()', () => {
    const failures = []
    for (const [name, body] of Object.entries(bodies)) {
      try {
        schema.nodeFromJSON(body).check()
      } catch (e) {
        failures.push(`${name}: ${e.message}`)
      }
    }
    expect(failures).toEqual([])
  })

  // CONTROLS: the check above can fail on exactly the shapes the review found.
  it('CONTROL: a chart as the first child of a list item is rejected', () => {
    const bad = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [
      { type: 'widgetEmbed', attrs: { v: 1, widgetId: 'chart', params: {} } }] }] }] }
    expect(() => schema.nodeFromJSON(bad).check()).toThrow()
  })

  it('CONTROL: an emptied blockquote and an empty column are rejected', () => {
    expect(() => schema.nodeFromJSON({ type: 'doc', content: [{ type: 'blockquote', content: [] }] }).check()).toThrow()
    const cols = { type: 'doc', content: [{ type: 'columns', content: [
      { type: 'column', content: [{ type: 'paragraph' }] }, { type: 'column', content: [] }] }] }
    expect(() => schema.nodeFromJSON(cols).check()).toThrow()
  })
})
