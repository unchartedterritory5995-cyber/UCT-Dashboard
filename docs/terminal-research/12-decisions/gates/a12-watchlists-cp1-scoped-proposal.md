---
id: GATE-A12-WATCHLISTS-CP1
title: A12 Watchlists — CP1 scoped proposal (S6 consistency rail + gap-naming)
role: Narrow pre-implementation review packet, proposing A12's first checkpoint now
  that S5 and S6 — its two named platform dependencies — are unblocked
phase: 3.5 (pre-implementation, not implementation)
date: 2026-09-20
status: 🔴 UNSIGNED — proposal only, presented to owner, awaiting explicit approval
sources: product-architecture.md §"A12 — Watchlists & Lists" (line 715),
  10-roadmap/2026-09-12-a-series-bucket-sort.md §"A12 — Watchlists & Lists" (lines
  268-296) and its bucket table (line 354), 00-program-control/COMPLETION_AUDIT.md
  A12 row (line 158), s5-persistence-user-state-pre-implementation-gate.md,
  s6-personalization-pre-implementation-gate.md (CP1 approval block, §2's
  three-authorities finding), s6-cp2-prime-build-record.md / s6-cp3-build-record.md
  / s6-cp4-build-record.md, plus this pass's own direct reads of
  api/services/member_interest.py (212 lines, read in full), api/services/
  watchlist_service.py (function index read in full), api/services/auth_db.py
  (watchlists/watchlist_items/ticker_tags/tracings_documents schema blocks),
  api/services/tracings_store.py + api/routers/tracings.py (73 + 43 lines, read in
  full), app/src/pages/Watchlists.jsx (header comment + COL_PRESETS/visiblePerf
  state), and CLAUDE.md §"Watchlists Page" in the s7-price-level worktree. No
  application code was modified to produce this packet.
---

# A12 Watchlists — CP1 (S6 consistency rail + gap-naming)

