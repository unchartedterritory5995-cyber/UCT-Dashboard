// ⛔ THE SLICE 2 INVARIANT, MADE STRUCTURAL — corrected 2026-09-08.
//
//     ONE COHERENT MEMBER CAPTURE EXPERIENCE
//     + ONE CANONICAL WRITE PATH PER SEMANTIC CAPTURE KIND.
//
// There are THREE kinds, and they are not interchangeable:
//   EXTERNAL SOURCE  capture.js        -> POST /api/j2/capture
//   INTERNAL UCT     captureTargets.js -> POST /api/j2/inbox
//   MEMBER THOUGHT   thoughtCapture.js -> POST /api/j2/notes (createNoteViaApi)
//
// The earlier reading of "one canonical flow" would have routed a Screener row
// through the web path — asking a member for a "Source link" for UCT's own scan
// result, and filing UCT data as an external source. That is wrong about
// provenance AND wrong about rights, so the shell is shared and the write paths
// are not.
//
// A convention that every door "should" go through capture.js is worth nothing:
// the second caller is always added in a hurry, by someone who did not read
// this comment, and it will be the one that forgets the rights tier. So the
// rule is checked by walking the source.
//
// ⭐ AST, never grep — a grep for the endpoint string matches this file, the
// module's own docstring, and every doc that mentions it. That false-positive
// class is documented in `rawErrorSurface.test.js` and in `reachable.test.js`
// before it ("found 5 call sites, all five of them prose").
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import * as acorn from 'acorn'
import jsx from 'acorn-jsx'

import { CAPTURE_ENDPOINT, buildCaptureIntent, captureBlockers, captureConfirmation, captureDestination, TIER_PASSAGE, TIER_REFERENCE } from './capture'

const Parser = acorn.Parser.extend(jsx())
const APP_SRC = path.resolve(__dirname, '..', '..', '..')          // app/src
const CAPTURE_MODULE = path.join(__dirname, 'capture.js')

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (['node_modules', '__fixtures__', 'assets'].includes(e.name)) continue
      sourceFiles(p, out)
    } else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\.[jt]sx?$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (const k of Object.keys(node)) {
    if (['type', 'loc', 'start', 'end'].includes(k)) continue
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn))
    else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, fn)
  }
}

/** Every string LITERAL in the file that names the capture endpoint. A literal
 *  is a node; a comment is not, which is the whole reason this parses. */
function endpointLiterals(file) {
  const code = fs.readFileSync(file, 'utf8')
  let ast
  try {
    ast = Parser.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  } catch {
    return []
  }
  const hits = []
  walk(ast, (n) => {
    if (n.type === 'Literal' && typeof n.value === 'string' && n.value.includes('/api/j2/capture')) {
      hits.push({ file, line: n.loc.start.line, value: n.value })
    }
    if (n.type === 'TemplateLiteral') {
      const raw = n.quasis.map((q) => q.value.cooked || '').join('')
      if (raw.includes('/api/j2/capture')) hits.push({ file, line: n.loc.start.line, value: raw })
    }
  })
  return hits
}

const FILES = sourceFiles(APP_SRC)

describe('one capture path — no door may talk to the endpoint directly', () => {
  it('scans a real, non-trivial slice of the app', () => {
    expect(FILES.length).toBeGreaterThan(500)
  })

  it('capture.js is the ONLY module that names the capture endpoint', () => {
    const offenders = FILES
      .filter((f) => path.resolve(f) !== path.resolve(CAPTURE_MODULE))
      .flatMap(endpointLiterals)
    const report = offenders.map((o) => `  ${path.relative(APP_SRC, o.file)}:${o.line}`).join('\n')
    expect(offenders, `these bypass capture.js:\n${report}`).toEqual([])
  })

  it('the probe CAN see an endpoint literal (non-vacuity)', () => {
    // If the walker found nothing anywhere, the assertion above would pass for
    // the wrong reason. capture.js itself must be visible to it.
    expect(endpointLiterals(CAPTURE_MODULE).length).toBeGreaterThan(0)
  })
})

