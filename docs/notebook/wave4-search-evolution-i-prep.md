# Wave 4 (Search Evolution I) — Preparation Dossier

**Status: PREP ONLY. No member-facing Wave 4 feature has shipped.** This document
is Track B of the 2026-09-06 "Stage A→B gate NOT waived" decision
(`primary-platform-decision-log.md`) — verification, benchmarking, and design
work that does not assume the gate has passed. Member-facing implementation
(date-range production UI, snippet/highlight production UI, entity-anchored
search production changes) begins only when the Early Signal Gate is met or
the owner explicitly waives the Stage A gate — see the decision log entry and
the live `GET /api/j2/notebook-validation-report` (admin) for current status.

Wave 4's authoritative scope (`primary-platform-implementation-plan.md` §3,
"Wave 4 — Search Evolution I [Stage B]"): FTS5 read-latency benchmark at
platform-wide scale (architecture §7 Stage 0); date-range filter;
`snippet()`/`highlight()` wired; entity-anchored retrieval (Stage 1), riding
Wave 1's entity layer. Non-goal: semantic/vector search (evidence-gated,
deferred).

---

## 1. Current reality, directly verified (not assumed from the plan)

### 1.1 FTS5 schema

`j2_notes_fts` (`api/services/journal_two/db.py`) is a standalone
(non-external-content) FTS5 table: `note_id UNINDEXED, user_id UNINDEXED,
title, body_plain`, `tokenize = 'porter unicode61'`. One GLOBAL table shared
by every user's notes — `MATCH` narrows via the inverted index first, the
`user_id` predicate filters after. Confirms the architecture doc's own
warning: **read latency for one member's query is a function of
platform-wide notes matching that term, not that member's own library
size.** A separate ordinary table, `j2_notes_fts_map(note_id, fts_rowid)`,
lets the AU/AD triggers delete by an indexed `rowid` lookup instead of an
unindexed `note_id` scan — this was ALREADY fixed as a write-path perf issue
(`run_notebook_migration_v5`, measured 7.9x–32x tax at 5k/20k notes before
the fix). That fix is orthogonal to Wave 4: it's the WRITE path (insert/
update/delete); Wave 4's Stage 0 benchmark is the READ path (`MATCH`
queries), a different, still-open question — see §2.

### 1.2 Query safety — ALREADY SOLVED, verified directly

`api/services/journal_two/notes_search.py::fts_match_expr()` is the sole
authority translating raw member search text into an FTS5 `MATCH`
expression: every term is quoted (neutralizes FTS5 operators like `OR`/
`NEAR`/`NOT` and prevents unbalanced-quote syntax errors), the last term gets
a `*` prefix-match suffix, and it never raises — `notes.py::list_notes`
falls back to a plain `LIKE` scan when it returns `None`. Confirmed by direct
testing this session:

```
'BRK-B'  -> '"BRK" "B"*'        (hyphen splits into two AND'd terms — no crash)
'$NVDA'  -> '"NVDA"*'           ($ stripped as a separator — matches plain "NVDA")
'café'   -> matches correctly (unicode61 tokenizer)
'(unterminated' -> a RAW MATCH query raises; fts_match_expr's OWN quoting
                   prevents this from ever reaching FTS5 unescaped
```

This means Wave 4's "escaping/sanitization requirements" item is **already
closed** — no new work needed here. Existing coverage: `test_notes_fts.py`
(`test_fts_match_expr_quotes_terms_and_prefixes_the_last`,
`test_fts_match_expr_neutralises_fts_operators`, +11 more).

### 1.3 `snippet()`/`highlight()` — confirmed unused, confirmed functional

Grepped `api/` for `snippet(`/`highlight(` — zero hits in `journal_two/`
(the only hits are unrelated FTS5 users: `education_search.py`,
`community_store.py`, `desk_store.py` — different tables entirely). The
architecture doc's "unused anywhere" claim is accurate.

Directly tested both functions against the real 4-column schema
(`note_id=0, user_id=1, title=2, body_plain=3`):

```python
snippet(j2_notes_fts, 3, '[', ']', '...', 10)   # -> "...semiconductor [capex] is..."
highlight(j2_notes_fts, 3, '<b>', '</b>')        # -> "<b>thesis</b> invalidation"
```

Both work correctly with no schema change. `highlight()` only marks matches
within the SPECIFIC column index requested — a match in `title` (column 2)
does not highlight anything when you ask it to highlight column 3
(`body_plain`); the caller must request both columns separately or accept a
whole-row highlight strategy.

