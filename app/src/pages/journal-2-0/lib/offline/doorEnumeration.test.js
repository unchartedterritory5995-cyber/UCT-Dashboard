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
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

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

/**
 * ⑤'s ledger of SERVER-side doors outside journal_two.py -- the rows rail ⑤ pins and
 * the census ⑥ classifies. Hoisted unchanged from inside rail ⑤ (wave 10, 10C).
 */
const SERVER_LEDGER = {
  'api/routers/notebook_personal_api.py':
    'create_note for POST /api/j2/personal/notes; the two appends delegate to note_personal_api',
  'api/services/journal_two/note_personal_api.py':
    'update_note(expected_updated_at) under BEGIN IMMEDIATE, 423 on a locked note, no client to settle',
  'api/services/journal_two/inbound_email.py':
    'create_note, then update_note(expected_updated_at) for the attachment nodes; no client to settle',
  'api/services/journal_two/note_daily.py':
    'wave 6: create-if-missing behind journal_two\'s /notes/daily, whose client settles the answer (rail ③ covers that route); '
    + 'since wave 7 ALSO reached from note_personal_api.append_to_daily (POST /api/j2/personal/daily), which has NO client: '
    + 'the day\'s note is created, then appended through note_personal_api\'s own row, and nothing settles either write',
  // Wave 8 (8C; controller ruling on the whole-branch pass): the sample notebook reaches the
  // notes through `import_confirm` and `delete_note`, which the matcher did not name, so the
  // matcher now names every note writer a module outside journal_two.py can call.
  'api/services/journal_two/sample_notebook.py':
    'import_confirm (the file importer\'s own function) seeds NEW notes no tab holds yet, and its second pass '
    + 'rewrites only those fresh ids inside the same call; delete_note (DELETE /api/j2/onboarding/sample-notebook) '
    + 'trashes only the recorded sample ids, and a later save to one reads 404 (update_note treats a trashed note as missing); '
    + 'so its one client door (ResearchHome "Remove it") first runs the bulk trash\'s own pre-check '
    + '(lib/noteBatch.js precheckNoteBatch, op trash: blocked, unsent, unchecked) over the sample ids still out of Trash, and '
    + 'sends the DELETE only when none holds unsent words -- one that does holds the whole removal back and is named, and a '
    + 'device that cannot be checked gets a confirmed "Remove anyway" whose re-run still refuses unsent words (wave-8 final review FE I-3)',
  // Wave 14 lane W14-E (integration): one seeded example per capability, written by the SAME
  // "Add a sample notebook" call. Every note write targets a note this module created moments
  // earlier inside that call (import_confirm, then update_note for the thesis property and
  // append_document_excerpt for the cited passage on those fresh ids), so no tab holds one yet.
  // Its note ids are folded into the sample's recorded ids, so removal is sample_notebook.py's
  // own pre-checked trash above; this module deletes no note itself.
  'api/services/journal_two/sample_examples.py':
    'import_confirm seeds NEW example notes no tab holds yet; update_note (the thesis property) and '
    + 'append_document_excerpt (the cited passage) then write ONLY those fresh ids inside the same seed call; '
    + 'its notes are trashed by sample_notebook.py\'s own pre-checked removal (their ids are recorded with the sample\'s), '
    + 'and its own remove() touches only non-note rows (a passed setup, an insight; a trade or entry context only '
    + 'for a preference recorded by the earlier version -- no trade is seeded)',
  // Notebook P1 (journal styles): "Update layout to vN" (lane A2 Task 10) and styled create (lane A3 Task 9).
  'api/services/journal_two/journal_styles.py':
    'create_styled_note: ONE create_note (body, property values and the style stamp in the same insert) for a NEW '
    + 'note nobody holds yet, behind journal_two\'s POST /api/j2/notes {styleId|kindId}; no follow-up write, so no '
    + 'revision to land beyond the create the client already opens (createNoteViaApi). '
    + 'apply_style_update: ONE update_note(expected_updated_at, style_stamp) under BEGIN IMMEDIATE behind '
    + 'POST /api/j2/notes/{id}/apply-style-update (Task 8\'s router; the dry run is a separate read, '
    + 'GET /api/j2/notes/{id}/style-update-plan -> plan_style_update, which writes nothing). 423 on a locked note '
    + '(notes._refuse_if_locked); the compare-and-set is ALWAYS against the revision the call read the body at, and a '
    + 'client baseUpdatedAt that is not that revision is a 409 before anything is written, so a write landing in '
    + 'between is never overwritten; nothing to add and not switching writes nothing (no stamp-only revision); its '
    + 'client (lib/journalStyles.js applyStyleUpdate) lands the returned note with settleNoteWrite and the editor '
    + 'adopts it (adoptServerCopy)',
  // Wave 11 lane 11C ("Ask Notebook to do something"): a member-APPROVED batch, applied server-side change by
  // change through the member's own writers, each against the revision the member reviewed.
  'api/services/journal_two/ai_actions.py':
    'apply/undo of a reviewed AI change set: patch_note_tags(expected_updated_at), update_note(expected_updated_at) for '
    + 'a property or a folder, note_personal_api.append_nodes(expected_updated_at) for a text/task block, '
    + 'append_financial_fact inside a BEGIN IMMEDIATE that checked the revision, create_note for a new note, and delete_note '
    + '(Trash) only to UNDO a note the set itself created; its client (AiActionsPanel / lib/aiActions.js) lands every '
    + 'revision the apply and undo routes return with settleNoteWrites, and holds back a body block on a note with unsent '
    + 'words on this device',
  // Notebook P1 (journal styles, lane A1): the Research Type -> Kind of note offer. `apply_mapping` writes ONE
  // property (`builtin:note_kind`) per note through update_note, on notes the member chose to map; it never touches
  // a title, subtitle or body, skips a locked note, and the client names (and excludes) every note holding unsent
  // words on this device before it asks. The route that calls it returns each {id, updatedAt} for settleNoteWrites.
  'api/services/journal_two/note_kinds.py':
    'apply_mapping: update_note(properties only: builtin:note_kind) on the member-confirmed unmapped notes, skipping a '
    + 'locked note and any id the client excluded for unsent words; metadata only, every revision returned for the client to land',
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

  it('① (b) and exactly two WRAPPERS reach them without SQL of their own', () => {
    // ⭐ `restore_note_version` writes no SQL — it rebuilds the old content and
    // calls `update_note`, which is why a version restore is a door too and
    // why `useJ2NoteVersions.restoreNoteVersion` has to settle.
    // ⭐ `patch_note_tags` (wave 6, `PATCH /api/j2/notes/{id}/tags`) applies a
    // tag delta under `BEGIN IMMEDIATE` and delegates the write to
    // `update_note` — the same shape. Its client landed in wave 7 (M14):
    // `useJ2Note().patchTags` settles the `{note}` the route answers with —
    // only when its own write moved the revision — and rail ③ below is what
    // demands that. This list is the ledger of wrappers, not permission: a
    // third name here needs its own client settle.
    expect([...advancing].filter((n) => !sql.has(n)).sort()).toEqual(['patch_note_tags', 'restore_note_version'])
  })

  // ⭐ Wave 10 (lane 10A, fix round 1, review I-1): `\b` after the table name. Without it the
  // matcher also read `UPDATE j2_notes_fts_map SET note_rowid` (db.py's map repair) as a write to
  // j2_notes, and ② went red on a writer of a DIFFERENT table. In JS, `\b` never fires between
  // `s` and `_` (both word characters), so the sidecar tables drop out and `j2_notes SET` stays in.
  const WRITES_J2_NOTES = /UPDATE j2_notes\b/

  it('② (control) the writer matcher sees j2_notes and nothing named after it', () => {
    expect(WRITES_J2_NOTES.test('UPDATE j2_notes SET title = ? WHERE id = ?')).toBe(true)
    expect(WRITES_J2_NOTES.test('UPDATE j2_notes\n SET deleted_at = ?')).toBe(true)
    expect(WRITES_J2_NOTES.test('UPDATE j2_notes_fts_map SET note_rowid = ?')).toBe(false)
    expect(WRITES_J2_NOTES.test('UPDATE j2_note_folders SET name = ?')).toBe(false)
  })

  it('② every OTHER server-side writer of j2_notes is a known second writer', () => {
    const offenders = []
    for (const p of walk(API)) {
      if (!p.endsWith('.py') || isTest(p) || p === NOTES_SERVICE) continue
      const src = readFileSync(p, 'utf8')
      if (!WRITES_J2_NOTES.test(src)) continue
      // ⭐ The connector engine is a GENUINE second writer — a different
      // process syncing Roam/Notion/Craft in the background. A fork against it
      // is the CORRECT answer, not a defect; two of its three writers
      // deliberately preserve `updated_at` and are not doors at all.
      if (rel(p).includes('note_connectors/engine.py')) continue
      for (const [name, body] of pyFunctions(src)) {
        if (WRITES_J2_NOTES.test(body)) offenders.push(`${rel(p)}:${name}`)
      }
    }
    expect(offenders, '⛔ a NEW server-side writer of j2_notes is unaccounted for').toEqual([])
  })

  it('⑤ SERVER-side doors OUTSIDE journal_two.py are a LEDGER, each with its settle story', () => {
    // ⚰️ Wave 7 (lane G, controller ledger 2026-09-25). Two new routers — the
    // member personal API and the inbound-email door — reach `notes.create_note`
    // / `notes.update_note` from OUTSIDE journal_two.py, so rail ③ (which reads
    // that one router) cannot see them, and they have NO client caller at all:
    // a Shortcut, a curl, a Cloudflare worker. Nothing records their revision,
    // so a tab holding unsent words when one lands FORKS (ruling D-G1(b),
    // conflict copy, never a clobber); a locked note is refused 423 (D-G1(d));
    // both ship dark. Derived from the code the way ② is, then pinned: a file
    // that starts calling a note writer without a row here fails by name.
    // ⭐ Wave 10 (10C): the rows live at module scope as SERVER_LEDGER, so the
    // loss/fork/none census ⑥ reads the SAME object rather than a copy.
    const LEDGER = SERVER_LEDGER
    const found = []
    for (const p of [...walk(join(API, 'routers')), ...walk(join(API, 'services', 'journal_two'))]) {
      if (!p.endsWith('.py') || isTest(p) || p === NOTES_SERVICE) continue
      if (rel(p) === 'api/routers/journal_two.py') continue            // rail ③ reads it
      if (rel(p).includes('note_connectors/engine.py')) continue      // rail ② ledgers it
      const src = readFileSync(p, 'utf8')
      if (/\b(update_note|create_note|import_confirm|delete_note)\(/.test(src)) found.push(rel(p))
    }
    // non-vacuity: the walk must at least see the wave-6 daily-note creator
    expect(found, '⛔ the server-side door walk found nothing — the matcher is broken, not the tree')
      .toContain('api/services/journal_two/note_daily.py')
    expect(found.sort(), '⛔ a server-side note writer outside journal_two.py has no ledger row (or a row names a file that no longer writes)')
      .toEqual(Object.keys(LEDGER).sort())

    // ⛔ Wave 7 whole-branch fix (backend review M-8): the rail matches FILES, not callers, so
    // a row's settle story can go stale while the file set stays green -- note_daily's row said
    // its only caller has a client after lane G made `append_to_daily` (no client) reach it
    // too. Every module that imports note_daily is now named in note_daily's row.
    const DAILY = 'api/services/journal_two/note_daily.py'
    const dailyCallers = []
    for (const p of walk(API)) {
      if (!p.endsWith('.py') || isTest(p) || rel(p) === DAILY) continue
      const src = readFileSync(p, 'utf8')
      if (/^\s*from\s+[\w.]+\s+import\s+[^\n]*\bnote_daily\b|^\s*import\s+[\w.]*\bnote_daily\b/m.test(src)) {
        dailyCallers.push(rel(p).split('/').pop().replace(/\.py$/, ''))
      }
    }
    expect(dailyCallers, '⛔ the note_daily caller walk found nothing — the matcher is broken, not the tree')
      .toContain('journal_two')
    const unnamed = dailyCallers.filter((mod) => !LEDGER[DAILY].includes(mod))
    expect(unnamed, '⛔ a module reaches note_daily and its ledger row does not say so').toEqual([])
  })

  // ⏱ Explicit timeout (2026-10-02). The first run walks every client source file cold;
  // measured 19.5 s on master and 24.9 s on the wave-13 tree under a loaded box (red at the
  // 15 s default), 1.9 s warm. The assertion is unchanged; only the time budget is widened.
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
  }, 60_000)

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

