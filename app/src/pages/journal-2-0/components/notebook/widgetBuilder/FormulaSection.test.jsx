// Wave 10 (Task 10.16): "Your own fields" in the widget builder, end to end through the sheet's own fetches (the server
// is the fetch router in __fixtures__/builderFixtures.js, serving the catalog with Task 10.9's formula rows from
// __fixtures__/formulaCatalog.js). Asserted by RENDERED TEXT and by the requests on the wire.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import WidgetBuilderSheet, { PREVIEW_DEBOUNCE_MS, KEEP_QUESTION } from './WidgetBuilderSheet'
import { __resetBuiltCaches } from '../../../lib/builtWidgets'
import { compileFormula, LIMITS } from '../../../lib/widgetFormula/widgetFormula'
import { installFetch, answer, payload, callsTo, bodyOf } from './__fixtures__/builderFixtures'
import { FORMULA_CATALOG } from './__fixtures__/formulaCatalog'
import {
  S_FIELD_CAP, S_FORMULA_NAME, S_FORMULA_NAME_LONG, S_FORMULA_NAME_TAKEN, S_BAD_CHARACTER, catalogFields,
} from './formulaFields'
import { indexCatalog } from './builderCatalog'

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

let fetchSpy
let routes
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  __resetBuiltCaches()
  window.localStorage.clear()
  ;({ spy: fetchSpy, routes } = installFetch([['GET', (u) => u.endsWith('/vocabulary'), () => answer(FORMULA_CATALOG)]]))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const route = (method, test, reply) => routes.unshift([method, test, reply])
const previews = () => callsTo(fetchSpy, 'POST', (u) => u.endsWith('/preview'))
const lastPlan = () => bodyOf(previews().at(-1)).plan
/** A settled edit (the box's own debounce), then the preview it starts (the sheet's): two steps, because React renders
 *  the settled edit, and so schedules the preview, only once the first advance returns. */
const settle = async () => { await flush(PREVIEW_DEBOUNCE_MS); await flush(PREVIEW_DEBOUNCE_MS + 10) }

async function openBuilder(props = {}) {
  const onClose = vi.fn()
  const utils = render(<WidgetBuilderSheet uid="u1" onClose={onClose} {...props} />)
  await flush()
  await flush(PREVIEW_DEBOUNCE_MS)
  return { ...utils, onClose }
}

const fieldGroups = () => screen.getAllByTestId('formula-field')
const boxOf = (group) => within(group).getByLabelText('Formula')
const nameOf = (group) => within(group).getByLabelText('Name')

/** "Add your own field", then type its name and formula. */
async function addField(name, expr, { wait = true } = {}) {
  fireEvent.click(screen.getByRole('button', { name: 'Add your own field' }))
  await flush()
  const g = fieldGroups().at(-1)
  fireEvent.change(nameOf(g), { target: { value: name } })
  fireEvent.change(boxOf(g), { target: { value: expr } })
  if (wait) await settle()
  return g
}

const listbox = () => screen.queryByRole('listbox', { name: 'Suggestions' })
const optionLabels = () => within(listbox()).getAllByRole('option').map((o) => o.getAttribute('data-label'))

