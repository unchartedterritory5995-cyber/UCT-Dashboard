// Finish program, lane FE — dark features stay out of the Notebook's first-open bytes.
//
// Three things used to ride in the first open for every member, flag on or off: the community
// template gallery (with the admin review panel), the gallery's publish form, and the tour
// offer gate with its eligibility rules. Each now loads only when its flag is on AND the
// member reaches it.
//
// Two kinds of rail, because they fail for different reasons:
//   * AST: none of them is imported STATICALLY from the first-open path (a comment naming the
//     file is not an import);
//   * behaviour: the door renders nothing and calls no loader with the switch off, and loads
//     with it on (a door that never opens would pass the first rail).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { makeTourOfferDoor } from './TourOfferDoor'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'

const JsxParser = Parser.extend(jsx())
const HERE = path.dirname(fileURLToPath(import.meta.url))
const J2 = path.resolve(HERE, '..', '..', '..')

function imports(rel) {
  const src = fs.readFileSync(path.join(J2, rel), 'utf8')
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const statics = []
  const dynamics = []
  ;(function visit(n) {
    if (!n || typeof n.type !== 'string') return
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source) statics.push(n.source.value)
    if (n.type === 'ImportExpression' && n.source?.type === 'Literal') dynamics.push(n.source.value)
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v.type === 'string') visit(v)
    }
  })(ast)
  return { statics, dynamics }
}

describe('no static import of a dark feature on the first-open path', () => {
  it('the template picker reaches the community gallery only by a dynamic import', () => {
    const { statics, dynamics } = imports('components/notebook/TemplatePicker.jsx')
    expect(statics).not.toContain('./TemplateGallery')
    expect(dynamics).toContain('./TemplateGallery')
  })

  it('My templates reaches the publish form only by a dynamic import', () => {
    const { statics, dynamics } = imports('components/notebook/MemberTemplates.jsx')
    expect(statics).not.toContain('./GalleryPublishForm')
    expect(dynamics).toContain('./GalleryPublishForm')
  })

  it('the Notebook reaches the tour offer only through its door', () => {
    const tab = imports('tabs/NotebookTab.jsx')
    expect(tab.statics.filter((s) => s.endsWith('/TourOfferGate'))).toEqual([])
    expect(tab.statics.filter((s) => s.endsWith('/TourOfferDoor'))).toHaveLength(1)
    const door = imports('components/notebook/onboarding/TourOfferDoor.jsx')
    expect(door.statics).not.toContain('./TourOfferGate')
    expect(door.dynamics).toEqual(['./TourOfferGate'])
    // the door itself stays tiny: nothing of the offer's rules rides in with it
    expect(door.statics.sort()).toEqual(['../../../lib/lazyChunk', '../../../lib/offline/notebookFlags', './gettingStartedPref', 'react'])
  })

  it('CONTROL — the walk sees a static import when there is one', () => {
    expect(imports('tabs/NotebookTab.jsx').statics).toContain('../components/notebook/TemplatePicker')
  })
})

describe('the tour offer door', () => {
  beforeEach(() => __resetNotebookFlags())
  afterEach(() => __resetNotebookFlags())
  const gate = () => vi.fn(async () => ({ default: ({ noteOpen }) => <p>offer gate, noteOpen={String(noteOpen)}</p> }))

  it('switch OFF: renders nothing and never asks for the gate', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: false })
    const load = gate()
    const Door = makeTourOfferDoor(load, 0)
    const { container } = render(<Door tours={[]} noteOpen={false} />)
    await new Promise((r) => setTimeout(r, 30))
    expect(container.innerHTML).toBe('')
    expect(load).not.toHaveBeenCalled()
  })

  it('never latched (the auth payload has not arrived): also nothing', async () => {
    const load = gate()
    const Door = makeTourOfferDoor(load, 0)
    render(<Door tours={[]} noteOpen={false} />)
    await new Promise((r) => setTimeout(r, 30))
    expect(load).not.toHaveBeenCalled()
  })

  it('switch ON: loads the gate and hands it every prop', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })
    const load = gate()
    const Door = makeTourOfferDoor(load, 0)
    render(<Door tours={[]} noteOpen />)
    expect(await screen.findByText('offer gate, noteOpen=true')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('a gate that cannot load is no offer, not a broken page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })
    const Door = makeTourOfferDoor(vi.fn(async () => { throw new Error('gone') }), 0)
    const { container } = render(<div><h1>Notebook</h1><Door tours={[]} noteOpen={false} /></div>)
    await new Promise((r) => setTimeout(r, 60))
    expect(screen.getByRole('heading', { name: 'Notebook' })).toBeInTheDocument()
    expect(container.querySelector('p')).toBeNull()
    vi.restoreAllMocks()
  })
})