/**
 * ⛔⛔ ④b — THE WRITES RAIL ④ COULD NOT SEE: a URL handed to a same-file HELPER, and a
 * method that is not a literal. Read with an AST (acorn), the way `hub/writePathsTransitive.test.js`
 * follows same-file calls — not another regex family.
 *
 * ⚰️ WHY (Notebook P1 lane B review, I-1). `lib/journalStyles.js` sends every request through one
 * `call(url, {method})` helper. Rail ③ wants a literal `fetch('/api/j2/...')` and found none; rail ④
 * matched `fetch(url, {` and then SKIPPED it, because `method,` is not the literal `method: 'POST'`
 * it looks for. Deleting the settle from `applyStyleUpdate` left every rail here green — measured by
 * an in-memory probe. "We could not read it" had become "it is not a door", which is the sentence
 * ④'s own header forbids. A second site was blind for the same reason and for longer:
 * `useJ2Notes.js` `setNoteFavorite` writes with `method: isFavorite ? 'POST' : 'DELETE'`.
 *
 * WHAT IT DOES, all derived from the code:
 *   · a function that passes one of its OWN parameters to `fetch(<param>, …)` is a FORWARDING
 *     HELPER; every call to it in the same file is a site, its URL resolved through the file's
 *     `const` literals and its method read from the call's options literal (default from the
 *     helper's destructuring, `method = 'GET'`);
 *   · a direct `fetch` whose method is a ternary of two literals is both of them; any other
 *     non-literal method (an identifier, a call, a spread with no literal beside it, options passed
 *     as a variable) is reported UNRESOLVED-METHOD — never skipped;
 *   · a site's SETTLE WINDOW runs from the site to the end of its enclosing function or the start
 *     of the next scanned site, whichever comes first. The next `fetch(` is the wrong boundary here:
 *     a helper holds the file's only `fetch(`, so every call would borrow the next door's settle.
 *
 * ⛔ WHICH ROUTES ARE DOORS. Rails ② and ③ derive routes from `journal_two.py` alone. The routes this
 * file's two note-moving calls reach live in `notebook_journal_styles.py`, so they cannot be derived
 * today and `STYLE_DOOR_STOPGAP` NAMES them. It is a stopgap, not an authority: each entry must match
 * a real client site (a stale one fails), and widening rail ② to derive these routes (I-1 step 5) is
 * owed before the P1 exit bar — then this list is deleted.
 *
 * ⛔ THE RAIL'S LIMITS, stated so nobody reads silence as coverage:
 *   · THE SCAN RULE: a non-test `.js`/`.jsx` file under `app/src/pages/journal-2-0/` whose SOURCE CONTAINS
 *     `/api/j2/note`. A file that calls fetch but names no note route (lib/notePublishLink.js and its exported
 *     write-capable `requestJson`, used by NoteShareControls.jsx for share/publish — not doors — or the trades
 *     and positions tabs) is NOT read. Widening it to every file that mentions `fetch` was tried and goes red on
 *     ~20 sites in the trades/positions code (non-literal methods, computed URLs) that are not note doors.
 *   · SAME-FILE ONLY. A helper imported from another file (`import { j2call } from './api'`) is NOT followed:
 *     its calls are not sites. Inside a scanned file, a write-capable helper that is exported, passed by
 *     reference, or has no in-file call is reported UNRESOLVED-HELPER (reported, not followed). A call through
 *     an imported helper from a scanned file that does not define it stays unseen.
 *   · FORWARDERS: a function that hands its own parameter(s) to `fetch` — or to an INJECTED fetch (a parameter
 *     named like fetch, `getJson(fetchImpl, url, init)`) — is a helper and every in-file call of it is judged.
 *     An injected fetch that is not such a forwarder is UNRESOLVED-HELPER. A parameter that defaults to
 *     `fetch` / `globalThis.fetch`, and `window.fetch` / `self.fetch` / `globalThis.fetch`, are read as `fetch`.
 *   · SILENT CALLEE SHAPES (not reported): `window.fetch(...)` is read, but an ALIAS of an injected fetch
 *     (`const f = fetchImpl || globalThis.fetch; f(url, { method: 'POST' })`, as notebookTelemetry.js does for
 *     telemetry), and an injected parameter NOT named like fetch (`request(url, ...)`), are not seen.
 *   · A computed method key (`{ ['method']: 'POST' }`) and `fetch(new Request(url, { method: 'POST' }))`
 *     read as GET and are NOT reported.
 *   · SCOPE is `app/src/pages/journal-2-0/` only. Note writers elsewhere (hub/voiceNote.js, the terminal
 *     panels, NotebookWidget) get only rail ③'s literal check. Widening 4b there today would red on
 *     UpbEntryPage.jsx's eight positional-method `upbFetch(url, 'POST', ...)` calls, which are not doors.
 *   · URL constants resolve BY SCOPE. EVERY local binding is registered in its function (any const/let/var,
 *     patterns, for…of heads, function/class names, imports, catch parameters, parameters). The enclosing
 *     function's own binding wins; a binding whose initialiser the rail cannot read, one that is reassigned,
 *     one declared twice in a scope, or a parameter, resolves to NULL (UNRESOLVED-URL where a write goes) and
 *     never to an outer constant of the same name. A name with NO local binding at all falls to null too.
 */
const JsxParser = Parser.extend(jsx())
const AST_FUNC_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
const isAstNode = (v) => v && typeof v === 'object' && typeof v.type === 'string'

function astWalk(node, visit, stack = []) {
  if (!isAstNode(node)) return
  visit(node, stack)
  stack.push(node)
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue
    const v = node[k]
    if (Array.isArray(v)) v.forEach((x) => astWalk(x, visit, stack))
    else astWalk(v, visit, stack)
  }
  stack.pop()
}