describe('the canonical intent', () => {
  const dest = captureDestination({ noteId: 'n1', ticker: 'NVDA', source: 'palette' })

  it('a passage in the box makes it a passage capture, whatever the door said', () => {
    const i = buildCaptureIntent({ tier: TIER_REFERENCE, url: 'https://x.com/a', passage: 'quoted', destination: dest })
    expect(i.tier).toBe(TIER_PASSAGE)
  })

  it('no passage means a reference capture', () => {
    const i = buildCaptureIntent({ url: 'https://x.com/a', destination: dest })
    expect(i.tier).toBe(TIER_REFERENCE)
  })

  it('source text and member annotation are two fields, never one', () => {
    const i = buildCaptureIntent({
      url: 'https://x.com/a', passage: 'Management expects margins to normalize.',
      annotation: 'I think that is optimistic.', destination: dest,
    })
    expect(i.passage).toBe('Management expects margins to normalize.')
    expect(i.annotation).toBe('I think that is optimistic.')
    expect(i.passage).not.toContain('optimistic')
  })

  it('the client sends NOTHING authoritative about domain, coverage or identity', () => {
    // ⛔ §2: those are server-derived. If a future intent grows one of these
    // keys, a door could start disagreeing with the server about what was
    // stored — which is exactly how coverage stops being truthful.
    const i = buildCaptureIntent({ url: 'https://www.reuters.com/a', destination: dest })
    for (const forbidden of ['domain', 'coverage', 'captureType', 'identity', 'sourceKind', 'userId']) {
      expect(Object.keys(i)).not.toContain(forbidden)
    }
  })

  it('two DIFFERENT doors under the same context produce identical intents', () => {
    // The palette/hotkey convergence rail (§5): doors differ in how they are
    // invoked and what they prefill, never in what they mean.
    const args = { url: 'https://x.com/a', title: 'A', passage: 'p', annotation: 'n' }
    const fromPalette = buildCaptureIntent({ ...args, destination: captureDestination({ noteId: 'n1', ticker: 'NVDA', source: 'palette' }) })
    const fromHotkey = buildCaptureIntent({ ...args, destination: captureDestination({ noteId: 'n1', ticker: 'NVDA', source: 'hotkey' }) })
    expect(fromPalette).toEqual(fromHotkey)
  })

  it('context changes the DEFAULT destination, and the label says so', () => {
    expect(captureDestination({ noteId: 'n1', ticker: 'NVDA' }).contextLabel).toBe('NVDA Research')
    expect(captureDestination({ noteId: 'n1', noteTitle: 'Weekly review' }).contextLabel).toBe('Weekly review')
    expect(captureDestination({ noteId: null }).contextLabel).toBe('Notebook')
  })
})

describe('blockers are a courtesy, not the boundary', () => {
  it('names what is missing rather than failing silently', () => {
    expect(captureBlockers(buildCaptureIntent({ destination: {} }))).toContain('a source URL')
    expect(captureBlockers(buildCaptureIntent({ url: 'https://x.com/a', destination: {} }))).toContain('a destination')
  })

  it('a complete reference capture has no blockers', () => {
    const i = buildCaptureIntent({ url: 'https://x.com/a', destination: captureDestination({ noteId: 'n1' }) })
    expect(captureBlockers(i)).toEqual([])
  })
})

describe('the confirmation answers both questions (§9)', () => {
  const dest = captureDestination({ noteId: 'n1', ticker: 'NVDA' })

  it('says WHERE it went, never just "Success"', () => {
    expect(captureConfirmation({ deduped: false }, dest)).toBe('Saved to NVDA Research')
  })

  it('distinguishes a resolved duplicate from a new capture', () => {
    // ⛔ The UI does not compute duplicate-ness; it reports the server's answer.
    expect(captureConfirmation({ deduped: true }, dest)).toBe('Already saved to NVDA Research')
  })
})

// ── Cross-kind routing (the corrected invariant) ─────────────────────────────

const INTERNAL_ENDPOINT = '/api/j2/inbox'
const THOUGHT_ENDPOINT = '/api/j2/notes'

