// UCT Terminal visual pass 2 — the form controls a terminal panel can show come from the app's
// ui kit (components/ui Select / Input / Checkbox), not hand-written native elements, so they
// carry one set of semantics and pick up the shell's themed control floor
// (TerminalShell.module.css, `:where(.panelBody) :where(select, input…)`).
//
// SCOPE: the shell plus every page / tab the terminal mounts as a panel (panels.jsx,
// surfacePanels.js), the same scope the visual audit counted. Partner-owned files are not in it.
//
// The two range sliders stay native: `ui` has no slider primitive (RangeSlider in research-kit is
// a two-thumb control with a different contract), so they are listed by file, not counted away.
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
const NATIVE_RANGE_OK = new Set(['pages/research/depth/CallReplayPanel.jsx', 'pages/breadth/BreadthScrubber.jsx'])

function files(rel) {
  const abs = path.join(SRC, rel)
  if (!fs.existsSync(abs)) return []
  if (fs.statSync(abs).isFile()) return [rel]
  return fs.readdirSync(abs).flatMap((n) => files(path.posix.join(rel, n)))
}

function nativeSites() {
  const out = []
  for (const f of SCOPE.flatMap(files)) {
    if (!/\.jsx$/.test(f) || /\.test\.jsx$/.test(f)) continue
    const lines = fs.readFileSync(path.join(SRC, f), 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
      for (const m of line.matchAll(/<(select|input)(?=[\s/>]|$)/g)) {
        const tag = lines.slice(i, i + 4).join(' ')
        const type = /\btype="([a-z-]+)"/.exec(tag.slice(m.index))?.[1] || 'text'
        out.push({ file: f, line: i + 1, el: m[1], type })
      }
    })
  }
  return out
}

describe('terminal-mounted surfaces use the ui form-control kit', () => {
  const sites = nativeSites()

  it('no native <select> remains', () => {
    expect(sites.filter((s) => s.el === 'select')).toEqual([])
  })

  it('the only native <input>s are the two range sliders the kit has no primitive for', () => {
    const left = sites.filter((s) => s.el === 'input')
    expect(left.filter((s) => !(s.type === 'range' && NATIVE_RANGE_OK.has(s.file)))).toEqual([])
    expect(left.map((s) => s.file).sort()).toEqual([...NATIVE_RANGE_OK].sort())
  })
})