const STYLE_DOOR_STOPGAP = {
  'POST /api/j2/notes/*/apply-style-update':
    'Update layout (Task 10): one compare-and-set write on a note; the route lives in notebook_journal_styles.py, '
    + 'which rail ② does not read. To close it, rail ② would have to derive routes from every router declaring the '
    + '/api/j2 prefix and follow service delegation into update_note.',
  'POST /api/j2/note-kinds/mapping-offer':
    'The kind mapping offer (Task 4): update_note on many notes via note_kinds.apply_mapping, answered with '
    + '[{id, updatedAt}]. Same router, same reason. To close it, rail ② would have to derive it as above.',
}

/** The names a function declares as parameters (plain, defaulted, rest, destructured). */
function paramNamesOf(fn) {
  const out = new Set()
  const add = (p) => {
    if (!p) return
    if (p.type === 'Identifier') out.add(p.name)
    else if (p.type === 'AssignmentPattern') add(p.left)
    else if (p.type === 'RestElement') add(p.argument)
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => add(q.type === 'RestElement' ? q.argument : q.value))
    else if (p.type === 'ArrayPattern') p.elements.forEach(add)
  }
  fn.params.forEach(add)
  return out
}
/** The functions around a node, innermost first (from an astWalk ancestor stack). */
const fnChainOf = (stack) => [...stack].reverse().filter((x) => AST_FUNC_TYPES.has(x.type))

/** Every name a binding pattern introduces (`x`, `{ a, b: c }`, `[d, ...e]`, defaults, rest). */
function patternNames(p) {
  if (!p) return []
  if (p.type === 'Identifier') return [p.name]
  if (p.type === 'AssignmentPattern') return patternNames(p.left)
  if (p.type === 'RestElement') return patternNames(p.argument)
  if (p.type === 'ObjectPattern') return p.properties.flatMap((q) => patternNames(q.type === 'RestElement' ? q.argument : q.value))
  if (p.type === 'ArrayPattern') return p.elements.flatMap(patternNames)
  return []
}

/** Every LOCAL BINDING of the file, with the function it lives in: any `const`/`let`/`var` (patterns and
 *  `for…of/in` heads included), function and class names, imports, catch parameters. Only a binding whose
 *  initialiser is a literal / template / `+` / ternary / call is READABLE, and only while nothing assigns to
 *  it; every other binding is registered as UNREADABLE so it shadows an outer constant of the same name
 *  instead of letting it through. Same-file functions are also kept under `fn:<name>` (so
 *  `selectionExportUrl(format)` resolves to what it returns). */
function constNodes(ast) {
  const map = new Map()
  const add = (name, node, chain, readable) => {
    if (!map.has(name)) map.set(name, [])
    map.get(name).push({ node, chain, scope: chain[0] ?? null, readable, reassigned: false })
  }
  const READABLE = ['Literal', 'TemplateLiteral', 'BinaryExpression', 'ConditionalExpression', 'CallExpression']
  astWalk(ast, (n, stack) => {
    const chain = fnChainOf(stack)
    if (n.type === 'FunctionDeclaration' && n.id) { add(`fn:${n.id.name}`, n, chain, true); add(n.id.name, null, chain, false) }
    if (n.type === 'ClassDeclaration' && n.id) add(n.id.name, null, chain, false)
    if (n.type === 'ImportDeclaration') n.specifiers.forEach((sp) => add(sp.local.name, null, [], false))
    if (n.type === 'CatchClause') patternNames(n.param).forEach((nm) => add(nm, null, chain, false))
    if (n.type === 'VariableDeclarator') {
      if (n.id.type !== 'Identifier') { patternNames(n.id).forEach((nm) => add(nm, null, chain, false)); return }
      if (n.init && AST_FUNC_TYPES.has(n.init.type)) add(`fn:${n.id.name}`, n.init, chain, true)
      const ok = Boolean(n.init) && READABLE.includes(n.init.type)
      add(n.id.name, ok ? n.init : null, chain, ok)
    }
  })
  // an assignment (or `++`, or a bare `for (x of …)` head) makes the binding it reaches unreadable
  astWalk(ast, (n, stack) => {
    let names = []
    if (n.type === 'AssignmentExpression') names = patternNames(n.left)
    if (n.type === 'UpdateExpression') names = patternNames(n.argument)
    if ((n.type === 'ForOfStatement' || n.type === 'ForInStatement') && n.left.type !== 'VariableDeclaration') names = patternNames(n.left)
    const chain = fnChainOf(stack)
    for (const nm of names) {
      for (const scope of [...chain, null]) {
        const hit = (map.get(nm) || []).filter((x) => x.scope === scope)
        if (hit.length || (scope && paramNamesOf(scope).has(nm))) { hit.forEach((x) => { x.reassigned = true }); break }
      }
    }
  })
  return map
}

/** The binding a name means at a place: the enclosing function's own first, then outward to the module.
 *  `null` = it is a parameter, declared twice in one scope, unreadable, or reassigned: NEVER guessed, and never
 *  resolved to an outer constant of the same name. `undefined` = not declared as a local binding at all. */
function lookupBinding(name, chain, consts) {
  for (const scope of [...chain, null]) {
    if (scope && paramNamesOf(scope).has(name)) return null
    const here = (consts.get(name) || []).filter((x) => x.scope === scope)
    if (here.length > 1) return null
    if (here.length === 1) return here[0].readable && !here[0].reassigned ? here[0] : null
  }
  return undefined
}

/** A URL expression as the route shapes it can resolve to: literal text kept, every other expression →
 *  `*`, a conditional is BOTH branches, a conditional query suffix (`cond ? '?a=1' : ''`) is dropped.
 *  `null` = could not be read at all (a parameter, an ambiguous name, a bare variable with no const behind it).
 *  `chain` = the functions around the expression, innermost first. */
function urlShapesOf(node, consts, chain, seen = new Set()) {
  if (!node) return null
  if (node.type === 'Literal') return typeof node.value === 'string' ? [node.value] : null
  if (node.type === 'Identifier') {
    const b = lookupBinding(node.name, chain, consts)
    if (!b || seen.has(b)) return null
    return urlShapesOf(b.node, consts, b.chain, new Set([...seen, b]))
  }
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
    // a same-file function that just returns a URL expression: its parameters are path segments
    const b = lookupBinding(`fn:${node.callee.name}`, chain, consts)
    if (!b || seen.has(b)) return null
    const fn = b.node
    const ret = fn.body.type === 'BlockStatement'
      ? fn.body.body.filter((x) => x.type === 'ReturnStatement').at(-1)?.argument : fn.body
    return urlShapesOf(ret, consts, [fn, ...b.chain], new Set([...seen, b]))
  }
  if (node.type === 'ConditionalExpression') {
    const c = urlShapesOf(node.consequent, consts, chain, seen)
    const alt = urlShapesOf(node.alternate, consts, chain, seen)
    return c && alt ? [...c, ...alt] : null
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const l = urlShapesOf(node.left, consts, chain, seen)
    if (!l) return null
    const r = urlShapesOf(node.right, consts, chain, seen) ?? ['*']
    return l.flatMap((x) => r.map((y) => `${x}${y}`))
  }
  if (node.type === 'TemplateLiteral') {
    let out = ['']
    for (let i = 0; i < node.quasis.length; i += 1) {
      out = out.map((x) => x + node.quasis[i].value.cooked)
      if (i < node.expressions.length) {
        const e = node.expressions[i]
        let parts = ['*']
        if (e.type === 'Identifier') parts = urlShapesOf(e, consts, chain, seen) ?? ['*']
        else if (e.type === 'ConditionalExpression') {
          const got = urlShapesOf(e, consts, chain, seen)
          // `${q ? `?a=${x}` : ''}`: an optional QUERY, not a path segment
          if (got && got.every((g) => g === '' || g.startsWith('?'))) parts = ['']
        }
        out = out.flatMap((x) => parts.map((p) => x + p))
      }
    }
    return out
  }
  return null
}
const routesOf = (shapes) => (shapes === null ? null : shapes.map((x) => x.replace(/\?.*$/, '')))

const isMethodProp = (p) => p.type === 'Property' && !p.computed && (p.key.name === 'method' || p.key.value === 'method')

/** The literal methods an options expression resolves to; `undefined` = cannot say. */
function methodsOfOptions(opts, fallback = 'GET') {
  if (opts === undefined) return [fallback]
  if (opts.type === 'ConditionalExpression') {
    // `cond ? { credentials, signal } : { credentials }`: both branches must be readable
    const c = methodsOfOptions(opts.consequent, fallback)
    const alt = methodsOfOptions(opts.alternate, fallback)
    return c && alt ? [...new Set([...c, ...alt])] : undefined
  }
  if (opts.type !== 'ObjectExpression') return undefined
  const prop = opts.properties.find(isMethodProp)
  if (!prop) return opts.properties.some((p) => p.type === 'SpreadElement') ? undefined : [fallback]
  const v = prop.value
  if (v.type === 'Literal' && typeof v.value === 'string') return [v.value.toUpperCase()]
  if (v.type === 'ConditionalExpression' && [v.consequent, v.alternate]
    .every((b) => b.type === 'Literal' && typeof b.value === 'string')) {
    return [v.consequent.value.toUpperCase(), v.alternate.value.toUpperCase()]
  }
  return undefined
}

const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const isFetchRef = (e) => Boolean(e) && ((e.type === 'Identifier' && e.name === 'fetch')
  || (e.type === 'MemberExpression' && !e.computed && e.property.name === 'fetch'
    && ['globalThis', 'window', 'self'].includes(e.object.name)))

