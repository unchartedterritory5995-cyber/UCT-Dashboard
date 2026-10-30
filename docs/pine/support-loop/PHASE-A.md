# Indicator support loop — Phase A: detection and intake

Branch `feat/indicator-support-loop-a`. Phase A makes it visible, to the member and
to us, when a pasted TradingView (Pine) script does not carry over, and lets a member
choose to send us a script that looks different. Phase B (a daily ranked fix loop)
reads what Phase A stores; its inputs are defined in "Data shapes for Phase B" below.

Scope: Pine scripts whose code the member has (open-source scripts they can paste).
Protected and invite-only scripts are out of scope. thinkScript and TC2000 pastes
are out of scope too: the gap reader returns nothing for another dialect.

| Part | Stores member content? | Default |
|---|---|---|
| A1 notice | no | on |
| A2 gap counts | no | on (`PINE_GAP_LOG=off` turns it off) |
| A3 report | **yes, only with consent** | **off** (`PINE_SUPPORT_REPORTS_ENABLED`) |

## A1 — the notice at import

**Where:** the import box (`PineBox.jsx` `PasteBox`, which the Builder's Import tab
mounts as `ImportBox`), directly under the import verdict line. The member's own
pane preview (`MemberPane`) sits under the same tab and translates the same pasted
text, so one notice covers both import paths.

**What it reads:** `supportLoop/importGaps.js::importGaps(report)`, a pure reader of
the report the box already has. A gap is:

