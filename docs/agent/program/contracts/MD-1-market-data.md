# MD-1 — UCT market-data contract (v1.9)

- **Owner:** agent-md implements the kinds. agent-lead owns `gateway.py` and `envelope.py`, the framework every consumer relies on.
- **Consumers:** agent-sc, agent-rs, agent-qa, and later the D and G workstreams.
- **Status:** v1.9 (v1.1–v1.9 each additive or a scope reduction; v1.1–v1.4 acked by agent-lead 2026-11-01, v1.5 agreed for Sprint 2; v1.6, v1.7, v1.8 and v1.9 are additions whose new kinds are default OFF; v1.7 is written up after its kinds merged dark, v1.8 and v1.9 with their kinds; v1.7 and v1.8 acked by the owner 2026-11-17 in place of agent-lead, whose session has ended; the §8.1 notice for v1.9 is owed by a person and is not acknowledged, see §9). See §9 for what changed. The envelope's wire field `contract` stays `"MD-1.0"`: no version since v1.0 adds an envelope field.
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
| `breadth.current` | `services/breadth_current.py` `reading()` (breadth-owned; V2 store + live engine) | periodic (intraday) · historical (completed sessions) | not `current` (its own rule: intraday ≤ 300 s) | **MODEL-ISOLATED** (§4.4). US · NYSE · Nasdaq aggregates only; includes the NH/NL measures. |
| `nhnl` | — **not a separate kind** (v1.3) | — | — | 52-week / 20-day new highs and lows are METRICS of `breadth.current` (`new_52w_highs`, `new_52w_lows`, `net_new_high_low`, `new_20d_highs`, `new_20d_lows`), tier `finalized_only`. `services/nhnl_live.py` is an intraday high-of-day / low-of-day EVENT COUNTER, a different metric with no vendor time. It is **not** an `nhnl` kind and never a `breadth.current` measure; since v1.7 it is read only by the separate, model-isolated kind `highsLows.session` (§4.10), which is default OFF and says in every answer that its counts are not 52-week highs and lows. (v1.3 to v1.6 said "not exposed".) Since v1.8 the NAMES behind `new_52w_highs` and `new_52w_lows` are read by the separate, model-isolated kind `highsLows.yearly` (§4.11), default OFF; the counts stay `breadth.current` measures. |
| `themes` | `services/theme_performance.py` overlay, read **without building** (§4.3) | periodic | the base predates the last completed session | Never spends provider calls: no complete overlay ⇒ `unavailable` (“theme data is warming”). See §4.3. |
| `ratings` | `services/research/ratings.py` `get_ratings` (UCT-derived) | periodic | price data older than the last completed session | **MODEL-ISOLATED** (§4.4). Never a third-party analyst rating. |

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

### 4.4 Model-isolated kinds: `breadth.current`, `ratings` (v1.4)

