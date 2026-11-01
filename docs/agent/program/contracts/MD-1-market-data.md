# MD-1 — UCT market-data contract (v1.3)

- **Owner:** agent-md implements the kinds. agent-lead owns `gateway.py` and `envelope.py`, the framework every consumer relies on.
- **Consumers:** agent-sc, agent-rs, agent-qa, and later the D and G workstreams.
- **Status:** v1.3 (v1.1–v1.3 each additive or a scope reduction, all acked by agent-lead 2026-11-01). See §9 for what changed. The envelope's wire field `contract` stays `"MD-1.0"`: v1.1 adds no envelope field.
- **Changes:** see §8.

## 1. Purpose

**One reusable server-side market-data contract for UCT.** It is not a fourth isolated pipeline. MD-1 defines:
- **the envelope:** what a market-data read returns, wherever it comes from;
- **the rule:** each kind is an adapter over the service UCT already treats as canonical.

The Agent is the first consumer. The envelope and the adapters are written so other UCT server code can call `gateway.read()` or the adapters later. Voice/Compass and AI Search are **not** changed in Sprint 1; their behaviour stays exactly as it is.

## 2. Interface

| | |
|---|---|
| Server | `api.services.uct_agent.marketdata.gateway.read(kind, params, *, user_id, turn_id, purpose) -> DataEnvelope` |
| HTTP | `POST /api/agent/data` with `{kind, params, purpose, turn_id}`. Admin-dark (`require_admin_dark`), and refused unless `UCT_AGENT_DATA=1`. |
| Browser | `app/src/agent/marketdata/client.js` `readData(kind, params, {purpose, turnId})`. This is the only way a capability reads market data; capabilities never `fetch()` market endpoints. |
| Config | `GET /api/agent/config` → `data`, `scan` (both `false` by default) |
| Purposes | `answer` · `scan` · `research` |

## 3. DataEnvelope

Built with `envelope.make_envelope` and checked by `envelope.validate_envelope`. The gateway validates every envelope before it leaves; an adapter that breaks the contract is answered `unavailable`.

| Field | Type | Rule |
|---|---|---|
| `contract` | `"MD-1.0"` | |
| `kind`, `params_echo` | str, object | |
| `status` | `ok` · `partial` · `unavailable` · `refused` | `partial` means some symbols or rows are missing; say which in `notes` or `coverage` |
| `freshness` | `live` · `delayed` · `periodic` · `historical` · `unavailable` | **Mandatory.** Ordered freshest first. `unavailable` if and only if status is `unavailable`/`refused`. |
| `as_of` | ISO-8601 UTC `…Z`, or `null` | **The data's own source time,** never the fetch time. `null` only when the source has none, and then `notes` must say so. |
| `fetched_at` | ISO-8601 UTC | When the gateway built the envelope |
| `delay_s` | number or null | **Required** when `freshness == "delayed"` |
| `stale` | bool | True when the data is older than the kind's freshness budget (§4) |
| `source` | str | `massive`, `fmp`, `uct-breadth-v2`, `uct-screener`, `flow-worker`, … |
| `coverage` | `{evaluated, answered, dropped, not_computable}` or null | Required for scan kinds and bulk reads |
| `data` | object or null | Kind-specific, documented per kind. `null` when unavailable or refused. |
| `notes` | [str] | Things the answer **must** surface, e.g. "market closed — last session's close" |
| `provider_calls` | int ≥ 0 | Underlying upstream requests this read caused; a cache hit is 0 |

**What each freshness class means**
- **live:** streaming or polled within seconds, during market hours.
- **delayed:** a known feed delay.
- **periodic:** recomputed on a schedule.
- **historical:** a completed past period.

**Rules for answers**
- A present-tense answer uses the freshest kind available and states `as_of`.
- Periodic, historical or delayed data is never worded as "live" or "now".
- A read may report a *less* fresh class than its kind declares (e.g. `historical` while the market is closed), never a fresher one. The gateway enforces this.

## 4. Kinds — v1

Each kind wraps the canonical service listed. **No new upstream connection, WebSocket, scheduler job or database.**