## APPROVAL — this block is filled in by the OWNER, not the author

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-21
APPROVED AT SHA:  acaa29de6
SCOPE APPROVED:   A12 CP1 -- watchlists/S6 consistency rail, per docs/terminal-research/12-decisions/gates/a12-watchlists-cp1-scoped-proposal.md section 2. MUST BUILD (the entire authorization): one new test file, tests/test_a12_s6_consistency_rail.py, asserting member_interest.interest_for(user_id)'s watchlist and flagged buckets are byte-identical to what watchlist_service.py's own functions say that user's membership is, for the same seeded user and DB state -- with a mandatory non-vacuity control (a user seeded with symbols in both an ordinary list and the flagged list, proving the rail can tell them apart) and a mandatory mutation proof (goes RED if member_interest's is_flagged_list filter is flipped/removed, or if its join is pointed at a copy missing new watchlist_service.add_item rows). The same file also pins, as falsifiable assertions (not prose), the two named gaps this checkpoint measures and does not fix: column presets have no typed store (Watchlists.jsx's COL_PRESETS/visiblePerf are plain component state, never persisted) and watchlist/tag rows are not yet S5 saved objects (no revision/CAS column, no watchlist_view_documents-shaped table) -- both assertions are designed to flip, on purpose, the day a future CP2 lands. Files touched: exactly one, the new test file. No .jsx file, no router, no schema migration, no change to member_interest.py's behavior. SHOULD BUILD: none -- matches the house convention (S5 CP1, S6 CP1) that a first checkpoint on a system with no PRD is a rail, not a feature. EXPLICITLY DEFERRED, NOT AUTHORIZED BY THIS LINE: CP2 (a watchlist_view_documents table + GET/PUT /api/watchlists/view-state, sized in section 2 but not authorized here); S2's #watchlist scope grammar; S7 price-level absorbing the legacy per-symbol watchlist alert path; writing an A12 PRD/spec; any ruling on SET vs WEIGHTED SET or other S6 boundary questions (A12 CP1 consumes S6's already-shipped interest_for as a fixed input and takes no position on it).
```

No field above is filled in. This packet proposes exactly one checkpoint (§2); nothing
in it authorizes writing product code, and nothing past what an owner signs here is
in scope.

---

## 1. Why this checkpoint matters now

A12 has sat in COMPLETION_AUDIT.md as **GATE-ONLY**, blocked on two named platform
dependencies: *"Missing: S5 (the list document has no typed store) and S6 (column
presets)"* (`10-roadmap/2026-09-12-a-series-bucket-sort.md:354`). Both moved since that
line was written:

- **S5** shipped a proven, twice-checkpointed *concrete shape* a per-domain saved
  object can copy: `tracings_documents` (`api/services/auth_db.py:490-495`, a
  `user_id`-keyed row with an integer `revision` CAS column) + `tracings_store.py`'s
  compare-and-set `get_tracings`/`set_tracings` (raises `TracingsConflictError` on a
  stale baseline, never a blind overwrite) + `api/routers/tracings.py`'s `GET`/`PUT
  /api/tracings`. Shipped CP3 (`GATE-S5-PERSISTENCE-USER-STATE`, fingerprint
  `41ffcc91c`), still dark — *"nothing in the product calls it yet"* (both files'
  own docstrings).
- **S6** shipped `api/services/member_interest.py`'s `interest_for(user_id)` (CP2′)
  and `GET /api/member/interest` (`api/routers/member.py`, CP4, paid-gated). Its
  `_watchlist_syms`/`_flagged_syms` helpers (lines 45-58, 61-76) read the exact same
  two tables A12 owns — `watchlist_items JOIN watchlists`, filtered on
  `is_flagged_list=1` for the flagged bucket — independently of
  `api/services/watchlist_service.py`, which is the module that actually creates,
  renames and syncs those rows (`get_or_create_flagged_list` line 282,
  `sync_flagged_items` line 310, `create_watchlist` line 12).

That second fact is the finding this checkpoint exists for. **S6 built a second,
independent reader of A12's own data, and nothing asserts the two agree.** This is not
hypothetical: S6's own CP1 (`s6-personalization-pre-implementation-gate.md` §2) found
exactly this shape of defect already live in production — three copies of one
vocabulary silently diverging, protected only by a comment (`importance.js:74`,
*"mirrors the my-sets join"*) that turned out to be **a record that nobody wired them
together**, not a guarantee that they had been
(`lesson_a_comment_claiming_agreement_is_not_agreement`). Two independent readers of
the same rows, with no test comparing them, is the precondition for that exact class of
bug — the drift is silent by construction until something reads the two answers side by
side.

**No A12 PRD or spec exists.** Checked `docs/terminal-research/05-product-strategy/
prds/` and `07-technical-architecture/specs/` this pass — both empty of any A12/
Watchlists entry, unlike every other in-scope system. That is a real gap and this
packet does not fill it (§7). What it proposes is buildable without one: a rail that
asserts an invariant already implied by both S6's own contract (*"never blocks the
others… never raises"*, `member_interest.py:21-30`) and A12's own definition of
membership, plus naming — not solving — the two dependencies still missing.

---

## 2. Exact scope

**MUST BUILD** (the entire authorization this packet asks for):

- **One new test file, `tests/test_a12_s6_consistency_rail.py`.** It asserts that
  `member_interest.interest_for(user_id)`'s `watchlist` and `flagged` buckets
  (`by_source["watchlist"]`, `by_source["flagged"]`) are byte-identical, for the same
  seeded user and DB state, to what `watchlist_service.py`'s own functions say that
  user's watchlist/flagged membership is — built by reading real watchlist rows via
  `list_user_watchlists`/`get_or_create_flagged_list` and comparing symbol sets, not by
  re-deriving a second SQL query the rail would then be trusting blindly.
  - **Non-vacuity control (mandatory, not optional):** seed one user with a symbol in
    an ordinary (non-flagged) list AND a different symbol in their flagged list;
    assert the rail can tell `watchlist` and `flagged` apart for that user before it is
    trusted to catch a real divergence.
  - **Mutation proof (mandatory):** the rail must go RED under at least two induced
    breaks — (a) `member_interest._flagged_syms`'s `is_flagged_list = 1` filter
    flipped or removed, (b) `member_interest`'s table join pointed at a copy that
    silently omits new rows `watchlist_service.add_item` writes. A guard that cannot
    be watched failing is not a guard (`lesson_gate_that_cannot_fail`).
- **The same file names, by name, the two gaps this checkpoint measures** — not as
  prose, as pinned, falsifiable assertions a future CP2 is graded against:
  1. **Column presets have no typed store.** `app/src/pages/Watchlists.jsx` declares
     `COL_PRESETS` as a module-level constant (line 282) and the member's chosen
     visible-columns state as plain component state — `const [visiblePerf,
     setVisiblePerf] = useState(new Set())` (line 833), read/written only via
     `togglePerfCol`/the preset buttons (lines 2599-2600). It is never passed through
     `usePreferences`, never `fetch`ed, never persisted anywhere — reload the page and
     it resets to empty. The test asserts this structurally (the literal
     `useState(new Set())` initializer, no persistence call in the same component)
     so that wiring it to a store later makes this specific assertion fail on
     purpose, which is the signal CP2 exists to flip.
  2. **List/tag rows are not yet S5 saved objects.** `watchlists`/`watchlist_items`
     (`api/services/auth_db.py:66-85`) and `ticker_tags` (`:620`) are plain
     `CREATE TABLE` rows with no `revision`/CAS column and no `GET/PUT` router
     mirroring `tracings.py`'s shape. The test asserts today's schema has no
     `watchlist_view_documents`-shaped table (by name, against
     `auth_db.py`'s own `_SCHEMA` string) — a fact that flips, deliberately, the day
     CP2 lands.
- **Files touched: one.** `tests/test_a12_s6_consistency_rail.py`, reading
  `api/services/member_interest.py`, `api/services/watchlist_service.py`, and
  `api/services/auth_db.py`. No `.jsx` file, no router, no schema migration.

**SHOULD BUILD:** none. This matches the house convention for a first checkpoint on a
system with no PRD: S5's own CP1 and S6's own CP1 (`s6-personalization-pre-
implementation-gate.md`'s signed scope, verbatim: *"NO PRODUCT CODE CHANGES… This
checkpoint is a test"`) were both rails, not features. A12 CP1 follows the same shape
for the same reason — no owner ruling exists yet on the boundary questions in §7, and
building past a rail would pre-decide them by construction.

