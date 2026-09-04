# Screener / Saved-Screen Preservation Baseline (P2)

Per P2: verify the existing screener/saved-screen user contract using now-correct terminology, for
preservation evidence — not redesign. Combines a dispatched research pass with direct, fresh code
verification of its most specific claims (one of which did not hold up under re-verification — corrected
below rather than relayed uncritically, per this program's own evidence discipline).

## Terminology, confirmed final

"Custom Screens" is not used anywhere in the codebase or product UI. The confirmed, current vocabulary,
consistent across all three Golden Journeys that touched it (CGJ#1 Pine, CGJ#2 thinkScript, CGJ#3
TC2000/PCF):

- **Screener** — the left-nav surface (`/screener`), display-named plainly, route matches display name
  (unlike `/calendar`'s "UCT Terminal" naming — see memory).
- **Screens ▾** — the in-page dropdown: **STARTERS** (prebuilt, firm-authored), **MY SCREENS** (saved,
  user-curated filter sets built from the standard column/filter panel), **MY SCANS** (user-authored
  boolean formulas from the indicator Builder, promoted to screener use via "Use as filter").
- **"1 saved formula cannot be a screen yet"** — the summary refusal line for a numeric (non-boolean)
  user-authored formula; expanding it (not attempted in earlier Golden Journey docs, done for the first
  time in CGJ#3) surfaces a much more specific, mechanism-precise explanation naming the actual evaluation
  rule (`<tree> != 0` on the last confirmed bar) and a concrete fix.

## Confirmed live, across three Golden Journeys (CGJ#1/#2/#3)

- The numeric-vs-boolean screener gate is a single, door-agnostic rule keyed on AST output type, not
  per-language special-casing — directly confirmed by observing all three doors hit the identical mechanism
  (two refused as numeric, one accepted as boolean, with the acceptance case *not* requiring the optional
  "is above / value" threshold-conversion helper TC2000/PCF's import path offers).
- Applying a saved, accepted scan as a filter produces an honest, specific status chip
  ("<name> — first sweep tonight"), not a bare "0 matches" — the fix for a real, documented historical
  incident (`_stamped()`'s "X88" case, where a refused definition could get stuck reading "first sweep
  tonight" forever because a refused definition "never earns a receipt") holds under live re-observation.
- `Structure library` (the Base & Structure Library dialog) is present as a toolbar entry next to
  `Screens ▾`, not exercised in any Golden Journey — logged as unverified, not assumed working.

## Edit path — a correction to an earlier, less-precise finding

An earlier condensed note from this program's own research described the definition-edit route
(`PUT /api/user-definitions/{def_id}`) as lacking error handling and lacking a real UI caller. **Direct,
fresh reading of the current route does not support that claim as stated**, and it is corrected here rather
than carried forward uncritically:

- The route's own docstring states it now has a real product caller: *"AS OF THIS COMMIT IT HAS A PRODUCT
  CALLER. `BuilderSheet` opens a saved formula, and its Save button routes here through the SAME document
  builder, the SAME `validateUserDefinitions` door and the SAME `installUserDefinitions` that a create goes
  through — one write path, not two. Until now this route existed in shape only, which is why `compute.rev`
  in every stored blob had stayed `1` since Phase D shipped: nothing in the product could move it."*
- Error handling present and reasonable: a `ValueError` from history lookup → 400; a non-existent (or
  never-created) `def_id` → 404 ("AN EDIT REQUIRES SOMETHING TO EDIT — 404, NOT AN UPSERT," specifically
  closing a prior client-chosen-id vulnerability); a tombstoned definition can be resurrected by editing it
  again (uses `history()`, not `get()`, precisely so a save-over-a-tombstone is treated as an edit that
  revives it, not a 404).
- **What remains genuinely unverified**: this is a code-level finding only. No Golden Journey in this wave
  exercised the pencil-icon edit flow live in a browser (CGJ#1 explicitly noted "Pencil icon observed,
  never exercised" and this remains true through CGJ#2/#3 as well) — the Validation Coverage Map's "Save/
  persistence (edit)" row stays at 0 (Exists, unverified) until a live pass actually clicks it.

**Lesson applied**: this is exactly the "before recommending from memory, verify" discipline — a compressed
claim from an earlier pass didn't survive a fresh, direct read of the current code, and the correction is
recorded plainly rather than silently dropped or silently carried forward.

## Two claims that DID hold up under direct re-verification

**`scan_store.prune()` is genuinely unwired in production.** Confirmed by direct grep across the entire
codebase: `.prune(` is called in test files only (`tests/test_scan_store.py`); the one production call site
that superficially matches (`api/main.py:6341`, inside a scheduled `_fundamentals_warm_job`) resolves to a
completely different, unrelated store (`fundamentals_estimates_store`, imported locally as `_store` in that
closure) — not `scan_store`. `scan_store.prune()`'s own docstring explicitly anticipates exactly this
mistake pattern, citing a sibling table (`alert_shadow_fires`, "279 GB/yr at 10,000 alerts... grew for a
year before anybody measured it") as the reason the prune function *shipped with the tables, not after
them* — yet the function itself is not on any schedule. **Logged as RISK-024.**

**Dangling scan-definition references in screen alert subscriptions — confirmed, and a fresh instance of an
already-known failure class.** `screen_alert_subs` stores `def_hash`, `def_id`, and a `name` **snapshot**
captured at subscribe time (`INSERT OR REPLACE INTO screen_alert_subs`). The nightly alert-firing loop
(`screen_alerts.py`'s alert dispatch function, read directly) keys entirely off `def_hash` to look up
`diff_for(def_hash, tf)` — at no point does it check whether the underlying `user_definitions` row (by
`def_id`) still exists, was soft-deleted, or was edited (which changes `ast_hash`/`def_hash`, per the edit
route's own "a maths change bumps `rev` and force-migrates every binding" docstring language). Two concrete
consequences, neither guarded against in what was read: (a) a member who deletes a definition they're
subscribed to for alerts likely keeps a subscription row that silently stops producing anything, with no
signal to the member that it's now dead — the same *silent-forever-pending* shape CGJ#1 documented once
already for `_stamped()`'s pre-fix state, now found in a sibling system that was never given the equivalent
fix; (b) the alert message's displayed screen `name` is a point-in-time snapshot, not a live join, so a
renamed definition would fire alerts under its old name indefinitely. **Logged as RISK-025.**

## What this baseline is not

Not a redesign proposal, not a completeness audit of every screener code path, and not a re-verification of
mechanisms already confirmed via `test_screener_wave4_query.py`/`test_screener_filters.py` in earlier
archaeology (101/101 passed, `VALIDATION_COVERAGE_MAP.md` row already reflects Unit-level for that). Scoped
specifically to closing out P2's preservation-evidence mandate and correcting one claim that didn't survive
direct re-verification.
