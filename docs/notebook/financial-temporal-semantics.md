# UCT Notebook — Financial Temporal Semantics (Wave F)

Program-wide contract for how a captured financial value's *meaning over
time* is represented, stored, and displayed. Established by Wave F
(Financial Fact / Snapshot Ledger); binding on every future wave that
touches `j2_fact_observations` or introduces a new fact type. Full
architectural rationale lives in the Wave F entry checkpoint
(`prelaunch-primary-notebook-build-plan.md`) — this document is the
durable, standalone reference, not a restatement of that checkpoint's prose.

## The four temporal modes

Every fact type (`fact_registry.py`) declares exactly one `temporal_mode`.
This is a stored, enforced column (`j2_fact_observations.temporal_mode`) —
never documentation-only.

### `live`
The displayed value intentionally represents the CURRENT value at the
moment the member views it. No original historical value is implied to be
preserved. **Not used by any Wave F capture path** — every capture action is
itself an act of preserving a moment, so nothing this wave is pure `live`.
Reserved for a future reference-card use (e.g. an inline "current price of
X" widget with no capture semantics at all).

### `snapshot`
The observed value is frozen as of a specific `observed_at` time.
Re-opening the note later never overwrites it. No current-value resolver is
ever called for a `snapshot` fact — there is nothing to compare against by
design, not by failure. Used by `user_note` (Wave F) and reserved for a
future `analyst_price_target_consensus`-class type once rights-approved.

### `live_and_snapshot`
The original observation is preserved immutably AND the UI can resolve a
current comparable value at read time, rendered as a separate field, never
overwriting the original. This is the mode that produces THEN/NOW/CHANGE.
Used by `price` (Wave F) — the only mode where a fact's row and a live
provider call coexist.

### `reference_only`
UCT preserves a durable reference to the source/object but does not
persist the underlying value as a permanent snapshot — reserved for a
rights-`blocked` fact type. **Unused by any Wave F fact type** (nothing this
wave is classified `blocked` — see Rights below). The UI must never
represent `reference_only` data as a historical frozen value if this mode
is ever used.

## `observed_at` vs. `source_as_of`

Two distinct timestamps, never conflated:

- **`observed_at`** — when UCT/the member captured this. Always present.
  Client-stamped at the moment of capture (same idiom `widgetEmbedCore.js`'s
  `capturedAt` already uses for chart embeds).
- **`source_as_of`** — the provider's own as-of time for the value, when the
  provider genuinely exposes one distinct from "when we asked." Nullable,
  **never fabricated** from `observed_at`, an HTTP response time, or a
  note-save time. No Wave F fact type's upstream data source (Massive live
  prices, FMP consensus) currently exposes a reliable per-value as-of
  timestamp distinct from request time, so `source_as_of` is `NULL` for
  every fact this wave ships — an honest, recorded gap, not a fabricated
  field.

## Immutability

A `snapshot` or `live_and_snapshot` fact's `value_number`/`value_text`/
`unit`/`observed_at` are **never updated** after creation. This is enforced
structurally: `note_facts.py` has no `update_fact_observation` function —
only `create_fact_observation` (INSERT-only) and `delete_fact_observation`.
The one editable field is `caption` (`update_fact_caption`), a user
annotation, never the observed value itself.

A second observation of the same logical series (same ticker, same
`fact_type`) is a **new row**, never an overwrite. "THEN stays THEN" even as
"NOW" changes is the entire point of the ledger — see
`test_then_stays_then_when_current_value_changes` in
`api/services/journal_two/test_wave_f_facts.py` for the executable proof.

## Current-value resolution

For a `live_and_snapshot` fact, "what is this comparable value NOW" is
resolved at **READ time only** (`fact_current_value.py`), batched per note
(one call per note-open, never one per fact — every `financialFact` node in
a note shares one `useNoteFacts(noteId)` SWR cache key). Never persisted.
Never confused with the immutable original.

