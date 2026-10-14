# P2b verify before building

Measured against the P2a landing tip (`7f7a2756ad`; §V1 at `4c4252e75d`) (branch `notebook-p2-blocks`), the tree P2b
builds on once P2a's PR merges. §V1 is re-measured on the P2b base at Task 0.

## §cite — every plan citation, re-read (each grep printed one line unless noted)

| Citation | file:line |
|---|---|
| `CREATE TABLE IF NOT EXISTS j2_journal_rules (` | `api/services/journal_two/db.py:369` |
| `def create_rule(` | `api/services/journal_two/journal_rules.py:65` |
| `def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:` | `api/services/journal_two/journal_rules.py:49` |
| `@router.post("/accounts/{account_id}/rules")` | `api/routers/journal_two.py:1073` |
| `"j2_journal_rules",` (purge list) | `api/services/journal_two/account_purge.py:49` |
| `"j2_journal_styles": "no-door: ...` | `api/services/address_space.py:186` |
| `CREATE TABLE IF NOT EXISTS j2_note_versions (` | `api/services/journal_two/db.py:642` |
| `ALTER TABLE j2_note_versions ADD COLUMN restored_from_version_id TEXT` | `api/services/journal_two/db.py:1937` |
| `def _maybe_capture_version(` | `api/services/journal_two/notes.py:3393` |
| `INSERT INTO j2_note_versions (id, user_id, note_id, title, subtitle,` | `api/services/journal_two/notes.py:3468` |
| `def get_note_version(` | `api/services/journal_two/notes.py:3511` |
| `def restore_note_version(` | `api/services/journal_two/notes.py:3550` |
| `style_stamp: tuple[str, int] \| None = None,` | `api/services/journal_two/notes.py:3631` |
| `ALTER TABLE j2_trades ADD COLUMN analytics_excluded INTEGER DEFAULT 0` | `api/services/journal_two/db.py:1812` |
| `ALTER TABLE j2_trades ADD COLUMN mistake_tags TEXT` | `api/services/journal_two/db.py:1650` |
| `"mistakeTags": json.loads` | `api/services/journal_two/trades.py:965` |
| `def list_adherence_for_user(` | `api/services/journal_two/adherence_store.py:128` |
| `def trade_ref_for_row(row) -> str:` | `api/services/journal_two/trade_refs.py:19` |
| `EARNINGS_CACHE_KEY = "earnings"` | `api/services/engine.py:938` |
| `def get_rundown() -> dict:` | `api/services/engine.py:802` |
| `def extract_rundown_speech_text(html: str) -> str:` | `api/services/rundown_speech.py:75` |
| `def get_user_ticker_sets(user_id: str) -> dict:` | `api/services/calendar_personalization.py:25` |
| `def build_cards(conn: sqlite3.Connection, user_id: str` | `api/services/journal_two/setups_board.py:250` |
| `return plan_grading.grade_payload(conn, user["id"], t)` | `api/routers/notebook_plan_grades.py:113` and `:135` (**two** lines: the GET and the recompute route; both real, the plan means either) |
| `_h("What I'd do differently"), _p())},` | `api/services/journal_two/journal_styles.py:145` |
| `<MyRulesList` | `app/src/pages/journal-2-0/components/insights/PsychologySection.jsx:134` |
| ``Prefer starting it with `--config-path` at a config whose synth is `silence` `` | `tools/notebook_nvda_pass.py:36` |

## §V1 — Part a on the base

**Base: `notebook-p2-blocks` at `4c4252e75d`, NOT `origin/master`.** Part a's PR (#321) is open and
gating; Task 0 Step 1 allows this base when part b starts before the merge. Measured on that base:
`registry.js` names `preEntryChecklist`, `priceStamps`, `positionSizing` (3 matches);
`trader_blocks.py:20` `BLOCK_IDS = ("preEntryChecklist", "priceStamps", "positionSizing")`;
`trader_blocks.py:82` `BUILDERS` (plus `marketcontext` at `:449`). Once #321 merges, part b merges
`origin/master` and its PR targets `master`.

## §V2 — the version row's dict

`get_note_version` (`notes.py:3511`) returns `id, noteId, title, subtitle, bodyJson, bodyPlain,
createdAt, propertiesJson, restoredFromVersionId`. The last two read their column through
`_row_keys(row)` so a row predating the column answers `None`. Task 5 adds `styleId`,
`styleVersion`, `styleCaptured` beside `restoredFromVersionId` the same way.

## §V3 — `_maybe_capture_version`'s `existing`

`existing: sqlite3.Row` is the pre-edit `j2_notes` row (docstring: "`existing` is the pre-edit
row"); the function reads `existing["updated_at"]` and passes `existing` to
`_versioned_content_of`. It is the full row, so `existing["style_id"]` and
`existing["style_version"]` are readable.

## §V4 — `build_cards`' `prices` seam

`prices: Callable[[Iterable[str]], dict] | None`; production uses `read_prices`, which answers a
live last price where the bars cache has one (`bc.get_last_price(sym)`), else the last stored daily
close, and leaves a symbol neither can answer absent. Task 6 passes a cache-only `prices`.

## §V5 — `member_interest.SOURCES` and `all_mine`

`SOURCES` at `api/services/member_interest.py:150` (derived from `SOURCE_BUCKETS`); `all_mine` is
the union set (`:181`, built at `:213-215`). Task 6 uses `all_mine`.

## §V6 — the earnings payload

`engine.py` documents the cache as `{"bmo": [...], "amc": [...]}` (`:14`); readers also take
`amc_tonight` (`:832`). Task 6 reads all three keys.

## §V7 — `plan_grading.grade_payload`

`grade_payload(conn, user_id, t, defs=None, *, with_candidates=True, scope=None)`
(`plan_grading.py:847`) returns "everything the trade page shows for one trade". The gate is
`plan_grading.enabled()` (`:104`) over `FLAG = "NOTEBOOK_PLAN_GRADING_ENABLED"` (`:57`).

## §V8 — `usePlanGrade.js`

`app/src/pages/journal-2-0/hooks/usePlanGrade.js` exists with its own test. Ruling for Task 11:
the review block uses Task 7's combined read only (one trade picker, one request); the hook stays
the trade page's.

## §V9 — can NVDA run against a sandbox?

Yes. `tools/notebook_nvda_pass.py` takes `--base` (`:374`) and reads `SMOKE_EMAIL` /
`SMOKE_PASSWORD` from the environment (`:389`); `scripts/hub_sandbox_boot.py` promotes a test
account via `ADMIN_EMAILS` (`:410`). Task 15 boots a sandbox, mints a test account whose
credentials are generated for that run and set only in the tool's own process environment, and
runs NVDA before arming (R-P2b-7's first branch).

## §V10 — `screen-reader-pass.md` row format

The table header is `| # | Keys | Expected announcement (quoted from source) | Source | PASS / FAIL | Notes |`
(`docs/notebook/screen-reader-pass.md:39`); rows are numbered in the first column. Task 15's rows
continue the numbering in that format.
