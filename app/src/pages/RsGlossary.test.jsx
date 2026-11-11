// The public RS glossary page (unit 4-06): it renders signed out at its route with no API call, it carries every
// glossary term and misconception from the one teaching source, its formulas match the server's constants, its
// outside links open safely, the Desk lessons say they are for members, and the App registers it as a public
// route that is not a sidebar entry. The page must not load the chart engine.
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import RsGlossary, {
  FURTHER_READING, MEMBERS_LESSON_LABEL, RS_GLOSSARY_PATH, RS_INDICATORS, RS_METHOD,
} from './RsGlossary'
import { GLOSSARY, MISCONCEPTIONS } from '../content/rs/teachingData'
import { NOT_ADVICE } from '../constants/disclaimer'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')
const REPO = path.resolve(SRC, '..', '..')
const read = (...p) => readFileSync(path.join(...p), 'utf8')

function renderAtRoute() {
  return render(
    <MemoryRouter initialEntries={[RS_GLOSSARY_PATH]}>
      <Routes>
        <Route path={RS_GLOSSARY_PATH} element={<RsGlossary />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Plan v4 §3: the banned list, plus "buy", "sell" and "guarantee". Whole words, any case. */
const BANNED = ['elite', 'powerful', 'unlock alpha', 'institutional accumulation', 'leading indicator',
  'crystal ball', 'buy', 'sell', 'guarantee']

describe('RsGlossary page', () => {
  let fetchSpy
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('no fetch')))
  })
  afterEach(() => {
    fetchSpy.mockRestore()
    cleanup()
  })

  it('renders signed out at /methodology/relative-strength and makes no API call', () => {
    expect(RS_GLOSSARY_PATH).toBe('/methodology/relative-strength')
    renderAtRoute()
    expect(screen.getByRole('heading', { level: 1, name: 'Relative Strength (RS)' })).toBeTruthy()
    for (const name of ['Glossary', 'Common misconceptions', 'How UCT computes it', 'Further reading']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy()
    }
    expect(screen.getByTestId('rs-glossary-not-advice').textContent).toBe(NOT_ADVICE)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('carries every glossary term and every misconception, word for word', () => {
    renderAtRoute()
    expect(GLOSSARY).toHaveLength(18)   // 15 of 04 §c + the three RS indicators the split added (U9)
    expect(MISCONCEPTIONS).toHaveLength(8)
    for (const t of GLOSSARY) {
      const row = screen.getByTestId(`rs-term-${t.key}`)
      expect(within(row).getByText(t.term, { selector: 'dt' })).toBeTruthy()
      expect(row.textContent).toContain(t.definition)
    }
    for (const m of MISCONCEPTIONS) {
      const row = screen.getByTestId(`rs-myth-${m.key}`)
      expect(row.textContent).toContain(m.myth)
      expect(row.textContent).toContain(m.truth)
    }
  })

  it('prints the formulas UCT ships', () => {
    renderAtRoute()
    expect(screen.getByTestId('rs-method')).toBeTruthy()
    const text = (id) => screen.getByTestId(id).textContent.replace(/\s+/g, ' ').trim()
    expect(text('rs-formula-line')).toBe('RS line = stock close ÷ benchmark close')
    expect(text('rs-formula-rating')).toBe(
      'Score = 40% × (close ÷ close 63 bars ago) + 20% × (close ÷ close 126 bars ago)'
      + ' + 20% × (close ÷ close 189 bars ago) + 20% × (close ÷ close 252 bars ago)',
    )
    expect(text('rs-method-rating')).toContain('scaled from 1 to 99')
    expect(text('rs-method-rating')).toContain('roughly 3, 6, 9, 12 months')
    expect(text('rs-formula-mansfield')).toBe('Mansfield RS = (RS line ÷ its 200-bar simple average − 1) × 100')
    expect(text('rs-formula-rotation')).toBe(
      'RS = 100 × stock close ÷ benchmark close'
      + 'RS-Ratio = 100 × RS ÷ 10-bar simple average of RS'
      + 'RS-Momentum = 100 × RS-Ratio ÷ 5-bar simple average of RS-Ratio',
    )
    expect(text('rs-formula-quality')).toBe('Quality = ((1 + b)252 − 1) × R²')
    expect(text('rs-method-quality')).toContain('last 90 closes')
    expect(text('rs-method-quality')).toContain('252-session year')
    expect(text('rs-formula-vars')).toContain('20-bar ATR')
    expect(text('rs-formula-vars')).toContain('sum of d over the last 60 bars')
    expect(text('rs-formula-vars')).toContain('50-bar simple average')
  })

  it('links the three outside references with noopener and noreferrer', () => {
    renderAtRoute()
    expect(FURTHER_READING.map((r) => r.key)).toEqual(['chartschool', 'ibd', 'stageanalysis'])
    for (const r of FURTHER_READING) {
      const a = screen.getByTestId(`rs-ref-${r.key}`)
      expect(a.getAttribute('href')).toBe(r.href)
      expect(a.getAttribute('href')).toMatch(/^https:\/\//)
      expect(a.getAttribute('target')).toBe('_blank')
      const rel = a.getAttribute('rel').split(/\s+/)
      expect(rel).toContain('noopener')
      expect(rel).toContain('noreferrer')
    }
    expect(screen.getByTestId('rs-ref-chartschool').getAttribute('href')).toContain('chartschool.stockcharts.com')
    expect(screen.getByTestId('rs-ref-stageanalysis').getAttribute('href')).toContain('stageanalysis.net')
  })

  it('labels every Desk lesson link as members-only and points it at the Desk', () => {
    renderAtRoute()
    const lessons = screen.getAllByRole('link', { name: MEMBERS_LESSON_LABEL })
    expect(lessons.length).toBeGreaterThanOrEqual(5)
    for (const a of lessons) expect(a.getAttribute('href')).toMatch(/^\/desk\?section=videos&v=[A-Za-z0-9_-]{11}/)
    // Every link on the page is one of: an in-page anchor, a members' Desk lesson, or an outside reference.
    for (const a of screen.getAllByRole('link')) {
      const href = a.getAttribute('href')
      const ok = href.startsWith('#') || a.textContent === MEMBERS_LESSON_LABEL
        || FURTHER_READING.some((r) => r.href === href)
      expect(ok, href).toBe(true)
    }
  })

  it('keeps the voice: no banned words, no emoji, and RSI only in the misconception that says RS is not RSI', () => {
    renderAtRoute()
    expectVoice()
  })
})

function expectVoice() {
  const page = screen.getByTestId('rs-glossary-page')
  const text = page.textContent
  for (const w of BANNED) expect(text, w).not.toMatch(new RegExp(`\\b${w}\\b`, 'i'))
  expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
  expect(text).not.toContain('!')
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT)
  const rsiHits = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\bRSI\b/.test(n.nodeValue)) rsiHits.push(n)
  expect(rsiHits.length).toBeGreaterThan(0)
  for (const n of rsiHits) {
    expect(n.parentElement.closest('[data-testid="rs-myth-rsIsNotRsi"]'), n.nodeValue).not.toBeNull()
  }
}

