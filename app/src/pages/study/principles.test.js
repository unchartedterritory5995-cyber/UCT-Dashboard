// THE PRINCIPLES RAILS (docs/study/OWNER_PRINCIPLES.md; the workflow's pre-flight, docs/study/IMPROVEMENT_WORKFLOW.md).
// The owner's rules hold every Study screen; these are the ones a machine can check, scanned across the Study source so
// a new screen, or an old one edited, cannot quietly break them. Each fails by file and line.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LAB = path.join(HERE, '..', '..', 'lab')

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) return walk(p)
    return /\.jsx$/.test(d.name) && !/\.test\.jsx$/.test(d.name) ? [p] : []
  })
}

/** The code of a file with its comments blanked out (line numbers kept), so a rule is checked on what runs. */
function code(file) {
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, (m, a) => a + ' '.repeat(m.length - a.length))
}

function hits(re) {
  const out = []
  for (const f of walk(HERE)) {
    code(f).split('\n').forEach((line, i) => { if (re.test(line)) out.push(`${path.relative(HERE, f)}:${i + 1}: ${line.trim().slice(0, 120)}`) })
  }
  return out
}

describe("the owner's principles, on every Study screen", () => {
  it('rule 11: our name on screen is UCT, never "the firm"', () => {
    expect(hits(/the firm/i)).toEqual([])
  })

  it('rule 17: every Start, Check, Next and answer is the shared button or tile, never a hand-rolled one', () => {
    expect(hits(/className=\{`?\$?\{?d5\.(btn|startBtn|card|linkBtn)\b/)).toEqual([])
  })

  it('rule 1: every chart is the member\'s own widget, with our logo', () => {
    const chart = code(path.join(HERE, 'challenges', 'ChallengeChart.jsx'))
    expect(chart).toMatch(/look = 'widget'/)
    const player = code(path.join(HERE, 'DrillPlayer.jsx'))
    expect(player).not.toMatch(/showBrandMark=\{false\}/)
    expect(player).toMatch(/\bshowBrandMark\b/)
  })

  it('rule 2: one or two candles of room at the right edge of every chart (a phone gets three)', () => {
    for (const f of [path.join(HERE, 'challenges', 'ChallengeChart.jsx'), path.join(HERE, 'ui', 'StudyChart.jsx')]) {
      const pads = [...code(f).matchAll(/rightPadBars[:=]\s*\{?\s*phone \? (\d+) : (\d+)/g)]
      expect(pads.length, path.basename(f)).toBeGreaterThan(0)
      for (const m of pads) { expect(+m[1]).toBeLessThanOrEqual(3); expect(+m[2]).toBeLessThanOrEqual(2) }
    }
  })

  it('rule 17: the lab Start button every older screen presses is the shared button', () => {
    expect(code(path.join(LAB, 'StartCard.jsx'))).toMatch(/<StudyButton\b/)
  })
})