**DEFER (named, not silently dropped):**

- **CP2 (sized here, not authorized):** copy the `tracings_documents` /
  `tracings_store.py` / `tracings.py` shape onto a new `watchlist_view_documents`
  table + `GET/PUT /api/watchlists/view-state`, shipped dark behind a compiled
  constant — exactly S5's own CP3→CP4 pattern. This would give column presets (gap 1
  above) a real store. Not part of this authorization.
- **S2's `#watchlist` scope grammar** and **S7 `price-level` absorbing the legacy
  per-symbol watchlist alert path** (`product-architecture.md:715`;
  `2026-09-12-a-series-bucket-sort.md:274-277`) — both explicitly owner-bound (§7),
  and both out of scope for any CP this packet proposes.
- **An A12 PRD/spec.** Real, and not invented here (§7) — writing one on the spot
  would be exactly the move the underlying research pass declined to make.

**EXPLICIT NON-GOALS:** no change to `Watchlists.jsx`'s reachable or unreachable
halves; no new API route; no schema change; no touch to `member_interest.py`'s
behavior (this checkpoint reads it, never edits it); no ruling on SET vs WEIGHTED SET
or any S6 boundary question (that ruling belongs to S6, not A12, and A12 CP1 does not
depend on it — it consumes S6's already-shipped `interest_for` as a fixed input).

---

## 3. Current state → target state

**CURRENT STATE**, verified this pass:

- A12 is *"simultaneously live and dead"*
  (`2026-09-12-a-series-bucket-sort.md:293-295`): the per-list surface
  (`charts/widgets/WatchlistWidget.jsx`, always passing `pickList`) is live inside
  `/charts`; the across-lists surface — `Watchlists.jsx`'s unscoped mode — reaches no
  route (`/watchlists` is a `LegacyRedirect`, no nav entry; confirmed again this pass
  via the file's own header comment, lines 5-14: *"This is ~half the file"*).
- Backend membership lives in `api/services/auth_db.py`: `watchlists` (line 66),
  `watchlist_items` (line 78), `ticker_tags` (line 620) — three independent,
  domain-owned SQLite tables, no shared CAS/versioning mechanism.
- `api/services/watchlist_service.py` is the one module that writes these tables on a
  member's behalf (`create_watchlist`, `add_item`, `get_or_create_flagged_list`,
  `sync_flagged_items`, and eight more CRUD functions — full index read this pass).
- `api/services/member_interest.py` (S6 CP2′, 212 lines, read in full) independently
  **reads** two of A12's own tables via `_watchlist_syms`/`_flagged_syms` (lines
  45-76) — never through `watchlist_service.py` — to build the `watchlist`/`flagged`
  buckets that `GET /api/member/interest` (S6 CP4, `api/routers/member.py`) serves,
  paid-gated, 15s-cached.
- **No test anywhere asserts these two readers agree.** Grepped this pass: no file
  compares `member_interest`'s buckets against `watchlist_service`'s own membership
  definition.
- Column presets: `Watchlists.jsx:282` (`COL_PRESETS`) + `:833`
  (`useState(new Set())`) — confirmed component-local, unpersisted.
