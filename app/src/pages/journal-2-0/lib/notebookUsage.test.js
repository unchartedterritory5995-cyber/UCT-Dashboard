// Follow-up A (usage counting): the rails behind the eight usage events.
//  1. Each event's enum IS the place its ids are defined (one authority): VIEW_MODES, the template families and the
//     built-in note types, the widget registry, the row ids written on each menu row, the panel rows.
//  2. A menu row with no id fails here BY NAME (file and label), read by AST, never grep (a comment is not a row).
//  3. Every usage prop is an enum or a bool, so nothing a member typed can ride along.
//  4. The helpers: the note type picker's start, the insert door (one event per press), the side route hook.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { renderHook, cleanup } from '@testing-library/react'
import { EVENT_SCHEMAS, MEMBER_BUILT_KIND, NOTEBOOK_EVENTS, sanitizeProps } from './notebookTelemetry'
import { BUILT_KIND } from './builtWidgets'
import { insertDoorOpen, insertVia, kindStart, reportInsertedBlock, templateFamily, useRouteOpened, withInsertDoor } from './notebookUsage'
import { VIEW_MODES } from './savedViewModes'
import { FAMILIES } from './notebookTemplates'
import { BUILTIN_NOTE_KINDS } from './noteKinds'
import { REVIEW_PERIODS } from './reviewPeriods'
import { EXPORT_FORMATS } from '../components/notebook/export/exportFormats'
import { WIDGET_IDS } from '../../../widgets/registry'

const JsxParser = Parser.extend(jsx())
const HERE = path.dirname(fileURLToPath(import.meta.url))
const WAVE = path.resolve(HERE, '..')
const read = (rel) => fs.readFileSync(path.join(WAVE, rel), 'utf8')
const parse = (rel) => JsxParser.parse(read(rel), { ecmaVersion: 'latest', sourceType: 'module', locations: true })
const enumOf = (event, prop) => [...EVENT_SCHEMAS[event][prop].values].sort()
const sorted = (xs) => [...new Set(xs)].sort()

function visit(node, fn, parents = []) {
  if (!node || typeof node.type !== 'string') return
  fn(node, parents)
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach((c) => visit(c, fn, [...parents, node]))
    else if (v && typeof v.type === 'string') visit(v, fn, [...parents, node])
  }
}
const propName = (p) => p.type === 'Property' && (p.key.name || p.key.value)
const attr = (el, name) => el.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === name)
const attrLit = (el, name) => { const a = attr(el, name); return a?.value?.type === 'Literal' ? a.value.value : null }
const textOf = (el) => el.children.filter((c) => c.type === 'JSXText').map((c) => c.value.trim()).join(' ').trim()
const isButton = (n) => n.type === 'JSXElement' && n.openingElement.name.name === 'button'

// The menus whose rows are object literals (MenuRows items, the "+" sheet's rows).
const ROW_OBJECT_FILES = ['tabs/NotebookTab.jsx', 'components/notebook/NoteFormatMenu.jsx', 'components/notebook/NotebookPlusSheet.jsx']
// The menus whose rows are hand-written buttons.
const ROW_JSX_FILES = ['components/notebook/NoteEditorPage.jsx', 'components/notebook/NoteMenuActions.jsx',
  'components/notebook/NoteExportControls.jsx', 'components/notebook/SavedViewsMenuGroup.jsx']
// NoteMenuActions' own form controls (inside its Save as template form): not rows.
const FORM_CONTROLS = new Set(['Plain', 'Keep live blocks', 'Save template', 'Cancel'])

