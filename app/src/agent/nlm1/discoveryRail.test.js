// DESCRIPTION-DRIVEN DISCOVERY: the rail. Every capability, on every surface, reaches the request from a query built out of
// its OWN description, with every phrase layer off: no v1 regex, no vocabulary, no fallback fill. A capability that cannot is
// listed in UNREACHABLE with its reason, and the list may only shrink. This proves the capability reaches the model; it does
// not prove the model uses it.
import { describe, it, expect, afterEach } from 'vitest'
import { registerCatalog } from '../qa/capabilityRegression/testing/registry'
import { routedNames } from '../qa/capabilityRegression/testing/route'
import { GROUPS, V1_ONLY_WORDS, groupOfAction, selectGroups } from '../routing'
import { MANIFEST_CONTRACT, manifestFor } from '../capabilities'
import { buildIndex, capabilityScores, capabilityTokens, resolveTokens, stem } from './capabilityIndex'
import { routeManifestV2, selectGroupsV2 } from './routingV2'

await registerCatalog()

const SURFACES = ['charts', 'screener', 'breadth', 'calendar', 'journal']
const manifestOn = (surface) => manifestFor({ surface, createIndicator: true, manageIndicators: true })
const OPTS = { enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold }

// Every capability is reachable today. A new entry needs a reason a reviewer can check.
const UNREACHABLE = {}

const withoutPhrases = (fn) => {
  globalThis.__NLM1_TUNING__ = { PHRASES: false, VOCAB_W: 0 }
  try { return fn() } finally { globalThis.__NLM1_TUNING__ = null }
}
afterEach(() => { globalThis.__NLM1_TUNING__ = null })

const words = (s) => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]/g, ' ').toLowerCase()
const firstSentence = (s) => String(s).replace(/\(.*?\)/g, ' ').split(/(?<=[.:;])\s/)[0]
/** The four words of its description that tell this capability from the others: its name's and summary's rarest. */
function distinctive(index, c) {
  const raw = [...new Set(words(`${c.name} ${c.summary}`).match(/[a-z0-9]+/g) || [])]
  const rank = (w) => index.capIdf.get(stem(w)) || 0
  return raw.filter(w => capabilityTokens(w).length).sort((a, b) => rank(b) - rank(a)).slice(0, 4).join(' ')
}
function reaches(manifest, name, text) {
  const sel = selectGroupsV2(text, { manifest })
  if (!sel.matched || !sel.selected.includes(groupOfAction(name))) return false
  return routeManifestV2(manifest, text, OPTS).manifest.some(c => c.name === name)
}

describe('every capability reaches the request from its own description', () => {
  for (const surface of SURFACES) {
    it(`${surface}: at least one description-derived query, no phrase rule`, () => {
      const manifest = manifestOn(surface)
      const index = buildIndex(manifest)
      const missing = withoutPhrases(() => manifest.filter(c => groupOfAction(c.name)).filter(c => !UNREACHABLE[c.name] && ![words(c.name), firstSentence(c.summary), distinctive(index, c)].some(q => reaches(manifest, c.name, q))))
      expect(missing.map(c => c.name)).toEqual([])
    })
  }
  it('most capabilities hold on the shortest forms too', () => {
    const manifest = manifestOn('charts')
    const index = buildIndex(manifest)
    const held = (form) => withoutPhrases(() => manifest.filter(c => groupOfAction(c.name) && reaches(manifest, c.name, form(c))).length) / manifest.length
    expect(held(c => words(c.name))).toBeGreaterThanOrEqual(0.95)
    expect(held(c => distinctive(index, c))).toBeGreaterThanOrEqual(0.9)
  })
  it('UNREACHABLE names only registered capabilities, each with a reason', () => {
    const known = new Set(SURFACES.flatMap(s => manifestOn(s).map(c => c.name)))
    for (const [name, why] of Object.entries(UNREACHABLE)) {
      expect(known.has(name), name).toBe(true)
      expect(why.length).toBeGreaterThan(20)
    }
  })
})

