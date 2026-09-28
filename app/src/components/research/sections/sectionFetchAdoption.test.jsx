// app/src/components/research/sections/sectionFetchAdoption.test.jsx
//
// TERM-033 (FB-A8-02) — the sibling fetchers route through sectionFetch.js.
//
// sectionFetch.test.js pins the FETCHER: a failure rejects. That proves
// nothing about a section that never imports it. Two sections in this
// directory still carried their own `fetch(u).then(r => r.ok ? r.json() :
// null)` plus the swallow, so a dropped connection reached them as `null`
// and they rendered it as a fact about the company — StatementPanels said
// "Statement history is unavailable for this ticker." and SetupSection
// silently dropped its consensus line. That is the NVDA shape (a 15KB
// answer rendered as "No recent news for this ticker.") on two more doors.
//
// Three parts, each able to fail:
//   1. the source rail — each named site imports sectionFetch and hand-rolls
//      no fetch, with controls proving the detector fires on the old shape
//      and does NOT fire on the idiom quoted inside a comment;
//   2. the behaviour — a real SWR + a failing fetch renders the failure copy,
//      and an empty-but-successful answer still renders the quiet-ticker copy
//      (an empty result and a dropped error must not share a path);
//   3. the census — the population across app/src, printed as the
//      denominator in the test title. Named, NOT migrated here: "six" was a
//      family, not a count, and the census is its own ticket.
//
// ⛔ The needle is BUILT, never written out, so this file cannot count itself.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { FETCH_FAILED } from './sectionFetch'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '../../..') // app/src