- S5's concrete shape (`tracings_documents`, `tracings_store.py`, `tracings.py`) is
  built and dark, per §1 — a pattern to copy, not yet copied onto anything A12 owns.

**TARGET STATE (this checkpoint only):** the `watchlist`/`flagged` agreement between
`member_interest.py` and `watchlist_service.py` becomes a **provable, mutation-checked
invariant**, and the two named gaps above become **pinned, falsifiable facts** instead
of a restated "someday" — nothing else changes.

**THE GAP this CP1 closes:** exactly the missing test above. The gap it does NOT
close — a typed store for column presets, and A12's own PRD — is named in §2's DEFER
and §7, not solved here.

---

## 4. Risks

| Risk | Mitigation |
|---|---|
| **A rail that cannot fail is not a rail** — asserting agreement without ever having seen it disagree proves nothing (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). | The non-vacuity control and the two named mutation breaks are MANDATORY acceptance criteria in §2 and §6, not optional polish. |
| **Scope creep into "just fix the column-preset gap while I'm in there."** A CP1 that quietly ships a store would pre-empt the S5-shape decision (CP2) without an owner ruling on it. | §2's explicit non-goals + "no `.jsx` file, no router, no schema migration" file-touch list. |
| **The gap-naming assertions go stale** (CP2 ships and the pinned "does not exist yet" facts start failing for the right reason, but nobody notices why). | Each pinned assertion's failure message names the checkpoint it is watching for (CP2), per this repo's own convention (`s6-personalization` §2's forward-looking assertions do the same). |
| **This packet is read as a substitute for the missing A12 PRD.** | Stated plainly in §1 and §7 — it explicitly is not one, and the boundary questions a real PRD would resolve are named, not answered, here. |

No risk to production: zero product code, zero schema change, zero new route.

---

## 5. Test & acceptance plan

**New file:** `tests/test_a12_s6_consistency_rail.py`.

| Test | Proves |
|---|---|
| `test_watchlist_bucket_matches_watchlist_service` | For a seeded user with real rows written via `watchlist_service.add_item`, `member_interest.interest_for()["by_source"]["watchlist"]` equals the symbol set `watchlist_service.list_user_watchlists` reports for that user (flagged excluded per S6's own bucketing). |
| `test_flagged_bucket_matches_watchlist_service` | Same, against `get_or_create_flagged_list`/`sync_flagged_items`'s own flagged-list membership. |
| `test_non_vacuity_watchlist_and_flagged_are_distinguishable` | A user with one symbol in an ordinary list and a different symbol in their flagged list produces two DIFFERENT bucket contents — the control that proves the rail is not trivially green. |
| `test_mutation_flagged_filter_removed_is_caught` | With `_flagged_syms`'s `is_flagged_list = 1` filter monkeypatched away, the rail goes RED. |
| `test_mutation_stale_read_path_is_caught` | With `member_interest`'s read pointed at a connection that misses a row `watchlist_service.add_item` just wrote (simulating drift), the rail goes RED. |
| `test_column_presets_have_no_typed_store_yet` | Pins `Watchlists.jsx`'s `visiblePerf` state as unpersisted component state today — fails, by design, the day CP2 wires a store. |
| `test_no_s5_shaped_store_exists_for_watchlists_yet` | Pins the absence of a `watchlist_view_documents` table in `auth_db.py`'s schema — fails, by design, the day CP2 ships one. |

**Acceptance for the checkpoint as a whole:** all seven tests pass on the current tree;
the two mutation tests are verified BY RUNNING them against the intentionally broken
code path before this checkpoint is called done (not merely written and assumed
correct — `lesson_a_guard_repeated_is_a_guard_unproved`'s sibling: a guard never
watched failing is not proven). No existing test suite regresses (a read-only
addition cannot touch other tests' fixtures).

---

## 6. Owner-bound questions

**None block this checkpoint.** Verified explicitly:

- **S2's `#watchlist` scope grammar** and **S7 `price-level` absorbing the legacy
  alert path** are real open boundary questions for A12's eventual shape, but this
  CP1 touches neither — it is a test over already-shipped code, not a design
  decision about search grammar or alert routing.
- **The missing A12 PRD/spec** is a real gap (§1) and is flagged here for the
  owner's attention, exactly as the source research pass declined to paper over it.
  This packet is not a substitute for that document — it is the smallest,
  defensible, buildable-today slice that does not require one.
- **CP2's shape** (the `watchlist_view_documents` store) is sized in §2 as a named
  future target, not proposed for approval now. Signing this packet authorizes
  §2's MUST list only.