**Current frontend gap, confirmed:** `FolderSidebar.jsx`'s search-results
panel (`app/src/pages/journal-2-0/components/notebook/FolderSidebar.jsx`,
`mode === 'search'` view) renders `const snippet = (n.bodyPlain ||
'').trim().slice(0, 120)` — a naive first-120-characters prefix, NOT a
query-aware excerpt. For a match deep in a long note, this shows irrelevant
text while burying the actual match. This is a real, user-visible gap Wave 4
closes — not a hypothetical one.

### 1.4 Date fields available

`j2_notes` has exactly three date columns: `created_at` (NOT NULL),
`updated_at` (NOT NULL), `imported_at` (nullable, import-only). An index
already exists on `(user_id, updated_at DESC)`
(`idx_j2_notes_user_updated`) — **none exists on `created_at`**. "Notes from
March" most naturally means note-authored date (`created_at`), matching the
plan's own default guidance — but filtering on it at scale needs a new
index (`idx_j2_notes_user_created`), a one-line additive migration when
Wave 4 actually ships, not before.

### 1.5 Entity-layer query surfaces

`notes.py::get_symbol_backlinks(user_id, symbol)` is the only existing
entity query — **one ticker at a time**, UNIONing `j2_note_embeds` (accepted
chart embeds) and `j2_note_mentions` (P0-3 prose cashtags), deduplicated by
note id. Sector/industry/theme enrichment is **read-time-only, resolved for
the single requested symbol** via `ticker_meta.get_ticker_meta()` (the same
24h-cached lookup Wave 1 already uses) — **neither is stored per-mention,
and there is no bulk "all semiconductor-sector notes" query today.**

**Design implication for Stage 1 (entity-anchored retrieval):** a
"sector"/"theme" filter cannot be a direct SQL column filter without either
(a) a new denormalized column on `j2_note_mentions`/`j2_note_embeds`
(schema growth, more invasive), or (b) resolving sector/theme for the
member's SMALL set of DISTINCT mentioned symbols (bounded, reuses the
existing 24h cache, zero schema change) and filtering the note-id set in
Python. **(b) is the smaller, correct-by-precedent design** — matches this
program's "additive, minimal-footprint" discipline throughout Waves 0-3.

**Earnings-window: confirmed still deferred, exactly as Wave 1's decision
log recorded.** `awareness/engine.py::_collect_earnings_window` is shaped
for a multi-symbol scan cycle, not a single-symbol point lookup; Wave 1
explicitly deferred building a reusable version. The plan does NOT claim
earnings-window retrieval already exists — no correction needed here,
unlike the P0-3 case. If Wave 4 wants "NVDA, before the Fed meeting"-style
earnings-relative queries, that's new-build work, not a "wire the existing
thing" task.

---

## 2. FTS5 read-latency benchmark (Stage 0) — sandbox, synthetic corpus

Pure-SQLite benchmark (no web app, no `C:\data`, `DATA_DIR` pointed at a
scratch directory) — real schema via `db.py::ensure_schema()`, real AFTER
INSERT trigger populating `j2_notes_fts`/`j2_notes_fts_map`, real
`fts_match_expr()`. Corpus: synthetic notes from a ~100-word trading
vocabulary (deliberately small — see caveat below), global-table shape (a
small slice of "other users'" notes mixed in, matching production's single
shared FTS5 table).

| Scale (this user's notes) | Global FTS rows | `MATCH 'NVDA'` median | `MATCH` 4-term rare-AND (0 results) | `snippet()` median |
|---|---|---|---|---|
| 100 | 105 | 0.08ms | 0.04ms | 0.27ms |
| 1,000 | 1,050 | 0.83ms | 0.05ms | 0.29ms |
| 10,000 | 10,500 | 9.1ms | 0.19ms | 0.41ms |
| 50,000 | 52,500 | 49.3ms | 0.88ms | 0.88ms |

**Critical caveat — read this before citing these numbers as "the" answer:**
the synthetic vocabulary is small and repetitive, so a common single-term
query like "NVDA" matches **60–80% of the entire synthetic corpus** — a
massively pessimistic, unrealistic hit rate. A real member's search term
matching a small, specific fraction of the platform-wide corpus (the
realistic case) behaves like the 4-term rare-AND row above: **sub-millisecond
even at 50,000 notes**, because FTS5's postings-list intersection determines
"no/few rows match" almost immediately. The true cost driver is **how many
rows the query actually matches and must materialize**, not raw corpus size.
`snippet()` overhead is negligible at any scale tested (it only touches the
`LIMIT`-ed rows actually returned).

**Bottom line for the Stage 0 gate:** at today's real note counts (Waves 0-3
shipped same-day as this dossier — the global table is nowhere near 50,000
rows yet), read latency is a non-issue. The benchmark establishes the SHAPE
of the risk curve (linear in match count, not in corpus size per se) for
when the corpus grows — re-run this benchmark against real production
`j2_notes_fts` row counts once the Stage A cohort has generated real usage,
rather than trusting the synthetic numbers as production truth.