/** Every request site in one file: direct `fetch`es and calls to same-file forwarding helpers, plus the
 *  write-capable helpers and injected fetches the scan cannot judge (UNRESOLVED-HELPER). */
function scanSites(file, src) {
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const consts = constNodes(ast)
  const nameOfFn = new Map()
  astWalk(ast, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id) nameOfFn.set(n, n.id.name)
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init && AST_FUNC_TYPES.has(n.init.type)) {
      nameOfFn.set(n.init, n.id.name)
    }
  })
  const innermostFn = (stack) => [...stack].reverse().find((x) => AST_FUNC_TYPES.has(x.type))
  const bare = (p) => (p.type === 'AssignmentPattern' ? p.left : p)
  const helperProblems = []

  /** 'fetch' (the global, `window|self|globalThis.fetch`, or a parameter defaulting to it), 'injected' (a
   *  parameter named like fetch), or null */
  const fetchKind = (n, stack) => {
    if (isFetchRef(n.callee)) return 'fetch'
    if (n.callee.type !== 'Identifier') return null
    const name = n.callee.name
    for (const fn of fnChainOf(stack)) {
      const p = fn.params.find((q) => bare(q).type === 'Identifier' && bare(q).name === name)
      if (p) return p.type === 'AssignmentPattern' && isFetchRef(p.right) ? 'fetch' : (/fetch/i.test(name) ? 'injected' : null)
    }
    return null
  }

  // pass 1: forwarding helpers — a function handing one of its own parameters to fetch
  const helpers = new Map()
  const helperFetches = new Set()
  astWalk(ast, (n, stack) => {
    if (n.type !== 'CallExpression') return
    const kind = fetchKind(n, stack)
    if (!kind) return
    const fn = innermostFn(stack)
    const a0 = n.arguments[0]
    const idx = fn && a0?.type === 'Identifier'
      ? fn.params.findIndex((p) => bare(p).type === 'Identifier' && bare(p).name === a0.name) : -1
    if (idx < 0 || !nameOfFn.get(fn)) {
      // an injected fetch that is NOT a parameter-forwarding helper cannot be judged: reported, never silent
      if (kind === 'injected') helperProblems.push({ line: n.loc.start.line, name: n.callee.name, why: 'a fetch injected as a parameter' })
      return
    }
    helperFetches.add(n)
    const opts = n.arguments[1]
    const mprop = opts?.type === 'ObjectExpression' ? opts.properties.find(isMethodProp) : null
    const h = { name: nameOfFn.get(fn), urlIdx: idx, optsIdx: -1, fixed: null, fallback: 'GET', fn, calls: 0 }
    // the options are the helper's own parameter, handed through whole (`fetch(url, opts)`) or spread in
    // (`fetch(url, { credentials, ...init })`): the call's options literal says the method
    const passed = opts?.type === 'Identifier' ? opts
      : (opts?.type === 'ObjectExpression' && !mprop
        ? opts.properties.find((p) => p.type === 'SpreadElement' && p.argument.type === 'Identifier')?.argument : null)
    const passedIdx = passed ? fn.params.findIndex((p) => bare(p).type === 'Identifier' && bare(p).name === passed.name) : -1
    if (passedIdx >= 0) h.optsIdx = passedIdx
    else if (!mprop) h.fixed = methodsOfOptions(opts)
    else if (mprop.value.type === 'Identifier') {
      // the method is a destructured option of the helper: `{ method = 'GET', body }`
      fn.params.forEach((p, i) => {
        const pat = bare(p)
        if (pat.type !== 'ObjectPattern') return
        for (const pp of pat.properties) {
          if (pp.type !== 'Property') continue
          const local = pp.value.type === 'AssignmentPattern' ? pp.value.left : pp.value
          if (local.type === 'Identifier' && local.name === mprop.value.name) {
            h.optsIdx = i
            if (pp.value.type === 'AssignmentPattern' && pp.value.right.type === 'Literal') {
              h.fallback = String(pp.value.right.value).toUpperCase()
            }
          }
        }
      })
      if (h.optsIdx < 0) h.fixed = undefined
    } else h.fixed = methodsOfOptions(opts)
    helpers.set(h.name, h)
  })

  const sites = []
  const push = (n, stack, over) => {
    const fn = innermostFn(stack)
    sites.push({
      file, line: n.loc.start.line, start: n.start, end: n.end, fnEnd: fn ? fn.end : src.length,
      fnName: fn ? nameOfFn.get(fn) || null : null, ...over,
    })
  }
  // pass 2: sites
  astWalk(ast, (n, stack) => {
    if (n.type !== 'CallExpression') return
    const kind = fetchKind(n, stack)
    if (!kind && n.callee.type !== 'Identifier') return
    const chain = fnChainOf(stack)
    if (kind) {
      // a forwarder (`getJson(fetchImpl, url, init)`) is judged at ITS call sites; an injected fetch that is not
      // one was reported in pass 1
      if (helperFetches.has(n) || kind === 'injected') return

      push(n, stack, { kind: 'fetch', methods: methodsOfOptions(n.arguments[1]), shapes: routesOf(urlShapesOf(n.arguments[0], consts, chain)) })
      return
    }
    const h = helpers.get(n.callee.name)
    if (!h) return
    h.calls += 1
    const methods = h.optsIdx >= 0 ? methodsOfOptions(n.arguments[h.optsIdx], h.fallback) : h.fixed
    push(n, stack, { kind: 'helper', methods, shapes: routesOf(urlShapesOf(n.arguments[h.urlIdx], consts, chain)) })
  })

  // a write-capable helper the same-file call scan cannot account for is REPORTED, never silent
  const exported = new Set()
  const byReference = new Set()
  astWalk(ast, (n, stack) => {
    if (n.type === 'ExportNamedDeclaration') {
      const d = n.declaration
      if (d?.type === 'FunctionDeclaration' && d.id) exported.add(d.id.name)
      if (d?.type === 'VariableDeclaration') d.declarations.forEach((x) => { if (x.id.type === 'Identifier') exported.add(x.id.name) })
      ;(n.specifiers || []).forEach((sp) => exported.add(sp.local.name))
    }
    if (n.type === 'ExportDefaultDeclaration' && n.declaration.type === 'Identifier') exported.add(n.declaration.name)
    if (n.type !== 'Identifier' || !helpers.has(n.name)) return
    const parent = stack.at(-1)
    if (!parent) return
    if (parent.type === 'CallExpression' && parent.callee === n) return
    if ((parent.type === 'VariableDeclarator' || parent.type === 'FunctionDeclaration') && parent.id === n) return
    if (parent.type === 'MemberExpression' && parent.property === n && !parent.computed) return
    if (parent.type === 'Property' && parent.key === n && !parent.computed && !parent.shorthand) return
    if (parent.type === 'ExportSpecifier' || parent.type === 'ExportDefaultDeclaration') return
    byReference.add(n.name)
  })
  for (const h of helpers.values()) {
    const writeCapable = h.optsIdx >= 0 || h.fixed === undefined || (h.fixed || []).some((m) => WRITE_VERBS.has(m))
    if (!writeCapable) continue
    const why = [exported.has(h.name) && 'exported', byReference.has(h.name) && 'passed by reference', h.calls === 0 && 'no in-file call']
      .filter(Boolean).join(', ')
    if (why) helperProblems.push({ line: h.fn.loc.start.line, name: h.name, why: `a write-capable helper that is ${why}` })
  }

  sites.sort((x, y) => x.start - y.start)
  return {
    helperProblems,
    sites: sites.map((st, i) => {
      const next = sites.slice(i + 1).find((x) => x.start >= st.end)
      const windowEnd = Math.min(st.fnEnd, next ? next.start : src.length)
      return {
        ...st,
        keys: st.methods && st.shapes ? st.methods.flatMap((m) => st.shapes.map((sh) => `${m} ${sh}`)) : [],
        settles: landsARevision(src.slice(st.start, windowEnd)),
      }
    }),
  }
}

/**
 * The problems rail ④b reports for a set of {path: source} files. Pure, so the controls below can run
 * it over an in-memory copy of the real file with a settle deleted and watch it go red.
 *   UNRESOLVED-METHOD — a request whose method could not be read (never skipped);
 *   UNRESOLVED-URL    — a WRITE whose URL could not be read;
 *   UNRESOLVED-HELPER — a write-capable helper or injected fetch the same-file scan cannot account for;
 *   UNSETTLED         — a write to a door route that never lands its revision.
 * ⛔ UNSETTLED is judged on EVERY resolved site, direct fetches included. An earlier version skipped any
 * direct fetch with a literal `method: 'POST'` on the theory that rails ③/④ had judged it; they key on
 * rail ②'s door set, so they judged neither the stopgap routes nor any door reached by a computed URL.
 * Double-judging a site they also judge is harmless: the two agree on every door site in the tree.
 */