**Isolation.** Both kinds carry UCT-derived values, which the owner has not cleared for the model (breadth contract rule 8; agent-lead ruling 2026-11-01). They are registered `model_isolated=True`, so the gateway serves them **only for purpose `answer`**, rendered to the member through the local-result boundary. Every other purpose is refused before admission and spends no budget. **Dormant by default (ADR-005, #599):** unless the kind is armed per kind — listed in `UCT_AGENT_ISOLATED_KINDS` and `UCT_AGENT_DATA_KINDS`, with the master switch `UCT_AGENT_ISOLATED=1` (all default off, and only with `UCT_AGENT_DATA` on; since 2026-11-14 the master switch alone arms nothing) — both kinds are refused for **every** purpose, `answer` included, with the note "this data is not available to UCT Agent yet". The browser-supplied purpose is never the only gate. Whether these values may ever reach the model is an owner decision, together with the breadth owner.

**`breadth.current`** (`docs/breadth/current-reading-contract.md` is the source contract)
- Params: `universe` ∈ us · nyse · nasdaq and `metric`, a breadth measure name. The NH/NL measures are `new_52w_highs, new_52w_lows, net_new_high_low, new_20d_highs, new_20d_lows`.
- `status` intraday → `periodic`; provisional / finalized → `historical`.
- `as_of` = `observed_at`: the vendor's snapshot time, or the session close. Never `computed_at`. When unknown, `as_of` is null with the note `the observation time of this reading is unknown`.
- `stale` = not `current`. The reading's `label` is always a note. When not current, the note is `not a current reading — this is {label}; a current reading is unavailable`.
- `stale_reason` is logged, not returned (contract rule 2).
- Tier notes: `approximate` → `an approximate count from the live method — never quote it to the single name`; `finalized_only` (including the NH/NL measures) → `this measure has no validated live reading — the value is the newest finalized session's`.
- No reading → `unavailable`, with the note `no breadth reading is available for {metric} on the {universe} universe`.
- `provider_calls` 0.
- Data fields: `universe, metric, value, status, session, label, accuracy_tier, current, finalized_session, market_open, population_drift`.

**`ratings`**
- Scale: `composite` and components (eps, rs, growth, value, smr, accdis, sponsorship) are 1–99, higher is stronger. `method` / `basis` say percentile-vs-universe (`universe_n`) or absolute band.
- `as_of` = the session close of `price_as_of`. Notes: `UCT Ratings are UCT's own computed scores (1–99), not a third-party analyst rating`; `the fundamental and ownership inputs carry no date; as_of is the price data's last session`.
- `stale` when `price_as_of` predates the last completed session, with the note `the price data ends {date}, before the last completed session ({session})`.
- `complete=False` → `partial`, with the note `one or more inputs could not be read; the scores are built on what was available`.
- `provider_calls` 3 per read.
- Data fields: `symbol, composite, components, checkup, method, basis, coverage, universe_n, sector, group_rs, price_as_of, complete`.

**Deferred until a verifying spike is done (agent-md, ADR-003):**
- **`flow.summary`:** only through the existing flow proxy (`api/flow_proxy.py`), after verifying from `web` that the data is really available. Never by importing `flow_router` in-process: `flow.db` lives on flow-worker. Never a second Massive connection.
- **`darkpool`:** only once a trustworthy `as_of` source is identified. **v1.7:** identified for dark pool price LEVELS only: `levels.darkpool` (§4.10) dates a read by the newest confirmed print date among the levels it returns, never by the build time. A dark pool PRINTS kind (the tape itself) is still deferred: no kind exposes it.

### 4.5 `stock.quote`: the answer contract over `quote` / `quotes` (v1.5)

**Additive data field.** Every `quote` / `quotes` read now carries `data.session_detail`:
`regular` · `premarket` · `after-hours` · `overnight` · `closed`.
- `overnight` runs from the end of extended trading (20:00 ET, or 17:00 ET on a half day) to 04:00 ET, around a
  trading day.
- Every input comes from `now` (default: the wall clock): the ET minutes and whether that ET date is a NYSE session
  (a weekday and not a full-closure holiday). Nothing reads today's date separately (agent-qa F-19).
- `closed` is a weekend or holiday, or a calendar the adapter could not read (it never claims the market is open).
- `data.session` (v1.1) is derived from it: premarket and after-hours → `extended`; overnight → `closed`. The two
  labels can never disagree.
- The early close is honoured, from `bars_fetch._session_close_minutes`.
- No envelope field changed, and the freshness rules of §4.1 are unchanged.

**The capability.** `stock.quote` lives in `app/src/agent/capabilities/marketDataQuote.js`. It answers
deterministically, with no model call. It makes one gateway read: `quote` for one symbol, `quotes` for two to
five. It never calls `/api/live-prices`.

**The answer, per session state.** The words *live*, *now* and *right now* appear only on a fresh live row.

| read | answer |
|---|---|
| live, not stale, `regular` | `NVDA $142.10, +$1.23 (+0.87%) vs the previous close — live, regular session, as of 10:31 AM ET.` |
| live, stale, `regular` | `… — stale, not a real-time price: the latest trade is from 10:20 AM ET, more than a minute old (regular session).` |
| live, `premarket` / `after-hours` | `NVDA $142.10 in premarket trading, … — live, extended hours (thin trading), as of 7:45 AM ET.` |
| historical, `premarket` / `after-hours` (no trade in 15 min) | `NVDA last traded $142.10 at 4:30 PM ET (after hours, no trade in the last 15 minutes), …. Not a real-time price.` |
| `overnight` / `closed` | `Market closed (overnight / weekend or holiday): NVDA last close $142.10 (Fri, Oct 30), …. Not a real-time price.` When the price is an after-hours print, it says `last trade $X (date, time ET)` instead. |
| `regular`, row priced from a close | `NVDA: no current trade in the regular session — showing the day's close, $142.10 …. Not a real-time price.` |
| `partial` (`quotes`) | one line per symbol, then `Partial: no price for NOPE.` |
| `refused` | `I couldn't get a price for NVDA: that request wasn't allowed for this question, so the price is not available. No price is stated.` |
| `unavailable` (or no priced row) | `I couldn't get a price for NVDA: the price is not available from UCT's market data. No price is stated.` |

**Rules for every answer:**
- **No-price answers use fixed words.** A read with no usable price answers from a closed list keyed on
  status only. The envelope's notes are never echoed, since they can carry numbers such as a budget count
  (agent-qa F-20).
- **As-of.** The as-of time is in ET, with the date when it is not the read's own ET day. The reference day is
  the read's `fetched_at`, never the browser clock.
- **Change.** The change is always against the previous close.
- **The session label.** It comes from `session_detail`, never from the member's words. A question that says
  "premarket" during the regular session is answered as the regular session.
- **What leaves the module.** Only `{text, present}` (plus `link` / `chart` from stock.profile when the gateway is
  off). The envelope, its notes, provider fields and `params_echo` never do. `present` carries the labelled
  figures: Price, Change, Session, Freshness.

**Flags off.** The gateway path is taken only when `GET /api/agent/config` reports `data: true` **and** its `data_kinds`
list (agent-lead #621, from `UCT_AGENT_DATA_KINDS`, fail closed) includes both `quote` and `quotes`. In every other
case (the default, an older server with no list, or `quote` not activated):
- `registerMarketDataCapabilities()` registers nothing, so the model's manifest is unchanged.
- `match()` returns null.
- `answerQuote` returns stock.profile's own answer, byte for byte. The rail is in `agentDataQuote.test.js`.

**Fast path.** `match(text)` is pure and fail-closed. It returns `{action: 'stock.quote', params: {symbols}}` or
null, and it is held row by row to `MD-1-phrasings.md`.
- **The hook.** The registration carries the fast path's own hook for query capabilities, `fastWhole: true` plus
  `fast({raw})`, so `fastPath.js` is unchanged.
- **One claimant.** `matchWhole` answers only when exactly one capability claims the sentence. A sentence another
  capability also claims goes to the model.
- **No guessed spellings.** `fastCorrect: false`: only the parser's own fixed typo list counts, never the shared
  spelling corrector.
- **Re-checked on every call.** `match()` re-checks the gate each time, so a capability registered earlier claims
  nothing once the server reports dark.

### 4.6 `stock.dailyBars`: answers over `bars.daily` (v1.5)

**The capability.** `stock.dailyBars` lives in `app/src/agent/capabilities/marketDataBars.js`. It answers
deterministically, with no model call. It makes one gateway read of `bars.daily`, with zero provider calls, and
uses **completed sessions only**: today's developing bar is never used. It is registered, and its fast path claims
anything, only while the server serves data **and** `data_kinds` includes `bars.daily`. Otherwise it registers
nothing. Like stock.quote, it takes the turn id from `currentTurnId()` at the read.

| measure | read | answer |
|---|---|---|
| `lastClose` | `bars: 2` | `AAPL closed at $142.10 on Fri, Oct 30, its last completed session: +$2.10 (+1.50%) vs the previous close of $140.00 on Thu, Oct 29.` |
| `change` (n sessions; weeks × 5) | `bars: n + 1` (n ≤ 250) | `NVDA over the last 5 completed sessions: +10.00% (+$10.00), from a close of $100.00 on Fri, Oct 23 to $110.00 on Fri, Oct 30.` |
| `range52w` | `bars: 252` | `NVDA 52-week range (the last 252 completed sessions, <first> to <last>): high $X on <date>, low $Y on <date>. Last close $Z on <date>.` The high and low come from each bar's high and low, never from its close. |

**Rules for every answer:**
- **Completed sessions, said.** Every answer ends with *From UCT's daily bars: completed sessions only, today's
  session is not included.* It never uses live / now / right now / real-time.
- **Dates.** Session dates are the bars' own ET trading dates. The year is added when it differs from the newest
  bar's year.
- **The store is behind (`stale`).** The answer adds *Note: UCT's bars for NVDA end <date>, but the most recent
  completed session was <date>, so this is not the latest close.*
- **Fewer sessions than asked (`partial`).** The window actually covered is stated, and nothing is extrapolated:
  - change: *the last 2 completed sessions held (you asked for 10)*;
  - range: *the 40 completed sessions held …, less than a full 52 weeks*;
  - a single bar gives no change.
- **No usable bars.** The answer uses fixed words keyed on status, never the envelope's notes:
  - refused: *I couldn't answer that for NVDA: that request wasn't allowed for this question, so its daily bars
    are not available. No price is stated.*
  - unavailable: *… its completed daily bars are not available from UCT's market data. No price is stated.*
- **What leaves the module.** Only `{text, present}`.

**Fast path.** `match(text)` handles the bars rows of `MD-1-phrasings.md` (P18–P24) and returns `{action:
'stock.dailyBars', params: {symbol, measure, sessions}}`.

**W2-B2 (builder-b, 2026-11-03) — ranges and comparisons.** `bars.daily` takes `from` (an ISO day): the bars on or
after it up to the cutoff (`to` or the newest completed session), ONE store read of up to 500 bars filtered in the
adapter, note `window: bars on or after <from>`; when the store's oldest held bar is after `from` the read is
`partial` with `the store's oldest held bar in the window is <first>, after the <from> asked for`; `from` after `to`
is refused before admission. `data.window_from` echoes it. `stock.dailyBars` gains three measures and a `from` arg:

| measure | read | answer |
|---|---|---|
| `offHigh` | `bars: 252` | `NVDA closed at $X on <date>, −12.34% (−$Y) below its 52-week high of $H on <date> (the highest high of the 252 completed sessions from <first> to <last>).` At the high: `… closed at its 52-week high …`. |
| `pullbacks` | `bars: 252` | the current pullback (close-to-close drawdown from the highest close, its date, the lowest close since and the sessions elapsed) beside the last three COMPLETED pullbacks of 3%+ (peak → low → the close that recovered the peak), as a table; fewer than three is said. |
| `range` with `from` (and `to`) | `from`, `to` | `NVDA from <from> to <to> (N completed sessions, <first> to <last>): high $X on <date>, low $Y on <date>. Close $Z on <date>.` |

Every answer keeps the §4.6 rules (completed sessions, dates named, stale / partial said, fixed no-bars words). "This week" (P21) and an intraday low (P26) go to the
model. The hook is `fastWhole` + `fast` with `fastCorrect: false`, the same as stock.quote.
`registerMarketDataCapabilities()` registers both capabilities, each only when its own kinds are active. Its return
value still means what it did in #624: true only when that call registered `stock.quote`.

### 4.7 Instrument and intent resolution (v1.5, owner decision after agent-qa's held-out set)

**The bar.** A wrong ticker, a wrong price, or a different security substituted for the one asked is a FAIL. A
zero-model answer is allowed only when BOTH the request (intent) and the security (instrument) are unambiguous.
Anything else asks, or goes to the model; it never executes.

**Two halves, two owners of truth.**
- **Intent** is decided on the client by the pure parser (`capabilities/marketDataPhrases.js`). It decides only what
  is being asked. It never decides what a word refers to.
- **Instrument** is decided on the server by the kind `instrument.resolve`, from UCT's canonical symbol index
  (`services/ticker_search_index.py`). That index is built from Massive's reference tickers plus cap_universe, held
  in memory, and read with no provider call. **No word list carries instrument logic.** The only lists are intent
  grammar (price, premarket, close …) and the normalisation of corporate-form words in company names (Inc, Corp …).

#### 4.7.1 Intent (client)

| intent | claimed when | MD-1 read after resolution |
|---|---|---|
| current quote | a price, quote or session word, or nothing but `$` tickers | `quote` (1 symbol) / `quotes` (2–5) |
| last close | close / closed / closing, with no session word and no "today" | `bars.daily` {bars: 2} |
| N-session change | "N-day", "N sessions", "N weeks" (× 5) with a change or move word | `bars.daily` {bars: N + 1} |
| 52-week range | "52-week", "52 wk", "year high / low / range" | `bars.daily` {bars: 252} |
| **none** | anything else | the sentence goes to the model as today (a safe miss) |

Not claimed, whatever else the sentence says:
- **A time the parser cannot resolve without a clock:** history, ago, since, before, a weekday, a month, a date,
  yesterday, last / this / next week (or month, quarter, year), all-time, YTD, "on <date>", intraday, today's
  high / low / open.
- **A different request:** why, news, earnings, fundamentals, options, calls / puts, flow, dark pool, futures,
  alerts, targets, forecasts, buy / sell, currency conversion, volume, chart commands.
- **Shape problems:**
  - `&` anywhere (s&p, AT&T);
  - more than 5 candidate words;
  - two or more candidates without `and` or `,` (unless every one is `$`-typed);
  - a list (`and` / `,`) with an item that holds no candidate ("nvda and on price");
  - a word that is neither intent grammar nor a candidate.

Every word that is not intent grammar is a **candidate**, recorded with how it was typed: `cashtag` (`$nvda`),
`upper` (`NVDA`) or `lower` (`nvda`, `Nvda`). The parser sends candidates and their forms to `instrument.resolve`.
It never decides whether one is a security.

#### 4.7.2 Instrument (server, `instrument.resolve`)

One class per candidate, from the index's own row and the typed form:

| class | rule | example |
|---|---|---|
| `symbol` | exact symbol, index type `stock` or `etf`, typed UPPERCASE or as an all-capitals cashtag; or typed lowercase (or a lowercase cashtag) and confirmed by §4.7.5 | `NVDA`, `$BTC`, `IT`, `BRK.B`, `nvda`, `$nvda` |
| `symbol_typed_lowercase` | exact stock / ETF symbol, typed lowercase or as a lowercase cashtag, that §4.7.5 does not confirm | `gold`, `btc`, `$sol`, `dow`, `spy` |
| `name_match` | not a symbol; exactly ONE stock / ETF whose normalised name equals the word (not for `$` words) | `apple` → AAPL |
| `non_equity` | exact symbol the index types `index`, `theme` or `breadth` | `SPX`, `spx` |
| `unknown` | anything else: a misspelling, a plain word, several equal names, a `$` word that is no symbol | `nvdia`, `bitcoin`, `$NVDIA` |

- **A cold, empty or unreadable index** answers `unavailable` for the whole read: no class, no price.
- **Budget:** `max_symbols` is 5, 0 provider calls, and `validate=` refuses a malformed request before admission.
- **Freshness:** `freshness` is `periodic`; `as_of` is the index build time; stale after 3 days.

#### 4.7.3 Outcomes (the member's answer)

**All or nothing.** A price or bars read happens only when EVERY candidate is `symbol`. Otherwise the answer is
built from the first candidate that is not, in this order of precedence: unavailable index, `non_equity`,
`unknown`, `name_match`, `symbol_typed_lowercase`. No number is ever stated in these answers.

| situation | answer (fixed words) |
|---|---|
| all `symbol` | the §4.5 / §4.6 answer, **naming each security from the index**: `NVDA (NVIDIA Corporation) $142.10 …` |
| `symbol_typed_lowercase` | `I'm not sure which instrument "btc" means. I can quote US-listed stocks and ETFs by ticker. Type the ticker in capitals and I'll get it.` |
| `name_match` | `I'm not sure which instrument "apple" means. I can quote US-listed stocks and ETFs by ticker. Type the ticker in capitals and I'll get it.` |
| `non_equity` | `I can quote US-listed stocks and ETFs by ticker. SPX isn't one I can price here.` |
| `unknown` | `I can quote US-listed stocks and ETFs by ticker. nvdia isn't one I can price here.` |
| index unavailable | `I can't check ticker symbols right now, so I'm not stating a price.` |

- **No substitute is ever offered** for `non_equity` or `unknown`: never "try SPY" (agent-lead ruling a).
- **The member confirms by typing the symbol** in capitals or with `$` (ruling b). That is a new turn, through the
  same rules.
- **A clarification names no security** (owner ruling, 2026-11-02). It quotes the word as typed and says what
  can be quoted. The index's candidate is never offered, so a lowercase `btc`, `gold`, `dow`, `eth` or `sol` is
  never answered with an unrelated fund or company that happens to hold that ticker.
- **An UPPERCASE or `$` symbol** is the member's explicit choice. It is priced with the index name shown (ruling c).
- **A fund is labelled a fund** (owner ruling, 2026-11-02). When the index types the symbol `etf`, the name reads
  `BTC (Grayscale Bitcoin Mini Trust, an ETF)`, and the answer adds, once: `An ETF's price is the fund's own share
  price, not the price of the asset it tracks or holds.` It never presents a fund's price as the underlying asset's
  (a cryptocurrency's spot price, gold's, an index level). Both rules key on the index's `type`, never a word list.

#### 4.7.4 Activation and budget

- **Activation:** `stock.quote` registers only while `data_kinds` includes `instrument.resolve`, `quote` and
  `quotes`. `stock.dailyBars` registers only while it includes `instrument.resolve` and `bars.daily`.
- **Budget:** one answered question costs 2 gateway reads (resolve + the price or bars read). The 8-read turn
  budget fits four 5-symbol compounds.

#### 4.7.5 A lowercase ticker (owner ruling 2026-11-02)

**The ruling.** Requiring capitals is not the permanent answer. A lowercase word resolves to its exact symbol only
when the canonical index confirms it unambiguously; otherwise the §4.7.3 neutral clarification stands. Everything
below is computed from the index's own rows (symbol, name, type) and the typed form. There is no word list.

**Which words take the checks.**
- A word typed in lowercase (or in an all-caps sentence, §4.7.1).
- A cashtag that is not all capitals: `$nvda`, `$sol`, `$Gold`.
- An explicit choice skips the checks: UPPERCASE (`NVDA`, `BTC`) or an all-capitals cashtag (`$BTC`, `$SOL`). These
  are priced as typed, and a fund is labelled one (§4.7.3).

**What the index has, and what it lacks.** Each row carries a symbol, a name, a type (`stock` / `etf` / `index` /
…), an exchange and a dollar-volume figure. It has no description and no "underlying asset" field, so "this fund
holds bitcoin" has to come from the type and from the names and symbols of other rows.

**The rule.** A candidate `t` whose exact row is `R` is classed `symbol` (priced) only when ALL of these hold. A
single failure leaves it `symbol_typed_lowercase` (the neutral ask). The failed checks are recorded in the result's
`basis`, for tests and audit, never shown to the member. A confirmed one carries `basis: ["lowercase_confirmed"]`.

| # | check | what it catches | `basis` on failure |
|---|---|---|---|
| L1 | `R.type` is `stock` | Every fund prices something other than itself (an index, a metal, a coin). In lowercase, the member may mean that underlying, so a fund is ambiguous by construction. `btc`, `eth`, `spy`, `qqq`, `gld` all ask. | `fund` |
| L2 | `t` abbreviates `R`'s own name: its letters appear, in order, in the name (a doubled letter counts once: `aapl` → Apple) | A ticker that coincides with a word or abbreviation, for a company whose name it does not spell: `sol` for Emeren Group Ltd. | `not_an_abbreviation` |
| L3 | `t` is not a whole ordinary word in ANY row's name (`R`'s own included), and not part of a longer word in `R`'s own name | Word-like tickers: `gold`, `dow`, `meta`, `roku` and `uber` (a word of a name); `coin` (**Coin**base), `link` (Inter**link**), `snow`, `shop`, `spot`, `key`, `jpm`. | `name_word` |
| L4 | no other row's symbol STARTS with `t`, unless that row is consistent with `R` | A shared root names an underlying or a theme, not one instrument: `btc` in BTCO, `eth` in ETHA, `sol` in SOLZ, `ibm` in the iShares iBonds IBMx series. A token buried inside a symbol (BAMD, DJINTCUN) is a coincidence of letters and does not count. | `symbol_root` |
| L5 | the index scan is complete (fewer than `SCAN_LIMIT` = 400 hits) | A capped result is never read as "no collision". | `scan_incomplete` |
| L6 | the index is fresh: built within `INDEX_STALE_S` (3 days) and dated (G2) | Every check above reads "no collision" from the index's silence; an old index can lack a listing added since, so it confirms nothing. The envelope already says `stale: true`. Explicit capitals are unaffected. | `index_stale` |

**Consistent rows.** Such a row is the same family as `R`, so it is not a collision:
- **For L3 and L4:** the row's mixed-case name names `t` as the exact upper-case ticker ("GraniteShares 2x Long
  **NVDA** Daily ETF"). In an all-upper-case name, capitals are not evidence, so it never counts there.
- **For L4 only:** the row's name carries `R`'s leading company word, at least 4 letters. Examples: "Cboe
  **NVIDIA** Call Writing Index" (NVDACW) for Nvidia Corp; "**Super Micro Computer** … Depositary Shares" (SMCIP).
- **Not for L3:** a word-like ticker must still collide with rows that carry its word, so "Dow Jones" still blocks
  `dow`.

**Monotone and fail-safe.** Adding rows to the index can only add collisions, so a bigger index turns a resolve
into an ask, never the reverse (railed: `test_adding_rows_never_turns_an_ask_into_a_price`). An unready index stays
`unavailable`.

**Signals evaluated and not used.**
- **Dollar volume.** A lowercase word has at most one exact row, so there is never a tie to break, and popularity
  is never permission to guess.
- **Request shape.** "price of amd" and "price of gold" have the same shape, so shape cannot separate them; only
  the instrument signal can.

**Where `eth` and `sol` land: both ask, each on two independent checks.**
- `eth`: in production ETH is "Grayscale Ethereum Staking Mini ETF Shares". It fails L1 (a fund), L3 ("eth" starts
  "Ethereum" in its own name) and L4 (ETHA, ETHE…).
- `sol`: production holds no SOL row today, so it is `unknown` and gets the limit sentence. In an index where SOL
  is Emeren Group Ltd, it fails L2 ("sol" does not spell the name) and, wherever Solana funds or SOLV exist, L4.

**Measured against the production index.** agent-lead ran the probe read-only through `/api/ticker-search` on
2026-11-02, and it is checked in as `app/src/agent/marketdata/__fixtures__/prod-index-probe.json`.
- **Priced:** `nvda`, `tsla`, `aapl`, `msft`, `amd`, `brk.b`, `amzn`, `nflx`, `pltr`, `intc`, `smci`, `crwd`,
  `xom`.
- **Ask:**
  - `avgo` and `googl`: L2;
  - `jpm`, `gold`, `dow`, `meta`, `key`, `coin`, `roku`, `snow`, `shop`, `spot` and `uber`: L3;
  - `ibm`: L4;
  - `btc`, `eth`, `spy`, `qqq`, `iwm` and `gld`: L1.
- **Limit:** `sol` (no row).

**Intent rule added with it (§4.7.1).** A list ("X and Y", "X, Y") must have a candidate in every item. Otherwise
the sentence is not claimed. "nvda and on price" would otherwise price NVDA and silently drop the item the grammar
swallowed.

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

### 4.8 `research.company` (v1.6, agent-rs, contract RS-1)

A COMPOSED kind (Wave 2, W2-B1): `api/services/uct_agent/research/rs1.py`, specified in `RS-1-research.md`. It reads the
served `quote`, `news.company`, `earnings`, `fundamentals` (and `themes` for topic `strength`) through this gateway with
purpose `"research"` (so a model-isolated kind refuses before admission, §4.4), plus the turn's ONE web search
(`turn._research`, metered by `budget.Meter.research`), and returns `{facts, interpretation, unknown, sources}`. Every
figure in a fact comes from one of those input envelopes; a web sentence with a figure the gateway did not return is
stripped. Declared `live` only because a read may be LESS fresh than its kind (§3): the envelope's class is the least
fresh contributing input and `as_of` the oldest contributing fact's time. `provider_calls` is the web call alone
(nested reads report their own). Params: `{symbol, topic: move|strength|catalysts|general, question?}`. Default OFF
(`UCT_AGENT_DATA_KINDS`), like every kind.

### 4.9 `history.eventStudy` (v1.6, builder-b, W2-B2)

A thin kind over Market Intelligence's EXISTING event study (`api/services/market_intel/event_study.py`, Slice 2,
previously without a caller): `api/services/uct_agent/marketdata/history_event_study.py`. "Every time `symbol` met a
technical condition, what did it do over the next N sessions" — events, hit rate, average, median, best, worst, with a
baseline of all sessions. Params `{symbol, indicator: gap_pct|pct_from_sma|rsi|bb_pct_b|macd_hist, period?, op:
above|below|cross_above|cross_below, threshold, horizons? (1–252 sessions, at most 4; default 1, 5, 21), since?}`.
`gap_pct` is the opening gap vs the previous close from the stored opens / closes (`price_reads.daily_open_close`,
the same read-only loader), on ANY session — UCT's data carries no past earnings dates, and the answer says so.

