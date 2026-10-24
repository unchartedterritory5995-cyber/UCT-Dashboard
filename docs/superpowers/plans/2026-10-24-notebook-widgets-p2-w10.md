# Notebook Widgets Phase 2, Wave 10 (Formulas, Options and Notes, the Shelf, the Position Size Calculator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship, dark behind `NOTEBOOK_WIDGETS_W10_ENABLED`, a small spreadsheet-style formula dialect for built widgets (server and client twins, one shared vector file), the Options strategies and Notes sources, the ready-made shelf as immutable revision files with a hash rail and an "Updated version available" control, every §8 shelf row (the definition rows as revisions, the seven sequence or compose rows as dedicated builders), and a position size calculator in `/`.

**Architecture:** The formula dialect is a pure module (`widget_formula.py`) with its own tokenizer and a recursive-descent parser with an explicit depth counter; it evaluates an AST through a static dispatch table, never `eval`, never SQL. A plan stores each formula in CANONICAL form (field keys, title-case function names); the builder shows labels. Plan format 3 is written only when a plan uses a formula, a new source or a new display option, so every wave 8 and 9 plan stays byte-identical and a reverted server refuses a v3 plan with the too-new sentence. The two new sources plug into the wave 8 `Catalog` like the five before them. The shelf moves from one `shelf.json` to one file per revision plus a `MANIFEST.json` of canonical-JSON hashes; every placement pins `defRev`. The seven dedicated builders are phase 1 shell builders (`notebook_widgets._BUILDERS`, `cap_payload`, account kinds) in two new modules, served by one POST route so member-entered limits never reach a query string. The calculator is a trader block computed in the browser from the member's own account size.

**Tech Stack:** React + TipTap + Vitest (`app/src`); FastAPI + sqlite + pytest (`api/`).

**Spec:** `docs/superpowers/specs/2026-10-24-notebook-widgets-phase2-design.md` (§5.4, §5.5, §5.7, §5.9-§5.11, §8, §13 wave 10 row and its flag paragraph, §14, §16 answers 1, 2 and 6, §17), on top of `docs/superpowers/specs/2026-10-19-notebook-widgets-design.md`. Format and earlier interfaces: `docs/superpowers/plans/2026-10-24-notebook-widgets-p2-w7-w8.md`, `docs/superpowers/plans/2026-10-24-notebook-widgets-p2-w9.md`. Rulings R-1..R-32 (`.superpowers/sdd/2026-10-24-notebook-widgets-p2-w7-w8/progress.md`) and W9-R1..R22 (`.superpowers/sdd/2026-10-24-notebook-widgets-p2-w9/progress.md`) carry over, notably R-1 anchors are hints, R-9 one build at a time, R-14 controller review of mechanical diffs, R-15 If-Match = `etag`, R-22 shelf substitutions, R-24 no fully hidden shelf column, R-25 account names never public, R-27 missing If-Match = 428, W9-R3 `needed_version`, W9-R7 no zeros on the measure path, W9-R14 the error class is the status authority, W9-R15 cross-module reads through PUBLIC functions, W9-R17 bounded loops with deadlines, W9-R18 an unresolved ref is one notice.

## Global Constraints