// ─── the RS split (U9): the page is true under BOTH builds ───────────────────────────
// The suite runs with `VITE_RS_SPLIT_ENABLED` deleted (test-setup.js): today's UCT Relative
// Strength. `vi.stubEnv` flips the engine-free reader (`lib/rsSplitFlag.js`) at render time.
describe('RsGlossary under the RS split flag (U9)', () => {
  const REG = read(SRC, 'components', 'chart', 'engine', 'nativeRegistry.js')
  const block = (marker) => { const at = REG.indexOf(marker); if (at < 0) throw new Error(`${marker} not found`); return REG.slice(at + marker.length) }
  const metaName = (marker) => block(marker).match(/\n    name: '([^']+)'/)[1]
  const metaDescription = (marker) => block(marker).match(/\n    description: '((?:[^'\\]|\\.)*)'/)[1].replace(/\\'/g, "'")
  let fetchSpy
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('no fetch'))) })
  afterEach(() => { fetchSpy.mockRestore(); vi.unstubAllEnvs(); cleanup() })

  it('flag OFF (the suite default): no indicators section, no split formulas, the screener readings named', () => {
    renderAtRoute()
    expect(screen.queryByTestId('rs-indicators')).toBeNull()
    expect(screen.queryByTestId('rs-method-phases')).toBeNull()
    expect(screen.queryByTestId('rs-method-vs-ema')).toBeNull()
    expect(screen.queryByRole('link', { name: 'The RS indicators' })).toBeNull()
    expect(screen.getByTestId('rs-method-screener').textContent).toBe('Readings in the screener')
    const text = (id) => screen.getByTestId(id).textContent.replace(/\s+/g, ' ')
    expect(text('rs-method-mansfield')).toContain('Mansfield RS column reads 200 daily bars')
    expect(text('rs-method-rotation')).toContain('weekly Rotation Quadrant column')
    expect(text('rs-method-quality')).toContain('Clenow Trend Score column')
    expect(text('rs-method-vars')).toContain('Volatility-Adjusted RS State column')
    expect(text('rs-method-rating-history')).toContain('21-session simple average and the 80 and 90 guides')
    // no sentence calls any of the four a chart Reading of UCT RS
    expect(screen.getByTestId('rs-method').textContent).not.toMatch(/\bReading\b/)
  })

  it('flag ON: the four indicators by the names the registry gives them, the RS Line sentence verbatim, lessons, formulas', () => {
    vi.stubEnv('VITE_RS_SPLIT_ENABLED', '1')
    renderAtRoute()
    expectVoice()
    expect(screen.getByRole('link', { name: 'The RS indicators' }).getAttribute('href')).toBe('#rs-indicators')
    const section = screen.getByTestId('rs-indicators')
    expect(within(section).getByRole('heading', { level: 2, name: 'The RS indicators on the chart' })).toBeTruthy()
    expect(RS_INDICATORS.map((i) => i.id)).toEqual(['rsLine', 'rsRating', 'rsPhases', 'rsVsEma'])
    const markers = {
      rsLine: 'const RS_LINE_SLIM_RAW = {', rsRating: 'const RS_RATING_RAW = {',
      rsPhases: 'const RS_PHASES_RAW = {', rsVsEma: 'const RS_VS_EMA_RAW = {',
    }
    for (const ind of RS_INDICATORS) {
      const row = within(section).getByTestId(`rs-indicator-${ind.id}`)
      expect(within(row).getByRole('heading', { level: 3, name: ind.name })).toBeTruthy()
      expect(ind.name, ind.id).toBe(metaName(markers[ind.id]))
      expect(row.textContent).toContain(ind.what)
      expect(ind.what.length).toBeGreaterThan(40)
      if (ind.lesson) expect(within(row).getByTestId(`rs-lesson-${ind.lesson}`).getAttribute('href')).toMatch(/^\/desk\?section=videos&v=/)
      else expect(within(row).queryByRole('link')).toBeNull()
    }
    // the RS Line sentence IS the slim definition's `meta.description`; the other three are the
    // glossary entries authored for them (one source with the export)
    expect(RS_INDICATORS[0].what).toBe(metaDescription(markers.rsLine))
    for (const [id, key] of [['rsRating', 'uctRsRating'], ['rsPhases', 'uctRsPhases'], ['rsVsEma', 'uctRsVsEma']]) {
      expect(RS_INDICATORS.find((i) => i.id === id).what).toBe(GLOSSARY.find((t) => t.key === key).definition)
    }
    // the lesson each block links is one the definition's `meta.learn` names
    expect(block(markers.rsPhases).split('\n  placement:')[0]).toContain("{ key: 'rsLine'")
    expect(block(markers.rsVsEma).split('\n  placement:')[0]).toContain("{ key: 'phase'")
    expect(block(markers.rsRating).split('\n  placement:')[0]).not.toContain('learn:')
    const text = (id) => screen.getByTestId(id).textContent.replace(/\s+/g, ' ').trim()
    expect(text('rs-formula-phases')).toBe(
      'RS trend = 3-bar EMA of the RS line ÷ its 10-bar EMA − 1'
      + 'Market trend = the same on the benchmark’s close'
      + 'Divergence = (RS trend − market trend) ÷ its 63-bar standard deviation, capped at 3',
    )
    expect(text('rs-formula-vs-ema')).toBe(
      'Distance = 100 × (RS line ÷ its 21-bar EMA − 1), in percent'
      + 'Fast = 3-bar EMA of the distance; slow = 13-bar EMA of the distance',
    )
    // still a public page with no API call
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the page and the engine read ONE flag: lib/rsSplitFlag.js, which the registry re-exports', () => {
    const lib = read(SRC, 'lib', 'rsSplitFlag.js')
    expect(lib.match(/import\.meta\.env\.VITE_RS_SPLIT_ENABLED === '1'/g)).toHaveLength(1)
    expect(REG).toContain("import { rsSplitEnabled } from '../../../lib/rsSplitFlag.js'")
    expect(REG).toContain('export { rsSplitEnabled }')
    expect(REG).not.toMatch(/import\.meta\.env\.VITE_RS_SPLIT_ENABLED/)
    expect(read(SRC, 'pages', 'RsGlossary.jsx')).toContain("import { rsSplitEnabled } from '../lib/rsSplitFlag'")
  })
})

