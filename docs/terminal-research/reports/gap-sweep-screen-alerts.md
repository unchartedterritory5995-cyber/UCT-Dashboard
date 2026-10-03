# Gap sweep: screening, alerts and export rows (FT-022 to FT-043)

Branch `lane/gaps-screen-alerts`, cut from `integrate/terminal-fixes` at `daf65808`.
Owner ruling 2026-10-02: build what is needed to be the ultimate competitor to Bloomberg-class terminals.
Source rows: `docs/terminal-research/05-product-strategy/capability-matrix/capability-matrix.md:593-614`.
FT-032 (alerts on chart drawings) is out of scope (chart-engine territory). FT-023 and FT-025, FT-031, FT-039, FT-040 are not in this lane's domain.

## Step 1: status before this lane (read from code, not from the matrix)

The matrix is stale in two places. It marks FT-027 and FT-028 GAP, but a count endpoint and nightly screen alerts exist.

| Row | What it asks | Status at `daf65808` | Evidence |
|---|---|---|---|
| FT-022 | Named preset scans, incl. chart-pattern presets | **PARTIAL** | 12 surfaced starters at `api/services/screener/saved_screens.py:325-434`. A second list of 12 candle starters (`:210-322`) was un-surfaced 2026-09-20. The pattern engine (`api/services/pattern_engine/detectors/registry.py:15-32`) reaches the screener only as filters (`api/services/screener/filters.py:637-654`, `:690-693`). No starter uses a `pattern_engine_*` filter, so there are no Wedge / H&S / Double Top presets. |
| FT-024 / FT-030 | Natural language to a finished screen, with an explanation of every filter | **PARTIAL** | The Builder Concierge (`api/services/definition_concierge.py:90,147`, `POST /api/user-definitions/propose` at `api/routers/user_definitions.py:305`) and TERM-087 (`api/services/ai_search_scan_object.py:66,89-121`, armed per `docs/feature_flags.json:152-158`) compile English to a scan DEFINITION (a 0/1 formula tree), not to a screener spec with filters, columns and sort. It enters the screener only as `{key:"scan"}` (`api/services/screener/query.py:345-385`), which is inert until the nightly sweep runs. There is no per-filter explanation panel. |
| FT-026 | all-of / none-of / any-of groups | **ABSENT** | `build_where` joins every clause with AND only: `api/services/screener/query.py:579`. `not_in` (per field) and a `list` filter's union are the only non-AND forms. |
| FT-027 | Scan to watchlist / named query / alert | **PARTIAL** | Named saved query: BUILT (`saved_screens.create/update`, `SaveScanButton.jsx`). Alert: BUILT for definition scans only, nightly (`api/services/screener/screen_alerts.py:102,171`; scheduled `api/main.py:1891-1904`). Watchlist: manual, flagged rows only (`app/src/pages/screener/shell/FlaggedActions.jsx:7-110`); no "whole result set to watchlist" action or endpoint. |
| FT-028 | Live matching count while criteria change, with an as-of | **PARTIAL** | `POST /api/screener/count` (`api/routers/screener.py:222`, `query.preview_count` `:1271-1307`), debounced at 120 ms (`app/src/pages/screener/hooks/useScreenerCount.js`), rendered in `FilterRail.jsx:191-200`. The count response carries no date; the as-of lives only on the toolbar Seal (`ShellToolbar.jsx:107-150`). |
| FT-029 | Alert grammar: k/m/b/% shortcuts, and/or/not with grouping, field-to-field | **ABSENT** | No parser. The closest thing is single-condition `check_condition` (`api/services/alert_conditions.py:39,44-121`). Field-to-field exists only as screener ops (`filters.COL_OPS`, `api/services/screener/filters.py:718`). |
| FT-033 | Outbound webhook on trigger, signed | **ABSENT** | Inbound only (TERM-086: `api/routers/inbound_alerts.py:153`, `api/services/inbound_alerts.py`). Every other webhook in the code is an internal Discord ops hook. No shared HMAC helper. Reusable SSRF guard: `api/services/journal_two/note_connectors/providers/base.py:216,237`. |
| FT-034 | Trigger types across source kinds | **PARTIAL** | Eight S7 types, registered in the `main.py` lifespan (`:3390-3477`). Only document-arrival delivers (`main.py:7214-7236`); the other seven run as dark comparison sweeps (`main.py:7253-7522`). Rating change has no type (only a catalyst category, `catalyst_match.py:178`). event-proximity produces earnings only (`event_proximity.py:71-76,185`). Portfolio triggers are out by STR-04. |
| FT-035 | Per-alert expire / remind / reverse-crossover | **ABSENT** (S7) | `alert_predicates` has `suspended_at` only (`api/services/alert_taxonomy/db.py:73-104`). Re-arm grain is published per type (`alert_taxonomy/cooldowns.py:58-71`). The legacy indicator lane has snooze/re-arm (`indicator_alert_service.py:61,120,744`) but no expiry, reminder or reverse. |
| FT-036 | One global routing rule; suspend without losing the definition | **ABSENT** | `alert_routing_prefs` is explicitly deferred (`alert_taxonomy/db.py:13-20`, `delivery.py:6-10`); `predicate.channels` is always NULL. Suspend is per predicate (`predicates.py:190`). |
| FT-037 / FT-038 | Channels: email, in-app, push, SMS, Telegram | **PARTIAL** | Fan-out `deliver_alert_payload` (`api/services/watchlist_alert_service.py:472-654`): in-app, email (Resend), web push (BRK-04, `api/services/web_push.py:402`, `WEB_PUSH_ENABLED` pending). Discord is retired for private alerts. SMS and Telegram: absent. |
| FT-041 / FT-042 | CSV / Excel export for screener, watchlists, options, news; metered | **PARTIAL** | In-browser CSV only, unmetered: screener (`app/src/pages/screener/exportCsv.js:2,26,44`), watchlist symbols + notes (`app/src/pages/Watchlists.jsx:978`). Nothing for options, news or chart bars. No xlsx writer; openpyxl is not a dependency. |
| FT-043 | Chart data as CSV | **ABSENT** | No export from `/api/bars/{ticker}` (`api/routers/bars.py:555`). |