/** Every row object (`key` + `label`, and a `run`, `children` or `icon`) and the `row` it names. */
function rowObjects(rel) {
  const out = []
  visit(parse(rel), (n) => {
    if (n.type !== 'ObjectExpression') return
    const names = n.properties.map(propName)
    if (!names.includes('key') || !names.includes('label')) return
    if (!names.some((k) => k === 'run' || k === 'children' || k === 'icon')) return
    const label = n.properties.find((p) => propName(p) === 'label').value
    const row = n.properties.find((p) => propName(p) === 'row')
    const rowValue = !row ? undefined : row.value.type === 'Literal' ? row.value.value : '(expression)'
    out.push({ where: `${rel}:${n.loc.start.line}`, label: label.value ?? label.name ?? '(expression)', row: rowValue })
  })
  return out
}

/** The hand-written menu rows: role="menuitem(radio)" buttons, the note More panel's buttons, NoteMenuActions' rows. */
const rowOf = (rel, n) => ({
  where: `${rel}:${n.loc.start.line}`, label: textOf(n) || attrLit(n, 'aria-label') || '(button)',
  row: attr(n, 'data-row') ? (attrLit(n, 'data-row') ?? '(expression)') : undefined,
})

/** Fix round 1 (M6): the note More panel's rows, found STRUCTURALLY: every button rendered inside `<NoteMoreMenu>` in
 *  the editor, every button of a function handed to it as a prop (whatever its name), every button of a component
 *  rendered inside it (followed to its file through the editor's imports), and NoteMenuActions (the `noteMenu` render
 *  prop NotebookTab passes). A row defined in a new helper is found the same way and fails by name without an id.
 *  Not rows: a form's own controls inside a row (FORM_CONTROLS) and a chunk-failure "Reload". */
const NOT_ROWS = new Set([...FORM_CONTROLS, 'Reload'])
function morePanelRows() {
  const rel = 'components/notebook/NoteEditorPage.jsx'
  const ast = parse(rel)
  const imports = new Map()
  const decls = new Map()
  let panel = null
  visit(ast, (n) => {
    if (n.type === 'ImportDeclaration') for (const s of n.specifiers) imports.set(s.local.name, n.source.value)
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier') decls.set(n.id.name, n)
    if (n.type === 'JSXElement' && n.openingElement.name.name === 'NoteMoreMenu') panel = n
  })
  if (!panel) return []
  const out = []
  const files = new Set()
  const collect = (root, file) => visit(root, (n) => {
    if (isButton(n) && !NOT_ROWS.has(textOf(n))) out.push(rowOf(file, n))
    const name = n.type === 'JSXElement' && n.openingElement.name.name
    if (file === rel && name && /^[A-Z]/.test(name) && name !== 'UIcon' && name !== 'NoteMoreMenu' && imports.get(name)?.startsWith('./')) {
      files.add(`components/notebook/${imports.get(name).slice(2).replace(/\.jsx?$/, '')}.jsx`)
    }
  })
  collect(panel, rel)
  for (const a of panel.openingElement.attributes) {
    const id = a.value?.type === 'JSXExpressionContainer' && a.value.expression.type === 'Identifier' && a.value.expression.name
    if (id && decls.has(id)) collect(decls.get(id), rel)
  }
  files.add('components/notebook/NoteMenuActions.jsx')
  for (const f of files) collect(parse(f), f)
  return out
}

function rowButtons(rel) {
  const out = []
  visit(parse(rel), (n) => {
    if (!isButton(n)) return
    const role = attrLit(n, 'role')
    if (role === 'menuitem' || role === 'menuitemradio' || attr(n, 'data-row')) out.push(rowOf(rel, n))
  })
  return out
}

