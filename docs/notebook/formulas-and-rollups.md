# Formula and rollup properties (wave 11, lane 11B)

Dark behind `NOTEBOOK_FORMULAS_ENABLED` (unset = OFF). The ledger entry in
`docs/feature_flags.json` carries the arm and rollback commands.

- **Formula**: computed from the same note's number properties (and other
  formulas) through the expression language in
  `api/services/journal_two/formula_engine.py`, mirrored in
  `app/src/pages/journal-2-0/lib/formula/formulaEngine.js`. Both are held to one
  vector file (`lib/formula/formulaVectors.json`). Neither ever calls `eval`,
  `exec`, `Function` or `compile` on member text; a scan rail in each language
  fails if one appears.
- **Rollup**: count, sum, average, min, max or win rate of one property across a
  set: the notes linking to this note, the notes this note links to, the notes a
  saved view matches, or the trades linked to this note.
- A formula that would refer back to itself, directly or through other formulas,
  is refused when it is saved, with the names in the cycle.

## A read never writes

Controller ruling, 2026-10-01. `GET /api/j2/notes` and
`GET /api/j2/notes/{id}/properties` compute every value in memory from its
current inputs and write nothing. There is no value cache, so a value can never
be out of date and a list read never waits on the SQLite writer.
`tests/test_notebook_computed_reads_never_write.py` reads `PRAGMA data_version`
from a second connection around the first read of each GET, and fails if it
moved; a control proves a PUT does move it.

How a read stays bounded:

- **One note's properties**: the note's own values plus one windowed query per
  rollup source.
- **A page of the list**: values for that page's notes only.
- **A sort or filter by a computed property** (`note_computed.values_for_all`):
  a formula reads every live note's properties through the partial covering
  index `idx_j2_notes_props_live`, which holds only live notes that have
  properties. The expression is compiled once into closures
  (`formula_engine.compile_ast`, held to the same vectors as the tree walk). A
  rollup runs one windowed query per source. Results are memoised for the
  request, so the page and its total share one evaluation.
- **A filter** becomes a rowid-set clause on the list's own WHERE
  (`note_computed.filter_clauses`). The page's ORDER BY and LIMIT, and the total,
  stay single SQL statements over the same set, so they cannot disagree.
- **A sort** (`note_computed.sorted_page`) orders only the notes that have a
  value. Notes without one follow in the base order, read with LIMIT and OFFSET
  in SQL. Empty values sort last in both directions.

## Rollup rules (accepted by the controller, 2026-10-01)

1. Win rate counts only the rows that have a value. An empty row is not a loss.
2. A saved-view rollup uses the view's property filter, applied as the server
   applies it to the view. A formula condition in that view is applied too; a
   rollup condition is not.
3. The trades source counts closed trades and option strategies linked to the
   note. An open position that has not closed into a trade is not counted.
4. A rollup cannot summarise another rollup.
5. A set is capped at 1,000 rows, most recently updated first. Past that the
   value covers the first 1,000 and says "first 1,000 of N".
6. Tenant isolation: every set query joins its member rows on `user_id`. A link
   target or a trade reference is client-supplied text, so a reference to another
   member's note or trade can exist in the data. It never counts.
   `tests/test_notebook_rollups.py` plants exactly that.

## Offline

The offline working copy (IndexedDB, `lib/offline/`) stores note records with
the editor's fields only, and the list's SWR cache is in memory. No computed
value is persisted on the device. `lib/formula/offlineNeverStoresComputed.test.js`
fails if a record literal in `lib/offline/` gains `computed` or `propertiesJson`,
or if the app's SWR configuration gains a persistent `provider`.
