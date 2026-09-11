// ⛔ THE WRITE-PATH RAIL. Every endpoint the hub can write to, derived from the real call sites.
//
// Owner ruling B4, 2026-09-09. WHY THIS FILE EXISTS, and why prose could not do its job:
//
// Increment 2 was reviewed against an invariant reading "exactly two write paths". The Architecture
// lead found four. The disagreement could not be settled by reading, because **the invariant did not
// exist anywhere**: a repo-wide search for it found only the finding LINE REFERRING to it. Nothing
// stated it, and nothing checked it — not the call path, not even the count. So an integrator adding
// a fifth path would have contradicted a rule no artifact contained, and the review that caught it
// caught it by hand.
//
// ⭐ AND A COUNT WOULD NOT HAVE BEEN ENOUGH. The regression this rail exists for is a rogue path that
// REPLACES an existing endpoint rather than adding one: a hub-local `fetch('/api/watchlist-alerts')`
// keeps the total at four and every count-based gate sails past it, while the app's own client — with
// its SWR cache invalidation (`useWatchlistAlerts.js:10-12`) and its optimistic insert — is silently
// bypassed. That is why every entry carries the module it is REACHED THROUGH and who owns it, and why
// the ownership assertion below is a separate `it()` rather than a clause folded into another.
//
// ⛔ COVERAGE BOUNDARY — read this before trusting a green run.
//
//   LAYER 1 (exhaustive): every non-test file under `app/src/hub/**` is scanned, and EVERY write call
//   site found must appear in the manifest. This half is complete: a new write anywhere in the hub
//   fails the rail whether or not anyone updates the manifest.
//
//   LAYER 2 (presence, not enumeration): for a path the hub reaches through a pre-existing app client,
//   the rail asserts the declared call site EXISTS in the declared module. It does NOT enumerate
//   everything those modules can write. `useFlagged.js` also writes `/api/watchlists/flagged/share`
//   (`:107`) and `/api/watchlists/flagged/rename` (`:122`), and `useWatchlistAlerts.js` also writes
//   `DELETE /api/watchlist-alerts/{param}` (`:42`) — none of which the hub calls. Separating those
//   from the two it does call means following `toggle` and `createAlert` out through a hook's RETURN
//   VALUE, which is dataflow analysis, not a scan. **So: "the hub adds no write of its own beyond
//   these four" is PROVEN; "these app clients can write nothing else" is NOT CLAIMED.**
//
//   IDENTIFIER RESOLUTION is same-file only — `PLANNED_TRADES_URL` (`plannedTradesClient.js:19`) is
//   resolved because it is declared in the file that uses it. A URL constant imported from elsewhere
//   would read as unresolved and fail loudly rather than silently vanish (see `UNRESOLVED`).
//
// Nothing below is typed by hand except the manifest itself, which is the point: the manifest is the
// claim, and the derivation is the check on it.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')          // app/src
const HUB = HERE                               // app/src/hub

/** Methods that CHANGE something. A GET is not a write path and is not this rail's business. */
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

/**
 * ⛔ COMMENTS ARE STRIPPED FIRST — this rail's sibling (`contractArity.test.js`) shipped a first
 * version that matched PROSE describing a call and reported it as the runtime truth. This file is
 * full of `/api/...` strings inside comments, including in this very header, so a scanner that reads
 * them would find "write paths" that no code performs, and the manifest would grow to match them.
 */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** A template's interpolations are not part of the endpoint's identity. */
const normalise = (url) => url.replace(/\$\{[^}]*\}/g, '{param}')

/** Marker for a first argument this scanner could not resolve — surfaced, never swallowed. */
const UNRESOLVED = '<UNRESOLVED>'

/** Every `const NAME = '/api/...'` in one file, so a URL held in a constant still resolves. */
function urlConstants(src) {
  const out = new Map()
  const re = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`]*\/api\/[^'"`]*)\2/g
  let m
  while ((m = re.exec(src)) !== null) out.set(m[1], normalise(m[3]))
  return out
}

/**
 * Walk LEFT from `i` to the `(` that opens the call expression `i` sits inside.
 *
 * We start inside the options object (`{ method: 'POST' }`), so the first thing encountered going
 * left is that object's `{`. Falling below depth zero on a brace or bracket means we have stepped
 * OUT of a container rather than found the call, so depth resets and the walk continues; only a
 * `(` at negative depth is the call's own paren. A naive "search backwards for the nearest `(`"
 * lands inside `JSON.stringify(...)` or `encodeURIComponent(...)` and reports the wrong argument.
 */
function openingParenOf(src, i) {
  let depth = 0
  for (let j = i; j >= 0; j -= 1) {
    const ch = src[j]
    if (ch === ')' || ch === ']' || ch === '}') depth += 1
    else if (ch === '(' || ch === '[' || ch === '{') {
      depth -= 1
      if (depth < 0) {
        if (ch === '(') return j
        depth = 0
      }
    }
  }
  return -1
}