- **Scope:** series kind `technical` only. A breadth-conditioned study carries UCT-derived values (ADR-005) and is
  refused before any read: "breadth-conditioned studies are not available to UCT Agent yet".
- **Envelope:** `historical`; `as_of` = the regular-session close of the last stored price session the study used;
  `stale` when that session predates the newest completed session; `provider_calls` 0. Notes always carried:
  `descriptive, not predictive: …`, `completed sessions only, …`, `shown to the member only; the model receives the
  request and counts, never a return`.
- **Data:** `study` = the member's part (`lead`, `text`, `table`, `caveats` from `event_study_answer.answer`);
  `summary` = the value-free part (event counts, dates, horizon labels and sample sizes, `small_sample`); `request`,
  `method`, `coverage`, the study's own `notes`.
- **LOCAL ONLY on the model path.** The capability `history.afterEvent` (`app/src/agent/capabilities/history.js`,
  query on the `market` target, `localOnly: true`) is in `turn.LOCAL_ONLY_ACTIONS`; a stored row replays as
  `LOCAL_RESULT_NOTE` plus `event_study.request_note` of the validated args (symbol, condition, windows, dates) —
  never a return. The member sees the table. Every answer ends with *Descriptive, not predictive: …* and dates the
  stored closes it rests on. Default OFF (`UCT_AGENT_DATA_KINDS`), like every kind.

### 4.10 Terminal data wave 1: `analyst.actions`, `highsLows.session`, `sectors.performance`, `leaders.longRun`, `levels.darkpool` (v1.7, terminal-data)

Five thin kinds, the Agent half of five UCT Terminal panels (UPDG, HILO, SCTR, LEAD, LVL). Each is an adapter over the
service its member route already reads (`api/services/uct_agent/marketdata/analyst_actions.py`,
`session_highs_lows.py`, `sectors_performance.py`, `leaders_long_run.py`, `darkpool_levels.py`; registered in
`kinds.py` with `owner="terminal-data"`). No new connection, job, database or write (§6).

**Status: dark, not armed.** Like every kind, each is served only when it is listed in `UCT_AGENT_DATA_KINDS` (with
`UCT_AGENT_DATA=1`). The four model-isolated kinds also need the master switch `UCT_AGENT_ISOLATED=1` and their own
entry in `UCT_AGENT_ISOLATED_KINDS` (§4.4, ADR-005); until then they are refused for every purpose, and once armed
they are served for purpose `answer` only. This section describes what the code does when a kind is switched on. It
does not switch anything on. As written (2026-11-17), no kind of this section is in production's list.

| Kind | Canonical service (member route) | Params | Declared freshness | `as_of` | `provider_calls` | Model-isolated |
|---|---|---|---|---|---|---|
| `analyst.actions` | `services/engine.py` `get_analyst_actions()` (`GET /api/analyst-actions`) | `{side}` | periodic | the morning wire's own date | 0 | **yes** |
| `highsLows.session` | `services/nhnl_live.py` `get_live(...)` (`GET /api/nhnl/live`) | `{limit, min_price, min_count}` | periodic · historical (market closed) | null (only UCT's tick time is known) | 0 | **yes** |
| `sectors.performance` | `services/sector_strength.py` `get_sector_strength(period)` (`GET /api/sector-strength`) | `{period}` | periodic | null (the ranking carries no time) | 0 warm, 11 cold | no |
| `leaders.longRun` | `services/scan_gainers.py`, `scan_volume.py`, `scan_ipo.py` (`GET /api/scans/…`) | `{list, limit}` | periodic | null (only UCT's computation time is known) | at most 1 | **yes** |
| `levels.darkpool` | `services/signature/darkpool_levels.py` `fetch_dp_levels(sym)` (`GET /api/signature/darkpool-levels`) | `{symbol}` | periodic (every read reports `historical`) | the newest confirmed print date among the levels | 0 | **yes** |

**Rules all five share**
- **A bad request is refused before any read.** Each kind's `validate` runs before admission (unknown `side`, `period`
  or `list`, an out-of-range `limit`, a `symbol` that is not one ticker): the read is `refused` and spends no budget.
- **A failed read is `unavailable`, never an empty answer.** A service that raises, is switched off, is still building,
  or returns a malformed payload gives `unavailable` with one fixed note. "No upgrades", "nothing made a new high",
  "no leaders" and "no levels" are said only when the service answered healthily with nothing in it, and that read is
  `ok` with a note that says so.
- **Never worded as live or now** (§3). Where the source carries only UCT's own polling or computation time, `as_of`
  is null, that time rides in `data` under a name that says what it is, and a note says why `as_of` is not given (the
  same rule as `themes`, §4.3).
- **The member's answer is built from the read's `data` and `status`.** The browser capabilities template their text from
  those; an envelope note is never echoed to the member as if it were data.

**Why four are model-isolated, and one is not.** A value is isolated when the owner has not cleared it for the model
(§4.4): UCT-derived output, or third-party text whose AI-processing right is unresolved.
- `analyst.actions`: the rows are third-party analysts' calls (a broker's rating and price target) relayed by the
  morning wire's vendors. Their AI-processing right is unresolved in the provider ledger, the same reason
  `catalysts.board`'s stored headlines are isolated.
- `highsLows.session`: the counts are UCT's own scanner output (its accumulator), a UCT-derived value.
- `leaders.longRun`: which names make a list is UCT's own selection (the top 5% of UCT's liquid universe against a
  reference close UCT verifies; UCT's volume records and listing set), a UCT-derived ranking.
- `levels.darkpool`: the levels are computed by UCT (its own bin width, dollar floor and ranking) from vendor prints.
- `sectors.performance` is **not** isolated: a fund's percent change between two daily closes is plain vendor price
  arithmetic, the same class as `bars.daily` and `themes`. No UCT score, rating or selection rule is involved.

Whether an isolated value may ever reach the model is an owner decision (§4.4). On the browser the four isolated kinds
are read only by local-only capabilities (`stock.analystActions`, `stock.sessionHighsLows`, `stock.longRunLeaders`,
`stock.darkPoolLevels` in `app/src/agent/capabilities/terminalDataLocal.js`, all in `turn.LOCAL_ONLY_ACTIONS`): the
model plans the lookup and never sees what came back. `sectors.performance` is read by `stock.sectorPerformance`
(`capabilities/terminalData.js`), an ordinary data read (`turn.DATA_READ_ACTIONS`). Each capability registers only
while the server lists its own kind.

**`analyst.actions`** (source `uct-morning-wire`)
- What it returns: the analyst upgrades, downgrades and price-target changes of the last morning wire pushed to this
  server, market-wide. The wire is pushed to the server and the service reads it: no provider call.
- Params: `side` ∈ all · upgrades · downgrades · pt_changes (default all).
- `as_of` = the wire's own date (`wire_date`), as the start of that Eastern day. It is a date, not a time of day. Notes:
  `analyst actions from the {date} morning wire; the list is served unchanged until the next wire is pushed, so it may not be today's`;
  `as_of is the morning wire's date (a date, not a time of day)`. The list is never worded as today's.
- `stale` = the service's own verdict (`wire_status` is not `fresh`), with the note
  `a newer morning wire is expected by now: this list is from {date}`.
- A wire with rows but no date: `as_of` is null, the read is `stale`, and the note is
  `the wire this list came from carries no date, so as_of is not given and the list cannot be called current`.
- A dated wire with no rows of the side asked for is `ok`, with the note
  `the {date} morning wire lists no analyst actions of this kind`.
- `unavailable`: no dated wire and no rows (`no morning wire with analyst actions is held on this server yet`); the
  service raising or answering with something that is not a payload (`the morning wire's analyst actions could not be read`).
- Data fields: `upgrades, downgrades, pt_changes` (a list each; a bucket not asked for is empty), `summary` (the count
  per bucket), `side, wire_date, wire_status` (fresh · stale · unknown). Row fields:
  `ticker, action, firm, from_rating, to_rating, price_target`.

