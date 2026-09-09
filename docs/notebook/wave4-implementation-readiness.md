# Wave 4 (Search Evolution I) — Implementation-Readiness Design

**Status: PREP ONLY. No member-facing Wave 4 feature has shipped or will ship
from this document.** This is the deep-design continuation of
`wave4-search-evolution-i-prep.md` (2026-09-06 checkpoint: "finish Wave 4
prep to implementation-ready state, do not ship"). Read that file first for
the initial verification pass (FTS5 schema, query safety, snippet/highlight
functionality, entity-layer surfaces) — this file goes deeper: correctness
proof, production-scale benchmarking, full UX/contract design, the test
matrix, and the migration/rollback plan. Implementation begins only when the
Early Signal Gate opens or the owner explicitly waives it.

---

## 1. Query correctness — proven, not assumed

`tools/wave4_search_correctness_matrix.py` (sandbox, hand-built corpus with
known expected results) + 6 new permanent regression tests added to
`api/services/journal_two/test_notes_fts.py`. Every hand-verifiable case is
correct: sparse ticker (NVDA), hyphenated ticker (BRK-B → `"BRK" "B"*`, two
AND'd tokens), multi-term AND (`semiconductor capex`), tag-only matches
(isolates the tag OR-branch from the FTS branch), zero-result queries,
tenant isolation (a search never returns another user's note), trash
exclusion (a search never returns a soft-deleted note).

**Two real findings from this pass, both genuine and unhypothetical:**

1. **A confirmed pre-existing gap, independent of Wave 4:** `$NVDA` does
   NOT find a note whose only NVDA signal is the `ticker` field (with no
   text mention anywhere) — only plain `NVDA` (no `$`) does. Root cause,
   verified against `notes.py::_notes_filter_sql` line 806: `exact_ticker =
   q.strip().upper()` — `fts_match_expr()` strips the `$` for the FTS
   branch, but the ticker-exact-match branch uses the raw query text with
   only whitespace stripped, so `ticker = '$NVDA'` never equals a stored
   ticker of `'NVDA'`. Narrow impact (only affects notes with zero text
   mention of the ticker), not fixed here per this checkpoint's "no
   production Search Evolution I changes" boundary — candidate one-line fix
   (strip leading `$`/separator chars before the ticker comparison) belongs
   in Wave 4's combined-filter work (§8 below), flagged for the owner to
   decide whether it's worth a pre-Wave-4 hotfix given how narrow it is.
2. **Porter stemmer folds "marginalized"/"marginal" onto a `margin` query**
   — confirmed by running it, not guessed. A member searching "margin" will
   see notes using "marginal(ized)" in an unrelated sense as literal
   FTS5-correct matches. This is exactly why §5 (snippet design) makes the
   snippet itself the explanation — a member seeing the actual matched
   context understands a stem-based match immediately; a bare title list
   would not explain it.

**Ordering, confirmed:** search results order by `updated_at DESC`
unconditionally — same as every other note list. No relevance ranking
exists today (see §9).

---

## 2. FTS5 benchmark — deepened, realistic categories

Extended `tools/wave4_fts_benchmark.py`'s query set (now 10 queries) across
the categories checkpoint item 6 named:

- **A. Sparse ticker / cashtag / hyphenated:** `NVDA`, `$NVDA`, `BRK-B` — all
  sub-millisecond through 10k notes, ~90-190ms at 50k (see caveat below).
- **B. Common financial terms:** `earnings`, `revenue`, `guidance` — added
  `revenue`/`guidance` this pass.
- **C. Multi-term research queries:** `semiconductor capex`, `AI datacenter
  demand`, `risk to gross margin`, `thesis invalidation`.
- **D. Worst-case highly-common vocabulary:** the synthetic vocabulary's
  single densest term (`guidance`, hitting 79% of all notes at 50k scale)
  serves as the worst-case posting-list stand-in — p95 **166ms at 50k
  global notes**. This is the honest ceiling this benchmark can produce.
- **E. Phrase matching:** **not supported today, confirmed by design, not a
  gap to fix.** `fts_match_expr()` strips quote characters as separators
  (same treatment as every other non-word character) specifically so
  unbalanced user-typed quotes can never reach FTS5's MATCH grammar and
  raise. Building real phrase support would mean detecting a *balanced*
  quoted substring before the separator-stripping pass — a real, distinct
  design change, explicitly out of Wave 4 scope (no evidence of member need
  yet; note as a candidate future slice only if Stage A/full-validation
  feedback asks for it).
- **F/G. Date-filter and entity-filter combinations:** **not executable** —
  those filters don't exist in code until Slices 1 and 3 ship (see §7 for
  the executable-once-built contract).

**The critical caveat, restated because it matters for §12 (performance
gate):** this synthetic ~100-word vocabulary is far denser than any real
member's note library. A common single term hitting 60-79% of ALL notes is
a worst-case artifact of a small closed vocabulary repeated across every
synthetic note — a real member's actual notes will use "revenue" or
"guidance" in a small, varied fraction of their library, not 4-in-5 notes.
**The 4-term rare-AND query (`risk to gross margin`, `AI datacenter
demand`) — 0 results, sub-2ms even at 50k — is the realistic proxy for how
members actually search**, not the single dense term.

---

## 3. Date-range semantics — finalized contract

(Full detail already in `wave4-search-evolution-i-prep.md` §3, updated this
checkpoint.) Summary of the finalized Stage-1 contract:

- **Default field: `created_at`**, explicitly labeled **"Note created"** in
  the UI (never a bare "Date") — a provisional-but-honest contract. The
  architecture must not preclude adding "Updated" or a future "Source date"
  (for imported notes — see §14) as an additional picker option later
  without a search-path rewrite: `dateFrom`/`dateTo` compose as a plain AND
  onto `_notes_filter_sql`'s existing predicate chain regardless of which
  column they target, so adding a second temporal dimension later is a
  parameter addition, not an architecture change.
- **Smallest useful Stage 1 experience: `created_at` only.** Do not ship a
  field selector in Slice 1 — no evidence yet that members want more than
  one date dimension.

---

## 4. Index validation — implementation-readiness complete

`tools/wave4_date_range_index_benchmark.py`, run at 1k/10k/50k global rows
with `EXPLAIN QUERY PLAN` before/after, plus write-overhead and size
measurement added this checkpoint:

| Scale | Query plan WITHOUT | Query plan WITH | Read speedup | INSERT delta | Est. index size |
|---|---|---|---|---|---|
| 1k | `idx_j2_notes_user_deleted` + temp B-tree sort | `idx_j2_notes_user_created`, no sort | 1.6x | +0.002ms (noise) | ~19KB |
| 10k | same pattern | same pattern | 2.0x | -0.003ms (noise) | ~234KB |
| 50k | same pattern | same pattern | 1.6x | +0.002ms (noise) | ~1.2MB |

**Write overhead is indistinguishable from measurement noise at every
scale tested** (±0.003ms on a ~0.03-0.04ms baseline single-row INSERT).
**Estimated index size stays under 1.2MB even at 50k platform-wide notes**
— trivial against the existing `auth.db` (143MB at 25 users). **Migration
safety:** identical shape to Wave 0's own `deleted_at`/`idx_j2_notes_user_deleted`
migration, already proven safe in production — `CREATE INDEX IF NOT EXISTS`
is idempotent (safe on retry/partial-apply), purely additive (no column
change, no data rewrite), and at today's real production scale (89 notes)
the operation is sub-millisecond with no lock-duration risk. **Rollback:**
`DROP INDEX IF EXISTS idx_j2_notes_user_created` — reversible with zero
data loss, since the index carries no data the table doesn't already have.

**Verdict: justified, but not yet built** (per this checkpoint's "no
production index change yet" instruction) — the real justification remains
structural (removes an O(n log n) sort that scales with one member's TOTAL
note count, protecting import-heavy members with thousands of notes on day
one), not the measured number, which is negligible at every scale actually
tested.

---

## 5. snippet()/highlight() — production design

**Goal: the member should immediately understand why a result matched.**

- **Snippet length:** `snippet(j2_notes_fts, 3, '<mark>', '</mark>', '…',
  12)` — 12 tokens of context (the same call already verified functional in
  the initial prep pass). 12 tokens is enough to show the sentence
  fragment around a match without truncating so tightly that a stemmed
  match (§1 finding 2) reads as nonsensical.
- **Context around match:** SQLite's `snippet()` auto-centers the returned
  fragment on the best matching region — no manual windowing logic needed.
- **Ellipsis behavior:** the 5th `snippet()` arg (`'…'`) is the boundary
  marker SQLite inserts when the fragment doesn't start/end at the note's
  true start/end — use the real ellipsis character, not `...` (three
  periods reads worse at small sizes and doesn't match this codebase's
  typography elsewhere).
- **Highlighting:** wrap matches in `<mark>...</mark>` — a real HTML tag
  the frontend can style directly (existing CSS token, no new component).
  **`highlight()` only marks matches within the SPECIFIC column requested**
  (already verified in the initial pass) — title (col 2) and body (col 3)
  must be requested and rendered separately; a title-only match must fall
  back to the naive body prefix (current behavior), never render an
  unhighlighted, unexplained body snippet.
- **Escaping / XSS safety:** `snippet()`/`highlight()` return the note's
  OWN text content with `<mark>` tags inserted — the underlying text is
  member-authored plain text (`body_plain`), not raw HTML, so **the
  snippet output itself must still be HTML-escaped before insertion**,
  with the `<mark>` boundary markers applied on top of the escaped text
  (or, more simply on the frontend: render the whole snippet as text, then
  replace the literal `<mark>`/`</mark>` delimiters with real DOM
  elements — never `dangerouslySetInnerHTML` the raw snippet output,
  because `body_plain` could itself legitimately contain literal `<`/`>`
  characters typed by the member that must never be interpreted as HTML).
- **Multiple matches:** `snippet()` returns ONE fragment (SQLite's default
  best-match window) — Stage 1 shows one snippet per result row, not every
  match occurrence. No evidence yet that members need a multi-match view;
  revisit only if search-behavior telemetry or feedback asks for it.
- **Unicode:** the FTS table already uses `unicode61` tokenization
  (verified in the initial prep pass, e.g. `café` matches correctly) — no
  additional handling needed.
- **Cashtags / hyphenated tickers:** snippets render the ORIGINAL text
  (`$NVDA`, `BRK-B` as the member typed them) — `snippet()` operates on the
  stored `body_plain`/`title` text, not the tokenized/stripped query
  expression, so the member's own formatting is always preserved in the
  displayed result regardless of how the query was normalized to match it.
- **Empty-body notes:** a note with `body_plain = ''` can still match via
  title, tag, or ticker (the OR-branches in §8). `snippet()` on an empty
  body column returns an empty string — the result-card UX (§6) must fall
  back to the "why matched" label (tag/ticker) rather than render a blank
  snippet area.
- **Very large notes:** `snippet()`'s cost is bounded by the token window
  requested (12), not the note's total length — confirmed in both
  benchmarks (median 0.26-1.6ms across every scale tested, not correlated
  with note size). No special-casing needed for large imported notes.

---

## 6. Search result UX — design

Smallest high-value card, per the "scan → understand match → open result"
goal:

```
┌────────────────────────────────────────────────────┐
│ [icon] NVDA thesis                    Created Mar 3 │
│ "...semiconductor <mark>capex</mark> accelerating..."│
│ NVDA · Thesis                                        │
└────────────────────────────────────────────────────┘
```

Fields: **title** (bold, primary), **match snippet with highlight** (the
"why matched" explanation — see §5), **created date** (secondary, small),
**ticker/entity context** (only when the note has one — never an empty
chip), **folder/tag context** (only the most relevant one or two, never a
full list). For a tag- or ticker-only match (no FTS hit), replace the
snippet line with the distinct explanation label already designed in the
original prep doc (`matched tag: X` / `matched ticker: X`) — never a blank
or misleading body excerpt. No preview images, no full-body excerpt, no
action buttons on the card itself — the whole card is one click target that
opens the note.

---

## 7. Entity-anchored retrieval — design (confirmed against Wave 1 reality)

Already sketched in the original prep doc §5; the pattern holds after this
pass's deeper read of `_notes_filter_sql`:

- **Ticker filter:** already shipped (`embed_symbol` param) — ORs
  `j2_note_embeds` (accepted chart embeds) and `j2_note_mentions` (cashtag
  prose mentions), exactly the shape `get_symbol_backlinks` already uses.
- **Sector/theme filter (new for Wave 4):** RESOLVE the member's small,
  bounded set of distinct mentioned symbols (via the existing 24h
  `ticker_meta` cache — zero schema change) → filter that symbol set to
  ones matching the requested sector/theme → narrow the note-id set to
  notes mentioning ANY of those symbols (same UNION shape as the ticker
  filter, generalized from one symbol to a small set). **Never a full
  corpus scan** — the entity resolution happens over the member's own
  bounded mention vocabulary, not every symbol in the market.
- **Earnings-window: confirmed still deferred**, exactly as Wave 1's
  decision log recorded — not built as a Wave 4 side-quest.

---

## 8. Combined search contract

How filters compose, and the exact edge-case behavior:

- **Semantics: everything is AND.** `folder_id`/`tag`/`ticker`/`q`/
  `embed_symbol`/`embed_widget` (and the new `dateFrom`/`dateTo`/
  `sector`/`theme`) all append to ONE WHERE clause with `AND` — a member
  never needs to understand FTS syntax or boolean operators; every filter
  they set narrows the result set further. There is no OR between
  different filter TYPES (only within `q` itself, between the FTS/tag/
  ticker sub-branches — an implementation detail, invisible to the member).
- **`NVDA`** → ticker-exact OR FTS-text OR tag match, all within `q`.
- **`NVDA` + `March`** (date range) → the above, AND `created_at` between
  the resolved March bounds.
- **`Technology` + `March`** (sector + date, no keyword) → resolved-symbol-set
  membership, AND the date bound — no `q` needed at all; date-range and
  entity filters both work standalone.
- **Empty query, filters only** (e.g., just a date range) → already
  supported today (`q` is optional in `_notes_filter_sql`) — returns every
  note matching the non-`q` filters, ordered by `updated_at DESC` (or
  `created_at DESC` if that becomes the list's own sort — independent of
  the date FILTER, which only bounds the range).
- **Empty result** → the existing zero-state pattern extends unchanged (no
  new "no matches" copy needed — Wave 4 adds filters, not a new empty
  state).
- **Invalid filters** (e.g., a malformed date, an unknown sector) → never
  a 500. A malformed `dateFrom`/`dateTo` should be validated at the router
  layer (reject with a 400 + clear message, matching this codebase's
  existing validation convention elsewhere) rather than silently
  producing an empty or wrong result set. An unrecognized sector/theme
  name resolves to an empty symbol set → an honestly empty result, not an
  error (mirrors `CoverageLine`'s "a gap in what we hold, not a quiet
  market" discipline from elsewhere in this codebase — though for search
  specifically, an unrecognized filter value is a client input problem,
  not a data-coverage gap, so it should be a 400 if it's a typo the
  frontend can validate against a known list, or an honest empty result if
  it's a legitimate-but-unmatched value).
- **Removed/deleted entities:** a ticker that no longer resolves via
  `ticker_meta` (delisted, renamed) still filters correctly on the
  `j2_note_embeds`/`j2_note_mentions` symbol string itself — sector/theme
  resolution degrades gracefully (that symbol simply doesn't join to a
  sector), never an error.
- **Trash exclusion:** proven in §1 — `deleted_at IS NULL` is unconditional
  on the normal (non-Trash-view) path, and every new Wave 4 filter
  composes onto the SAME predicate via AND, so trash exclusion is
  structurally preserved by construction, not something each new filter
  needs to re-implement.

---

## 9. Ranking verdict

**Current ranking: none.** Confirmed by reading `notes.py::list_notes` —
results order by `updated_at DESC` (or whatever `sort` param the caller
passes) unconditionally, even when `q` is present. There is no `bm25()`
call, no relevance score, anywhere in the search path today.

**Proposed Wave 4 ranking: adopt FTS5's built-in `bm25()` auxiliary
function for `q`-driven results, keep `updated_at DESC` as the ranking
for filter-only (no `q`) queries.** Why: `bm25()` is a single additional
column in the `SELECT`/`ORDER BY` (`ORDER BY bm25(j2_notes_fts) ASC` — no
new dependency, no new index, already available on this FTS5 table without
schema change), and directly addresses the real, observed problem: today, a
weak/old match can outrank a strong/recent one purely because it was
touched more recently. **Do not build a custom ranking model** — no
evidence exists yet that `bm25()` alone is insufficient, and this
codebase's own discipline throughout the program (UCT20, breadth,
theme-membership) is "don't build a scoring system without evidence it's
needed." A reasonable boost worth testing empirically once real usage
exists: a small title-match weight (BM25 already implicitly favors rarer
terms, but an explicit title-hit boost is cheap and intuitive — "the
member's note IS about this" more often when the term is in the title).
Do not add a recency boost on top of BM25 without evidence — recency is
already available as a separate, explicit sort option (`sort=updated`) a
member can choose, and blending the two silently would make results harder
to reason about, not easier.

---

## 10. Search success metric — verdict

**Current telemetry (`hasResults` boolean + repeat usage + qualitative
feedback) is sufficient for the Stage A gate as designed.** The Early
Signal Gate's search criterion (`searchUsedEnoughToBeEvidenceBacked`)
answers "is search used enough to justify investment," not "is search
GOOD" — the latter question needs Wave 4 itself to exist before it can be
answered meaningfully (there's no baseline to compare a click-through rate
against pre-Wave-4). **Result-click / subsequent-note-open instrumentation
is NOT added now** — it would be needed to evaluate Wave 4 ITSELF
post-ship (does the improved search actually get results opened more
often), not to decide whether to build it. If pursued later: privacy-safe
by construction already (an event carrying only `{"resultOpened": true,
"positionInResults": N}` — never query text, never note content) — designed
here so it's ready to add in one line when it's actually justified, not
built speculatively now.

---

## 11. Vertical-slice plan — refined

1. **Slice 1 (Stage 0, lowest risk):** `idx_j2_notes_user_created` +
   `dateFrom`/`dateTo` params on `list_notes`/`count_notes` + router
   validation (400 on malformed dates) + frontend date pickers in
   `FolderSidebar.jsx`'s search mode, labeled "Note created." Independently
   shippable.
2. **Slice 2 (Stage 0):** wire `snippet()`/`highlight()` into the
   search-results row per §5/§6, replacing the naive `slice(0,120)`; add
   the tag/ticker-match explanation label; add `bm25()` ranking for
   `q`-driven results per §9.
3. **Slice 3 (Stage 1, needs Wave 1's entity layer — already verified
   complete):** sector/theme filter per §7, composed with the existing
   `embed_symbol` filter and Slice 1's date filter.
4. **Slice 4 (opportunistic, small):** the `$NVDA`-vs-ticker-field fix
   from §1 finding 1 — a one-line correctness fix to the exact-ticker
   comparison, naturally belongs with the combined-filter work touching
   this same predicate.
5. Each slice: unit tests (query-building + index usage, per the test
   matrix in §12) → integration (HTTP layer, real note fixtures) →
   real-browser E2E in the fail-closed sandbox → re-run both benchmarks
   against whatever corpus exists at that point → deploy → production
   verify — matching this program's established per-wave discipline.

---

## 12. Test matrix (pre-written, not yet run against unbuilt features)

Fixture-level cases to cover once Slices 1-3 exist (some are already
covered TODAY against the pre-Wave-4 baseline — marked ✅ — proving the
foundation Wave 4 builds on; the rest become executable as each slice
ships):

| Case | Status |
|---|---|
| Keyword only | ✅ covered (`test_notes_fts.py`, this checkpoint) |
| Ticker only | ✅ covered |
| Date only | pending Slice 1 |
| Keyword + date | pending Slice 1 |
| Ticker + date | pending Slice 1 |
| Sector filter | pending Slice 3 |
| Theme filter | pending Slice 3 |
| No results | ✅ covered |
| Many results (density/pagination) | ✅ covered at benchmark scale |
| Deleted/trashed note excluded | ✅ covered, this checkpoint |
| Cross-user isolation | ✅ covered, this checkpoint |
| Hyphenated ticker (BRK-B) | ✅ covered, this checkpoint |
| Cashtag ($NVDA) | ✅ covered, this checkpoint (surfaced the §1 finding) |
| Malformed query (operators, parens, quotes) | ✅ covered, this checkpoint |
| Unicode | ✅ covered (pre-existing `café` case) |
| Large corpus (50k) | ✅ covered (benchmark) |
| Pagination | existing `limit`/`offset` params, unaffected by Wave 4 |
| Ranking (bm25 vs recency) | pending Slice 2 |
| Snippet correctness (highlight boundaries, escaping) | pending Slice 2 |
| Highlight correctness (title vs body column) | pending Slice 2 |

---

## 13. Multi-tenant + trash contract

Proven in §1/§12 — a search can never return another member's note or
another member's entity-derived research, and a normal search can never
surface a trashed note. Both hold structurally (the `user_id`/`deleted_at`
predicates are the FIRST clauses in `_notes_filter_sql`, and every new
Wave 4 filter composes via AND onto the same clause) — not something each
new filter needs to re-derive.

---

## 14. Imported notes (Notion/Evernote/Obsidian/etc.)

Search compatibility only — not reopening migration engineering.

- `created_at` for an imported note is set at IMPORT time (when the
  migration ran), not the note's original authored date — meaning
  "notes from March" for an imported note answers "imported in March,"
  which may surprise a member expecting their original authoring date.
  `imported_at` exists as a separate nullable column and could become a
  third date-filter dimension later (§3 already designs the architecture
  to support this without a rewrite) — not built in Slice 1, no evidence
  of need yet.
- Entity mentions (cashtags, ticker embeds) work identically for imported
  notes — Wave 1's entity layer operates on `body_plain`, populated by the
  importer the same way as a natively authored note.
- Large imported bodies: already covered by §5's finding that `snippet()`
  cost is bounded by the token window requested, not note length.
- Format-converted text: `body_plain` is the plain-text projection the
  importer already produces from source markdown/HTML — FTS indexes this
  same column, so search sees exactly what a native note's search sees, no
  separate handling needed.

---

## 15. Performance exit gate

Using the real benchmark data from §2 (not an invented number):

- **Acceptable p50: sub-15ms** for any realistic multi-term research
  query (the `risk to gross margin`/`AI datacenter demand` shape) through
  50k global notes — already met today (both are sub-2ms at 50k).
- **Acceptable p95: sub-200ms** for even the synthetic worst-case dense
  single-term query at 50k — already met today (166ms worst observed).
  Real member vocabulary will sit far below the synthetic worst case (§2
  caveat), so this ceiling has real headroom, not a razor's edge.
- **Largest tested corpus: 50k global notes** (~560x today's real
  production scale of 89 notes) — re-benchmark at a larger scale only if
  production's real note count approaches this order of magnitude; not
  worth manufacturing a bigger synthetic number now.
- **Query classes covered:** sparse ticker, common single-term, multi-term
  AND, cashtag, hyphenated ticker, zero-result.
- Per this checkpoint's own instruction: *"if a common-term query at 50k
  notes is ~49ms today, preserve perspective — that is already fast enough
  that correctness/UX may matter more than micro-optimization."* This
  pass's worst observed number (166ms, `guidance`) is higher than that
  49ms reference but still well under any human-perceptible-lag threshold
  (200-300ms is the usual "feels instant" bar), and — critically — it's a
  synthetic worst case unlikely to occur with real member vocabulary.
  **Correctness (§1) and UX (§5/§6) are the higher-value investment than
  further speed optimization at this stage.**

---

## 16. Rollback plan

- **New index (`idx_j2_notes_user_created`):** `DROP INDEX IF EXISTS` —
  reversible, zero data loss (§4).
- **Backend filter behavior (date-range/entity params):** additive query
  params with safe defaults (absent = no filtering) — a rollback is a
  redeploy of the prior build; old requests without the new params are
  unaffected either way.
- **Frontend controls (date pickers, sector/theme filter UI):** purely
  additive UI in `FolderSidebar.jsx`'s existing search mode — a rollback
  redeploy removes the controls; no persisted state depends on them
  (filters are query-time, not stored per note or per user).
- **Snippet/highlight rendering:** falls back to the current naive
  `slice(0,120)` behavior on rollback — no data migration either
  direction, purely a rendering-code change.
- **No irreversible data transformation is required for any Wave 4
  slice** — every change is additive (new index, new optional params, new
  optional UI), matching this program's discipline throughout Waves 0-3.

---

## 17. Production migration plan (for `idx_j2_notes_user_created`, when authorized)

Not executed — this is the plan for when Wave 4 implementation is
authorized, mirroring Wave 0's own proven migration pattern:

1. Preflight: confirm current production note count (read-only), confirm
   `idx_j2_notes_user_created` does not already exist, confirm a recent
   `authdb_backup.py` snapshot exists (the existing 6h/nightly cadence
   already covers this — no special pre-migration backup needed given the
   operation's negligible risk profile per §4, but the established
   discipline is to trigger one fresh snapshot immediately before any
   schema change regardless, matching Wave 0's Slice 7 preflight).
2. Migration: `CREATE INDEX IF NOT EXISTS idx_j2_notes_user_created ON
   j2_notes(user_id, created_at)` — idempotent, safe on retry.
3. Expected row count: whatever production's real `j2_notes` count is at
   deploy time (89 as of the last read, almost certainly still in the low
   hundreds) — sub-millisecond operation at this scale per §4's benchmark.
4. SQLite locking: a `CREATE INDEX` takes a brief exclusive lock for the
   duration of the build — at production's real scale (hundreds of rows,
   not tens of thousands), this is sub-millisecond and will not contend
   with `busy_timeout` in any observable way.
5. Deploy verification: same pattern as every prior wave —
   `/api/health` uptime reset confirms a fresh process, then a read-only
   `PRAGMA index_list('j2_notes')` check confirms the index exists.
6. Rollback: `DROP INDEX IF EXISTS idx_j2_notes_user_created` (§16).

---

## 18. No semantic search — confirmed boundary

Not started, not designed beyond what's already on record: embeddings,
vectors, semantic retrieval, reranking models, Ask Notebook corpus
indexing all remain evidence-gated, later work. Wave 4 is lexical (FTS5) +
entity (Wave 1's existing layer) + date only, exactly as scoped.

---

## 19. Spec corrections / new findings summary

1. `$NVDA` doesn't match a ticker-field-only note (§1 finding 1) — real,
   narrow, pre-existing, not fixed here.
2. Porter stemming folds "marginal(ized)" onto "margin" (§1 finding 2) —
   real, informs the snippet-as-explanation design (§5/§6), not a bug.
3. No relevance ranking exists today (§9) — not previously stated
   explicitly in the original prep doc; now recorded with a proposed
   `bm25()` fix.

No corrections needed to Wave 1's entity-layer scope or the FTS5
architecture claims from the original prep doc — both held up under this
deeper pass.