describe('FormulaSection', () => {
  it('the section is collapsed by default under the measures, and absent when the catalog offers no formats', async () => {
    await openBuilder()
    const section = screen.getByRole('region', { name: 'Your own fields' })
    expect(within(section).getByRole('button', { name: 'Add your own field' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Formula')).toBeNull()
    const order = [...document.querySelectorAll('[data-builder-section]')].map((s) => s.getAttribute('data-builder-section'))
    expect(order.indexOf('formulas')).toBe(order.indexOf('measure') + 1)
  })

  it('CONTROL: a catalog without formula formats (wave 10 dark) shows no section', async () => {
    route('GET', (u) => u.endsWith('/vocabulary'), () => answer({ ...FORMULA_CATALOG, formats: undefined }))
    await openBuilder()
    expect(screen.queryByRole('region', { name: 'Your own fields' })).toBeNull()
  })

  it('add_field_shows_label_syntax_saves_canonical', async () => {
    const { unmount } = await openBuilder()
    const g = await addField('Risk per share', '[Risk $] / [Shares]')
    // The plan carries the CANONICAL form (keys); the box keeps the member's label syntax.
    expect(lastPlan().formulas).toEqual([{ id: 'f1', name: 'Risk per share', expr: '[risk_dollars] / [shares]', format: 'number' }])
    expect(lastPlan().v).toBe(3)
    expect(boxOf(g).value).toBe('[Risk $] / [Shares]')
    // Typed by key, it still shows by label once stored and reopened.
    const saved = { id: 'd-1', name: 'Mine', rev: 1, placedRev: 1, etag: 1, archived: false, usedIn: 0, lastAnswer: null,
      summary: 'x', plan: { ...lastPlan() } }
    route('GET', (u) => u.endsWith('/d-1'), () => answer(saved))
    unmount()
    await openBuilder({ from: { defId: 'd-1' } })
    expect(boxOf(fieldGroups()[0]).value).toBe('[Risk $] / [Shares]')
    // The format select lists the four formats.
    expect(within(fieldGroups()[0]).getByLabelText('Format').querySelectorAll('option')).toHaveLength(4)
  })

  it('autocomplete_fields_on_bracket_and_functions_on_letter', async () => {
    await openBuilder()
    const g = await addField('Edge', '', { wait: false })
    fireEvent.change(boxOf(g), { target: { value: '[' } })
    expect(listbox()).toBeInTheDocument()
    expect(optionLabels()).toContain('Net P&L')
    expect(optionLabels()).not.toContain('Mistake')           // a field that holds several values is never offered
    // A letter outside a bracket: the functions first, then the fields.
    fireEvent.change(boxOf(g), { target: { value: 'S' } })
    expect(optionLabels().slice(0, 2)).toEqual(['SumIf', 'Share'])
    expect(within(listbox()).getAllByRole('option')[0]).toHaveTextContent('SumIf(value, condition)')
    // A digit or an operator opens nothing.
    fireEvent.change(boxOf(g), { target: { value: '1 +' } })
    expect(listbox()).toBeNull()
    // Closed, a space (even inside a bracket, where fields would match) does not open it; a letter does.
    fireEvent.change(boxOf(g), { target: { value: '[Net' } })
    expect(listbox()).toBeInTheDocument()
    fireEvent.keyDown(boxOf(g), { key: 'Escape' })
    fireEvent.change(boxOf(g), { target: { value: '[Net ' } })
    expect(listbox()).toBeNull()
    fireEvent.change(boxOf(g), { target: { value: '[Net P' } })
    expect(optionLabels()).toEqual(['Net P&L'])
    expect(boxOf(g)).toHaveAttribute('aria-autocomplete', 'list')
  })

  it('keyboard_path_arrow_enter_escape', async () => {
    const { onClose } = await openBuilder()
    const g = await addField('Edge', '', { wait: false })
    const box = boxOf(g)
    fireEvent.change(box, { target: { value: 'Su' } })
    const opts = () => within(listbox()).getAllByRole('option')
    expect(box).toHaveAttribute('aria-activedescendant', opts()[0].id)
    expect(opts()[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(box).toHaveAttribute('aria-activedescendant', opts()[1].id)
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    expect(box).toHaveAttribute('aria-activedescendant', opts()[0].id)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(box.value).toBe('SumIf(')
    expect(listbox()).toBeNull()
    // Tab inserts too: a field, through its closing bracket.
    fireEvent.change(box, { target: { value: 'SumIf([Net' } })
    fireEvent.keyDown(box, { key: 'Tab' })
    expect(box.value).toBe('SumIf([Net P&L]')
    // Escape closes the list: ONE level, never the builder.
    fireEvent.change(box, { target: { value: 'SumIf([Net P&L], [' } })
    expect(listbox()).toBeInTheDocument()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(listbox()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText(KEEP_QUESTION)).toBeNull()
    expect(box.value).toBe('SumIf([Net P&L], [')
  })

  it('the caret is UTF-16: an emoji before it never shifts an inserted suggestion (10.3 M1)', async () => {
    await openBuilder()
    const g = await addField('Edge', '', { wait: false })
    const box = boxOf(g)
    const before = 'If([Setup] = "🔥🔥", [Ne'
    fireEvent.change(box, { target: { value: before } })
    expect(box.selectionStart).toBe(before.length)            // UTF-16 units: each emoji is two
    fireEvent.keyDown(box, { key: 'Enter' })
    const after = 'If([Setup] = "🔥🔥", [Net P&L]'
    expect(box.value).toBe(after)
    expect(box.selectionStart).toBe(after.length)
    expect(box.selectionEnd).toBe(after.length)
  })

  it('twin_error_inline_without_a_request', async () => {
    await openBuilder()
    expect(previews()).toHaveLength(1)
    const g = await addField('Edge', '[nope] / 2', { wait: false })
    // At once, before any timer: the dialect's own sentence, as the box's description.
    const box = boxOf(g)
    expect(within(g).getByText("[nope] isn't a field here.")).toBeInTheDocument()
    expect(box).toHaveAccessibleDescription("[nope] isn't a field here.")
    expect(box).toHaveAttribute('aria-invalid', 'true')
    // ...and no request is made for a formula the twin refused.
    await flush(PREVIEW_DEBOUNCE_MS * 5)
    expect(previews()).toHaveLength(1)
    // Fixed, the preview runs again.
    fireEvent.change(box, { target: { value: '[Net P&L] / 2' } })
    expect(within(g).queryByText("[nope] isn't a field here.")).toBeNull()
    await settle()
    expect(previews()).toHaveLength(2)
  })

  it('the canonical-length check: typed under 2,000 but stored over it is too_long at 2000', async () => {
    const expr = Array(134).fill('[Risk $]').join('+')
    const r = compileFormula(expr, catalogFields(indexCatalog(FORMULA_CATALOG), { source: 'closed_trades' }))
    expect(r.ok).toBe(true)
    expect(expr.length).toBeLessThan(LIMITS.MAX_LENGTH)
    expect(r.compiled.canonical.length).toBeGreaterThan(LIMITS.MAX_LENGTH)
    await openBuilder()
    const g = await addField('Long', expr, { wait: false })
    // The server's position (2000, in the stored form) lies past the typed text: it is read as the box's end.
    expect(within(g).getByText('A formula can be at most 2,000 characters.')).toHaveAttribute('data-pos', String(expr.length))
    await settle()
    expect(previews()).toHaveLength(1)
  })

  it('the name is screened as the server screens it (W10-R47)', async () => {
    await openBuilder()
    const g = await addField('', '1', { wait: false })
    const name = nameOf(g)
    expect(name).toHaveAccessibleDescription(S_FORMULA_NAME)
    fireEvent.change(name, { target: { value: 'Edge​' } })
    expect(name).toHaveAccessibleDescription(S_BAD_CHARACTER)
    fireEvent.change(name, { target: { value: 'net p&l' } })
    expect(name).toHaveAccessibleDescription(S_FORMULA_NAME_TAKEN)
    fireEvent.change(name, { target: { value: 'x'.repeat(61) } })
    expect(name).toHaveAccessibleDescription(S_FORMULA_NAME_LONG)
    // An emoji name is the member's, joiners and all (W10-R48).
    fireEvent.change(name, { target: { value: '  ❤️‍🔥 hot  ' } })
    expect(name).not.toHaveAccessibleDescription()
    await settle()
    expect(lastPlan().formulas[0].name).toBe('  ❤️‍🔥 hot  ')
  })

  it('server_formula_error_by_id_and_pos', async () => {
    await openBuilder()
    await addField('One', '[Net P&L] / 2')
    route('POST', (u) => u.endsWith('/preview'), () => answer({ detail: {
      code: 'formula', message: 'Something is missing near "[Shares]".', formulaId: 'f2', pos: 8,
    } }, 400))
    const g2 = await addField('Two', '[Net P&L] / [Shares]')
    const g1 = fieldGroups()[0]
    // The server's sentence lands on the field it names, never on the other.
    expect(within(g2).getByText('Something is missing near "[Shares]".')).toBeInTheDocument()
    expect(within(g1).queryByText('Something is missing near "[Shares]".')).toBeNull()
    // Its position is read in the box: the server counted code points into the canonical form it was sent
    // (`[net] / [shares]`, pos 8 = the second field), the box shows labels (`[Net P&L] / [Shares]`, 12).
    expect(within(g2).getByText('Something is missing near "[Shares]".')).toHaveAttribute('data-pos', '12')
    expect(boxOf(g2)).toHaveAccessibleDescription('Something is missing near "[Shares]".')
    // An edit to that field clears it.
    fireEvent.change(boxOf(g2), { target: { value: '[Net P&L] / 3' } })
    expect(within(g2).queryByText('Something is missing near "[Shares]".')).toBeNull()
  })

  it('probe_first_row_and_skip_notice', async () => {
    route('POST', (u) => u.endsWith('/preview'), (u, init) => {
      const plan = JSON.parse(init.body).plan
      return answer(payload(plan.formulas ? {
        probe: [{ id: 'f1', first: 0.42, skipped: 4, notice: '[Risk $] is empty on 4 trades; those are skipped' }],
      } : {}))
    })
    await openBuilder()
    const g = await addField('Edge', '[Net P&L] / [Risk $]')
    expect(within(g).getByText('First trade: 0.42')).toBeInTheDocument()
    expect(within(g).getByText('[Risk $] is empty on 4 trades; those are skipped')).toBeInTheDocument()
    expect(boxOf(g)).toHaveAccessibleDescription(/First trade: 0\.42/)
    // The line belongs to the formula the preview ran: once the box changes, it waits for the next preview.
    fireEvent.change(boxOf(g), { target: { value: '[Net P&L] / [Risk $] / 2' } })
    expect(within(g).queryByText('First trade: 0.42')).toBeNull()
  })

  it('row_number_formula_offers_four_aggs', async () => {
    await openBuilder()
    const g = await addField('Half', '[Net P&L] / 2')
    const add = within(g).getByRole('group', { name: 'Add as a measure' })
    expect(within(add).getAllByRole('button').map((b) => b.textContent)).toEqual(['Total', 'Average', 'Lowest', 'Highest'])
    expect(within(g).queryByRole('button', { name: 'Split by this' })).toBeNull()      // a number splits through Bucket
    expect(within(g).getByRole('button', { name: 'Filter by this' })).toBeInTheDocument()
    fireEvent.click(within(add).getByRole('button', { name: 'Average' }))
    await settle()
    expect(lastPlan().measures).toEqual([{ key: 'net_pnl' }, { formula: 'f1', agg: 'avg' }])
    const measures = screen.getByRole('region', { name: 'What to measure' })
    expect(within(measures).getByRole('button', { name: 'Half (average). Change measures' })).toBeInTheDocument()
    // Already measured that way: pressed (pressing again takes it out), never added twice.
    expect(within(add).getByRole('button', { name: 'Average' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(add).getByRole('button', { name: 'Total' })).toHaveAttribute('aria-pressed', 'false')
    // "Filter by this" opens the filter on the field.
    fireEvent.click(within(g).getByRole('button', { name: 'Filter by this' }))
    expect(screen.getByRole('heading', { name: 'Half' })).toBeInTheDocument()
  })

  it('bool_formula_offers_count_and_share', async () => {
    await openBuilder()
    const g = await addField('Green', '[Net P&L] > 0')
    const add = within(g).getByRole('group', { name: 'Add as a measure' })
    expect(within(add).getAllByRole('button').map((b) => b.textContent)).toEqual(['How many', 'What share'])
    fireEvent.click(within(g).getByRole('button', { name: 'Split by this' }))
    await settle()
    expect(lastPlan().split).toMatchObject({ by: 'formula:f1' })
    const split = screen.getByRole('region', { name: 'Split it by' })
    expect(within(split).getByRole('button', { name: 'Split by Green. Change' })).toBeInTheDocument()
    fireEvent.click(within(add).getByRole('button', { name: 'What share' }))
    await settle()
    expect(lastPlan().measures.at(-1)).toEqual({ formula: 'f1', agg: 'share' })
  })

  it('aggregate_formula_no_split_offer', async () => {
    await openBuilder()
    const g = await addField('Wins', 'CountIf([Net P&L] > 0)')
    expect(within(g).getByRole('button', { name: 'Add as a measure' })).toBeInTheDocument()
    expect(within(g).queryByRole('button', { name: 'Split by this' })).toBeNull()
    expect(within(g).queryByRole('button', { name: 'Filter by this' })).toBeNull()
    expect(within(g).queryByRole('group', { name: 'Add as a measure' })).toBeNull()
    fireEvent.click(within(g).getByRole('button', { name: 'Add as a measure' }))
    await settle()
    expect(lastPlan().measures.at(-1)).toEqual({ formula: 'f1' })
  })

  it('a text formula is never a measure, but splits and filters', async () => {
    await openBuilder()
    const g = await addField('Day name', 'Weekday([Day])')
    expect(within(g).queryByRole('group', { name: 'Add as a measure' })).toBeNull()
    expect(within(g).queryByRole('button', { name: 'Add as a measure' })).toBeNull()
    expect(within(g).getByRole('button', { name: 'Split by this' })).toBeInTheDocument()
  })

  it('cap_five_sentence', async () => {
    await openBuilder()
    for (let i = 1; i <= 5; i += 1) await addField(`F${i}`, String(i), { wait: false })
    expect(fieldGroups()).toHaveLength(5)
    const addBtn = screen.getByRole('button', { name: 'Add your own field' })
    expect(addBtn).toHaveAttribute('aria-disabled', 'true')
    expect(addBtn).toHaveAccessibleDescription(S_FIELD_CAP)
    expect(screen.getByText('Use up to 5 of your own fields.')).toBeInTheDocument()
    fireEvent.click(addBtn)
    await flush()
    expect(fieldGroups()).toHaveLength(5)
  })

  it('undo_restores_formula: the builder Undo brings the settled formula back', async () => {
    await openBuilder()
    const g = await addField('Half', '[Net P&L] / 2')
    fireEvent.change(boxOf(g), { target: { value: '[Net P&L] / 3' } })
    await settle()
    expect(lastPlan().formulas[0].expr).toBe('[net] / 3')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await flush()
    expect(boxOf(fieldGroups()[0]).value).toBe('[Net P&L] / 2')
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    await flush()
    expect(boxOf(fieldGroups()[0]).value).toBe('[Net P&L] / 3')
    // Typing is ONE step per settled edit, not one per key.
    const steps = () => screen.getByRole('button', { name: 'Undo' })
    fireEvent.change(boxOf(fieldGroups()[0]), { target: { value: '[Net P&L] / 4' } })
    fireEvent.change(boxOf(fieldGroups()[0]), { target: { value: '[Net P&L] / 45' } })
    await settle()
    fireEvent.click(steps())
    await flush()
    expect(boxOf(fieldGroups()[0]).value).toBe('[Net P&L] / 3')
  })

  it('Remove field: <name> removes it and what reads it, in one step', async () => {
    await openBuilder()
    const g = await addField('Half', '[Net P&L] / 2')
    fireEvent.click(within(g).getByRole('button', { name: 'Average' }))
    await settle()
    fireEvent.click(within(g).getByRole('button', { name: 'Remove field: Half' }))
    await settle()
    expect(screen.queryAllByTestId('formula-field')).toHaveLength(0)
    expect(Object.hasOwn(lastPlan(), 'formulas')).toBe(false)
    expect(lastPlan().measures).toEqual([{ key: 'net_pnl' }])
    expect(lastPlan().v).toBe(1)
  })

  it('save sends the settled formula even when the box has not settled yet', async () => {
    route('POST', (u) => u.endsWith('/api/j2/widget-definitions'), () => answer({ id: 'd-2', rev: 1, etag: 1, name: 'x' }))
    await openBuilder()
    await addField('Half', '[Net P&L] / 2')
    fireEvent.change(boxOf(fieldGroups()[0]), { target: { value: '[Net P&L] / 9' } })
    fireEvent.click(screen.getByTestId('builder-save'))
    await flush()
    const posts = callsTo(fetchSpy, 'POST', (u) => u.endsWith('/api/j2/widget-definitions'))
    expect(posts).toHaveLength(1)
    expect(bodyOf(posts[0]).plan.formulas[0].expr).toBe('[net] / 9')
  })
})