**`highsLows.session`** (source `uct-nhnl-scanner`)
- What it returns: one row per stock that has printed a new high (or a new low) of the CURRENT SESSION, with a running
  `count` of how many times, busiest first, from UCT's intraday scanner (flag `NHNL_SCANNER_ENABLED`). Pre-market
  (`pre`), the regular session (`rth`) and after-hours (`post`) are counted separately. Read-only against the
  scanner's in-memory state: it never starts the scanner.
- **Not 52-week highs and lows.** Those are `breadth.current` measures (§4.4). Every `ok` read carries the note
  ``new highs and new lows of the SESSION (pre-market, regular and after-hours are counted separately), not 52-week highs and lows; `count` is how many times the stock has made one this session``.
- Params: `limit` 1–50 rows a side (default 15), `min_price` ≥ 0 (default 0), `min_count` 1–1000 (default 1).
- `as_of` is always null. The scanner's stamp is the time of UCT's own last tick (a polling time, like `fetched_at`);
  the vendor's observation time is not carried. `data.tick_at` gives UCT's tick time, with the note
  `counts as of the scanner's last tick at {at} (UCT's polling time; the vendor's observation time is not carried), so as_of is not given — not a live feed`.
- While a session is open the read is `periodic`, and `stale` when the last tick is more than 60 seconds old, with the
  note `the scanner's last tick is more than a minute old, so newer highs and lows may be missing`.
- With the market closed the read is `historical`, with the note
  `the market is closed: these are the counts of the last tracked session ({date}), not a current reading`.
- `unavailable`: a session is open but the scanner is not active
  (`the new highs and lows scanner is not running on this server, so no counts are available`); it has no tick time
  (`the new highs and lows scanner has not produced a reading yet`); the market is closed and no counts are held
  (`the market is closed and no session counts are held`); the service raising
  (`the new highs and lows scanner could not be read`).
- Data fields: `window` (pre · rth · post · closed), `active, date, asof, tick_at, group, value` (the last two always
  null), `highs, lows, highs_total, lows_total`. Row fields: `sym, price, pct, count, ts, dir`. `coverage` counts the
  rows the whole view holds against the rows returned.