describe('a menu row with no usage id fails by name', () => {
  const objects = ROW_OBJECT_FILES.flatMap(rowObjects)
  // De-duplicated by place: a row both role-marked and inside the panel is one row.
  const buttons = [...new Map([...ROW_JSX_FILES.flatMap(rowButtons), ...morePanelRows()].map((b) => [b.where, b])).values()]

  it('NON-VACUITY: the walk found the menus it reads', () => {
    expect(objects.length).toBeGreaterThan(30)
    expect(buttons.length).toBeGreaterThan(12)
    expect(objects.map((o) => o.label)).toContain('Blank')
    expect(buttons.map((b) => b.label)).toEqual(expect.arrayContaining(['Duplicate note', 'History', 'Move to Trash', 'Ask about this note']))
  })

  it('every row object names its `row`', () => {
    expect(objects.filter((o) => o.row === undefined).map((o) => `${o.where} "${o.label}"`)).toEqual([])
  })

  it('every hand-written row carries `data-row`', () => {
    expect(buttons.filter((b) => b.row === undefined).map((b) => `${b.where} "${b.label}"`)).toEqual([])
  })

  it('menu_row_used.row is exactly the ids written on the rows (plus the ids derived from their own lists)', () => {
    const literal = [...objects, ...buttons].map((o) => o.row).filter((r) => typeof r === 'string' && r !== '(expression)')
    const derived = [
      ...VIEW_MODES.map((m) => m.id),                                   // modeRow: `row: id`
      ...REVIEW_PERIODS.map(({ period }) => `review_${period}`),        // draftReviewRow's children
      ...[...EXPORT_FORMATS.map((f) => f.id), 'png', 'print'].map((id) => `export_${id}`),   // NoteExportControls pick()
    ]
    expect(enumOf('menu_row_used', 'row')).toEqual(sorted([...literal, ...derived]))
  })
})

describe('each enum is its authority', () => {
  it('view_used.mode is VIEW_MODES', () => {
    expect(enumOf('view_used', 'mode')).toEqual(sorted(VIEW_MODES.map((m) => m.id)))
  })
  it('template_started.family is the catalogue families, the nine built-in note types and custom', () => {
    expect(BUILTIN_NOTE_KINDS).toHaveLength(9)
    expect(enumOf('template_started', 'family'))
      .toEqual(sorted([...FAMILIES.map((f) => f.key), ...BUILTIN_NOTE_KINDS.map((k) => k.id), 'custom']))
  })
  it("block_inserted.kind is the widget registry's ids, a member-built widget being 'custom'", () => {
    expect(WIDGET_IDS).toContain('builtWidget')
    expect(enumOf('block_inserted', 'kind')).toEqual(sorted([...WIDGET_IDS.filter((id) => id !== 'builtWidget'), 'custom']))
  })
  it('fix round 1 (I5): the server rail reads the registry the way the client derives it, and the built kind is one fact', () => {
    // tests/test_notebook_telemetry_events.py `registry_widget_ids`: PANEL_MANIFESTS' keys, parsed from source.
    // (a CRLF checkout is read as LF, as Python's universal newlines read it)
    const src = fs.readFileSync(path.resolve(WAVE, '..', '..', 'widgets', 'registry.js'), 'utf8').replace(/\r\n/g, '\n')
    const body = src.split('\nconst PANEL_MANIFESTS = {\n')[1].split('\n}\n')[0]
    expect([...body.matchAll(/^ {2}([A-Za-z0-9_]+): /gm)].map((m) => m[1])).toEqual(WIDGET_IDS)
    expect(MEMBER_BUILT_KIND).toBe(BUILT_KIND)
  })
  it('panel_row_used.row is the data-panel-row ids FolderSidebar draws', () => {
    const ids = []
    visit(parse('components/notebook/FolderSidebar.jsx'), (n) => {
      if (n.type === 'JSXAttribute' && n.name.name === 'data-panel-row' && n.value?.type === 'Literal') ids.push(n.value.value)
      if (n.type === 'JSXElement' && n.openingElement.name.name === 'RecencySection') ids.push(attrLit(n, 'usage'))
      if (n.type === 'VariableDeclarator' && n.id?.name === 'SHELF_ROW') ids.push(...n.init.properties.map((p) => p.value.value))
    })
    expect(enumOf('panel_row_used', 'row')).toEqual(sorted(ids))
  })
})