describe('a capability that ships tomorrow needs no phrase words', () => {
  const full = () => manifestOn('charts')
  const fake = (name) => ({ name, domain: name.split('.')[0], target: 'x', summary: 'Zorbify the quantum flux capacitor of one list', hints: 'target = the ref.', args: { type: 'object', properties: { flux: { type: 'string', enum: ['warp', 'glide'] } }, required: ['flux'], additionalProperties: false }, risk: 'local', reversible: true, undo: 'exact', query: false })
  for (const name of ['watchlist.zorbify', 'drawing.zorbify', 'widget.zorbify', 'chart.zorbify']) {
    it(`${name} reaches the first request by its own words, phrase layers on`, () => {
      const manifest = [...full(), fake(name)]
      for (const text of ['zorbify the capacitor', 'set the flux to warp', 'could you zorbify this please']) expect(routeManifestV2(manifest, text, OPTS).manifest.some(c => c.name === name), text).toBe(true)
    })
  }
  it('adding one changes nothing for a message that does not name it', () => {
    const route = (m) => routeManifestV2(m, 'add the 9 ema', OPTS).manifest.map(c => c.name)
    expect(route([...full(), fake('watchlist.zorbify')]).filter(n => n !== 'watchlist.zorbify')).toEqual(route(full()))
  })
})

describe('the cases this work exists for reach the first request', () => {
  const sent = (text, name) => routedNames(text, { v2: true }).names.includes(name)
  it.each([
    ['flag this name', 'watchlist.setFlag'], ['unflag these three', 'watchlist.setFlag'],
    ['draw a pitchfork', 'drawing.add'], ['draw a parallel channel', 'drawing.add'],
    ['reset the view', 'chartSetup.resetView'], ['hide every indicator', 'chartSetup.setIndicatorsHidden'],
    ['hide all the moving averages', 'chartSetup.setMovingAverages'], ['show all indicators again', 'chartSetup.setIndicatorsHidden'],
  ])('%s → %s', (text, name) => expect(sent(text, name)).toBe(true))
})

describe('the words are the capabilities\' own', () => {
  it('a word reads as its root across its forms', () => {
    for (const [a, b] of [['flag', 'flagged'], ['flag', 'flagging'], ['save', 'saved'], ['save', 'saving'], ['move', 'moved'], ['line', 'lines'], ['drop', 'dropped'], ['colour', 'color']]) expect(stem(a), `${a}/${b}`).toBe(stem(b))
    expect(stem('news')).not.toBe(stem('new'))
    expect(stem('settings')).not.toBe(stem('set'))
  })
  it('a prefix or a compound resolves only onto words the registry uses', () => {
    const index = buildIndex(manifestOn('charts'))
    expect(resolveTokens(index, ['unwatermark'])).toEqual([stem('watermark')])
    expect(resolveTokens(index, [stem('gridlines')])).toEqual(expect.arrayContaining(['grid']))
    expect(resolveTokens(index, ['zzzqqq'])).toEqual(['zzzqqq'])
  })
  it('a pointer to another capability is not evidence for this one', () => {
    const index = buildIndex([...manifestOn('charts'), { name: 'layout.zorbify', summary: 'Zorbify. For a chart use chart.setSymbol.', hints: null, args: { type: 'object', properties: {} } }])
    const hits = capabilityScores(index, [stem('symbol')]).map(([n]) => n)
    expect(hits).not.toContain('layout.zorbify')
  })
})

describe('#825 words: v2 reads none of the two it replaced; v1 still does', () => {
  const v1Only = ['reset the zoom', 'hide all the moving averages']
  it('v1 selects chartSetup from them (the kill-switch path is unchanged)', () => {
    for (const text of v1Only) expect(selectGroups(text).selected).toContain('chartSetup')
  })
  it('v2 reads the group\'s other words only', () => {
    expect(V1_ONLY_WORDS.size).toBe(2)
    const words2 = GROUPS.find(g => g.id === 'chartSetup').words
    for (const re of V1_ONLY_WORDS) expect(words2).toContain(re)
    for (const text of v1Only) expect(selectGroups(text, { without: V1_ONLY_WORDS }).selected.includes('chartSetup') && selectGroups(text, { without: V1_ONLY_WORDS }).matched).toBe(false)
  })
  it('and still reaches the capabilities, phrase layers on', () => {
    expect(routedNames('reset the zoom', { v2: true }).names).toContain('chartSetup.resetView')
    expect(routedNames('hide all the moving averages', { v2: true }).names).toContain('chartSetup.setMovingAverages')
  })
})