// ── the needle ───────────────────────────────────────────────────────────────
const NEEDLE_TEXT = '.catch(() ' + '=> null)'
// Whitespace-tolerant: `.catch(()=>null)` swallows exactly as much.
const SWALLOW = new RegExp('\\.catch\\(\\s*\\(\\s*\\)\\s*=>\\s*null\\s*\\)')
// A hand-rolled fetcher: a bare `fetch(` call (not `.fetch(`, not `sectionFetcher(`).
const RAW_FETCH = /(^|[^\w.$])fetch\s*\(/
// `./sectionFetch` from a sibling, `…/research/sections/sectionFetch` from a hook.
const IMPORTS_SECTION_FETCH = /\b(?:import|export)\b[^;]*?\bfrom\s*['"](?:\.\/|[./\w-]*\/research\/sections\/)sectionFetch['"]/

// Blank out line and block comments (JSX comment braces included), leaving
// string and template contents alone so a `//` inside a URL does not cut the
// line. ⚠️ Regex literals are not modelled — a quote inside one can mis-open a
// string. That can only move the CENSUS by a file or two; the per-site rail
// reads four known files whose sources are checked by eye in review.
function stripComments(src) {
  let out = ''
  let i = 0
  let str = null
  while (i < src.length) {
    const ch = src[i]
    const nx = src[i + 1]
    if (str) {
      out += ch
      if (ch === '\\') { out += nx ?? ''; i += 2; continue }
      if (ch === str || (ch === '\n' && str !== '`')) str = null
      i += 1
      continue
    }
    if (ch === '/' && nx === '/') {
      while (i < src.length && src[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && nx === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end === -1 ? src.length : end + 2
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') str = ch
    out += ch
    i += 1
  }
  return out
}

const swallows = (src) => SWALLOW.test(stripComments(src))

// ── 1. the source rail ───────────────────────────────────────────────────────
// Paths under app/src. The first three are the spec's recut (paidFetcher.js
// was already migrated — its grep hit is a comment). useTranscript.js was
// found by a sibling ticket: same idiom, and a failed fetch read as
// "Transcript not available." in TranscriptPanel.
const NAMED_SITES = [
  'components/research/sections/SetupSection.jsx',
  'components/research/sections/StatementPanels.jsx',
  'components/research/sections/paidFetcher.js',
  'hooks/useTranscript.js',
]

describe('TERM-033 — the detector can fail (controls)', () => {
  it('fires on the old fetcher shape', () => {
    const old = 'const fetcher = (u) => fetch(u).then((r) => (r.ok ? r.json() : null))' + NEEDLE_TEXT
    expect(swallows(old)).toBe(true)
    expect(RAW_FETCH.test(stripComments(old))).toBe(true)
    expect(IMPORTS_SECTION_FETCH.test(old)).toBe(false)
  })

  it('fires on the whitespace-free spelling too', () => {
    expect(swallows('p.catch(()' + '=>null)')).toBe(true)
  })

  it('does NOT fire on the idiom quoted in a comment', () => {
    expect(swallows('// this file used to ' + NEEDLE_TEXT)).toBe(false)
    expect(swallows('/* was\n  fetch(u)' + NEEDLE_TEXT + '\n*/')).toBe(false)
    expect(swallows('<div>{/* ' + NEEDLE_TEXT + ' */}</div>')).toBe(false)
  })

  it('a // inside a string does not hide a real occurrence after it', () => {
    expect(swallows("const u = 'http://x'; p" + NEEDLE_TEXT)).toBe(true)
  })

  it('recognises the migrated import and re-export forms', () => {
    expect(IMPORTS_SECTION_FETCH.test("import { FETCH_FAILED, sectionFetcher } from './sectionFetch'")).toBe(true)
    expect(IMPORTS_SECTION_FETCH.test("export { sectionFetcher as paidFetcher } from './sectionFetch'")).toBe(true)
    expect(IMPORTS_SECTION_FETCH.test("import { sectionFetcher } from '../components/research/sections/sectionFetch'")).toBe(true)
    expect(IMPORTS_SECTION_FETCH.test("import { sectionFetcher } from './otherFetch'")).toBe(false)
    expect(RAW_FETCH.test('useSWR(key, sectionFetcher)')).toBe(false)
  })
})

describe('TERM-033 — every named site routes through sectionFetch.js', () => {
  it.each(NAMED_SITES)('%s imports sectionFetch, hand-rolls no fetch, swallows nothing', (file) => {
    const raw = fs.readFileSync(path.join(SRC, file), 'utf8')
    const src = stripComments(raw)
    expect(IMPORTS_SECTION_FETCH.test(src), `${file} does not import ./sectionFetch`).toBe(true)
    expect(RAW_FETCH.test(src), `${file} still calls fetch() itself`).toBe(false)
    expect(SWALLOW.test(src), `${file} still swallows with ${NEEDLE_TEXT}`).toBe(false)
  })
})

// ── 2. the behaviour — real SWR, a failing fetch ─────────────────────────────
vi.mock('../../../hooks/useFundamentals', () => ({ default: () => ({ data: null }) }))

import StatementPanels from './StatementPanels'
import SetupSection from './SetupSection'
import TranscriptPanel from '../../calendar/TranscriptPanel'

const FAILURES = [
  ['a dropped connection (the NVDA shape)', () => Promise.reject(new TypeError('Failed to fetch'))],
  ['a 502 from a restarting pod', () => Promise.resolve({ ok: false, status: 502, json: async () => null })],
]
const answer = (body) => () => Promise.resolve({ ok: true, status: 200, json: async () => body })

// A fresh cache per render and no retry timer, so each test sees its own fetch.
const withSWR = (node) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    {node}
  </SWRConfig>,
)

beforeEach(() => { vi.unstubAllGlobals() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('StatementPanels — a failed request is not "unavailable for this ticker"', () => {
  it.each(FAILURES)('%s renders the failure copy', async (_label, impl) => {
    vi.stubGlobal('fetch', vi.fn(impl))
    withSWR(<StatementPanels sym="NVDA" />)
    expect(await screen.findByText(FETCH_FAILED.title)).toBeTruthy()
    expect(screen.queryByText(/unavailable for this ticker/i)).toBeNull()
    // The controls stay, so the reader can still flip period.
    expect(screen.getByRole('button', { name: /^Annual$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Retry$/i })).toBeTruthy()
  })

  it('CONTROL: an empty-but-successful answer still says the ticker has no history', async () => {
    vi.stubGlobal('fetch', vi.fn(answer({ sym: 'XYZ', period: 'quarter', periods: [], series: {} })))
    withSWR(<StatementPanels sym="XYZ" />)
    expect(await screen.findByText(/unavailable for this ticker/i)).toBeTruthy()
    expect(screen.queryByText(FETCH_FAILED.title)).toBeNull()
  })
})

describe('SetupSection — a failed estimates request is not a missing consensus line', () => {
  it.each(FAILURES)('%s says the request failed where the drift line sits', async (_label, impl) => {
    vi.stubGlobal('fetch', vi.fn(impl))
    withSWR(<SetupSection sym="NVDA" row={{ sym: 'NVDA' }} reportDate="2026-08-06" expectedMove={null} />)
    const failed = await screen.findByTestId('setup-drift-failed')
    expect(failed.textContent).toMatch(/request failed/i)
    expect(screen.queryByTestId('setup-drift')).toBeNull()
  })

  it('CONTROL: a successful answer with no Current Qtr row renders no line and no failure', async () => {
    const fetchSpy = vi.fn(answer({ sym: 'XYZ', revisions: [] }))
    vi.stubGlobal('fetch', fetchSpy)
    withSWR(<SetupSection sym="XYZ" row={{ sym: 'XYZ' }} reportDate="2026-08-06" expectedMove={null} />)
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    // Let the resolved answer land before asserting its absence.
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(screen.queryByTestId('setup-drift-failed')).toBeNull()
    expect(screen.queryByTestId('setup-drift')).toBeNull()
  })

  it('CONTROL: a successful answer renders the drift line exactly as before', async () => {
    vi.stubGlobal('fetch', vi.fn(answer({
      revisions: [{ period: 'Current Qtr', current: 0.94, ago30: 0.90 }],
    })))
    withSWR(<SetupSection sym="NVDA" row={{ sym: 'NVDA' }} reportDate="2026-08-06" expectedMove={null} />)
    const drift = await screen.findByTestId('setup-drift')
    expect(drift.textContent).toMatch(/\$0\.94 · \+4¢ \/ 30d/)
  })
})

describe('TranscriptPanel — a failed transcript request is not "Transcript not available."', () => {
  // Only the transcript URL fails; the panel's neighbours (quarters list,
  // playable transcript, cross-call search) answer empty so they stay quiet.
  const routed = (impl) => vi.fn((url) => (String(url).includes('/api/earnings/transcript/')
    ? impl() : answer(null)()))
  const openPanel = () => {
    withSWR(<TranscriptPanel sym="NVDA" />)
    fireEvent.click(screen.getByRole('button', { name: /FULL TRANSCRIPT/i }))
  }

  it.each(FAILURES)('%s says the request failed', async (_label, impl) => {
    vi.stubGlobal('fetch', routed(impl))
    openPanel()
    const failed = await screen.findByTestId('transcript-failed')
    expect(failed.textContent).toMatch(/request failed/i)
    expect(screen.queryByText('Transcript not available.')).toBeNull()
  })

  it('CONTROL: a resolved null (provider had nothing) still says "Transcript not available."', async () => {
    vi.stubGlobal('fetch', routed(answer(null)))
    openPanel()
    expect(await screen.findByText('Transcript not available.')).toBeTruthy()
    expect(screen.queryByTestId('transcript-failed')).toBeNull()
  })
})

// ── 3. the census — printed, not migrated ────────────────────────────────────
function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (/\.(jsx?|tsx?|mjs)$/.test(ent.name)) out.push(p)
  }
  return out
}
const FILES = walk(SRC)
const RAW_HITS = FILES.filter((f) => SWALLOW.test(fs.readFileSync(f, 'utf8')))
const LIVE_HITS = FILES.filter((f) => swallows(fs.readFileSync(f, 'utf8')))

describe('TERM-033 — the population, as a denominator', () => {
  it(`census: ${LIVE_HITS.length} of ${FILES.length} files under app/src still swallow with ${NEEDLE_TEXT} `
    + `(${RAW_HITS.length} counting comment mentions) — ${NAMED_SITES.length} named sites railed above, `
    + 'the rest are the census ticket, not this one', () => {
    // Non-vacuity: the walker read the tree, and a walker that found nothing
    // would be a broken grep, not a clean codebase.
    expect(FILES.some((f) => f.endsWith(path.join('sections', 'sectionFetch.js')))).toBe(true)
    expect(LIVE_HITS.length).toBeGreaterThan(0)
    expect(RAW_HITS.length).toBeGreaterThanOrEqual(LIVE_HITS.length)
    console.log(`[TERM-033 census] ${LIVE_HITS.length} live / ${RAW_HITS.length} raw of ${FILES.length} files:\n`
      + LIVE_HITS.map((f) => '  ' + path.relative(SRC, f).split(path.sep).join('/')).join('\n'))
  })
})