function forwardedProblems(files, doorKeys, exceptions = { ...ROUTE_EXCEPTIONS, ...SITE_EXCEPTIONS }) {
  const problems = []
  const seen = []
  for (const [file, src] of Object.entries(files)) {
    let scan
    try { scan = scanSites(file, src) } catch (e) {
      problems.push(`UNPARSEABLE: ${file} -- ${e.message}`)
      continue
    }
    for (const hp of scan.helperProblems) {
      problems.push(`UNRESOLVED-HELPER: ${file}:${hp.line} (${hp.name}) -- ${hp.why}`)
    }
    for (const st of scan.sites) {
      seen.push(st)
      if (st.methods === undefined) { problems.push(`UNRESOLVED-METHOD: ${file}:${st.line}`); continue }
      // an unreadable URL matters where a WRITE goes: a GET helper called with a computed URL is a read
      if (st.shapes === null && st.methods.some((m) => WRITE_VERBS.has(m))) problems.push(`UNRESOLVED-URL: ${file}:${st.line}`)
      for (const key of st.keys) {
        if (!WRITE_VERBS.has(key.split(' ')[0]) || !doorKeys.has(key)) continue
        if (exceptions[key] || exceptions[`${file}:${key}`]) continue
        if (!st.settles) problems.push(`UNSETTLED: ${file}:${st.line}${st.fnName ? ` (${st.fnName})` : ''} — ${key}`)
      }
    }
  }
  return { problems, sites: seen }
}

/** Every non-test `.js`/`.jsx` file under journal-2-0 whose SOURCE CONTAINS `/api/j2/note`, as {repo-relative
 *  path: source}. ⛔ That is the scan rule, and it is a limit: a file that calls fetch but names no note route
 *  (notePublishLink.js, the trades and positions tabs) is not read. Widening it to every file that mentions
 *  `fetch` was tried and goes RED on ~20 sites in the trades/positions code that are not note doors
 *  (non-literal methods, computed URLs), so it is stated rather than done. */
function noteTouchingSources() {
  const out = {}
  for (const p of walk(join(CLIENT, 'pages', 'journal-2-0'))) {
    if (!/\.(js|jsx)$/.test(p) || isTest(p)) continue
    const src = readFileSync(p, 'utf8')
    if (/\/api\/j2\/note/.test(src)) out[rel(p)] = src
  }
  return out
}

const JOURNAL_STYLES_FILE = 'app/src/pages/journal-2-0/lib/journalStyles.js'
const NOTES_HOOK_FILE = 'app/src/pages/journal-2-0/hooks/useJ2Notes.js'