function literalsMatching(file, needle) {
  const code = fs.readFileSync(file, 'utf8')
  let ast
  try {
    ast = Parser.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  } catch { return [] }
  const hits = []
  walk(ast, (n) => {
    if (n.type === 'Literal' && typeof n.value === 'string' && n.value.includes(needle)) {
      hits.push({ file, line: n.loc.start.line })
    }
  })
  return hits
}

describe('each capture KIND keeps its own write path', () => {
  const rel = (f) => path.relative(APP_SRC, f).split(path.sep).join('/')

  it('the WEB path is named only by capture.js', () => {
    const owners = FILES.filter((f) => literalsMatching(f, '/api/j2/capture').length).map(rel)
    expect(owners).toEqual(['pages/journal-2-0/lib/capture.js'])
  })

  it('the INTERNAL path has exactly the callers we know about', () => {
    // ⛔ NOT a clean "one module" story, and the rail says so rather than being
    // scoped until it looks clean. Three files name this endpoint:
    //   captureTargets.js   the canonical WRITE path
    //   NoteEditorPage.jsx  READS the tray (SWR) and DELETEs consumed rows -- legitimate
    //   ChartWidget.jsx:443 a DIRECT POST that bypasses captureTargets entirely
    //
    // ⚠️ KNOWN PRE-EXISTING DIVERGENCE, found by this rail and NOT introduced by
    // Wave L: ChartWidget's own capture hotkey posts a REDUCED payload --
    // widgetId/params/searchText/capturedAt -- omitting fallbackUrl, annotations,
    // caption and tradeRef, which captureTargets.js sends. So a chart captured
    // by the widget hotkey loses its frozen drawings compared with the same
    // chart captured through CaptureMenu.
    //
    // It is left alone on purpose: routing it through captureTargets is not a
    // like-for-like swap (that module also has append-to-recent-note behaviour),
    // so changing it is a product decision, not a rider. Pinned here so a THIRD
    // caller fails loudly and the debt stays visible.
    const owners = FILES.filter((f) => literalsMatching(f, INTERNAL_ENDPOINT).length).map(rel).sort()
    expect(owners).toEqual([
      'pages/charts/widgets/ChartWidget.jsx',
      'pages/journal-2-0/components/notebook/NoteEditorPage.jsx',
      'pages/journal-2-0/lib/captureTargets.js',
    ])
  })

  it('the THOUGHT path does not manufacture external provenance', () => {
    // ⛔ A thought must never acquire a URL, a domain, or a rights tier. If
    // thoughtCapture ever imports the web module or names the web endpoint, a
    // member's own words are one refactor away from being stored as somebody
    // else's quotation.
    // ⭐ AST, not a raw string search -- my first version of this check used
    // `toContain` and failed on thoughtCapture's own docstring, which says in
    // prose that a thought must NOT go through /api/j2/capture. That is the
    // exact grep false-positive this file's header warns about, committed in
    // the rail that warns about it.
    const mod = path.join(APP_SRC, 'pages/journal-2-0/lib/thoughtCapture.js')
    expect(literalsMatching(mod, '/api/j2/capture')).toEqual([])
    expect(literalsMatching(mod, '/api/j2/inbox')).toEqual([])
    expect(fs.readFileSync(mod, 'utf8')).toContain('createNoteViaApi')
  })

  it('the probe can SEE each endpoint (non-vacuity)', () => {
    // Without this, all three assertions above could pass by finding nothing.
    expect(literalsMatching(path.join(APP_SRC, 'pages/journal-2-0/lib/capture.js'), '/api/j2/capture').length).toBeGreaterThan(0)
    expect(literalsMatching(path.join(APP_SRC, 'pages/journal-2-0/lib/captureTargets.js'), INTERNAL_ENDPOINT).length).toBeGreaterThan(0)
    expect(literalsMatching(path.join(APP_SRC, 'pages/journal-2-0/lib/noteCreation.js'), THOUGHT_ENDPOINT).length).toBeGreaterThan(0)
  })
})