**`sectors.performance`** (source `uct-sector-strength`)
- What it returns: the 11 SPDR Select Sector funds ranked by percent change, strongest first, from daily closes.
- Params: `period` ∈ Today · 1W · 1M · 3M (the service's own: 1, 5, 21 and 63 sessions; default Today).
- `as_of` is always null and `stale` is always false. The payload carries no time at all, and during a session the
  latest bar is still forming. Note:
  `the sector ranking carries no data time: each return is the fund's latest daily close against its close {n} session(s) back, cached for up to 15 minutes, and during a session the latest bar is still forming, so as_of is not given`.
- A fund whose daily bars could not be read is dropped by the service: the read is `partial`, the fund is listed in
  `data.missing`, and the note is `not ranked (its daily bars could not be read): {names}`. It is never ranked as 0.
- `unavailable`: no fund could be ranked
  (`the sector ranking is unavailable: no sector fund's daily bars could be read`); the service raising
  (`the sector ranking could not be read`).
- `provider_calls`: 0 when the service's cache for that period is warm; otherwise 11, one daily-bars request per
  fund, the most a cold read can make. That is over half of a turn's provider budget (§5). "Warm" is read from the
  service's own cache key (`sector_strength_<sessions>`); a rail fails if the service renames it.
- Data fields: `period, sessions, sectors, missing`. Row fields: `sector, ticker, change_pct`.

**`leaders.longRun`** (source `uct-scans`)
- What it returns: ONE of UCT's long-run leader lists per read, the preset scans the Scanner widget and the LEAD panel
  read.
- Params: `list` (required) ∈ 30D · 60D · 90D (the top 5% of liquid US common stocks by 30 / 60 / 90-session change) ·
  VOL1Y (trading more shares today than on any day in the last year) · VOLMAX (more than on any day on record) · IPO
  (first traded within the last year); `limit` 1–50 (default 20). The `list` keys are the LEAD panel's own lens keys
  (`app/src/pages/terminal/panels/longRunModel.js`); a rail reads both files.
- `as_of` is always null and `stale` is always false. The service's stamp is when UCT worked the list out, from a
  whole-market snapshot up to 30 seconds older; the vendor's observation time is not carried. `data.computed_at` gives
  UCT's time, with the note
  `worked out by UCT at {at} from a whole-market snapshot up to 30 seconds older (UCT's time; the vendor's observation time is not carried), so as_of is not given — not a live feed`
  (or `the list carries no time, so as_of is not given`).
- The service's two answers are kept apart:
  - `status: "computing"` (the list's reference is still being built) is `unavailable`, with the note
    `the reference for this list is still being built on the server; ask again in a few minutes`;
  - `status: "ok"` with no rows is `ok`, with the note
    `the list is empty: either nothing qualifies, or the market snapshot it is measured against was missing (before the open, or a feed miss) — the service cannot tell which`.
    It is never worded as "no leaders".
- Any other status, the service raising, or a malformed payload is `unavailable` (`the list could not be read`).
- More rows than `limit`: the first `limit` are returned in the list's own order, `data.count` is the whole list, and
  the note is `showing the first {n} of {total} names, in the list's own order`.
- `provider_calls`: 1 for an answered read (one shared whole-market snapshot, cached about 30 seconds by the service,
  which cannot say whether it was a hit). A reference build runs on the service's own background thread and is not
  this turn's.
- Data fields: `list, family` (gain · volume · ipo), `what, status, results, count, as_of` (the service's own stamp),
  `computed_at`. Row fields: `sym, price, prev_close, change_pct`, plus `change_nd, ref_close` (gain),
  `volume, ref_max, ratio` (volume) or `ipo_date` (ipo). `coverage` is the service's own receipt when it gives one.

**`levels.darkpool`** (source `uct-darkpool-levels`)
- What it returns: one stock's dark pool price levels. UCT clusters the stock's CONFIRMED dark pool prints over the
  last `rules.DPL_WINDOW_DAYS` sessions into price zones and keeps the top `rules.DPL_TOP_K` by dollar value, each at
  or above `rules.DPL_MIN_CLUSTER_NOTIONAL`. A local read of the nightly-confirmed print ledger: no provider call.
  Every `ok` read carries the note
  `price zones where confirmed dark pool prints bunched up over the last {days} sessions, the top {k} by dollar value, each ${floor:,.0f} or more; computed by UCT from the nightly-confirmed print ledger, never intraday`.
- Params: `symbol`, one ticker by the member route's own rule (letters, dots and dashes, starting with a letter, at
  most 10 characters).
- **`as_of`** (the "trustworthy `as_of`" §4.4 deferred `darkpool` for) = the newest confirmed print date among the
  returned levels, as that session's close, with the note
  `as_of is the newest confirmed print date among these levels, as that session's close`. The payload's own `asOf` is
  the time of the BUILD (a computation time), so it is never `as_of`; it rides as `data.computed_at`. When no level
  carries a full date, `as_of` is null with the note `the levels carry no full print date, so as_of is not given`.
- The kind is declared `periodic` (levels are recomputed as the nightly ledger grows), and every read reports the less
  fresh `historical` (completed sessions only), which §3 allows. `stale` is always false: whether the print ledger
  itself is up to date is not checked, and every `ok` read says so
  (`whether the print ledger itself is up to date is not checked by this read`). A quiet stock is not a stale ledger.
- No cluster reaching the floor is a healthy answer: `ok`, an empty `levels` list, and the note
  `no dark pool cluster reached the floor for {sym} in this window; that is not a failed read`.
- `unavailable`: the service raising, a payload with an `error`, or `levels` that is not a list
  (`dark pool levels could not be read for {sym}`). A failed read is never "no levels".
- Data fields: `sym, levels, windowDays, datesCovered, version, asOf` (the build's epoch seconds), `computed_at,
  newest_print_date`. Level fields: `price, notional, printCount, lastDate, lo, hi, rank`.
- **Not kinds:** the dark pool prints themselves (§4.4, still deferred). Gamma walls
  (`GET /api/signature/gex-walls`) were not exposed to the Agent in v1.7 and v1.8; since v1.9 they are read only by the
  separate, model-isolated kind `levels.gamma` (§4.12), default OFF, which never starts an option chain read.

### 4.11 Terminal data wave 2: `highsLows.yearly`, `themes.rotation`, `confluence.board`, `earnings.expectedMove`, `earnings.callSearch` (v1.8, terminal-data)

Five more thin kinds, the Agent half of five more UCT Terminal panels (H52, TROT, CONFL, EXMV, TSRC). Each is an adapter
over the service its member route already reads (`api/services/uct_agent/marketdata/yearly_highs_lows.py`,
`themes_rotation.py`, `confluence_board.py`, `earnings_expected_move.py`, `earnings_call_search.py`; registered in
`kinds.py` with `owner="terminal-data"`). No new connection, job, database or write (§6).

**Status: dark, not armed.** Like every kind, each is served only when it is listed in `UCT_AGENT_DATA_KINDS` (with
`UCT_AGENT_DATA=1`). All five are model-isolated, so each also needs the master switch `UCT_AGENT_ISOLATED=1` and its own
entry in `UCT_AGENT_ISOLATED_KINDS` (§4.4, ADR-005); until then it is refused for every purpose, and once armed it is
served for purpose `answer` only. This section describes what the code does when a kind is switched on. It does not
switch anything on. As written (2026-11-17), no kind of this section is in production's list.

| Kind | Canonical service (member route) | Params | Declared freshness | `as_of` | `provider_calls` | Model-isolated |
|---|---|---|---|---|---|---|
| `highsLows.yearly` | `services/breadth_live.py` `live_drill(list)` and `services/breadth_monitor.py` `get_drill_list(date, list)` (`GET /api/breadth-monitor/live/drill/{list}`, `GET /api/breadth-monitor/{date}/drill/{list}`) | `{side, limit}` | periodic · historical (a finished session) | the market snapshot's observation time, or that session's close | 0 | **yes** |
| `themes.rotation` | `services/theme_performance.py` `compute_rotation_signals()`, read from its own cache (`GET /api/theme-rotation`) | `{side, limit}` | periodic | null (only UCT's computation time is known) | 0 | **yes** |
| `confluence.board` | `api/confluence_screen.py` `get_board(days)` (`GET /api/confluence?days=30`) | `{direction, limit}` | periodic | null (the board carries no data time) | 0 | **yes** |
| `earnings.expectedMove` | `services/implied_move.py`'s cached straddle and `services/implied_store.py` `get_implied_history(sym)` (`GET /api/research/expected-move/{sym}`) | `{symbol, report_date?}` | periodic | null (only UCT's read and capture times are known) | 0 | **yes** |
| `earnings.callSearch` | `services/transcript_index.py` `search(...)` and `stats()` (`GET /api/earnings/transcript-search`) | `{q, limit, symbol?, since?}` | periodic | the newest indexed call's date | 0 | **yes** |

**No read of this section starts a build.** (§5: a turn has 20 provider requests and a member waiting.) Each of these
member routes can start work that does not fit a turn, so each adapter reads only what its service already holds and
answers `unavailable`, with the reason, when it holds nothing:

| Kind | What the member route can start | What the adapter reads instead |
|---|---|---|
| `highsLows.yearly` | `GET /api/breadth-monitor/live` builds the breadth read when its cache is cold: one whole-market snapshot scored against the universe, 12 to 16 seconds | `breadth_live.compute_live(cached_only=True)`, the service's own non-building read (a warm read or a not-ok answer), then the stored lists |
| `themes.rotation` | `compute_rotation_signals()` on a cache miss calls `get_theme_performance()`, which builds the live theme overlay synchronously when that is cold: about 22 Massive requests (§4.3) | the service's 15-minute cache entry (`cache[theme_performance._ROTATION_CACHE_KEY]`) and nothing else |
| `confluence.board` | a board build is about four minutes (two options-flow legs from the flow-worker); a window other than the default starts a multi-week scan on the pod that runs the live tape | `get_board(confluence_screen.DAYS)`: the cached board of the one window the scheduler keeps warm, or "warming". The kind takes no `days` |
| `earnings.expectedMove` | `get_expected_move` builds synchronously when it holds nothing for the key: up to 21 Massive requests (an expirations walk of up to 12, a chain read of up to 8, a spot hint) | the service's 15-minute cache (`_MOVE_CACHE`), else its 2-hour last-good slot (`_MOVE_STALE`), for the member route's own key; otherwise no current straddle |
| `earnings.callSearch` | nothing: the search is a local SQLite full-text read | `transcript_index.stats()` then `search(...)` |

When `confluence.board` finds the cached board past its TTL, `get_board` itself starts the service's own background
rebuild of the default window (the one the scheduler runs, single-flight). That is the service's behaviour on its own
thread, not this turn's work, the same as a `leaders.longRun` reference build (§4.10). Each cache read is one coupling to
a private name of its service; a rail fills that cache through the service's own function and reads it back, so a rename
fails by name.

**Rules all five share**
- **A bad request is refused before any read.** Each kind's `validate` runs before admission (an unknown `side` or
  `direction`, an out-of-range `limit`, a `symbol` that is not one ticker, a `days` on `confluence.board`, a query
  shorter than 2 characters or with no letter or number): the read is `refused` and spends no budget.
- **A failed read is `unavailable`, never an empty answer.** "No new highs", "no theme is rotating", "nothing on the
  board", "no move is priced" and "no call mentions it" are said only when the service answered healthily with nothing
  in it, and that read is `ok` with a note that says so. A list that could not be read, a ranking that is not cached, a
  board still building, a straddle that is not held and an empty index are each `unavailable` (or `partial`, when part
  of the answer was read), with their own note.
- **Never worded as live or now** (§3). Where the source carries only UCT's own computation, build, read or capture
  time, `as_of` is null, that time rides in `data` under a name that says what it is, and a note says why `as_of` is not
  given (the same rule as `themes`, §4.3).
- **The server says when it cut a list.** Each list-shaped kind returns at most `limit` rows, the whole count beside
  them, and a note naming both.
- **The member's answer is built from the read's `data` and `status`.** The browser capabilities template their text
  from those; an envelope note is never echoed to the member as if it were data.

**Why all five are model-isolated.** A value is isolated when the owner has not cleared it for the model (§4.4):
UCT-derived output, or third-party text whose AI-processing right is unresolved. When in doubt, a kind is isolated.
- `highsLows.yearly`: which names are on a list is UCT-derived breadth output over UCT's own universe, the same class
  as `breadth.current` (breadth contract rule 8). The counts were already isolated; the names behind them are too.
- `themes.rotation`: "rotating in" and "rotating out" are UCT's own selection (its percentile ranks and its 20-point
  rule over its own curated themes), a UCT-derived ranking like `leaders.longRun`. The plain theme returns stay the
  non-isolated `themes` kind (§4.3).
- `confluence.board`: which names are on the board, each one's status and its rank are UCT's own gate, thresholds and
  score, a UCT-derived selection.
- `earnings.expectedMove`: the number is computed by UCT from a vendor option chain under UCT's own refusal bounds, and
  the history is a series only UCT holds (its nightly capture archive). UCT-derived, like `levels.darkpool`, and derived
  from options data the owner has not cleared for the model.
- `earnings.callSearch`: the excerpts are third-party transcript text whose AI-processing right is unresolved, the same
  reason `catalysts.board`'s stored headlines and `analyst.actions` are isolated.

Whether an isolated value may ever reach the model is an owner decision (§4.4). On the browser the five kinds are read
only by local-only capabilities (`stock.yearlyHighsLows`, `stock.themeRotation`, `stock.confluenceBoard`,
`stock.expectedMove`, `stock.callSearch` in `app/src/agent/capabilities/terminalDataWave2.js`, all in
`turn.LOCAL_ONLY_ACTIONS`): the model plans the lookup and never sees what came back. Each capability registers only
while the server lists its own kind.

**`highsLows.yearly`** (source `uct-breadth-monitor`)
- What it returns: the stocks at new 52-WEEK highs and new 52-week lows, the names behind the Breadth Monitor's
  `new_52w_highs` and `new_52w_lows` counts. `list` is the Monitor's own drill key (`new_52w_highs_list`,
  `new_52w_lows_list`), the H52 panel's own; a rail reads both files. Every `ok` read carries the note
  `the names behind the Breadth Monitor's new 52-week high and new 52-week low counts, from UCT's own stock universe (not every listed stock); 52-week highs and lows, not highs and lows of the day`.
- **Not highs and lows of the day.** Those are `highsLows.session` (§4.10), a different measure.
- Params: `side` ∈ both · highs · lows (default both); `limit` 1–50 names a side (default 25).
- **Which lists** (the H52 panel's own rule, from the three words the Monitor's live row is gated on):
  - a session under way (`session_live`, not `superseded`, not `degraded`): the lists of that session, `data.mode`
    `live`, freshness `periodic`;
  - otherwise: the stored lists of the newest finished session, `data.mode` `settled`, freshness `historical`, with
    `data.why` and its note: `finished` (`today's session has finished and its lists are stored`), `thin`
    (`the breadth read of the session under way covers too few stocks to trust, so the last finished session is given instead`), `closed` (`the market is not in session, so the last finished session is given`) or `no_read`
    (`no current breadth read is held in the server's cache (this read never starts one), so the last finished session is given instead; a session may be under way`).
- `as_of`, session under way: the market snapshot's own observation time (`data_as_of`), with the note
  `lists of the session under way ({date}), from the breadth read UCT computed at {at}; as_of is the market snapshot's own observation time. Recomputed about once a minute: not a live feed`.
  UCT's computation time is never `as_of`; it rides as `data.computed_at`. When the vendor did not stamp the snapshot,
  `as_of` is null with the note
  `lists of the session under way ({date}), from the breadth read UCT computed at {at} (UCT's time; the market snapshot's observation time is not carried), so as_of is not given: not a live feed`.
  `stale` when that time is more than 300 seconds old (breadth's own intraday rule, §4), with the note
  `the breadth read behind these lists is more than five minutes old, so newer highs and lows may be missing`.
  When the session's counts use the exchange convention the read adds
  `the session's counts use the exchange convention: a trade above the prior 52-week high (or below the prior 52-week low), not only a close` (`data.basis` is `intraday`).
- `as_of`, finished session: that session's close, with the note `the stored lists of the finished session {date}; as_of is that session's close`.
  `stale` when the stored session is older than the last completed session, with the note
  `the newest stored session is {date}, older than the last completed session ({session}), so these are not the latest lists`.
- A list the service cannot give (the live read withholds it, the stored session lacks it, the read raises) is "not
  given" for that side: `data.<side>.state` is `unavailable`, the read is `partial`, and the note is
  `the new 52-week {side} list could not be read for this session; that is not the same as an empty list`. An empty list from a healthy read is `ok` with the note
  `no stock is on the new 52-week {side} list for this session; that is a healthy answer, not a failed read`.
- More names than `limit`: the first `limit` in the list's own order, `data.<side>.count` is the whole list, and the
  note is `showing the first {n} of {total} names on the new 52-week {side} list, in the list's own order`.
- `unavailable`: no warm breadth read and no stored session (`no 52-week list is available: no current breadth read is held in the server's cache and no finished session is stored`); no list
  asked for can be given (`the 52-week lists asked for could not be read for the session {date}; that is not the same as no new highs or lows`); the services could not be loaded
  (`the 52-week high and low lists could not be read`).
- Data fields: `mode` (live · settled), `why`, `session_date`, `side`, `highs`, `lows` (each `{state, items, count}`, or
  null when not asked for), `basis`, `computed_at`, `missing`. Item fields, by the drill routes' own names:
  `t, c, pct, vr, v, n` (ticker, price, change against the prior close in percent, volume against its 20-day average,
  shares, company name). `coverage` counts the names the lists hold against the names returned.

**`themes.rotation`** (source `uct-theme-rotation`)
- What it returns: which of UCT's themes are rotating in and which are rotating out. Every `ok` read carries the note
  `each theme's 1-week and 1-month return is ranked as a percentile among all of UCT's themes; a theme is rotating in when its 1-week rank is 20 or more points above its 1-month rank, and rotating out when it is 20 or more points below. UCT's own ranking of its own themes, not a forecast`.
  The 20 points are the service's own threshold (`data.threshold`); a rail computes through the service and fails when
  it changes.
- Params: `side` ∈ both · in · out (default both); `limit` 1–50 themes a side (default 20).
- `as_of` is always null. `generated_at` is when UCT worked the ranking out (a computation time), from theme returns
  that are re-priced from snapshots while a session can print. `data.computed_at` gives UCT's time, with the note
  `worked out by UCT at {at} from its theme returns, which are re-priced while a session is open (UCT's time; the vendor's observation time is not carried), and kept for up to 15 minutes, so as_of is not given: not a live feed`
  (or `the ranking carries no time, so as_of is not given`).
- `stale` is always false: the cache entry is at most 15 minutes old by the service's own TTL, and every `ok` read
  says what it did not check (`whether the theme returns behind the ranking are a session behind is not checked by this read`).
- No theme on a side is a healthy answer: `ok`, with the note `no theme is rotating {side} by 20 points or more among the {ranked} ranked; that is a healthy answer`.
- More themes than `limit`: the first `limit`, `data.in_count` / `data.out_count` are the whole lists, and the note is
  `showing the first {n} of {total} themes rotating {side}, biggest rank change first`.
- `unavailable`: the ranking is not in the service's cache
  (`the theme rotation ranking is not held in the server's cache at the moment (it is kept 15 minutes after it is worked out), and this read never starts that computation; ask again shortly`);
  the service's cold answer, both lists empty and no theme ranked (`theme returns are still being computed on the server, so no theme is ranked yet`), which is "not ready",
  never "nothing is rotating"; a malformed entry or a failing cache (`the theme rotation ranking could not be read`).
- Data fields: `side`, `rotating_in`, `rotating_out`, `in_count`, `out_count`, `ranked` (how many themes the service
  ranked), `threshold`, `generated_at` (the service's own stamp), `computed_at`. Entry fields, by the route's own names:
  `name, ticker` (the theme's key), `1w_return, 1m_return, 3m_return` (percent), `1w_rank, 1m_rank, 3m_rank`
  (percentiles, 0 weakest to 100 strongest), `momentum_delta` (the 1-week rank less the 1-month rank).

**`confluence.board`** (source `uct-confluence`)
- What it returns: UCT's confluence board for the one window the server keeps warm. Every `ok` read carries the notes
  `stocks where a large dark pool dollar size and aligned long-dated options flow line up over the last {days} trading days, ranked by UCT inside each size band and direction; UCT's own screen, not a recommendation`
  and `the dark pool prices on the board (average, range, last) are from dark pool sessions, never a current quote`.
- Params: `direction` ∈ all · bull · bear (default all); `limit` 1–50 (default 20). There is no `days`
  parameter: a request that carries one is refused.
- **Licensing.** The options-flow leg is UCT's own Massive options tape (the flow-worker) and the dark pool leg is the
  dark pool print store. No Schwab option chain is read by this board.
- `as_of` is always null: the board carries no data time, only a window as text (`data.window`). `data.built_at` gives
  the time the service built it (a computation time), with the note
  `built by UCT at {at} and rebuilt about every {minutes} minutes (UCT's build time; the board carries no data time), so as_of is not given: not a live feed`.
  When the build time cannot be read the note is `the board carries no build time, so its age is unknown and as_of is not given`
  and the read is `stale`.
- `stale` = the service's own rule (the board is older than its TTL), with the note
  `the board is older than its {minutes}-minute refresh, so it may be behind the latest options flow`.
- A board built with an options-flow leg missing is `partial`, `data.incomplete` is true, and the note is
  `an options-flow leg could not be read when this board was built, so some names may be missing`. The build's own
  warning text is internal and is never returned.
- The accumulation / distribution call (`acc`) is not returned: a single unsigned dark pool print names a price, not a
  buyer (owner decision 2026-09-12), so the member surfaces do not show it either.
- Nothing on the board is a healthy answer: `ok`, with the note `no stock passes the board's gate in this window; that is a healthy answer, not a failed read`.
  A board with names but none on the side asked for: `the board holds {total} names, none of them on the side asked for`.
- More names than `limit`: the first `limit`, `data.count` is every name on the side asked for, and the note is
  `showing the first {n} of {total} names, in the board's own order (best ranked first)`.
- `unavailable`: no board is cached yet, or the service could not build one
  (`the confluence board is being built on the server; ask again in a few minutes`); the service raising or a malformed
  payload (`the confluence board could not be read`). Never an empty board.
- Data fields: `days`, `window`, `direction`, `rows`, `count`, `counts` (`total, bull, bear, building`, counted from
  the rows the board holds), `band_meta`, `incomplete`, `built_at`, `refresh_minutes`. Row fields, by the route's own
  names: `sym, band` (L · M · S), `dir` (BULL · BEAR), `status` (BUILDING · STEADY · ESTABLISHED), `sector, dpn` (dark
  pool dollars over the window), `dpAvg, dpLo, dpHi, dpLast, bigPrint, bigPrice, bigDate, net, net5, bull, bear,
  bullPct` (already a percent), `leapPrem, leapShare` (a fraction, 0 to 1), `freshRatio, top` (`cp, strike, exp, dte,
  prem`), `score`.

**`earnings.expectedMove`** (source `uct-implied-move`)
- What it returns: what the options market prices for one stock's earnings report, and what it priced before each past
  and coming report. Every `ok` or `partial` read carries the note
  `the expected move is the price of the at-the-money straddle (the call plus the put at the strike nearest the stock price) as a percent of the stock price, through the option expiry given; what the options market prices, not a forecast`.
  The route's Setup Grade is not part of this kind.
- **Licensing, verified in code.** The straddle is computed from UCT's own Massive option chain
  (`implied_move.compute_expected_move_result` over `services/polygon_options`, payload `source: "massive-chain"`); the
  capture store's rows are `massive-chain` or `massive-backfill`. No Schwab chain is read. A rail reads both source
  files, and a current straddle whose `source` is not `massive-chain` is dropped with the note
  `a current straddle from an option chain this kind does not show was left out`.
- Params: `symbol` (one ticker); `report_date` (optional, `YYYY-MM-DD`). The service picks the first expiry on or after
  the report date, so the adapter looks the straddle up for `report_date` when given, else for the coming report the
  capture store holds a row for, else with no date. `data.report_date` says which; with none the note is
  `no report date was given or stored for {sym}, so the straddle is for the nearest expiry, which spans the next report only if that report falls before it`.
- The current straddle (`data.live`, `data.live_state`):
  - `fresh`: the service's 15-minute cache holds it;
  - `last_good`: only its last-good slot does. The read is `stale`, with the note
    `the current straddle is the last good read, older than the 15 minutes it is normally kept, so it may be behind the option market`;
  - `not_cached`: neither does. `data.live` and `data.live_outcome` are null (the route's own word for "the read was
    never attempted"), the read is `partial`, and the notes are
    `no current straddle is held in the server's cache for {sym}, and this read never starts an option chain read; only what was stored before each report is given`
    and `the stored rows carry UCT's own capture dates, not a market time, so as_of is not given`.
- `as_of` is always null. A straddle's `asof` is when UCT read the chain; `data.read_at` gives it, with the note
  `the current straddle was read by UCT from its option chain at {at} (UCT's read time; the vendor's quote time is not carried), so as_of is not given: not a live feed`
  (or `the current straddle carries no read time, so as_of is not given`).
- The stored captures (`data.history`, at most 8 rows, newest report first, the member route's own count) carry the
  note
  ``each stored row is what the straddle priced before that report, captured once by UCT on the `captured_at` date; a row whose report date is still ahead is the coming report's capture``.
  None held: `no stored capture is held for {sym}: the capture store began recently and many stocks have none`.
  A store that could not be read is said, never read as "none": `data.store_read` is false, the read is `partial`, and
  the note is `the stored captures could not be read for {sym}; that is not the same as none being held`.
- `unavailable`: no current straddle is held and no capture is stored
  (`no expected move is held for {sym}: no current straddle is in the server's cache and no capture is stored. That is not the same as no move being priced`);
  neither could be read (`the expected move could not be read for {sym}`).
- Data fields: `symbol`, `report_date`, `live`, `live_state` (fresh · last_good · not_cached), `live_outcome`, `read_at`,
  `history`, `history_since`, `store_read`. `live` fields, by the route's own names: `pct` (percent of the stock price),
  `dollar, strike, spot, call_mid, put_mid, iv_atm, expiry, horizon, asof, source`. History row fields:
  `sym, report_date, captured_at, pct, dollar, expiry, fiscal_year, fiscal_quarter`.

**`earnings.callSearch`** (source `uct-transcript-index`)
- What it returns: the indexed earnings calls that match a word or a phrase. Every `ok` read carries the note
  `each hit is one company's earnings call for one fiscal quarter, best match first, with the index's own short excerpt around the match; third-party transcript text, quoted exactly as indexed. The index stores a call as one text, so who said it is not known`.
- **Third-party text, and no more of it than the member route gives.** A hit's `snippet` is the index's own excerpt
  (about 28 words around the match, with `<mark>` around the matched words), returned exactly as the service cut it. The
  transcript itself is never returned.
- Params: `q` (2 to 120 characters, with at least one letter or number); `limit` 1–40 calls (default 10; the member
  panel's own count, the route allows more); `symbol` (optional, one ticker); `since` (optional, `YYYY-MM-DD`).
- `as_of` = the newest indexed call's date, as the start of that Eastern day, with the note
  `the index holds {calls} earnings calls dated {oldest} to {newest}; as_of is the newest indexed call's date (a date, not a time of day)`.
  When no indexed call carries a usable date, `as_of` is null with the note
  `the index holds {calls} earnings calls and none carries a usable date, so as_of is not given`.
- `stale` is always false, and every `ok` read says what it did not check
  (`whether the most recent calls have been indexed yet is not checked by this read`).
- No hit is a finding only when the index holds calls, so the index is read first. A healthy search with no hit is `ok`,
  with the note
  `no indexed call matches; that is a finding about the calls the index holds, not about calls it does not hold`.
- More calls than `limit`: the best `limit` matches, `data.total` is every call that matches, and the note is
  `showing the {n} best matches of {total} calls that match`. When the service checked exact words and quoted phrases
  on the hits it kept, the total is wider than the hits (`data.total_wider`), with the note
  `{total} calls match the words in any form; exact words and quoted phrases were checked only for the hits shown, so the total is wider than the hits`.
  A search the service widened to related words adds `the search was widened to related words by the search service`
  (`data.expanded`).
- `unavailable`: the index holds no calls
  (`no earnings calls are indexed on this server yet, so nothing can be searched; that is not the same as no call mentioning it`);
  a query the service could not run as typed (`the search could not be run as typed: the search service did not understand the query`);
  nothing searchable left of the query (`nothing searchable was left of the query, so no search was run`); the index or
  the search failing (`the earnings call search could not be read`). The service's own error sentence is never passed on.
- Data fields: `query`, `symbol`, `since`, `total`, `total_wider`, `hits`, `expanded`, `index` (`calls, oldest, newest`).
  Hit fields, by the route's own names: `symbol, year, quarter, date, snippet, score`. There is no speaker field.
- **Not kinds:** the month-by-month trend of a word (`GET /api/earnings/transcript-trend`), a whole transcript, and
  `flow.summary` (§4.4, still deferred: `confluence.board` is UCT's joined board, not the options-flow tape).

### 4.12 Terminal data wave 3: `levels.gamma`, `flow.topPicks`, `flow.record`, `earnings.reactions` (v1.9, terminal-data)

Four more thin kinds, the Agent half of the LVL panel's options levels, the TOPF panel, the Flow Record page and the EMOV
panel. Each is an adapter over the service its member route already reads
(`api/services/uct_agent/marketdata/gamma_levels.py`, `flow_top_picks.py`, `flow_record.py`, `earnings_reactions.py`;
registered in `kinds.py` with `owner="terminal-data"`). No new connection, job, database or write (§6).

**Status: dark, not armed.** Like every kind, each is served only when it is listed in `UCT_AGENT_DATA_KINDS` (with
`UCT_AGENT_DATA=1`). All four are model-isolated, so each also needs the master switch `UCT_AGENT_ISOLATED=1` and its own
entry in `UCT_AGENT_ISOLATED_KINDS` (§4.4, ADR-005); until then it is refused for every purpose, and once armed it is
served for purpose `answer` only. This section describes what the code does when a kind is switched on. It does not
switch anything on. As written (2026-11-17), no kind of this section is in production's list.

| Kind | Canonical service (member route) | Params | Declared freshness | `as_of` | `provider_calls` | Model-isolated |
|---|---|---|---|---|---|---|
| `levels.gamma` | the gamma walls `api/routers/signature.py` already holds for `_serve_gxw`: its cache entry and its last-good slot (`GET /api/signature/gex-walls`; `services/signature/gex_walls.py` over `api/gex_service.py`) | `{symbol}` | periodic | null (only UCT's build time is known) | 0 | **yes** |
| `flow.topPicks` | `api/top_flow_tracker.py` `get_all()`, each pick scored by `api/flow_scoreboard.py` `pick_stats` (`GET /api/top-flow/history`) | `{status, direction, sort, limit, symbol?}` | periodic (every read reports `historical`) | the newest daily price date in the pick store | 0 | **yes** |
| `flow.record` | `api/flow_scoreboard.py` `_get_payload()` (`GET /api/flow-scoreboard`) | none | periodic (every read reports `historical`) | the newest daily price date in the pick store | 0 | **yes** |
| `earnings.reactions` | the calendar week and the reactions answer `api/routers/calendar.py` already holds in its cache (`GET /api/calendar?week=`, `GET /api/calendar/reactions?date=`) | `{date?, limit}` | periodic · historical (a past day) | null (no data time is carried) | 0 | **yes** |

**No read of this section starts a build or spends a provider call.** (§5: a turn has 20 provider requests and a member
waiting.) Two of these member routes can start work that does not fit a turn, so their adapters read only what the
route already holds and answer `unavailable` (or `partial`), with the reason, when it holds nothing. The two flow kinds
read lists the server keeps in memory:

| Kind | What the member route can start | What the adapter reads instead |
|---|---|---|
| `levels.gamma` | `_serve_gxw` builds synchronously when it holds nothing for the symbol: a whole option chain read (a first request and a Massive walk of up to 48 pages under a 25 second budget) | the route's cache entry for the symbol (kept 10 minutes: `data.held` `fresh`), else its last-good slot (30 minutes: `data.held` `last_good`, and the read is `stale`); otherwise `unavailable`. The route's memory of a failed build is never read |
| `flow.topPicks` | nothing: the route returns the tracker's in-memory lists as they are | `top_flow_tracker.get_all()`, each pick scored by `flow_scoreboard.pick_stats`; filtered, ordered and cut on the server |
| `flow.record` | on a cache miss the service works the board out from the same in-memory lists (arithmetic only: no I/O, no provider) | `flow_scoreboard._get_payload()`: the service's own 5-minute cache, and its own 30-second memory of a failed tracker read |
| `earnings.reactions` | `get_reactions` for a past day not in its cache works the moves out from daily bars, one Massive request per reporter (up to 250); for today, one Massive batch snapshot. Any week but the current one is built on a cache miss | the cached week that owns the day (`calendar_weekly`, or `calendar_week_<monday>`: the two entries the router's own `cached_report_session` reads) and the cached reactions answer (`calendar_reactions_<date>`); nothing else |

Each cache read is one coupling to private names of its route. A rail fills each cache through the route's own function
(`_serve_gxw` with the chain read stubbed; `get_reactions` with the price reads stubbed; `_get_or_build_range_week` with
the week build stubbed) and reads it back, so a rename fails by name. There is no small pure helper for the earnings
moves: the logic lives in the route handler, so this kind serves what is cached and nothing more.

**Rules all four share**
- **A bad request is refused before any read.** Each kind's `validate` runs before admission (a `symbol` that is not one
  ticker, an unknown `status`, `direction` or `sort`, an out-of-range `limit`, any parameter on `flow.record`, a `date`
  that is not a real weekday written `YYYY-MM-DD`): the read is `refused` and spends no budget.
- **A failed read is `unavailable`, never an empty answer.** "No gamma level in the band", "no pick matches", "nobody
  reported" are said only when the service answered healthily with nothing in it, and that read is `ok` with a note that
  says so. Levels that are not held, a pick record that could not be read and a day that is not in the cache are each
  `unavailable`, with their own note; reporters whose moves are not held are a `partial` read.
- **A value that does not exist is null, never 0.** A pick with fewer than two daily prices is too new to score: its
  gains are null. A reporter with no move on record has `move: null`.
- **Never worded as live or now** (§3). Where the source carries only UCT's own build time, `as_of` is null, that time
  rides in `data` under a name that says what it is, and a note says why `as_of` is not given.
- **The server says when it cut a list.** Each list-shaped kind returns at most `limit` rows, the whole count beside
  them, and a note naming both; `flow.record` states the service's own two cuts.
- **The member's answer is built from the read's `data` and `status`.** The browser capabilities template their text
  from those; an envelope note is never echoed to the member as if it were data.

**Why all four are model-isolated.** A value is isolated when the owner has not cleared it for the model (§4.4):
UCT-derived output, options data, or third-party data whose AI-processing right is unresolved. When in doubt, a kind is
isolated.
- `levels.gamma`: the three levels are computed by UCT (its own wall search, band and zero-gamma rules) from a vendor
  option chain: UCT-derived, and derived from options data. The chain is Massive's, the only one read since 2026-11-17
  (§9, v1.9 amendment). Member display is not the same as sending data to a model provider, and no record clears the
  chain for that, so the kind is isolated.
- `flow.topPicks`: which contracts are picks, and each one's grade, are UCT's own selection from its options flow tape,
  and the results are option contract prices from a vendor: a UCT-derived selection over options data.
- `flow.record`: the rates are UCT's own measurement of its own selections, worked out from the same vendor option
  contract prices.
- `earnings.reactions`: the day's list is UCT's own calendar (its universe filter over third-party calendar vendors'
  results and estimates, whose AI-processing right is not on record), and the move is worked out by UCT under its own
  session rule. The Agent's existing `calendar.day` answer deliberately gives tickers only, never a figure; this kind
  carries the figures.

Whether an isolated value may ever reach the model is an owner decision (§4.4). On the browser the four kinds are read
only by local-only capabilities (`stock.gammaLevels`, `stock.topFlowPicks`, `stock.flowRecord`,
`stock.earningsReactions` in `app/src/agent/capabilities/terminalDataWave3.js`, all in `turn.LOCAL_ONLY_ACTIONS`): the
model plans the lookup and never sees what came back. Each capability registers only while the server lists its own
kind.

**`levels.gamma`** (source `uct-gex-walls`)
- What it returns: one stock's call wall, put wall and zero gamma level, as the LVL panel's options read gives them.
  Every `ok` read carries the notes
  `the call wall, the put wall and the zero gamma level UCT works out from the options on {sym} expiring within a week, each given only when it is within {band}% of the stock price; UCT's own arithmetic on an option chain, not a forecast`
  and `the stock price given is the one the option chain carried when the levels were worked out, never a current quote`.
- Params: `symbol` (one ticker, the gex-walls route's own rule).
- **Which chain.** `data.chain_source` is `massive`: the one chain these levels are read from, with the note
  `the option chain behind these levels is Massive's, the one chain UCT reads for them`. The field stays in the payload
  (its shape is unchanged). Until 2026-11-17 it could also say `schwab`:
  the `GEX_CHAIN_SOURCE` switch and the Schwab chain it could select were retired that day
  (§9, v1.9 amendment), and a value left in that variable is read by nothing.
- What is held (`data.held`): `fresh`, the route's cache entry; or `last_good`, its last-good slot, when the read is
  `stale` with the note
  `these are the last good levels, older than the {minutes} minutes they are normally kept, so they may be behind the option market`.
- `as_of` is always null. The payload's `asOf` is when UCT read the chain and worked the levels out (a computation
  time); `data.computed_at` gives it, with the note
  `worked out by UCT at {at} from an option chain it read then (UCT's own time; the vendor's quote time is not carried), so as_of is not given: not a live feed`
  (or `the held levels carry no build time, so their age is unknown and as_of is not given`, and then the read is `stale`: unknown is never claimed fresh).
- **The zero gamma level is not always a true flip.** `gex_service` names how it found the level, and a stand-in is not
  a flip, but the walls payload does not carry that through. Every read that returns a zero gamma level says so:
  `the zero gamma level is an estimate of where dealer hedging flips; the held read does not say how it was found, and for some stocks it is a stand-in level rather than a true flip`.
- No level inside the band is a healthy answer: `ok`, with the note `no gamma level is within {band}% of the stock price for {sym}; that is a healthy answer, not a failed read`.
- `unavailable`: nothing is held for the symbol
  (`no gamma levels are held for {sym} in the server's cache (they are kept {minutes} minutes after a chart or the Levels panel reads them, and a last good copy for {max_minutes}), and this read never starts an option chain read; that is not the same as no levels`);
  the held read carries no stock price (`the held option read for {sym} carries no stock price, so no level could be placed; that is not the same as no levels`);
  a malformed payload or a failing route (`gamma levels could not be read for {sym}`). The option service's own error sentence is never passed on.
- Data fields: `sym`, `levels` (`kind` ∈ callWall · putWall · zeroGamma, `price`), `spot`, `regime` (bullish · bearish ·
  choppy · unbound, or null), `version`, `asOf` (epoch seconds of the build), `computed_at`, `held` (fresh · last_good),
  `chain_source`, `band_pct`, `kept_minutes`, `last_good_minutes`. `sym`, `levels`, `spot`, `regime` and `asOf` keep the
  route's own names. No strike table, no open interest and nothing else of the chain is returned.

**`flow.topPicks`** (source `uct-top-flow`)
- What it returns: UCT's Top Flow picks, one by one, each with how its option contract has done since it was flagged.
  Every `ok` read carries the notes
  `each Top Flow pick UCT flagged on its options flow tape, with how its option contract has done since: a gain is the contract's own price change against its price when flagged, never the stock's move; UCT's own selection, not a recommendation`
  and
  ``picks and entry prices come from UCT's options flow tape; daily contract prices are recorded each weekday after the close, from Massive (prices recorded before November 2026 came from Schwab and stay as recorded); each row's `src` names the sources that priced it, and an entry with no source on record is Schwab``.
- **One definition of a gain, the Flow Record's.** Every gain is `flow_scoreboard.pick_stats(pick)`, called, never
  re-derived. A pick with fewer than two usable daily prices is too new to score: `scored` is false and
  `current_gain_pct`, `max_gain_pct`, `peak_price` and `days_tracked` are null, never 0, with the note
  `{n} of the {total} picks that match have fewer than {min} daily prices and are too new to score: their gains are not given, which is not the same as 0%`.
  The store's own `finalPnl` (0 for a missing price) is never returned.
- Params: `status` ∈ all · open · expired (default all); `direction` ∈ any · bullish · bearish (default any); `sort` ∈
  gain · loss · peak · newest (default gain); `limit` 1–50 (default 20); `symbol` (optional, one ticker). The keys are the
  TOPF panel's own; a rail reads both files.
- The order is the TOPF panel's own: a pick that is not scored has no gain, so under the three gain orders it goes last
  (newest first), never ranked as 0.
- `as_of` = the newest daily price date in the whole store, as that session's close, with the note
  `as_of is the newest daily price date in the pick store, as that session's close; prices are recorded once each weekday after the close, never during a session`.
  When no pick carries a price, `as_of` is null with the note `no pick in the store carries a daily price, so as_of is not given`.
- `stale` when that newest price is more than 4 calendar days old (the TOPF panel's own number), with the note
  `the newest daily price in the store is {date}, more than {days} days old, so the results stop there`.
- **The newest pick is a different question from the newest price.** `data.newest_pick_date` gives it; when it is more
  than 14 days old (the panel's own number) `data.no_new_picks` is true, with the note
  `the newest pick in the store was flagged on {date}; none has been added since`.
- An empty store is ambiguous and said so: `ok`, no rows, with the note
  `the pick store holds no pick; a store that could not be loaded when the server started reads the same as an empty one, so this is not a statement that no pick was ever flagged`.
  A store with picks, none matching: `the store holds {total} picks, none of them matching what was asked for`.
- More picks than `limit`: the first `limit` in the order asked for, `data.count` is every pick that matches, and the
  note is `showing the first {n} of {total} picks that match, {order}`.
  A stored pick the Flow Record's arithmetic cannot read is left out and counted (`data.unread`):
  `{n} stored picks carry no readable symbol or history and are left out`.
- `unavailable`: the store could not be read (`the Top Flow picks could not be read`). Never an empty list.
- Data fields: `status`, `direction`, `sort`, `symbol`, `rows`, `count`, `counts` (`total, open, expired, scored,
  too_new, never_scored`, over the whole store), `matching_too_new`, `unread`, `min_prices`, `newest_price_date`,
  `newest_pick_date`, `days_since_newest_price`, `days_since_newest_pick`, `no_new_picks`. Row fields: `id, sym, cp`
  (C · P), `strike, exp` (the text the store holds), `grade` (A+ · A · B · C · D, or null), `dir` (BULL · BEAR, or null),
  `dateSaved, saved_date, status` (open · expired), `stopped, scored, prices, entry, latest_price, latest_date,
  peak_price, current_gain_pct, max_gain_pct` (percent, one decimal), `days_tracked, oi_evaluable, oi_confirmed, prem,
  hits, cap, src` (massive · schwab: the sources that priced it; `schwab` labels prices recorded before November 2026, and nothing reads Schwab now). `coverage` counts the picks read against the rows
  returned.

**`flow.record`** (source `uct-flow-record`)
- What it returns: the Flow Record's aggregate results. Every `ok` read carries the notes
  `the Flow Record: how every Top Flow pick UCT flagged has done, measured on the option contract's own daily prices; a win rate is the share of scored picks whose best daily price reached that gain over the price when flagged, and losers are never left out; past results, not a forecast`
  and
  `picks and entry prices come from UCT's options flow tape; every gain, win rate and open-interest confirmation is worked out from daily contract prices recorded each weekday after the close, from Massive (prices recorded before November 2026 came from Schwab and stay as recorded)`.
- Params: none. A request that carries one is refused.
- **Nothing is re-derived.** Every rate and gain is the service's. A pick too new to score is counted apart and is in no
  rate: `{n} picks have fewer than {min} daily prices and are too new to score: they are counted apart and are in no rate, never as 0%`.
- The two lists are the service's own, and their cut is stated:
  `the two lists are the service's own cut: its {winners} best peak gains among scored picks flagged in the last {days} days, and its last {picks} scored picks whatever their result`.
  The page's own sentences (`window`, `methodology`) are not returned.
- `as_of` = the newest daily price date in the pick store, as that session's close (`as_of is the newest daily price date in the pick store, as that session's close; prices are recorded once each weekday after the close, never during a session`),
  or null with the note `no pick in the store carries a daily price, so as_of is not given`. The service's `generated_at` is a computation time: it rides as
  `data.computed_at`, with the note `worked out by UCT at {at} and kept for up to {minutes} minutes (UCT's own time, never as_of)`.
- `stale` and the newest-pick note are `flow.topPicks`'s own rule, so the two kinds cannot disagree:
  `the newest daily price in the store is {date}, more than {days} days old, so the results stop there`;
  `the newest pick in the record was flagged on {date}; none has been added since`.
  When the store's dates cannot be read the read is `stale`, with the note `the pick store's dates could not be read, so as_of is not given and the record's age is unknown`.
- An empty record is ambiguous and said so: `ok`, with the note
  `the record holds no pick; a pick store that could not be loaded when the server started reads the same as an empty one, so this is not a statement about the picks`.
- `unavailable`: the tracker read failed, now or within the service's 30-second failure memory, or the payload is
  malformed (`the Flow Record could not be read; that is a gap in what could be read, not a statement about the picks`). Never a zero-pick board.
- Data fields: `flagged`, `picks_tracked`, `too_new`, `overall`, `by_grade` (one row per grade, A+ to D), each with
  `picks, win_rate_10, win_rate_25, win_rate_50, pct_doubled, avg_max_gain, median_max_gain, oi_confirmed_rate,
  oi_evaluated` (rates in percent; null when no pick is scored), `recent_winners`, `recent_picks` (`sym, cp, strike, exp,
  grade, dateSaved, entry, peak_price, max_gain_pct, days_tracked, oi_confirmed`, and on recent picks `current_gain_pct,
  latest_price`), `generated_at`, `computed_at`, `min_prices`, `recent_window_days`, `newest_price_date`,
  `newest_pick_date`, `days_since_newest_price`, `days_since_newest_pick`, `no_new_picks`.

**`earnings.reactions`** (source `uct-earnings-calendar`)
- What it returns: the companies on UCT's earnings calendar for one day that have a reported result, each with its
  result against what was expected and the stock's move. Every `ok` or `partial` read carries the note
  `the companies on UCT's earnings calendar for {date} that have a reported result on record, each with its earnings per share and revenue against what was expected, and the stock's move; results and estimates are third-party calendar data as UCT holds it`.
- Params: `date` (optional, `YYYY-MM-DD`, a weekday; default the newest completed session, the EMOV panel's own
  default); `limit` 1–50 reporters (default 25).
- **Who is a reporter:** an entry of the day whose reported EPS (`eps_act`) is set, the same test the reactions route
  and the EMOV panel apply. A symbol listed under two sessions is counted once.
- **What a move is** (the route's own rule, restated, never re-derived). A past day:
  `a move is the stock's close-to-close change around the report: for a report before the open or with no confirmed time, that day's close against the prior close; for a report after the close, the next session's close against that day's close`.
  Today: `for today a move is the stock's change on the day in one market snapshot, kept {seconds} seconds; it is not the settled close-to-close move, which is worked out once the sessions have closed`.
- The moves (`data.moves`):
  - `held`: the route's reactions answer for the day is in its cache. A reporter the answer does not name has
    `move: null`, counted in `data.no_move`, with the note
    `{n} of the {total} reporters have no move on record (no price bar for the day, or the session it is measured to has not closed)`;
  - `none_worked_out`: the cached answer is empty while the day has reporters. The read is `partial`, with the note
    `no move is held for any of the {n} reporters: the price source did not answer, or the session a move is measured to has not closed; that is not the same as no move`;
  - `not_cached`: the route holds no answer for the day. The reporters and their results are given without moves, the
    read is `partial`, and the note is
    `the moves for {date} are not held in the server's cache (a past day's are kept up to {hours} hours after a member opens it, today's {seconds} seconds), and this read never starts price reads; the results are given without them, which is not the same as no move`.
- `as_of` is always null, with the note
  `the calendar and the moves carry no data time, only the day they are for, so as_of is not given: not a live feed`.
  Today's read is `periodic`; a past day's is `historical`. `stale` is always false.
- Nobody reported is a healthy answer: `ok`, `data.moves` null, with the note
  `{scheduled} companies are on the calendar for {date} and none has a reported result on record; that is a healthy answer, not a failed read`.
- More reporters than `limit`: `data.count` is every reporter, and the note is
  `showing the first {n} of {total} reporters, biggest move first by size, a reporter with no move last`.
- `unavailable`: the day's calendar is not in the cache
  (`the earnings calendar for {date} is not held in the server's cache, and this read never builds a calendar week; that is not the same as nobody reporting`);
  the calendar could not be read (`the earnings reactions could not be read for {date}`).
- Data fields: `date`, `day_kind` (past · today · future), `scheduled` (every entry of the day), `reporters`, `count`,
  `moves` (held · none_worked_out · not_cached, or null), `moved`, `up`, `down`, `flat`, `no_move`. Reporter fields, by
  the calendar's own names: `sym, name, session` (bmo · amc · tbd), `eps_act, eps_est, rev_act, rev_est` (revenue in
  millions, as the route sends it), `move` (percent, or null). `coverage` counts the reporters against the rows returned.
- **Not kinds:** the flow-worker's lists (Cream of the Crop, the open flow board, repeat-hit contracts, the day read).
  No Agent adapter and no cache on `web` reads them inside a turn's budget, so a kind would be a new blocking network
  read in a turn. `flow.summary` (§4.4) stays deferred for the same reason: `flow.topPicks` and `flow.record` read
  the pick tracker on `web`, not the options-flow tape.

## 8. Changing this contract

1. Open a PR that edits this file, with a version bump (v1.1 adds; v2.0 breaks). Message agent-lead.
2. Breaking changes need an ADR and every consumer's acknowledgement in their status file.
3. Consumers code against the contract and QA's fixtures, never against an unmerged producer branch.
4. The envelope's wire field `contract` tracks the envelope **shape** only. A version that changes semantics or documentation but no envelope field (v1.1) keeps `"MD-1.0"`.

## 9. Changelog

- **v1.9 amendment (2026-11-17, terminal-data, Schwab retired):** §4.12's text is brought in line with the removal of Schwab from the product, by the owner's instruction (verbatim): "Move it, fix the status and remove schwab from everything." Two things were retired with it: the Schwab option chain behind `levels.gamma` (and the `GEX_CHAIN_SOURCE` switch, with its `schwab` and `shadow` values, that could select it), and the Schwab backup behind the daily contract prices of `flow.topPicks` and `flow.record`. What changed in §4.12: `data.chain_source` is always `massive` (the field stays, so the payload's shape is unchanged) and its note now reads `the option chain behind these levels is Massive's, the one chain UCT reads for them`; the two flow kinds' source notes now say the daily prices are recorded `from Massive (prices recorded before November 2026 came from Schwab and stay as recorded)`. A `flow.topPicks` row's `src` can still say `schwab`: that labels prices recorded before November 2026, which are never rewritten. No kind, param, envelope field or `data` key is added or removed, so this is an amendment of v1.9, not a new version, and the wire `contract` stays `"MD-1.0"` (§8.4). **Not armed:** every kind of §4.12 stays default OFF. The instruction quoted here is about Schwab only: it is not an acknowledgement of v1.9, and the §8.1 status recorded in the v1.9 entry below is unchanged.
- **v1.9 addition (2026-11-17, terminal-data, data wave 3):** §4.12 documents four kinds added dark with this version: `levels.gamma`, `flow.topPicks`, `flow.record`, `earnings.reactions`. All four are model-isolated (ADR-005: UCT-derived levels, selections and measurements over options data, and UCT's calendar with third-party results and estimates), and none starts a build or spends a provider call: `levels.gamma` and `earnings.reactions` read only what their routes already hold and are `unavailable` or `partial`, with the reason, otherwise; the two flow kinds read the pick tracker's in-memory lists (§5). One earlier statement is amended: §4.10's "Not kinds" line said gamma walls are not exposed to the Agent; they are now read only by the isolated `levels.gamma`. `flow.summary` stays deferred (§4.4), and the flow-worker's lists are not kinds. Additive: no existing kind changes and no envelope field changes, so the wire `contract` stays `"MD-1.0"` (§8.4). **Not armed:** every kind of §4.12 is default OFF, and switching one on is the owner's step, not this document's. §8.1 status: the version bump and this entry are in the PR that adds the kinds. The message to agent-lead that §8.1 asks for is owed by a person: it has not been sent, and this version is not acknowledged by anyone as of this entry. Nothing in this entry or in §4.12 records an owner decision.
- **v1.8 addition (2026-11-17, terminal-data, data wave 2):** §4.11 documents five kinds added dark with this version: `highsLows.yearly`, `themes.rotation`, `confluence.board`, `earnings.expectedMove`, `earnings.callSearch`. All five are model-isolated (ADR-005: UCT-derived lists, selections and option-chain arithmetic, and third-party transcript excerpts), and none starts a build inside a turn: each reads what its service already holds and is `unavailable`, with the reason, otherwise (§5). One earlier statement gains a pointer: the §4 `nhnl` row (the names behind the two 52-week counts are read by `highsLows.yearly`; the counts stay `breadth.current` measures). `flow.summary` stays deferred (§4.4). Additive: no existing kind changes and no envelope field changes, so the wire `contract` stays `"MD-1.0"` (§8.4). **Not armed:** every kind of §4.11 is default OFF, and switching one on is the owner's step, not this document's. §8.1 status: the version bump and this entry are in the PR that adds the kinds; acknowledged by the owner on 2026-11-17, in place of agent-lead: that session has ended (`PROGRAM.md`, 2026-11-03: "agent-lead's session has ended; the Agent project continues in this integrator session") and the program has no inbox, so the owner was shown both additions (ten kinds, all default OFF) and acknowledged them. The acknowledgement covers the contract text only: it arms nothing, and switching any kind on stays a separate owner decision per kind.
- **v1.7 addition (2026-11-17, terminal-data, data wave 1):** §4.10 documents five kinds that merged dark in #1584: `analyst.actions`, `highsLows.session`, `sectors.performance`, `leaders.longRun`, `levels.darkpool` (four model-isolated, ADR-005; `sectors.performance` is not). Two earlier statements are amended with them: the §4 `nhnl` row (v1.3 recorded `nhnl_live` as "not exposed"; it is now read only by the isolated `highsLows.session`, which is never a 52-week measure) and the §4.4 `darkpool` deferral (a trustworthy `as_of` is identified for price LEVELS only, the newest confirmed print date; a prints kind stays deferred). Additive: no existing kind changes and no envelope field changes, so the wire `contract` stays `"MD-1.0"` (§8.4). **Not armed:** every kind of §4.10 is default OFF, and switching one on is the owner's step, not this document's. §8.1 status: the version bump and this entry are in the PR that edits this file; acknowledged by the owner on 2026-11-17, in place of agent-lead: that session has ended (`PROGRAM.md`, 2026-11-03: "agent-lead's session has ended; the Agent project continues in this integrator session") and the program has no inbox, so the owner was shown both additions (ten kinds, all default OFF) and acknowledged them. The acknowledgement covers the contract text only: it arms nothing, and switching any kind on stays a separate owner decision per kind.
- **v1.6 addition (2026-11-03, builder-b, W2-B2):** `bars.daily` gains `from` (a window read); §4.6 `offHigh`, `pullbacks` and `range` with `from`; §4.9 `history.eventStudy` over Market Intelligence's event study (technical series only, local-only to the model). No envelope change.
- **v1.6 addition (2026-11-03, agent-rs, W2-B1):** §4.8 `research.company`, a composed kind over the served kinds plus the turn's one web search (contract RS-1). No envelope change.
- **v1.5 amendment (2026-11-02, agent-md, G2):** §4.7.5 L6. While the symbol index is older than 3 days (or undated), no lowercase word or lowercase cashtag is confirmed; it gets the #691 neutral ask with `basis` `index_stale`. Classes and reads unchanged.
- **v1.5 amendment (2026-11-02, agent-md, owner ruling):** §4.7.5. A lowercase word or lowercase cashtag is priced when the index confirms it (L1–L5), each result carries `basis`, and a list must name a candidate in every item. Classes, precedence and reads are unchanged.
- **v1.5 amendment (2026-11-02, agent-md, owner rulings):** §4.7.3 wording. Clarifications are neutral and name no security; an ETF is labelled `an ETF` and every answer pricing one says the price is the fund's share price, not the underlying's. Classes, precedence and reads are unchanged.
- **v1.5 fix (2026-11-02, agent-md, agent-qa F-23):** "the most recent completed session" (`bars.daily`, `ratings`, `themes`) counts a half day from its own 13:00 ET close, not 16:00 (`marketdata/sessions.py`). No envelope change.
- **v1.5 addition (2026-11-01, agent-md, Sprint 2 C):** §4.6 `stock.dailyBars` answer contract over `bars.daily` (last close, N-session change, 52-week range). No envelope or kind change.
- **v1.5 addition (2026-11-01, agent-md, owner decision):** §4.7 instrument and intent resolution; new kind `instrument.resolve` over the canonical symbol index. No envelope change.
- **v1.5 amendment (2026-11-01, agent-md, agent-qa F-19/F-20/O-1):** `session_detail` takes every input from `now`; on a half day extended trading ends at 17:00 ET; no-price answers use fixed words. No envelope field changed.
- **v1.5 (2026-11-01, agent-md, Sprint 2):** additive. `quote` / `quotes` gain `data.session_detail` (`regular` · `premarket` · `after-hours` · `overnight` · `closed`); `data.session` is derived from it. §4.5 gives the `stock.quote` answer contract per session state. No envelope field changed.
- **v1.4 (2026-11-01, agent-md, rulings by agent-lead):** `breadth.current` and `ratings` implemented as MODEL-ISOLATED kinds (purpose `answer` only, gateway #588); §4.4. No envelope change.
- **v1.3 (2026-11-01, agent-md, rulings by agent-lead):** `themes` source and time semantics (§4.3); `volume.surge` REMOVED (relative volume is SC-1's; see SC-1 §2c); `nhnl` folded into `breadth.current` metrics, `nhnl_live` not exposed. No envelope change.
- **v1.2 (2026-11-01, agent-md):** additive. `fundamentals`, `earnings` and `news.company` sources are named in §4 (`financial_statements`, `earnings_table`, the news store), and their stale budgets are restated to measure the data (§4.2). Every class stays `periodic`; the wire `contract` stays `"MD-1.0"` (§8.4).
- **v1.1 (2026-11-01, agent-md, acked by agent-lead):** additive. `quote`/`quotes` classify extended hours by vendor timestamp; each row gains `last_source`; a close-priced row in a live read makes it `partial` and is excluded from `as_of`; `data.session` becomes `regular` · `extended` · `closed`. The pre-market note contradiction is removed (§4.1). No envelope field changed.
- **v1.0 (2026-11-01):** first accepted version.