| Kind | Canonical service | Declared freshness | Freshness budget (`stale` after) | Notes |
|---|---|---|---|---|
| `quote`, `quotes` | `services/massive.py` snapshot (read-only call) | live | 60 s in the regular session | **Not** the `/api/live-prices` route: its cache miss runs `watchlist_alert_service.run_alert_check()`. **Price reads must never trigger alerts.** Session and freshness are classified **by vendor timestamp** (§4.1). |
| `bars.daily` | `services/bars_fetch.py` | historical (completed sessions) | 1 session | Today's partial bar is not a completed daily bar |
| `bars.intraday` | `services/bars_fetch.py` | delayed or live, as the source reports | per source | Sprint 1 only if `bars_fetch` exposes a source time |
| `fundamentals` | `services/financial_statements.py` `get_statements` (Yahoo Finance, the product's statements cache) | periodic | the newest period end is more than 135 days old | Periodic financial **disclosures**, never live. `as_of` = the newest statement period end; the source has no filing date. See §4.2. |
| `earnings` | `services/earnings_table.py` `get_earnings_table` (the layer over `earnings_estimates`) | periodic | `stale_quarters` ≥ 2 (its own `reported_staleness`) | Event-driven results stay class `periodic`. Reported rows carry only a fiscal label, so `as_of` is null with a note; `next_report` is a scheduled event, never `as_of`. See §4.2. |
| `news.company` | `services/news/store.py` `feed` (UCT's own store; no provider call) | periodic | news **ingest** has not succeeded for 1 hour | Item `as_of` = `published_at`; the envelope `as_of` is the newest item. A quiet company is not stale. No body text. See §4.2. |
| `breadth.current` | `services/breadth_current.py` (MI-owned) | periodic | its own `stale` flag | Delegate; never copy breadth data. The V2 runner is the only producer. |
| `nhnl` | — **not a separate kind** (v1.3) | — | — | 52-week / 20-day new highs and lows are METRICS of `breadth.current` (`new_52w_highs`, `new_52w_lows`, `net_new_high_low`, `new_20d_highs`, `new_20d_lows`), tier `finalized_only`. `services/nhnl_live.py` is an intraday high-of-day / low-of-day EVENT COUNTER, a different metric with no vendor time, and is **not exposed**. |
| `themes` | `services/theme_performance.py` overlay, read **without building** (§4.3) | periodic | the base predates the last completed session | Never spends provider calls: no complete overlay ⇒ `unavailable` (“theme data is warming”). See §4.3. |
| `ratings` | `services/research/ratings.py` | periodic | 1 day | |

### 4.1 `quote` / `quotes` freshness (v1.1)

The session is classified from the ET clock and the product's trading-day helper (`massive._today_et_is_a_trading_day`, `bars_fetch._session_close_minutes` for early closes). It does **not** use `massive._detect_session`, which labels 20:00–04:00 and weekends `post_market`. Staleness is always judged from the vendor's own observation stamps (`_observed_at`), never from fetch time.

| Session (ET) | Freshness | `stale` | Note |
|---|---|---|---|
| Regular, 09:30 to the session close, on a trading day | `live` | oldest live stamp > 60 s | — |
| Extended (04:00–09:30, close–20:00, trading day), oldest live stamp ≤ 15 min old | `live` | false | `extended-hours (pre-/post-market) prices — thin trading; the regular-session close is in day_close/prev_close` |
| Extended, oldest live stamp > 15 min old | `historical` | false | the closed note |
| Overnight 20:00–04:00, weekends, holidays | `historical` | false | `the regular session is not open — these are the last prints from the most recent session, not live prices` |
| Regular, but no row has a current trade | `historical` | false | `no current trade in the snapshot — these are the latest closes, not live prices` |

The extended and closed notes never appear together.

**Per row:** `last_source` ∈ `trade` · `minute` · `day_close` · `prev_close` says where `last` came from.
- In a `live` read, a row priced from `day_close` or `prev_close` is **not live**. The read is `partial`, with the note `no current trade for X — showing <source>`.
- That row's stamp is **excluded** from the envelope `as_of`. In a live read, `as_of` is the oldest stamp among the rows priced from `trade`/`minute`, and a multi-row read notes `as_of is the oldest current trade in this set`.
- In a `historical` read, `as_of` is the oldest stamp of all rows, with the note `as_of is the oldest quote in this set`.

**Row fields:** `symbol, last, last_source, change, change_pct, open, high, low, day_close, volume, prev_close, as_of`.

**`data.session`** is `regular` · `extended` · `closed`.

### 4.2 `fundamentals` / `earnings` / `news.company` (v1.2)

All three are class `periodic`; none is ever worded as live or "now". The stale budgets measure the **data**, not a refresh cadence: they replace v1.0's "7 days", "1 day" and "1 hour" wording.

**`fundamentals`**
- `stale` when the newest reported period end is more than 135 days old, about two quarters plus a filing lag.
- `provider_calls` is 6 when this read caused the service's synchronous build, else 0.
- Notes: `periodic financial disclosures — figures describe the reporting period in as_of, not today`; `the source gives no filing date; as_of is the period end`; `served from the last stored copy while the source refreshes` (a stored copy being refreshed). A statement type with no rows makes the read `partial`.
- Row fields: `period_end, values`.

**`earnings`**
- `as_of` is null. The note is `reported quarters carry no report date — as_of is not given; reported through {label}`.
  - Why null, and not a gap: the **reported** rows (the results) carry only a fiscal label, with no report date and no period end. The forward rows do carry `period_end` and `report_date`, but those describe **future** quarters and the next scheduled event, not the time of the reported data. Using them as `as_of` would date past results with a future date. So the source has no time for this data (MD-1 §3), and the note names `reported_through` instead.
- `stale` when `stale_quarters` ≥ 2, with the note `reported results are {n} quarters behind what a typical filer has reported by now`.
- `next_report` = `{report_date, quarter, eps_estimate, rev_estimate, kind}`, taken from the same payload's nearest forward row (no second read), with the note `next_report is a scheduled event, not a result` or `no scheduled next report date is known`.
- No reported quarters is `unavailable`. `provider_calls` is 1 per read (the payload cannot say whether it was built).
- Row fields: `quarter, eps_actual, eps_estimate, eps_surprise_pct, rev_actual, rev_estimate, rev_surprise_pct`.

**`news.company`**
- `stale` from ingest health: the newest successful ingest across all news sources (`health_snapshot().sources[].last_ok`) is older than 60 minutes, with the note `news ingest has not succeeded for over an hour; recent stories may be missing`. Unknown health is stale, with the note `news ingest health is unknown; recent stories may be missing`.
- Zero items is `ok`, with an empty list and the note `no news items are stored for {sym} — that is not a sign of stale data`. Otherwise the note is `each item's as_of is when it was published; the envelope as_of is the newest item`.
- At most 25 items. `provider_calls` is 0.
- Item fields: `headline, url, source, source_class, category, sentiment, as_of`.

The canonical services' own stale-while-revalidate refresh and the news store's first-use schema init are each service's own behaviour (agent-lead, 2026-11-01). The adapters add no job, connection or write.

### 4.3 `themes` (v1.3) and relative volume

**`themes`**
- Source, in order:
  1. the shared overlaid cache (`theme_performance._OVERLAID_KEY`);
  2. the member route's last complete overlay (`api/routers/theme_performance._THEME_STALE.peek`, within the route's age bound);
  3. otherwise `unavailable` with the note `theme data is warming — no complete theme overlay is available yet` and `provider_calls` 0. A cold rebuild is about 22 Massive calls, more than a turn's budget.
- **`as_of`:**
  - while a US session can print (`prices_moving()`), the overlay re-prices every period and carries only UCT's apply time. So `as_of` is null, `data.live_applied_at` gives that time, and the note `returns include intraday prices applied by UCT at {at} (UCT's apply time; the vendor's observation time is not carried) — not a live feed` is added. It is never worded as live;
  - **Why null, not `live_applied_at` (same rule as §4.2):** `live_applied_at` is when UCT **applied** the prices, a computation time like `fetched_at`, which §3 forbids as `as_of` (agent-lead ruling). The time the data itself describes would be the vendor's observation time of the snapshot prices, and the overlay does not carry it. The values also mix live prices with each holding's completed-session reference close, so there is no single honest data time to state. The time UCT does have is given separately, labelled as an apply time, so a reader can say how recent the recompute was without calling it the data's time.
  - otherwise `as_of` is the last completed session's close (note `returns are as of the last completed session's close`).
- `stale` when the base's `generated_at` predates the last completed session.
- A theme with no value for the requested period counts as `not_computable`, and makes the read `partial`.
- Row fields: `name, ticker, sector, return_pct, holdings`. Params: `period` ∈ 1d, 1w, 1m, 3m, 1y, ytd, `order` ∈ leaders · laggards, `limit` ≤ 30.

**Relative volume is not an MD-1 kind (v1.3).** Agent answers use SC-1 `screen.run`; see SC-1 §2c ("Relative volume"), which is the single authority for its definitions and wording. `services/volume_live.py` is not exposed.

**Deferred until a verifying spike is done (agent-md, ADR-003):**
- **`flow.summary`:** only through the existing flow proxy (`api/flow_proxy.py`), after verifying from `web` that the data is really available. Never by importing `flow_router` in-process: `flow.db` lives on flow-worker. Never a second Massive connection.
- **`darkpool`:** only once a trustworthy `as_of` source is identified.

## 5. Budgets

The gateway counts **both** logical operations **and** underlying provider requests, per Agent turn (`turn_id`).

| Counter | Counts | Limit per turn | Constant |
|---|---|---|---|
| Logical reads | every gateway read (one `read()` call) | 8 | `MAX_READS_PER_TURN` |
| Scan reads | reads of a `scan`-category kind | 1 | `MAX_SCANS_PER_TURN` |
| Provider requests | the sum of `provider_calls` from those reads (cache misses that reached Massive, FMP, …) | 20 | `MAX_PROVIDER_CALLS_PER_TURN` |
| Symbols per read | tickers in one read | 50 | `MAX_SYMBOLS_PER_READ` (a kind may set lower) |

**How the counters work**
- A logical read is counted when it's admitted, before it runs.
- Provider requests are counted from the envelope it returns.
- Once any limit is reached, further reads that turn are `refused` with the reason. A read is never partly run.

**These limits add no model calls and no dollars.** They sit **under** the existing caps, which are unchanged:
- the $5/ET-day Agent model budget (`budget.py`);
- the shared $15 AI ledger;
- at most 2 model calls per request;
- 1 web research call per turn;
- the rate limits in `limits.py`.

Changing any MD-1 limit needs agent-lead approval. Changing any $ or model-call limit needs the owner's approval.

## 6. Adapter rules (agent-md)

1. **Wrap, don't fork.** Call the canonical service's existing read function with its own cache. Don't copy its logic or data.
2. **No side effects.** No alert checks, no writes, no scheduler registration, no new connections.
3. **Report `provider_calls` honestly.** If the service can't tell you whether it hit the cache, count 1 per upstream call it might make.
4. **No secrets or raw provider payloads in `data` or logs.** Map to the documented per-kind fields.
5. **Every kind registers in `api/services/uct_agent/marketdata/kinds.py`** via `registry.register(Kind(...))`, with its declared freshness and owner. Nobody edits `gateway.py` to add a kind.

## 7. Conformance

QA's suite runs `validate_envelope` against every registered kind using its fixtures. It also checks that:
- the declared freshness matches;
- no read triggers an alert check;
- the budgets refuse correctly.

## 8. Changing this contract

1. Open a PR that edits this file, with a version bump (v1.1 adds; v2.0 breaks). Message agent-lead.
2. Breaking changes need an ADR and every consumer's acknowledgement in their status file.
3. Consumers code against the contract and QA's fixtures, never against an unmerged producer branch.
4. The envelope's wire field `contract` tracks the envelope **shape** only. A version that changes semantics or documentation but no envelope field (v1.1) keeps `"MD-1.0"`.

## 9. Changelog

- **v1.3 (2026-11-01, agent-md, rulings by agent-lead):** `themes` source and time semantics (§4.3); `volume.surge` REMOVED (relative volume is SC-1's; see SC-1 §2c); `nhnl` folded into `breadth.current` metrics, `nhnl_live` not exposed. No envelope change.
- **v1.2 (2026-11-01, agent-md):** additive. `fundamentals`, `earnings` and `news.company` sources are named in §4 (`financial_statements`, `earnings_table`, the news store), and their stale budgets are restated to measure the data (§4.2). Every class stays `periodic`; the wire `contract` stays `"MD-1.0"` (§8.4).
- **v1.1 (2026-11-01, agent-md, acked by agent-lead):** additive. `quote`/`quotes` classify extended hours by vendor timestamp; each row gains `last_source`; a close-priced row in a live read makes it `partial` and is excluded from `as_of`; `data.session` becomes `regular` · `extended` · `closed`. The pre-market note contradiction is removed (§4.1). No envelope field changed.
- **v1.0 (2026-11-01):** first accepted version.
