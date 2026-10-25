// Wave 10 (Task 10.17): the builder's two new sources, Options strategies and Notes, end to end through the sheet's own
// fetches. Asserted by RENDERED TEXT and by the plan on the wire.
//
// The catalog is the router's own with wave 10 on (`__fixtures__/w10Catalog.json`, generated beside serverCatalog.json
// by tests/test_widget_definitions_router.py::write_vocabulary_fixture), through `__fixtures__/w10Catalog.js`. Every
// sentence the server owns (the tiles' descriptions, the refusal of "last N trades", the empty states) is read from
// the catalog or a payload, never typed here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import WidgetBuilderSheet, { PREVIEW_DEBOUNCE_MS } from './WidgetBuilderSheet'
import {
  VOCAB_FIELDS, ID_NAMED_FIELDS, indexCatalog, filterSentence, propertyFieldFor, NAMES_FAILED,
  NAME_WORDS,
} from './builderCatalog'
import { cleanup } from '@testing-library/react'
import { measureLabel, measureId } from './formulaFields'
import { normalizePlan } from './builderState'
import { __resetBuiltCaches } from '../../../lib/builtWidgets'
import { installFetch, answer, refusal, callsTo, bodyOf, payload, CATALOG } from './__fixtures__/builderFixtures'
import {
  W10_CATALOG, W10_CATALOG_NO_KINDS, sourceRow, PROPERTIES, PROPERTY_DEFS, STRATEGIES, FOLDERS, KINDS, NOTE_TAGS,
  UNDERLYINGS, P_CONV, P_GRADE, P_DONE, P_RISK, P_WHY, OPT_A, w10With,
} from './__fixtures__/w10Catalog'

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

const OPTIONS = sourceRow('options_strategies')
const NOTES = sourceRow('notes')
const PROP_FIELD = NOTES.fields.find((f) => f.key === 'property')

/** A server constant read from its own file (never retyped here): `NAME = (...)` or the `S_EMPTY` table. */
const REPO = join(process.cwd(), '..')
const serverText = (rel) => readFileSync(join(REPO, rel), 'utf-8')
const pyStrings = (text) => [...text.matchAll(/"([^"]*)"/g)].map((m) => m[1])
function pyTuple(rel, name) {
  const m = new RegExp(`^${name} = \\(([^)]*)\\)`, 'm').exec(serverText(rel))
  if (!m) throw new Error(`${name} not found in ${rel}`)
  return pyStrings(m[1])
}
function pyDictEntry(rel, table, key) {
  const t = serverText(rel)
  const at = t.indexOf(`${table}: dict[str, str] = {`)
  if (at < 0) throw new Error(`${table} not found in ${rel}`)
  const body = t.slice(at, t.indexOf('}', at))
  const m = new RegExp(`"${key}":\\s*"([^"]*)"`).exec(body)
  if (!m) throw new Error(`${table}[${key}] not found`)
  return m[1]
}

let fetchSpy
let routes
let catalog
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  __resetBuiltCaches()
  window.localStorage.clear()
  catalog = W10_CATALOG
  const values = (field, list) => ['GET', (u) => u.endsWith(`/vocabulary?field=${field}`), () => answer({ field, values: list })]
  ;({ spy: fetchSpy, routes } = installFetch([
    ['GET', (u) => u.endsWith('/vocabulary'), () => answer(catalog)],
    values('property', PROPERTIES), values('strategy', STRATEGIES), values('folder', FOLDERS), values('kind', KINDS),
    values('tag', NOTE_TAGS), values('underlying', UNDERLYINGS),
    ['GET', (u) => u === '/api/j2/property-defs', () => answer(PROPERTY_DEFS)],
  ]))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const route = (method, test, reply) => routes.unshift([method, test, reply])
/** Unmount everything and forget the cached reads, inside one test. */
const cleanupAll = () => { cleanup(); __resetBuiltCaches() }
const previews = () => callsTo(fetchSpy, 'POST', (u) => u.endsWith('/preview'))
const lastPlan = () => bodyOf(previews()[previews().length - 1]).plan

async function openBuilder() {
  const utils = render(<WidgetBuilderSheet uid="u1" onClose={vi.fn()} />)
  await flush()
  await flush(PREVIEW_DEBOUNCE_MS)
  return utils
}