Benchmark script: `tools/wave4_fts_benchmark.py` *(reproduce locally — not
committed to run automatically; see script docstring for `DATA_DIR`
isolation requirements before running)*.

---

## 3. Design: date-range filter contract (NOT built)

- Default field: `created_at` (note-authored date — matches member intent
  for "notes from March" better than `updated_at`, which drifts every time
  an old note is edited).
- Query params: `dateFrom`/`dateTo` (ISO `YYYY-MM-DD`, inclusive), composed
  with the existing `_notes_filter_sql` predicate (AND, same as
  `folder_id`/`tag`/`ticker`/`q` today) — never a separate endpoint.
- New index required before shipping: `idx_j2_notes_user_created ON
  j2_notes(user_id, created_at)` — additive, one line, no migration risk.
- Ambiguity to resolve at implementation time (not before): should
  `dateFrom`/`dateTo` also apply when `q` triggers the FTS5 path (an AND on
  `j2_notes.created_at` after the `id IN (SELECT note_id FROM
  j2_notes_fts...)` subquery — straightforward) — yes, this composes
  cleanly with the existing `AND (id IN (...) OR ...)` structure.

## 4. Design: snippet/result-explanation UX (NOT built)

- Wire `snippet(j2_notes_fts, 3, '<mark>', '</mark>', '…', 12)` (body_plain,
  column 3) into the search-results row currently rendering the naive
  `bodyPlain.slice(0,120)` in `FolderSidebar.jsx`.
- Also snippet the title column (2) — a match that only hit the title
  should show the naive body prefix as a fallback (current behavior),
  never a body snippet that doesn't explain WHY the row matched.
- "Why this matched" explanation: the snippet itself is the explanation
  when the match is in body text (highlighted). For a tag/ticker match
  (the non-FTS5 OR-branch in `_notes_filter_sql`), the UI needs a distinct,
  small "matched tag: X" / "matched ticker: X" label — snippet() cannot
  explain a match that didn't go through FTS5 at all. Two different result
  ROWS need two different explanation renderers; conflating them would
  silently mislabel a tag match as a "content" match.

## 5. Design: entity-anchored retrieval (NOT built)

- Extend `list_notes`'s existing `embed_symbol` single-ticker filter (already
  shipped) with a `sector`/`theme` filter per §1.5's design: resolve the
  caller's DISTINCT mentioned-symbol set (bounded — a member's real symbol
  vocabulary is small) via the existing 24h ticker-metadata cache, filter to
  symbols matching the requested sector/theme, then narrow to notes
  mentioning ANY of those symbols (same UNION-of-embeds-and-mentions shape
  `get_symbol_backlinks` already uses, generalized from one symbol to a set).
- Earnings-window: explicitly OUT of Wave 4 scope per the plan's own Wave 1
  deferral — do not build a reusable earnings-window lookup as a Wave 4
  side-quest; that's new-build work belonging to a properly-scoped future
  slice if member demand (via the Stage A validation report) shows it's
  needed.

## 6. Vertical-slice plan (ready to execute once the gate opens)

1. **Slice 1 (Stage 0, lowest risk):** `idx_j2_notes_user_created` index +
   date-range filter params on `list_notes`/`count_notes` + router params +
   frontend date pickers in `FolderSidebar.jsx`'s search mode. Independently
   shippable, no dependency on snippet/entity work.
2. **Slice 2 (Stage 0):** wire `snippet()` into the search-results row,
   replacing the naive slice; add the tag/ticker-match explanation label.
3. **Slice 3 (Stage 1, needs Wave 1's entity layer — already verified
   complete):** sector/theme filter per §5's design, composed with the
   existing `embed_symbol` filter and the new date-range filter.
4. Each slice: unit tests (query-building + index usage) → integration
   (HTTP layer, real note fixtures) → real-browser E2E in the fail-closed
   sandbox → re-run the Stage 0 benchmark against whatever corpus exists at
   that point → deploy → production verify, matching this program's
   established per-wave discipline.

---

## 7. Spec corrections found this pass

None required. Unlike Wave 1's P0-3 ("~75% shipped" turned out false), every
Wave 4 dependency claim in the implementation plan and architecture doc was
independently verified TRUE against current code: `snippet()`/`highlight()`
genuinely unused, the entity layer genuinely complete (Wave 1 Slice 2, 2026-
09-05), earnings-window genuinely still deferred (as already documented),
query-safety genuinely already solved. The plan's own Stage 0/Stage 1
staging (architecture §7) remains accurate and is the correct sequencing.