describe('nothing free-text can be sent', () => {
  const USAGE = ['view_used', 'list_layout_used', 'menu_row_used', 'today_door_used', 'template_started', 'block_inserted',
    'panel_row_used', 'notebook_route_opened']
  it('every usage prop is an enum or a bool', () => {
    for (const ev of USAGE) {
      expect(Object.values(NOTEBOOK_EVENTS)).toContain(ev)
      for (const [k, spec] of Object.entries(EVENT_SCHEMAS[ev])) expect(['enum', 'bool'], `${ev}.${k}`).toContain(spec.type)
    }
  })
  it('a title, a ticker or a folder name in any usage prop is sent as "other"', () => {
    const words = 'My NVDA thesis folder'
    for (const ev of USAGE) {
      const props = Object.fromEntries(Object.keys(EVENT_SCHEMAS[ev]).map((k) => [k, words]))
      const out = sanitizeProps(ev, { ...props, title: words })
      expect(JSON.stringify(out), ev).not.toContain('NVDA')
      for (const [k, spec] of Object.entries(EVENT_SCHEMAS[ev])) {
        if (spec.type === 'enum') expect(out[k]).toBe('other')
        else expect(out[k]).toBeUndefined()
      }
    }
  })
})

describe('the helpers', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })
  const telemetry = () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true })
    return () => spy.mock.calls.filter(([u]) => u === '/api/j2/telemetry').map(([, i]) => JSON.parse(i.body))
  }

  it("the note type picker's start: a type, a built-in style, a member's style", () => {
    expect(kindStart({ kindId: 'thesis' })).toEqual({ source: 'note_type', family: 'thesis' })
    expect(kindStart({ styleId: 'builtin:trade_plan' })).toEqual({ source: 'note_type', family: 'trade_plan' })
    expect(kindStart({ styleId: 's_123' })).toEqual({ source: 'own', family: 'custom' })
    expect(templateFamily('rituals')).toBe('rituals')
    expect(templateFamily('My NVDA family')).toBe('custom')
  })

  it('one door, one press: the first widget it adds is sent once, and nothing outside a door', () => {
    const sent = telemetry()
    reportInsertedBlock('chart')                                    // no door open: nothing
    withInsertDoor('palette', () => { reportInsertedBlock('chart'); reportInsertedBlock('watchlist') })
    withInsertDoor('slash', () => reportInsertedBlock('builtWidget'))
    expect(insertDoorOpen()).toBe(false)
    expect(sent()).toEqual([
      { event: 'block_inserted', props: { kind: 'chart', via: 'palette' } },
      { event: 'block_inserted', props: { kind: 'custom', via: 'slash' } },
    ])
  })

  it('fix round 1 (I4): the door is open only for the synchronous code it wraps; a later insert carries it explicitly', async () => {
    const sent = telemetry()
    let release
    let carried = null
    const p = withInsertDoor('phone_plus', () => { carried = insertVia(); return new Promise((r) => { release = r }) })
    expect(insertDoorOpen()).toBe(false)              // returned: closed, so a body reload or a paste cannot be claimed
    reportInsertedBlock('watchlist')                  // an insert that is not the member's press
    release()
    await p
    withInsertDoor(carried, () => reportInsertedBlock('tickerCard'))   // the press's own late insert
    withInsertDoor(null, () => reportInsertedBlock('chart'))           // no door: runs, counts nothing
    expect(sent()).toEqual([{ event: 'block_inserted', props: { kind: 'tickerCard', via: 'phone_plus' } }])
  })

  it('a side route counts once per mount, and not while it is off', () => {
    const sent = telemetry()
    const { rerender } = renderHook(({ on }) => useRouteOpened('playbook', on), { initialProps: { on: false } })
    expect(sent()).toEqual([])
    rerender({ on: true })
    rerender({ on: true })
    expect(sent()).toEqual([{ event: 'notebook_route_opened', props: { route: 'playbook' } }])
  })
})