describe('RsGlossary formulas are pinned to the server constants', () => {
  const rsw = read(REPO, 'api', 'services', 'rs_weighted_return.py')
  const rsm = read(REPO, 'api', 'services', 'relative_strength.py')
  const hist = read(REPO, 'api', 'services', 'screener', 'rs_history.py')
  const constant = (src, name) => {
    const m = src.match(new RegExp(`^${name}\\s*=\\s*([0-9.]+)`, 'm'))
    if (!m) throw new Error(`constant ${name} not found`)
    return Number(m[1])
  }

  it('the IBD-style rating weights equal IBD_TERMS and its scale equals RATING_MAX', () => {
    const block = rsw.match(/^IBD_TERMS[^=]*=\s*\(([\s\S]*?)^\)/m)
    expect(block, 'IBD_TERMS not found').not.toBeNull()
    const terms = [...block[1].matchAll(/\(\s*"[^"]+"\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)/g)]
      .map((m) => [Number(m[1]), Number(m[2])])
    expect(terms).toEqual(RS_METHOD.ratingTerms.map(([b, w]) => [b, w]))
    expect(constant(hist, 'RATING_MAX')).toBe(RS_METHOD.ratingMax)
  })

  it('the split\'s numbers equal relative_strength.py, rs_provider.py and the rsRating guides (U9)', () => {
    expect(constant(rsm, 'DEFAULT_PHASES_SHORT')).toBe(RS_METHOD.phasesShort)
    expect(constant(rsm, 'DEFAULT_PHASES_LONG')).toBe(RS_METHOD.phasesLong)
    expect(constant(rsm, 'PHASES_SIGMA_WINDOW')).toBe(RS_METHOD.phasesSigmaWindow)
    expect(constant(rsm, 'PHASES_Z_CLAMP')).toBe(RS_METHOD.phasesZClamp)
    // the vs-EMA length is the RS line's own average length, by construction
    expect(rsm).toMatch(/^DEFAULT_VS_EMA_LENGTH = DEFAULT_MA_LENGTH\b/m)
    expect(constant(rsm, 'DEFAULT_MA_LENGTH')).toBe(RS_METHOD.vsEmaLength)
    expect(constant(rsm, 'DEFAULT_VS_EMA_FAST')).toBe(RS_METHOD.vsEmaFast)
    expect(constant(rsm, 'DEFAULT_VS_EMA_SLOW')).toBe(RS_METHOD.vsEmaSlow)
    const prov = read(REPO, 'api', 'services', 'signature', 'rs_provider.py')
    expect(constant(prov, '_RS_RATING_MA')).toBe(RS_METHOD.ratingMaLength)
    const reg = read(SRC, 'components', 'chart', 'engine', 'nativeRegistry.js')
    const rating = reg.slice(reg.indexOf('const RS_RATING_RAW = {'))
    expect(rating).toContain(`levels: [${RS_METHOD.ratingGuides.join(', ')}]`)
  })

  it('the line, Mansfield, rotation, Clenow and VARS defaults equal relative_strength.py', () => {
    expect(constant(rsm, 'DEFAULT_LOOKBACK')).toBe(RS_METHOD.newHighLookback)
    expect(constant(rsm, 'DEFAULT_MANSFIELD_LENGTH')).toBe(RS_METHOD.mansfieldLength)
    expect(constant(rsm, 'DEFAULT_RRG_RATIO_LEN')).toBe(RS_METHOD.rotationRatioLen)
    expect(constant(rsm, 'DEFAULT_RRG_MOM_LEN')).toBe(RS_METHOD.rotationMomLen)
    expect(constant(rsm, 'DEFAULT_CLENOW_WINDOW')).toBe(RS_METHOD.clenowWindow)
    expect(constant(rsm, 'CLENOW_ANNUALISATION_BARS')).toBe(RS_METHOD.clenowYear)
    expect(constant(rsm, 'DEFAULT_CLENOW_GAP_PCT')).toBe(RS_METHOD.clenowGapPct)
    expect(constant(rsm, 'DEFAULT_ATR_LENGTH')).toBe(RS_METHOD.atrLength)
    expect(constant(rsm, 'DEFAULT_VARS_LOOKBACK')).toBe(RS_METHOD.varsLookback)
    expect(constant(rsm, 'DEFAULT_VARS_MA_LENGTH')).toBe(RS_METHOD.varsMaLength)
  })

  it('the rotation formula the page prints is the one rrg_columns documents', () => {
    expect(rsm).toContain('RS[t]          = 100 × C[t] / B[t]')
    expect(rsm).toContain('rsRatio[t]     = 100 × RS[t] / SMA(RS, ratio_len)[t]')
    expect(rsm).toContain('rsMomentum[t]  = 100 × rsRatio[t] / SMA(rsRatio, mom_len)[t]')
    expect(rsm).toContain('clenowAnnual  = (1 + b)^252 − 1')
    expect(rsm).toContain('clenowScore   = clenowAnnual × clenowR2')
    expect(rsm).toContain('MRS[t] = (RP[t] / SMA(RP, n)[t] − 1) × 100')
  })
})

describe('RsGlossary route and bundle', () => {
  const app = read(SRC, 'App.jsx')

  it('is a lazy, public route beside /methodology/measured-edge, outside AuthGuard and not in NAV_ITEMS', () => {
    expect(app).toMatch(/const RsGlossary = lazy\(\(\) => import\('\.\/pages\/RsGlossary'\)\)/)
    const route = '<Route path="/methodology/relative-strength" element={<RsGlossary />} />'
    const at = app.indexOf(route)
    expect(at, 'route not registered').toBeGreaterThan(-1)
    expect(app.indexOf(route, at + 1), 'registered twice').toBe(-1)
    const guard = app.indexOf('<Route element={<AuthGuard />}>')
    expect(guard).toBeGreaterThan(-1)
    expect(at).toBeLessThan(guard)
    expect(app.indexOf('<Route path="/methodology/measured-edge" element={<MeasuredEdgeMethod />} />')).toBeLessThan(guard)
    const nav = read(SRC, 'components', 'NavBar.jsx')
    const navItems = nav.slice(nav.indexOf('export const NAV_ITEMS'), nav.indexOf('];', nav.indexOf('export const NAV_ITEMS')))
    expect(navItems).not.toContain('/methodology/relative-strength')
  })

  it('never reaches the chart engine or teaching.js through its static imports', () => {
    const seen = new Set()
    const resolve = (from, spec) => {
      const base = path.resolve(path.dirname(from), spec)
      for (const cand of [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js')]) {
        if (existsSync(cand) && !cand.endsWith(path.sep) && /\.(jsx?|css)$/.test(cand)) return cand
      }
      throw new Error(`unresolved ${spec} from ${from}`)
    }
    const walk = (file) => {
      if (seen.has(file) || file.endsWith('.css')) return
      seen.add(file)
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/g)) walk(resolve(file, m[1]))
      for (const m of src.matchAll(/(?:^|\n)\s*import\s+['"](\.[^'"]+)['"]/g)) walk(resolve(file, m[1]))
    }
    walk(path.join(SRC, 'pages', 'RsGlossary.jsx'))
    const rel = [...seen].map((f) => path.relative(SRC, f).split(path.sep).join('/'))
    expect(rel).toContain('content/rs/teachingData.js')
    expect(rel).not.toContain('content/rs/teaching.js')
    expect(rel.filter((f) => f.startsWith('components/chart/'))).toEqual([])
  })
})

describe('RsGlossary type floor (spec §12.2: no text under 11 px)', () => {
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'RsGlossary.module.css'), 'utf8')
    .replace(/[/][*][^]*?[*][/]/g, '')
  it('no rule takes --text-xs (10 px on desktop) and no literal size is under 11 px', () => {
    expect(css).not.toMatch(/--text-xs/)
    const px = [...css.matchAll(/font-size:[ ]*([0-9.]+)px/g)].map((m) => Number(m[1]))
    expect(px.filter((n) => n < 11)).toEqual([])
  })
  it('a superscript (the 252 under the root) keeps the 11 px floor', () => {
    expect(css).toMatch(/[.]formula sup, [.]body sup [{][^}]*font-size: max[(]0[.]75em, 11px[)]/)
  })
})