/** The first argument of the call opening at `paren`, as source text. */
function firstArgOf(src, paren) {
  let depth = 0
  for (let j = paren + 1; j < src.length; j += 1) {
    const ch = src[j]
    if ('([{'.includes(ch)) depth += 1
    else if (')]}'.includes(ch)) { if (depth === 0) return src.slice(paren + 1, j); depth -= 1 }
    else if (ch === ',' && depth === 0) return src.slice(paren + 1, j)
  }
  return ''
}

/** Every write call site in one already-stripped source. */
function writeCallSites(src, label) {
  const consts = urlConstants(src)
  const out = []
  const re = new RegExp(`method:\\s*['"\`](${WRITE_METHODS.join('|')})['"\`]`, 'g')
  let m
  while ((m = re.exec(src)) !== null) {
    const paren = openingParenOf(src, m.index)
    if (paren < 0) continue
    const arg = firstArgOf(src, paren).trim()
    let endpoint = UNRESOLVED
    const literal = arg.match(/^(['"`])([\s\S]*)\1$/)
    if (literal && literal[2].includes('/api/')) endpoint = normalise(literal[2])
    else if (consts.has(arg)) endpoint = consts.get(arg)
    // A write whose URL this scanner cannot resolve is REPORTED as unresolved, never dropped:
    // silently skipping it would make an unreadable call site look like no call site at all.
    out.push({ endpoint, method: m[1], via: label })
  }
  return out
}

/** Every non-test source file under a directory, recursively. */
function sourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) { out.push(...sourceFiles(full)); continue }
    if (!/\.(js|jsx)$/.test(name)) continue
    if (/\.test\.(js|jsx)$/.test(name)) continue
    out.push(full)
  }
  return out
}

const rel = (abs) => path.relative(SRC, abs).split(path.sep).join('/')

// ── THE MANIFEST — the claim this rail checks ──────────────────────────────────────────────────
//
// `owner: 'hub'`  — the hub itself performs this write.
// `owner: 'app'`  — the hub triggers a write the app already performed before the hub existed, and
//                   reaches it through that pre-existing client. The hub adds no request of its own.
const WRITE_PATHS = [
  {
    endpoint: '/api/j2/positions/{param}',
    method: 'PUT',
    via: 'hub/sections/journalSection.js',
    owner: 'hub',
    what: "the stop. Body built ONLY by `stopPatchFor` — a partial update over `_UPDATABLE_FIELDS`, so a stray key could retag the position to another ticker.",
  },
  {
    endpoint: '/api/hub/planned-trades',
    method: 'POST',
    via: 'hub/plannedTradesClient.js',
    owner: 'hub',
    what: 'the Plan-trade sheet. Phase 2a\'s backend, given its first consumer by Increment 2.',
  },
  {
    endpoint: '/api/watchlists/flagged/sync',
    method: 'POST',
    via: 'hooks/useFlagged.js',
    owner: 'app',
    what: 'Flag. Plan §3.3 lists the action; the hub calls the app\'s own `toggle`.',
  },
  {
    endpoint: '/api/j2/notes',
    method: 'POST',
    via: 'pages/journal-2-0/lib/noteCreation.js',
    owner: 'app',
    what: "New note. §3.7's `notebook.newNote` calls the Notebook's own `createNoteViaApi`; the hub performs no note write of its own. ⚠️ That module ALSO holds `PUT /api/j2/notes/{id}` (noteCreation.js:34), but it is gated on `properties && Object.keys(properties).length` and the hub passes none — structurally unreachable from this call site, so it is not a hub-reachable write and is deliberately not declared.",
  },
  {
    endpoint: '/api/j2/notes/{param}',
    method: 'PUT',
    via: 'pages/journal-2-0/hooks/useJ2Notes.js',
    owner: 'app',
    what: "Set ticker. R-17's `notebook.linkTicker` writes `{ticker}` through the Notebook's OWN note client, `useJ2Note(id).update` — the same one the Notebook's ticker control uses (`NoteEditorPage.jsx:1743`), which is why it also invalidates the note's SWR entry and the noteLink title cache (`useJ2Notes.js:172-179`). A hub-local fetch to this URL would leave the total at six and lose both. ⚠️ There is NO note PATCH client anywhere in `app/src` — the Notebook updates a note with a partial PUT body — so \"the PATCH client\" this row was requested against does not exist; this is the client that performs the write. ⚠️ The OTHER `PUT /api/j2/notes/{id}` (`noteCreation.js:34`) stays undeclared for the reason on the POST entry above: the hub cannot reach it.",
  },
  {
    endpoint: '/api/watchlist-alerts',
    method: 'POST',
    via: 'hooks/useWatchlistAlerts.js',
    owner: 'app',
    what: 'Alert. Plan §3.3 lists the action; the hub calls the app\'s own `createAlert`.',
  },
]