describe('⛔⛔ ④b — helper-forwarded and dynamic-method writes are SEEN, resolved, and checked', () => {
  const doors = () => advancingRoutes(reachingFunctions(sqlAdvancingFunctions()))
  const doorKeys = () => new Set([...doors(), ...Object.keys(STYLE_DOOR_STOPGAP)])
  // CRLF-normalised: a Windows checkout with core.autocrlf writes the file with CRLF, and the controls
  // below delete exact `\n`-terminated lines (found on the integration merge, where it read "could not find").
  const styles = () => readFileSync(join(REPO, ...JOURNAL_STYLES_FILE.split('/')), 'utf8').replace(/\r\n/g, '\n')

  it('every request in a note-touching file has a readable method, and every door write lands its revision', () => {
    const files = noteTouchingSources()
    expect(Object.keys(files), 'the scan found no files — the matcher is broken, not the tree')
      .toContain(JOURNAL_STYLES_FILE)
    const { problems, sites } = forwardedProblems(files, doorKeys())
    expect(sites.length, 'the AST scan saw almost no requests').toBeGreaterThan(40)
    expect(problems, '⛔ a request the door rail cannot read, or a door write that never lands its revision').toEqual([])
  }, 60_000)

  it('⭐ CONTROL — both of journalStyles.js\'s note-moving calls resolve to their routes and are seen as settled', () => {
    const { sites } = forwardedProblems({ [JOURNAL_STYLES_FILE]: styles() }, doorKeys())
    const apply = sites.find((s) => s.fnName === 'applyStyleUpdate')
    const mapping = sites.find((s) => s.fnName === 'applyMappingOffer')
    expect(apply?.keys, 'applyStyleUpdate must resolve through call() to its route').toEqual(['POST /api/j2/notes/*/apply-style-update'])
    expect(apply.settles).toBe(true)
    expect(mapping?.keys).toEqual(['POST /api/j2/note-kinds/mapping-offer'])
    expect(mapping.settles).toBe(true)
    // …and the dry-run plan is a GET, not a write at all
    const plan = sites.find((s) => s.fnName === 'planStyleUpdate')
    expect(plan?.keys).toEqual(['GET /api/j2/notes/*/style-update-plan'])
    // the stopgap names are matched by real sites (a stale entry fails here)
    const seenKeys = new Set(sites.flatMap((s) => s.keys))
    for (const k of Object.keys(STYLE_DOOR_STOPGAP)) {
      expect(seenKeys.has(k), `${k} matches no client site`).toBe(true)
      // …and the stopgap is deleted the moment rail ② derives the route itself: two authorities otherwise
      expect(doors().has(k), `rail ② now derives ${k}: DELETE its STYLE_DOOR_STOPGAP entry`).toBe(false)
    }
  })

  it('⭐ CONTROL — an in-memory copy of journalStyles.js with a settle deleted makes the rail go RED, and says where', () => {
    const src = styles()
    expect(forwardedProblems({ [JOURNAL_STYLES_FILE]: src }, doorKeys()).problems).toEqual([])
    const noApply = src.replace('  await settleNoteWrite(out.note.id, out.note, accountId)\n', '')
    expect(noApply, 'the control could not find the line it deletes').not.toBe(src)
    const red1 = forwardedProblems({ [JOURNAL_STYLES_FILE]: noApply }, doorKeys()).problems
    expect(red1.join('\n')).toMatch(/UNSETTLED: .*journalStyles\.js:\d+ \(applyStyleUpdate\) — POST \/api\/j2\/notes\/\*\/apply-style-update/)
    const noMapping = src.replace(/ {2}await settleNoteWrites\([^\n]*\n/, '')
    expect(noMapping, 'the control could not find the line it deletes').not.toBe(src)
    const red2 = forwardedProblems({ [JOURNAL_STYLES_FILE]: noMapping }, doorKeys()).problems
    expect(red2.join('\n')).toMatch(/UNSETTLED: .*\(applyMappingOffer\) — POST \/api\/j2\/note-kinds\/mapping-offer/)
    // the window ends at the function: the neighbouring door's settle is not borrowed
    expect(red2.join('\n')).not.toMatch(/applyStyleUpdate/)
    expect(red1.join('\n')).not.toMatch(/applyMappingOffer/)
  })

  it('⭐ CONTROL — a planted dynamic-method fetch is reported UNRESOLVED-METHOD; a two-literal ternary is resolved', () => {
    const planted = [
      "export async function a(id, m) { return fetch(`/api/j2/notes/${id}/x`, { method: m, credentials: 'include' }) }",
      "export async function b(id, init) { return fetch(`/api/j2/notes/${id}/y`, init) }",
      "export async function c(id, p) { return fetch(`/api/j2/notes/${id}/z`, { ...p }) }",
      "export async function d(id, on) { return fetch(`/api/j2/notes/${id}/f`, { method: on ? 'POST' : 'DELETE' }) }",
      "export async function e(id) { return fetch(`/api/j2/notes/${id}/g`) }",
    ].join('\n')
    const { problems, sites } = forwardedProblems({ 'planted.js': planted }, new Set())
    expect(problems).toEqual(['UNRESOLVED-METHOD: planted.js:1', 'UNRESOLVED-METHOD: planted.js:2', 'UNRESOLVED-METHOD: planted.js:3'])
    expect(sites.find((s) => s.line === 4).keys).toEqual(['POST /api/j2/notes/*/f', 'DELETE /api/j2/notes/*/f'])
    expect(sites.find((s) => s.line === 5).keys).toEqual(['GET /api/j2/notes/*/g'])
  })

  it('⭐ CONTROL — a helper\'s calls get their OWN method and URL, and an unsettled door call is reported', () => {
    const planted = [
      "const BASE = '/api/j2/notes'",
      "async function call(url, { method = 'GET', body } = {}) { const r = await fetch(url, { method, body }); return r.json() }",
      'export const read = (id) => call(`${BASE}/${id}`)',
      "export async function move(id) { const out = await call(`${BASE}/${id}/hero`, { method: 'POST' }); return out }",
      "export async function settled(id) { const out = await call(`${BASE}/${id}/hero`, { method: 'POST' }); await settleNoteWrite(id, out); return out }",
    ].join('\n')
    const { problems, sites } = forwardedProblems({ 'planted.js': planted }, new Set(['POST /api/j2/notes/*/hero']))
    expect(sites.find((s) => s.fnName === 'read').keys).toEqual(['GET /api/j2/notes/*'])
    expect(problems).toEqual(['UNSETTLED: planted.js:4 (move) — POST /api/j2/notes/*/hero'])
  })

  it('⭐ the favourite toggle, blind to every rail until now, resolves to both routes and is not a door', () => {
    const src = noteTouchingSources()[NOTES_HOOK_FILE]
    const { sites } = forwardedProblems({ [NOTES_HOOK_FILE]: src }, doorKeys())
    const fav = sites.find((s) => s.fnName === 'setNoteFavorite')
    expect(fav?.keys).toEqual(['POST /api/j2/notes/*/favorite', 'DELETE /api/j2/notes/*/favorite'])
    // the derivation (journal_two.py's own SQL) does not find it advancing updated_at, so there is
    // no revision to land -- a fact derived from the code, not a label
    expect(doors().has('POST /api/j2/notes/*/favorite')).toBe(false)
    expect(doors().has('DELETE /api/j2/notes/*/favorite')).toBe(false)
  })

  // ── I-A: every direct fetch is judged, not only the ones with a non-literal shape ──────────────
  it('⭐ CONTROL — a DIRECT fetch to a stopgap door with no settle is RED, and settled it is clean', () => {
    const bad = [
      'export async function go(id) {',
      '  const r = await fetch(`/api/j2/notes/${id}/apply-style-update`, { method: \'POST\' })',
      '  return r.json()',
      '}',
    ].join('\n')
    const stop = new Set(Object.keys(STYLE_DOOR_STOPGAP))
    expect(forwardedProblems({ 'planted.js': bad }, stop).problems)
      .toEqual(['UNSETTLED: planted.js:2 (go) — POST /api/j2/notes/*/apply-style-update'])
    const good = bad.replace('  return r.json()', '  const b = await r.json()\n  await settleNoteWrite(id, b.note)\n  return b')
    expect(forwardedProblems({ 'planted.js': good }, stop).problems).toEqual([])
  })

  it('⭐ CONTROL — a door reached by a COMPUTED URL (concatenation, a URL function) with no settle is RED', () => {
    const planted = [
      "const BASE = '/api/j2/notes'",
      "const heroUrl = (id) => `/api/j2/notes/${id}/hero`",
      "export async function a(id) { return fetch(BASE + '/' + id + '/hero', { method: 'POST' }) }",
      "export async function b(id) { return fetch(heroUrl(id), { method: 'POST' }) }",
    ].join('\n')
    expect(forwardedProblems({ 'planted.js': planted }, new Set(['POST /api/j2/notes/*/hero'])).problems).toEqual([
      'UNSETTLED: planted.js:3 (a) — POST /api/j2/notes/*/hero',
      'UNSETTLED: planted.js:4 (b) — POST /api/j2/notes/*/hero',
    ])
  })

  // ── I-B: a write-capable helper the scan cannot account for is REPORTED ─────────────────────────
  it('⭐ CONTROL — an exported, by-reference, call-less or injected write helper is UNRESOLVED-HELPER; a read helper is not', () => {
    const run = (src) => forwardedProblems({ 'planted.js': src }, new Set()).problems
    expect(run('export async function send(url, init) { return fetch(url, init) }'))
      .toEqual([expect.stringMatching(/^UNRESOLVED-HELPER: planted\.js:1 \(send\) -- .*exported/)])
    expect(run([
      'const sender = async (url, init) => fetch(url, init)',
      "sender('/api/j2/notes/1/x', { method: 'POST' })",
      'useThing(sender)',
    ].join('\n'))).toEqual([expect.stringMatching(/^UNRESOLVED-HELPER: planted\.js:1 \(sender\) -- .*passed by reference/)])
    expect(run('async function send(url, init) { return fetch(url, init) }'))
      .toEqual([expect.stringMatching(/^UNRESOLVED-HELPER: planted\.js:1 \(send\) -- .*no in-file call/)])
    expect(run("export async function archive(id, fetchImpl) { return fetchImpl('/api/j2/notes/1/archive', { method: 'PATCH' }) }"))
      .toEqual([expect.stringMatching(/^UNRESOLVED-HELPER: planted\.js:1 \(fetchImpl\) -- .*injected/)])
    // a GET-only helper, exported, is a read: nothing to judge
    expect(run('export const fetcher = (url) => fetch(url)')).toEqual([])
    // a parameter that DEFAULTS to fetch is fetch itself, so the call is an ordinary site
    const { problems, sites } = forwardedProblems({
      'planted.js': "export async function archive(id, fetchImpl = globalThis.fetch) { return fetchImpl(`/api/j2/notes/${id}/archive`, { method: 'PATCH' }) }",
    }, new Set())
    expect(problems).toEqual([])
    expect(sites[0].keys).toEqual(['PATCH /api/j2/notes/*/archive'])
  })

  // ── I-C: constants resolve by scope ────────────────────────────────────────────────────────────
  it('⭐ CONTROL — a `const url` in one function is not read as a later function\'s `const url`', () => {
    const planted = [
      'export async function setHero(id) {',
      '  const url = `/api/j2/notes/${id}/hero`',
      "  const out = await call(url, { method: 'POST' })",
      '  return out',
      '}',
      'export async function search() {',
      "  const url = '/api/j2/notes/search'",
      '  return call(url)',
      '}',
      'async function call(url, init) { return fetch(url, init) }',
    ].join('\n')
    const { problems, sites } = forwardedProblems({ 'planted.js': planted }, new Set(['POST /api/j2/notes/*/hero']))
    expect(sites.find((x) => x.fnName === 'setHero').keys).toEqual(['POST /api/j2/notes/*/hero'])
    expect(sites.find((x) => x.fnName === 'search').keys).toEqual(['GET /api/j2/notes/search'])
    expect(problems).toEqual(['UNSETTLED: planted.js:3 (setHero) — POST /api/j2/notes/*/hero'])
  })

  it('⭐ CONTROL — a name declared twice in ONE scope, or shadowed by a parameter, is unreadable, never guessed', () => {
    const twice = [
      // the module also has a `url`: an ambiguous inner name must NOT fall through to it
      "const url = '/api/j2/notes/search'",
      'export async function f(id, big) {',
      "  if (big) { const url = '/api/j2/notes/big' }",
      '  const url = `/api/j2/notes/${id}/hero`',
      "  return fetch(url, { method: 'POST' })",
      '}',
    ].join('\n')
    expect(forwardedProblems({ 'planted.js': twice }, new Set()).problems).toEqual(['UNRESOLVED-URL: planted.js:5'])
    const shadow = [
      "const url = '/api/j2/notes/search'",
      "export async function g(url) { const x = url + '/y'; return fetch(x, { method: 'POST' }) }",
    ].join('\n')
    expect(forwardedProblems({ 'planted.js': shadow }, new Set()).problems).toEqual(['UNRESOLVED-URL: planted.js:2'])
    // an outer module constant is still found from inside a function that does not redeclare it
    const outer = [
      "const BASE = '/api/j2/notes'",
      "export async function h() { const url = BASE + '/x'; return fetch(url, { method: 'POST' }) }",
      "export async function i() { const url = BASE + '/y'; return fetch(url, { method: 'POST' }) }",
    ].join('\n')
    const { problems, sites } = forwardedProblems({ 'planted.js': outer }, new Set())
    expect(problems).toEqual([])
    expect(sites.map((x) => x.keys[0])).toEqual(['POST /api/j2/notes/x', 'POST /api/j2/notes/y'])
  })


  // ── C-1: EVERY local binding shadows an outer constant, whatever its shape ───────────────────────
  it.each([
    ['a call initialiser the rail cannot read', 'const url = heroOf(id)'],
    ['a destructured binding', 'const { url } = cfg'],
    ['a for…of loop variable', 'for (const url of urls) { await fetch(url, { method: \'POST\' }) }'],
    ['a `let` that is reassigned', 'let url = \'/api/j2/notes/search\'; url = `/api/j2/notes/${id}/hero`'],
    ['a catch parameter', 'try { x() } catch (url) { y() }'],
    ['a function declared with the name', 'function url() { return \'/api/j2/notes/hero\' }'],
  ])('⭐ CONTROL — %s shadows the module constant and is UNREADABLE, never read as the outer one', (_what, decl) => {
    const loop = decl.startsWith('for')
    const planted = [
      "const url = '/api/j2/notes/search'",
      'export async function f(id, urls, cfg) {',
      `  ${decl}`,
      ...(loop ? [] : ["  const r = await fetch(url, { method: 'POST' })", '  return r']),
      '}',
    ].join('\n')
    const { problems, sites } = forwardedProblems({ 'planted.js': planted }, new Set(['POST /api/j2/notes/search']))
    expect(sites.map((x) => x.keys), 'read as the outer constant').toEqual([[]])
    expect(problems).toEqual([expect.stringMatching(/^UNRESOLVED-URL: planted\.js:\d+$/)])
  })

  it('⭐ CONTROL — a same-file URL function in a `const url = heroOf(id)` IS read (the call initialiser is readable when it resolves)', () => {
    const planted = [
      "const url = '/api/j2/notes/search'",
      'const heroOf = (id) => `/api/j2/notes/${id}/hero`',
      'export async function f(id) {',
      '  const url = heroOf(id)',
      "  return fetch(url, { method: 'POST' })",
      '}',
    ].join('\n')
    expect(forwardedProblems({ 'planted.js': planted }, new Set(['POST /api/j2/notes/*/hero'])).problems)
      .toEqual(['UNSETTLED: planted.js:5 (f) — POST /api/j2/notes/*/hero'])
  })

  // ── E-1: a function forwarding its parameters to an INJECTED fetch is a helper, judged at its calls ──
  it('⭐ CONTROL — an injected-fetch forwarder is judged at its call sites: an unsettled door write is RED', () => {
    const planted = [
      'async function getJson(fetchImpl, url, init) { const res = await fetchImpl(url, { credentials: \'include\', ...init }); return res.json() }',
      'export const read = (fetchImpl) => getJson(fetchImpl, \'/api/j2/trades?limit=1\')',
      "async function check(fetchImpl) { return getJson(fetchImpl, '/api/j2/notes/import/check', { method: 'POST' }) }",
      'async function save(fetchImpl, id) { return getJson(fetchImpl, `/api/j2/notes/${id}`, { method: \'PUT\' }) }',
      'check(realFetch); save(realFetch, 1)',
    ].join('\n')
    const { problems, sites } = forwardedProblems({ 'planted.js': planted }, new Set(['PUT /api/j2/notes/*']))
    expect(sites.map((x) => x.keys[0])).toEqual(['GET /api/j2/trades', 'POST /api/j2/notes/import/check', 'PUT /api/j2/notes/*'])
    expect(problems).toEqual(['UNSETTLED: planted.js:4 (save) — PUT /api/j2/notes/*'])
  })

  it('⭐ CONTROL — `window.fetch` / `globalThis.fetch` are fetch: a computed URL through them is judged', () => {
    const planted = [
      "const heroUrl = (id) => `/api/j2/notes/${id}/hero`",
      "export async function a(id) { return window.fetch(heroUrl(id), { method: 'POST' }) }",
      "export async function b(id) { return globalThis.fetch(heroUrl(id), { method: 'POST' }) }",
    ].join('\n')
    expect(forwardedProblems({ 'planted.js': planted }, new Set(['POST /api/j2/notes/*/hero'])).problems).toEqual([
      'UNSETTLED: planted.js:2 (a) — POST /api/j2/notes/*/hero',
      'UNSETTLED: planted.js:3 (b) — POST /api/j2/notes/*/hero',
    ])
  })

  it('the real tree has NO helper exceptions: every injected or forwarded fetch resolves or is fixed', () => {
    const { problems } = forwardedProblems(noteTouchingSources(), doorKeys())
    expect(problems.filter((p) => p.startsWith('UNRESOLVED-HELPER'))).toEqual([])
  }, 60_000)

  // ── M-C: the window ends at the NEXT scanned site ──────────────────────────────────────────────
  it('⭐ CONTROL — two door calls in one function: a settle after the second does not cover the first', () => {
    const planted = [
      'export async function two(id) {',
      "  const a = await fetch(`/api/j2/notes/${id}/hero`, { method: 'POST' })",
      "  const b = await fetch(`/api/j2/notes/${id}/hero`, { method: 'DELETE' })",
      '  await settleNoteWrite(id, await b.json())',
      '}',
    ].join('\n')
    expect(forwardedProblems({ 'planted.js': planted },
      new Set(['POST /api/j2/notes/*/hero', 'DELETE /api/j2/notes/*/hero'])).problems)
      .toEqual(['UNSETTLED: planted.js:2 (two) — POST /api/j2/notes/*/hero'])
  })
})

/**
 * ⛔⛔ ⑥ THE LOSS / FORK / NONE CENSUS (wave 10, lane 10C — clause 2d, "no known
 * data-loss path").
 *
 * Every door rails ①–⑤ DERIVE is classified by the worst thing its landing can do
 * to a member's words that are unsent in ANOTHER tab or device at that moment:
 *   none  — the words survive untouched: the change is metadata (rebased) or a
 *           server-appended block (merged), or nobody can be holding the note;
 *   fork  — both versions survive: the member's words land in a "(conflicted copy)"
 *           sibling (fork-never-clobber). Correct for a genuine second writer;
 *   loss  — the words can vanish. ⛔ The census FAILS on any.
 * The rail fails on a derived door with NO classification, on a classification
 * that names a door no longer derived (stale), on any `loss`, and on an entry
 * whose evidence does not exist on disk.
 *
 * ⛔ WHAT THIS CENSUS DID TO THE TREE (the classifications are evidence, not labels):
 *   · F-5, the T-12 409 (tag door): NONE, measured — 12/12 sandbox burst runs, 15
 *     409s all settled, 0 forks, 0 lost words (docs/notebook/evidence/wave10-10c/).
 *   · A body nested past what the routes can serve (24 bullet levels) was STORED
 *     and then answered 500 forever — a LOSS on every body door. Closed at the one
 *     place they all pass (notes.MAX_BODY_DEPTH, tests/test_notes_body_depth_cap.py);
 *     notes stored deeper BEFORE that fix still 500 on read (the router's half,
 *     named in the wave-10 10C report) — a read defect, not a door.
 *   · A body ProseMirror cannot build (an empty text node) opened LOCKED — kept,
 *     not lost; now refused at the create doors (tests/test_notes_unbuildable_body_refused.py).
 *   · Fix round 1 (H14, live on master until 45a13b171): the compare-and-set and the
 *     append doors' read-modify-write were NOT atomic — the read ran in autocommit, so
 *     a second writer committing between the read and the write was told "saved" and
 *     then overwritten. A LOSS on the PUT, the versions restore and the three appends
 *     until every one of them took BEGIN IMMEDIATE before its read
 *     (tests/test_notes_cas_is_atomic.py). The rows below are NONE/FORK because the
 *     code now makes them so, not because the reconcile alone did.
 */
const NONE = 'none'
const FORK = 'fork'
const LOSS = 'loss'
const E = 'docs/notebook/evidence/wave10-10c/burst-probe-raw.json'

const DOOR_CLASSIFICATION = {
  // ── client door routes (derived by ① + ②) ────────────────────────────────────
  'PUT /api/j2/notes/*': {
    class: FORK,
    why: 'the editor\'s own body/title save and the outbox drain\'s send, both compare-and-set on '
      + 'baseUpdatedAt. When ANOTHER tab or device rewrote the body or title first, the 409 reconcile '
      + '(ownerReconcilePlan -> classifyServerChange) forks: the member\'s words become a conflicted copy. '
      + 'The compare-and-set runs inside BEGIN IMMEDIATE, so two writers holding one baseline cannot both land.',
    evidence: ['app/src/pages/journal-2-0/lib/offline/ownerReconcile.test.js',
      'app/src/pages/journal-2-0/lib/offline/offlineWordsSurvive.property.test.jsx', 'tests/test_notes_cas_is_atomic.py'],
  },
  'PATCH /api/j2/notes/*/tags': {
    class: NONE,
    why: 'metadata only (patch_note_tags -> update_note tags). F-5: its revision lands under the editor\'s '
      + 'open body save, which 409s once and is rebased by the reconcile (METADATA_ONLY), resending the '
      + 'member\'s current words -- 12/12 sandbox burst runs, 15 409s, all settled, 0 forks, 0 lost words.',
    evidence: [E, 'tests/test_typing_burst_rail.py',
      'app/src/pages/journal-2-0/components/notebook/NoteEditorPage.metadataSettle.test.jsx'],
  },
  'PATCH /api/j2/notes/*/lock': {
    class: NONE,
    why: 'metadata only (the locked flag) and it advances the revision; the server never refuses a body '
      + 'write to a locked note, so a queued edit rebases (METADATA_ONLY) instead of conflicting.',
    evidence: ['tests/test_journal_two_notes_lock_router.py'],
  },
  'POST /api/j2/notes/*/hero': {
    class: NONE,
    why: 'metadata only (hero_image_url). classifyServerChange compares title, subtitle and body; an '
      + 'unchanged body is METADATA_ONLY, so another tab\'s unsent words rebase onto the new revision.',
    evidence: ['app/src/pages/journal-2-0/lib/offline/serverChange.test.js'],
  },
  'DELETE /api/j2/notes/*/hero': {
    class: NONE,
    why: 'metadata only (hero_image_url cleared) -- the same METADATA_ONLY rebase as setting a hero; '
      + 'the body, title and subtitle are untouched so nothing an editor holds is contradicted.',
    evidence: ['app/src/pages/journal-2-0/lib/offline/serverChange.test.js'],
  },
  'POST /api/j2/notes/*/embeds': {
    class: NONE,
    why: 'appends ONE widgetEmbed at the end (append_widget_embed); widgetEmbed is a SERVER_APPENDED_TYPE, '
      + 'so the reconcile proves APPEND_ONLY and merges the block into the member\'s document (F-6 closed). '
      + 'Read and rewritten inside BEGIN IMMEDIATE, so an editor PUT cannot land between the two.',
    evidence: ['app/src/pages/journal-2-0/lib/offline/settleKeepsTheAppendBase.test.js',
      'docs/notebook/wave-q1-f5-append-merge-finding.md', 'tests/test_notes_cas_is_atomic.py'],
  },
  'POST /api/j2/notes/*/facts/*/insert': {
    class: NONE,
    why: 'appends ONE financialFact block (append_financial_fact); a SERVER_APPENDED_TYPE, merged by the '
      + 'reconcile\'s APPEND_ONLY branch exactly like a widget embed, never forked; read and rewritten '
      + 'inside BEGIN IMMEDIATE.',
    evidence: ['app/src/pages/journal-2-0/lib/offline/serverChange.test.js', 'tests/test_notes_cas_is_atomic.py'],
  },
  'POST /api/j2/notes/*/excerpts': {
    class: NONE,
    why: 'appends ONE documentExcerpt block (append_document_excerpt); a SERVER_APPENDED_TYPE, merged by '
      + 'the reconcile\'s APPEND_ONLY branch, never forked; read and rewritten inside BEGIN IMMEDIATE.',
    evidence: ['app/src/pages/journal-2-0/lib/offline/serverChange.test.js', 'tests/test_notes_cas_is_atomic.py'],
  },
  'POST /api/j2/notes/*/restore': {
    class: NONE,
    why: 'Trash -> library: clears deleted_at and moves the revision, body unchanged. A save against a '
      + 'trashed note 404s and the words stay queued; after the restore they rebase (METADATA_ONLY).',
    evidence: ['api/services/journal_two/test_notes_trash.py'],
  },
  'POST /api/j2/notes/*/versions/*/restore': {
    class: FORK,
    why: 'rewrites the body to an old version (restore_note_version -> update_note). Another tab holding '
      + 'unsent words 409s into a BODY_REWRITE and forks: both the restored text and the words survive. '
      + 'The restore holds BEGIN IMMEDIATE from its read to its commit.',
    evidence: ['tests/test_journal_two_notes_versions_router.py',
      'app/src/pages/journal-2-0/lib/offline/ownerReconcile.test.js', 'tests/test_notes_cas_is_atomic.py'],
  },
  'POST /api/j2/notes/import/confirm': {
    class: FORK,
    why: 're-importing an export UPDATES the matching notes\' bodies; this browser lands the revisions '
      + '(settleNoteWrites), and another tab holding unsent words in one of them forks on its next save.',
    evidence: ['tests/test_notes_import_router.py'],
  },
  'POST /api/j2/notes/batch': {
    class: NONE,
    why: 'every op is metadata (move, add/remove/rename tag, favourite, trash, restore, archive); none '
      + 'touches a title, subtitle or body, so a queued edit rebases (METADATA_ONLY), never forks.',
    evidence: ['tests/test_journal_two_notes_batch_router.py'],
  },
  'DELETE /api/j2/note-folders/*': {
    class: NONE,
    why: 'moves the folder\'s notes (folder_id only) and returns every moved revision, which the client '
      + 'lands (settleNoteWrites) -- metadata, rebased, never forked (see ④\'s control).',
    evidence: ['app/src/pages/journal-2-0/hooks/useJ2NoteFolders.js'],
  },
  // ── server-side doors with NO client (rail ⑤'s ledger + rail ②'s engine) ──────
  'api/routers/notebook_personal_api.py': {
    class: FORK,
    why: 'a Shortcut or script creates a note (nobody holds it) or appends paragraphs to one; paragraphs '
      + 'are not a SERVER_APPENDED_TYPE, so a tab holding unsent words forks (D-G1(b)/D-W2, R-13 keeps it).',
    evidence: ['tests/test_notebook_personal_api.py'],
  },
  'api/services/journal_two/note_personal_api.py': {
    class: FORK,
    why: 'append_nodes: update_note(expected_updated_at) under BEGIN IMMEDIATE, 423 on a locked note. An '
      + 'open dirty tab 409s into a BODY_REWRITE and forks -- a conflicted copy, never a clobber.',
    evidence: ['tests/test_notebook_personal_api.py'],
  },
  'api/services/journal_two/inbound_email.py': {
    class: FORK,
    why: 'creates a NEW note per email, then appends its attachment nodes to that same note seconds later; '
      + 'only a tab that opened the brand-new note in between could hold words, and that tab would fork.',
    evidence: ['tests/test_notebook_inbound_email.py'],
  },
  'api/services/journal_two/note_daily.py': {
    class: FORK,
    why: 'create-if-missing is a new note nobody holds; the personal API\'s append-to-daily appends '
      + 'paragraphs into a note a tab may hold dirty, which forks (the same D-G1(b) shape).',
    evidence: ['tests/test_journal_two_daily_note_router.py', 'tests/test_notebook_personal_api.py'],
  },
  'api/services/journal_two/ai_actions.py': {
    class: FORK,
    why: 'tags, properties and moves are metadata (rebased, never forked); a text/task block is appended through '
      + 'append_nodes, which is not a SERVER_APPENDED_TYPE, so ANOTHER tab holding unsent words forks -- a conflicted '
      + 'copy, never a clobber. Every write is a compare-and-set on the revision the member reviewed (conflict skipped), '
      + 'and this device holds back a body block on a note with unsent words before sending.',
    evidence: ['tests/test_notebook_ai_actions.py'],
  },
  'api/services/journal_two/sample_notebook.py': {
    class: NONE,
    why: 'seeds NEW notes nobody holds; removal trashes only the sample ids after the bulk pre-check refuses '
      + 'any holding unsent words (a later save to one reads 404 and the words stay queued).',
    evidence: ['tests/test_sample_notebook.py'],
  },
  'api/services/journal_two/sample_examples.py': {
    class: NONE,
    why: 'seeds NEW example notes nobody holds and writes only those fresh ids inside the same call; removal is '
      + 'the sample notebook\'s own pre-checked trash over the same recorded ids, so unsent words are never trashed.',
    evidence: ['tests/test_sample_notebook_examples.py', 'tests/test_sample_notebook.py'],
  },
  'api/services/journal_two/journal_styles.py': {
    class: FORK,
    why: 'create_styled_note makes a NEW note in one insert (nobody can hold it yet: none). '
      + 'apply_style_update inserts missing blocks AFTER THE FIRST HEADING (or, switching an empty note, the style\'s '
      + 'outline, which may carry an instruction paragraph): not a tail append of server-appended types, so '
      + 'appendedServerNodes (positional, tail only) cannot prove APPEND_ONLY and a tab holding unsent words 409s into '
      + 'a BODY_REWRITE and forks -- both survive. A kind-only switch leaves the body byte-identical (METADATA_ONLY, '
      + 'rebased); nothing to add writes nothing. A locked note is refused (423). One compare-and-set under BEGIN '
      + 'IMMEDIATE, always against the revision the call read (tests/test_journal_styles_update.py, the '
      + 'read-then-type race and the early-conflict rail).',
    evidence: ['tests/test_journal_styles_update.py', 'app/src/pages/journal-2-0/lib/offline/ownerReconcile.test.js',
      'tests/test_notes_cas_is_atomic.py', 'tests/test_journal_styles_create.py'],
  },
  'api/services/journal_two/note_kinds.py': {
    class: NONE,
    why: 'apply_mapping writes only the builtin:note_kind property (update_note properties patch): a title, subtitle '
      + 'and body are untouched, so another tab\'s unsent words rebase (METADATA_ONLY), never fork. A locked note is '
      + 'skipped, the client excludes notes holding unsent words, and each moved revision is returned to be landed.',
    evidence: ['tests/test_note_kinds.py'],
  },
  'api/services/journal_two/note_connectors/engine.py': {
    class: FORK,
    why: 'a GENUINE second writer (Roam/Notion/Craft sync in the background). A fork against it is the '
      + 'correct answer; two of its three writers preserve updated_at and are not doors at all (rail ②).',
    evidence: ['api/services/journal_two/test_note_connectors_engine.py'],
  },
}

/** Pure, so the controls below can plant each failure. */
function censusProblems(doors, classification) {
  const problems = []
  for (const d of doors) if (!classification[d]) problems.push(`UNCLASSIFIED: ${d}`)
  for (const [k, v] of Object.entries(classification)) {
    if (!doors.includes(k)) problems.push(`STALE: ${k} is classified but no longer derived as a door`)
    if (![NONE, FORK, LOSS].includes(v.class)) problems.push(`BAD CLASS: ${k} -> ${v.class}`)
    if (v.class === LOSS) problems.push(`LOSS: ${k} -- ${v.why}`)
  }
  return problems
}

const ENGINE = 'api/services/journal_two/note_connectors/engine.py'

describe('⛔⛔ ⑥ LOSS / FORK / NONE — every derived door is classified, and none loses words', () => {
  const doors = () => [
    ...advancingRoutes(reachingFunctions(sqlAdvancingFunctions())),
    ...Object.keys(SERVER_LEDGER),
    ENGINE,
  ]

  it('the door universe is DERIVED and non-empty (non-vacuity)', () => {
    const ds = doors()
    expect(ds, 'the derivation must see the editor\'s own door').toContain('PUT /api/j2/notes/*')
    expect(ds, 'and the F-5 tag door').toContain('PATCH /api/j2/notes/*/tags')
    expect(ds.length).toBeGreaterThan(15)
  })

  it('every door is classified, nothing stale, and NO door is a loss', () => {
    expect(censusProblems(doors(), DOOR_CLASSIFICATION)).toEqual([])
  })

  it('every classification cites evidence that exists, and says why', () => {
    for (const [k, v] of Object.entries(DOOR_CLASSIFICATION)) {
      expect(v.why.length, `${k} needs a reason, not a label`).toBeGreaterThan(60)
      expect(v.evidence.length, `${k} cites no evidence`).toBeGreaterThan(0)
      for (const ev of v.evidence) {
        expect(statSync(join(REPO, ...ev.split('/'))).isFile(), `${k}: evidence ${ev} is missing`).toBe(true)
      }
    }
  })

  it('⭐ CONTROL — the census reports an unclassified door, a stale entry and a loss', () => {
    const base = { 'PUT /x': { class: NONE, why: 'w', evidence: [] } }
    expect(censusProblems(['PUT /x', 'POST /new'], base)).toEqual(['UNCLASSIFIED: POST /new'])
    expect(censusProblems([], base)).toEqual(['STALE: PUT /x is classified but no longer derived as a door'])
    expect(censusProblems(['PUT /x'], { 'PUT /x': { class: LOSS, why: 'gone', evidence: [] } }))
      .toEqual(['LOSS: PUT /x -- gone'])
  })
})
