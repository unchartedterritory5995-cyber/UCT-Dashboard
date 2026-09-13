/**
 * ⛔⛔ EVERY DOOR, ENUMERATED FROM THE CODE — never from what a canary drove,
 * and never from a list a human keeps up to date.
 *
 * ⚰️ THE TRAP THIS RAIL EXISTS FOR. Wave Q1 recorded "the FOUR doors — every
 * path that advances `updatedAt`" and named body, folder, ticker, tags. That
 * list came from the DERIVED WIRE RAIL, which could only see doors a canary
 * actually opened. No canary ever uploaded a hero image, so `hero` never
 * appeared — and shipped to production unsettled, forking members' notes over
 * their own writes. Re-enumerating from the other side on 2026-09-12 found
 * SEVEN server-side functions and fourteen client call sites.
 *
 * ⚰️ AND THE FIRST VERSION OF THIS RAIL WAS TOO WEAK. It asked "does this FILE
 * mention settleNoteWrite" — so a file with two doors and one settle passed,
 * and `importer/commit.js` (two doors) did exactly that. A rail that cannot
 * distinguish one settled door from two is not a rail. This version is
 * ROUTE-GRANULAR and CALL-SITE-GRANULAR: every write to a door route must land
 * a revision before the next `fetch` in the file, or be a NAMED exception.
 *
 * THE DERIVATION, in three steps, each read from the source and none recalled:
 *   ① the SQL says which service functions advance `updated_at`
 *   ② the router says which ROUTES reach those functions
 *   ③ the client is checked against THAT set of routes
 *
 * MODE: 'fail' as of 2026-09-12 — the three /embeds doors, both restores, the
 * excerpt, the facts insert, the property PUTs and both hero doors all land.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const MODE = 'fail'

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..')
const API = join(REPO, 'api')
const CLIENT = join(REPO, 'app', 'src')
const rel = (p) => relative(REPO, p).split(sep).join('/')
const isTest = (p) => /\.(test|spec)\.[jt]sx?$|\/test_|_test\.py$/.test(rel(p))

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === '__pycache__') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** [name, body] for every `def` in a python file. */
function pyFunctions(src) {
  const starts = []
  const re = /^[ \t]*(?:async )?def (\w+)\(/gm
  let m = re.exec(src)
  while (m) { starts.push([m.index, m[1]]); m = re.exec(src) }
  return starts.map(([pos, name], i) => [name, src.slice(pos, i + 1 < starts.length ? starts[i + 1][0] : src.length)])
}

const NOTES_SERVICE = join(API, 'services', 'journal_two', 'notes.py')

/**
 * ① THE SQL DECIDES — not a docstring, not a name, not this comment.
 *
 * A function advances a note when it writes `updated_at` on `j2_notes`. Two
 * spellings exist and both are read here: the statement written out in full
 * (the three appenders, `restore_note`, `delete_folder`, `import_confirm`), and
 * the one assembled from a `sets` list (`update_note`).
 *
 * ⛔ A 300-CHARACTER WINDOW, NOT THE WHOLE FUNCTION. `get_note` contains an
 * `UPDATE j2_notes SET first_image_url` and the word `updatedAt` elsewhere in
 * its body; a whole-function search calls that a door and the roster becomes
 * noise. The window keeps the column with its own statement.
 */
function sqlAdvancingFunctions() {
  const src = readFileSync(NOTES_SERVICE, 'utf8')
  const out = new Set()
  for (const [name, body] of pyFunctions(src)) {
    let hit = false
    for (const m of body.matchAll(/UPDATE j2_notes/g)) {
      if (/updated_at\s*=/.test(body.slice(m.index, m.index + 300))) { hit = true; break }
    }
    if (hit || /sets\.append\("updated_at/.test(body)) out.add(name)
  }
  return out
}

/** …and anything that calls one of them is a door too, by delegation. */
function reachingFunctions(seed) {
  const fns = pyFunctions(readFileSync(NOTES_SERVICE, 'utf8'))
  const all = new Set(seed)
  let grew = true
  while (grew) {
    grew = false
    for (const [name, body] of fns) {
      if (all.has(name)) continue
      for (const a of all) {
        if (new RegExp(`(?<!def\\s)\\b${a}\\(`).test(body)) { all.add(name); grew = true; break }
      }
    }
  }
  return all
}

/** ② THE ROUTER DECIDES which routes reach them. */
function advancingRoutes(advancing) {
  const src = readFileSync(join(API, 'routers', 'journal_two.py'), 'utf8')
  const marks = []
  const re = /@router\.(get|post|put|patch|delete)\("([^"]+)"/g
  let m = re.exec(src)
  while (m) { marks.push([m.index, m[1].toUpperCase(), m[2]]); m = re.exec(src) }
  const out = []
  for (let i = 0; i < marks.length; i += 1) {
    const [pos, method, path] = marks[i]
    if (method === 'GET') continue
    const body = src.slice(pos, i + 1 < marks.length ? marks[i + 1][0] : src.length)
    for (const a of advancing) {
      // ⛔ NOT THE HANDLER'S OWN NAME. `POST /trades/import/confirm` is served
      // by a function literally called `import_confirm` — a different one, in a
      // different module, for trades — and a bare name match called the trades
      // CSV importer a Notebook door. The CALL is what counts, never the `def`.
      if (new RegExp(`(?<!def )\\b${a}\\(`).test(body)) { out.push(`${method} /api/j2${path.replace(/\{[^}]+\}/g, '*')}`); break }
    }
  }
  return new Set(out)
}

const shapeOfUrl = (u) => u.replace(/\$\{[^}]*\}/g, '*').replace(/\?.*$/, '')

/**
 * ⛔⛔ STRIP COMMENTS BEFORE LOOKING FOR THE CALL.
 *
 * ⚰️ The first version of this rail matched `settleNoteWrite` inside the ⛔
 * comment that explains WHY the settle is there — so deleting the actual call
 * and leaving its comment behind passed, and the mutation proof said the rail
 * was fine. A comment naming a mechanism is a claim about a run, never a run.
 * Match `settleNoteWrite(`, in code.
 */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
// ⛔ BOTH FORMS. `settleNoteWrites` (plural) is how the two BATCH doors land —
// one call, many revisions — and a regex written for the singular silently reads
// a batch door as unsettled.
const landsARevision = (src) => /settleNoteWrites?\s*\(/.test(stripComments(src))

/**
 * ⛔ THE NAMED EXCEPTIONS. A door is on this list only because landing a
 * revision there is IMPOSSIBLE or already done by another mechanism — never
 * because it was inconvenient. Each entry says what would close it.
 */
/**
 * ⛔⛔ ZERO ROUTE EXCEPTIONS, as of merge 2 (2026-09-12).
 *
 * ⚰️ There were two, and both were wrong in the same way. `import_confirm` and
 * `delete_folder` were warn-listed on the grounds that "there is no revision for
 * this browser to land". That was true of the RESPONSE and false of the world:
 * the revisions existed — a bulk UPDATE stamps one `updated_at` across every
 * note it moves — the browser was simply never told them. Both endpoints return
 * them now (`{ok, moved:[{noteId,updatedAt}]}` and `{created|updated:[{id,updatedAt}]}`),
 * both clients land them with `settleNoteWrites`, and both are ordinary doors.
 *
 * ⭐ THE LESSON IS ABOUT THE SHAPE OF AN EXCEPTION. "Cannot" deserved one more
 * question: cannot, or was not asked to? Each entry had to name what would close
 * it, and writing that down is what made closing it obviously cheap.
 *
 * ⛔ An entry here again means a door a member can open whose revision this
 * browser will never learn. It needs a reason that survives that question.
 */
const ROUTE_EXCEPTIONS = {}

const SITE_EXCEPTIONS = {
  'app/src/pages/journal-2-0/lib/offline/useOutboxDrain.js:PUT /api/j2/notes/*':
    'this IS the outbox drain\'s own send. Its revision is settled by `settleSent` inside `drainOutbox`, in the '
    + 'same transaction that clears the entry — calling settleNoteWrite here would be a second authority over '
    + 'one value. To close it the drain would have to stop settling its own sends, which is the wrong direction.',
}

/**
 * Every write this client makes to /api/j2, with the site that makes it.
 *
 * ⛔ THE SETTLE MUST BELONG TO THIS DOOR. The window runs from the call to the
 * NEXT `fetch` in the file (capped at 40 lines) — measured distances for the
 * real settles are 8–25 lines, and a flat window wide enough for those would
 * let one door borrow the settle of the door below it.
 */
function clientWrites() {
  const writes = []
  for (const p of walk(CLIENT)) {
    if (!/\.(js|jsx)$/.test(p) || isTest(p)) continue
    const src = readFileSync(p, 'utf8')
    if (!/\/api\/j2\//.test(src)) continue
    const lines = src.split('\n')
    const fetchLines = []
    for (const m of src.matchAll(/fetch\(/g)) fetchLines.push(src.slice(0, m.index).split('\n').length)
    for (const m of src.matchAll(/fetch\(\s*[`'"]([^`'"]*\/api\/j2\/[^`'"]*)[`'"]/g)) {
      const at = src.slice(0, m.index).split('\n').length
      const method = (lines.slice(at - 1, at + 5).join('\n').match(/method:\s*'(POST|PUT|PATCH|DELETE)'/) || [])[1]
      if (!method) continue
      const next = fetchLines.find((n) => n > at)
      // ⛔ THE NEXT `fetch` IS THE REAL BOUNDARY — it is what stops one door
      // borrowing the settle of the door below it. The numeric cap is only a
      // backstop for a file whose LAST fetch is followed by unrelated lines.
      // ⚰️ It was 40, tuned on the single-note doors (measured 8–25 lines). A
      // BATCH door settles after processing the whole response —
      // `import_confirm`'s is 78 lines below its fetch, with no fetch between —
      // so 40 reported a settled door as unsettled.
      const end = Math.min(next ?? at + 120, at + 120)
      writes.push({
        file: rel(p),
        line: at,
        key: `${method} ${shapeOfUrl(m[1])}`,
        settles: landsARevision(lines.slice(at - 1, end).join('\n')),
      })
    }
  }
  return writes
}

/**
 * ⛔⛔ AND THE WRITES THE SCAN ABOVE CANNOT SEE.
 *
 * ⚰️ `useJ2NoteFolders.remove` calls `fetch(`${url}/${id}`, {method:'DELETE'})`
 * where `url` is a const declared eleven lines earlier. The string
 * `/api/j2/note-folders` never appears at the call site, so a matcher keyed on
 * URL literals is structurally blind to it — and `delete_folder` is a door that
 * advances every note in the folder. The mutation proof that should have caught
 * that exception going stale passed, because there was nothing to match.
 *
 * Every write in the Notebook whose URL is not a literal must be NAMED here,
 * with the route it reaches, so the blind spot is an inventory rather than a
 * silence.
 */
/**
 * Writes in journal-2-0 whose fetch URL is a VARIABLE, resolved back to the
 * literal that variable was declared from.
 *
 * ⛔ RESOLVED, NOT GUESSED. `const url = '/api/j2/note-folders'` eleven lines
 * above `fetch(`${url}/${id}`, {method:'DELETE'})` is the whole of the problem;
 * reading the declaration turns an invisible write into an ordinary one. A
 * variable this cannot resolve is reported as UNRESOLVED — never skipped,
 * because "we could not read it" and "it is not a door" are different facts.
 */
function variableUrlWrites() {
  const out = []
  for (const p of walk(join(CLIENT, 'pages', 'journal-2-0'))) {
    if (!/\.(js|jsx)$/.test(p) || isTest(p)) continue
    const src = readFileSync(p, 'utf8')
    const lines = src.split('\n')
    // ⛔ TWO FORMS, AND THE SECOND ONE IS THE ONE THAT HID `delete_folder`:
    //   fetch(url, …)              a bare variable
    //   fetch(`${url}/${id}`, …)   a template whose ONLY literal is a separator
    // Neither carries `/api/j2/` at the call site, so both need the declaration.
    const calls = [
      ...[...src.matchAll(/fetch\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)].map((m) => [m.index, m[1], '']),
      ...[...src.matchAll(/fetch\(\s*`\$\{([A-Za-z_$][\w$]*)\}([^`]*)`/g)].map((m) => [m.index, m[1], m[2]]),
    ]
    for (const [idx, name, tail] of calls) {
      const at = src.slice(0, idx).split('\n').length
      const after = lines.slice(at - 1, at + 5).join('\n')
      const method = (after.match(/method:\s*'(POST|PUT|PATCH|DELETE)'/) || [])[1]
      if (!method) continue
      // the declaration of THAT name, anywhere in the file
      const decl = src.match(new RegExp(`const\\s+${name}\\s*=([^\\n]*(?:\\n(?!\\s*const )[^\\n]*){0,3})`))
      const lit = decl && decl[1].match(/[`'"]([^`'"]*\/api\/j2\/[^`'"]*)[`'"]/)
      out.push({
        file: rel(p),
        line: at,
        method,
        // ⛔ The file's OWN note routes are what matter — a variable this cannot
        // resolve in a file that never mentions a note route cannot be a door.
        touchesNotes: /\/api\/j2\/note/.test(src),
        shape: lit ? shapeOfUrl(lit[1] + tail) : null,
        bare: lit ? shapeOfUrl(lit[1]) : null,
        settles: landsARevision(lines.slice(at - 1, at + 120).join('\n')),
      })
    }
  }
  return out
}

describe('⛔⛔ DOOR ENUMERATION — derived from the code, in both directions', () => {
  const sql = sqlAdvancingFunctions()
  const advancing = reachingFunctions(sql)

  it('① the SQL names exactly SEVEN functions that advance a note', () => {
    // ⛔ THE CONTRACT. An eighth appearing here is not a failure to silence —
    // it is a new door, and every client caller of it needs a settle before
    // this list is widened.
    expect([...sql].sort()).toEqual([
      'append_document_excerpt',
      'append_financial_fact',
      'append_widget_embed',
      'delete_folder',
      'import_confirm',
      'restore_note',
      'update_note',
    ])
  })

  it('① (b) and exactly one WRAPPER reaches them without SQL of its own', () => {
    // ⭐ `restore_note_version` writes no SQL — it rebuilds the old content and
    // calls `update_note`, which is why a version restore is a door too and
    // why `useJ2NoteVersions.restoreNoteVersion` has to settle.
    expect([...advancing].filter((n) => !sql.has(n)).sort()).toEqual(['restore_note_version'])
  })

  it('② every OTHER server-side writer of j2_notes is a known second writer', () => {
    const offenders = []
    for (const p of walk(API)) {
      if (!p.endsWith('.py') || isTest(p) || p === NOTES_SERVICE) continue
      const src = readFileSync(p, 'utf8')
      if (!/UPDATE j2_notes/.test(src)) continue
      // ⭐ The connector engine is a GENUINE second writer — a different
      // process syncing Roam/Notion/Craft in the background. A fork against it
      // is the CORRECT answer, not a defect; two of its three writers
      // deliberately preserve `updated_at` and are not doors at all.
      if (rel(p).includes('note_connectors/engine.py')) continue
      for (const [name, body] of pyFunctions(src)) {
        if (/UPDATE j2_notes/.test(body)) offenders.push(`${rel(p)}:${name}`)
      }
    }
    expect(offenders, '⛔ a NEW server-side writer of j2_notes is unaccounted for').toEqual([])
  })

  it('③ CLIENT: every write to a door route lands its revision, or is a NAMED exception', () => {
    const doors = advancingRoutes(advancing)
    const unsettled = []
    let checked = 0
    for (const w of clientWrites()) {
      if (!doors.has(w.key)) continue
      checked += 1
      if (ROUTE_EXCEPTIONS[w.key] || SITE_EXCEPTIONS[`${w.file}:${w.key}`]) continue
      if (!w.settles) unsettled.push(`${w.file}:${w.line} — ${w.key}`)
    }
    // ⭐ THE RAIL MUST BE ABLE TO SEE SOMETHING. A matcher that matched nothing
    // would report a perfect score — `vitest -t` taught this repo that once.
    expect(checked, '⛔ the client scan matched too few door calls — the matcher is broken, not the code').toBeGreaterThan(12)
    if (MODE === 'fail') {
      expect(unsettled, '⛔ a client door writes to a note and never lands its revision').toEqual([])
    } else {
      expect(unsettled.sort()).toEqual([])
    }
  })

  it('④ a write whose URL is a VARIABLE is resolved and checked like any other', () => {
    const doors = advancingRoutes(advancing)
    const writes = variableUrlWrites()
    // ⭐ Non-vacuity first: the folder hook is the reason this check exists.
    expect(
      writes.map((w) => w.file),
      '⛔ the variable-URL scan found nothing — the matcher is broken, not the tree',
    ).toContain('app/src/pages/journal-2-0/hooks/useJ2NoteFolders.js')

    // ⛔ Unresolved is only safe where the FILE never names a note route at all
    // — then no value that variable can hold reaches a door. Anywhere else it
    // is a hole, and "we could not read it" is not "it is not a door".
    const unresolved = writes.filter((w) => !w.shape && w.touchesNotes).map((w) => `${w.file}:${w.line}`)
    expect(unresolved, '⛔ a fetch URL variable in a note-touching file could not be resolved — read it, do not skip it').toEqual([])

    const unsettled = []
    for (const w of writes) {
      for (const key of [`${w.method} ${w.shape}`, `${w.method} ${w.bare}`]) {
        if (!doors.has(key)) continue
        if (ROUTE_EXCEPTIONS[key] || SITE_EXCEPTIONS[`${w.file}:${key}`]) continue
        if (!w.settles) unsettled.push(`${w.file}:${w.line} — ${key}`)
      }
    }
    expect(unsettled, '⛔ a variable-URL client door never lands its revision').toEqual([])
  })

  it('⭐ CONTROL — the variable-URL scan really does see delete_folder as a door', () => {
    // ⚰️ This is the assertion whose ABSENCE let the `delete_folder` exception
    // go stale silently: renaming its key changed nothing, because nothing was
    // ever matching it.
    const doors = advancingRoutes(advancing)
    expect(doors, 'delete_folder must be derivable as a door route').toContain('DELETE /api/j2/note-folders/*')
    const folderWrites = variableUrlWrites()
      .filter((w) => w.file.endsWith('useJ2NoteFolders.js'))
      .map((w) => `${w.method} ${w.shape}`)
    expect(folderWrites, 'the folder DELETE must resolve to the door route').toContain('DELETE /api/j2/note-folders/*')
    // ⭐ AND IT MUST LAND, NOT BE EXCUSED. Until merge 2 this line asserted the
    // route was a NAMED EXCEPTION — which was the honest reading while the
    // endpoint returned `{ok:true}` and told the browser nothing. It returns
    // `moved: [{noteId, updatedAt}]` now, so the control asserts the thing that
    // actually protects a member: this door lands its revisions like any other.
    const folderSite = variableUrlWrites().find(
      (w) => w.file.endsWith('useJ2NoteFolders.js') && `${w.method} ${w.shape}` === 'DELETE /api/j2/note-folders/*',
    )
    expect(folderSite.settles, 'the folder cascade must land the revisions it created').toBe(true)
    expect(ROUTE_EXCEPTIONS, 'and there are no route exceptions left at all').toEqual({})
  })

  it('⭐ CONTROL — the matcher really does report an unsettled door', () => {
    // Built here rather than hoped for in the tree: the check above is only
    // worth its green if this exact shape is what it reports.
    const fake = [
      'const res = await fetch(`/api/j2/notes/${noteId}/embeds`, {',
      "  method: 'POST',",
      '})',
    ].join('\n')
    expect(/fetch\(\s*[`'"]([^`'"]*\/api\/j2\/[^`'"]*)[`'"]/.test(fake)).toBe(true)
    expect(/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(fake)).toBe(true)
    expect(landsARevision(fake)).toBe(false)
    // ⚰️ AND THE COMMENT TRAP THE FIRST VERSION OF THIS RAIL FELL INTO: the
    // explanation, without the call, must NOT read as a settle.
    expect(landsARevision('// settleNoteWrite lands the revision here\nreturn true')).toBe(false)
    expect(landsARevision('await settleNoteWrite(noteId, body.note)')).toBe(true)
  })

  it('⭐ CONTROL — the route derivation really does find the door routes', () => {
    const doors = advancingRoutes(advancing)
    for (const key of [
      'POST /api/j2/notes/*/embeds',
      'POST /api/j2/notes/*/facts/*/insert',
      'POST /api/j2/notes/*/excerpts',
      'POST /api/j2/notes/*/restore',
      'POST /api/j2/notes/*/versions/*/restore',
      'PUT /api/j2/notes/*',
      'POST /api/j2/notes/*/hero',
      'DELETE /api/j2/notes/*/hero',
    ]) expect(doors, `${key} is a door and the derivation missed it`).toContain(key)
    // …and does NOT sweep in the routes that only look like doors.
    for (const key of [
      'POST /api/j2/notes/*/images',
      'POST /api/j2/notes/*/attachments',
      'POST /api/j2/notes/*/facts',
      'POST /api/j2/notes/*/opened',
      'POST /api/j2/notes/*/share',
      'POST /api/j2/notes/*/evidence',
      'POST /api/j2/notes/*/reviews',
      // ⚰️ The trades CSV importer. Its handler is NAMED `import_confirm`, which
      // is how a bare name match turned it into a Notebook door.
      'POST /api/j2/trades/import/confirm',
    ]) expect(doors, `${key} does not advance updated_at and must not be treated as a door`).not.toContain(key)
  })

  it('⭐ every named exception says why it cannot land, and what would close it', () => {
    for (const [key, why] of Object.entries({ ...ROUTE_EXCEPTIONS, ...SITE_EXCEPTIONS })) {
      expect(why.length, `${key} needs a real reason, not a label`).toBeGreaterThan(80)
      expect(why, `${key} must say what would close it`).toMatch(/would have to|To close it/)
    }
  })
})