## Step 2: build order (value first)

1. Exports, all five sources, metered (FT-041/042/043).
2. Screener logical groups + the where-grammar + the count's as-of (FT-026, FT-029, FT-028).
3. Outbound signed webhooks for S7 fires, plus one routing rule with suspend-all (FT-033, FT-036).
4. Scan to watchlist (FT-027), chart-pattern presets (FT-022), S7 per-alert expiry (FT-035).

## Step 2: what was built

Each surface is dark behind its own flag, registered `pending` in `docs/feature_flags.json`. Every route uses `require_paid` and is a plain `def`.

| Row(s) | Flag | Commit | What |
|---|---|---|---|
| FT-041 / 042 / 043 | `DATA_EXPORTS_ENABLED` | `00fb3f00` | CSV and Excel for the screener, a watchlist, the option chain (also needs `OPTIONS_CHAIN_ENABLED`), news, and chart bars, under `/api/exports/*`. Each builder reads the function the page itself reads and writes only the columns the page shows; news carries no article body. Limits: 6 per minute and `EXPORT_DAILY_CAP` (default 25) per member per ET day, stored in `daily_usage_counters`. A failed export gives its charge back. Cells that start like a formula are escaped. The Excel writer has no new dependency. The screener toolbar gets an Excel button, and the watchlist menu gets Export Excel. |
| FT-026 / 028 / 029 | `SCREENER_LOGIC_ENABLED` | `15d19772` | A `logic` node on the spec: all / any / none / not, up to depth 4 and 25 criteria, ANDed with the flat list. Every leaf goes through `build_where`, and a value we cannot evaluate passes "none of". The `where` grammar supports k/m/b/t/%, and/or/not with parentheses, between, in / not in, contains, and field-to-field comparison, at `GET /api/screener/grammar` and `POST /api/screener/grammar/parse`. The count now returns `as_of`. The screener rail gets a Criteria box. |
| FT-033 / 036 | `ALERT_WEBHOOKS_ENABLED`, `ALERT_ROUTING_RULE_ENABLED` | `4812df1f` | **Webhooks:** signed (HMAC-SHA256, `t=`/`v1=`), up to 3 per member, secret encrypted with crypto_box and shown once. SSRF checks run at create time and again at send time: https only, port 443, no private addresses, no redirects. A fire only queues a delivery; a scheduler job sends it, retrying at 1, 2, 4, 8 and 16 minutes, then marking it failed. Each member can send up to `WEBHOOK_HOURLY_CAP` per hour. **Routing:** one rule per member covers email, push and webhook, plus suspend/resume. A suspended alert's fire is still written to `alert_fires` with `{routing: suspended}`. |
| FT-027 / 022 / 035 | `SCREENER_PROMOTE_ENABLED`, `SCREENER_PATTERN_PRESETS_ENABLED`, `ALERT_LIFECYCLE_ENABLED` | `37ca6b44` | **Watchlist:** the whole result set goes into a new or existing list, up to 500 names, and the response says when it was truncated. **Presets:** 18 chart-pattern presets, each matching the pattern token exactly, with a rail against the detector registry. **Expiry:** an alert past its expiry is suspended, never deleted. |
| FT-024 / 030 | `SCREENER_NL_COMPILE_ENABLED` (also needs `SCREENER_LOGIC_ENABLED`) | `20f30762` | English is compiled into the grammar. The model only writes a criteria string, and that string goes through the member parser, with one repair attempt and then a refusal. The member sees the criteria (editable), an explanation, and the assumptions made. Limits: `SCREENER_NL_DAILY_CAP` (30) per member, then the population cap. |

### Still open, and why

- **FT-034, the five missing trigger kinds.** Rating change has no S7 type, and the other seven S7 types are still dark comparison sweeps owned by the S7 gate programme. Promoting them is that programme's call, not this lane's.
- **FT-035 remind and reverse-crossover.**
  - Remind needs a read-state on every channel, and only in-app has one.
  - Reverse-crossover is per-type and lives in the price-level evaluator, which is still dark.
- **FT-036 for the TERM-048 price-alert bridge.** `_deliver_via_s7` has its own fan-out, so the routing rule does not apply to it yet.
- **FT-027 alert on a filter-list screen.** Nightly enter/leave alerts exist for definition scans only. Doing the same for a spec needs a membership snapshot per saved screen.
- **FT-029 scope prefixes and arithmetic** (`$AAPL`, `#list`, `size * price`). The parser refuses these and says why.
- **FT-037 / 038 SMS and Telegram.** Not trivial (bot token, chat linking, a new vendor), so skipped as allowed.
- **Options-flow export.** Flow rows are served by flow-worker, which is outside this lane.
- **Grouped logic in the URL.** Grouped logic is not carried in the screener URL yet; a saved screen does carry it.

### Pre-existing reds fixed or found

- `tests/test_screener_saved.py::test_every_valid_op_declares_its_operands` was red on the base because `not_in` had no operands. Fixed.
- `docs/api/member-api-whitelist.json` and `skill.md` had drifted on the base. Regenerated.
- `tests/test_screener_filters.py` has two view-visibility failures that this lane did not touch, so they were left alone.