async function onSource(label) {
  const utils = await openBuilder()
  fireEvent.click(screen.getByRole('radio', { name: label }))
  await flush(PREVIEW_DEBOUNCE_MS)
  return utils
}

/** + Filter -> Property -> <name>: the second step's heading is the property's name. */
async function pickProperty(name) {
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
  fireEvent.click(screen.getByRole('button', { name: 'Property' }))
  await flush()
  expect(screen.getByRole('heading', { name: 'Which property' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }))
  await flush()
  expect(screen.getByRole('heading', { name })).toBeInTheDocument()
}

describe('Options strategies and Notes in the builder (Task 10.17)', () => {
  it('two_new_tiles_only_when_catalog_lists_them', async () => {
    // Wave 10 off: the catalog lists neither source, so neither tile is there.
    catalog = CATALOG
    const first = render(<WidgetBuilderSheet uid="u1" onClose={vi.fn()} />)
    await flush()
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(screen.getByRole('radio', { name: 'Closed trades' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Options strategies' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Notes' })).toBeNull()
    first.unmount()
    __resetBuiltCaches()

    // Wave 10 on: both, each described by the server's own line, in the catalog's order, in one radio group.
    catalog = W10_CATALOG
    await openBuilder()
    const group = screen.getByRole('radiogroup', { name: 'What to look at' })
    const options = within(group).getByRole('radio', { name: 'Options strategies' })
    const notes = within(group).getByRole('radio', { name: 'Notes' })
    expect(options).toHaveAccessibleDescription(OPTIONS.description)
    expect(notes).toHaveAccessibleDescription(NOTES.description)
    expect(within(group).getAllByRole('radio').map((r) => r.getAttribute('aria-label')))
      .toEqual(W10_CATALOG.sources.map((s) => s.label))
    fireEvent.click(notes)
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(notes).toHaveAttribute('aria-checked', 'true')
    // A new Notes widget starts with the catalog's first Notes measure (never a property sum with no property).
    expect(lastPlan()).toMatchObject({ source: 'notes', measures: [{ key: NOTES.measures[0] }] })
    expect(NOTES.measures[0]).not.toBe('property_sum')
  })

  it('vocab_fields_are_the_servers_and_kind_only_while_offered', async () => {
    // The member-values door answers exactly these keys while wave 10 is on (be router VOCAB_W10_FIELDS, read from the
    // router's own file).
    const served = pyTuple('api/routers/notebook_widget_definitions.py', 'VOCAB_W10_FIELDS')
    expect(served.length).toBeGreaterThan(5)
    for (const k of served) expect(VOCAB_FIELDS).toContain(k)
    expect(VOCAB_FIELDS).not.toContain('note_tag')
    // Every field the two sources list without a fixed pick list is one the door answers (or a typed day or number).
    for (const src of [OPTIONS, NOTES]) {
      for (const f of src.fields) {
        if (Array.isArray(f.values) || ['day', 'number'].includes(f.type) || f.input === 'month') continue
        expect(VOCAB_FIELDS).toContain(f.key)
      }
    }
    // Note kind is offered only while the catalog lists it (W10-R62): built from the catalog, never assumed.
    catalog = W10_CATALOG_NO_KINDS
    await onSource('Notes')
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    const fields = screen.getByRole('list', { name: 'Fields' })
    expect(within(fields).getByRole('button', { name: 'Folder' })).toBeInTheDocument()
    expect(within(fields).queryByRole('button', { name: 'Note kind' })).toBeNull()
  })

  it('strategy_folder_kind_by_name_tag_from_note_tags', async () => {
    await onSource('Options strategies')
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Strategy' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Iron condor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    // The code goes on the wire; the chip reads the member's own name for it.
    expect(lastPlan().filters).toEqual([{ field: 'strategy', op: 'in', values: ['iron_condor'], overridable: false }])
    expect(screen.getByRole('button', { name: 'Strategy is Iron condor' })).toBeInTheDocument()
    // Underlying lists the member's own underlyings.
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Underlying' }))
    await flush()
    expect(screen.getByRole('button', { name: 'SPY' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the widget' }))

    fireEvent.click(screen.getByRole('radio', { name: 'Notes' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    for (const [field, pick, chip] of [['Folder', 'Playbook', 'Folder is Playbook'], ['Note kind', 'Post-mortem', 'Note kind is Post-mortem'],
      ['Tag', 'psychology', 'Tag includes psychology']]) {
      fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
      fireEvent.click(screen.getByRole('button', { name: field }))
      await flush()
      fireEvent.click(screen.getByRole('button', { name: pick }))
      fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
      await flush(PREVIEW_DEBOUNCE_MS)
      expect(screen.getByRole('button', { name: chip })).toBeInTheDocument()
    }
    expect(lastPlan().filters).toEqual([
      { field: 'folder', op: 'in', values: ['f-1'], overridable: false },
      { field: 'kind', op: 'in', values: ['k-own'], overridable: false },
      { field: 'tag', op: 'has_any', values: ['psychology'], overridable: false },
    ])
    // Tags came from the notes door (`?field=tag`), never a trades field.
    expect(callsTo(fetchSpy, 'GET', (u) => u.endsWith('/vocabulary?field=tag'))).toHaveLength(1)
  })

  it('property_chip_two_steps_typed_values', async () => {
    await onSource('Notes')
    // Step one lists the member's properties by name, only those a filter can ask (a relation is not one).
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Property' }))
    await flush()
    const list = screen.getByRole('list', { name: 'Properties' })
    expect(within(list).getAllByRole('button').map((b) => b.querySelector('span').textContent))
      .toEqual(['Conviction', 'Grade', 'Reviewed', 'Risk taken', 'Why'])
    // Step two: a number property takes a number, with the number comparisons.
    fireEvent.click(within(list).getByRole('button', { name: /^Conviction/ }))
    await flush()
    expect(screen.getByRole('heading', { name: 'Conviction' })).toBeInTheDocument()
    const cmp = screen.getByLabelText('Comparison')
    // The comparisons are the SERVER's for a number property (the field's served `propertyTypes`), within its ops.
    expect([...cmp.options].map((o) => o.value))
      .toEqual(PROP_FIELD.propertyTypes.number.ops.filter((o) => PROP_FIELD.ops.includes(o)))
    fireEvent.change(cmp, { target: { value: 'gte' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().filters).toEqual([{ field: 'property', op: 'gte', values: [3], overridable: false, prop: P_CONV }])
    expect(screen.getByRole('button', { name: 'Conviction is at least 3' })).toBeInTheDocument()

    // A select property picks from its own options by label; the option's id goes on the wire.
    await pickProperty('Grade')
    expect(screen.queryByLabelText('Comparison')).toBeNull()       // one comparison: "is"
    fireEvent.click(screen.getByRole('button', { name: 'A+' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().filters[1]).toEqual({ field: 'property', op: 'eq', values: [OPT_A], overridable: false, prop: P_GRADE })
    expect(screen.getByRole('button', { name: 'Grade is A+' })).toBeInTheDocument()

    // A checkbox property is yes or no.
    await pickProperty('Reviewed')
    fireEvent.click(screen.getByLabelText('Yes'))
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().filters[2]).toEqual({ field: 'property', op: 'is', values: [true], overridable: false, prop: P_DONE })
    expect(screen.getByRole('button', { name: 'Reviewed is Yes' })).toBeInTheDocument()

    // Editing a chip opens step two of ITS property; "Change property" goes back to step one, and another
    // property keeps none of the first one's values.
    fireEvent.click(screen.getByRole('button', { name: 'Conviction is at least 3' }))
    await flush()
    expect(screen.getByRole('heading', { name: 'Conviction' })).toBeInTheDocument()
    expect(screen.getByLabelText('Value')).toHaveValue(3)
    fireEvent.click(screen.getByRole('button', { name: 'Change property' }))
    expect(screen.getByRole('heading', { name: 'Which property' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Risk taken/ }))
    await flush()
    expect(screen.getByLabelText('Value')).toHaveValue(null)
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update filter' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().filters[0]).toEqual({ field: 'property', op: 'eq', values: [200], overridable: false, prop: P_RISK })
  })

  it('several_property_filters', async () => {
    await onSource('Notes')
    for (const [name, value] of [['Conviction', '2'], ['Risk taken', '100']]) {
      await pickProperty(name)
      fireEvent.change(screen.getByLabelText('Value'), { target: { value } })
      fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
      await flush(PREVIEW_DEBOUNCE_MS)
    }
    // The same property twice is allowed too (a range by two comparisons).
    await pickProperty('Conviction')
    fireEvent.change(screen.getByLabelText('Comparison'), { target: { value: 'lt' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().filters.map((f) => [f.field, f.prop, f.op, f.values])).toEqual([
      ['property', P_CONV, 'eq', [2]], ['property', P_RISK, 'eq', [100]], ['property', P_CONV, 'lt', [5]],
    ])
    for (const chip of ['Conviction is 2', 'Risk taken is 100', 'Conviction is under 5']) {
      expect(screen.getByRole('button', { name: chip })).toBeInTheDocument()
    }
    // Removing one leaves the others, and the property survives the plan's own normalisation.
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Risk taken is 100' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().filters.map((f) => f.prop)).toEqual([P_CONV, P_CONV])
    expect(normalizePlan(lastPlan()).filters.map((f) => f.prop)).toEqual([P_CONV, P_CONV])
  })

  it('sum_of_property_picks_number_only', async () => {
    await onSource('Notes')
    fireEvent.click(screen.getByRole('button', { name: 'Notes. Change measures' }))
    const sum = screen.getByRole('button', { name: /^Sum of a property/ })
    fireEvent.click(sum)
    await flush()
    // Only the member's NUMBER properties are offered.
    const list = screen.getByRole('list', { name: 'Properties to add up' })
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['Conviction', 'Risk taken'])
    fireEvent.click(within(list).getByRole('button', { name: 'Risk taken' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().measures).toEqual([{ key: 'notes' }, { key: 'property_sum', prop: P_RISK }])
    // A second property is summed beside it; picking one again takes it out.
    fireEvent.click(within(list).getByRole('button', { name: 'Conviction' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().measures.map(measureId)).toEqual(['notes', `property_sum:${P_RISK}`, `property_sum:${P_CONV}`])
    fireEvent.click(within(list).getByRole('button', { name: 'Conviction' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().measures).toEqual([{ key: 'notes' }, { key: 'property_sum', prop: P_RISK }])
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    // The chip names the property it adds up.
    expect(screen.getByRole('button', { name: 'Sum of a property: Risk taken. Change measures' })).toBeInTheDocument()
  })

  it('options_last_n_trades_disabled_with_reason', async () => {
    await onSource('Options strategies')
    fireEvent.click(screen.getByRole('button', { name: /^Date range:/ }))
    const reason = W10_CATALOG.reasons.unknown_range
    // The ranges the server refuses for this source (its own `refusedRanges`), aria-disabled with ITS sentence.
    expect(OPTIONS.refusedRanges.length).toBeGreaterThan(0)
    const ranges = screen.getByRole('list', { name: 'Date ranges' })
    for (const r of W10_CATALOG.ranges) {
      const btn = within(ranges).getByRole('button', { name: new RegExp(`^${r.label}$`, 'i') })
      if (OPTIONS.refusedRanges.includes(r.token)) {
        expect(btn).toHaveAttribute('aria-disabled', 'true')
        expect(btn).toHaveAccessibleDescription(reason)
      } else expect(btn).not.toHaveAttribute('aria-disabled')
    }
    // Clicking a refused one picks nothing.
    const refused = W10_CATALOG.ranges.find((r) => r.token === OPTIONS.refusedRanges[0])
    fireEvent.click(within(ranges).getByRole('button', { name: new RegExp(`^${refused.label}$`, 'i') }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().range.token).not.toBe(refused.token)
  })

  it('empty_sentences_from_server', async () => {
    // Whatever the server says for an empty range is what the preview shows, word for word.
    for (const [label, key, sentence] of [
      ['Options strategies', 'options_strategies', 'Server sentence for no strategies, as sent.'],
      ['Notes', 'notes', 'Server sentence for no notes, as sent.'],
    ]) {
      route('POST', (u) => u.endsWith('/preview'), () => answer(payload({ sourceKey: key, empty: sentence, count: null })))
      const { unmount } = await onSource(label)
      expect(screen.getByText(sentence)).toBeInTheDocument()
      routes.shift()
      unmount()
      __resetBuiltCaches()
    }
    // And nothing a widget draws with retypes the server's empty sentences for the two sources (spec 5.9; be
    // payload.S_EMPTY): the builder, the built views and embeds, and the client widget library.
    const nb = join(process.cwd(), 'src', 'pages', 'journal-2-0')
    const walk = (dir) => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) return walk(p)
      return /\.(js|jsx)$/.test(n) && !/\.test\./.test(n) ? [p] : []
    })
    const files = [...walk(join(nb, 'components', 'notebook', 'widgetBuilder')),
      ...walk(join(nb, 'components', 'notebook', 'widgets')), join(nb, 'lib', 'builtWidgets.js')]
    const texts = files.map((p) => readFileSync(p, 'utf-8'))
    expect(texts.length).toBeGreaterThan(30)                       // the walk read the widget code, not nothing
    expect(texts.some((t) => t.includes('No rows to show.'))).toBe(true)     // control: the walk can find a sentence
    // the server's own sentences, read from payload.S_EMPTY (fix 1, m-4)
    const sentences = ['options_strategies', 'notes'].map((k) => pyDictEntry(
      'api/services/journal_two/widget_engine/payload.py', 'S_EMPTY', k))
    expect(sentences.every((x) => x.length > 5)).toBe(true)
    for (const s of sentences) {
      expect(texts.filter((t) => t.includes(s))).toEqual([])
    }
  })

  it('a_refusal_of_the_new_source_is_the_servers_sentence', async () => {
    route('POST', (u) => u.endsWith('/preview'), () => refusal(400, 'invalid', 'A server refusal, as sent.'))
    await onSource('Notes')
    expect(screen.getByText('A server refusal, as sent.')).toBeInTheDocument()
  })

  // ── W10-R66: the builder offers what the catalog serves, and nothing else ──
  it('a_server_property_type_removed_is_not_offered', async () => {
    catalog = w10With((notes) => { delete notes.fields.find((f) => f.key === 'property').propertyTypes.checkbox })
    await onSource('Notes')
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Property' }))
    await flush()
    const list = screen.getByRole('list', { name: 'Properties' })
    expect(within(list).queryByRole('button', { name: /^Reviewed/ })).toBeNull()
    expect(within(list).getByRole('button', { name: /^Conviction/ })).toBeInTheDocument()
    // and the type's words are the server's
    expect(within(list).getByRole('button', { name: /^Conviction/ }).textContent)
      .toBe(`Conviction${PROP_FIELD.propertyTypes.number.label}`)
  })

  it('a_server_comparison_removed_is_not_offered_from_either_list', async () => {
    // Removed from the type's own list ...
    catalog = w10With((notes) => {
      const f = notes.fields.find((x) => x.key === 'property')
      f.propertyTypes.number.ops = f.propertyTypes.number.ops.filter((o) => o !== 'between')
    })
    await onSource('Notes')
    await pickProperty('Conviction')
    let ops = [...screen.getByLabelText('Comparison').options].map((o) => o.value)
    expect(ops).not.toContain('between')
    expect(ops).toContain('gte')
    cleanupAll()
    // ... or from the catalog field's ops (fix 1, m-1): the type's list never widens what the field offers.
    catalog = w10With((notes) => {
      const f = notes.fields.find((x) => x.key === 'property')
      f.ops = f.ops.filter((o) => o !== 'gte')
    })
    await onSource('Notes')
    await pickProperty('Conviction')
    ops = [...screen.getByLabelText('Comparison').options].map((o) => o.value)
    expect(ops).not.toContain('gte')
    expect(ops).toContain('between')
  })

  it('the_types_a_sum_adds_up_are_the_servers', async () => {
    catalog = w10With((notes, cat) => { cat.measures.find((m) => m.key === 'property_sum').prop.types = ['checkbox'] })
    await onSource('Notes')
    fireEvent.click(screen.getByRole('button', { name: 'Notes. Change measures' }))
    fireEvent.click(screen.getByRole('button', { name: /^Sum of a property/ }))
    await flush()
    const list = screen.getByRole('list', { name: 'Properties to add up' })
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['Reviewed'])
    cleanupAll()
    // A measure row with no `prop` is an ordinary measure: it toggles in, with no property list.
    catalog = w10With((notes, cat) => { delete cat.measures.find((m) => m.key === 'property_sum').prop })
    await onSource('Notes')
    fireEvent.click(screen.getByRole('button', { name: 'Notes. Change measures' }))
    fireEvent.click(screen.getByRole('button', { name: /^Sum of a property/ }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(screen.queryByRole('list', { name: 'Properties to add up' })).toBeNull()
    expect(lastPlan().measures).toEqual([{ key: 'notes' }, { key: 'property_sum' }])
  })

  it('a_text_property_takes_a_typed_value_never_a_list', async () => {
    await onSource('Notes')
    await pickProperty('Why')
    // its comparisons are the server's for text; its value is typed, never a list of the member's property names
    expect([...screen.getByLabelText('Comparison').options].map((o) => o.value))
      .toEqual(PROP_FIELD.propertyTypes.text.ops.filter((o) => PROP_FIELD.ops.includes(o)))
    expect(screen.queryByRole('list', { name: 'Why values' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Conviction' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Type a why'), { target: { value: 'fomo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().filters).toEqual([{ field: 'property', op: 'contains', values: ['fomo'], overridable: false, prop: P_WHY }])
  })

  // ── fix 1, I-3: focus never falls to the page ──
  it('focus_moves_to_the_next_control_at_every_property_step', async () => {
    await onSource('Notes')
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Property' }))
    await flush()
    // picking a property: focus lands on its step's heading
    const conv = screen.getByRole('button', { name: /^Conviction/ })
    conv.focus()
    fireEvent.click(conv)
    await flush()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Conviction' }))
    // "Change property": back on the property that was picked
    const change = screen.getByRole('button', { name: 'Change property' })
    change.focus()
    fireEvent.click(change)
    await flush()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Conviction/ }))
    // the measure picker: opening "Sum of a property" puts focus on its heading; leaving it, back on it
    fireEvent.click(screen.getByRole('button', { name: 'Back to the widget' }))
    fireEvent.click(screen.getByRole('button', { name: 'Notes. Change measures' }))
    const sum = screen.getByRole('button', { name: /^Sum of a property/ })
    sum.focus()
    fireEvent.click(sum)
    await flush()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Sum of a property' }))
    const back = screen.getByRole('button', { name: 'Back to the widget' })
    back.focus()
    fireEvent.click(back)
    await flush()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Sum of a property/ }))
    // Done inside the property list does the same
    fireEvent.click(screen.getByRole('button', { name: /^Sum of a property/ }))
    await flush()
    const done = screen.getByRole('button', { name: 'Done' })
    done.focus()
    fireEvent.click(done)
    await flush()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Sum of a property/ }))
  })

  it('editing_a_property_chip_keeps_focus_through_its_load', async () => {
    await onSource('Notes')
    await pickProperty('Conviction')
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    fireEvent.click(screen.getByRole('button', { name: 'Conviction is 3' }))
    await flush()
    expect(screen.getByLabelText('Value')).toHaveValue(3)
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Conviction' }))
  })

  // ── fix 1, m-2 / m-3 ──
  it('a_select_missing_from_the_definitions_says_it_could_not_load', async () => {
    route('GET', (u) => u === '/api/j2/property-defs',
      () => answer({ propertyDefs: PROPERTY_DEFS.propertyDefs.filter((d) => d.id !== P_GRADE) }))
    await onSource('Notes')
    await pickProperty('Grade')
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this property.")
    expect(screen.queryByText('Nothing to pick from yet.')).toBeNull()
  })

  it('an_edited_filter_whose_property_was_removed_says_so', async () => {
    await onSource('Notes')
    await pickProperty('Conviction')
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    // the property is deleted before the chip is opened again
    route('GET', (u) => u.endsWith('/vocabulary?field=property'),
      () => answer({ field: 'property', values: PROPERTIES.filter((x) => x.id !== P_CONV) }))
    route('GET', (u) => u === '/api/j2/property-defs',
      () => answer({ propertyDefs: PROPERTY_DEFS.propertyDefs.filter((d) => d.id !== P_CONV) }))
    fireEvent.click(screen.getByRole('button', { name: 'Conviction is 3' }))
    await flush()
    expect(screen.getByRole('heading', { name: NAME_WORDS.property.removed })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Change property' })).toBeInTheDocument()
  })

  // ── fix 1, I-4: a widget opened for editing names its properties without any picker opened ──
  it('an_opened_widget_reads_the_property_definitions_for_its_chips', async () => {
    const plan = {
      v: 3, source: 'notes', accounts: 'all', range: { token: 'last_90d' },
      filters: [{ field: 'property', op: 'eq', values: [OPT_A], overridable: false, prop: P_GRADE }],
      measures: [{ key: 'notes' }, { key: 'property_sum', prop: P_RISK }], split: null,
      view: { type: 'number', auto: true }, sort: null, compare: null,
      display: { title: '', titleAuto: true, subtitle: '', accent: 'gold', showN: true, target: null },
    }
    route('GET', (u) => u.endsWith('/widget-definitions/d-1'), () => answer({
      id: 'd-1', name: 'Grades', rev: 1, placedRev: 1, etag: 1, archived: false, usedIn: 1, lastAnswer: null,
      summary: 'x', plan,
    }))
    render(<WidgetBuilderSheet uid="u1" onClose={vi.fn()} from={{ defId: 'd-1', getPos: () => 1 }} />)
    await flush()
    await flush()
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(callsTo(fetchSpy, 'GET', (u) => u === '/api/j2/property-defs')).toHaveLength(1)
    expect(callsTo(fetchSpy, 'GET', (u) => u.endsWith('/vocabulary?field=property'))).toHaveLength(0)
    // the option's NAME and the property's name, never the ids
    expect(screen.getByRole('button', { name: 'Grade is A+' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sum of a property: Risk taken. Change measures' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(OPT_A)
  })
})

describe('the chips name what the ids are (Task 10.17)', () => {
  const cat = indexCatalog(W10_CATALOG)
  const prop = cat.sources.get('notes').fields.get('property')
  const defs = new Map(PROPERTY_DEFS.propertyDefs.map((d) => [d.id, { name: d.name, type: d.type, options: d.options }]))

  it('id_named_fields_never_show_the_id', () => {
    const folder = cat.sources.get('notes').fields.get('folder')
    const f = { field: 'folder', op: 'in', values: ['f-1'] }
    expect(ID_NAMED_FIELDS).toEqual(expect.arrayContaining(['strategy', 'folder', 'kind']))
    expect(filterSentence(folder, f, { toolNames: { folder: new Map([['f-1', 'Playbook']]) } })).toBe('Folder is Playbook')
    expect(filterSentence(folder, f, { toolNames: { folder: new Map() } })).toBe(`Folder is ${NAME_WORDS.folder.removed}`)
    expect(filterSentence(folder, f, { toolNames: { folder: NAMES_FAILED } })).toBe(`Folder is ${NAME_WORDS.folder.failed}`)
    expect(filterSentence(folder, f, {})).not.toContain('f-1')
  })

  it('property_chip_reads_its_name_type_and_option', () => {
    const names = { propertyDefs: defs }
    expect(filterSentence(prop, { field: 'property', prop: P_GRADE, op: 'eq', values: [OPT_A] }, { toolNames: names }))
      .toBe('Grade is A+')
    expect(filterSentence(prop, { field: 'property', prop: P_CONV, op: 'between', values: [1, 4] }, { toolNames: names }))
      .toBe('Conviction is between 1 and 4')
    // Gone, or the list failed: the words, never the id.
    const gone = filterSentence(prop, { field: 'property', prop: '9'.repeat(32), op: 'eq', values: [1] }, { toolNames: names })
    expect(gone).toBe(`${NAME_WORDS.property.removed} is 1`)
    const failed = filterSentence(prop, { field: 'property', prop: P_CONV, op: 'eq', values: [1] },
      { toolNames: { propertyDefs: NAMES_FAILED } })
    expect(failed).toBe(`${NAME_WORDS.property.failed} is 1`)
    // A field for one property offers only the catalog's comparisons for its type.
    expect(propertyFieldFor(prop, defs.get(P_DONE)).ops).toEqual(['is'])
    expect(propertyFieldFor(prop, defs.get(P_DONE)).ops.every((o) => prop.ops.includes(o))).toBe(true)
  })

  it('property_sum_label_names_its_property', () => {
    const plan = { source: 'notes', measures: [{ key: 'property_sum', prop: P_CONV }] }
    const base = cat.measures.get('property_sum').label
    expect(measureLabel(cat, plan, plan.measures[0], { propertyDefs: defs })).toBe(`${base}: Conviction`)
    expect(measureLabel(cat, plan, plan.measures[0], {})).toBe(base)
  })
})
