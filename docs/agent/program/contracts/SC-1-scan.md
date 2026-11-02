# SC-1 — Agent scan contract (v1.3)

- **Owner:** agent-sc.
- **Consumers:** agent-rs, agent-qa, and later the G workstream.
- **Depends on:** MD-1 (envelope, gateway and budgets).
- **Status:** v1.0 accepted for Sprint 1; v1.1 (additive, 2026-11-01) pins the `as_of`/`stale` mapping in §2a; v1.3 (additive) adds §2c, relative volume. **v1.2 is reserved** for the IC-1 delegating kind (ADR-004), which is not scheduled.

## 1. Purpose

Opportunity discovery runs on **UCT's canonical screener service**: `api/services/screener/query.py`, which turns a JSON filter spec into SQL over `screener_rows`, plus `coverage_receipt.py`. **No new scan engine.** The Agent never uses the legacy `/api/screener` or `/api/candidates` (`engine.get_screener` / `get_candidates`); see ADR-002.

## 2. Kinds

These are MD-1 gateway kinds with category `scan`. They need both `UCT_AGENT_DATA=1` and `UCT_AGENT_SCAN=1`.

| Kind | Wraps | Declared freshness | `data` |
|---|---|---|---|
| `screen.run` | `screener/query` scan | periodic | `{spec, rows: [≤50 rows: symbol + requested fields], total_matches}` |
| `screen.count` | `screener/query` count | periodic | `{spec, count}` |
| `screen.saved` | saved screens (the member's own, read-only) | periodic | `{screens: [{id, name, spec}]}` |

**Each scan kind's envelope**
- `coverage` is always set, from `coverage_receipt`: `{evaluated, answered, dropped, not_computable}`.
- `as_of` comes from `screener_rows` (`as_of`).
- `stale` is set from the service's own `stale` flag.
- Live-tier overlay fields are labelled in `notes` when they're used.

## 2a. How the envelope fields are derived (v1.1, additive)

The screener has no single `as_of` or `stale` field, so v1.1 pins the mapping:

- **`as_of`** is the close (16:00 ET, as UTC) of the median `bars_asof` session of the **matched rows**. It is computed by the service's own `snapshot_db.describe_rows` over the scan's own plan. `snapshot_date` is when a row was *built*, not the data's time, so it is never `as_of`.
- **`stale`** is true when that session is more than one NYSE session behind the last closed session, or when the matched rows run through more than one session (the service's `mixed` signal).
- **Stopped-bar exclusions** (the service's stale gate) are counted in `coverage.dropped` and named in a note.
- **`status`** is `partial` when `coverage.dropped` or `coverage.not_computable` is non-zero.
- **`provider_calls`** is 0: the screener reads its own local snapshot.
- **Extra `data` fields** (additive): `screen.run` adds `fields` (the columns returned), `excluded` (at most 10 dropped or not-computable names with a reason) and `rank` (the service's rank receipt, for a ranked spec). `screen.count` adds `excluded` and `top_n`.
- **Row limit:** `params.limit` (or `spec.limit` / `spec.page_size`) is clamped to 1–50. Paging is never passed through.

## 2b. Spec sources and `screen.saved` (v1.1, additive — PR 2)

- **`screen.run` / `screen.count` take exactly one of:**
  - `spec`: the screener's JSON spec;
  - `saved_id`: one of **the member's own** saved screens. The service's member-scoped `saved_screens.get(id, user_id)` is used, so another member's id answers "no saved screen";
  - `text`: the screener's criteria language, through the same deterministic path as `/grammar/parse`: `grammar.compile_text` → `logic.validate` → `grammar.resolve_scopes`, with scopes resolved for this member. It follows the screener's own gates (`SCREENER_LOGIC_ENABLED`; `SCREENER_ALERT_GRAMMAR_ENABLED` for `$`/`#` scopes).
- **Every source** then passes the same field-catalog validation. `data.origin` says which source was used: `{source:"spec"}`, `{source:"saved", id, name}` or `{source:"text", text, explanation}`.
- **`/api/screener/compile`** (English → criteria via a paid model call) is **not** used. The Agent's planner writes criteria text and the screener parses it, so the Agent's model-call count and budgets are unchanged.
- **`screen.saved`** returns `data.screens: [{id, name, spec, runnable, reason?}]`, the member's own screens only, read-only and never `init()`.
  - A screen the Agent cannot run (e.g. an indicator condition) is listed with `runnable: false` and its reason, never hidden.
  - `coverage` counts screens: `answered` = runnable, `not_computable` = not runnable.
  - `as_of` is the newest screen's `updated_at`.
  - It is a `scan`-category kind, so it uses the turn's one scan; to run a known screen, use `screen.run` with `saved_id`.

## 2c. Relative volume (v1.3, additive)

**Why this lives here and not in MD-1:** see MD-1 §4.3. Relative volume is not an MD-1 kind. This section is the **single authority** for the Agent's relative-volume definitions and wording. `services/volume_live.py` is not exposed, and nothing in the Agent computes relative volume itself.

Two screener fields carry it. Both are read through `screen.run` / `screen.count` like any other catalog field.

| Field | Definition (owned by the screener, quoted from its code) | Say it as | Freshness |
|---|---|---|---|
| `vol_ratio` | `technicals.volume_ratio`: a session's volume over the mean of the **prior** 30 sessions (today excluded) | "volume vs its 30-day average (full day)" | periodic. Dated by the envelope's `as_of` (§2a), the last completed session. |
| `rvol_live` | the screener live tier: today's volume / (`avg_volume_30d` × the share of a session's volume usually done by now: the ticker's own curve, else the market's) | "**vs 30-day average at this time of day**" | periodic (an intraday sweep). Its time is the overlay's own, named in the envelope's live-overlay note (§2a), never the envelope's `as_of`. |

**Rules**
- A "volume surge / unusual volume right now" question is `screen.run` sorted by `rvol_live` (descending), labelled "vs 30-day average at this time of day".
- **No overlay, no surge reading.** `rvol_live` is NULL before 09:45 ET, outside the session, or when the live tier does not serve a row. Those names count in `coverage.not_computable`, never as low volume.
  - When no returned row carries a live value, the answer says so and offers `vol_ratio` (full day) instead.
  - It **never** substitutes one field for the other silently, and never words `vol_ratio` as "today so far".
- Neither field is ever called "live" or "now" without its time: the overlay's time for `rvol_live`, the session for `vol_ratio`.

*Implementation status:* both fields and their envelope disclosures already work through `screen.run` (§2, §2a). The discovery planning that applies these rules to a member's question is SC-1 PR 3.

## 3. Specs

- **The spec is the screener's own JSON spec,** validated against its field catalog (`/api/screener/fields`). There's no Agent filter language.
- **Natural language** goes through the existing `/grammar/parse` and `/compile` entry points (`screener_nl.py`).
- **The result** is a spec the member can see. Run and save it in the Screener unchanged.

## 4. Budgets

MD-1 §5 applies:
- 1 scan read per turn, at most 50 rows returned;
- the scan's provider requests count toward the turn's 20;
- enriching scan rows with quotes uses `quotes` reads, which count as logical reads.

## 5. Changes

These follow MD-1 §8.