- an output the translator refused (its `refusal`, with the `token` it names);
- an output that translated but that the downstream formula door refused;
- a whole-script refusal not already carried by an output;
- a missing part the translator records as a note (a strategy's orders);
- a drawing program that lost a removal (`objectLoss.js`, as `importOutcome.js` reads it).

Refusals about the shape of the script, not about a missing TradingView feature, are
not gaps: `pine:no-output`, `pine:objects-only`, `pine:hidden-only`,
`pine:constant-only`, `pine:presentation-only`, and `language` (another language).

**How each gap failed:** `doorCoverage.js`'s classification, imported rather than
re-typed (`UNKNOWN_NAME_GUARDS`): `name-unknown` when the door does not know the
name, `call-unmapped` when it knows the name and could not map the call.

**What the member sees:** exactly when at least one gap exists, a gold-ruled note
(`role="status"`, `data-testid="import-gap-notice"`):

> 2 parts of this script aren't supported yet, so the chart may differ from
> TradingView: ta.sma, and 1 other part.

A part is named only when its name is in the closed allowlist (below). A member's own
identifier (`myHelper`, `secretLevel`) is never shown as a "TradingView function"; it
is counted as an "other part". When nothing is missing, no note appears.

## A2 — gap logging, with no member content

**What is logged:** for each paste, the (name, kind) pairs from `gapLogPayload`:
allowlisted names only, plus a COUNT of unnamed gaps. The client posts this once per
distinct gap set per page (`supportApi.logImportGaps`), not once per keystroke.

**Where:** a dedicated aggregate table, `indicator_gap_hits`, in the auth database:

```
indicator_gap_hits(day TEXT, name TEXT, kind TEXT, user_id TEXT, hits INTEGER)
PRIMARY KEY (day, name, kind, user_id)
```

**Why a table and not a telemetry event.** `indicator_telemetry.py` forbids list and
dict values on every event (its 2026-09-04 hardening). A paste that loses three
built-ins is a list. As events it would be one `landing_events` row per name per
paste, and Phase B's question ("rank names by distinct members hit") would become a
JSON scan over a shared marketing table. The aggregate answers that question with one
`GROUP BY`, stays small (one row per member per name per kind per day), and holds no
free-form value at all, so the telemetry module's hardening is not bent.

`hits` counts repeat pastes, capped at 50 per member per name per day so one member
cannot weight a name by pasting it repeatedly. The ranking key is distinct members.

## A3 — "Doesn't match TradingView?", opt-in

**Where the button is:**

1. on the A1 notice, when a gap exists;
2. as a quiet link under the import verdict for a script that translated fully;
3. in the chart's indicator chip menu (tap/right-click an indicator chip) for any
   imported Pine definition (`meta.recurrenceOrigin === 'pine'`), which is the place
   a member notices that a fully translated script looks different.

All three appear only while the server's report flag is on (`GET /config`), so a
member is never offered a button whose request would be refused.

**The dialog** (`ReportMismatchDialog.jsx`, lazy-loaded) says in plain words that
sending the report sends the script's code to UCT, that it is kept only to improve
support, and that the member can withdraw it. It has:

- a consent checkbox; **Send stays disabled until it is ticked**;
- an optional "What looks different?" note (1,000 characters);
- an optional TradingView link (`https://…tradingview.com/…` only);
- the symbol and timeframe being viewed, shown read-only;
- the translator's gap list (allowlisted names only), shown read-only;
- for a chip-menu report of a formula document (which keeps only its compiled
  tree, not the Pine), a box to paste the script; a runtime-lane document carries
  its Pine and the box is not shown.

After sending, the member sees a confirmation. Opening the dialog again lists their
reports with a one-word status (Received / Being looked at / Fixed / Closed) and a
Withdraw button that deletes the report.

**Server** (`api/services/indicator_support.py`, `api/routers/indicator_support.py`,
prefix `/api/indicator-support`):

| Route | Who | |
|---|---|---|
| `GET /config` | member | `{reports_enabled, max_source_bytes, max_note_chars}` |
| `POST /gaps` | member | A2 |
| `GET /gaps?days=30` | admin | Phase B ranking |
| `POST /reports` | member | create (flag + consent) |
| `GET /reports/mine` | member | own reports, no source |
| `GET /reports/mine/{id}` | member | own report with source; 404 for anyone else's |
| `DELETE /reports/mine/{id}` | member | withdraw = delete; 404 for anyone else's |
| `GET /reports?status=` | admin | list, no source |
| `GET /reports/{id}` | admin | one report with source |
| `PATCH /reports/{id}` | admin | `{status: new|triaged|fixed|wontfix}` |

Table:

```
indicator_support_reports(
  id TEXT PK,                       -- uuid4 hex
  user_id TEXT,                     -- the member
  consent INTEGER CHECK (consent = 1),
  source TEXT, source_hash TEXT, source_bytes INTEGER,
  note TEXT, tradingview_link TEXT, symbol TEXT, timeframe TEXT,
  gaps TEXT,                        -- JSON [{name, kind}], allowlisted or "_unlisted"
  translator_version TEXT,          -- server's RAILWAY_GIT_COMMIT_SHA[:12], or "unrecorded"
  status TEXT CHECK (status IN ('new','triaged','fixed','wontfix')),
  created_at TEXT, status_changed_at TEXT)
```

- **Dedupe:** `source_hash` is SHA-256 of the script with line endings normalised and
  trailing whitespace stripped. A member re-sending a script they already have open
  (`new`/`triaged`) gets their existing report back (`duplicate: true`), not a second row.
- **Size cap:** 128 KiB of UTF-8 (`MAX_SOURCE_BYTES`, checked in bytes, so multi-byte
  text cannot slip under a character count); 413 over it.
- **Rate limit:** 5 reports per member per hour and 20 per day, counted from the table
  itself, so it survives a restart and a second process; 429 over it. The route family
  is also declared in `rate_limit_policy.py` (`screener` family). A member who
  withdraws reports frees their quota; that is accepted, since a withdrawn report
  stores nothing.
- **Translator version** is stamped by the server, never taken from the client.

**Retention** (`purge_expired`, run on every create and every admin list): a report is
deleted 30 days after it is marked `fixed` or `wontfix`, and in any case 365 days after
it was created. Withdrawal deletes immediately.

⚠️ **Open item:** account deletion (`journal_two/account_purge.py`) does not yet delete
these two tables. That module is on the journal path, which this branch may not touch.
Until it does, retention bounds a deleted member's reports at 365 days and gap rows hold
only allowlisted names. Adding both tables to the purge is a one-line follow-up for
whoever owns that file.

## Flag

**`PINE_SUPPORT_REPORTS_ENABLED`**, an env var on `web`, read per call. `1` / `true` /
`on` / `yes` turns A3 storage on. Unset (the default) refuses every create with 404 and
stores nothing, and the client hides every report button. Turning it on in production is
an owner decision.

`PINE_GAP_LOG=off` turns A2 off; anything else, including unset, leaves it on.

## Privacy guarantees and the rails that enforce them

Every rail below was mutation-proved: the guarded line was edited from saved bytes, the
rail went red, the bytes were restored and the file's SHA-256 checked against the saved one.

| Guarantee | Enforced by | Rail |
|---|---|---|
| Pasted source is never stored, except an opt-in report | no A1/A2 path carries source; A2 body is `gapLogPayload` only | `importGapNotice.door.test.jsx` "posts the real built-in and a COUNT…" |
| A logged name is always a real Pine built-in | client `isPineBuiltin` + server `clean_gaps` against the same `pineBuiltins.json` | `test_indicator_support.py::TestGapAllowlist::test_only_allowlisted_names_reach_the_table`; `importGaps.test.js` A2 cases |
| A member identifier is never shown as a TradingView function | `importGaps` names only allowlisted tokens (and `gapLogPayload` re-filters, so the log has two guards; each was mutated separately) | `importGaps.test.js` "a member identifier is NEVER named"; `importGapNotice.door.test.jsx` "…without naming a member identifier" |
| The notice appears exactly when a gap exists | `ImportGapNotice` renders the note iff `gapNoticeText` is non-null | `importGapNotice.door.test.jsx` A1 cases; `importGapNotice.sheet.test.jsx` (through `BuilderSheet`) |
| No source without `consent: true` | `create_report` checks `consent is True` before reading source; table `CHECK (consent = 1)`; Send disabled until ticked | `TestConsent` (7 values incl. `1`, `"true"`); `test_the_table_itself_refuses_consent_zero`; door test "sends ONLY after consent" |
| Flag off stores nothing | `create_report` refuses first when `reports_enabled()` is false | `TestFlagOff::test_flag_off_refuses_and_stores_nothing` |
| A member cannot read or withdraw another member's report | every member query is `WHERE id = ? AND user_id = ?`; 404 either way | `TestOwnership::test_member_cannot_read…`, `…withdraw…` |
| Non-admins cannot list, read or triage reports, or read the ranking | `require_admin` on those routes | `TestOwnership::test_non_admins_cannot_list_or_read_or_triage`; `TestGapAllowlist::test_ranking_is_admin_only` |
| Rate limit and size cap | `create_report` counts per member per hour/day; byte cap | `TestLimits` |
| Retention | `purge_expired` | `TestRetention` |

## Data shapes for Phase B

**Gap ranking** — `indicator_support.gap_ranking(days=30, limit=200)`, also
`GET /api/indicator-support/gaps?days=30` (admin):

```json
{"window_days": 30, "gaps": [
  {"name": "ta.supertrend", "kind": "name-unknown", "members": 14, "hits": 31,
   "first_day": "2026-10-01", "last_day": "2026-10-30", "days_seen": 12}
]}
```

Sorted by `members` (distinct members) descending, then `hits`, then name. `name` is a
Pine built-in from `pineBuiltins.json` or `_unlisted` (gaps whose token was not a
built-in: a member identifier, or a construct with no single name). No user ids are
returned. For custom windows, query `indicator_gap_hits` directly:
`COUNT(DISTINCT user_id) … GROUP BY name, kind`.

**Reports** — `indicator_support.admin_list_reports(status=None)`, also
`GET /api/indicator-support/reports` (admin): each row is

```json
{"id": "…32 hex…", "status": "new", "created_at": "2026-10-30T13:00:00Z",
 "status_changed_at": "…", "symbol": "AAPL", "timeframe": "D", "note": "…",
 "tradingview_link": "https://www.tradingview.com/script/…", "gaps": [{"name": "ta.kc", "kind": "call-unmapped"}],
 "translator_version": "dadccbc98d12", "source_bytes": 2048, "source_hash": "…64 hex…",
 "reporter": "<member id>", "same_script_reports": 3}
```

`same_script_reports` counts reports sharing the script's hash across members, so
Phase B can rank scripts by how many members reported them. The source itself is read
one report at a time (`admin_get_report(id)` / `GET /reports/{id}`). Phase B should move
a report to `triaged` when it picks it up and `fixed` / `wontfix` when done; the member
sees that status, and `fixed`/`wontfix` starts the 30-day retention clock.

## The allowlist

`app/src/components/chart/supportLoop/pineBuiltins.json`: 755 names from the Pine
v3–v6 reference (functions, variables, namespace members, and the legacy bare v3/v4
spellings), one file read by both the client and the server. Every entry matches
`^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*){0,2}$`. A real built-in missing from the list
only under-reports (it is counted as `_unlisted`); it can never leak content. Add names
by hand, in the open.

## Files

- `app/src/components/chart/supportLoop/` — `importGaps.js`, `pineBuiltins.json`,
  `supportApi.js`, `useReportsConfig.js`, `reportDoor.jsx`, `ImportGapNotice.jsx`,
  `ReportMismatchDialog.jsx` (+ CSS modules and tests)
- `app/src/components/chart/builder/PineBox.jsx` (mounts the notice),
  `BuilderSheet.jsx` (hands `sym`/`tf` to the import box)
- `app/src/components/chart/legend/chipMenu.js` (the chip row),
  `app/src/components/StockChart.jsx` (opens the dialog from the chip menu)
- `api/services/indicator_support.py`, `api/routers/indicator_support.py`,
  `api/main.py` (mount), `api/rate_limit_policy.py` (family)
- `tests/test_indicator_support.py`
