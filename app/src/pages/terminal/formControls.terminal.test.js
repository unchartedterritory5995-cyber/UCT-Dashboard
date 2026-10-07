// UCT Terminal visual pass 2 — the form controls a terminal panel can show come from the app's
// ui kit (components/ui Select / Input / Checkbox / Slider), not hand-written native elements, so
// they carry one set of semantics and pick up the shell's themed control floor
// (TerminalShell.module.css, `:where(.panelBody) :where(select, input…)`).
//
// SCOPE: the shell plus every page / tab the terminal mounts as a panel (panels.jsx,
// surfacePanels.js), the same scope the visual audit counted. Partner-owned files are not in it.
//
// Visual pass 3 added `ui/Slider` (a themed single-thumb native range), so the two range sliders
// this file used to allow as native elements (CallReplayPanel, BreadthScrubber) now use it, and NO
// native <select> or <input> remains in scope. RangeSlider in research-kit is a two-thumb control
// with a different contract and is not what this counts.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const SRC = path.join(process.cwd(), 'src')
const SCOPE = [
  'pages/terminal', 'pages/research/tabs', 'pages/research/depth', 'components/research',
  'components/research-kit', 'pages/optionsAnalytics', 'pages/screener', 'pages/Calendar.jsx',
  'pages/calendar', 'pages/MorningWire.jsx', 'pages/UCT20.jsx', 'pages/Breadth.jsx', 'pages/breadth',
  'pages/FlowScoreboard.jsx', 'pages/CatalystsHistory.jsx', 'pages/PortfolioHeat.jsx',
]
const SLIDER_SITES = ['pages/research/depth/CallReplayPanel.jsx', 'pages/breadth/BreadthScrubber.jsx']

function files(rel) {
  const abs = path.join(SRC, rel)
  if (!fs.existsSync(abs)) return []
  if (fs.statSync(abs).isFile()) return [rel]
  return fs.readdirSync(abs).flatMap((n) => files(path.posix.join(rel, n)))
}

function sitesIn(f, text) {
  const out = []
  const lines = text.split(/\r?\n/)
  lines.forEach((line, i) => {
    const t = line.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
    for (const m of line.matchAll(/<(select|input)(?=[\s/>]|$)/g)) {
      const tag = lines.slice(i, i + 4).join(' ')
      const type = /\btype="([a-z-]+)"/.exec(tag.slice(m.index))?.[1] || 'text'
      out.push({ file: f, line: i + 1, el: m[1], type })
    }
  })
  return out
}

const scopeFiles = () => SCOPE.flatMap(files).filter((f) => /\.jsx$/.test(f) && !/\.test\.jsx$/.test(f))
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8')
const nativeSites = () => scopeFiles().flatMap((f) => sitesIn(f, read(f)))

describe('terminal-mounted surfaces use the ui form-control kit', () => {
  const sites = nativeSites()

  it('no native <select> remains', () => {
    expect(sites.filter((s) => s.el === 'select')).toEqual([])
  })

  it('no native <input> remains — the two range sliders use ui/Slider', () => {
    expect(sites.filter((s) => s.el === 'input')).toEqual([])
    for (const f of SLIDER_SITES) {
      const src = read(f)
      expect(src, `${f} no longer imports the Slider primitive`).toMatch(/import Slider from '[./]+\/components\/ui\/Slider'/)
      expect(src, `${f} no longer renders <Slider>`).toMatch(/<Slider\b/)
    }
  })

  // Non-vacuity: an empty site list must mean "nothing native", never "the scanner saw nothing".
  it('the scanner reads the scope, and still sees a native range and select when one is there', () => {
    const scanned = scopeFiles()
    for (const f of SLIDER_SITES) expect(scanned).toContain(f)
    const fixture = ['<div>', '  <input type="range"', '         min={0} />', '  <select value={x}>', '</div>'].join('\n')
    expect(sitesIn('fixture.jsx', fixture).map((s) => `${s.el}:${s.type}`)).toEqual(['input:range', 'select:text'])
  })
})