- No note schema change. The seven dedicated kinds are new `widgetId` values of the existing `widgetEmbed` node (snapshot kinds, the phase 1 pattern); the calculator is a trader block (`blockManifest`, the `positionSizing` precedent, `registry.js`). A task that finds it needs a node, mark or attr change in `lib/notebookSchema.js` or `notebook_schema.py` stops and comes back to the owner.
- First-open bytes: budget **2,260,793 B**, never raised (last recorded 2,178,133 B at Task 9.1). Gate: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist` must print `VERDICT: PASS`. It runs in every task that touches an eager file, named per task (10.1, 10.14, 10.20, 10.21, 10.23). The formula twin, the builder, the views, the embeds, the calculator body and `lib/dedicatedWidgets.js` are lazy; eager additions are limited to the flag rows, seven `WIDGET_KINDS` rows, seven registry rows plus one block row, one `BLOCK_COMPONENTS` importer, one label and the slash items. A lazy task that finds itself importing into an eager file stops and moves that line into the next eager task.
- Wave 10 flag: `NOTEBOOK_WIDGETS_W10_ENABLED`, default `False`, read per request through `notebook_widgets_wave_on(10)`. Payload key `notebook_widgets_w10_enabled`, latched per tab. Wired in ONE commit (Task 10.1). Rollback is `=0`, never a delete. With the flag off: every plan where `plan.uses_wave10(plan)` answers the `public.not_found()` 404 on `/run`, `/preview`, `/drill`, create, save and revision restore (a rename-only `PUT` is allowed, the W9-R16 rule); the vocabulary lists no new source, field, function or display option; `/shelf` serves for each id the newest revision whose plan needs no dark wave and hides the dedicated kinds; the dedicated route 404s; a placed widget keeps its snapshot and says `"Not available right now."` on See it now; the calculator block says `"Not available right now."`. Stored definitions, revisions and placements are kept and reappear when the flag is switched back on.
- ⛔ The note-property formula language is untouched (spec §16.2): no edit to `api/services/journal_two/formula_engine.py`, `app/src/pages/journal-2-0/lib/formula/**` or `formulaVectors.json`. Task 10.23 proves it with `git diff --stat origin/master...HEAD -- api/services/journal_two/formula_engine.py app/src/pages/journal-2-0/lib/formula` printing nothing.
- ⛔ Phase 1 is unchanged (spec §16.6, ruling W10-R1): no phase 1 kind's builder, params, copy, menu or behaviour changes; `SETTING_KEYS`, `SETTINGS_KEYS`, `REQUEST_KEYS` and `PASS_PARAMS` do not change. Additive rows in shared tables (`KIND_WAVE`, `KIND_TITLE`, `ACCOUNT_KINDS`, `_BUILDERS`, `WIDGET_KINDS`, `MARKET_DATA_VENDORS`, `CHANGE_FIELDS`) are allowed and railed by `test_phase1_kind_rows_unchanged` (Task 10.14). The one phase 1 router edit is the GET refusing the seven dedicated kinds, as it already refuses `builtWidget`.
- Formulas (spec §5.5): `[Field]` references, title-case functions, exactly the 15 functions of Task 10.2, at most **5** per plan, expression length at most **2,000** characters, at most **500** tokens, nesting depth at most **32**, names at most **60** characters. No variables, no loops, no text manipulation, no lookups across sources, no formula referencing another formula. Divide by zero, a non-finite result, or an empty input gives `null` (rendered "no data"), never `Infinity`, never `0`. A formula never reaches SQL: every formula filter and split is evaluated in Python after the bounded scan, and the compiled SQL text never contains formula text (railed).
- Bounded work (W9-R17): every scan stays `LIMIT 5001` on an indexed order; every Python loop over scanned rows (formula evaluation, sequence builders, notes properties) calls the run's `check()` every **256** rows and raises `run.EngineTooLong` past the 1.5 s deadline, mapped to `"This is a lot of data to add up. Try a shorter range or fewer splits."`. Dedicated builders read at most **5,000** rows per table and at most **3,700** sessions.
- Plans (ruling W10-R3): `plan.PLAN_VERSION` becomes **3**. `plan.needed_version(plan)` answers 3 when the plan has a formula, reads `options_strategies` or `notes`, or sets `display.cumulative`, `display.targetGoal`, `display.stopAfter` or `display.quadrants`; else the wave 9 answer (2 for routine or tracker use, else 1). The new display keys and `formulas` are written ONLY when used, so a plan that uses none validates to exactly the dict it did in wave 9 (railed). A wave 9 server refuses a v3 plan with `"This widget was made with a newer version of the app. Reload to use it."`.
- No zeros (W9-R7, spec §2): no widget, line or count shows `0`, `$0`, `0%`, `"0 of"` or `"(0)"` where the honest answer is "no data", "none yet" or "not checked". Each empty state has its own sentence, fixed per task.
- Ownership: `user_id` from the session only. Options legs are read only for strategy ids that came from the member's own scanned rows; note properties, folders and kinds with `user_id = ?`; a plan link, a trade, an account, a property or a fire row that is not the member's is absent (W9-R18: one notice, never a read of another member's row).
- Errors: `{"detail": {"code": str, "message": str}}`; every 200 and every error `Cache-Control: no-store`. A formula refusal is `widget_formula.FormulaError`, a `plan.PlanError` subclass carrying `.code`, `.sentence`, `.pos` and the formula id; the router answers it as 400 code `formula` with `formulaId` and `pos` beside the message. The dedicated route's refusals are `shelf_kinds.ParamError(tool_errors.ToolError)` (W9-R14: the class carries status and code; the router never matches sentences). The dedicated router's 402 sentence is its own: `"Ready-made widgets require a paid plan"` (`tests/test_user_definitions_auth.py`).
- Privacy: the seven dedicated kinds and the calculator are private (`MARKET_DATA_VENDORS` `"private"`, neutral line on share, publish, gallery and example, even with `share` on; no database read on a public render). Built widgets keep the wave 8 public rules; ruling W10-R7 adds: a notes-source list row is relabelled `"Note <n>"` publicly (the R-25 mechanism, `labelKind: "note"`), and the new display payload keys are not allowlisted publicly in wave 10. Formula expressions and names travel only inside the frozen `def`, which never reaches a public page.
- Every number shown goes through `notebook_widgets._num`: NaN or Infinity becomes `null`.
- Member words: Widget, Routine, Tracker, Template. "definition", "shelf", "built widget", "source", "plan", "scope", "formula field" in a heading are internal; the builder section is titled "Your own fields", the box is labelled "Formula", the tile says "Options strategies" and "Notes". No emoji; icons are `UIcon` names. Every touch target is at least 44 px (`styles/tapFloor.test.js`).
- Repo rules: run tests in their own tool call, read the totals line, then commit in a separate call. Backend: `python -m pytest <named files> -q`, never a directory. Frontend: `cd app && npx vitest run <paths>`. Files are LF. Run `python tools/check_repo_hygiene.py` before each commit. Commit with `git commit -F - <<'MSG'` ... `MSG`, the message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, with an explicit pathspec when another agent works in the same worktree. Push the branch after each task. Never create scratch worktrees or junctions (the 7.6 incident); measure in place. Never `git checkout` a file to undo a mutation probe (restore by SHA).

### Rulings made by this plan (W10-R1..R12)

- **W10-R1 (what "phase 1 unchanged" means).** No phase 1 kind changes in any observable way, and the phase 1 key lists do not move. New kinds are added as rows. The phase 1 GET refuses the seven dedicated kinds (as it refuses `builtWidget`), so each kind has exactly one door.
- **W10-R2 (canonical formulas).** A stored expression names fields by KEY (`[net] / [risk_dollars]`) and functions in title case (`SumIf`). The builder and every sentence show labels (`[Net P&L] / [Risk $]`). A label can be renamed in a later app version without moving any stored formula (P6). A member may type a key or a label; keys win; matching is ASCII case-insensitive. A rail asserts no source has a label equal to a different field's key.
- **W10-R3 (plan format 3).** As in Global Constraints.
- **W10-R4 (one POST door for dedicated kinds).** The seven kinds refresh through `POST /api/j2/notebook-shelf-widgets/{kind}` `{params}` and a lazy client merge (`lib/dedicatedWidgets.js`), the `builtWidget` pattern, so the prop-firm limits never appear in a query string or an access log and no phase 1 key list moves.
- **W10-R5 (shelf files).** One file per revision, `widget_engine/shelf/<slug>.r<N>.json`, plus `MANIFEST.json` holding the canonical-JSON SHA-256 of each file (canonical JSON, so line endings cannot move a hash). Released entries are append-only, railed against `origin/master`'s manifest. A wave 8 shelf placement with no `defRev` is revision 1 (wave 8 had only revision 1). `/shelf`, `/examples` and the update control use, per id, the newest revision whose plan needs no dark wave.
- **W10-R6 (new sources).** Options strategies and Notes never use the sample book. Options measures count closed strategies only (open ones appear in lists, filters and counts of "Strategies"); they reuse the shared measures by widening `sources` in the adapter, never by copying a formula.
- **W10-R7 (public).** As in Global Constraints.
- **W10-R8 (calculator).** A new trader block `sizeCalc`, "Position size calculator", distinct from the house `positionSizing` block (grade and regime). It reads the account size live through `hooks/usePositionSizingSources` (IR-S9: an unset or placeholder size is not the member's), stores only what the member typed, and is private on public pages.
- **W10-R9 (room-left arithmetic).** Daily room = limit − max(0, −today's net), today's net incl. closed options strategies (W9-R22); a green day never adds room. Trailing drawdown = running peak (floor 0, from `since`) − current cumulative net; room = limit − drawdown.
- **W10-R10 (alerts).** "Alerts that fired" reads the two append-only fire logs, `alert_fired_log.list_fires` (indicator and price alerts) and `alert_taxonomy.receipts.list_fires_for_feed` (filings, ratings, events), never `user_alerts` (the bell mirror, which also holds routine reminders).
- **W10-R11 (§8 rows that change shape).** #12 P&L by hold time revision 2 buckets by minutes, spec-literal: members with dates only see `"Hold time in minutes needs entry and exit times; your trades have dates only"`. #22 Process vs results ships on plan adherence %; its routine half waits for wave 11's pick-yours slots. #20 and #21 keep R-22's shapes. #9 Max drawdown needs no new revision: its date range and recovery appear for every max drawdown number.
- **W10-R12 (revenge clean days).** The window is the last 30 finished sessions (today counts after its close). A session with no trades is clean; a session whose trades all have dates only is "not checked" and leaves the denominator, with its count stated. The line never reads "0 of".

## Review Focus

1. **Hostile and boundary formulas.** `[__proto__]`, `[constructor]`, `'; DROP TABLE j2_trades; --`, `$.a`, `%_`, a fullwidth `［Net P&L］`, `1e309`, `[net] / 0`, 2,000 and 2,001 characters, depth 32 and 33, 500 and 501 tokens, `If(` unclosed, a 10,000-deep `((((`, and every vector run by both twins. Nothing raises past `FormulaError`, nothing recurses past the counter, the two twins agree on every vector, and no formula text reaches SQL. Owned by Tasks 10.2, 10.3, 10.4 and 10.5.
2. **Revert and update safety.** A wave 9 server reading a v3 plan; every wave 8 and 9 plan and shelf r1 validating byte for byte as before; shelf revision 2 with wave 10 off (rev 1 is offered and runs); a note holding a rev-2 placement with wave 10 off (snapshot kept, See it now dark); a shelf file edited after release (the hash rail reds). Owned by Tasks 10.4, 10.8, 10.9 and 10.13.
3. **Time edges in the dedicated builders.** A loss at 15:58 ET and a re-entry at 16:20 ET; an options strategy closed `2026-11-27T00:30:00Z` (the ET day before); Risk left today on the half day after Thanksgiving after its 13:00 close; the revenge window across Thanksgiving; "since the last session" on the Monday after Good Friday. Owned by Tasks 10.10 and 10.11.
4. **Another member's ids everywhere.** Options legs of member B's strategy, B's note property id in a filter, B's trade id in Plan vs actual, B's account id in prop-firm params, B's alert fires, and the result cache with two members on one plan hash. Nothing crosses; each is absent with its one notice. Owned by Tasks 10.6, 10.7, 10.10, 10.11 and 10.12.
5. **A brand-new member.** No trades, no strategies, no notes, no limits, no goals, no plan links, no alerts, no account size. Every widget and the calculator show their sentence; none shows `0`, `$0`, `0%` or `"0 of"`. Owned by Tasks 10.5, 10.10, 10.11, 10.15 and 10.20.

## Order, lanes and parallel work

The owner asked for more simultaneous work. Concurrency cap: 5 agents while available memory stays above about 4 GB (the wave 9 ledger's measured rule); builds stay one at a time (R-9). Every lane commits with pathspecs.

- **Task 10.1 first** (controller, R-14, in `nbw-p2-impl`; it runs a build).
- **Backend, `nbw-p2-be`** (only `api/`, `tests/`, `docs/account-deletion-manifest.md`; zero first-open bytes):
  - Lane F (formulas and sources): **10.2 → 10.4 → { 10.5 ∥ (10.6 → 10.7) } → 10.9 → 10.13.** 10.5 owns `aggregate.py`, `payload.py`, `run.py` and the shared `measures.py`; 10.6 and 10.7 own `sources.py`, `compile.py`, `widget_engine/measures.py` and `drill.py`. 10.4 lands every shared table row both need first, so the two branches touch disjoint files.
  - Lane S (shelf storage): **10.8**, from the start, in parallel with Lane F. It owns `shelf.py`, `widget_engine/shelf/` and the router's `_resolve` and `/shelf`; 10.9 (Lane F) edits the router only after 10.8 lands.
  - Lane D (dedicated builders): **10.10 ∥ 10.11 → 10.12**, from the start. 10.10 and 10.11 are new modules; 10.12 owns `shelf_kinds.py`, the new router, `api/main.py`'s include line, `public_note_payload.py` and the phase 1 router's two-line refusal.
  - At most five backend agents at once: 10.2, 10.8, 10.10, 10.11 can start together.
- **Merge** `feat/notebook-widgets-p2-be` into `feat/notebook-widgets-p2` after 10.12 and 10.13 (the R-7 pattern), with the combined backend suites green.
- **Frontend, `nbw-p2-impl`** (one `npm run build` at a time). Lazy tasks run vitest only and may run concurrently on disjoint files; eager tasks are serialized.
  - Lazy, concurrent: **10.3** (after 10.2's vector file lands), **10.15**, **10.16 → 10.17**, **10.18**, **10.19**. They code against the backend shapes in this plan and mock `fetch` until the merge.
  - Eager, serialized: **10.1 → 10.14 → 10.20 → 10.21.** 10.14 needs the merge (it lands the server and client kind rows in one commit, the 8.13 precedent). 10.16 and 10.17 need wave 8 Task 8.15's sections; 10.21 needs Tasks 8.16 and 8.18 (`ExamplesGallery`, the Mine group) and 9.19 (the slash rows it sits beside).
- Tasks **10.22** and **10.23** last.

---

### Task 10.1: Flag wiring in every place

**Files:**
- Modify: `api/routers/auth.py` (`NOTEBOOK_FLAGS`, after the W9 row)
- Modify: `app/src/pages/journal-2-0/lib/offline/notebookFlags.js` (`FLAG_FALLBACKS`, after the W9 row)
- Modify: `app/src/pages/journal-2-0/lib/notebookWidgetsFlags.js` (`WAVES`)
- Modify: `docs/feature_flags.json` (after the `NOTEBOOK_WIDGETS_W9_ENABLED` entry)
- Modify: `tests/test_notebook_flags.py` (pins)
- Test: `tests/test_notebook_flags.py`, `tests/test_notebook_flag_table_form.py`, `tests/test_notebook_flag_parse.py`, `app/src/pages/journal-2-0/lib/notebookWidgetsFlags.test.js`

**Interfaces:**
- Produces: `"NOTEBOOK_WIDGETS_W10_ENABLED": False,  # enablement — unset means OFF (notebook widgets, wave 10)`; `notebook_widgets_w10_enabled: false, // notebook widgets, wave 10 — absent ⇒ OFF`; `WAVES = Object.freeze([1, 2, 3, 4, 5, 6, 8, 9, 10])`; `widgetsWaveOn(10)`; server `notebook_widgets_wave_on(10)` (generic reader, no change).
- The ledger entry: `member_facing: {label: "Formulas, options and notes widgets, ready-made widgets", where: "Notebook"}`, `status: "dark"`, `where: ["web"]`, a note naming this plan, "read per request through notebook_widgets_wave_on(10)", "with the flag off a placed widget keeps its snapshot and says \"Not available right now.\" on See it now, and every stored widget, revision and placement is kept", the arm line `railway variables --service web --set NOTEBOOK_WIDGETS_W10_ENABLED=1` (the owner's) and the rollback `=0` (never a delete; a delete does not restart the process).
- ⚠️ Deviation from spec §13, on purpose: the seven dedicated kinds' `KIND_WAVE` rows land in Task 10.14 with their client rows and builders (the 8.13 precedent; the KIND_TITLE rail compares both sides), and wave 10 has no slot family, so `_slot_wave_off` is unchanged (wave 11 owns slots).

- [ ] **Step 1: Write the failing tests.** Add `notebook_widgets_w10_enabled` to the pinned list. In `notebookWidgetsFlags.test.js`: `widgetsWaveOn(10)` is false unlatched and true once latched; `widgetsWaveOn(7)` and `widgetsWaveOn(11)` are always false.
- [ ] **Step 2:** Run `python -m pytest tests/test_notebook_flags.py tests/test_notebook_flag_table_form.py tests/test_notebook_flag_parse.py -q` and `cd app && npx vitest run src/pages/journal-2-0/lib/notebookWidgetsFlags.test.js`. Expected: FAIL.
- [ ] **Step 3:** Add the four rows in one change.
- [ ] **Step 4:** Run both commands. Expected: PASS.
- [ ] **Step 5:** Bytes (two eager files): `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`.
- [ ] **Step 6:** Commit: `feat(notebook): dark release flag for notebook widgets wave 10`.

### Task 10.2: The widget formula dialect (server) and the shared vectors

**Files:**
- Create: `api/services/journal_two/widget_formula.py` (pure: stdlib only, no I/O, no clock)
- Create: `tests/fixtures/widgetFormulaVectors.json`
- Test: `tests/test_widget_formula.py`, `tests/test_widget_formula_vectors.py`, `tests/test_widget_formula_hostile.py`

**Interfaces:**
- Limits: `MAX_LENGTH = 2000`, `MAX_TOKENS = 500`, `MAX_DEPTH = 32`, `MAX_FORMULAS = 5`, `NAME_MAX = 60`, `MAX_TEXT = 200`, `BUCKET_EDGES_MAX = 10`, `ROUND_DIGITS_MAX = 6`, `CHECK_EVERY = 256`.
- Grammar (lowest to highest precedence): comparison (`=`, `<>`, `<`, `<=`, `>`, `>=`; non-associative) → additive (`+`, `-`) → multiplicative (`*`, `/`) → unary `-` → primary. Primary: a number (`12`, `0.5`; no exponent, no leading `.`, at most 15 significant digits), a text in double quotes (`""` is a quote; at most 200 characters; no newline), `TRUE` / `FALSE` (case-insensitive), a field `[name]` (any characters except `[`, `]` and newline, trimmed, at most 60), a call `Name(arg, …)`, or `( expr )`. Whitespace (space, tab, newline) between tokens only. Any other character is refused.
- Types: `number`, `text`, `bool`, `day` (a `YYYY-MM-DD` string, from a `day` field only). A formula's result must be `number`, `text` or `bool`.
- The 15 functions (`FUNCTIONS`, in this order; names match ASCII case-insensitively and canonicalize to this spelling; dispatch is the static dict `_FN`):

| Function | Arguments | Result | Kind | Notes |
|---|---|---|---|---|
| `If` | bool, T, T (exactly 3) | T | row | null condition counts as false; both answers the same type (null allowed) |
| `And` | 2-8 bool | bool | row | null counts as false |
| `Or` | 2-8 bool | bool | row | null counts as false |
| `Not` | 1 bool | bool | row | null stays null |
| `Abs` | 1 number | number | row | |
| `Round` | number, optional whole-number literal 0-6 | number | row | half away from zero: `sign(x) * floor(abs(x) * 10^d + 0.5) / 10^d`, identical in both twins |
| `Min` | 2-8 number | number | row | nulls skipped; all null gives null |
| `Max` | 2-8 number | number | row | nulls skipped; all null gives null |
| `CountIf` | 1 bool | number | aggregate | rows where the condition is true |
| `SumIf` | number, optional bool | number | aggregate | sum of non-null values on matching rows; none gives null |
| `AvgIf` | number, optional bool | number | aggregate | average of non-null values on matching rows; none gives null |
| `Share` | 1 bool | number | aggregate | true rows / all rows in the group (0..1); no rows gives null |
| `Bucket` | number, then 1-10 number literals strictly rising | text | row | lower edge inclusive, upper exclusive; labels `"Under <e1>"`, `"<e1> to <e2>"`, `"<ek> or more"`; numbers printed without exponent, integers without decimals, else at most 4 decimals trimmed, negatives with `-` |
| `Hour` | 1 day field | number | row | the row's ET hour from the field's `hour_key` (0-23), null when the row has none |
| `Weekday` | 1 day | text | row | `"Monday"` … `"Sunday"` from the date parts (no time zone) |

- Operators: `+ - * /` take numbers (null in, null out; `x / 0` is null); `=` and `<>` take two numbers, two texts (ASCII case-insensitive), two bools, or a day and a day or a `"YYYY-MM-DD"` text; `< <= > >=` take two numbers or two days; a null on either side gives null. Every non-finite intermediate is null.
- A formula is **aggregate** when it contains `CountIf`, `SumIf`, `AvgIf` or `Share`; then every field reference must sit inside one of them, aggregates never nest, and the result must be a number. Otherwise it is **row**.
- Produces:
  - `@dataclass(frozen=True) class FieldInfo: key: str; label: str; type: Literal["number","text","bool","day","tag"]; hour_key: str | None = None; needs_times: bool = False`.
  - `class FormulaError(PlanError)` (`.code`, `.sentence`, `.pos`: the 0-based character offset, `.formula_id`: set by the plan validator, default None). Subclassing `plan.PlanError` keeps every router's existing `except PlanError` correct.
  - `@dataclass(frozen=True) class Compiled: canonical: str; kind: Literal["row","aggregate"]; type: Literal["number","text","bool"]; fields: tuple[str, ...]; needs_times: bool; bucket_labels: tuple[str, ...] | None; ast: Any` (`bucket_labels`: when the whole formula is one `Bucket`, its labels in order, for natural split order).
  - `compile_formula(expr: str, fields: Mapping[str, FieldInfo]) -> Compiled` (raises `FormulaError`; catches `RecursionError` as `too_deep`, a backstop only: the depth counter refuses first).
  - `display(canonical: str, fields: Mapping[str, FieldInfo]) -> str` (keys to labels; an unknown key stays as written).
  - `eval_row(c: Compiled, row: Mapping) -> float | str | bool | None`.
  - `eval_group(c: Compiled, rows: Sequence[Mapping], *, check: Callable[[], None] | None = None) -> float | None` (calls `check()` every `CHECK_EVERY` rows).
  - `empty_field_of(c: Compiled, row: Mapping) -> str | None`: the first referenced field key whose value is None on that row.
  - `skip_notice(n: int, label: str | None, unit_one: str, unit_many: str) -> str | None`: None for `n == 0`; `"[Risk $] is empty on 4 trades; those are skipped"` (singular `"on 1 trade"`); with no single empty field, `"This formula has no value on 4 trades; those are skipped"`.
  - `FUNCTION_DOCS: tuple[dict, ...]`: `{name, usage, meaning}` per function, exactly: `If(condition, then, otherwise)` "One value when the condition holds, another when it doesn't."; `And(condition, condition, …)` "Yes when every condition holds."; `Or(condition, condition, …)` "Yes when any condition holds."; `Not(condition)` "The opposite of a condition."; `Abs(number)` "The number without its sign."; `Round(number, places)` "Rounded to 0 to 6 decimal places (0 when left out)."; `Min(number, number, …)` "The smallest of the values; empty values are skipped."; `Max(number, number, …)` "The largest of the values; empty values are skipped."; `CountIf(condition)` "How many rows meet the condition."; `SumIf(value, condition)` "The value added up over the rows that meet the condition, or over all rows."; `AvgIf(value, condition)` "The average of the value over the rows that meet the condition, or over all rows."; `Share(condition)` "The share of rows that meet the condition, from 0 to 1."; `Bucket(number, edge, …)` "Puts a number into ranges: under the first edge, between edges, or the last edge or more."; `Hour(day)` "The ET hour, 0 to 23; empty for trades with dates only."; `Weekday(day)` "The weekday of a day, Monday to Sunday.".
- Error codes and sentences (exact; `{x}` is filled from the member's own text, clipped to 20 characters):
  - `empty` "Type a formula." · `too_long` "A formula can be at most 2,000 characters." · `too_many_parts` "This formula has too many parts. Split it into two fields." · `too_deep` "This formula is nested too deeply."
  - `bad_char` "{x} can't be used in a formula." · `unclosed_field` "A [ is missing its ]." · `unclosed_paren` "A ( is missing its )." · `extra_paren` "There is a ) without its (." · `unclosed_text` "A quote is missing its closing \"." · `text_too_long` "Text in a formula can be at most 200 characters." · `bad_number` "{x} isn't a number a formula can use." · `unexpected` "Something is missing near \"{x}\"." · `trailing` "There is something extra at the end: \"{x}\"."
  - `unknown_field` "[{x}] isn't a field here." · `tag_field` "[{label}] holds several values; use it as a filter instead." · `unknown_function` "{x} isn't a function. Try If, Round or SumIf." · `arg_count` "{Fn} takes {n}." with `n` from `ARITY_WORDS`: If "3 values", And/Or/Min/Max "2 to 8 values", Round "1 or 2 values", SumIf/AvgIf "a value and an optional condition", Bucket "a value and 1 to 10 edges", the rest "1 value".
  - `needs_number` "{what} needs a number." · `needs_condition` "{what} needs a yes/no condition." · `needs_day` "{Fn} needs a day." (`what` is the function name or the operator, `+`) · `mixed_types` "Both answers of If need the same kind of value." · `compare_types` "These two sides can't be compared." · `bad_result` "A formula must give a number, text or yes/no."
  - `nested_aggregate` "CountIf, SumIf, AvgIf and Share can't contain each other." · `field_outside_aggregate` "[{label}] needs to be inside CountIf, SumIf, AvgIf or Share when the formula adds up rows." · `aggregate_number` "A formula that adds up rows must give a number." · `bucket_edges` "Bucket's edges must be numbers, rising from left to right." · `round_digits` "Round's second value must be a whole number from 0 to 6." · `hour_no_time` "Hour needs a time; [{label}] has none here."
- The vector file (`tests/fixtures/widgetFormulaVectors.json`, version 1, LF, read by BOTH twins with a file read, never imported into a bundle): `fields` (a closed-trades-like table: `day` with `hour_key: "hour_et"`, `net`, `risk_dollars`, `r`, `setup`, `side`, `had_stop`, `mistake` (tag), `hold_minutes` (needs_times)); `compile` (≥ 40: expr, kind, type, canonical, display); `eval_row` (≥ 50: expr, row, expect; floats compared at 1e-9; `null` expected where null); `eval_group` (≥ 25); `errors` (≥ 1 per code: expr, code, sentence, pos); `limits` (length 2,000 passes and 2,001 fails; depth 32 passes and 33 fails; 500 tokens pass and 501 fail); `hostile` (≥ 40 strings: quotes, `--`, `;`, `$.`, `%`, `_`, backslashes, `\u0000`, RTL marks, fullwidth brackets, `__proto__`, `constructor`, `toString`, 10,000 `(`, a 1 MB string). Every function and every operator appears in at least two vectors.

- [ ] **Step 1: Write the failing tests:**
  - `tests/test_widget_formula_vectors.py`: `test_compile_vectors`, `test_eval_row_vectors`, `test_eval_group_vectors`, `test_error_vectors_code_sentence_pos`, `test_limit_vectors`, `test_every_function_and_operator_has_two_vectors` (non-vacuity: counts appearances).
  - `tests/test_widget_formula.py`: `test_canonical_uses_keys_and_title_case` (`[Net P&L]/[risk $]` → `[net]/[risk_dollars]`; `sumif(` → `SumIf(`), `test_display_round_trip`, `test_key_wins_over_label`, `test_divide_by_zero_is_null_not_inf`, `test_round_half_away_from_zero` (`Round(2.5)` 3, `Round(-2.5)` -3, `Round(1.005, 2)` same as the vector), `test_bucket_labels_and_edges`, `test_hour_reads_hour_key_and_refuses_without_one`, `test_weekday_no_timezone`, `test_aggregate_rules` (field outside, nesting, non-number result), `test_share_of_no_rows_is_null`, `test_sumif_none_matching_is_null`, `test_check_called_every_256_rows` (a counting `check` over 1,000 rows is called 3 times), `test_skip_notice_exact` (`"[Risk $] is empty on 4 trades; those are skipped"`, `"… on 1 trade; …"`, None for 0), `test_function_docs_exact_and_fifteen`.
  - `tests/test_widget_formula_hostile.py`: `test_hostile_strings_raise_only_formula_error` (every hostile vector compiles or raises `FormulaError`, never another class, never `RecursionError`, each under 50 ms), `test_random_token_soup_2000` (seeded generator over the token alphabet), `test_proto_and_constructor_are_unknown_fields`, `test_no_dynamic_execution` (an AST walk of `widget_formula.py`: no call named `eval`, `exec`, `compile`, `__import__`, `getattr`, `setattr`, `globals`, `locals`; no `importlib`; non-vacuity control: the same walk finds `eval` in a planted snippet).
- [ ] **Step 2:** Run `python -m pytest tests/test_widget_formula.py tests/test_widget_formula_vectors.py tests/test_widget_formula_hostile.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement. Commit the vector file FIRST in its own commit (`test(notebook): shared widget formula vectors`) so Task 10.3 can start, then the module.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): the widget formula dialect, its own tokenizer, parser and shared vectors`.

### Task 10.3: The widget formula dialect (client twin)

**Files:**
- Create: `app/src/pages/journal-2-0/lib/widgetFormula/widgetFormula.js` (pure; imported only by the lazy builder)
- Test: `lib/widgetFormula/widgetFormula.vectors.test.js`, `lib/widgetFormula/widgetFormula.noEval.test.js`, `lib/widgetFormula/widgetFormula.lazy.test.js`

**Interfaces:**
- Consumes: Task 10.2's vector file at `tests/fixtures/widgetFormulaVectors.json`, read with `fs.readFileSync(new URL('../../../../../../tests/fixtures/widgetFormulaVectors.json', import.meta.url))` (the test only; the module never reads it).
- Produces, the same contract as the server: `LIMITS` (the Task 10.2 numbers), `FUNCTIONS`, `FUNCTION_DOCS`, `ERRORS` (code → sentence template), `compileFormula(expr, fields) -> {ok: true, compiled} | {ok: false, code, sentence, pos}` (never throws), `displayFormula(canonical, fields)`, `evalRow(compiled, row)`, `evalGroup(compiled, rows)`, `skipNotice(n, label, one, many)`, and `suggest(expr, caret, fields) -> [{insert, label, kind: 'field'|'function'}]` for autocomplete (fields by label, functions by name, at most 12, prefix match first then contains).
- `fields` is a `Map` (key → `{key, label, type, hourKey, needsTimes}`); rows are read with `Object.hasOwn`; nothing indexes a plain object by member text, so `__proto__` is an unknown field.

- [ ] **Step 1: Write the failing tests:**
  - `widgetFormula.vectors.test.js`: `compile_vectors`, `eval_row_vectors`, `eval_group_vectors`, `error_vectors_code_sentence_pos`, `limit_vectors`, `hostile_vectors_never_throw` (each returns `{ok:false}` or compiles, under 50 ms).
  - `widgetFormula.noEval.test.js` (the `formulaEngine.noEval.test.js` pattern): the source contains no `eval(`, `new Function`, `Function(`, `setTimeout(` with a string, `import(`, `__proto__` assignment, or `[`-indexing of a plain object by a parsed name; a planted control string trips the same scan.
  - `widgetFormula.lazy.test.js`: no eager file imports `lib/widgetFormula` (a static scan over the first-open entry files' import graph, the `reachable.test.js` approach, with a control importer that trips it).
  - `suggest_ranks_prefix_then_contains_and_caps_at_12`.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/lib/widgetFormula`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): the widget formula client twin, agreeing with the server on every vector`.

### Task 10.4: Plan format 3 and the wave's shared rows

**Files:**
- Modify: `api/services/journal_two/widget_engine/plan.py`
- Modify: `api/services/journal_two/widget_engine/sources.py` (ONLY: `Field.hour_key`, the `hour_key="hour_et"` on the closed-trades `day` field, and `formula_fields(source) -> dict[str, FieldInfo]`)
- Modify: `api/services/journal_two/widget_engine/payload.py` (ONLY the three tables `S_EMPTY`, `_CAP_ROWS`, `_CAP_UNIT`)
- Modify: `api/services/journal_two/widget_engine/run.py` (ONLY `NO_SAMPLE_SOURCES` and the stamp table rows for the two sources)
- Test: `tests/test_widget_plan.py`, `tests/test_widget_plan_v3.py` (new), `tests/test_widget_engine_fuzz.py`, `tests/test_widget_shelf.py`

**Interfaces:**
- Consumes: Task 10.2 (`compile_formula`, `FieldInfo`, `FormulaError`, `MAX_FORMULAS`, `NAME_MAX`).
- Produces in `plan.py`:
  - `PLAN_VERSION = 3`; `SOURCES` gains `"options_strategies"`, `"notes"`; `WAVE10_SOURCES = frozenset({"options_strategies", "notes"})`; `FORMULA_FORMATS = ("number", "money", "percent", "r")`; `ROW_AGGS = ("sum", "avg", "min", "max")`; `BOOL_AGGS = ("count", "share")`; `GOAL_TOKENS = {"today": "daily", "this_week": "weekly", "this_month": "monthly", "ytd": "yearly"}`; `STOP_AFTER_MAX = 20`; `QUADRANTS = ("excursion",)`; `PROP_MEASURES = frozenset({"property_sum"})`.
  - `_TOP_KEYS` gains `"formulas"`. A formula entry is exactly `{"id": "f1".."f5", "name": str, "expr": str, "format": one of FORMULA_FORMATS}` (format default `"number"`); ids unique; names unique ASCII case-insensitively and different from every field label of the source. `expr` is compiled against `sources.formula_fields(source)` and STORED CANONICAL (W10-R2). A `FormulaError` gets `.formula_id`.
  - Measure entries: `{"key": k}` (as before), `{"key": "property_sum", "prop": "<uuid4>"}` (notes only), `{"formula": "f1"}` (an aggregate formula), `{"formula": "f1", "agg": a}` (a row formula: number with `ROW_AGGS`, bool with `BOOL_AGGS`; text refused).
  - Filters: `field` may be `"formula:<id>"` for a row formula (ops by its type: number `OPS_NUMBER`, text `("in", "not_in")`, bool `("is",)`); field `"property"` takes a required `"prop": "<uuid4>"` and may appear more than once. Split `by`/`then` may be `"formula:<id>"` for a row text or bool formula.
  - Display keys written ONLY when set: `cumulative: true` (view `line`; every measure of kind `sum`), `targetGoal: true` (view `progress`; range token in `GOAL_TOKENS`; one measure `net_pnl`; source `closed_trades` or `trading_days`; not with `target`), `stopAfter: int 1..20` (a measure `current_streak`), `quadrants: "excursion"` (view `scatter`).
  - Sentences (exact): `S_TOO_MANY_FORMULAS = "Use up to 5 formula fields."`, `S_FORMULA_NAME = "Give the field a name."`, `S_FORMULA_NAME_LONG = "A field name can be at most 60 characters."`, `S_FORMULA_NAME_TAKEN = "That name is already used."`, `S_FORMULA_UNKNOWN = "That formula field isn't in this widget."`, `S_FORMULA_FORMAT = "That format isn't available."`, `S_FORMULA_AGG = "Pick how to add up this field: total, average, lowest or highest."`, `S_FORMULA_BOOL_AGG = "Pick how to count this field: how many, or what share."`, `S_FORMULA_TEXT_MEASURE = "A text field can split a widget but can't be measured."`, `S_FORMULA_AGG_SPLIT = "A field that adds up rows can't split or filter a widget."`, `S_FORMULA_SPLIT_NUMBER = "Use Bucket to split by a number."`, `S_PROP_REQUIRED = "Pick a property for this filter."`, `S_PROP_MEASURE = "Pick a number property to add up."`, `S_CUMULATIVE = "A running total works on a line of totals, like Net P&L or Total R."`, `S_GOAL_RANGE = "A goal target needs today, this week, this month or year to date."`, `S_GOAL_MEASURE = "A goal target works with Net P&L."`, `S_GOAL_AND_TARGET = "Pick a number target or your goal, not both."`, `S_STOP_AFTER = "Stop after works with the current streak."`, `S_STOP_AFTER_RANGE = "Stop after must be 1 to 20 losses."`, `S_QUADRANTS = "Quadrant labels need a scatter plot."`. The two new sources refuse `last_*_trades` (`S_UNKNOWN_RANGE`).
  - `needed_version(plan)` per Global Constraints; `uses_wave10(plan: Any) -> bool` (total); `formula_of(plan, fid) -> dict | None`.
  - `summary()` names formula measures by their names with the aggregation in words ("Exit efficiency (average)") and adds `"incl. options"` nowhere new.
- Produces in `sources.py`: `Field.hour_key: str | None = None`; `formula_fields(source) -> dict[str, FieldInfo]` (every filterable field; `tag` fields typed `tag` so the dialect refuses them by name).
- Produces in `payload.py`: `S_EMPTY["options_strategies"] = "No options strategies in this range."`, `S_EMPTY["notes"] = "No notes match."`; `_CAP_ROWS` 5,000 for both; `_CAP_UNIT` `"strategies"`, `"notes"`.
- Produces in `run.py`: `NO_SAMPLE_SOURCES = wplan.TOOL_SOURCES | wplan.WAVE10_SOURCES` (W10-R6); stamp rows: `options_strategies` reads `_STRATEGIES_STAMP` and `_ACCOUNTS_STAMP`; `notes` reads `SELECT COUNT(*), MAX(updated_at) FROM j2_notes WHERE user_id = ?`, the folders count, the note-kinds count and the property definitions' `COUNT(*), MAX(updated_at)`.
- ⛔ The sources themselves are Tasks 10.6 and 10.7: until then the catalog does not list the two sources, so `validate_plan` refuses them with `S_UNKNOWN_SOURCE` (the existing `source not in catalog.sources` check).

- [ ] **Step 1: Write the failing tests** (`tests/test_widget_plan_v3.py`):
  - `test_wave8_and_wave9_plans_validate_byte_identical`: every r1 shelf plan and every plan fixture in `tests/test_widget_plan.py` and `tests/test_widget_tool_sources.py` validates to the same `json.dumps(..., sort_keys=True)` as a frozen copy taken in Step 1 (`tests/fixtures/widget_plans_w9.json`).
  - `test_needed_version_three_only_for_wave10_features` (each of the seven features alone gives 3; tools alone 2; neither 1; `cumulative: false` is refused as an unknown value, never written).
  - `test_v3_plan_too_new_for_a_v2_server` (`PLAN_VERSION` monkeypatched to 2 raises `PlanTooNew`).
  - `test_formula_stored_canonical` and `test_formula_error_carries_id_and_pos`.
  - `test_formula_measure_shapes` (aggregate without `agg`; row number with each of `sum avg min max`; bool with `count share`; text refused with `S_FORMULA_TEXT_MEASURE`; aggregate in a filter or split refused with `S_FORMULA_AGG_SPLIT`; number split refused with `S_FORMULA_SPLIT_NUMBER`).
  - `test_formula_names_unique_and_not_a_field_label`, `test_six_formulas_refused`.
  - `test_property_filter_needs_prop_and_may_repeat`, `test_property_sum_needs_prop`.
  - `test_display_options_rules` (one case per sentence above).
  - `test_new_sources_refuse_last_n_trades`.
  - `test_uses_wave10_total` (any value gets an answer).
  - `test_no_label_equals_another_fields_key` (every source in the catalog; non-vacuity control with a planted pair).
  - `tests/test_widget_engine_fuzz.py`: the corpus gains formula names and expressions with the planted strings; the compiled SQL text contains none of them.
- [ ] **Step 2:** Run `python -m pytest tests/test_widget_plan.py tests/test_widget_plan_v3.py tests/test_widget_engine_fuzz.py tests/test_widget_shelf.py tests/test_widget_tool_sources.py tests/test_widget_run.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS (wave 8 and 9 tests unchanged and green).
- [ ] **Step 5:** Commit: `feat(notebook): widget plan format 3 for formulas, two new sources and display options`.

### Task 10.5: Formula evaluation and the display options in the engine

**Files:**
- Modify: `api/services/journal_two/widget_engine/aggregate.py`
- Modify: `api/services/journal_two/widget_engine/payload.py`
- Modify: `api/services/journal_two/widget_engine/run.py` (the budget `check`, the goal target read)
- Modify: `api/services/journal_two/measures.py` (one new public function, `drawdown_span`)
- Test: `tests/test_widget_formula_engine.py` (new), `tests/test_widget_run.py`, `tests/test_built_widget_payload.py`, `tests/test_widget_engine_isolation.py`, `tests/test_widget_latency.py`

**Interfaces:**
- Consumes: Task 10.2, Task 10.4.
- Produces in `aggregate.py`:
  - `evaluate(rows, plan, catalog, *, check: Callable[[], None] | None = None) -> Result`. Each row formula is compiled once per evaluation and written to `row["formula:<id>"]` for every scanned row before filtering (calling `check()` every 256 rows). Formula filters and splits use a synthetic `Field` (`formula_field(f, compiled)`: `sql=None`, its type's ops, `split=True` for text and bool, `bucket=compiled.bucket_labels`, bool `fmt` `"Yes"`/`"No"`, `missing="no value for this field"`).
  - `measure_of(plan, catalog, m) -> Measure-like` is the ONE lookup the cells, the coverage loop and the payload use. A formula measure is `FormulaMeasure(key="formula:<id>", label=<name>, unit=<source unit>, kind, min_n=DEFAULT_MIN_N, needs=(the formula's field keys), fmt)`: kind `sum` for `agg` sum, `extreme` for min/max, `average` for avg, `count` for count, `rate` for share; an aggregate formula is `count` when it is exactly one `CountIf`, `sum` when exactly one `SumIf`, else `average` (the small-sample rule applies). `have` counts rows where the formula has a value.
  - Skip notices: for each row formula with skipped rows among the counted rows, `widget_formula.skip_notice(...)` joins the footnotes. A formula that reads a `needs_times` field carries the hold-minutes notices exactly as the field does (`S_HOLD_MINUTES_NO_TIMES`, `S_HOLD_MINUTES_SOME`).
- Produces in `payload.py`:
  - `FORMULA_FMT = {"number": "number", "money": "money", "percent": "pct", "r": "r"}` onto the existing `MEASURE_FMT` vocabulary; formula measure rows `{key: "formula:<id>", label, unit, kind, fmt}`.
  - `display.cumulative`: each Line series row's `v1..v3` become running totals in day order computed BEFORE any trim, the day's own amounts move to `d1..d3`, and `dd1` is `v1` minus its running peak (peak floor 0). The public allowlist is unchanged (W10-R7), so a shared curve still draws its line.
  - Max drawdown span: when a measure is `max_drawdown` and the view is `number` or `compare`, `drawdown: {peak, trough, recovered}` (ISO days or None) from `measures.drawdown_span(rows)`; sentences `S_DD_SPAN = "From {peak} to {trough}; recovered {recovered}."`, `S_DD_OPEN = "From {peak} to {trough}; not recovered yet."`, `S_DD_NONE = "No drawdown in this range."` (days as `Mar 4`).
  - `display.targetGoal`: `target` is the goal, `targetLabel` `"Daily goal"` / `"Weekly goal"` / `"Monthly goal"` / `"Yearly goal"`; with no account holding that goal, `target: None` and `notice` `"Set a weekly goal in your account settings to see progress."` (the period word follows the token); over all accounts the target is the sum of the set goals and `S_GOAL_SOME = "{n} {accounts} {have} no weekly goal and {are} not in the target."` joins the footnotes.
  - `display.stopAfter` with `current_streak`: `stop: {after, losses}` and the line, exactly: a current loss streak `k` under `N`: `"{k} of your {N} losses in a row"`; `k >= N`: `"{k} of your {N} losses in a row. Your rule says stop here."`; a win streak or none: `"No losses in a row."` (never `"0 of your"`).
  - `display.quadrants` is echoed as `quadrants: "excursion"`.
  - Preview lane only: `probe: [{id, first, skipped, notice}]` per formula (the newest counted row's value; the registry's params schema does not declare `probe`, so it can never be stored in a note).
- Produces in `run.py`: a run-scoped `Budget(seconds=DEADLINE_S)` started at admission; `check()` raises `EngineTooLong` past it; passed into `aggregate.evaluate`. `_goal_target(conn, user_id, account_id | None, period) -> tuple[float | None, int]` reads `j2_accounts.goals` with `user_id = ?` (a foreign account id is "all my accounts", the existing rule).
- Produces in `measures.py`: `@dataclass(frozen=True) class DrawdownSpan: peak: str | None; trough: str | None; recovered: str | None`; `drawdown_span(rows) -> DrawdownSpan` over the same `_daily` curve `_max_drawdown` walks (no second curve).

- [ ] **Step 1: Write the failing tests** (`tests/test_widget_formula_engine.py`, seeded sqlite):
  - `test_row_formula_avg_matches_hand_sum`, `test_aggregate_formula_per_group`, `test_bool_formula_share_and_count`.
  - `test_formula_split_by_bucket_in_edge_order`, `test_formula_filter_python_only_sql_unchanged` (the compiled SQL text is identical with and without the formula filter).
  - `test_skip_notice_names_the_empty_field` (`"[Risk $] is empty on 4 trades; those are skipped"`).
  - `test_formula_reading_hold_minutes_carries_the_dates_only_sentence`.
  - `test_divide_by_zero_renders_no_data_never_inf` (payload JSON parses with `allow_nan=False`).
  - `test_small_sample_rule_on_average_formula` (4 rows hide, 19 rows badge).
  - `test_budget_check_raises_too_long_inside_the_python_loop` (a `check` that trips at row 300 maps to `TOO_LONG`, nothing cached).
  - `test_cumulative_series_running_total_before_trim` (the last point equals the plan's total `net_pnl`; a trimmed series keeps true totals).
  - `test_drawdown_span_recovered_open_none` and `test_drawdown_span_depth_equals_max_drawdown` (parity over 200 random books).
  - `test_goal_target_sum_and_missing_sentences`, `test_goal_target_foreign_account_reads_all`.
  - `test_stop_after_lines_exact_never_zero`.
  - `test_probe_only_on_preview_lane`.
  - In `tests/test_widget_engine_isolation.py`: two members with the same formula plan hash never share a cache entry; a member B goal is never read for A.
  - In `tests/test_widget_latency.py`: the 50,000-trade fixture with 5 formulas of 30 tokens each: a full run under 1.5 s and formula evaluation under 300 ms (median of 5).
- [ ] **Step 2:** Run `python -m pytest tests/test_widget_formula_engine.py tests/test_widget_run.py tests/test_built_widget_payload.py tests/test_widget_engine_isolation.py tests/test_widget_latency.py tests/test_widget_sources.py tests/test_widget_drill.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): formulas, running totals, drawdown dates, goal targets and stop-after in widget results`.

### Task 10.6: The Options strategies source

**Files:**
- Modify: `api/services/journal_two/widget_engine/sources.py` (`OPTION_FIELDS`, `scan_options`, `OPTIONS`, `SOURCES`)
- Modify: `api/services/journal_two/widget_engine/compile.py` (`OPTION_COLUMNS`, the day pre-filter)
- Modify: `api/services/journal_two/widget_engine/measures.py` (the adapter: `STRATEGY_MEASURES`, widened sources, `measure_input`)
- Modify: `api/services/journal_two/widget_engine/drill.py` (`_SHAPE`, `_OWN_TABLE`)
- Test: `tests/test_widget_options_source.py` (new), `tests/test_widget_engine_isolation.py`, `tests/test_widget_engine_fuzz.py`, `tests/test_widget_drill.py`

**Interfaces:**
- Consumes: `timeutil.compute_trading_day_et`, `filters._DAY` facts, `owned_account_id`, `_account_names`, `_in_chunks`; the shared `measures.MEASURES` (read, never copied).
- Produces:
  - `OPTION_FIELDS`: `day` ("Day", day, split; the ET day the strategy closed, `trading_day_et` else `compute_trading_day_et(closed_at)`; an open strategy's entry ET day), `weekday`, `month`, `underlying` ("Underlying", text, ci, split), `strategy` ("Strategy", enum `strategy_type`, split), `direction` ("Direction", enum, split, bucket `("bullish", "bearish", "neutral")`, fmt `"Bullish"`/`"Bearish"`/`"Neutral"`), `status` ("Status", enum, split, bucket `("open", "closed", "expired", "assigned", "rolled")`, fmt title case), `dte_entry` ("Days to expiry at entry", number: the earliest leg `expiration` minus the entry ET day, in calendar days; None without legs), `net` ("Net P&L", number, `pnl_dollar`, already net; None while open), `r` ("R", number, `r_multiple`), `result` ("Result", enum, the closed-trades labels and bucket), `setup` ("Setup", enum, none_label "No setup"), `account` ("Account", enum, `label_from="account_name"`, none_label "No account").
  - SQL: `SELECT … FROM j2_option_strategies o WHERE o.user_id = ? AND <account> AND <sql filters> AND <day pre-filter> ORDER BY COALESCE(o.trading_day_et, substr(o.closed_at, 1, 10), substr(o.entry_date, 1, 10)) DESC, o.id DESC LIMIT 5001`; the pre-filter widens the range by one day each side and Python decides the exact ET day (never a day from UTC). Legs: `SELECT strategy_id, MIN(expiration) FROM j2_option_legs WHERE strategy_id IN (…)` for the scanned ids only, in chunks of 500 (legs carry no `user_id`; the ids are already the member's).
  - `OPTIONS = Source("options_strategies", "Options strategies", "Every options strategy you have logged.", "strategies", OPTION_FIELDS, scan_options)`; rows carry `open: bool`.
  - Adapter: `STRATEGY_MEASURES = {"strategies": Measure("strategies", "Strategies", "results", "How many options strategies.", "strategies", "count", DEFAULT_MIN_N, (), {"options_strategies"}, …)}`; `OPTION_WIDENED = ("net_pnl", "wins", "losses", "win_rate", "avg_win", "avg_loss", "payoff", "profit_factor", "expectancy", "expectancy_r", "total_r", "best_trade", "worst_trade", "max_drawdown", "max_win_streak", "max_loss_streak", "current_streak")` gain `"options_strategies"` in `sources` through `dataclasses.replace` inside `builder_measures()`; `measure_input("options_strategies", rows)` drops `open` rows (W10-R6); the payload's unit noun reads "strategies" for this source ("Not enough strategies yet (3)").
  - Drill: `_SHAPE["options_strategies"] -> {day, label (underlying), label2 (strategy), net, r, result, strategyId}`; `_OWN_TABLE["options_strategies"] = "j2_option_strategies"`. The client opens it in the existing options drawer (R-30).
- ⚠️ Read the stored `result` values of `j2_option_strategies` before mapping; a value outside Win/Loss/BE is shown as stored and never counted as decisive.

- [ ] **Step 1: Write the failing tests** (`tests/test_widget_options_source.py`):
  - `test_options_rows_newest_first_and_capped_at_5000` (5,001 seeded: `capped`, notice "Based on your newest 5,000 strategies").
  - `test_closed_day_from_et_not_utc` (`closed_at` `2026-11-27T00:30:00Z` → `2026-11-26`).
  - `test_open_strategies_listed_not_measured`.
  - `test_dte_entry_from_earliest_leg` and `test_no_legs_no_dte`.
  - `test_measures_reuse_shared_functions` (`win_rate` and `profit_factor` equal `measures.MEASURES[k].fn` on the same rows; `profit_factor` shows `"5+"` above 5).
  - `test_options_net_matches_trading_days_options_part` (for a range: closed strategies' net equals the trading-days source's day net minus the equity part).
  - `test_split_by_strategy_direction_status_in_bucket_order`.
  - `test_never_sample` (0 trades, 3 strategies: real rows, `sample: False`).
  - `test_empty_sentence_exact`.
  - `tests/test_widget_engine_isolation.py`: member B's strategies and B's legs (including a leg row naming A's strategy id inserted by hand) never appear in A's rows, counts or `dte_entry`.
  - `tests/test_widget_drill.py`: `test_options_drill_rows_and_owned_ids`.
- [ ] **Step 2:** Run `python -m pytest tests/test_widget_options_source.py tests/test_widget_sources.py tests/test_widget_engine_isolation.py tests/test_widget_engine_fuzz.py tests/test_widget_drill.py tests/test_widget_plan_v3.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): options strategies as a widget source`.

### Task 10.7: The Notes source

**Files:**
- Modify: `api/services/journal_two/widget_engine/sources.py` (`NOTE_FIELDS`, `scan_notes`, `NOTES`, `SOURCES`)
- Modify: `api/services/journal_two/widget_engine/compile.py` (`NOTE_COLUMNS`)
- Modify: `api/services/journal_two/widget_engine/measures.py` (`NOTE_MEASURES`)
- Modify: `api/services/journal_two/widget_engine/drill.py` (`_SHAPE["notes"]`)
- Modify: `api/services/journal_two/db.py` (`_PHASE_2_ALTERS`: `CREATE INDEX IF NOT EXISTS idx_j2_notes_user_created ON j2_notes(user_id, created_at)`, only if `EXPLAIN QUERY PLAN` shows the scan does not already use an index)
- Test: `tests/test_widget_notes_source.py` (new), `tests/test_widget_engine_isolation.py`, `tests/test_widget_drill.py`, `tests/test_sample_never_feeds_real_numbers.py`

**Interfaces:**
- Consumes: `note_properties.property_filter_sql(user_id, conds, conn, strict=False)` (the one property filter authority; map this plan's ops onto its `_VALID_OPS`, reading them first), `note_properties.get_property_def`, `sample_marker.not_sample_sql("n")`.
- Produces:
  - `NOTE_FIELDS`: `created` ("Created", day, split, `hour_key="created_hour"`; the ET date of `created_at`), `updated` ("Updated", day, split, `hour_key="updated_hour"`), `weekday` (of `created`), `month` (of `created`), `folder` ("Folder", enum `folder_id`, split, `label_from="folder_name"` from `j2_note_folders WHERE user_id = ?`, none_label "No folder"), `tag` ("Tag", tag `tags`, split, none_label "No tags"), `ticker` ("Ticker", text, ci, split, none_label "No ticker"), `kind` ("Note kind", enum `kind_id`, split, `label_from="kind_name"` from `j2_note_kinds WHERE user_id = ?`, none_label "No kind"), `property` ("Property", filter only, `filterable=True`, `split=False`, needs `prop`).
  - SQL: `SELECT n.id, n.created_at, n.updated_at, n.folder_id, n.tags, n.ticker, n.kind_id, n.properties_json FROM j2_notes n WHERE n.user_id = ? AND n.deleted_at IS NULL AND <not sample> AND <account> AND <property filters> AND <created pre-filter ±1 day> ORDER BY n.created_at DESC, n.id DESC LIMIT 5001`. ⛔ No body, plain text or title column is selected for measuring (railed); the title is read only for drill rows and list labels.
  - A `prop` that is not one of the member's `user_set` properties (deleted or foreign, indistinguishable) drops that filter and adds the one notice `"That property isn't available; it is not used in this widget."` (W9-R18). The range applies to `created`.
  - `NOTES = Source("notes", "Notes", "Every note you have written.", "notes", NOTE_FIELDS, scan_notes, list_labels=("title", "created"))`; list rows emit `labelKind: "note"` (W10-R7).
  - `NOTE_MEASURES`: `notes` ("Notes", count, unit `notes`), `property_sum` ("Sum of a property", sum, unit `notes`, reads the `prop` number property from `properties_json` through the property module's value reader; a non-number or unavailable property gives `None` and the notice `"That property isn't a number you can add up."` or the unavailable notice).
  - Drill: `_SHAPE["notes"] -> {day (created), label (title, clipped 60), noteId}`; `_OWN_TABLE["notes"] = "j2_notes"`; a drilled row opens the note.
  - `tests/test_sample_never_feeds_real_numbers.py` `GUARDED`: `widget_engine/sources.py` joins `j2_notes` with `not_sample_sql` (one entry).

- [ ] **Step 1: Write the failing tests** (`tests/test_widget_notes_source.py`):
  - `test_trashed_and_sample_notes_excluded`.
  - `test_created_day_is_et` (`created_at` `2026-10-28T03:30:00Z` → `2026-10-27`).
  - `test_split_by_folder_kind_tag_ticker_with_none_labels`.
  - `test_property_filter_through_property_filter_sql` (equals the notes list endpoint's count for the same condition).
  - `test_foreign_property_is_one_notice_and_no_narrowing`.
  - `test_property_sum_and_non_number_notice`.
  - `test_no_body_column_selected` (trace callback: no statement selects `body_json` or `body_plain`).
  - `test_scan_uses_an_index` (`EXPLAIN QUERY PLAN` shows no `SCAN n`/`SCAN j2_notes` without an index).
  - `test_hour_of_created_through_formula` (`Hour([created])` gives the ET hour).
  - `test_list_rows_label_kind_note`.
  - `test_never_sample` and `test_empty_sentence_exact`.
  - Isolation: member B's notes, folders, kinds and property definitions never appear for A; A's filter naming B's property id is the unavailable notice.
- [ ] **Step 2:** Run `python -m pytest tests/test_widget_notes_source.py tests/test_widget_sources.py tests/test_widget_engine_isolation.py tests/test_widget_engine_fuzz.py tests/test_widget_drill.py tests/test_sample_never_feeds_real_numbers.py tests/test_widget_plan_v3.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): notes as a widget source, with note properties through the one filter authority`.

### Task 10.8: Shelf revision files, the hash rail and pinned shelf runs

**Files:**
- Create: `api/services/journal_two/widget_engine/shelf/` (23 files `<slug>.r1.json`, `MANIFEST.json`)
- Delete: `api/services/journal_two/widget_engine/shelf.json`
- Modify: `api/services/journal_two/widget_engine/shelf.py`
- Modify: `api/routers/notebook_widget_definitions.py` (`_resolve` and `GET /shelf` only)
- Create: `tests/fixtures/shelf_wave8.json` (a verbatim copy of the deleted `shelf.json`, history for the conversion rail)
- Test: `tests/test_widget_shelf.py`, `tests/test_widget_shelf_files.py` (new), `tests/test_widget_definitions_router.py`

**Interfaces:**
- A revision file is exactly `{"id": "shelf:<slug>", "rev": N, "name", "description", "keywords", "plan"}`; `MANIFEST.json` is `{"version": 1, "order": ["shelf:equity-curve", …], "files": [{"file": "<slug>.r<N>.json", "sha256": "<hex>"}]}`.
- Produces in `shelf.py`:
  - `SHELF_DIR`, `MANIFEST_PATH`, `ID_PREFIX = "shelf:"`, `class ShelfError(RuntimeError)`.
  - `canonical_hash(obj) -> str`: SHA-256 of `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")` (line endings cannot move it, W10-R5).
  - `load(dir=SHELF_DIR) -> None` at import: every manifest file exists and hashes to its entry; every file is listed; per id the revisions are contiguous from 1; file name, `id` and `rev` agree; every plan validates against `sources.CATALOG`; `order` lists every id once. A broken shelf fails the import (boot), never a member's card.
  - `examples(allowed: Callable[[dict], bool] = lambda p: True) -> list[dict]` (per id in order, the newest revision whose plan is allowed; an id with none is left out; each entry carries `rev` and `summary` from `plan.summary`); `example(id, allowed=…) -> dict | None`; `revision(id, rev: int) -> dict | None`; `latest_rev(id, allowed=…) -> int | None`.
- Router:
  - `_resolve`: a `shelf:` id runs `revision(id, defRev)` where `defRev` is an int ≥ 1, else revision 1 (a wave 8 placement, W10-R5); an unknown revision with a frozen `def` runs the frozen copy with `S_FROZEN`; without one, the newest allowed revision. It returns `latest_rev = shelf.latest_rev(id, allowed=<the current flags>)`, and the payload echoes `defId`, `defRev` (the revision run) and `latestRev`.
  - `GET /shelf` answers `{"examples": shelf.examples(allowed=<flags>)}` where `allowed(plan)` is `not (uses_tools(plan) and not w9) and not (uses_wave10(plan) and not w10)`.
- ⛔ No r1 plan changes: `test_r1_files_match_wave8_shelf` compares each r1's validated plan, name, description and keywords with `tests/fixtures/shelf_wave8.json`.

- [ ] **Step 1: Write the failing tests** (`tests/test_widget_shelf_files.py`):
  - `test_manifest_hashes_match_files`, `test_every_file_listed_and_every_entry_exists`, `test_revisions_contiguous_from_one`, `test_file_name_id_rev_agree`.
  - `test_canonical_hash_ignores_line_endings` (CRLF and LF copies hash the same).
  - `test_released_revisions_never_change`: reads `MANIFEST.json` from `git show origin/master:<path>` (falls back to the old `shelf.json` era: no manifest on master yet means the check is the conversion rail below); every released entry is present with the same hash. ⛔ It FAILS (never skips) when git or `origin/master` cannot be read, naming `git fetch origin master`.
  - `test_r1_files_match_wave8_shelf`.
  - `test_broken_file_fails_load` (a tmp dir with one edited byte raises `ShelfError` naming the file).
  - In `tests/test_widget_shelf.py`: `test_examples_newest_allowed_revision` (a planted rev 2 needing wave 10: with an `allowed` that refuses it, rev 1 is served).
  - In `tests/test_widget_definitions_router.py`: `test_shelf_run_pins_def_rev`, `test_shelf_run_without_def_rev_is_rev_one`, `test_shelf_payload_echoes_latest_rev`, `test_shelf_route_lists_rev_and_summary`.
- [ ] **Step 2:** Run `python -m pytest tests/test_widget_shelf.py tests/test_widget_shelf_files.py tests/test_widget_definitions_router.py tests/test_widget_sample_book.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement (convert with a one-off script run from the scratchpad directory, never committed; commit the files it wrote).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): ready-made widgets as immutable revision files with a hash rail`.

### Task 10.9: Router: the wave 10 gate, the formula catalog and the vocabulary

**Files:**
- Modify: `api/routers/notebook_widget_definitions.py`
- Test: `tests/test_widget_definitions_router.py`, `tests/test_widget_definitions_w10_router.py` (new)

**Interfaces:**
- Consumes: Tasks 10.2-10.8.
- Produces:
  - `W10_WAVE = 10`; `_w10_on()`; `_gate_w10(plan)` raising `public.not_found()` when `plan.uses_wave10(plan)` and wave 10 is off, applied exactly where `_gate_tools` is (run, preview, drill, create, save; revision restore per W9-R16; rename-only `PUT` passes). The examples batch drops a card whose newest allowed revision is absent.
  - `_engine_errors`: `except FormulaError as e` BEFORE `except PlanError`: 400 `{"code": "formula", "message": e.sentence, "formulaId": e.formula_id, "pos": e.pos}`.
  - Vocabulary while wave 10 is on: the two sources with their fields (each field row gains `hourKey` when set, `prop: true` for `property`), `functions: widget_formula.FUNCTION_DOCS`, `formulaLimits: {length: 2000, tokens: 500, depth: 32, count: 5, name: 60}`, `formats: ["number", "money", "percent", "r"]`, `displayOptions: ["cumulative", "targetGoal", "stopAfter", "quadrants"]`; `VOCAB_FIELDS` gains `underlying`, `strategy` (the member's values), `folder`, `kind` (`{id, name}`), `note_tag`, `ticker`, and `property` (`{id, name, type}` of the member's `user_set` properties). While off, none of these appear (railed).

- [ ] **Step 1: Write the failing tests** (`tests/test_widget_definitions_w10_router.py`):
  - `test_wave10_plans_404_everywhere_when_off` (a formula plan, an options plan, a notes plan, each display option: run, preview, drill, create, save, restore), `test_rename_only_put_allowed_when_off`.
  - `test_vocabulary_hides_wave10_when_off_and_lists_it_when_on`.
  - `test_formula_error_code_formula_with_id_and_pos`.
  - `test_property_vocabulary_owned_only`.
  - `test_every_wave10_response_no_store` (200 and error responses).
  - `test_examples_skip_wave10_cards_when_off`.
- [ ] **Step 2:** Run `python -m pytest tests/test_widget_definitions_w10_router.py tests/test_widget_definitions_router.py tests/test_widget_definitions.py tests/test_user_definitions_auth.py -q`. Expected: FAIL (plus the known `PER_ROUTER` screener red, read by name).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS except the known red.
- [ ] **Step 5:** Commit: `feat(notebook): wave 10 gate, formula catalog and vocabulary on the widget routes`.

### Task 10.10: Dedicated builders I: tilt check, revenge clean days, risk left today, prop-firm rules

**Files:**
- Create: `api/services/journal_two/shelf_discipline.py`
- Modify: `api/services/journal_two/revenge_detect.py` (one line: `timed_instant = _timed_instant`, a public name, no behaviour change)
- Test: `tests/test_shelf_discipline.py`, `tests/test_shelf_discipline_isolation.py`

**Interfaces:**
- Consumes (public functions only, W9-R15): `revenge_detect.detect`, `revenge_detect.timed_instant`, `timeutil.compute_trading_day_et`, `trading_days` (`sessions`, `session_on_or_before`, `today_et`), `session_calendar.close_time`, `measures.MEASURES` (`win_rate`, `expectancy` functions, reused), `accounts.own_account_size`, `portfolio_heat.portfolio_heat` (open risk per account, the phase 1 positions authority), `widget_engine.sources.scan` with an internal validated trading-days plan (day net incl. options, the one authority), `routine_insights.money` (money words), `run.deadline` and the budget `check`, `notebook_widgets._num`, `_iso_utc`.
- Shell: each builder is `(user_id: str, params: dict, now: datetime) -> dict` with `asOf`, `source` (`"broker"` / `"manual"` / `"mixed"`), unknown values `None`, rows at most 40, `"A comparison, not proof."` where a comparison is shown. Shared: `CAVEAT = "A comparison, not proof."`, `S_NOT_ENOUGH = "Not enough trades yet ({n})"`, small-sample badge under 20.
- `my_tilt_check` (kind `myTiltCheck`, title "Tilt check"): params `from`, `to` (`YYYY-MM-DD`, default the last 90 days ET). `TILT_WINDOW_MIN = 30`. Timed equity trades (flagged excluded, `entry_estimated` excluded) and timed closed options strategies; a trade is "after a loss" when its entry falls within 30 minutes after the exit of any losing trade or strategy (any symbol), across midnight too. Output `after: {n, winRate, avg, net}`, `other: {…}`, `datesOnly: n`; lines `"Within 30 min after a loss: 12 trades, 33% win rate, −$45 average."`, `"Other trades: 88 trades, 52% win rate, +$30 average."`, the caveat, and `"{n} trades with dates only are not counted."`. With no timed trades: `"Tilt check needs entry and exit times; your trades have dates only."`; with no trades at all: `"No closed trades in this range."`.
- `my_revenge_clean_days` (kind `myRevengeClean`, title "Revenge trades"): no params. `WINDOW = 30` finished sessions (today counts once past `close_time(today)`). Per session: no trades → clean; timed trades and no `revenge_detect.detect` flag (with the member's dismissed pairs, read the way `analytics._psychology_section` reads them) → clean; a flag → not clean; only date-only trades → not checked (W10-R12). Output `clean`, `checked`, `notChecked`, `flagged: [{day, symbol, minutesApart}]` (≤ 40, newest first). Line `"27 of 30 clean"` with `"(2 days with dates only were not checked)"` when any; no trades in the window: `"No trades in the last 30 trading days."`; `clean == 0`: `"Revenge re-entries on every checked day in the last 30 trading days."` (never "0 of").
- `my_risk_left_today` (kind `myRiskLeftToday`, title "Risk left today"): no params. Per account with `daily_loss_limit_pct` and an own size (`limit = pct / 100 × own_account_size`): `net` today ET (equity net after fees plus closed strategies, W9-R22), `left = limit − max(0, −net)` (W10-R9), `openRisk` from `portfolio_heat` for that account (placeholder stops excluded and counted), `afterStops = left − openRisk`. Lines per account `"Room left today: $300 of $500."`, `"Open risk to stops: $250."`, `"If every stop is hit: $50 left."` or `"If every stop is hit: $120 past your limit."`, `"Past your daily loss limit by $80."`, `"2 positions have no stop set and are not in the open risk."`. No account with a limit: `"Set a daily loss limit in your account settings to see room left."`; a limit with no own size: `"Set your account size to turn your daily loss limit into dollars."`. Account names are shown in the app (an account kind; never public).
- `my_prop_firm` (kind `myPropFirm`, title "Prop-firm rules"): params `dailyLoss` (dollars, `0 < v <= 1e7`), `maxDrawdown` (dollars, same bounds), `since` (`YYYY-MM-DD`, default the first session of the current month), `accountId` (one owned account; foreign or unknown reads as all accounts with the existing notice). Day nets come from the trading-days source scan from `since` to today (at most 3,700 sessions; older `since` clips with `"Counting from <Mon D, YYYY>, the oldest day this widget reads."`). Daily: `left = dailyLoss − max(0, −today net)`. Trailing: `peak = max(0, running max of cumulative net)`, `drawdown = peak − current`, `left = maxDrawdown − drawdown` (W10-R9). Lines `"Daily loss: $320 of $1,000 used; $680 left."` (a green or flat day: `"Daily loss: none used today; $1,000 left."`), `"Max drawdown: $1,450 below your peak; $1,050 left."` (at the peak: `"Max drawdown: at your peak; $2,500 left."`), breaches `"Past your daily loss limit by $X."` and `"Past your max drawdown by $X."`. Missing limits: `"Enter your daily loss limit and max drawdown to see room left."` (each half shown when its own limit is set). No trades since `since`: `"No trades since Oct 1."`. Profit target, minimum days and consistency rules are not in wave 10 (§17 UX I4).
- `PARAMS = {"myTiltCheck": ("from", "to"), "myRevengeClean": (), "myRiskLeftToday": (), "myPropFirm": ("dailyLoss", "maxDrawdown", "since", "accountId")}` and `clean_params(kind, raw) -> dict` raising `ParamError` sentences `"Dates need to look like 2026-10-24."`, `"Enter an amount above $0."`, `"An amount can be at most $10,000,000."`.
- Every loop over trades or sessions calls `check()` every 256 rows; reads are `LIMIT 5001` on indexed orders.

- [ ] **Step 1: Write the failing tests** (`tests/test_shelf_discipline.py`, seeded sqlite, `now=` injected):
  - Tilt: `test_reentry_within_30_min_after_loss_counted` (15:58 ET loss exit, 16:20 ET entry), `test_win_rate_and_average_reuse_shared_measures`, `test_dates_only_excluded_and_counted`, `test_options_losses_trigger_the_window`, `test_no_timed_trades_sentence`, `test_small_group_not_enough_never_zero`.
  - Revenge: `test_window_is_30_finished_sessions_across_thanksgiving` (today 2026-11-30 before the close), `test_today_counts_after_close`, `test_dates_only_day_not_checked_and_stated`, `test_dismissed_pair_is_clean`, `test_line_exact_and_never_zero_of`, `test_no_trades_sentence`.
  - Risk left: `test_room_left_arithmetic_green_day_adds_no_room`, `test_includes_closed_options_today`, `test_half_day_after_close_still_today` (2026-11-27, 13:30 ET), `test_open_risk_from_portfolio_heat_placeholder_counted`, `test_no_limit_and_no_size_sentences`.
  - Prop-firm: `test_trailing_drawdown_from_running_peak`, `test_daily_room_and_breach_lines`, `test_missing_limits_sentence_each_half`, `test_since_clipped_to_horizon`, `test_clean_params_refusals_exact`, `test_foreign_account_reads_all_with_notice`.
  - Every builder: `test_payload_has_as_of_source_and_no_zero_strings` (a brand-new member: no `"$0"`, `" 0 "`, `"0%"`, `"0 of"` in any string).
  - `test_budget_check_called_in_loops` (a counting `check`).
  - `tests/test_shelf_discipline_isolation.py`: member B's trades, strategies, accounts, limits and dismissed pairs never change A's answers; B's account id in A's prop-firm params reads as all of A's accounts.
- [ ] **Step 2:** Run `python -m pytest tests/test_shelf_discipline.py tests/test_shelf_discipline_isolation.py tests/test_revenge_detect.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): tilt check, revenge clean days, risk left today and prop-firm rules builders`.

### Task 10.11: Dedicated builders II: plan vs actual, pre-market game plan, alerts that fired

**Files:**
- Create: `api/services/journal_two/shelf_compose.py`
- Test: `tests/test_shelf_compose.py`, `tests/test_shelf_compose_isolation.py`

**Interfaces:**
- Consumes (public only): `plan_grading.get_link(conn, user_id, trade_ref)`, `plan_grading.grade_checks(plan, trade, mfe_price=…)`, `trade_refs.trade_ref_for_row`, `placeholder_stop.is_placeholder_stop`, `trader_blocks.prep_part(user_id, part, now=…, memo=…)` (parts `"wire"`, `"earnings"`; held-only, never a vendor fetch), `portfolio_heat.portfolio_heat`, `alert_fired_log.list_fires(user_id, limit)`, `alert_taxonomy.receipts.list_fires_for_feed(user_id, limit)`, `trading_days.session_on_or_before`, `session_calendar.close_time`.
- `my_plan_vs_actual` (kind `myPlanVsActual`, title "Plan vs actual", one trade): params `tradeId` (an owned closed trade id; anything else gives `"Not available."`). Rows: Entry (planned, filled, slippage $ and %, side-aware: a long filled above plan is worse), Stop (planned, actual; a placeholder stop reads `"No stop set"`, never 0), Target (planned, exit), R (planned R `|target − entry| / |entry − stop|`, realized R the trade's effective R). Every number comes from `grade_checks` where it computes one; the builder only lays them out. No link: `"This trade isn't linked to a plan. Link one from the trade's page."`; a plan without a stop or target leaves that row's planned value None with `"Not in the plan"`.
- `my_game_plan` (kind `myGamePlan`, title "Pre-market game plan"): no params. Three independent parts, each failing alone with its own sentence: `wire` (`headline`, `regime`, `exposure`, `wireDate` from `prep_part("wire")`; not published: `"The morning wire has not published yet today."`), `reporting` (my names reporting today from `prep_part("earnings")`, at most 10, `"None of your names report today."` when the read answered and is empty, `"Earnings dates couldn't be read right now."` when it did not), `risk` (`openPositions`, `openRisk` from `portfolio_heat` over all accounts, `noStop` count; none open: `"No open positions."`).
- `my_alerts_fired` (kind `myAlertsFired`, title "Alerts that fired"): no params. `since` = the close of the previous finished session (`close_time(session_on_or_before(today − 1))`, so the Monday after Good Friday reads from Thursday's close). Reads both logs with `limit=50` (W10-R10), keeps rows with `fired_at >= since`, newest first, at most 40 `{at, symbol, what, kind}` (`what` is the log's own plain text; a row without one reads `"Alert fired"`). Empty: `"No alerts fired since the last session."`. A log that cannot be read adds `"Some alerts couldn't be read right now."` and shows the other.
- `PARAMS` and `clean_params` for the three kinds, the Task 10.10 shape.

- [ ] **Step 1: Write the failing tests** (`tests/test_shelf_compose.py`):
  - Plan vs actual: `test_rows_from_grade_checks_side_aware_slippage`, `test_placeholder_stop_reads_no_stop_set`, `test_unlinked_trade_sentence`, `test_foreign_trade_not_available`, `test_missing_target_not_in_the_plan`.
  - Game plan: `test_three_parts_fail_alone` (each part raising leaves the other two), `test_no_vendor_fetch` (a spy on `morning_wire_engine.fetch_breadth` sees no call), `test_reporting_empty_vs_unread_sentences`, `test_no_open_positions_sentence`.
  - Alerts: `test_since_previous_session_close_after_good_friday` (today 2027-03-29 reads from 2027-03-25's close), `test_merges_both_logs_newest_first_cap_40`, `test_never_reads_user_alerts` (a trace on the alerts db sees no `user_alerts` statement; a control query proves the trace works), `test_one_log_unreadable_shows_the_other`, `test_empty_sentence`.
  - Every builder: no zero strings for a brand-new member.
  - `tests/test_shelf_compose_isolation.py`: member B's plan links, trades, positions and fires never reach A.
- [ ] **Step 2:** Run `python -m pytest tests/test_shelf_compose.py tests/test_shelf_compose_isolation.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): plan vs actual, pre-market game plan and alerts-that-fired builders`.

### Task 10.12: The dedicated route, the public rows and one door

**Files:**
- Create: `api/services/journal_two/shelf_kinds.py`
- Create: `api/routers/notebook_shelf_widgets.py`
- Modify: `api/main.py` (one `include_router` line beside the widget-definitions router)
- Modify: `api/routers/notebook_widgets.py` (the GET refuses `shelf_kinds.KINDS`, beside the `BUILT_KIND` refusal)
- Modify: `api/services/journal_two/public_note_payload.py` (vendor rows; `ACCOUNT_LINE_BLOCKS` gains `sizeCalc`; the `labelKind: "note"` relabel)
- Test: `tests/test_shelf_widgets_router.py`, `tests/test_public_note_payload.py`, `tests/test_user_definitions_auth.py`

**Interfaces:**
- Produces in `shelf_kinds.py`: `KINDS = ("myTiltCheck", "myRevengeClean", "myPlanVsActual", "myRiskLeftToday", "myPropFirm", "myGamePlan", "myAlertsFired")`; `BUILDERS` (kind → the Task 10.10 / 10.11 function); `PARAMS` (merged from both modules); `TITLES` (exactly the titles above); `SOURCE_DETAIL` (`"Your closed trades in the Journal."` for tilt, revenge, plan vs actual; `"Your accounts, trades and open positions in the Journal."` for risk left and prop-firm; `"The morning wire, the earnings calendar and your open positions."` for game plan; `"Your alert history."` for alerts); `class ParamError(ToolError)` (400 `invalid`); `clean_params(kind, raw)`.
- Router `api/routers/notebook_shelf_widgets.py`: prefix `/api/j2/notebook-shelf-widgets`; `POST /{kind}` with body `{params: {}}` at most 8 KB (`8 * 1024`); order: wave 10 gate and `kind in KINDS` (else `public.not_found()`, one 404 for both), paid (`"Ready-made widgets require a paid plan"`), rate `public.enforce_rate("60/minute", "notebook-widgets", f"member:{uid}", <the phase 1 sentence>)` (the shared phase 1 budget, as builder runs), `clean_params`, then `notebook_widgets.build(kind, uid, params)` inline on the request thread (no second pool). `ToolError` → its status and code; `WidgetRequestError` → 400; 200 `Cache-Control: no-store`.
- Phase 1 GET: `if kind == widgets.BUILT_KIND or kind in shelf_kinds.KINDS: raise public.not_found()` (W10-R1).
- Public: `("widgetEmbed", k): "private"` for the seven kinds and `sizeCalc`; `sizeCalc` joins `ACCOUNT_LINE_BLOCKS`; the seven are in `ACCOUNT_KINDS` (lands in Task 10.14, so here `test_every_registered_widget_has_a_vendor_row` stays green ahead of the registry rows); a built widget row with `labelKind == "note"` is relabelled `"Note <n>"` in order, the R-25 code path.
- ⛔ Until Task 10.14 the kinds have no `KIND_WAVE` or `_BUILDERS` rows: this task's route tests install them with `monkeypatch.setitem(notebook_widgets.KIND_WAVE, k, 10)` and `monkeypatch.setitem(notebook_widgets._BUILDERS, k, shelf_kinds.BUILDERS[k])`; Task 10.14 deletes those two lines from the tests.

- [ ] **Step 1: Write the failing tests** (`tests/test_shelf_widgets_router.py`):
  - `test_dark_and_unknown_kind_are_one_404`, `test_paid_sentence_own`, `test_rate_shares_the_widgets_budget` (61st request in a minute across GET phase 1 and this POST answers 429).
  - `test_params_cleaned_per_kind_and_refusals_400` (`ParamError` status from the class, W9-R14).
  - `test_body_over_8kb_refused`.
  - `test_phase1_get_refuses_dedicated_kinds` (and still serves `myPnlStats`).
  - `test_prop_firm_limits_never_in_query_string` (the client contract: the route ignores query params; a GET with them is the 404).
  - `test_no_store_on_every_response`.
  - In `tests/test_public_note_payload.py`: `test_dedicated_kinds_and_size_calc_account_line_in_every_public_mode` (share false and true), `test_notes_list_rows_relabelled_note_n`, `test_no_db_read_on_public_render` (spy `get_connection`).
- [ ] **Step 2:** Run `python -m pytest tests/test_shelf_widgets_router.py tests/test_public_note_payload.py tests/test_user_definitions_auth.py tests/test_shelf_discipline.py tests/test_shelf_compose.py -q`. Expected: FAIL (plus the known `PER_ROUTER` red).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS except the known red.
- [ ] **Step 5:** Commit: `feat(notebook): one POST door for the ready-made dedicated widgets, private on public pages`.

### Task 10.13: Shelf revisions and the new shelf entries

**Files:**
- Create: `widget_engine/shelf/equity-curve.r2.json`, `r-equity-curve.r2.json`, `pnl-by-hold-time.r2.json`, `exit-quality.r2.json`, `fees-drag.r2.json`, `loss-streak.r2.json`, `mae-vs-mfe.r1.json`, `process-vs-results.r1.json`, `goals-progress.r1.json`
- Modify: `widget_engine/shelf/MANIFEST.json` (append only)
- Modify: `api/routers/notebook_widget_definitions.py` (`GET /shelf` adds `dedicated`)
- Test: `tests/test_widget_shelf.py`, `tests/test_widget_shelf_files.py`, `tests/test_widget_sample_book.py`

**Interfaces:**
- Revisions (plans exactly; display titles as named; keywords keep r1's and add the synonyms):
  - `shelf:equity-curve` r2: r1 plus `display.cumulative: true` (§8 #1: cumulative line, drawdown shaded).
  - `shelf:r-equity-curve` r2: r1 plus `display.cumulative: true` (§8 #3; coverage reads "R known on N of M trades").
  - `shelf:pnl-by-hold-time` r2: formula `{"id": "f1", "name": "Hold minutes", "expr": "Bucket([hold_minutes], 5, 15, 60, 240, 1440)", "format": "number"}`, split `formula:f1`, measure `net_pnl`, view bar (W10-R11).
  - `shelf:exit-quality` r2: formulas `f1` "Exit efficiency" `[exit_efficiency]` avg (format per the stored scale: `percent` when stored as a fraction, read the field first), `f2` "MFE to MAE" `[mfe_r] / Abs([mae_r])` avg (`number`), `f3` "Missed R" `[mfe_r] - [r]` avg (`r`); no split; view number.
  - `shelf:fees-drag` r2: measures `fees`, `gross_pnl`, formula `f1` "Fees as % of gross" `SumIf([fees]) / Abs(SumIf([gross]))` (`percent`).
  - `shelf:loss-streak` r2: r1 plus `display.stopAfter: 3` (§8 #25, "2 of your 3").
  - `shelf:mae-vs-mfe` r1 "MAE vs MFE": scatter, measures `f1` "MAE" `Abs([mae_r])` avg (`r`) and `f2` "MFE" `[mfe_r]` avg (`r`), `display.quadrants: "excursion"`, description "Each trade's worst and best move against your stop."
  - `shelf:process-vs-results` r1 "Process vs results": split by `f1` "Plan followed" `Bucket([adherence_pct], 50, 80)`, measures `net_pnl`, `expectancy`, `trades`, view table, description "Your results by how closely you followed your plan."
  - `shelf:goals-progress` r1 "Goals progress": measure `net_pnl`, range `this_week`, view progress, `display.targetGoal: true`, description "This week's net P&L against your weekly goal."
  - `MANIFEST.order` places the three new ids after their neighbours in §8 order (MAE vs MFE after R vs P&L scatter, Process vs results after Month in review, Goals progress after Fees drag).
- Synonyms (§8, railed on the newest revision): win rate `hit rate`, `batting average`, `win %`; profit factor `PF`; expectancy `edge`, `EV`, `avg R`; max drawdown `DD`, `drawdown`; weekly scorecard `report card`, `review`.
- `GET /shelf` while wave 10 is on adds `dedicated: [{kind, name, description, keywords}]` for the seven kinds, in §8 order, with descriptions exactly: Tilt check "Trades soon after a loss compared with the rest."; Revenge trades "Clean days in the last 30 trading days."; Plan vs actual "One trade's plan against its fills."; Risk left today "Your daily loss limit against today's P&L and open risk."; Prop-firm rules "Room left under your daily loss and max drawdown limits."; Pre-market game plan "The wire's read, your names reporting today and your open risk."; Alerts that fired "Your alerts since the last session."

- [ ] **Step 1: Write the failing tests:**
  - `test_new_revisions_validate_and_need_wave10` (each r2 and new r1 has `needed_version == 3`).
  - `test_every_shelf_revision_renders_on_the_sample_book_without_a_hidden_column` (the R-24 rail extended to every revision).
  - `test_cumulative_equity_curve_ends_at_total_net` (sample book).
  - `test_hold_minutes_revision_says_dates_only_on_a_dates_only_book`.
  - `test_mae_vs_mfe_points_are_trades`, `test_goals_progress_without_goal_sentence`.
  - `test_synonyms_present_on_newest_revision`.
  - `test_manifest_append_only_and_hashes` (the Task 10.8 rails, now over 32 files).
  - `test_shelf_dedicated_list_only_when_wave10_on`.
- [ ] **Step 2:** Run `python -m pytest tests/test_widget_shelf.py tests/test_widget_shelf_files.py tests/test_widget_sample_book.py tests/test_widget_definitions_w10_router.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): shelf revisions with running totals, minutes, formulas and stop-after, and three new ready-made widgets`.

**Merge point.** After 10.12 and 10.13: merge `feat/notebook-widgets-p2-be` into `feat/notebook-widgets-p2`; run every backend suite named in Task 10.23 Step 1; push.

### Task 10.14: The dedicated kinds, registered on both sides, and their client refresh

**Files:**
- Modify: `api/services/journal_two/notebook_widgets.py` (`KIND_WAVE`, `KIND_TITLE`, `ACCOUNT_KINDS`, `_BUILDERS`, `_JOURNAL_DETAIL` rows, additive)
- Modify: `app/src/pages/journal-2-0/lib/notebookWidgets.js` (`WIDGET_KINDS` rows)
- Modify: `app/src/widgets/registry.js` (seven `snapshotManifest` rows after `builtWidget`)
- Modify: `app/src/pages/journal-2-0/components/notebook/widgets/SnapshotFrame.jsx` (the refresh branch for `kind.dedicated`; `CHANGE_FIELDS` rows `dailyLoss`, `maxDrawdown`, `since`; `changeKeysOf('myPropFirm')`)
- Create: `app/src/pages/journal-2-0/lib/dedicatedWidgets.js` (lazy, statically imported only by the lazy SnapshotFrame chunk)
- Modify: `tests/test_shelf_widgets_router.py` (drop the two `monkeypatch.setitem` lines)
- Create: `tests/test_phase1_kind_rows.py`
- Test: `tests/test_journal_styles_compose.py`, `tests/test_public_note_payload.py`, `tests/test_phase1_kind_rows.py`, `src/widgets/registry.test.js`, `lib/dedicatedWidgets.test.js`, `components/notebook/widgets/SnapshotFrame.test.jsx`

**Interfaces:**
- Server rows: `KIND_WAVE[k] = 10`, `KIND_TITLE[k] = shelf_kinds.TITLES[k]`, the seven in `ACCOUNT_KINDS`, `_BUILDERS[k] = shelf_kinds.BUILDERS[k]`, `source_detail` reads `shelf_kinds.SOURCE_DETAIL[k]`.
- `WIDGET_KINDS` rows, exactly: `{ id: 'myTiltCheck', wave: 10, group: 'review', title: 'Tilt check', account: true, dedicated: 1, description: 'Trades soon after a loss vs the rest', keywords: ['tilt', 'revenge', 'after a loss', 'discipline'] }`; `myRevengeClean` "Revenge trades" ("Clean days in the last 30 trading days", `['revenge', 'clean days', 'discipline']`); `myPlanVsActual` "Plan vs actual" (`pick: 1`, "One trade's plan against its fills", `['plan', 'slippage', 'execution']`); `myRiskLeftToday` "Risk left today" ("Daily loss limit, today's P&L and open risk", `['risk', 'daily loss', 'limit', 'room']`); `myPropFirm` "Prop-firm rules" ("Room left under your challenge limits", `['prop', 'funded', 'challenge', 'drawdown']`); `myGamePlan` "Pre-market game plan" ("The wire, names reporting and open risk", `['game plan', 'premarket', 'morning']`); `myAlertsFired` "Alerts that fired" ("Your alerts since the last session", `['alerts', 'fired', 'triggers']`).
- Registry params: `myTiltCheck` `from`, `to` (string); `myPlanVsActual` `tradeId` (string); `myPropFirm` `dailyLoss`, `maxDrawdown` (number), `since`, `accountId` (string); the others none beyond the snapshot common keys.
- `dedicatedWidgets.js`: `SHELF_WIDGETS_URL = '/api/j2/notebook-shelf-widgets'`, `isDedicated(kind)`, `runDedicated(kind, params) -> {ok, data} | {ok: false, code, message}` (POST, `FETCH_TIMEOUT_MS`, codes as `builtWidgets.failureText` reads them), `dedicatedRefreshParams(old, payload)` (the payload plus the member's own settings and `share`, the `builtRefreshParams` rule; never drops a setting key).
- `CHANGE_FIELDS` rows: `dailyLoss` ("Daily loss limit ($)", number), `maxDrawdown` ("Max drawdown ($)", number), `since` ("Challenge started", date). `changeKeysOf('myPropFirm')` returns `['dailyLoss', 'maxDrawdown', 'since', 'accountId']`; `changeKeysOf('myTiltCheck')` returns the phase 1 range keys.
- `tests/test_phase1_kind_rows.py` `test_phase1_kind_rows_unchanged`: the 15 phase 1 kinds' rows in `KIND_WAVE`, `KIND_TITLE`, `ACCOUNT_KINDS`, `_BUILDERS` (function identity by qualified name), `WIDGET_KINDS` (parsed from the client file) and `MARKET_DATA_VENDORS` equal a frozen snapshot taken in Step 1; `SETTING_KEYS` is exactly `("symbol", "list", "from", "to", "month", "definitionId", "tradeId")`.
- Bytes: `notebookWidgets.js` and `registry.js` are eager (seven rows each).

- [ ] **Step 1: Write the failing tests:** `test_phase1_kind_rows_unchanged`; `tests/test_journal_styles_compose.py` stays green with the seven kinds on both sides (KIND_TITLE agreement); `registry.test.js` `dedicated_rows_are_snapshot_kinds_with_declared_params`; `dedicatedWidgets.test.js` `run_posts_body_never_query`, `refresh_keeps_settings_and_share`, `dark_404_is_unavailable`; `SnapshotFrame.test.jsx` `prop_firm_change_fields_and_post_refresh`, `phase1_kind_still_refreshes_through_get`.
- [ ] **Step 2:** Run `python -m pytest tests/test_phase1_kind_rows.py tests/test_journal_styles_compose.py tests/test_public_note_payload.py tests/test_shelf_widgets_router.py -q` and `cd app && npx vitest run src/widgets/registry.test.js src/pages/journal-2-0/lib/dedicatedWidgets.test.js src/pages/journal-2-0/components/notebook/widgets/SnapshotFrame.test.jsx src/pages/journal-2-0/lib/notebookSets`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both commands. Expected: PASS.
- [ ] **Step 5:** Bytes: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`; record the total in the commit message.
- [ ] **Step 6:** Commit: `feat(notebook): the seven ready-made dedicated widgets registered on both sides (dark)`.

### Task 10.15: The dedicated embeds

**Files:**
- Create: `app/src/pages/journal-2-0/components/notebook/widgets/{TiltCheck,RevengeClean,PlanVsActual,RiskLeftToday,PropFirm,GamePlan,AlertsFired}Embed.jsx` + one `DedicatedEmbeds.module.css`
- Modify: `app/src/pages/journal-2-0/components/notebook/widgets/snapshotEmbeds.js` (seven lazy-chunk rows)
- Test: `components/notebook/widgets/DedicatedEmbeds.test.jsx`, `src/styles/tapFloor.test.js`

**Interfaces:**
- Consumes: Tasks 10.10-10.12 payload shapes (mock until the merge), `SnapshotFrame`'s body props, the phase 1 empty and gap patterns (`MyPnlStatsEmbed.jsx` as the model), inline SVG only.
- Each embed renders the payload's own sentences verbatim (the server owns copy), its numbers through the phase 1 money and percent formatters, the caveat line where present, the small-sample badge, and a "Show as table" alternative for any chart (spec §5.11). Plan vs actual's rows are a table; Prop-firm and Risk left today draw one 44 px-tall bar per limit (used vs left, hatched past the limit, never colour alone); Tilt check draws two bars with values as labels; Revenge trades draws 30 session cells (clean, flagged with a pattern, not checked with a text label "Not checked").
- ⛔ No embed computes a number the payload does not carry. `snapshotEmbeds.js` is the lazy chunk (not first-open).

- [ ] **Step 1: Write the failing tests** (rendered text, never state): one `renders_payload_sentences_verbatim` per kind, `brand_new_member_no_zero_strings` per kind (no `"$0"`, `"0%"`, `"0 of"`), `past_limit_hatched_and_labelled`, `revenge_cells_have_text_labels`, `show_as_table_toggle_per_chart`, `plan_vs_actual_no_stop_set_row`, `game_plan_part_gap_alone`.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/widgets/DedicatedEmbeds.test.jsx src/styles/tapFloor.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): embeds for the seven ready-made dedicated widgets`.

### Task 10.16: The builder: your own fields (formulas)

**Files:**
- Create: `app/src/pages/journal-2-0/components/notebook/widgetBuilder/sections/FormulaSection.jsx` + `FormulaSection.module.css`, `widgetBuilder/formulaFields.js`
- Modify: `widgetBuilder/builderState.js` (`PLAN_VERSION = 3`; reducer actions `formula/add`, `formula/edit`, `formula/remove`), `widgetBuilder/sections/MeasureSection.jsx`, `sections/SplitSection.jsx`, `sections/WhichOnesSection.jsx`, `widgetBuilder/WidgetBuilderSheet.jsx` (the section's place)
- Test: `widgetBuilder/FormulaSection.test.jsx`, `widgetBuilder/builderState.test.js`, `widgetBuilder/WidgetBuilderSheet.test.jsx`, `src/styles/tapFloor.test.js`

**Interfaces:**
- Consumes: Task 10.3 (`compileFormula`, `displayFormula`, `suggest`, `FUNCTION_DOCS`, `LIMITS`), Task 10.9's catalog (`functions`, `formulaLimits`, `formats`, `hourKey`), Task 10.5's preview `probe`, the 400 code `formula` with `formulaId` and `pos`.
- `formulaFields.js`: `catalogFields(cat, plan) -> Map` (key → `{key, label, type, hourKey, needsTimes}`), `formulaMeasureOptions(plan, compiled)`, `formulaSplitFields(plan, compiled)`, `formulaFilterFields(plan, compiled)`; it groups with `Map`, never plain-object keys.
- `FormulaSection` ("Your own fields", collapsed by default under the measure picker with "Add your own field"; at most 5): each field has a Name input (60), a Formula box (labelled "Formula", `aria-describedby` its result line), Format select (Number, Money, Percent, R), and Remove ("Remove field: <name>"). The box shows label syntax (`displayFormula`) and saves canonical; autocomplete opens on `[` (fields) and on a letter (functions), arrow keys move, Enter or Tab inserts, Escape closes (one picker level, the builder rule). Under the box: the client twin's error sentence at once (no request), the server's `formula` error by `formulaId` and `pos` when it differs, and once valid the first-row line from `probe` ("First trade: 0.42") and its skip notice. A row formula offers "Add as a measure" (number: Total, Average, Lowest, Highest; yes/no: How many, What share), "Split by this" (text and yes/no), "Filter by this"; an aggregate formula offers "Add as a measure" only.
- Sentences: `"Use up to 5 of your own fields."` at the cap; every other sentence is the server's or the twin's.
- Undo/redo covers formula edits (one history entry per settled edit, 400 ms debounce, as the preview).

- [ ] **Step 1: Write the failing tests:** `add_field_shows_label_syntax_saves_canonical`, `autocomplete_fields_on_bracket_and_functions_on_letter`, `keyboard_path_arrow_enter_escape`, `twin_error_inline_without_a_request`, `server_formula_error_by_id_and_pos`, `probe_first_row_and_skip_notice`, `row_number_formula_offers_four_aggs`, `bool_formula_offers_count_and_share`, `aggregate_formula_no_split_offer`, `cap_five_sentence`, `undo_restores_formula`, `plan_version_three_only_when_used` (builderState writes no `formulas` key for a plan without one).
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/widgetBuilder src/styles/tapFloor.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): your own fields in the widget builder, with autocomplete and plain errors`.

### Task 10.17: The builder: Options strategies and Notes

**Files:**
- Modify: `widgetBuilder/sections/SourceSection.jsx`, `sections/WhichOnesSection.jsx`, `widgetBuilder/builderCatalog.js` (`VOCAB_FIELDS`, property chips), `components/notebook/widgets/builtViews/DrillPanel.jsx` (options rows open the options drawer; notes rows open the note)
- Test: `widgetBuilder/WidgetBuilderSheet.test.jsx`, `widgetBuilder/sources.test.jsx` (new), `builtViews/builtViews.test.jsx`

**Interfaces:**
- Consumes: Task 10.9's vocabulary, Task 10.6 and 10.7 shapes, Task 10.4 sentences.
- Tiles (radio group): "Options strategies: every options strategy you have logged", "Notes: every note you have written" (the server descriptions). Value pickers: Underlying and Strategy from the member's values; Folder and Note kind by name; Tag from note tags; Property: a two-step chip (pick a property by name, then a value picker typed by the property's type), several allowed; "Sum of a property" picks a number property. Empty states are the server's (§5.9). With wave 10 off neither tile appears (the catalog does not list them).
- Drill: options rows link through the existing options drawer handler (R-30); notes rows open `/journal-2-0/notebook/<noteId>` in the note editor's own navigation.

- [ ] **Step 1: Write the failing tests:** `two_new_tiles_only_when_catalog_lists_them`, `property_chip_two_steps_typed_values`, `several_property_filters`, `sum_of_property_picks_number_only`, `options_last_n_trades_disabled_with_reason`, `drill_options_row_opens_options_drawer`, `drill_note_row_opens_note`, `empty_sentences_from_server`.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/widgetBuilder src/pages/journal-2-0/components/notebook/widgets/builtViews`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): options strategies and notes in the widget builder`.

### Task 10.18: Built views: running totals, drawdown dates, goals, stop-after, quadrants, formula formats

**Files:**
- Modify: `components/notebook/widgets/builtViews/{LineView,NumberView,ProgressView,ScatterView,TableAlt}.jsx`, `builtViews/builtModel.js`, `builtViews/builtViews.module.css`
- Test: `builtViews/builtViews.test.jsx`, `src/styles/tapFloor.test.js`

**Interfaces:**
- Consumes: Task 10.5 payload keys (`d1..d3`, `dd1`, `drawdown`, `target`, `targetLabel`, `stop`, `quadrants`, formula `fmt`).
- LineView with `dd1`: the drawdown band is a hatched area under the running peak (pattern plus a text legend "Drawdown", never colour alone); the readout shows the running total and that day's amount ("+$2,140 total · +$310 that day"). NumberView with `drawdown`: one line under the value from the server's span sentence. ProgressView with `targetLabel`: "Weekly goal: $1,000" and the share; with `target: null`, the server notice in place of the bar. NumberView with `stop`: the server line. ScatterView with `quadrants: "excursion"`: 1R guides on both axes, captions "gave it back" (top left: MFE at least 1R, MAE under 1R) and "stopped too tight" (bottom right: MAE at least 1R, MFE under 1R), result shapes as wave 8. TableAlt carries every new key as columns. `builtModel.js` formats formula measures by `fmt` with the existing formatters (`pct` multiplies by 100). R-31 sizing rules hold.
- ⛔ A shared (public) render has none of these keys (W10-R7) and renders exactly the wave 8 view.

- [ ] **Step 1: Write the failing tests:** `line_drawdown_band_pattern_and_legend`, `line_readout_total_and_day`, `number_drawdown_span_sentence`, `progress_goal_label_and_missing_notice`, `stop_after_line`, `scatter_quadrant_captions_and_guides`, `table_alt_has_new_columns`, `formula_formats_money_pct_r`, `public_payload_without_keys_unchanged`.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/widgets/builtViews src/styles/tapFloor.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): running totals with drawdown, goal targets, stop-after and quadrants in widget views`.

### Task 10.19: "Updated version available" for ready-made widgets

**Files:**
- Modify: `components/notebook/widgets/BuiltWidgetEmbed.jsx` (`BuiltMenu`'s shelf branch), `builtViews/HowMadeSheet.jsx`, `lib/builtWidgets.js` (`loadShelf`)
- Test: `components/notebook/widgets/BuiltWidgetEmbed.test.jsx`, `lib/builtWidgets.test.js`

**Interfaces:**
- Consumes: Task 10.8 (`GET /shelf` entries with `rev` and `summary`; run payloads echo `defRev` and `latestRev`).
- `loadShelf() -> Promise<Map<id, {rev, name, summary, plan}>>` (one GET per tab, cached; `__resetBuiltCaches` clears it).
- For a `shelf:` placement: `placedRev = Number.isInteger(params.defRev) && params.defRev >= 1 ? params.defRev : 1` (W10-R5); when the shelf's `rev > placedRev`, the ⋯ menu shows `UPDATED_VERSION` ("Updated version available"); How this is made shows the current summary and the newer one side by side and "Use the updated version", which re-runs with `defRev: rev` and writes the result (and the new frozen `def`) through `builtRefreshParams` in ONE transaction; nothing changes until that click. "Edit a copy" stays. A GET failure reads "Couldn't check for updates." (the wave 8 copy). With wave 10 off the shelf answers only allowed revisions, so no update to a dark revision is ever offered.
- Inserting from the gallery stores `defRev` = the card's `rev` (Task 10.21 consumes this rule).

- [ ] **Step 1: Write the failing tests:** `shelf_placement_without_def_rev_is_rev_one`, `newer_rev_shows_control_and_side_by_side_summaries`, `apply_is_one_transaction_with_new_def`, `no_change_until_click` (open, close: zero `docChanged` transactions), `shelf_get_failure_sentence`, `same_rev_no_control`.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/widgets/BuiltWidgetEmbed.test.jsx src/pages/journal-2-0/lib/builtWidgets.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): updated-version control for ready-made widgets, applied only on click`.

### Task 10.20: The position size calculator

**Files:**
- Modify: `app/src/widgets/registry.js` (`sizeCalc` row after `positionSizing`)
- Modify: `components/notebook/blocks/BlockNodeView.jsx` (`BLOCK_COMPONENTS.sizeCalc`)
- Modify: `app/src/pages/journal-2-0/lib/journalBlocks.js` (`TOOL_BLOCK_LABELS.sizeCalc = 'Position size calculator'`)
- Modify: `app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx` (`traderItem('sizeCalc', …)`)
- Create: `components/notebook/blocks/SizeCalcBlock.jsx` + `SizeCalcBlock.module.css`, `lib/blocks/sizeCalc.js` (pure)
- Modify: `lib/blocks/blockDoors.test.js` (`IMPORT_ALLOW`: `lib/notebookWidgetsFlags` with its reason, "the calculator makes no request, so it learns the wave from the latched flag")
- Test: `blocks/SizeCalcBlock.test.jsx`, `lib/blocks/sizeCalc.test.js`, `src/widgets/registry.test.js`, `lib/blocks/blockDoors.test.js`, `SlashMenu.test.jsx`, `src/styles/tapFloor.test.js`, `tests/test_public_note_payload.py`

**Interfaces:**
- Registry: `sizeCalc: blockManifest('Position size calculator', [{key: 'symbol', type: 'string'}, {key: 'entry', type: 'number'}, {key: 'stop', type: 'number'}, {key: 'riskPct', type: 'number'}, {key: 'accountSize', type: 'number'}], '[position size calculator]')`.
- `sizeCalc.js`: `RISK_PCT_MAX = 10`; `sizeFor({entry, stop, riskPct, accountSize}) -> {ok: true, shares, riskDollars, positionValue, positionPct, side} | {ok: false, reason}`: `shares = floor(accountSize × riskPct / 100 / |entry − stop|)`, `side` long when stop < entry; reasons exactly `"Enter an entry and a stop."`, `"Entry and stop can't be the same."`, `"Enter the risk per trade, up to 10%."`, `"Set your account size, or enter one for this note."`, `"Your risk is smaller than one share at this stop."` (never `"0 shares"`).
- `SizeCalcBlock`: inputs Symbol, Entry, Stop, Risk per trade (%) (placeholder from the account's `maxRiskPerTradePct` when set, never written until the member types), and, when the account size is not the member's (IR-S9), "Account size for this note"; the result `"<n> shares of <SYMBOL>, $<risk> at risk (<pct>% of the account)."`, `"Position value: $<v> (<pct>% of the account)."`. Account size is read live through `usePositionSizingSources` (never stamped). Each input change is ONE `setParams` call (the `useBlockParams` door). Wave 10 off: `"Not available right now."` with no inputs. It is in the `/` menu as "Position size calculator" with keywords `['size', 'shares', 'risk', 'calculator', 'position']` and the command `/size`.
- Bytes: `registry.js`, `BlockNodeView.jsx`, `journalBlocks.js` and `SlashMenu.jsx` are eager; the body and `sizeCalc.js` are lazy.

- [ ] **Step 1: Write the failing tests:** `sizeCalc.test.js` (`floor_shares_long_and_short`, each reason exact, `under_one_share_sentence_never_zero`, `risk_pct_cap_10`); `SizeCalcBlock.test.jsx` (`placeholder_account_size_not_used`, `max_risk_per_trade_is_a_placeholder_only`, `one_set_params_per_change`, `flag_off_not_available`, `result_sentences_exact`, `keyboard_labels_and_44px`); `registry.test.js` `size_calc_block_row`; `SlashMenu.test.jsx` `size_calc_item_only_when_w10_on`; `tests/test_public_note_payload.py` `test_size_calc_account_line` (Task 10.12's row).
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/blocks/SizeCalcBlock.test.jsx src/pages/journal-2-0/lib/blocks src/widgets/registry.test.js src/pages/journal-2-0/components/notebook/SlashMenu src/styles/tapFloor.test.js` and `python -m pytest tests/test_public_note_payload.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both commands. Expected: PASS.
- [ ] **Step 5:** Bytes: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`.
- [ ] **Step 6:** Commit: `feat(notebook): position size calculator in / (dark)`.

### Task 10.21: The gallery and `/`: new ready-made cards, dedicated cards, defaults and synonyms

**Files:**
- Modify: `components/notebook/widgetBuilder/ExamplesGallery.jsx` (Task 8.16's), `components/notebook/SlashMenu.jsx`
- Test: `widgetBuilder/ExamplesGallery.test.jsx`, `SlashMenu.test.jsx`

**Interfaces:**
- Consumes: Task 10.13's `/shelf` (`examples` with `rev`, `dedicated`), Task 10.14's kinds, Task 10.19's insert rule.
- Gallery: shelf cards insert a `builtWidget` with `defId` and `defRev` = the card's `rev`; dedicated cards (static SVG previews, the card rule) insert their snapshot kind and open no builder ("How this is made" is not offered for them, §16.6's rule for non-definitions); Plan vs actual opens the trade pick first (the `tradeRecap` `pick` flow). Cards over Options or Notes never show "Sample data".
- `/` (spec §8): a bare `/` shows at most 8 built-in widgets: the most used, then the defaults Equity curve, Win rate, Daily P&L bars, Performance by setup (`mySetupEdge`), Max drawdown, Risk left today, Positions near stop (`myPositionsRisk`), Weekly scorecard; then "All widgets…". With wave 10 off, Risk left today is skipped and the list is unchanged item for item from wave 9's. Typing searches every card, ranking a name match above a keyword match; the synonyms come from the shelf keywords and the `WIDGET_KINDS` keywords. `/size` is a direct command.

- [ ] **Step 1: Write the failing tests:** `shelf_card_inserts_pinned_rev`, `dedicated_card_inserts_kind_without_builder`, `plan_vs_actual_opens_trade_pick`, `no_sample_ribbon_on_options_or_notes_cards`, `bare_slash_defaults_order_with_risk_left_today`, `bare_slash_unchanged_when_w10_off` (the Task 8.18 snapshot), `name_match_ranks_above_keyword` (`hit rate` finds Win rate; `PF` finds Profit factor; `DD` finds Max drawdown; `funded` finds Prop-firm rules), `slash_size_direct_command`.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/widgetBuilder/ExamplesGallery.test.jsx src/pages/journal-2-0/components/notebook/SlashMenu`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Bytes: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`; record the total and the remaining headroom in the commit message.
- [ ] **Step 6:** Commit: `feat(notebook): ready-made and dedicated widgets in the gallery and /, with Risk left today among the defaults (dark)`.

### Task 10.22: Browser walk

- [ ] **Step 1:** On a local sandbox (`scripts/hub-sandbox.ps1`, the data dir passed from PowerShell, never `C:\data`, a paid walk account) with `NOTEBOOK_WIDGETS_W8_ENABLED=1`, `NOTEBOOK_WIDGETS_W9_ENABLED=1` and `NOTEBOOK_WIDGETS_W10_ENABLED=1`, at 1200, 820 and 390 px:
  - `/build` → Closed trades → "Add your own field" → type `[Net P&L] / [Risk $]` with autocomplete → see the first-row line and the skip notice → add it as Average → save → insert;
  - type a broken formula (`If([net] > 0, 1`), read the inline sentence, fix it with the keyboard only;
  - build over Options strategies split by Strategy, and over Notes filtered by a number property, summed;
  - open Equity curve r1 from an older note: "Updated version available" → compare → use it; the curve is now a running total with the drawdown band;
  - insert each of the seven dedicated widgets; enter prop-firm limits in Change; open Plan vs actual on a linked and an unlinked trade;
  - `/size`: a long and a short, an unset account size, a stop equal to entry;
  - share the note and open the link in a private window: the account line for every dedicated widget and the calculator; a shared notes list widget reads "Note 1…";
  - set `NOTEBOOK_WIDGETS_W10_ENABLED=0`, reload: placed wave 10 widgets keep their snapshots and See it now says "Not available right now."; the calculator says the same; `/shelf` cards show revision 1; nothing else in the note changes;
  - at 390 px also with the keyboard open in the Formula box (the sticky summary hides, autocomplete stays above the keyboard).
- [ ] **Step 2:** VoiceOver on iOS Safari 17 (BrowserStack Live) for the formula box, autocomplete and one dedicated embed's table alternative, by the operator who ran it.
- [ ] **Step 3:** Save the raw evidence to `docs/notebook/evidence/<run-id>/` and commit it before writing any summary (R-RAW).

### Task 10.23: Wave 10 verification and ship dark

- [ ] **Step 1:** Backend, by name: `python -m pytest tests/test_widget_formula.py tests/test_widget_formula_vectors.py tests/test_widget_formula_hostile.py tests/test_widget_plan.py tests/test_widget_plan_v3.py tests/test_widget_formula_engine.py tests/test_widget_options_source.py tests/test_widget_notes_source.py tests/test_widget_sources.py tests/test_widget_tool_sources.py tests/test_widget_engine_isolation.py tests/test_widget_engine_fuzz.py tests/test_widget_run.py tests/test_widget_latency.py tests/test_widget_drill.py tests/test_built_widget_payload.py tests/test_widget_shelf.py tests/test_widget_shelf_files.py tests/test_widget_sample_book.py tests/test_widget_definitions.py tests/test_widget_definitions_router.py tests/test_widget_definitions_w10_router.py tests/test_shelf_discipline.py tests/test_shelf_discipline_isolation.py tests/test_shelf_compose.py tests/test_shelf_compose_isolation.py tests/test_shelf_widgets_router.py tests/test_phase1_kind_rows.py tests/test_public_note_payload.py tests/test_journal_styles_compose.py tests/test_revenge_detect.py tests/test_formula_engine.py tests/test_notebook_formula_properties.py tests/test_sample_never_feeds_real_numbers.py tests/test_notebook_flags.py tests/test_notebook_flag_table_form.py tests/test_notebook_flag_parse.py tests/test_user_definitions_auth.py -q`. Expected: all PASS except the known `test_user_definitions_auth.py` `PER_ROUTER` screener red; totals line recorded.
- [ ] **Step 2:** Frontend, chunked: `cd app && npx vitest run src/pages/journal-2-0/lib/widgetFormula src/pages/journal-2-0/lib/formula src/pages/journal-2-0/components/notebook/widgetBuilder src/pages/journal-2-0/components/notebook/widgets src/pages/journal-2-0/components/notebook/blocks src/pages/journal-2-0/lib/blocks src/pages/journal-2-0/components/notebook/SlashMenu src/pages/journal-2-0/lib/builtWidgets.test.js src/pages/journal-2-0/lib/dedicatedWidgets.test.js src/pages/journal-2-0/lib/notebookWidgetsFlags.test.js src/widgets src/styles src/pages/journal-2-0/lib/offline/doorEnumeration.test.js src/components/screener/reachable.test.js`. Expected: all PASS (the known reds `reachable.test.js` expired parking note and `offlineNeverStoresComputed.test.js`'s two screener tests, read by name); totals recorded.
- [ ] **Step 3:** The note-formula language is untouched: `git diff --stat origin/master...HEAD -- api/services/journal_two/formula_engine.py app/src/pages/journal-2-0/lib/formula` prints nothing.
- [ ] **Step 4:** Bytes: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`; record the total.
- [ ] **Step 5:** In the same branch, add to `CLAUDE.md`'s single-process list (the per-process state paragraph): the dedicated route shares the `notebook-widgets` scope (60/minute), in-process only. Commit: `docs: single-process note for the ready-made widget route`.
- [ ] **Step 6:** The owner's 50-member test campaign (ledger, plan of record): add wave 10's personas and data shapes to it, to run once after wave 11 with every wave flag on locally only (production stays dark; only smoke@ and bench@ sign in to prod). Wave 10 personas: a formula power user (5 fields each, every function, broken then fixed, keyboard only); an options-heavy member (500 strategies, legs, no equity trades); a notes-heavy member (5,000+ notes, 20 properties, folders and kinds); a prop-firm challenger (limits set, a breach day, a trailing drawdown); a tilt-prone day trader (timed trades, revenge pairs, dismissed pairs); a swing trader with dates only (hold-minutes sentence, tilt "needs times"); a member with no account size and no limits (calculator and risk left sentences); a hostile-text member (formula names and properties planted with the fuzz strings); a member whose placed shelf widgets are all revision 1 (the update control). Each persona at 1200/820/390 and keyboard only, collecting console errors, failed requests, overflow, sub-44 px targets, axe findings and timings.
- [ ] **Step 7:** Open a PR to master with the member-impact paragraph "Nothing changes for members: formulas, the options and notes widgets, the new ready-made widgets and the position size calculator ship switched off." Merge, deploy, verify the new boot by the `/api/health` uptime reset and `tools/hub_nav_smoke.py --auth`.
- [ ] **Step 8:** Arming is the owner's flip: report `railway variables --service web --set NOTEBOOK_WIDGETS_W10_ENABLED=1` and its rollback `=0` (never a delete). When armed, update `docs/feature_flags.json` (`status: armed`, the service, the flip time) in the same docs push.

---

## Scan for conflicts

| Tasks | Shared file or interface | How it is kept safe |
|---|---|---|
| 10.2 → 10.3 | `tests/fixtures/widgetFormulaVectors.json` | 10.2 commits the vectors first; 10.3 only reads them; a vector change is a 10.2 follow-up that reruns both twins |
| 10.2 → 10.4, 10.5, 10.16 | `widget_formula` contract (`compile_formula`, `FieldInfo`, `FormulaError`, sentences) | one module owns it; consumers import, never copy; the client twin is railed by the shared vectors |
| 10.4 → 10.5, 10.6, 10.7 | `plan.py`, the payload and run tables | 10.4 lands every shared row first; afterwards 10.5 owns `aggregate.py`, `payload.py`, `run.py`, shared `measures.py`; 10.6 and 10.7 own `sources.py`, `compile.py`, the adapter and `drill.py` |
| 10.6 → 10.7 | `sources.py`, `compile.py`, `widget_engine/measures.py`, `drill.py` | sequential in Lane F |
| 10.8, 10.9, 10.13 | `api/routers/notebook_widget_definitions.py` | 10.8 (`_resolve`, `/shelf`) lands before 10.9 starts; 10.13 edits `/shelf` after 10.9 |
| 10.8, 10.13 | `widget_engine/shelf/MANIFEST.json` | append only; the released-revisions rail reds any edit to an existing entry |
| 10.10, 10.11 → 10.12 | `shelf_discipline.py`, `shelf_compose.py`, `shelf_kinds.py` | two new modules in parallel; 10.12 only imports their `BUILDERS` and `PARAMS` |
| 10.10 vs other workstreams | `revenge_detect.py` | one alias line; `tests/test_revenge_detect.py` in the run |
| 10.12 vs wave 8 and 9 | `public_note_payload.py`, `api/routers/notebook_widgets.py`, `api/main.py` | additive rows and one refusal line; Lane F never edits these files |
| 10.12 → 10.14 | `KIND_WAVE`, `KIND_TITLE`, `ACCOUNT_KINDS`, `_BUILDERS`, `WIDGET_KINDS` | rows land in ONE commit on both sides (8.13 precedent); 10.12's tests monkeypatch until then and 10.14 removes the patches; `test_phase1_kind_rows_unchanged` guards the phase 1 rows |
| backend → frontend | the merge point after 10.12 and 10.13 | frontend tasks mock `fetch` against this plan's shapes until the merge |
| 10.14, 10.20, 10.21 | `registry.js`, `SlashMenu.jsx`, `notebookWidgets.js`, `BlockNodeView.jsx` (eager) | serialized eager chain 10.14 → 10.20 → 10.21; each runs the bytes gate |
| 10.14, 10.15 | `snapshotEmbeds.js`, `SnapshotFrame.jsx` | 10.14 owns `SnapshotFrame.jsx`; 10.15 owns `snapshotEmbeds.js` and the embed files |
| 10.16 → 10.17 | `WhichOnesSection.jsx`, `builderCatalog.js`, `WidgetBuilderSheet.jsx` | sequential |
| 10.16, 10.17 vs 8.15, 8.16 | builder sections | after 8.15 (landed) and 8.16 |
| 10.17, 10.18, 10.19 | `builtViews/*` | 10.17 owns `DrillPanel.jsx`; 10.18 owns the five views, `builtModel.js`, the css; 10.19 owns `HowMadeSheet.jsx`, `BuiltWidgetEmbed.jsx`, `lib/builtWidgets.js` |
| 10.19 → 10.21 | the insert rule (`defRev` = card `rev`) | 10.19 defines; 10.21 consumes |
| 10.20 vs wave 9 | `lib/blocks/blockDoors.test.js` (`IMPORT_ALLOW`), `journalBlocks.js` `TOOL_BLOCK_LABELS` | additive entries after Tasks 9.12-9.14 land |
| 10.21 vs 8.18, 9.19 | `SlashMenu.jsx`, `ExamplesGallery.jsx` | 10.21 after 8.18 and 9.19 |
| 10.1, 10.14, 10.20, 10.21, 10.23 | `npm run build` into `app/dist` | one build at a time in `nbw-p2-impl` (R-9) |
| every task vs `formula_engine.py`, `lib/formula/**` | the note-property formula language | never edited; 10.23 Step 3 proves it |