const key = (p) => `${p.method} ${p.endpoint}`
const inHub = (viaPath) => viaPath.startsWith('hub/')

describe('the hub write-path manifest', () => {
  const hubSites = sourceFiles(HUB).flatMap((f) => writeCallSites(stripComments(readFileSync(f, 'utf8')), rel(f)))

  it('the scanner actually finds call sites — the control', () => {
    // ⛔ NON-VACUITY. Every assertion below is of the form "what was found matches the manifest",
    // and a scanner that finds NOTHING satisfies the subset half perfectly. This is the control
    // that makes the green meaningful: two known hub writes exist, so a broken regex fails here
    // first and by name, rather than passing everything downstream.
    expect(hubSites.length, 'the hub scan found no write call sites at all — the scanner is broken')
      .toBeGreaterThanOrEqual(2)
    expect(hubSites.map((s) => s.endpoint)).toContain('/api/hub/planned-trades')
  })

  it('no write call site in app/src/hub/** is missing from the manifest', () => {
    // The exhaustive half (layer 1). A hub-local fetch to an endpoint the manifest attributes to an
    // app client fails HERE, because the manifest entry declares a different `via`.
    const declared = new Map(WRITE_PATHS.map((p) => [key(p), p]))
    for (const site of hubSites) {
      expect(site.endpoint, `unresolved write URL at ${site.via} — the scanner could not read it`)
        .not.toBe(UNRESOLVED)
      const entry = declared.get(key(site))
      expect(entry, `UNDECLARED WRITE: ${key(site)} at ${site.via} is not in the manifest`).toBeTruthy()
      expect(entry.via, `${key(site)} is declared as reached through ${entry?.via} but a call site exists at ${site.via}`)
        .toBe(site.via)
    }
  })

  it('every manifest entry has a real call site in the module it names', () => {
    // Stale-manifest rot: an entry naming a path nobody performs is a claim about the product that
    // has quietly stopped being true, and it reads as coverage.
    for (const p of WRITE_PATHS) {
      const abs = path.join(SRC, p.via)
      expect(existsSync(abs), `manifest names ${p.via}, which does not exist`).toBe(true)
      const found = writeCallSites(stripComments(readFileSync(abs, 'utf8')), p.via)
      expect(found.map(key), `manifest declares ${key(p)} via ${p.via}, but that module performs no such write`)
        .toContain(key(p))
    }
  })

  it('OWNERSHIP — an app-owned path is reached through a module OUTSIDE the hub', () => {
    // ⛔⛔ THE CLAUSE THE COUNT CANNOT REPLACE, and the reason it is its own test: when it fails, the
    // failure must say OWNERSHIP and nothing else. A rogue hub-local client that replaces the app's
    // own leaves the total at four; only this distinguishes "the hub triggers the app's write" from
    // "the hub performs its own write to the same URL".
    for (const p of WRITE_PATHS) {
      if (p.owner === 'app') {
        expect(inHub(p.via), `OWNERSHIP VIOLATION: ${key(p)} is declared owner:'app' but is reached through ${p.via}, inside the hub`)
          .toBe(false)
      } else {
        expect(inHub(p.via), `OWNERSHIP VIOLATION: ${key(p)} is declared owner:'hub' but is reached through ${p.via}, outside the hub`)
          .toBe(true)
      }
    }
  })

  it('the manifest is six paths — two hub-owned, four through pre-existing app clients', () => {
    // The count, kept LAST and deliberately weakest: it is a tripwire on the shape of the claim, not
    // the claim itself. The three assertions above are what actually hold.
    //
    // ⚰️ WAS FIVE — "two hub-owned, three through pre-existing app clients". Increment 7's R-17
    // added `PUT /api/j2/notes/{param}`: `notebook.linkTicker` files a note under a ticker through
    // the Notebook's own `useJ2Note(id).update`. The hub-owned pair is UNCHANGED, which is the
    // half that matters — the hub still performs exactly two writes of its own.
    expect(WRITE_PATHS).toHaveLength(6)
    expect(WRITE_PATHS.filter((p) => p.owner === 'hub').map(key)).toEqual([
      'PUT /api/j2/positions/{param}',
      'POST /api/hub/planned-trades',
    ])
    expect(WRITE_PATHS.filter((p) => p.owner === 'app').map(key)).toEqual([
      'POST /api/watchlists/flagged/sync',
      'POST /api/j2/notes',
      'PUT /api/j2/notes/{param}',
      'POST /api/watchlist-alerts',
    ])
  })
})