**Provider consistency**: a fact type's current-value resolver always reads
the SAME source class its capture path used. `price` capture and `price`
current-value both go through the shared live-price cache
(`api/routers/live_prices.py::get_live_prices`) — there is no cross-provider
fallback that could manufacture a false "change."

**Failure never hides the original.** A current-value resolution failure
returns `None` for that fact's current value; the captured observation
remains fully visible. `FinancialFactView.jsx` renders "Couldn't refresh,"
never a blank card, never a hidden original.

## Rights classification

Every fact type carries a `rights_class`, independent of `temporal_mode`:

- **`independent`** — no external-rights dependency. `price` (re-derives
  from UCT's own permanently-stored, already-licensed Massive bars — the
  same data chart embeds already snapshot into notes) and `user_note`
  (the member's own text) are both `independent`.
- **`conditional`** — genuinely new vendor-value persistence with no prior
  precedent in this codebase, gated on Patrick's external legal review
  (never reopened by this program). `analyst_price_target_consensus` is
  `conditional` and **architected but inactive**: the registry entry,
  resolver, and storage columns all exist and are tested, but
  `note_facts.create_fact_observation` rejects any attempt to create one
  (`FactValidationError: ... not yet enabled`), and no frontend surface can
  reach it. Activating it later is a frontend-only change — zero
  schema/backend change required.
- **`blocked`** — reserved for a fact type found to require storage this
  program cannot grant. None identified this wave.

## Fact-type registry (Wave F)

| key | label | value column | unit | temporal_mode | source | rights_class | active |
|---|---|---|---|---|---|---|---|
| `price` | Price | `value_number` | `usd_per_share` | `live_and_snapshot` | `massive` | `independent` | ✅ |
| `user_note` | Note | `value_text` | `text` | `snapshot` | `user` | `independent` | ✅ |
| `analyst_price_target_consensus` | Analyst Price Target (Consensus) | `value_number` | `usd_per_share` | `snapshot` | `fmp` | `conditional` | ⛔ inactive |

Source of truth: `api/services/journal_two/fact_registry.py`. Adding a new
fact type is a registry entry (+ a current-value resolver if
`live_and_snapshot`) — never a schema change.

## Identity

- **Entity identity**: `entity_master.resolve(ticker, as_of=None)` — a
  fully-built, tested, production-seeded canonical security-identity
  service (`api/services/entity_master/`), consumed here for the first time
  in this codebase. `entity_id` is stored when resolution succeeds;
  `not_found`/`ambiguous` never blocks a capture — `ticker` (the display
  symbol as captured) is always present regardless.
- **Fact identity ("the same logical series")**: `(entity_id or ticker,
  fact_type, period, unit)`. Two observations of that series at different
  `observed_at` times are two distinct rows.
- **Observation identity**: the row's own `id` (uuid4 hex).

## Ownership and lifecycle

Facts are **note-owned, not shared across notes** (a deliberate
simplification — directive §33/§34's explicit permission to choose
simplicity over normalization). One `j2_fact_observations` row belongs to
exactly one `note_id`. Consequences:

- Trashing a note leaves its facts fully intact (soft-delete only).
- Hard-deleting a note cascade-deletes its facts (`AFTER DELETE ON j2_notes`
  triggers) — no reference-counting needed.
- Removing a `financialFact` NODE from a note's body does **not** delete the
  underlying fact row (only `note_facts.delete_fact_observation` does that)
  — a member cutting a card mid-edit and pasting it back doesn't lose the
  capture.
- Account deletion purges both `j2_fact_observations` and
  `j2_note_fact_refs` directly (`account_purge._DIRECT_USER_TABLES`).

## Export

An export is a durable artifact, not a live view. Only the immutable
observation is ever written to an exported note's front matter
(`financial_facts:` block: ticker, fact label, formatted value, `observed`
timestamp, caption) — **never a live current-value lookup**. See
`test_full_export_never_leaks_a_current_value_only_the_immutable_original`.
