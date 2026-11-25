# MD-1 — UCT market-data contract (v1.19)

- **Owner:** agent-md implements the kinds. agent-lead owns `gateway.py` and `envelope.py`, the framework every consumer relies on.
- **Consumers:** agent-sc, agent-rs, agent-qa, and later the D and G workstreams.
- **Status:** v1.19 (v1.1–v1.19 each additive or a scope reduction; v1.1–v1.4 acked by agent-lead 2026-11-01, v1.5 agreed for Sprint 2; v1.6, v1.7, v1.8, v1.9, v1.10, v1.11, v1.12, v1.13, v1.14, v1.15, v1.16, v1.17, v1.18 and v1.19 are additions whose new kinds are default OFF (v1.18 also narrows `ratings` to a held read); v1.7 is written up after its kinds merged dark, v1.8, v1.9, v1.10, v1.11, v1.12, v1.13, v1.14, v1.15, v1.16, v1.17, v1.18 and v1.19 with their kinds; v1.7 and v1.8 acked by the owner 2026-11-17 in place of agent-lead, whose session has ended; the §8.1 notices for v1.9, v1.10, v1.11, v1.12, v1.13, v1.14, v1.15, v1.16, v1.17, v1.18 and v1.19 are owed by a person and are not acknowledged, see §9). See §9 for what changed. The envelope's wire field `contract` stays `"MD-1.0"`: no version since v1.0 adds an envelope field.
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
| `fundamentals` | `services/financial_statements.py` `get_statements` (FMP first; Yahoo Finance only for a ticker FMP has no statements for; the product's statements cache; `source` is `fmp` or `yahoo-finance`, whichever answered) | periodic | the newest period end is more than 135 days old | Periodic financial **disclosures**, never live. `as_of` = the newest statement period end; the source has no filing date. See §4.2. |
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
- `provider_calls` is what the service's synchronous build cost when this read caused one (`meta.build_calls`: 6 FMP statement reads; 12 or 13 when it went on to Yahoo Finance), else 0.
- `source` is `fmp` or `yahoo-finance`: the source of the statements served. A failed read is `unavailable` with the note `the statements source did not answer; try again shortly`, never "no financial statements".
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
- `provider_calls` 0 per read since v1.18 (it was 3 while the adapter called `get_ratings`, which on a cache miss builds the rating from three vendor reads). **v1.18 (terminal data wave 12): a held read.** The adapter reads only what the server already holds, through `ratings_held.held_ratings` (`api/services/research/ratings_held.py`, the same cache entry `get_ratings` answers from; never a build), so the first capability over this kind (`stock.uctRating`, local-only, §4.21) adds no vendor read to a turn. Nothing held: `unavailable` with the note `{symbol}'s UCT Rating is not held on this server yet, and this read never works it out. That is not the same as no rating. Open RTG for {symbol} in UCT, then ask again`. A fund: `unavailable` with `{reason}, so no UCT Rating is stated. That is not the same as a low rating` (the RTG route's own reason). A failed read: `the UCT Rating read failed; nothing is stated. That is not the same as no rating`. Narrowed by the wave 12 builder as the narrower rule; not an owner decision.
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

### 4.13 Terminal data wave 4: `earnings.season`, `earnings.callThemes`, `group.drill` (v1.10, terminal-data)

Three more thin kinds, the Agent half of the ERNS, CEOS and GRP terminal panels. Each is an adapter over the service
its member route already reads (`api/services/uct_agent/marketdata/earnings_season.py`, `earnings_call_themes.py`,
`group_drill.py`; registered in `kinds.py` with `owner="terminal-data"`). No new connection, job, database or write (§6).

**Status: dark, not armed.** Like every kind, each is served only when it is listed in `UCT_AGENT_DATA_KINDS` (with
`UCT_AGENT_DATA=1`). All three are model-isolated, so each also needs the master switch `UCT_AGENT_ISOLATED=1` and its
own entry in `UCT_AGENT_ISOLATED_KINDS` (§4.4, ADR-005); until then it is refused for every purpose, and once armed it
is served for purpose `answer` only. This section describes what the code does when a kind is switched on. It does not
switch anything on. As written (2026-11-18), no kind of this section is in production's list.

| Kind | Canonical service (member route) | Params | Declared freshness | `as_of` | `provider_calls` | Model-isolated |
|---|---|---|---|---|---|---|
| `earnings.season` | the day's answer `api/services/earnings_season.py` already holds, read through `earnings_season.held_day` (`GET /api/calendar/earnings-season`) | `{date?, session, limit}` | periodic · historical (a past day) | null (only UCT's build times are known) | 0 | **yes** |
| `earnings.callThemes` | the lists `api/services/call_themes.py` already holds, read through `call_themes.held_themes` (`GET /api/earnings/call-themes`) | `{month?, list, limit}` | periodic | the date of the newest earnings call the lists were worked out from | 0 | **yes** |
| `group.drill` | the per-stock ranking `api/services/scan_period.py` already holds, grouped by `scan_period.period_groups_of` (`GET /api/scans/period-change`, `GET /api/scans/period-change-groups`), joined with the RS ranking the server holds (`GET /api/rs-rankings`) and the confluence board's cache entry (`GET /api/confluence`) | `{range, kind?, group?, sort, dir, limit}` | periodic | null (the ranking carries two days and UCT's build time) | 0 | **yes** |

**No read of this section starts a build or spends a provider call.** (§5: a turn has 20 provider requests and a member
waiting.) Every one of these member routes answers at once from what its service holds and, when it holds nothing,
STARTS that service's background build. A turn must not start one, so each adapter reads through a read-only accessor
of the service and answers `unavailable` (or `partial`), with the reason, when nothing is held:

| Kind | What the member route can start | What the adapter reads instead |
|---|---|---|
| `earnings.season` | `get_day` starts the service's one background build for the day and waits up to 4 seconds on it: a calendar week read (a multi-provider build for any week but the current one) and, for today, one Massive batch snapshot | `earnings_season.held_day`: the held answer inside its freshness (`data.held` `fresh`), else the last good answer (`last_good`, and the read is `stale`); otherwise `unavailable`. It starts no build and waits on none |
| `earnings.callThemes` | `get_themes` starts the one background scan on a server that holds nothing (every held call read two or three times), and again when the held lists are older than 36 hours | `call_themes.held_themes`: the module's held answer, else the stored file (read once); otherwise `unavailable`. It starts no scan, cold or stale: old lists are served `stale` |
| `group.drill` | `get_period_change` starts ONE background build of the whole-market ranking when it holds nothing for the range (two whole-market grouped-daily reads and the market snapshot); the RS route starts a 17-second rebuild on a cold cache; `get_board` starts a four-minute rebuild on a cold or old board | the ranking the service holds (`_period_answer`: `fresh`) or its last good one (`_period_old_answer`: `last_good`, `stale`), grouped by `scan_period.period_groups_of`; the RS ranking from the cache or the last one written to disk; the board's cache entry. None of the three entry points is called |

The two accessors and the grouping function are in the services themselves (added with this version), so each service
keeps one authority over what it holds: `earnings_season.held_day` mirrors the first lines of `get_day`,
`call_themes.held_themes` shares `get_themes`'s own shaping function, and `get_period_change_groups` IS
`scan_period.period_groups_of` over `get_period_change`. Rails hold each accessor to its route's reader (the same answer
whenever the route would not build) and count builds, threads and provider clients through the real service state:
with nothing held the adapter starts none, and the route's own reader is shown to start one in the same state.
`group.drill` also reads private names of two services (the ranking's cache key and its two held-answer readers; the
board's cache entry); a rail fills each through the service's own writer and reads it back, so a rename fails by name.

**Rules all three share**
- **A bad request is refused before any read.** Each kind's `validate` runs before admission (a `date` that is not a
  real weekday written `YYYY-MM-DD`, an unknown `session`, `list`, `range`, `kind`, `sort` or `dir`, a `month` that is
  not `YYYY-MM`, a `group` with no `kind`, an out-of-range `limit`): the read is `refused` and spends no budget.
- **A failed read is `unavailable`, never an empty answer.** "Nobody reports that day", "no phrase passed the rules",
  "the ranking has no such group" are said only when the service answered healthily with nothing in it, and that read
  is `ok` with a note that says so. A day, lists or a ranking that are not held are each `unavailable`, with their own
  note; moves, RS ranks or a board that are not held make the read `partial`.
- **A value that does not exist is null, never 0.** A company with no stored priced move, no past move or no move has
  null for it; a phrase nothing earlier said has `ratio: null`; a stock with no RS rank has `rs: null`, and one that is
  not on the board has `flow: null`.
- **Never worded as live or now** (§3). Where the source carries only UCT's own build time, `as_of` is null, that time
  rides in `data` under a name that says what it is, and a note says why `as_of` is not given.
- **The server says when it cut a list.** Each kind returns at most `limit` rows, the whole count beside them, and a
  note naming both.
- **The member's answer is built from the read's `data` and `status`.** The browser capabilities template their text
  from those; an envelope note is never echoed to the member as if it were data.

**Why all three are model-isolated.** A value is isolated when the owner has not cleared it for the model (§4.4):
UCT-derived output, options data, or third-party data whose AI-processing right is unresolved. When in doubt, a kind is
isolated. No row of the licensing record (`api/services/provider_licensing_class.py`) clears any source below for a
model provider: every Massive and FMP row is display-only.
- `earnings.season`: the day's list is UCT's own calendar over third-party calendar vendors' results and estimates,
  whose AI-processing right is not on record (the reason `earnings.reactions` is isolated); the priced move is worked
  out by UCT from an option chain (`earnings.expectedMove`); the past moves are UCT's own arithmetic on daily bars.
- `earnings.callThemes`: every phrase is taken from third-party earnings call transcript text whose AI-processing right
  is unresolved, the same reason `earnings.callSearch` is isolated (§4.11); the transcripts row of the licensing record
  is display-only and carries a copyrighted-prose prompt exclusion. A phrase is shorter than an excerpt, and it is
  still the vendor's text, selected and ranked by UCT's own counting.
- `group.drill`: the RS rank is UCT-derived (the reason `rs.leadership` is isolated), the board is UCT's own selection
  (`confluence.board`), UCT themes are UCT's own taxonomy (hidden from the Agent's screens by owner decision), and the
  changes are derived analytics over a vendor's whole-market closes.

Whether an isolated value may ever reach the model is an owner decision (§4.4). On the browser the three kinds are read
only by local-only capabilities (`stock.earningsSeason`, `stock.callThemes`, `stock.groupDrill` in
`app/src/agent/capabilities/terminalDataWave4.js`, all in `turn.LOCAL_ONLY_ACTIONS`): the model plans the lookup and
never sees what came back. Each capability registers only while the server lists its own kind.

**`earnings.season`** (source `uct-earnings-season`)
- What it returns: one day's reporters by session (before the open, after the close, time not confirmed), biggest
  company first, each with the service's own numbers. Every `ok` or `partial` read of a day the calendar carries has
  the notes
  `the companies on UCT's earnings calendar for {date}, by when they report, biggest company first, each with the move options priced before the report, how the stock moved on its past reports, and the result and the stock's move once it lands; results and estimates are third-party calendar data as UCT holds it`,
  `a priced move is what the at-the-money straddle priced before the report, as a percent of the stock price, stored once by UCT's weekday capture from UCT's own Massive option chain; a company with none stored has none here, never 0`
  and `a past move is the close-to-close move of the session that first traded each past result, from UCT daily bars, given only where the server already holds it`.
- Params: `date` (optional, `YYYY-MM-DD`, a weekday; with none it is the service's own "next day with a reporter"
  answer, said with the note `no day was asked for, so this is the next day with a reporter, as the server last worked it out`);
  `session` ∈ all · bmo · amc (default all; the ERNS panel's own keys); `limit` 1–50 companies (default 25).
- **Nothing is re-derived.** A priced move, a past move, a verdict (beat · miss · mixed) and a move are the service's.
  Stored priced moves from any chain but UCT's own Massive option chain are withheld by the service and counted:
  `{n} stored priced moves are left out: they did not come from UCT's own Massive option chain, or they carry no usable percent`.
  Past moves are given only where the server already holds a stock's earnings model:
  `{n} of the {total} companies have no past moves held on the server; that is not the same as no past report`.
- **What a move is** (the service's own rule, restated). Today:
  `for today a move is the regular session's change so far, for a report that came before the open or with no confirmed time; a report after the close has no move until the next close`.
  A past day: `for a past day a move is the Calendar's own settled close-to-close move, given only when the server already holds it`.
  Each row's `move_state` says which: `live`, `settled`, `next_close` (today, after the close: none until the next
  close), `not_held`, `none`, `failed`, or null when the company has not reported.
- `partial` when something the answer could not read is missing, each with its note:
  the stored priced moves (`the stored priced moves could not be read when this answer was built, so none is given; that is not the same as none priced`);
  a past day's moves (`the moves for {date} are not held on the server, and this read never starts price reads; the results are given without them, which is not the same as no move`);
  today's price read (`the price read for the moves failed when this answer was built, so no move is given; that is not the same as no move`).
- What is held (`data.held`): `fresh`, the held answer; or `last_good`, when the read is `stale` with the note
  `this is the last good answer for {date}, older than the {minutes} minutes it is normally kept, so a result or a move that landed since is missing`.
- `as_of` is always null. `data.built_at` is when UCT put the answer together and `data.calendar_as_of` when the
  calendar week it read was built (computation times), with the note
  `put together by UCT at {at} (UCT's own time; the calendar carries only the day it is for), so as_of is not given: not a live feed`
  (or `the held answer carries no build time, so its age is unknown and as_of is not given`, and then the read is `stale`: unknown is never claimed fresh).
  Today's and a coming day's read is `periodic`; a past day's is `historical`.
- Healthy answers with no company: nobody is on the calendar (`no company is on UCT's earnings calendar for {date}; that is a healthy answer, not a failed read`);
  the calendar week carries no such day (`UCT's earnings calendar carries no {date} in the week it holds (a market holiday); that is a healthy answer, not a failed read`);
  the bare read on a weekend (`{date} is a weekend day, so no company reports; that is a healthy answer, not a failed read`);
  nobody in the session asked for (`{total} companies are on the calendar for {date}, none of them reporting {when}`).
- More companies than `limit`: the biggest by market cap are kept, each under its own session, `data.count` is every
  company of the session asked for, and the note is
  `showing the {n} biggest of {total} companies by market cap, a company with no market cap on file last, each under its own session`.
- `unavailable`: nothing is held for the day
  (`no earnings season answer for {date} is held on the server (one is kept up to {minutes} minutes after the Earnings season panel reads that day, and a last good copy {extra} minutes more), and this read never starts that build; that is not the same as nobody reporting`;
  for a read with no date, `{date}` reads `the next day with a reporter`);
  the day is outside the service's reach
  (`{date} is outside the days the earnings season answer reaches ({first} to {last}: the calendar's own week and one week either side)`);
  the calendar could not be read when the answer was built
  (`the earnings calendar could not be read when the answer for {date} was built; that is not the same as nobody reporting`);
  a malformed answer or a failing service (`the earnings season answer could not be read for {date}`).
- Data fields: `date`, `today`, `day_kind` (today · past · future), `default`, `session`, `sessions` (`bmo`, `amc`,
  `tbd`: lists of rows), `count`, `shown`, `scheduled` (every company of the day), `counts` (`scheduled, reported,
  priced, priced_withheld, with_past, past_not_held, moved`, the service's own, over the whole day), `priced_state`
  (read · failed), `moves_state` (live · held · not_held · failed, or null), `calendar_as_of`, `built_at`, `capture`
  (`hour_et, minute_et`), `range` (`from, to`), `held` (fresh · last_good), `no_day`. Row fields, by the service's own
  names: `sym, name, session, mc_b` (market cap, billions), `eps_est, eps_act, rev_est, rev_act` (revenue in millions),
  `reported, verdict, priced` (`pct, dollar, captured_at, expiry`, or null), `past` (`moves` of `date, pct`, newest
  first, `avg_abs, n`, or null), `past_state` (ok · not_held · not_measured), `move` (percent, or null), `move_state`.
  `coverage` counts the companies of the session asked for against the rows returned.

**`earnings.callThemes`** (source `uct-call-themes`)
- What it returns: for one calendar month of indexed earnings calls, the service's two lists of phrases. Every `ok`
  read carries the notes
  `the one- to three-word phrases whose share of {month}'s earnings calls rose the most against the months before it: new (near absent before) and rising (said before and clearly more now); a call counts once however often it says a phrase. Phrases are taken from third-party earnings call transcripts as UCT's index holds them; UCT's own counting, not a forecast`
  and `no transcript text is returned: a row is a phrase of at most {words} words with its counts and up to {examples} example tickers`.
- Params: `month` (optional, `YYYY-MM`, the member route's own rule; default the newest month with a list); `list` ∈
  both · new · rising (default both; the CEOS panel's own keys); `limit` 1–30 rows of each list (default 10, the
  panel's own count; 30 is the service's own cap).
- **Nothing is counted or ranked here.** A row is the service's row, in the service's order (most-said first for new,
  biggest rise first for rising). The earlier share a phrase is compared with is like for like:
  `compared with {calls} earlier calls ({months}), weighted to this month's mix of industries: {matched}% of this month's calls could be matched to their own industry or sector`
  (or `compared with {calls} earlier calls ({months}) as a plain comparison: no industry weighting could be applied`).
- **No transcript text beyond the phrase.** A row is a phrase of at most three words with counts and up to three
  example tickers, which is what the member route sends. To read what was said, the member opens the call search.
- `as_of` = the date of the newest earnings call the lists were worked out from, as the start of that Eastern day,
  with the note
  `as_of is the date of the newest earnings call the lists were worked out from (a date, not a time of day); UCT worked them out at {at}, once a day after the call index updates`
  (or null with `the held lists do not say which calls they were worked out from, so as_of is not given`).
  `data.built_at` is when UCT worked the lists out (a computation time).
- `stale` when the lists are older than the service's own refresh bound (36 hours), with the note
  `these lists were worked out more than {hours} hours ago, so calls indexed since then are not in them`,
  or when their age cannot be told (`the held lists carry no usable build time, so their age is unknown`). This read starts no rebuild.
- No phrase on the lists asked for is a finding: `ok`, with the note
  `no phrase passed the rules for {month}; that is a finding about the calls the index holds, not a failed read`.
- More phrases passed than are returned: `data.qualified` counts every phrase that passed, `data.shown` the rows
  returned, and the note is
  `showing the first {n} of {total} phrases that passed on the {name} list, in the list's own order; the weakest are the ones left out`.
- `unavailable`: no lists are held
  (`no call themes are held on this server yet (they are worked out once a day after the call index updates), and this read never starts that work; that is not the same as no phrase rising`);
  the call index is empty
  (`no earnings calls are indexed on this server, so there is nothing to compare; that is not the same as no phrase rising`);
  no month has enough calls
  (`the call index holds {calls} earnings calls and no month has enough of them to compare yet; that is not the same as no phrase rising`);
  the month asked for has no list (`there is no list for {month}; the months that have one are {months}`,
  or `there is no list for {month}, and no month has one yet`);
  a malformed answer or a failing service (`the call themes could not be read`).
- Data fields: `month`, `months` (those with a list, newest first), `list`, `calls`, `companies`, `baseline` (`months,
  calls, matched_pct`), `floor` (`calls, companies`), `new`, `rising`, `qualified` (`new, rising`), `shown` (`new,
  rising`), `built_at`, `refreshing` (a build someone else started is running), `corpus` (`calls, oldest, newest`),
  `rules` (the service's thresholds). Row fields, by the service's own names: `phrase, words, calls, pct, companies,
  base_calls, base_pct, base_raw_pct, rise` (percent and points), `ratio` (null when nothing earlier said it),
  `related` (phrases said by the same calls), `examples` (tickers). `coverage` counts the phrases that passed against
  the rows returned.

**`group.drill`** (source `uct-group-drill`)
- What it returns, in one of two shapes (`data.mode`):
  - `groups` (no `group` named): the names of the ranked groups, for one `kind` or all three, each with its change and
    how many of its stocks are ranked, with the note
    `the groups of each kind asked for (sectors, industries, UCT themes) that hold at least one ranked stock over {range} (between the closes of {start} and {end}), each with its change and how many of its stocks are ranked; UCT's own grouping, not a recommendation`.
    A name is resolved against these lists in the browser, by the GRP panel's own resolver: the server has no resolver.
  - `group` (a `kind` and the group's exact name): that group's stocks, with the notes
    `the stocks of the {kind} {name} with each one's percent change over {range} (between the closes of {start} and {end}), its RS rank and whether it is on UCT's confluence board; UCT's own ranking and grouping, not a recommendation`
    and `the group's own change is UCT's average of its ranked stocks with the biggest gains capped, so one outsized gainer cannot carry it; each stock's change is its own`.
- Params: `range` ∈ mtd · qtd · ytd · m1 · m3 · m6 · y1 (default ytd: the seven one-click ranges the web service keeps
  built, and no other); `kind` ∈ sector · industry · theme (optional without a `group`); `group` (optional, the name
  exactly as the ranking lists it, at most 80 characters; needs `kind`); `sort` ∈ pct · rs (default pct); `dir` ∈ desc
  · asc (default desc); `limit` 1–50 stocks (default 25).
- **The groups are the route's own.** `scan_period.period_groups_of` is the function behind
  `GET /api/scans/period-change-groups`: a UCT theme's engine-suggested holdings are left out, a theme with no ranked
  stock is not a group, and a group's own change is the route's
  (a stale ranking is said: `this is the last good ranking for the range, older than the {minutes} minutes it is normally kept, so it may be behind the market`;
  a ranking from UCT's own bar history: `the ranking for this range comes from UCT's own bar history, so stocks that have since delisted are missing`).
- **RS** (`data.rs_state`). Every read of a group carries the note
  `an RS rank is UCT's 1 to 99 rating of a stock against the market; a stock the ranking does not hold has none, which is not a rank of 0`.
  `held`: the server's cached ranking. `last_stored`: the last ranking written to disk, and the read is `stale`
  (`the RS ranks are from the last ranking written to disk, because the server's cache is cold, so they may be behind`).
  `not_held`: every `rs` is null and the read is `partial`
  (`the RS ranking is not held on the server, and this read never starts that rebuild; no RS rank is given, which is not the same as no rank`).
  The RS route hides a stock in a pending acquisition from its displayed list; that set is built on its first read of
  the day, so it is not read here, and such a stock keeps the rank it was given.
- **Flow** (`data.flow_state`). Every read of a group carries the note
  `the flow column says only whether a stock is on UCT's confluence board (a large dark pool dollar size with aligned long-dated options flow) and on which side; a stock not on the board has none`.
  `held`: the board's cache entry (an entry older than its refresh makes the read `stale`:
  `the confluence board is older than its {minutes}-minute refresh, so the flow column may be behind`).
  `not_held`: every `flow` is null and the read is `partial`
  (`the confluence board is not held on the server, and this read never starts that build; no flow signal is given, which is not the same as no stock being on the board`).
- The order is the GRP panel's own: by change or by RS rank, either direction, a stock with no value for the column
  last either way. A member the ranking carries no change for is listed last:
  `{n} of the {total} stocks have no change in the ranking and are listed last, never as 0%`.
  More stocks than `limit`: `data.count` is every stock of the group, and the note is
  `showing the first {n} of {total} stocks, {order}`.
- `as_of` is always null. The ranking carries the two trading days it measures between (`data.start_day`,
  `data.end_day`) and when UCT built it (`data.built_at`), with the note
  `the ranking was built by UCT at {at} (UCT's own time; it carries the two days it measures between, not a data time), so as_of is not given: not a live feed`
  (or `the held ranking carries no build time, so its age is unknown and as_of is not given`, and then the read is `stale`).
- Healthy answers with nothing in them: the ranking has no such group (`ok`, `data.found` false:
  `the ranking holds no {kind} called {name} for this range ({n} are ranked); a name must be given exactly as the ranking lists it`);
  a kind with no ranked group (`no {kind} holds a ranked stock for this range; a stored list that could not be read looks the same, so this is not a statement that there is none`).
  A list of more than 400 groups of one kind is cut and said: `showing the first {n} of {total} {kind} groups, biggest gain first`.
- `unavailable`: the ranking for the range is not held
  (`the ranking for {range} is not held on the server (the web service keeps the seven one-click ranges built, each for {minutes} minutes and a last good copy {extra} minutes more), and this read never starts that build; that is not the same as no group`);
  what is held for the range is not a list
  (`the server's last attempt to rank {range} did not produce a list, and this read never starts another; that is not the same as no group`);
  a failing service (`the group could not be read`).
- Data fields, both shapes: `mode`, `range`, `start_day`, `end_day`, `built_at`, `held` (fresh · last_good),
  `partial_history`, `kind`. `groups` adds `lists` (per kind: rows of `name, pct, count`) and `counts`. `group` adds
  `name`, `found`, `group_pct`, `rows`, `count`, `shown`, `known` (stocks with a change), `ranked` (with an RS rank),
  `on_board`, `sort`, `dir`, `rs_state` (held · last_stored · not_held), `flow_state` (held · not_held),
  `flow_built_at`. Row fields: `sym, pct` (percent), `start_close, end_close, industry, sector, rs` (1 to 99, or null),
  `flow` (`dir` BULL · BEAR, `status` BUILDING · STEADY · ESTABLISHED; or null). `coverage` counts the group's stocks
  against the rows returned.

**Not kinds of this wave**
- **Unusual volume (the UNVOL panel).** It needs no kind of its own: it is the Screener's by-now relative volume, and
  the existing scan kind `screen.run` (SC-1) already takes the panel's scan as a spec (`rvol_live` at or above 2, 3 or
  5 times, price at or above $5, 30-day dollar volume at or above $10 million, no ETF, ordered by `rvol_live`; the
  last-session reading is the same scan on `vol_ratio`). It reads the screener's own store (`provider_calls` 0) and is
  already in production's list. The one thing of the panel's body it does not take is the raw `bars_asof` column,
  which is outside the Screener's field catalog; `screen.run` dates its rows itself (its `as_of`). A rail runs every
  body of `tests/fixtures/terminal_unvol_scan_requests.json` through the Agent's scan validator. Nothing was added: a
  second kind for the same reading would be a second authority over it.
- **The member's own Journal history on a stock (the MYH panel).** It is the member's private record (their trades,
  positions, option strategies and notes), governed by the Journal's own rules and the coach's consent, not by this
  contract. No market-data kind reads it. The Agent's existing journal answers are the coach's `journal.reviewTrades`
  (the member's recent trades as a whole, with their consent in the chat, local-only) and `journal.listNotes` (their
  notes on a ticker, on the Journal page); neither covers one stock's trades and positions, and this wave adds nothing
  there.

### 4.14 Terminal data wave 5: `short.interest`, `short.list` (v1.11, terminal-data)

Two more thin kinds, the Agent half of the SHINT and SHRTS terminal panels: FINRA short interest (reported twice a
month) and FINRA daily short sale volume, both read through UCT's market-data vendor. Each is an adapter over the
service its member route already reads (`api/services/uct_agent/marketdata/short_interest.py`, `short_list.py`, both
over `api/services/short_data.py`; registered in `kinds.py` with `owner="terminal-data"`). No new connection, job,
database or write (§6).

**Status: dark, not armed.** Like every kind, each is served only when it is listed in `UCT_AGENT_DATA_KINDS` (with
`UCT_AGENT_DATA=1`). Both are model-isolated, so each also needs the master switch `UCT_AGENT_ISOLATED=1` and its own
entry in `UCT_AGENT_ISOLATED_KINDS` (§4.4, ADR-005); until then it is refused for every purpose, and once armed it is
served for purpose `answer` only. This section describes what the code does when a kind is switched on. It does not
switch anything on. As written (2026-11-18), neither kind is in production's list.

| Kind | Canonical service (member route) | Params | Declared freshness | `as_of` | `provider_calls` | Model-isolated |
|---|---|---|---|---|---|---|
| `short.interest` | the stock's answer `api/services/short_data.py` already holds, read through `short_data.held_stock` (`GET /api/research/short-data/{ticker}`) | `{symbol, reports, days}` | periodic · every read historical | the settlement date of the newest report (never today) | 0 | **yes** |
| `short.list` | the ranked list `api/services/short_data.py` already holds (in memory, or its disk copy read once per process), read through `short_data.held_market` (`GET /api/research/short-interest-list`) | `{rank, limit}` | periodic · every read historical | the report's settlement date (never today) | 0 | **yes** |

**No read of this section starts a build, a check or a vendor request.** (§5: a turn has 20 provider requests and a
member waiting.) Both member routes answer at once from what the service holds and, when it holds nothing, START the
service's background build. A turn must not start one, so each adapter reads through a read-only accessor of the
service and answers `unavailable`, with the reason, when nothing is held:

| Kind | What the member route can start | What the adapter reads instead |
|---|---|---|
| `short.interest` | `get_stock` starts the service's one background build for the stock (two vendor requests: the short interest history and the daily short volume) and waits up to 3 seconds on it; with a last good answer held it serves that and starts the rebuild | `short_data.held_stock`: the held answer inside its freshness (`data.held` `fresh`), else the last good answer (`last_good`, and the read is `stale`); otherwise `unavailable`. It starts no build and waits on none |
| `short.list` | `get_market` starts the service's one background build (four to six vendor requests) when nothing is held and waits up to 3 seconds on it; with a list held it starts the cheap look for a newer report once that look is due | `short_data.held_market`: one ranking of the held list by the service's own `rank_market`; with no list held, what the service's last build said while that answer still stands (`unavailable` or `failed`, with its reason); otherwise `unavailable`. It starts no build and no look |

Both accessors are in the service itself, so the service keeps one authority over what it holds. `held_stock` mirrors
the first lines of `get_stock`; `held_market` ranks with `get_market`'s own `rank_market` and, with this version,
hands back the service's standing `unavailable` / `failed` answer when no list is held (before, it said only "not
held"), which is the answer `get_market` gives in that state without starting another build. Rails hold each accessor to
its route's reader (the same answer whenever the route would not build) and count builds, threads, provider clients
and vendor requests through the real service state: with nothing held, and with a rebuild or a look due, the adapter
starts none, and the route's own reader is shown to start one in the same state. A further rail replaces `get_stock`,
`get_market`, `build_stock`, `build_market`, `_start_market_job`, both thread bodies and the vendor readers with
functions that fail, and runs every read of this section held and not held.

**The service's own states, and what each read says.** Each state is kept apart, and none is ever said as "no short
interest" or "no stock being short":

| The service says | `short.interest` | `short.list` |
|---|---|---|
| nothing held (the member route's `computing`: a build may be running; this read never starts or waits on one) | `unavailable`, not held | `unavailable`, not held |
| `unavailable`, reason `refused` (the vendor refused this site's key: the data plan) | `unavailable`, refused (both datasets) | `unavailable`, refused |
| `unavailable`, reason `not_configured` (no vendor key on the server) | `unavailable`, no key | `unavailable`, no key |
| `unavailable`, reason `shape` (the vendor answered with rows that cannot be read) | (per dataset: that dataset is `failed`) | `unavailable`, shape |
| `unavailable`, reason `thin` (too few of the stocks UCT follows in the report) | (not a stock state) | `unavailable`, thin |
| `failed` (the last build failed) | `unavailable`, read failed | `unavailable`, read failed |
| `bad_symbol` / `bad_rank` | refused by `validate` before any read (the service's own symbol rule) | refused by `validate` before any read |
| one dataset `unavailable` or `failed` beside a healthy one | `partial`, with that dataset's note | (not a list state) |
| `none` (the vendor answered and holds no rows for the stock) | `ok`, a healthy empty dataset, said | (not a list state) |

**Rules both share**
- **A bad request is refused before any read.** Each kind's `validate` runs before admission (a `symbol` that is not
  one US stock or fund ticker by the service's own rule, an unknown `rank`, an out-of-range `reports`, `days` or
  `limit`): the read is `refused` and spends no budget.
- **A value that does not exist is null, never 0.** No days to cover, no average daily volume, no change (no report
  before, or a report before of zero shares), no previous report, no float, no percent of float (a percent the service
  withheld is null, with `withheld` true), no total volume and no short volume ratio are each null.
- **The as-of is the settlement date, never today** (§3). `as_of` is the settlement date of the report, as the start
  of that Eastern day (a date, not a time of day); FINRA collects short interest twice a month and publishes it about
  two weeks later. When UCT read the vendor is a read time, not a data time: it rides beside it as `data.read_at`. The
  day FINRA published the report is not in the vendor's answer: `data.publication_estimate` is FINRA's schedule (the
  7th business day after the settlement date), always said to be an estimate. Every read is `historical` (a settled
  report and completed sessions); each kind is DECLARED `periodic`, a read being allowed to be less fresh than its kind.
- **Unknown is never claimed fresh.** An answer with no read time is `stale`, with a note.
- **The server says when it cut a list, and from which end.** Each kind returns at most the rows asked for, the whole
  count beside them, and a note naming both and the end left out (the older reports and days; the lowest ranked).
- **Every number is the service's own.** Nothing is re-derived, ranked or counted in the adapters.
- **The member's answer is built from the read's `data` and `status`.** The browser capabilities template their text
  from those; an envelope note is never echoed to the member as if it were data.

**Why both are model-isolated.** The data is FINRA's, licensed to UCT through its market-data vendor
for display to members (`docs/terminal-research/09-security-licensing-cost/licensing-register.md`, rows T-93 and T-94:
short interest, read by both kinds; daily short sale volume, read by `short.interest` only),
and no row of that register clears it for a model provider.
- `short.interest`: FINRA short interest (T-93) and FINRA daily short sale volume (T-94).
- `short.list`: FINRA short interest (T-93).

Whether an isolated value may ever reach the model is an owner decision (§4.4). On the browser the two kinds are read
only by local-only capabilities (`stock.shortInterest`, `stock.shortList` in
`app/src/agent/capabilities/terminalDataWave5.js`, both in `turn.LOCAL_ONLY_ACTIONS`): the model plans the lookup and
never sees what came back. Each capability registers only while the server lists its own kind.

**`short.interest`** (source `uct-short-data`)
- What it returns: one stock's newest report in `data.latest` (`settlement_date, short_interest` (shares),
  `avg_daily_volume, days_to_cover, change_shares, change_pct`), the newest reports of its history and the newest days
  of its daily short volume, and short interest as a percent of float. Every `ok` or `partial` read carries the note
  `FINRA short interest for {sym}: the shares sold short and not yet covered as of each settlement date, newest report first, each with the change from the report before it; days to cover is the data vendor's own figure (shares short against the average daily volume); FINRA's data, read through UCT's market-data vendor`.
- Params: `symbol` (one US stock or fund ticker, in the house form `BRK-B`); `reports` 1–24 (default 12: the SHINT
  panel's own first draw, and 24 its "Show more" step); `days` 1–60 days of short volume (default 10, the panel's own;
  60 is the service's own window).
- **Time.** With a report: `FINRA collects short interest twice a month and publishes it about two weeks later, so a report is already about two weeks old when it is published; the newest one here is for {date}, never today`, `the day FINRA published the report is not in the vendor's answer; by FINRA's schedule (after the close on the 7th business day after the settlement date) it was {estimate}, an estimate` (when the estimate exists) and
  `as_of is the settlement date of the newest report (a date, not a time of day); UCT read it from the data vendor at {at}`. With no report in the answer, `as_of` is null with `no short interest report is in this answer, so as_of is not given; UCT read the data vendor at {at}`. An answer with no
  read time is `stale`: `the held answer carries no read time, so its age is unknown`.
- What is held (`data.held`): `fresh`, the held answer; or `last_good`, when the read is `stale` with the note
  `this is the last good answer for {sym}, older than the {hours} hours it is normally kept, so a report or a day of short volume published since is missing`.
- **Daily short volume** (`data.volume`). Whenever a day is returned:
  `daily short volume is NOT short interest: it counts the shares sold short in one day's off-exchange trades only (not exchange trades), most of them bought back the same day, and says nothing about how many shares are still held short`. Day fields: `date, short_volume, total_volume, short_volume_ratio` (a percent, 0 to 100, or
  null).
- **Percent of float** (`data.float`: `shares, pct_float, withheld, state` (ok · stale · missing), `source`). The
  float is today's, from the nightly screener export: `percent of float divides the settlement date's short interest by TODAY's float from the nightly screener export, so the two figures are from different days`, and when the export is old,
  `the screener export the float comes from is older than usual, so the float may be behind`. No float on file: `no float is on file for {sym}, so no percent of float is given; that is not 0%`. A percent the service withheld:
  `short interest is more than {max}% of the float on file for {sym}, so the two figures do not describe the same share count (a split or an offering since the settlement date) and the percent of float is withheld`.
- **The cuts, from the old end.** At most `reports` reports and `days` days, the newest of each, with `count` (what the
  server holds) and `shown` beside them: `showing the newest {n} of the {total} reports the server holds; the older ones are left out`; `showing the newest {n} of the {total} days of short volume the server holds; the older ones are left out`. When the service itself
  read only the newest part of the history (`data.interest.cut`): `the server read the newest {n} reports and the data vendor holds older ones, so the history stops at {first}; the older reports are the ones not read`.
- **Each dataset has its own state** (`data.interest.state`, `data.volume.state`: ok · none · unavailable · failed; an
  `ok` dataset with no row that can be read is `failed`). Healthy and empty: `the data vendor answered and holds no short interest report for {sym}; that is a healthy answer, not a failed read, and it is not zero shares short`;
  `the data vendor answered and holds no daily short volume for {sym}; that is a healthy answer, not a failed read`. One dataset not given beside a healthy one makes the read `partial`, each said with
  `{what}` = short interest or daily short volume: refused, `{what} is not given: the data vendor refused it for this site's key when the server last asked (the data plan); that is not the same as none`; no key,
  `{what} is not given: this server has no key for the data vendor; that is not the same as none`; failed, `{what} is not given: the server's last read of it failed, or its rows could not be read; that is not the same as none`.
- `unavailable`: nothing held (`no short interest answer for {sym} is held on the server (one is kept {hours} hours after the Short interest panel reads that stock, and a last good copy {extra} hours more), and this read never starts a vendor read; that is not the same as no short interest`); both datasets refused (`the data vendor refused both short interest and daily short volume for this site's key when the server last asked for {sym} (the data plan), and this read never asks again; that is not the same as no short interest`); no vendor key
  (`this server has no key for the data vendor, so short interest for {sym} could not be read; that is not the same as no short interest`); the service's last read failed (`the server's last read of short interest for {sym} from the data vendor failed, and this read never starts another; that is not the same as no short interest`); the service's own `bad_symbol`
  (`{sym} is not a US stock or fund symbol, so there is no short interest to read`); a malformed answer or a failing service (`the short interest answer could not be read for {sym}`).
- Data fields: `sym`, `settlement_date`, `latest`, `publication_estimate`, `read_at`, `held` (fresh · last_good),
  `interest` (`state, reason, http_status, reports, count, shown, cut, first_date`), `volume` (`state, reason,
  http_status, days, count, shown, window_days`), `float`, `source`. Report fields, by the service's own names:
  `settlement_date, short_interest, avg_daily_volume, days_to_cover, change_shares, change_pct`. `coverage` counts the
  reports and days held against those returned.

**`short.list`** (source `uct-short-data`)
- What it returns: the newest short interest report the server holds across the stocks UCT follows
  (`cap_universe.json`), each stock beside its previous report, ranked one of four ways: `rank` ∈ dtc (most days to
  cover first) · up (biggest percent increase in short interest first) · down (biggest percent decrease in short
  interest first) · float (highest percent of float first), default dtc. The ranks and their words are the SHRTS
  panel's own (`shortListModel.js` `SHORT_RANKS`, the service's `RANKS`): `{order}` below is `most days to cover first`,
  `biggest percent increase in short interest first`, `biggest percent decrease in short interest first` or
  `highest percent of float first`. `limit` 1–50 rows (default 25). Every `ok` read carries the notes
  `the newest FINRA short interest report the server holds, for settlement date {date}: the shares sold short and not yet covered as of that date for {count} of the {universe} stocks UCT follows, each beside its previous report, ranked {order}; FINRA's data, read through UCT's market-data vendor`, `FINRA collects short interest twice a month and publishes it about two weeks later, so a report is already about two weeks old when it is published; this one is for {date}, never today`, `the day FINRA published the report is not in the vendor's answer; by FINRA's schedule (after the close on the 7th business day after the settlement date) it was {estimate}, an estimate` (when the estimate exists) and `as_of is the report's settlement date (a date, not a time of day); UCT read the report from the data vendor at {at}, and this read never looks for a newer one`.
- **The previous report.** `a change is measured against the previous report, for settlement date {date}`, or with none held `the server holds no previous report to compare with, so no change is given; that is not a change of 0`.
- **Each rank's own rule** (the service's `rank_market`; a stock without the number a rank needs is not ranked by it).
  dtc: `days to cover is the data vendor's own figure (shares short against the average daily volume); a stock with none is not ranked, never ranked as 0`. up and down (the floor rides as `data.floor_shares`): `a percent change is ranked only for stocks whose PREVIOUS report was at least {floor:,} shares, so a tiny base cannot top the list; a stock with no previous report is not ranked`. float:
  `percent of float divides the settlement date's short interest by TODAY's float from the nightly screener export, so the two figures are from different days; a stock with no float on file is not ranked, and a percent above {max}% of float is withheld as a mismatch ({withheld} withheld)`, and when the export is old `the screener export the float comes from is older than usual, so the float may be behind`; with no export read,
  `the screener export the float comes from could not be read when the list was built, so no percent of float is given; that is not the same as no stock being short`.
- **The cut, from the low end.** At most `limit` rows, the first of the ranking; `data.ranked` is how many stocks the
  rank covers: `showing the first {n} of the {total} stocks this rank covers, {order}; the lowest ranked are the ones left out`. No stock qualifies, a healthy answer: `no stock in the report has the number this rank needs ({order}); that is a statement about the report the server holds, not a failed read`.
- **Is it the newest report?** A newer report still arriving at the vendor (`data.newer_report_landing`):
  `a newer report, for settlement date {date}, is still arriving at the data vendor (it held too few stocks when the server looked), so the list is the report before it`. The read is `stale` when the server's last look for a newer report did not go well
  (`data.check`): `the server's last look for a newer report did not go well ({what}), so this is the last report it read and a newer one may exist`, where `{what}` is `the data vendor refused this site's key`, `no key for the data
  vendor`, `the vendor's answer could not be read as a report`, `the newest report held too few stocks`, or otherwise
  `the read failed`; when FINRA's own schedule says a newer report is out and the server has not read it (a calendar
  reckoning, `data.newer_report_due`; this read never looks): `by FINRA's schedule the report for settlement date {date} has been published, and the server has not read it: this read never looks for a newer report, so the list may be one report behind`; and when the list carries no
  read time: `the held list carries no read time, so its age is unknown`.
- `unavailable`: nothing held (`no short interest list is held on this server yet (it is read from the data vendor when the Short interest list panel is first opened, then kept in memory and on disk), and this read never starts that read; that is not the same as no stock being short`); refused by the data plan (`the data vendor refused the short interest report for this site's key when the server last asked (the data plan), and this read never asks again; that is not the same as no stock being short`); no vendor key
  (`this server has no key for the data vendor, so the short interest report could not be read; that is not the same as no stock being short`); an answer that could not be read as a report (`the data vendor answered, but not with rows the server could read as a short interest report; that is not the same as no stock being short`); a report too thin to be a
  market list (`the data vendor's newest report held too few of the stocks UCT follows to be a market list, so nothing is held; that is not the same as no stock being short`); the service's last build failed (`the server's last read of the short interest report from the data vendor failed, and this read never starts another; that is not the same as no stock being short`); the service's own
  `bad_rank` (`that is not a rank of the short interest list; the ranks are {ranks}`); a malformed answer or a failing service (`the short interest list could not be read`).
- Data fields: `rank`, `settlement_date`, `previous_settlement_date`, `newer_report_landing`, `newer_report_due`,
  `publication_estimate`, `read_at`, `held` (held), `count` (stocks UCT follows in the report), `universe`, `ranked`,
  `limit`, `shown`, `cut`, `rows`, `floor_shares` (up and down only, else null), `float` (`state, with_float, withheld,
  source`), `check` (`state, reason, http_status, at`, or null), `source`. Row fields, by the service's own names:
  `sym, short_interest, avg_daily_volume, days_to_cover, prev_short_interest, change_shares, change_pct, float_shares,
  pct_float`. `coverage` counts the stocks the rank covers against the rows returned.

### 4.15 Terminal data wave 6: `seasonality.stock`, `seasonality.board`, `options.tideHistory`, `options.oiChange`, `rates.treasury` (v1.12, terminal-data)

Five more thin kinds, the Agent half of the SEAS, SEASB, TIDEH, OIC and RATES terminal panels: one stock by calendar
month, the index and sector funds by calendar month, Market Tide by finished session, one stock's open interest change
between the two newest files of UCT's options log, and US Treasury par yields by maturity. Each is an adapter over the
service or store its member route already reads (`api/services/uct_agent/marketdata/seasonality_stock.py`,
`seasonality_board_read.py`, `tide_history_read.py`, `oi_change_read.py`, `treasury_read.py`; registered in `kinds.py`
with `owner="terminal-data"`). No new connection, job, database or write (§6).

**Status: dark, not armed.** Like every kind, each is served only when it is listed in `UCT_AGENT_DATA_KINDS` (with
`UCT_AGENT_DATA=1`). All five are model-isolated, so each also needs the master switch `UCT_AGENT_ISOLATED=1` and its
own entry in `UCT_AGENT_ISOLATED_KINDS` (§4.4, ADR-005); until then it is refused for every purpose, and once armed it
is served for purpose `answer` only. This section describes what the code does when a kind is switched on. It does not
switch anything on. As written (2026-11-20), none of the five is in production's list.

| Kind | Canonical service (member route) | Params | Declared freshness | `as_of` | `provider_calls` | Model-isolated |
|---|---|---|---|---|---|---|
| `seasonality.stock` | `api/services/seasonality.py` `compute`, over the completed daily bars the bar store already holds (`GET /api/research/seasonality/{sym}`) | `{symbol}` | periodic · every read historical | the close of the newest session in the record (never today) | 0 | **yes** |
| `seasonality.board` | the board `api/services/seasonality_board.py` already holds, read through `seasonality_board.held` (`GET /api/research/seasonality-board`) | `{}` | periodic · every read historical | the newest daily bar date any fund's record covers (never today, never the time the board was built) | 0 | **yes** |
| `options.tideHistory` | the sessions `api/services/options_analytics/tide_history.py` has stored, read through `tide_history.history` (`GET /api/options/market-tide/history`) | `{scope, rows}` | periodic · every read historical | the newest stored session (never today) | 0 | **yes** |
| `options.oiChange` | the pair of log files `api/services/options_analytics/oi_change.py` already holds, read through `oi_change.held_change` (`GET /api/options-screener/oi-change/{sym}`) | `{symbol, side, rows}` | periodic · every read historical | the date of the newer log file (never today) | 0 | **yes** |
| `rates.treasury` | the answer `api/services/treasury_yields.py` already holds, read through `treasury_yields.held_answer` (`GET /api/research/treasury-yields`) | `{}` | periodic · every read historical | the date of the newest figure on the curve (never today) | 0 | **yes** |

**No read of this section starts a build, a fetch, a capture or a vendor request.** (§5: a turn has 20 provider
requests and a member waiting.) Four of the five member routes can start work when the server holds nothing. A turn
must not start any, so each adapter reads the read-only path beside its route and answers `unavailable`, with the
reason, when nothing is held:

| Kind | What the member route can start | What the adapter reads instead |
|---|---|---|
| `seasonality.stock` | the route reads its bars through the bar serve, which on a history it holds only in part starts the deep read of the stock's daily history and answers "still being read" | `bars_sqlite.get_bars_before`: the store's own read, as `bars.daily` uses it, up to the newest completed session, shaped by the serve's own row normaliser with its metadata warm suppressed. The route's own test `_history_is_partial` then decides: a history held only in part is `unavailable`, never a short record stated as the record. It never calls the bar serve |
| `seasonality.board` | `serve` builds the board (one bar read per fund) when none is held for today's New York date, or when the held one is unfinished and older than its short reuse window | `seasonality_board.held` (added with this version): the board the service holds while its own `reusable` rule says it may still be served, else nothing. It never builds, never reads a fund and never takes the build lock |
| `options.tideHistory` | nothing: the route is a read of the store. A session is stored by the service's own scheduled capture after the close | `tide_history.history`: the same store read. It captures nothing and builds no tide |
| `options.oiChange` | `oi_change` starts the service's one background build (thread `options-oi-change`, which prepares the two newest files of the options log) when no pair is held, or when the held one is due a re-check, and waits a short time on the first one | `oi_change.held_change` (added with this version): the answer from the pair the service already holds, whatever its age. It never starts the build, never waits on one, never lists or downloads a file and changes no state of the service |
| `rates.treasury` | `get_yields` starts the service's one background build (requests to the Treasury's website) when nothing is held, and waits a short time on it; with an answer held it starts the look for a newer figure once that look is due | `treasury_yields.held_answer`: the answer the service already holds (in memory, or its disk copy), else "not held". It starts no build and no look |

Each accessor is in the service itself, so the service keeps one authority over what it holds. Rails hold each to its
route's reader (the same answer whenever the route would not start work) and count builds, threads, downloads and
vendor requests through the real service state: with nothing held the adapter starts none, and the route's own reader
is shown to start one in the same state. A further rail replaces every builder, job starter, fetch and vendor reader
the five services have with functions that fail, and runs every read of this section held and not held.

**Each kind's own states, and what each read says.** No state is ever said as "no pattern", "no flow", "no change" or
"no figure":

| The service or store says | The read |
|---|---|
| `seasonality.stock`: no completed daily bar is held for the stock | `unavailable`, not held |
| `seasonality.stock`: bars are held but the route's `_history_is_partial` says they are only part of the record | `unavailable`, held only in part |
| `seasonality.stock`: less than one full calendar month is held | `unavailable`, too short |
| `seasonality.stock`: the newest bar held is older than the newest completed session | `ok` and `stale`, with both dates |
| `seasonality.board`: no board is held that may still be served (none read today, or the last one unfinished and too old) | `unavailable`, not held |
| `seasonality.board`: the held board has no fund with numbers | `unavailable`, no numbers, each fund named with its reason |
| `seasonality.board`: some funds have no numbers (`pending`, `not_held`, `unavailable`) | `partial`, each such fund listed with its reason, never as zeros |
| `options.tideHistory`: no session is stored for the scope | `unavailable`, none stored |
| `options.tideHistory`: a trading session between the first and the newest stored day has no row | `ok`, the session named as missing, never a row of zeros |
| `options.tideHistory`: the newest stored session is older than the newest completed session | `ok` and `stale` |
| `options.oiChange`: no pair is held (`not_held`) | `unavailable`, not prepared |
| `options.oiChange`: no pair is held and the last build failed (`failed`) | `unavailable`, with the failure's class name |
| `options.oiChange`: a pair is held and one of its files cannot be read (`file_gone`) | `unavailable`, file gone |
| `options.oiChange`: the log holds no session, or one (`no_sessions`, `one_session`) | `unavailable`, nothing to compare |
| `options.oiChange`: the stock is in neither file (`known` false) | `ok`, the log's own answer, said; no row |
| `options.oiChange`: the newer file is older than the newest completed session | `ok` and `stale` |
| `rates.treasury`: nothing is held (`not_held`; the member route's `computing`) | `unavailable`, not held |
| `rates.treasury`: the curve is dated before the weekday before today in New York (the service's own `last_weekday_before` rule) | `ok` and `stale` |
| `rates.treasury`: the service's last look for a newer figure did not go well (`check`) | `ok` and `stale`, with the reason in fixed words |
| any kind: a malformed answer or a failing service | `unavailable`, read failed |

**Rules all five share**
- **A bad request is refused before any read.** Each kind's `validate` runs before admission (a `symbol` that is not
  one US stock or fund ticker, an unknown `scope` or `side`, an out-of-range `rows`): the read is `refused` and spends
  no budget.
- **A value that does not exist is null, never 0.** A month or a weekday nobody counted (its average, its median and
  its percent of years up), a fund with no numbers, a session's premium the store does not hold, a newly listed
  contract's earlier open interest, change and percent, the traded volume of a row when the earlier file recorded
  none, a maturity with no figure on the curve's day, and a change with no reference day near enough are each null.
- **The as-of is the data's own date, never today** (§3). `as_of` is the newest bar of the record, the newest bar the
  board covers, the newest stored session, the newer log file's date or the curve's date. When UCT computed, built,
  stored or read the answer is a read time, not a data time: it rides beside it as `data.read_at` (UTC). Every read is
  `historical`; each kind is DECLARED `periodic`, a read being allowed to be less fresh than its kind.
- **Unknown is never claimed fresh.** A read time the service did not record is said in the as-of note as
  `a time it did not record`, and `data.read_at` is null.
- **The server says when it cut a list, and from which end.** `options.tideHistory` carries the newest sessions and
  leaves out the OLD end; `options.oiChange` carries the biggest changes and leaves out the SMALL end; `rates.treasury`
  leaves the daily history behind the spreads out and says so. Each carries the whole count beside what is shown.
- **Every number is the service's own.** Nothing is re-derived, ranked or counted in the adapters.
- **The member's answer is built from the read's `data` and `status`.** The browser capabilities template their text
  from those; an envelope note is never echoed to the member as if it were data.

**Why all five are model-isolated.** The licensing register
(`docs/terminal-research/09-security-licensing-cost/licensing-register.md`) has no row that names seasonality, Market
Tide by day, the options log or the open interest change, and no row of that register clears these figures for a
model provider. Each kind is decided from the rows of the data it is computed from, quoted as they stand:
- `seasonality.stock` and `seasonality.board`: both are computed from the daily bars UCT stores, the vendor's
  end-of-day history, rows T-04 and T-09 ("Member display — D/W/M history", "Storage — `bars.db`"), both class **R**.
  For a record that starts before 2003-09-10 the older bars are the second history source of row T-71 ("the pre-2003
  D/W/M tail"), class **X**. The AI row, row T-14, is class **R** and its action reads "Ground on EOD + multi-symbol
  derived facts, never on a live single-symbol quote": these are end-of-day derived facts, and `seasonality.stock` is
  one symbol's. No row clears them, so both stay isolated.
- `options.tideHistory`: computed from UCT's stored options flow tape, rows T-25 and T-26 ("Storage — `flow.db`
  full-tape OPRA archive", "Derived analytics"), both class **R**; the action of T-26 reads "Keep member-gated; never
  public".
- `options.oiChange`: computed from UCT's options log, an end-of-day snapshot of the options chain. The register has
  no row for that log; the nearest is row T-28 ("Member display — options chain + Greeks + IV"), class **R**.
- `rates.treasury`: row T-95, US Treasury par yields, class **A**. The row itself says of this dataset "Nothing else
  reads it (no AI lane, no export, no external publication)". A kind that sent these figures to a model provider
  would be the AI lane that sentence says does not exist, so the kind is isolated and the row is left as it stands.
  Of the five, this is the one whose source is public data.

Whether an isolated value may ever reach the model is an owner decision (§4.4). On the browser the five kinds are read
only by local-only capabilities (`stock.seasonality`, `stock.seasonalityBoard`, `stock.tideHistory`, `stock.oiChange`,
`stock.treasuryYields` in `app/src/agent/capabilities/terminalDataWave6.js`, all in `turn.LOCAL_ONLY_ACTIONS`): the
model plans the lookup and never sees what came back. Each capability registers only while the server lists its own
kind.

**`seasonality.stock`** (source `uct-bars`)
- What it returns: one stock by calendar month (`data.months`, always twelve) and by weekday (`data.weekdays`), close
  to close, from the completed daily sessions the bar store holds. Every `ok` read carries the notes
  ``{symbol} by calendar month and by weekday, close to close, from the completed daily sessions UCT's bar store holds, {first} to {last} ({sessions} sessions): for each month the years counted, the average and the median month return, and the percent of those years the month rose. A record of the past, not a forecast``,
  `` `as_of` is the close of the newest session in the record ({day}); it is never the time of the read. The table was computed at {at} (UCT's own time) from bars already held, and is not a live figure `` and
  `completed sessions only: a session still trading is not in the record, and the month still running is not counted as a month`.
- Params: `symbol` (one US stock or fund ticker, in the house form `BRK-B`).
- **Thin and empty months.** A month with fewer years counted than the service's minimum (`data.min_years`) is flagged:
  `` {n} of the twelve months have fewer than {min_years} years counted and are flagged `thin`: too few years to read as a pattern ``. A month nobody counted has null figures:
  `{n} of the twelve months have no year counted: their figures are null, never 0`.
- **Stale.** `the newest bar held is {last}; the newest completed session is {expected}. This read never fetches the missing sessions`.
- **Before the vendor's first day.** `the record starts before 2003-09-10: the bars before that date come from yfinance history (the market-data vendor's daily archive starts 2003-09-10)` (`data.pre_vendor_floor`).
- `unavailable`: nothing held (`no completed daily bars are held for {symbol} in UCT's bar store, and this read never fetches them. That is not the same as no pattern. Open {symbol}'s seasonality in UCT, then ask again`); held only in part
  (`only part of {symbol}'s daily history is held in UCT's bar store ({first} to {last}, {sessions} sessions) and it is not marked as the whole record, so a table from it would state a short record as the record. This read never starts the full read. Open {symbol}'s seasonality in UCT, then ask again`); too short (`less than one full calendar month of daily bars is held for {symbol}, so there is no month to state. That is not the same as no pattern`); a failing
  read (`the seasonality read failed; nothing is stated. That is not the same as no pattern`).
- Data fields: `ticker`, `source`, `months`, `weekdays`, `covered_from`, `covered_to`, `full_months`, `min_years` (the
  route's own names), `sessions`, `first_bar`, `last_bar`, `latest_completed_session`, `pre_vendor_floor`, `read_at`.
  Month fields: `month, label, n, avg_pct, median_pct, pct_up, thin`. Weekday fields: `weekday, label, n, avg_pct,
  median_pct, pct_up`. `coverage` counts the twelve months against those with a year counted.

**`seasonality.board`** (source `uct-bars`)
- What it returns: the board the service holds for today's New York date: the index funds and the sector funds, each
  with its twelve months, or with the reason it has no numbers. Every `ok` or `partial` read carries the notes
  `the seasonality board as UCT holds it: {funds} index and sector funds by calendar month, close to close, each month with the years counted, the average and the median month return and the percent of those years it rose. {answered} of {funds} funds have numbers. A record of the past, not a forecast` and
  `` `as_of` is the newest daily bar date any fund's record covers ({day}); it is never the time of the read. The board was built at {at} (UCT's own time, New York date {et_date}) and is not rebuilt by this read ``.
- Params: none.
- **The board's own `as_of` is when it was BUILT.** It rides as `data.built_at` (and in UTC as `data.read_at`), so it
  cannot be read as the data's date; the envelope's `as_of` is the board's `data_through`.
- **A fund with no numbers** makes the read `partial`: `{n} of {funds} funds have no numbers and are listed with the reason, never as zeros: {list}`, where each fund is said by its status: `pending` is
  `its history is still being read`, `not_held` is `the bar store does not carry it`, `unavailable` is
  `its read failed or holds too little`.
- **Thin months.** `` {n} month figures on the board have fewer than {min_years} years counted and are flagged `thin`: too few years to read as a pattern ``.
- **An unfinished board** (`data.settled` false): `the board is unfinished: a fund's history was still being read, or its read failed, when it was built. The seasonality board in UCT reads it again; this read never does`.
- The board is never marked `stale`: it is held for one New York date and its `as_of` says which bars it covers.
- `unavailable`: nothing held (`the seasonality board has not been read on this server yet today, or its last read was unfinished and is too old to serve, and this read never builds it. That is not the same as no pattern. Open the seasonality board (SEASB) in UCT, then ask again`); no fund with numbers
  (`the seasonality board held on this server has no fund with numbers yet ({list}), and this read never reads a fund. That is not the same as no pattern. Open the seasonality board (SEASB) in UCT, then ask again`); a failing read (`the seasonality board read failed; nothing is stated. That is not the same as no pattern`).
- Data fields: `funds`, `this_month`, `next_month`, `et_date`, `min_years`, `source`, `data_through`, `complete`,
  `settled` (the route's own names), `built_at`, `read_at`. Fund fields: `symbol, name, kind, status`, and for a fund
  with numbers `months, covered_from, covered_to, full_months`, else `reason`. `coverage` counts the funds against
  those with numbers.

**`options.tideHistory`** (source `uct-flow-tape`)
- What it returns: Market Tide by finished session, newest first, for one `scope`: `all` (`the whole tape`), `stocks`
  (`stocks only`) or `etfs` (`funds only`), default all. `rows` 1–250 sessions (default 20, the TIDEH panel's own table).
  Every `ok` read carries the notes
  `Market Tide by finished session for {scope}, newest first, from UCT's own store: for each session the net call premium, the net put premium and net (call minus put), in dollars, with the prints counted. {stored} sessions are stored, the first {began}. Flow that was recorded, not a signal` and
  `` `as_of` is the newest stored session ({day}); it is never today and never the time of the read. That session was stored at {at} (UCT's own time). Each session is stored once after its close and is not revised afterwards ``.
- **The cut, from the old end.** `the newest {shown} of {stored} stored sessions are carried; the {left} older ones are left out (the cut is at the OLD end)`.
- **No backfill.** `sessions before the first stored day ({began}) were never stored and cannot be recovered: the history starts there, not when the tape did`.
- **A missing session is not a session with no flow.** `` {n} trading sessions between {began} and {latest} have no stored row and are named in `missing_sessions`: a session that was not stored is not a session with no flow ``; at most 40 are named, the newest, and
  past that `{n} sessions have no stored row; the newest {shown} are named and the {left} older ones are counted` (`data.missing_total` is the whole count).
- **Prints left out of a session.** `` {n} of the sessions carried left out prints that could not be read (`prints_unreadable`): their totals are of the prints that could ``.
- **Stale.** `the newest stored session is {day}; the newest completed session is {expected}. This read never stores a session`. A session is stored some time after its close, so a read between a
  close and that store is `stale` until the row exists.
- `unavailable`: none stored (`no finished session is stored yet for {scope}, and this read never stores one. Each session is stored once after its close. That is not the same as no flow`); a failing read (`the Market Tide history read failed; nothing is stated. That is not the same as no flow`).
- Data fields, by the route's own names: `scope`, `sessions`, `sessions_stored`, `sessions_asked`, `sessions_left_out`,
  `history_began`, `latest_session`, `missing_sessions`, `missing_total`, `missing_checked_through`, `backfill`,
  `stored_note`, `filters`, `method`, `label`, `read_at`. Row fields: `session, net_call_premium, net_put_premium,
  net_premium, prints_counted, prints_unsigned, prints_unreadable, data_through, stored_at, source`. `coverage` counts
  the sessions stored against those carried.

**`options.oiChange`** (source `uct-options-log`)
- What it returns: one stock's contracts whose open interest changed between the two newest files of UCT's options
  log, and the newly listed ones, biggest first, for one `side`: `any` (`calls and puts`), `call` (`calls only`) or
  `put` (`puts only`), default any. `rows` 1–50 (default 15, the OIC panel's own first draw). Every `ok` read carries
  the notes
  `{symbol} open interest by contract, {side}: the log file of {session} against the one of {prior}, from UCT's own options log. The contracts whose open interest changed and the newly listed ones, biggest first. It says how many contracts were open, not who opened or closed them or in which direction` and
  `` `as_of` is the date of the newer log file ({session}); it is never today and never the time of the read. Open interest is published the morning after the session it counts, so the change shown is what was opened or closed during the session of {prior}. The newer file was built at {at} (UCT's own time) ``.
- Params: `symbol` (one US stock or fund ticker); `side`; `rows`.
- **The cut, from the small end.** `the {shown} biggest of {matched} changed or new contracts are carried; the {left} smallest are left out (the cut is at the SMALL end)`.
- **New, gone and not reported.** `{n} contracts are newly listed (in the newer file only): they have no earlier figure, so their change and percent are null, never 0, and they are left out of the totals`;
  `{n} contracts are in the earlier file only ({expired} of them expired): they are counted, and left out of the totals`;
  `{n} contracts had no open interest reported on one side or the other: they are counted, never read as 0`.
- **Files that are not consecutive sessions.** `the two files are not consecutive sessions: {list} had no log file, so the change spans more than one session`.
- **Volume.** `` the earlier file did not record traded volume: `volume` is null on every row, never 0 ``.
- **A stock in neither file** is an `ok` read with no row (`data.known` false):
  `{symbol} is in neither log file ({session} and {prior}): no contract of it had an ask, open interest or volume in either. That is the log's own answer, and there is nothing to compare`.
- **Stale.** `the newer log file held is {session}; the newest completed session is {expected}. This read never looks for a newer file: open the open-interest change panel (OIC) in UCT, then ask again`.
- `unavailable`: not prepared (`the two log files have not been prepared on this server yet, and this read never starts that work. That is not the same as no change. Open the open-interest change panel (OIC) in UCT, then ask again`); the last build failed
  (`the last attempt to prepare the two log files on this server failed ({error}), and this read never tries again. That is not the same as no change`, `{error}` being the failure's class name); a file gone
  (`one of the two log files held on this server could no longer be read, and this read never fetches it again. That is not the same as no change. Open the open-interest change panel (OIC) in UCT, then ask again`); no session in the log (`UCT's options log holds no session yet, so there is nothing to compare. That is not the same as no change`); one session
  (`UCT's options log holds one session ({session}) and a change needs two, so there is nothing to compare yet. That is not the same as no change`); a failing read (`the open-interest change read failed; nothing is stated. That is not the same as no change`).
- Data fields, by the route's own names: `symbol`, `side`, `session`, `prior_session`, `skipped_sessions`, `known`,
  `has_symbol`, `prior_has_symbol`, `rows`, `matched`, `shown`, `left_out`, `max_rows`, `summary` (`call` and `put`,
  each `contracts, oi, prior_oi, change`; `contracts`, `unchanged`), `new` (`contracts, oi`), `gone` (`contracts,
  prior_oi, expired`), `not_reported`, `volume_present`, `volume_session`, `built_at`, `source`, `coverage`, `read_at`.
  Row fields: `contract, expiration, strike, type, oi, kind` (change · new), `prior_oi, change, change_pct, volume`.
  The envelope's `coverage` counts the changed or new contracts against the rows carried.

**`rates.treasury`** (source `us-treasury-par-curve`)
- What it returns: the newest daily par yield curve the server holds: each maturity's yield, what it was at five
  earlier days with the change in basis points, and the two spreads. Every `ok` read carries the notes
  `US Treasury daily par yields by maturity, as UCT holds them: each yield in percent, what it was one day, one week, one month, three months and one year earlier with the change in basis points, and the 10-year minus 2-year and 10-year minus 3-month spreads in percentage points. End-of-day figures published by the US Treasury, not live quotes` and
  `` `as_of` is the date of the newest figure on the curve ({day}); it is never today and never the time of the read. UCT read the figures from the Treasury's website at {at} (UCT's own time) ``.
- Params: none.
- **The horizons** (`d1, w1, m1, m3, y1`): `one day`, `one week`, `one month`, `three months`, `one year`. A horizon
  with no figure near enough has a null reference date and null changes: `no figure was found near enough to {list} earlier, so those changes are null, never 0`.
- **A maturity with no figure.** `{n} maturities have no figure on {day} and are null, never 0: {list}`.
- **The history is left out.** `the {points} days of daily history behind the spreads ({first} to {last}) are left out of this read: only the window and the count are carried. The Treasury yields panel (RATES) in UCT draws them`.
- **Stale.** `the newest figure held is {day}, older than {expected}, the weekday before today in New York. This read never looks for a newer one: open the Treasury yields panel (RATES) in UCT, then ask again`; and when the service's last look for a newer figure did not go
  well (`data.check`), `UCT's last look for a newer figure, at {at}, did not go well ({why}): the figures held are the last good ones`, where `{why}` is `the Treasury's website refused the request`,
  `its answer could not be read as the feed`, `the Treasury's website said too many requests`,
  `it did not answer in time`, `the Treasury's website answered with an error`, `the read failed`, or otherwise
  `it did not go well`.
- `unavailable`: nothing held (`no Treasury yields are held on this server yet, and this read never requests them. That is not the same as no figure. Open the Treasury yields panel (RATES) in UCT, then ask again`); a failing read, or a curve with no
  maturity that has a figure (`the Treasury yields read failed; nothing is stated. That is not the same as no figure`).
- Data fields, by the route's own names: `as_of` (the curve's date), `ref_dates`, `maturities` (`key, label, months,
  yield, was, change_bp`), `spreads` (`key, label, long, short, value, state` (positive · inverted · flat),
  `inverted, days_in_state, since, days_at_least, was, change_bp`), `history` (`from, to, points, years,
  columns_left_out`), `rows`, `read_at`, `basis`, `units`, `source`, `check` (`state, reason, http_status, at`, or
  null). At most 20 maturities and 4 spreads are carried. `coverage` counts the maturities against those with a figure.

### 4.16 Terminal data wave 7: `market.regime`, `stock.setups`, `stock.eventsTimeline`, `uct20.list`, `options.ivHistory`, `dilution.watch` (v1.13, terminal-data)

Six more thin kinds, the Agent half of the REGM, TECH (its confirmed setups), EVTS, IVH and DILU terminal panels and of
the UCT 20 page: UCT's market regime read, one stock's confirmed setups, one stock's dated events, the UCT 20 list,
one stock's implied volatility by logged session, and one company's share-issuance filings. Each is an adapter over
the service or store its member route already reads (`api/services/uct_agent/marketdata/regime_read.py`,
`setups_read.py`, `events_timeline_read.py`, `uct20_read.py`, `iv_history_read.py`, `dilution_read.py`; registered in
`kinds.py` with `owner="terminal-data"`). No new connection, job, database or write (§6), and no new environment
variable.

**Status: dark, not armed.** Like every kind, each is served only when it is listed in `UCT_AGENT_DATA_KINDS` (with
`UCT_AGENT_DATA=1`). All six are model-isolated, so each also needs the master switch `UCT_AGENT_ISOLATED=1` and its
own entry in `UCT_AGENT_ISOLATED_KINDS` (§4.4, ADR-005); until then it is refused for every purpose, and once armed it
is served for purpose `answer` only. This section describes what the code does when a kind is switched on. It does not
switch anything on. As written (2026-11-20), none of the six is in production's list.

| Kind | Canonical service (member route) | Params | Declared freshness | `as_of` | `provider_calls` | Model-isolated |
|---|---|---|---|---|---|---|
| `market.regime` | the classification `api/services/voice_regime_classifier.py` last stored, read through `voice_regime_held.held_regime` (`GET /api/regime`) | `{}` | periodic · every read periodic | the time the server computed the held classification (never the time of the read) | 0 | **yes** |
| `stock.setups` | the verdicts `api/services/pattern_vision/store.py` holds, read through the store's own `get_confirmed`, `count_evaluated` and `last_judged_at` (the confirmed branch of `GET /api/patterns/{sym}`) | `{symbol, rows}` | periodic · every read historical | the newest daily bar a returned setup was judged on; with none confirmed, the day the judge last ran (never the time of the read) | 0 | **yes** |
| `stock.eventsTimeline` | the stores `api/services/events_timeline.py` reads, through `timeline(sym, held_only=True)` (`GET /api/research/events/{sym}`) | `{symbol, rows}` | periodic · every read historical | the date of the newest event that is not in the future (never a scheduled report, never the time of the read); null when there is none | 0 | **yes** |
| `uct20.list` | the list the morning wire last pushed, read through `engine._leadership_as_pushed` (`GET /api/leadership`) | `{rows}` | periodic · every read historical | the wire run's own date (never the time of the read); null when the pushed list carries none | 0 | **yes** |
| `options.ivHistory` | the sessions of UCT's options log already on the server's disk, read by `api/services/research/iv_history.py` over `LocalStore(get_store().root)` (`GET /api/research/iv-history/{sym}`) | `{symbol, rows}` | periodic · every read historical | the newest session with an at-the-money implied volatility for the stock (never today as such) | 0 | **yes** |
| `dilution.watch` | the answer `api/services/dilution_watch.py` already holds, read through `dilution_watch.held_watch` (`GET /api/research/dilution-watch/{ticker}`) | `{symbol, rows}` | periodic · every read historical | the day of the newest filing of any form in the SEC's index for the company (never the time of the read); null when the answer names none | 0 | **yes** |

**No read of this section starts a compute, a build, a download or a vendor request.** (§5: a turn has 20 provider
requests and a member waiting.) Five of the six member paths can start work when the server holds nothing. A turn
must not start any, so each adapter reads the read-only path beside its route and answers `unavailable`, with the
reason, when nothing is held:

| Kind | What the member path can start | What the adapter reads instead |
|---|---|---|
| `market.regime` | `voice_regime_classifier.get_current_regime` recomputes when nothing is held: it reads breadth (which can go on to a live fetch) and asks the market-data vendor for a VIX snapshot | `voice_regime_held.held_regime` (added with this version): the classification the classifier last stored in the shared cache, with the time it stored it, else nothing. It never computes, never reads breadth and never calls a vendor. It is a file beside the classifier, not a function in it, because flow-worker runs the classifier's file and that service is deployed by hand |
| `stock.setups` | nothing is computed by the route's confirmed branch: verdicts are written by a background job. The route does create the verdict store when the file is absent (`init_db`) | the store's own three readers (`get_confirmed`, `count_evaluated`, `last_judged_at`). It never creates the store, never runs a detection, never draws a chart and never asks a model |
| `stock.eventsTimeline` | `events_timeline.timeline(sym)` reads the earnings history from cache and, on a miss, schedules the earnings rebuild (a background job that asks a vendor) | `timeline(sym, held_only=True)` (added with this version), which reads the earnings history through `earnings_reaction_panel.held_earnings` (added with this version): the same stores, and an earnings history that is not held is the source state `not_held`, with nothing scheduled. The default call is unchanged |
| `uct20.list` | the route starts a background bar warm for every name on the list, and `engine.get_leadership` can build the day's pending-acquisition set (`deal_status.consumer_pending`, when that rule is on: a build that reads news and bars, and a background refresh) | `engine._leadership_as_pushed` (the cache, then the file on the server), the wire's own date and status, and the pending-acquisition rule applied ONLY from a set already built for today. It never warms a bar and never builds or refreshes that set |
| `options.ivHistory` | the route reads through the service's production store, which lists the log in remote storage and downloads any session file the server does not have | `LocalStore(get_store().root)`: a plain local store over the same directory, so the service reads the session files already mirrored on the server's disk and nothing else. Nothing is listed in or downloaded from remote storage |
| `dilution.watch` | `dilution_watch.get_watch` starts the service's background build (a thread that requests the SEC's website) when nothing is held | `dilution_watch.held_watch`: the answer the service already holds, fresh or last good, else "not held". It never starts a build |

Rails hold each adapter to what its member path serves and count computes, builds, downloads, threads and vendor
requests: with nothing held the adapter starts none, and the member path's own reader is shown to start one in the
same state. A further rail replaces every builder, job starter, fetch and vendor reader the six paths have with
functions that fail, and runs every read of this section held and not held.

**Two route switches are respected, and none is added.** The events timeline and the IV history each have a switch of
their own on the member route (`EVENTS_TIMELINE_ENABLED`, `IV_HISTORY_ENABLED`). While a switch is not on the route
answers 404 and the read is `unavailable` with that reason, never an empty answer. This version adds no switch and
changes neither.

**Each kind's own states, and what each read says.** No state is ever said as "no regime", "no setup", "no event",
"an empty list", "no implied volatility" or "no filings":

| The service or store says | The read |
|---|---|
| `market.regime`: no classification is held (none computed in the last 15 minutes) | `unavailable`, not held |
| `market.regime`: the held classification is the classifier's "could not answer" answer, names a regime outside the classifier's vocabulary, has no confidence, or has every input missing (the classifier still names a regime then) | `unavailable`, no regime named |
| `market.regime`: some of the five breadth figures were not available to the classifier | `ok`, those figures null and named |
| `stock.setups`: the verdict store is not on the server | `unavailable`, not held; the store is not created |
| `stock.setups`: no setup was judged on the stock in the store's window | `unavailable`, not judged |
| `stock.setups`: setups were judged and none is confirmed | `ok`, no row, with the count judged |
| `stock.setups`: the newest bar judged is older than the newest completed session | `ok` and `stale`, with both dates |
| `stock.eventsTimeline`: the route's switch is off | `unavailable`, switched off |
| `stock.eventsTimeline`: a source failed, or the earnings history is not held (`error`, `not_held`) | `partial`, the source named with which of the two it is |
| `stock.eventsTimeline`: none of the four sources answered | `unavailable`, nothing stated |
| `stock.eventsTimeline`: every source answered and no event is stored | `ok`, no row |
| `stock.eventsTimeline`: the events cannot be placed against a report (the service's `state` is not `ok`) | `ok` or `partial`, offsets null, with the service's reason |
| `stock.eventsTimeline`: no event is dated on or before the read day | `ok` or `partial`, `as_of` null, said |
| `uct20.list`: no list is held (cache and file both empty), or no row of it has a usable symbol | `unavailable`, not held |
| `uct20.list`: the pending-acquisition rule is on and today's set is not built | `unavailable`, the list members see cannot be stated without a build |
| `uct20.list`: the route's own rule says a trading-day run was missed (`stale`), or the wire's publish check held or degraded the run (`held`, `degraded`) | `ok` and `stale`, with which |
| `uct20.list`: the pushed list carries no run date | `ok` and `stale`, `as_of` null, said |
| `options.ivHistory`: the route's switch is off | `unavailable`, switched off |
| `options.ivHistory`: no session of the log is on the server's disk (`no_log`) | `unavailable`, not held |
| `options.ivHistory`: the sessions held carry no at-the-money figure for the stock (`not_in_log`) | `unavailable`, not in the sessions held |
| `options.ivHistory`: fewer ranked sessions than the service's minimum | `ok`, `rank` null, with the service's own sentence |
| `options.ivHistory`: the newest session with a figure is older than the newest completed session | `ok` and `stale` |
| `dilution.watch`: nothing is held (`not_held`), or a build is running with nothing held yet (`computing`) | `unavailable`, not held |
| `dilution.watch`: the held answer records a read of the SEC's index that did not go well (`failed`, `unavailable`) | `unavailable`, with the reason in fixed words |
| `dilution.watch`: the service's own `none` (`no_cik`, `no_filings`) | `ok`, no row, with its reason, `as_of` null |
| `dilution.watch`: the answer is the last good one and its refresh is overdue (`last_good`) | `ok` and `stale` |
| `dilution.watch`: the SEC's index was read only part of the way back | `ok`, the counts that need older filings null, said |
| any kind: a malformed answer or a failing service | `unavailable`, read failed |

**Rules all six share**
- **A bad request is refused before any read.** Each kind's `validate` runs before admission (a `symbol` that is not
  one US stock or fund ticker, an out-of-range `rows`): the read is `refused` and spends no budget. `market.regime`
  and `uct20.list` take no symbol.
- **A value that does not exist is null, never 0.** A breadth figure the classifier did not have, a setup's key level
  or confidence that is not stored, the offset of an event that is not placed against a report, a figure the wire
  did not carry, a session's at-the-money implied volatility that was not logged, a rank under the service's minimum
  of sessions, and a filing count the read did not reach back far enough for are each null.
- **The as-of is the data's own date, never the time of the read** (§3). When UCT computed, judged or read the
  answer is a read time, not a data time: it rides beside the as-of in `data` (`computed_at`, `judged_at`,
  `read_at`). `market.regime` is the one kind of this section whose `as_of` is itself a time UCT computed something:
  the held classification carries no date for the breadth figures behind it, a note says so, and the read is
  `periodic` because the classifier keeps a classification for at most 15 minutes. The other five reads are
  `historical`; each kind is DECLARED `periodic`, a read being allowed to be less fresh than its kind.
- **Unknown is never claimed fresh.** A time or a day the service did not record is said in the note as
  `a time it did not record` or `a day it did not record`, and the field is null.
- **The server says when it cut a list, and from which end.** `stock.setups`, `stock.eventsTimeline`,
  `options.ivHistory` and `dilution.watch` carry the newest rows and leave out the OLD end; `uct20.list` carries the
  top of the ranking and leaves out the BOTTOM. Each carries the whole count beside what is shown.
- **What is left out is said.** `market.regime`, `stock.setups`, `stock.eventsTimeline` and `uct20.list` each leave
  fields of their source out, name them in `data.left_out` and say so in a note. What is left out of each is the
  builder's default, taken on the conservative side; it is listed per kind below.
- **Every number is the service's own.** Nothing is re-derived, ranked or counted in the adapters.
- **The member's answer is built from the read's `data` and `status`.** The browser capabilities template their text
  from those; an envelope note is never echoed to the member as if it were data.

**Why all six are model-isolated.** The licensing register
(`docs/terminal-research/09-security-licensing-cost/licensing-register.md`) has no row that clears any of these six
reads for a model provider. Isolating all six is the builder's default under the rule "when in doubt, isolated"; it
is not a ruling by anyone. Each kind is decided from the rows of the data it is built on, quoted as they stand:
- `market.regime`: a rules-based read over market breadth and VIX. Row T-11 ("Derived analytics — intraday breadth
  (~40 metrics) + lenses, RS rank/line, correlation, sector flow, theme returns, base-structure library, candle
  library, pattern engine (50 detectors), server indicators, Pine parity") is class **R**. Row T-12 ("Derived
  analytics — the composites", the Exposure Rating among them) is class **R** and its action reads "Ask the question;
  do not add new composite publications until answered; desk-first (D-001)". The AI row, row T-14, is class **R** and
  its action reads "Ground on EOD + multi-symbol derived facts, never on a live single-symbol quote". None clears a
  regime read for a model, so the kind is isolated, and the Exposure Rating and the VIX level are left out of it.
- `stock.setups`: verdicts about the vendor's daily bars, and row T-11 names the "pattern engine (50 detectors)",
  class **R**; row T-14 is class **R**. Neither clears a verdict about one stock's bars.
- `stock.eventsTimeline`: the register has no row for this timeline. Its earnings rows carry the fundamentals
  vendor's figures, and row T-44 ("AI processing — FMP numbers (fundamentals, analyst, earnings) into AI Search
  synth/agent, Compass, stock briefs, Model Book") is class **U**: "No AI clause; derived-works clauses govern".
- `uct20.list`: UCT's own selection, ranked on figures derived from the vendor's data: row T-11 names "RS
  rank/line", class **R**; row T-12 names "UCT20 portfolio **NAV**" and "published entry/stop/target on named
  tickers", class **R**, with the action quoted above; row T-14 is class **R**. The list is isolated, and the
  portfolio, its NAV and each name's entry, stop and targets are left out of it.
- `options.ivHistory`: computed from UCT's options log, an end-of-day snapshot of the options chain. The register
  has no row for that log; the nearest is row T-28 ("Member display — options chain + Greeks + IV"), class **R**, and
  row T-14 is class **R**.
- `dilution.watch`: row T-96, share-issuance filings from the SEC's filing index, class **A**. The row itself says of
  this use "Nothing else reads it (no AI lane, no export, no external publication)". A kind that sent the
  classification to a model provider would be the AI lane that sentence says does not exist, so the kind is isolated
  and the row is left as it stands. Of the six, this is the one whose source is public data.

Whether an isolated value may ever reach the model is an owner decision (§4.4), and none is recorded here. On the
browser the six kinds are read only by local-only capabilities (`stock.marketRegime`, `stock.setups`,
`stock.eventsTimeline`, `stock.uct20List`, `stock.ivHistory`, `stock.dilutionWatch` in
`app/src/agent/capabilities/terminalDataWave7.js`, all in `turn.LOCAL_ONLY_ACTIONS`): the model plans the lookup and
never sees what came back. Each capability registers only while the server lists its own kind.

**A question this section leaves open for `uct20.list` and `stock.setups`.** SC-1 §2d (owner F-16 ruling) keeps
UCT's proprietary ratings and scores out of the Agent's SCREENS, and names `in_uct20`, `rs_rank` and every
pattern-engine field among them. That section is about the scan path ("The member-facing Screener page and
`/api/screener/*` do not change. This section is the Agent's view only"), and neither kind is a screen: nothing
here filters, sorts or ranks on such a field. Both kinds do SHOW such values to the member (each UCT 20 name's RS
rating and UCT 20 score; a confirmed setup's pattern and confidence), isolated from the model. Whether F-16 also
bears on showing them through the Agent is not answered by SC-1 §2d as written and is not answered here: it is a
question for the owner before either kind is armed. One effect is already in the browser and is not changed by
this version: the Screener's own rail claims a screen-shaped message that names the UCT 20 ("which stocks are in
the UCT 20") and answers it with the F-16 sentence before any model call, so `uct20.list` is never read for it.

**`market.regime`** (source `uct-regime-classifier`)
- What it returns: the regime the classifier last named (`data.regime`, with its member words `data.label` and its
  sizing band `data.band`, all three the classifier's own vocabulary), its confidence, the five breadth figures
  behind it and the classifier's reason lines. Every `ok` read carries the notes
  `UCT's market regime read, as the server last computed it: a rules-based classification from market breadth and VIX, with the sizing band UCT's own GRADE verdicts read. It is what UCT's rules read, not advice and not a forecast`,
  `` `as_of` is the time the server computed this read ({at}); it is never the time of this read. The breadth figures behind it carry no date of their own in the held read. The server recomputes at most every 15 minutes, and this read never recomputes `` and
  `the UCT Exposure Rating and the VIX level are part of the held read and are left out of this answer, with the {n} reason lines that state them. The Market regime panel (REGM) in UCT shows them`.
- Params: none.
- **Left out (the builder's default).** The UCT Exposure Rating and the VIX level are in the held classification and
  are not carried; a reason line that states either is dropped and counted (`data.reasons_left_out`).
- **A figure the classifier did not have.** `{n} breadth figures were not available to the classifier and are null, never 0: {list}`, each figure said in fixed words:
  `percent of stocks above the 50-day average`, `percent of stocks above the 200-day average`, `new highs`,
  `new lows`, `distribution days`.
- The read is never marked `stale`: the classifier drops a classification 15 minutes after it computed it, so a held
  one is never older, and `as_of` says when it was computed.
- `unavailable`: nothing held (`no regime read is held on this server at the moment, and this read never computes one. That is not the same as no regime. Open the Market regime panel (REGM) in UCT, then ask again`); no regime named
  (`the classifier could not read its inputs, so the held read names no regime and no band; nothing is stated`); a failing read (`the regime read failed; nothing is stated. That is not the same as no regime`).
- Data fields: `regime`, `label`, `band`, `confidence`, `signals` (`pct_above_50ma, pct_above_200ma, new_highs,
  new_lows, distribution_days, market_phase`), `reasons` (at most 6, 120 characters each), `reasons_left_out`,
  `left_out`, `vocabulary_version`, `computed_at`. `coverage` counts the five breadth figures against those the
  classifier had.

**`stock.setups`** (source `uct-setup-verdicts`)
- What it returns: the setups UCT's chart judge confirmed on the stock's daily chart, newest bar first, by the
  member's own rules: the store's window (a verdict on an older bar is not served, and a setup rejected on a newer
  bar is not served from an older confirm), the route's default confidence floor (50) and the internal setups
  dropped as for every member. `rows` 1–25 (default 10). Every `ok` read carries the notes
  `the setups UCT's chart judge confirmed on {symbol}'s daily chart, as stored: the setup, the daily bar it was judged on, the judge's confidence and the key level stored with it. Stored verdicts only: no detection and no chart reading is run for this read. A record of what the judge confirmed, not a forecast and not advice` and
  `only verdicts on a daily bar from the last {days} days are served, and a setup rejected on a newer bar is not served from an older one; {evaluated} setups were judged in that window`, and with at least one row
  `` `as_of` is the newest daily bar a setup here was judged on ({day}); it is never the time of the read. The judge last ran on this stock at {at} (UCT's own time) ``.
- Params: `symbol` (one US stock or fund ticker, in the house form `BRK-B`); `rows`.
- **Judged and none confirmed** is an `ok` read with no row: `` {evaluated} setups were judged on {symbol} in the window and none is confirmed. `as_of` is the day the judge last ran ({day}), at {at} (UCT's own time) ``.
- **The cut, from the old end.** `{total} setups are confirmed and the newest {shown} are returned, newest bar first: the list is cut from the OLD end`.
- **Left out (the builder's default).** `the judge's written reasons and its list of checks are left out of this read: each row keeps the count of checks passed and made. The Technical read panel (TECH) in UCT shows them`.
- **A level that is not stored.** `{n} of the setups returned have no key level stored and that level is null, never 0`.
- **Stale.** `the newest bar judged is {day}, older than the newest completed session ({expected}). This read never runs the judge: it runs on UCT's own schedule`.
- `unavailable`: the store is not on the server (`the setup verdict store is not on this server, and this read never creates it. That is not the same as no setup`); not judged
  (`no setup was judged on {symbol} in the last {days} days, so nothing is stored to read. That is not the same as no setup. This read never runs a detection or reads a chart`); a failing read (`the setups read failed; nothing is stated. That is not the same as no setup`).
- Data fields: `symbol`, `tf` (`D`), `rows`, `count`, `confirmed_total`, `cut`, `evaluated`, `window_days`,
  `min_confidence`, `as_of`, `judged_at`, `expected_session`, `left_out`. Row fields: `setup, name, asof_date,
  confidence, key_level, checks_passed, checks_made`; `name` is null for a setup the route's table does not name.
  `coverage` counts the setups judged against the rows carried.

**`stock.eventsTimeline`** (source `uct-events-stores`)
- What it returns: the dated events the four sources hold for the stock, newest first, each placed against its
  nearest earnings report when the service can place it (`print_date`, `offset`, `stage`), with the reports
  themselves in `data.prints` (at most 9). `rows` 1–40 (default 20). Every `ok` or `partial` read carries the note
  `dated events UCT's stores hold for {symbol}, each placed against its nearest earnings report: earnings reports and the next scheduled one, days the UCT catalyst engine flagged the stock, SEC filings in UCT's filing index, and days the room's mentions of the ticker spiked. Stored events only: nothing is fetched for this read. A record, not a forecast and not advice`, and
  `` `as_of` is the date of the newest event that is not in the future ({day}); it is never the time of the read. A scheduled report is listed and is not the as-of `` or, with no such event, `` no event here is dated on or before the read day, so `as_of` is null ``.
- Params: `symbol` (one US stock or fund ticker); `rows`.
- **The four sources**, each with its own state in `data.sources` (`ok`, `empty`, `error`, `not_held`):
  `the earnings history`, `the UCT catalyst engine's flags`, `the SEC filing index`,
  `the room's mention counts`. A source that failed, or an earnings history that is not held, makes the read
  `partial`: `{n} of the 4 sources did not answer and their events are missing from this list, which is not the same as no event there: {list}`, each source said with `not held on this server` or `the read failed`.
- **The offset's unit.** `each event's offset from its nearest report is counted in {unit}` (the service's own words for its unit). When the service cannot place
  the events, every offset is null: `the events are not placed against a report: {reason}`.
- **No event stored.** `no event is stored for {symbol} in any of the 4 sources`.
- **The cut, from the old end.** `{total} events are stored and the newest {shown} are returned, newest first: the list is cut from the OLD end`.
- **Left out (the builder's default).** `the catalyst engine's written thesis and each filing's link are left out of this read. The Events timeline panel (EVTS) in UCT shows them`. A catalyst flag's `detail` is null for that reason.
- The read is never marked `stale`: `as_of` says how new the newest stored event is.
- `unavailable`: switched off (`the events timeline is switched off on this server (EVENTS_TIMELINE_ENABLED is not on), so nothing is read. That is not the same as no event`); no source answered
  (`none of the 4 event sources answered for {symbol}; nothing is stated. That is not the same as no event`); a failing read (`the events timeline read failed; nothing is stated. That is not the same as no event`).
- Data fields: `symbol`, `staged`, `reason`, `offset_unit`, `prints` (`date, label, state`), `rows`, `count`, `total`,
  `cut`, `sources`, `as_of`, `left_out`. Row fields: `date, kind, title, detail, source, print_date, print_label,
  print_state, offset, stage`. `coverage` counts the four sources against those that answered.

**`uct20.list`** (source `uct-morning-wire`)
- What it returns: the UCT 20 list as the morning wire last pushed it, in the list's own order, the first twenty as on
  the UCT 20 page, less the names the page leaves out for a pending acquisition. `rows` 1–20 (default 20). Every `ok`
  read carries the notes
  `the UCT 20 leadership list as the morning wire last pushed it: each name's rank in the list, its RS rating, its UCT 20 score, its one-month and three-month returns in percent and its next earnings date. UCT's own selection, not advice and not a forecast`,
  `the UCT 20 model portfolio (its value, its NAV curve, its entry and stop prices and its trades) and each name's entry, stop and targets are left out of this answer, with the wire's price and change and the written thesis. The UCT 20 page in UCT shows them`, and
  `` `as_of` is the wire run's own date ({day}); it is never the time of the read. The list is built once a day before the open and this read never rebuilds it `` or, with no run date, `` the pushed list carries no run date, so `as_of` is null and how old the list is cannot be stated ``.
- Params: `rows`.
- **Left out (the builder's default).** The model portfolio and its NAV, each name's entry, stop and targets, the
  wire's price and change (a morning snapshot, not a quote), and the written thesis and company description are not
  carried.
- **The cut, from the bottom.** `the list holds {total} names and the top {shown} are returned in the list's own order: it is cut from the BOTTOM of the ranking`.
- **Pending acquisitions.** `{n} names with a pending acquisition are left off the list, as on the UCT 20 page`. The rule is applied only from a set already built for today.
- **A figure the wire did not carry.** `{n} names have at least one figure the wire did not carry; those figures are null, never 0`.
- **Stale.** `{why}. This read never rebuilds the list`, where `{why}` is `a trading-day wire run was missed, so this is the list of an earlier run`,
  `the wire's publish check held this run, so this is the last list that passed it` or `the wire's publish check marked this run degraded` (said with its first letter capitalised). A list with no run date is `stale` too.
- `unavailable`: nothing held (`no UCT 20 list is held on this server, and this read never builds one. That is not the same as an empty list`); the pending-acquisition set is not built
  (`the UCT 20 page leaves out names with a pending acquisition, and today's set of those names is not built on this server yet. This read never builds it, so the list members see cannot be stated. Open the UCT 20 page in UCT, then ask again`); a failing read (`the UCT 20 read failed; nothing is stated. That is not the same as an empty list`).
- Data fields: `rows`, `count`, `total`, `cut`, `as_of`, `status` (fresh · stale · held · degraded), `held_since`,
  `pending_removed`, `left_out`. Row fields: `rank, symbol, rs, score, ret_1m, ret_3m, earnings_date`. `coverage`
  counts the names on the list against the rows carried.

**`options.ivHistory`** (source `uct-options-log`)
- What it returns: the stock's at-the-money implied volatility by logged session, newest first, with the service's
  own rank and percentile when enough sessions are logged (`data.rank`, else null with `data.rank_note`). `rows` 1–60
  (default 20). Every `ok` read carries the notes
  `{symbol}'s at-the-money implied volatility by session, from UCT's own options log as held on this server: the mean of the call and the put implied volatility at the strike closest to the stock, on the expiry closest to 30 days out, as a fraction (0.30 is 30%), with the days to expiry it was read at. Recorded once a day after the close: not a live figure, not a forecast and not advice` and
  `` `as_of` is the newest session with an ATM IV for {symbol} ({day}); it is never the time of the read. The log began on {began} and {sessions} of its sessions are on this server ``.
- Params: `symbol` (one US stock or fund ticker); `rows`.
- **The cut, from the old end.** `{total} sessions are held for {symbol} and the newest {shown} are returned, newest first: the history is cut from the OLD end. The rank is over the service's own window, not over the rows returned`.
- **No rank.** `no IV rank is stated: {why} The rank is null, never 0`, where `{why}` is the service's own sentence.
- **A session with no figure.** `{n} of the sessions returned have no ATM IV for {symbol} and that figure is null, never 0`.
- **A history the service marks partial.** `the service marks this history partial: {reasons}` (at most 5 of the service's reasons, 240 characters
  each).
- **Stale.** `the newest session held for {symbol} is {day}, older than the newest completed session ({expected}). A newer session may be logged and not mirrored on this server: this read never downloads one. Open the IV history panel (IVH) in UCT, then ask again`.
- `unavailable`: switched off (`the IV history is switched off on this server (IV_HISTORY_ENABLED is not on), so nothing is read. That is not the same as no implied volatility`); no session on the server's disk
  (`no session of UCT's options log is on this server's disk, and this read never downloads one. That is not the same as no implied volatility. Open the IV history panel (IVH) in UCT, then ask again`); the stock is not in the sessions held
  (`the {sessions} sessions of UCT's options log on this server hold no ATM IV for {symbol}. That is not the same as no implied volatility: the stock may have no listed options, or its sessions may not be mirrored here`); a failing read (`the IV history read failed; nothing is stated. That is not the same as no implied volatility`).
- Data fields: `symbol`, `rows`, `count`, `total`, `cut`, `as_of`, `logging_began`, `covers_from`, `covers_to`,
  `sessions_logged`, `sessions_with_iv`, `missing_sessions` (a count), `rank` (`current, iv_rank, iv_percentile, low,
  high, window_sessions`, or null), `rank_note`, `rank_min_sessions`, `partial`, `partial_reasons`,
  `expected_session`, `source`. Row fields: `date, atm_iv, atm_dte, atm_expiration, rule, complete`; `atm_iv` is a
  fraction (0.30 is 30%). `coverage` counts the sessions held for the stock against the rows carried that have a figure.

**`dilution.watch`** (source `sec-edgar-filing-index`)
- What it returns: one company's share-issuance filings as the service classified them from the SEC's filing index:
  the newest filings, at most 3 shelf registrations with their state (`live`, `expired`, `not_effective`,
  `withdrawal_requested`; "live" and "expired" are the service's estimates from dates), and the counts of offerings,
  unregistered sales and registrations over 12 months and 3 years. It answers for one company: the service holds no
  market-wide list, and none is made here. `rows` 1–40 (default 15). Every `ok` read with filings carries the note
  `{symbol}'s share-issuance filings of the last {years} years as UCT classified them from the SEC's filing index: each filing's date, form and kind, its shelf registrations and their state, and counts of offerings, unregistered sales and registrations. Classified from the form type and item numbers alone: no filing document was read. A record of filings, not a forecast and not advice`, and
  `` `as_of` is the day of the newest filing of any form in the SEC's index for {symbol} ({day}); it is never the time of this read. UCT read the index at {at} (UCT's own time) and the window ends on {to} `` or, when the answer names no newest filing day,
  `` the held answer names no newest filing day for {symbol}, so `as_of` is null. UCT read the index at {at} (UCT's own time) and the window ends on {to} ``.
- Params: `symbol` (one US stock ticker); `rows`.
- **The service's own "none"** is an `ok` read with no row (`data.state` `none`): `` no share-issuance filing is stated for {symbol}: {why}. The answer carries no date, so `as_of` is null ``, where `{why}` is
  `the SEC lists no filer for this symbol` or `the SEC has no filing index for this company`.
- **The cut, from the old end.** `{total} filings are in the window and the newest {shown} are returned, newest first: the list is cut from the OLD end. The counts cover the whole window`.
- **An index read only part of the way back.** `the SEC's index was read back to {day} only, not the whole window: a count that needs older filings is null, never 0 and never a smaller number`.
- **A fund.** `the SEC classes {symbol} as a fund or its filings are a fund's: share issuance by a fund is routine and these rows do not mean what they mean for a company`.
- **Stale.** `this is the last good answer UCT holds for {symbol} and its refresh is overdue. This read never refreshes it: open the Dilution watch panel (DILU) in UCT, then ask again`.
- `unavailable`: nothing held (`no filing answer is held for {symbol} on this server, and this read never requests one from the SEC. That is not the same as no filings. Open the Dilution watch panel (DILU) in UCT, then ask again`); the service's last read of the SEC's index did not go well
  (`UCT's last read of the SEC's filing index for {symbol} did not go well ({why}), and no earlier answer is held; nothing is stated. That is not the same as no filings`, where `{why}` is `the SEC's website refused the request`, `its answer could not be read`,
  `the SEC's website said too many requests`, `it did not answer in time`, `the SEC's website answered with an error`,
  `the read failed`, or otherwise `it did not go well`); a failing read (`the dilution watch read failed; nothing is stated. That is not the same as no filings`).
- Each filing's link, accession number and file numbers are not carried (the builder's default); no filing document
  was read by the service, so no share count and no dollar amount exists to carry.
- Data fields: `symbol`, `state` (ok · none), `company`, `fund_like`, `window` (`years, from, to, recent_months,
  recent_from`), `coverage` (`complete, from, pages_unread`), `newest_filing`, `summary` (`live_shelves,
  pending_shelves`, and `offerings`, `unregistered`, `registrations`, each `m12, y3, latest`), `shelves` (`form, filed,
  effective, expires_estimate, state, offerings, latest_offering`), `rows`, `count`, `total`, `cut`, `as_of`,
  `read_at`, `last_good`; a `none` answer carries `none_reason` and `http_status` instead. Row fields: `date, form,
  kind, what, under` (`form, filed, shelf`, or null). The envelope's `coverage` counts the filings in the window
  against the rows carried.

### 4.17 Terminal data wave 8: `stock.corporateActions`, `calendar.ipos`, `calendar.dividends` (v1.14, terminal-data)

Three more thin kinds, the Agent half of the CACT, IPO and DVD terminal panels: one stock's splits and cash dividends,
the IPO calendar, and the dividends and splits declared ahead for the stocks a member names. Each is an adapter over
the service its member route already reads (`api/services/uct_agent/marketdata/corporate_actions_read.py`,
`ipo_calendar_read.py`, `dividends_calendar_read.py`; registered in `kinds.py` with `owner="terminal-data"`). No new
connection, job, database, write or route (§6), and no new environment variable.

**Status: dark, not armed.** Like every kind, each is served only when it is listed in `UCT_AGENT_DATA_KINDS` (with
`UCT_AGENT_DATA=1`). All three are model-isolated, so each also needs the master switch `UCT_AGENT_ISOLATED=1` and its
own entry in `UCT_AGENT_ISOLATED_KINDS` (§4.4, ADR-005); until then it is refused for every purpose, and once armed it
is served for purpose `answer` only. This section describes what the code does when a kind is switched on. It does not
switch anything on. As written (2026-11-21), none of the three is in production's list.

| Kind | Canonical service (member route) | Params | Declared freshness | `as_of` | `provider_calls` | Model-isolated |
|---|---|---|---|---|---|---|
| `stock.corporateActions` | the chart markers record `api/services/corporate_actions_held.py` reads, through `corporate_actions_held.held_actions` (`GET /api/research/corporate-actions/{ticker}`) | `{symbol, rows}` | periodic · every read historical | the newest event of either block (never the time of the read); null when the record lists none | 0 | **yes** |
| `calendar.ipos` | the merged calendar `api/services/ipo_calendar.py` stored for the IPO panel's window, read through `ipo_calendar_held.held_ipos` (`GET /api/calendar/ipos`) | `{rows}` | periodic · every read periodic | null: the calendars carry no as-of; the time UCT read them rides beside it | 0 | **yes** |
| `calendar.dividends` | what `api/services/dividends_calendar.py` stored for each named stock alone, read through `dividends_calendar_held.held_events` (`GET /api/calendar/dividends?syms=`) | `{symbols}` | periodic · every read periodic | null: a forward calendar carries no as-of; the time UCT read each stock rides beside it | 0 | **yes** |

**No read of this section starts a build or a vendor request.** (§5: a turn has 20 provider requests and a member
waiting.) Two of the three member routes ask a vendor when the server holds nothing; the third reads only what is held,
and the chart reader behind its record builds one. A turn must not start any of that, so each adapter reads a
read-only path and answers `unavailable`, with the reason, when nothing is held:

| Kind | What the member path can start | What the adapter reads instead |
|---|---|---|
| `stock.corporateActions` | the route itself reads only the record held on the server's disk; the chart's reader of that record, `earnings_estimates.get_chart_markers`, builds it from the vendor when nothing is held and refreshes it in the background when it is more than a day old | `corporate_actions_held.held_actions`, the route's own service, and nothing else. It never builds, never refreshes and never asks the vendor |
| `calendar.ipos` | `ipo_calendar.get_ipos_with_status` asks two vendors (Finnhub and FMP) whenever nothing is held for the range | `ipo_calendar_held.held_ipos` (added with this version, a new file beside the service): the merged rows the service stored for exactly the IPO panel's window, with the time it stored them, or the service's own record that both vendors failed, else nothing. It never fetches and never writes to the cache |
| `calendar.dividends` | `dividends_calendar.get_events_with_status` asks the vendor (two reference reads per stock) whenever nothing is held for the symbol set; with no `syms` the route also reads the caller's own stocks | `dividends_calendar_held.held_events` (added with this version, a new file beside the service): what the service stored for one named stock alone (the DVD panel's one-stock read), with the time it stored it and whether it marked that read incomplete, else nothing. It never fetches, never writes to the cache, and never reads a member's own lists |

Rails hold each adapter to what its member path serves and count builds, threads, vendor requests and cache writes:
with nothing held the adapter starts none, and the member path's own reader is shown to start one in the same state. A
further rail replaces every builder, refresh, vendor reader, route reader and the cache's writer with functions that
fail, and runs every read of this section held and not held. Both new readers are pinned against their services: a
rail drives the service itself over invented vendor rows and reads its answer back through the reader.

**What this version does not build, and why.** The six Terminal panels that went live on 2026-11-20 were `COT`,
`ANLG`, `MKTS`, `IPO`, `DVD` and `CACT`. `COT` is read already (the `cot.positioning` kind, its capability and its own routing group, `cot`).
`ANLG`: the Breadth page shows its Analogues tab to admins only (`resolveBreadthTabs` in
`app/src/hub/sections/breadthSection.js`), and whether the Agent may read that data is not answered, so no kind reads
it. `MKTS`: the markets board reads three things, and none needs a kind of its own. Its index funds come from
`GET /api/snapshot`: live vendor quotes the route rebuilds from the vendor once its 15-second copy has lapsed (it
serves the last complete copy, at most two minutes old, while one refresh runs), and the production `quotes` kind
already reads those funds from the vendor's snapshot (§4.1); its Treasury rows are the curve
`rates.treasury` already reads (§4.15); its VIX and Bitcoin legs come from Yahoo Finance inside that snapshot, which the
Agent's asset-quote kinds (`index.quote`, `crypto.quote`) decline to serve (`asset_quotes.py`: no licensed source, §4.7.3). The stocks first traded in the last year (`GET /api/scans/ipo-1y`) are not
`calendar.ipos`: `leaders.longRun` already reads that list (its `IPO` lens, §4.10). The CACT panel's name and ticker
record (`GET /api/research/rename-notice/{sym}`, behind its own switch) is not in `corporate_actions_held` and is not
read here.

**Each kind's own states, and what each read says.** No state is ever said as "no splits", "no IPOs" or "no dividend":

| The service says | The read |
|---|---|
| `stock.corporateActions`: nothing is held for the stock (`not_held`: its chart has not been opened on this server) | `unavailable`, not held; nothing is built |
| `stock.corporateActions`: the held record lists events in both blocks | `ok`, each block newest first with its own count and newest date |
| `stock.corporateActions`: the held record lists none in one block, or in either | `ok`, the empty block said as what the record lists, never as proof of none (the chart's build withholds the dividends when its split read fails, and the record does not say so); with neither, `as_of` null, said |
| `stock.corporateActions`: the record is older than the chart's own refresh age, or carries no read time | `ok` and `stale`, said; nothing is refreshed |
| `calendar.ipos`: nothing is held for the IPO panel's window (a calendar held for another range does not count) | `unavailable`, not held |
| `calendar.ipos`: the service's own record that both vendors failed for the window | `unavailable`, with the time UCT recorded it |
| `calendar.ipos`: a calendar is held and lists no deal (at least one vendor answered) | `ok`, no row, said |
| `calendar.ipos`: a deal with a field the calendars leave empty | `ok`, that field null, said |
| `calendar.dividends`: nothing is held for any named stock alone | `unavailable`, not held |
| `calendar.dividends`: nothing is held for some named stocks | `partial`, those stocks named and left out |
| `calendar.dividends`: the service marked a stock's read incomplete (a vendor read failed or was cut by its deadline) | `partial`, what is held is carried and the stock is named, never as none |
| `calendar.dividends`: a stock is held whole and nothing is declared ahead | `ok`, no row for it, said |
| any kind: a malformed answer or a failing service | `unavailable`, read failed |

**Rules all three share**
- **A bad request is refused before any read.** Each kind's `validate` runs before admission (a `symbol` that is not
  one US stock ticker in the route's own spelling, an out-of-range `rows`, a `symbols` list that is empty, longer than
  ten or holds something that is not a ticker): the read is `refused` and spends no budget. `calendar.ipos` takes no
  symbol.
- **A value that does not exist is null, never 0.** A split ratio the record cannot state, a deal's price, shares or
  value the calendars leave empty, a dividend amount not declared, and the event count of a stock with nothing held
  are each null.
- **The as-of is the data's own date, never the time of the read** (§3). `stock.corporateActions`'s `as_of` is the
  newest event in the record; when UCT read the record from the vendor rides beside it (`read_at`). The two forward
  calendars carry no as-of of their own, so their `as_of` is null, a note says so, and the time UCT read them rides
  beside it (`read_at`; for `calendar.dividends` the oldest of the stocks', so the answer is never described fresher
  than its oldest stock). The read day picks the IPO panel's window and splits its deals into ahead and before; it is
  never stated as the data's date.
- **Unknown is never claimed fresh.** A time the service did not record is said in the note as
  `a time it did not record`, and the field is null.
- **The server says when it cut a list, and from which end.** `stock.corporateActions` carries each block's newest rows
  and leaves out the OLD end; `calendar.ipos` carries the soonest deals ahead (leaving out the FAR end) and the newest
  deals before (leaving out the OLD end); `calendar.dividends` carries the soonest events and leaves out the FAR end.
  Each carries the whole count beside what is shown.
- **What is left out is said.** `stock.corporateActions` names the name and ticker record in `data.left_out`; the
  canonical entity the two calendar services stamp on each row is not carried.
- **Every number is the service's own.** Nothing is re-derived, ranked or counted in the adapters.
- **The member's answer is built from the read's `data` and `status`.** The browser capabilities template their text
  from those; an envelope note is never echoed to the member as if it were data, and the answers do not name a vendor.

**Why all three are model-isolated.** The licensing register
(`docs/terminal-research/09-security-licensing-cost/licensing-register.md`) has no row that clears any of these three
reads for a model provider outright. Isolating all three is the builder's default under the rule "when in doubt,
isolated"; it is not a ruling by anyone. Each kind is decided from the rows of the data it is built on, quoted as they
stand:
- `stock.corporateActions` and `calendar.dividends`: the vendor's reference data. The register's row T-07 ("Member display + external —
  reference data (splits, dividends, tickers, conditions)", Massive · reference) reads class **R** in its class column
  and "Ind **R** · Bus **LA (incl. external)**" in its scenario column, and the register's 2026-09-19 note, as the code's
  licensing table follows it since 2026-11-19, reads it LA "each scoped to member display (AI use, external publication
  and attribution stay their own rows)". The AI row, row T-14 ("AI processing — Massive numbers into Claude"), reads
  class **R** in its class column and "Ind **R** · Bus **LA**" in its scenario column; the register's legend defines LA
  as "Likely Allowed (verify contract)". Isolating until a person has checked the contract is the builder's default.
- `calendar.ipos`: two vendors' calendars, merged. The register's row T-52 ("Member display — earnings-calendar past-day backfill;
  company profile / metrics / logo; insider transactions; IPO calendar", Finnhub) covers Finnhub's leg for member
  display. Its AI row, row T-54 ("AI processing — Finnhub fields in Compass / AI Search tool packs"), reads class **R** in
  its class column, with its owner fact "ANSWERED — see T-51" and LA in its scenario column. No row names FMP's IPO
  calendar (the code's licensing table says the same and falls through to U), and FMP's AI row, row T-44 ("AI
  processing — FMP numbers (fundamentals, analyst, earnings) into AI Search synth/agent, Compass, stock briefs, Model
  Book"), is class **U**: "No AI clause; derived-works clauses govern". A merged row does not say which vendor supplied
  a field.

Whether an isolated value may ever reach the model is an owner decision (§4.4), and none is recorded here. On the
browser the three kinds are read only by local-only capabilities (`stock.splitsDividends`, `stock.ipoCalendar`,
`stock.dividendsCalendar` in `app/src/agent/capabilities/terminalDataWave8.js`, all in `turn.LOCAL_ONLY_ACTIONS`): the
model plans the lookup and never sees what came back. Each capability registers only while the server lists its own
kind, and their routing words sit in one words-only group of their own (`marketCalendars`, the 50th of the 56 groups
`turn.MAX_GROUPS` keeps; the cap is not changed by this version).

**`stock.corporateActions`** (source `uct-chart-markers`)
- What it returns: one stock's splits (back 45 years) and cash dividends (back 5 years, by
  ex-date) as held beside its chart, each block newest first, with its own rows, count, window and newest date.
  Dividend amounts are split-adjusted (what the chart draws), not the amounts as declared. `rows` 1–60 per
  block (default 12, the CACT panel's own). Every `ok` read carries the notes
  `{symbol}'s splits and cash dividends as UCT holds them beside the stock's chart, from its market-data vendor's reference data: splits back {split_years} years and cash dividends back {dividend_years} years by ex-date, newest first. Dividend amounts are split-adjusted (what the chart draws), not the amounts as declared. A record, not a forecast and not advice`,
  `` `as_of` is the newest event in the record ({day}); it is never the time of this read. UCT read the record from its vendor at {at} (UCT's own time), and each block carries its own newest date `` or, when the record lists no event,
  `` the record UCT holds for {symbol} lists no split and no cash dividend, so `as_of` is null. UCT read the record at {at} (UCT's own time). The record does not say whether every vendor read behind it answered, so this is what is held, not proof that none happened ``, and
  `the company's name and ticker record (its former tickers) is not part of this record and is left out of this answer. The Corporate actions panel (CACT) in UCT reads it separately`.
- Params: `symbol` (one US stock ticker, in the route's own spelling `BRK-B`); `rows`.
- **An empty block.** `the record UCT holds for {symbol} lists no {what} in its {years}-year window. The record does not say whether every vendor read behind it answered, so this is what is held, not proof that none happened`, where `{what}` is `split` or `cash dividend`.
- **The cut, from the old end.** `{total} {what} are held and the newest {shown} are returned, newest first: the list is cut from the OLD end`, where `{what}` is `splits` or `cash dividends`.
- **A ratio that is not stated.** `{n} of the splits returned have no ratio the record can state; that ratio is null, never 0`.
- **Stale.** `UCT read this record at {at}, more than {hours} hours ago, so a newer split or dividend may not be in it. This read never refreshes it: the stock's chart in UCT refreshes it when it is opened`; with no read time `the record carries no time UCT read it, so how old it is cannot be stated and it is marked stale. This read never refreshes it`.
- `unavailable`: nothing held (`no splits or dividends are held for {symbol} on this server: they are held once the stock's chart has been opened in UCT, and this read never asks the vendor. That is not the same as no splits or dividends. Open the stock's chart in UCT, then ask again`); a failing read (`the corporate actions read failed; nothing is stated. That is not the same as no splits or dividends`).
- Data fields: `symbol`, `state` (ok), `splits` (`rows, count, total, cut, window_years, as_of`), `dividends` (the same,
  and `basis`: `split_adjusted`), `as_of`, `read_at`, `left_out`. Split row fields: `date, ratio, to_factor` (shares
  after per share before); dividend row fields: `date, amount`. `coverage` counts the events held against the rows
  carried.

**`calendar.ipos`** (source `uct-ipo-calendar`)
- What it returns: the IPO calendar for the IPO panel's own window (last week's Monday to next week's Friday around the
  read day, New York time; `ipoCalendarModel.js` `ipoWindow`, pinned against the adapter's numbers), merged from two
  vendors' calendars: each deal's day, company, symbol, exchange, price or price range, shares offered, value and
  status, in two lists, today and ahead (`data.ahead`) and before today (`data.earlier`). `rows` 1–50 per list
  (default 20). Every `ok` read carries the notes
  `the IPO calendar for {start} to {end} (the window the IPO calendar panel reads: last week's Monday to next week's Friday) as UCT holds it, merged from two vendors' IPO calendars: each deal's day, company, symbol, exchange, price or price range, shares offered, value and status, deals today and ahead soonest first and earlier deals newest first. When one vendor fails the other's rows are served, and the server does not record which. A calendar of deals, not a forecast and not advice` and
  `` the IPO calendars give no as-of time of their own, so `as_of` is null. UCT read them at {at} (UCT's own time); the server keeps one answer for at most {hours} hours, and this read never asks the vendors ``, and with at least one deal
  `` `value` is the dollar value of the shares offered where a calendar gives it; for some deals a calendar gives the company's expected market value in its place, and the merged row does not say which ``.
- Params: `rows`.
- **No deal.** `no deal is on the IPO calendar for {start} to {end} in what UCT holds: the vendor calendars that answered list none`.
- **The cuts.** `{total} deals are on the calendar for today and ahead and the soonest {shown} are returned: the list is cut from the FAR end` and `{total} deals before today are on the calendar and the newest {shown} are returned: the list is cut from the OLD end`.
- **A field left empty.** `{n} deals have at least one field the calendars leave empty (price, shares or value); those fields are null, never 0`.
- **A row the server holds that is not a deal.** `{n} rows the server holds have no usable day or no company and are not returned`.
- The read is never marked `stale`: the service keeps one range for at most six hours.
- `unavailable`: nothing held (`no IPO calendar is held on this server for {start} to {end} (the window the IPO calendar panel reads), and this read never asks the vendors. That is not the same as no IPOs. Open the IPO calendar panel (IPO) in UCT, then ask again`); both vendors failed
  (`UCT's last read of the IPO calendars for {start} to {end} found both vendors failing, at {at} (UCT's own time); nothing is stated. That is not the same as no IPOs`); a failing read (`the IPO calendar read failed; nothing is stated. That is not the same as no IPOs`).
- Data fields: `window` (`from, to`), `split_day`, `ahead` and `earlier` (each `rows, count, total, cut`), `total`,
  `dropped`, `as_of` (null), `read_at`. Row fields: `symbol, name, date, exchange, price_range, shares, value, status`.
  `coverage` counts the deals held against the rows carried.

**`calendar.dividends`** (source `uct-dividend-calendar`)
- What it returns: for each named stock (at most 10), what the service holds for that stock alone: its next
  ex-dividend date with the cash amount as declared, and every split ahead, all soonest first (at most 40 events).
  It never reads the member's own lists. Every `ok` or `partial` read carries the notes
  `the dividends and splits declared ahead for {symbols} as UCT holds them, one stock at a time (the answer the dividend calendar panel reads for one stock), from its market-data vendor's reference data: for each stock its next ex-dividend date with the cash amount as declared, and every split ahead, soonest first. Past events are the Corporate actions panel's (CACT). A calendar of declared events, not a forecast and not advice`,
  `` a forward calendar carries no as-of time of its own, so `as_of` is null. UCT read these stocks' calendars from its vendor at {at} at the oldest (UCT's own time), so an event dated before the day of this read may have passed since. The server keeps one stock's answer for at most {hours} hours, and this read never asks the vendor `` and
  `this read answers for the stocks named in the request only: it never reads the member's own watchlists, positions or stocks`.
- Params: `symbols` (1–10 US stock tickers).
- **Nothing ahead.** `no dividend or split is declared ahead in what UCT read for: {list}`.
- **An incomplete read.** `UCT's last read of these stocks did not fully answer (a vendor read failed or was cut by its deadline), so events may be missing for them: {list}. What is held is returned; that is not the same as no event`.
- **Some stocks not held.** `nothing is held on this server for these stocks alone, and this read never asks the vendor, so they are not in this answer: {list}. That is not the same as no dividend or split. Open the dividend calendar panel (DVD) for each of them in UCT, then ask again`.
- **The cut, from the far end.** `{total} events are held for these stocks and the soonest {shown} are returned: the list is cut from the FAR end`.
- **An amount not declared.** `{n} of the dividends returned have no declared amount; that amount is null, never 0`.
- The read is never marked `stale`: the service keeps one stock's answer for at most twelve hours, five minutes when
  incomplete.
- `unavailable`: nothing held for any named stock (`nothing is held on this server for {list} alone (the dividend calendar panel's one-stock read), and this read never asks the vendor. That is not the same as no dividend or split. Open the dividend calendar panel (DVD) for each stock in UCT, then ask again`); a failing read (`the dividend calendar read failed; nothing is stated. That is not the same as no dividend or split`).
- Data fields: `symbols`, `stocks` (each `symbol`, `state` (complete · incomplete · not_held), `read_at`, `events`),
  `rows`, `count`, `total`, `cut`, `as_of` (null), `read_at`. Row fields: `symbol`, `type` (dividend · split), `date`,
  `amount`, `ratio`.
  `coverage` counts the named stocks against those held.

### 4.18 Terminal data wave 9: `rates.auctions`, `rates.realYields`, `fed.watch` (v1.15, terminal-data)

Three more thin kinds, the Agent half of the AUCT terminal panel, the real-yield block of RATES and the FED panel: US
Treasury auctions coming up and their recent results, the Treasury's real yields (TIPS) with the breakevens, and the
Fed watch. Each is an adapter over the service its member route already reads
(`api/services/uct_agent/marketdata/treasury_auctions_read.py`, `real_yields_read.py`, `fed_watch_read.py`;
registered in `kinds.py` with `owner="terminal-data"`). No new connection, job, database, write or route (§6), and no
new environment variable.

**Status: dark, not armed.** Like every kind, each is served only when it is listed in `UCT_AGENT_DATA_KINDS` (with
`UCT_AGENT_DATA=1`). All three are model-isolated, so each also needs the master switch `UCT_AGENT_ISOLATED=1` and its
own entry in `UCT_AGENT_ISOLATED_KINDS` (§4.4, ADR-005); until then it is refused for every purpose, and once armed it
is served for purpose `answer` only. This section describes what the code does when a kind is switched on. It does not
switch anything on. As written (2026-11-21), none of the three is in production's list.

| Kind | Canonical service (member route) | Params | Declared freshness | `as_of` | `provider_calls` | Model-isolated |
|---|---|---|---|---|---|---|
| `rates.auctions` | the answer `api/services/treasury_auctions.py` holds, read through `treasury_auctions_held.held_auctions` (`GET /api/research/treasury-auctions`) | `{rows}` | periodic · every read periodic | the newest date in the records (the Treasury's newest list of coming auctions or the newest auction day with a result); null when the records carry none (never the time of the read) | 0 | **yes** |
| `rates.realYields` | the real yield block `api/services/treasury_real_yields.py` holds, shaped by the service's own `assemble` over the nominal days `treasury_yields` holds, read through `treasury_real_yields_held.held_real` (the `real` block of `GET /api/research/treasury-yields`) | `{}` | periodic · every read historical | the real curve's own date; the breakevens carry their own day | 0 | **yes** |
| `fed.watch` | the Fed watch `api/services/fed_watch.py` holds, read through `fed_watch_held.held_answer` (`GET /api/research/fed-watch`) | `{rows}` | periodic · every read periodic | null: each of the seven blocks carries its own date | 0 | **yes** |

**No read of this section starts a build or a request.** (§5: a turn has 20 provider requests and a member waiting.)
Each member route starts its service's one background build when nothing is held or a refresh is due, and the Fed
watch's own read-only answer reaches past the server for its rates. A turn must not start any of that, so each adapter
reads a read-only path and answers `unavailable`, with the reason, when nothing is held:

| Kind | What the member path can start | What the adapter reads instead |
|---|---|---|
| `rates.auctions` | `treasury_auctions.get_auctions` starts the service's one background build (two requests to the Treasury's Fiscal Data service) when nothing is held, and once after each weekday evening slot | `treasury_auctions_held.held_auctions` (added with this version, a new file beside the service): the service's own hold through its read-only `peek()` (memory, or the disk copy looked for once per process), shaped as the route serves it, else nothing. It never builds and never asks the publisher |
| `rates.realYields` | `treasury_real_yields.get_real` starts the service's background build (requests to the Treasury's website) when nothing is held or a refresh is due | `treasury_real_yields_held.held_real` (added with this version, a new file beside the service): the service's own hold through `peek()`, the nominal days through `treasury_yields.held_rows` (read only), shaped by the service's own `assemble`, else nothing. It never builds and never asks the Treasury |
| `fed.watch` | `fed_watch.get_fed_watch` starts the service's background build (the Board's feeds and pages, the New York Fed's survey page and data file) whenever something is due; and the service's own read-only `fed_watch.held_answer` asks the economics store for its three rates series (`econ.serving.series`), which on a cold serving cache reads the store's published files from the data bucket (`data_sync.get_bytes`) | `fed_watch_held.held_answer` (added with this version, a new file beside the service): every block as the service builds it, with the service's own block functions under the service's own lock, except the rates, which are read only from what the economics store's serving cache already holds (`fed_watch_held.held_rates`); a series not in that cache is `not_held`. It never builds, never reads a page or the bucket, and never writes to the shared cache |

Rails hold each adapter to what its member path serves and count builds, threads, requests and cache writes: with
nothing held the adapter starts none, and the member path's own reader is shown to start one in the same state (the
Fed watch's own read-only answer is shown to reach the bucket reader). A further rail replaces every builder, job,
publisher and page reader, the shared hold's `get`, `_start` and `_run`, the Fed watch's own rates block, the economics
store's series reader, loaders and bucket reads, and the cache's writer with functions that fail, and runs every read
of this section held and not held, with every refresh due. Each new reader is pinned against its service: a rail
drives the service itself over an invented publisher and reads its answer back through the reader; the Fed watch's
reader equals `fed_watch.held_answer()` block for block while the economics feature is off, and with it on its rates
equal what the service's own rates block read through the store.

**Why `rates.realYields` is a kind of its own, not an extension of `rates.treasury`.** The real block has its own
date, its own held state and its own staleness (the route sends it beside the nominal answer as a block with its own
status). Folded into `rates.treasury` (§4.15) it would either change what that kind's `as_of`, `stale`, notes and
coverage mean, or hide the block's own state, and `rates.treasury`'s capability text and corpus entries would change.
`rates.treasury` is untouched by this version.

**The rates block and its switch.** The Fed watch's federal funds rates come from the economics store, which serves
only while `ECON_ENABLED` is `1` on the server; the flag ledger (`docs/feature_flags.json`) records that switch as dark.
Whatever the server's value, the block reports its own state: `off` while the switch is not `1` (the service's own
words), and from what the serving cache holds while it is (`ok`, `not_held`, or `no_data`).

**What this version leaves out, and why.** The FOMC statement's full text (the date, the link, the redline's word
counts and the passages that changed are carried); this week's Fed speakers from the economic calendar; and the
survey's probability ranges. Each is named in `data.left_out` and said in a note; the FED panel shows them. The news
wire's vendor is not named in the data (`source` reads `news wire`).

**Each kind's own states, and what each read says.** No state is ever said as "no auctions", "no figure" or "no Fed
news":

| The service says | The read |
|---|---|
| `rates.auctions`: nothing is held (no build has run on this server, or the last one did not work) | `unavailable`, not held; nothing is built |
| `rates.auctions`: a held answer, both lists with rows | `ok`, each list with its own count and cut |
| `rates.auctions`: a held answer whose records list no auction coming up, or no result | `ok`, the empty list said as what the records list; with neither, `as_of` null, said |
| `rates.auctions`: the held answer was read before the last weekday evening slot, or its last look failed | `ok` and `stale`, said; nothing is looked for |
| `rates.realYields`: nothing is held | `unavailable`, not held |
| `rates.realYields`: the curve's date is older than the weekday before today in New York, or the last look failed | `ok` and `stale`, said |
| `rates.realYields`: a maturity, a reference day or a breakeven side is missing | `ok`, that figure null, said |
| `rates.realYields`: the nominal and the real curve have no day in common | `ok`, every breakeven null, said |
| `fed.watch`: the Board's feeds have never been read here and no other block is held | `unavailable`, not held |
| `fed.watch`: some blocks held, others not held, refused, unreadable, switched off or with no figure | `partial`, every block in its place with its own state, each one not held said |
| `fed.watch`: all seven blocks held | `ok` |
| `fed.watch`: a held block whose last look did not go well | `stale`, said |
| any kind: a malformed answer or a failing service | `unavailable`, read failed |

**Rules all three share**
- **A bad request is refused before any read.** Each kind's `validate` runs before admission (an out-of-range or
  non-integer `rows`; `rates.realYields` takes no argument): the read is `refused` and spends no budget. None takes a
  symbol.
- **A value that does not exist is null, never 0.** An auction amount, rate or bid-to-cover the Treasury left empty, a
  bidder split with a class missing, a real yield, a reference day or a breakeven side that is not held, and a Fed rate,
  projection or survey figure not held are each null.
- **The as-of is the data's own date, never the time of the read** (§3). `rates.auctions`'s `as_of` is the newest date
  in the records and `rates.realYields`'s the real curve's day; when UCT read them rides beside it (`read_at`). The Fed
  watch's blocks carry different dates, so its `as_of` is null, a note says so, and each block carries its own.
  `days_to_go` to the next decision counts from the day of the read, as the panel counts it.
- **Unknown is never claimed fresh.** A time the service did not record is said in the note as
  `a time it did not record`, and the field is null.
- **The server says when it cut a list, and from which end.** `rates.auctions` carries the soonest auctions coming up
  (leaving out the FAR end) and the newest results (leaving out the OLD end), and says when the service itself read one
  page of a longer list; `fed.watch` carries the newest speeches and headlines (leaving out the OLD end) and the first
  changed passages in the statement's order (leaving out the END). Each carries the whole count beside what is shown.
- **What is left out is said.** See above.
- **Every number is the service's own.** Nothing is re-derived in the adapters: the bidder shares, the breakevens and
  the redline's counts are the services' own arithmetic. The changed passages are the redline's own segments, grouped
  at the paragraph and sentence ends of the new statement.
- **The member's answer is built from the read's `data` and `status`.** The browser capabilities template their text
  from those; an envelope note is never echoed to the member as if it were data. The Board's citation, the New York
  Fed's notice beside its rates and its attribution beside the survey are shown from the read's data, as the panel
  shows them; the answers do not name the news wire's vendor.

**Why all three are model-isolated.** The licensing register
(`docs/terminal-research/09-security-licensing-cost/licensing-register.md`) has no row that clears any of these three
reads for a model provider. Isolating all three is the builder's default under the rule "when in doubt, isolated"; it
is not a ruling by anyone. Each kind is decided from the rows of the data it is built on, quoted as they stand:
- `rates.auctions`: there is no row in the register for the Treasury's Fiscal Data auction records. The nearest row, row
  T-95 (daily US Treasury par yields on the Terminal's `RATES` panel, class **A**, a US Government work), says "Nothing
  else reads it (no AI lane, no export, no external publication)."
- `rates.realYields`: there is no row in the register for the Treasury's real yield curve. Row T-95 covers the nominal
  par curve the breakevens are worked out from, and says the same.
- `fed.watch`: row T-97 (the Board's monetary policy releases, speeches and projections on the Terminal's `FED` panel,
  class **A**: "Unless otherwise indicated, information on Board's website is in the public domain", and "Please cite to
  the Board as the source of the information.") says "Nothing else reads it (no AI lane, no export, no external
  publication)." The register's row T-98 (the same panel's New York Fed survey block, class **A** under the bank's Terms of Use as the
  economics registry records them) says "The Terms of Use page itself was not read for this row". The headlines come
  from the news wire UCT receives, which has no row in the register at all. The next decision comes from the economic
  calendar UCT holds: row T-37 ("Member display — economic calendar (all non-current weeks; ForexFactory `thisweek` is
  the other leg)", FMP) is class **R**, FMP's AI row, row T-44, is class **U** ("No AI clause; derived-works clauses
  govern"), and row T-92 (ForexFactory among others) is "**U — not researched**". No block is split into a kind of its
  own: none is cleared, so the whole answer is isolated.

Whether an isolated value may ever reach the model is an owner decision (§4.4), and none is recorded here. On the
browser the three kinds are read only by local-only capabilities (`stock.auctionCalendar`, `stock.realCurve`,
`stock.fomcWatch` in `app/src/agent/capabilities/terminalDataWave9.js`, all in `turn.LOCAL_ONLY_ACTIONS`): the model
plans the lookup and never sees what came back. Each capability registers only while the server lists its own kind,
and their routing words sit in one words-only group of their own (`marketRates`, the 51st of the 56 groups
`turn.MAX_GROUPS` keeps; the cap is not changed by this version). Real-yield asks in the Treasury yields' own words
("the 10-year real yield", "the real yield curve") name wave 6's `marketRecords` group too: both groups ride along.

**`rates.auctions`** (source `us-treasury-fiscal-data`)
- What it returns: the auctions coming up (security type and term, auction day, issue day, announcement day, amount
  offered, reopening, CUSIP), soonest first, and the results of the last 45 days (the rate and which one it is: high
  yield, high rate or high discount margin; the bid-to-cover ratio; the competitive award split between primary dealers,
  direct bidders and indirect bidders with each one's share; whether it was TIPS, a floating rate note or a cash
  management bill), newest first. `rows` 1–50 per list (default 12, the AUCT panel's own). Every `ok` read
  carries the notes `US Treasury auctions as UCT holds them, from the Treasury's Fiscal Data service: the auctions coming up (security, auction day, issue day, amount offered), soonest first, and the results of the last {days} days (the high yield, rate or discount margin, the bid-to-cover ratio, and the competitive award split between primary dealers, direct bidders and indirect bidders with each one's share), newest first. Amounts in US dollars and rates in percent, as the Treasury publishes them. A record and a schedule, not a forecast and not advice`, `` `as_of` is the newest date in what UCT read ({day}): the day of the Treasury's newest list of coming auctions ({upcoming}) or the newest auction day with a result ({through}), whichever is later; it is never the time of this read. UCT read the records at {at} (UCT's own time) `` or, when the records carry no date, `` the records UCT holds carry no date of their own, so `as_of` is null. UCT read them at {at} (UCT's own time) ``.
- Params: `rows`.
- **An empty list.** `the Treasury's records UCT holds list no auction coming up` and `the Treasury's records UCT holds list no auction with a result in the last {days} days`.
- **The cuts.** `{total} auctions are listed as coming up and the soonest {shown} are returned: the list is cut from the FAR end` and `{total} auction results are held and the newest {shown} are returned: the list is cut from the OLD end`; the service's own one-page cut `the Treasury held more rows than the one page UCT reads, newest first, so the oldest are not in what UCT holds: {what}`, where `{what}` is `the oldest results`, `the oldest copies of the list of coming auctions`, or both.
- **A figure left empty.** `{n} auctions returned have at least one figure the Treasury left empty (the amount, the rate, the bid-to-cover ratio or the bidder split); those figures are null, never 0`.
- **A row the Treasury sent that is not an auction.** `{n} rows the Treasury sent have no auction day or no security and are not in what UCT holds`.
- **Stale.** `UCT read these records at {at}, before the Treasury's last evening update UCT looks for ({slot}), so newer records may exist. This read never looks for them: open the Treasury auctions panel (AUCT) in UCT, then ask again`; a failed look `UCT's last look for newer auction records, at {at}, did not go well ({why}): the records held are the last good ones`.
- `unavailable`: nothing held (`no Treasury auctions are held on this server yet, and this read never asks the Treasury. That is not the same as no auctions. Open the Treasury auctions panel (AUCT) in UCT, then ask again`); a failing read (`the Treasury auctions read failed; nothing is stated. That is not the same as no auctions`).
- Data fields: `as_of`, `upcoming_as_of`, `results_through`, `window_days`, `upcoming` and `results` (each `rows, count,
  total, cut`), `dropped`, `publisher_cut` (`upcoming, results`), `read_at`, `basis`, `source`, `check`. Upcoming row
  fields: `security_type, security_term, auction_date, issue_date, announced_date, offering_amount, reopening, cusip`; result row fields: `security_type, security_term, auction_date, issue_date, maturity_date, offering_amount, rate, rate_kind, bid_to_cover, reopening, tips, floating_rate, cash_management, cusip, bidders` (`bidders`:
  `primary_dealers`, `direct`, `indirect` each `amount, share`, and `total`). `coverage` counts the auctions held against
  the rows carried.

**`rates.realYields`** (source `us-treasury-real-curve`)
- What it returns: the real yield at each maturity (5, 7, 10, 20 and 30 years), what it was one day and one week
  earlier with the change in basis points, and the breakeven at each maturity (`breakevens`: its own day, and each row's
  nominal, real and value). Every `ok` read carries the notes `US Treasury daily par real yields (Treasury inflation-protected securities) by maturity, as UCT holds them: each real yield in percent, what it was one day and one week earlier with the change in basis points, and the breakeven at each maturity (the nominal yield minus the real yield on the newest day both curves hold, in percent, worked out by UCT's server). End-of-day figures published by the US Treasury, not live quotes, not a forecast and not advice`, `` `as_of` is the date of the newest real figure ({day}); it is never today and never the time of the read. UCT read the figures from the Treasury's website at {at} (UCT's own time) ``.
- Params: none.
- **The breakevens.** For an older day than the real curve's `the breakevens are for {day}, the newest day both the nominal and the real curve have a figure, which is older than the newest real figure`; with no day in common
  `no breakeven is stated: the nominal and the real curve have no day in common in what UCT holds, so every breakeven is null, never 0`; a side missing `{n} maturities have no breakeven on {day} (the nominal or the real figure is missing) and are null, never 0: {list}`.
- **A figure or a reference day missing.** `{n} maturities have no real figure on {day} and are null, never 0: {list}` and `no real figure was found near enough to {list} earlier, so those changes are null, never 0`.
- **Stale.** `the newest real figure held is {day}, older than {expected}, the weekday before today in New York. This read never looks for a newer one: open the Treasury yields panel (RATES) in UCT, then ask again`; a failed look `UCT's last look for newer real figures, at {at}, did not go well ({why}): the figures held are the last good ones`.
- `unavailable`: nothing held (`no real yields are held on this server yet, and this read never requests them. That is not the same as no figure. Open the Treasury yields panel (RATES) in UCT, then ask again`); a failing read (`the real yields read failed; nothing is stated. That is not the same as no figure`).
- Data fields: `as_of`, `ref_dates` (`d1, w1`), `maturities` (each `key, label, months, yield, was, change_bp`),
  `breakevens` (`as_of`, `rows`: each `key, label, months, date, nominal, real, value`), `rows`, `read_at`, `basis`,
  `source`, `check`. `coverage` counts the maturities against those with a figure.

**`fed.watch`** (source `uct-fed-watch`)
- What it returns: seven blocks, each with its own `state` (one of `ok, none, not_held, unavailable, failed, unreadable, off, no_data`) and source:
  `statement` (its date, link, the newest minutes, and the redline: its state, the statement before it, the added and
  removed word counts and the changed passages, each as it reads in the new statement and as it read before, at most
  8), `speeches` (speaker, title, where, the time published, link), `headlines` (each with the time UCT received
  it, and the tickers the news widget's own derivation finds), `next_meeting` (day, time, label, days to go, and whether
  it comes from the economic calendar or the survey's meeting dates), `rates` (the effective rate and the target range's
  two ends, each with its own date, and the New York Fed's notice), `projections` (the officials' median projection of
  the federal funds rate by year and the longer run, the meeting and the release day), `survey` (the survey month, the
  response due day, the meeting it was taken before, the median path for the meetings ahead, and the bank's
  attribution). `rows` 1–15 per list (default 10). Every read with a block held carries the notes
  `the Fed watch as UCT holds it, in seven blocks, each with its own source and its own date: the newest FOMC statement and what changed from the one before (the Federal Reserve Board), Fed speeches and testimony (the Board), Fed headlines from the news wire UCT receives, the next FOMC decision (the economic calendar UCT holds, or the New York Fed survey's meeting dates), the federal funds rates (the Federal Reserve Bank of New York), the officials' median rate projections (the Board) and the New York Fed's Survey of Market Expectations. The Board's and the New York Fed's own words and figures: no UCT forecast, no summary and not advice`, `` `as_of` is null: the seven blocks each carry their own date (the statement's day, each speech's and headline's time, the rates' own days, the projections' release day, the survey's month), and none of them is the time of this read ``, `the statement's full text, this week's Fed speakers from the calendar and the survey's probability ranges are left out of this answer. The Fed watch panel (FED) in UCT shows them` and `the Board asks to be cited as the source of its materials: {cite}`.
- Params: `rows`.
- **A block not stated.** `the {block} block is not stated: {why}`, where `{block}` is one of `FOMC statement`, `Fed speeches and testimony`, `Fed headlines`, `next FOMC decision`, `federal funds rates`, `rate projections`, `New York Fed survey` and `{why}` one of `its source lists none`, `it is not held on this server yet, and this read never asks for it. That is not the same as none`, `its source refused UCT's last look and nothing is held`, `UCT's last look did not get an answer and nothing is held`, `its page could not be read`, `it is switched off on this server, so nothing is read`, `no figure is held`.
- **The redline.** `not one word changed from the statement of {previous}`; `no earlier statement is held to compare the newest one with, so no change is stated`; `the statement before the newest one ({previous}) is not held yet, so no change is stated. That is not the same as no change`; `the statement before the newest one ({previous}) could not be read, so no change is stated. That is not the same as no change`; `the two statements are too long to compare, so no change is stated`; the cut `{total} passages of the statement changed and the first {shown}, in the statement's order, are returned: the list is cut from the END`.
- **Speeches.** `{total} speeches and testimony are listed and the newest {shown} are returned: the list is cut from the OLD end`; a feed not held `the {feeds} feed is not held, so its items are not in the list`.
- **Headlines.** `{matched} of the newest {scanned} headlines on the wire are about the Fed; each headline's time is when UCT received it, and the wire gives no publication time of its own`; the cut `{matched} Fed headlines are held and the newest {shown} are returned: the list is cut from the OLD end`.
- **The next decision.** `` `days_to_go` counts from the day of this read in New York ({today}), as the panel counts it ``.
- **The rates.** `{n} of the three rates have no figure held and are null, never 0: {list}`; the bank's notice `the New York Fed's notice for the two rates, as the panel shows it: {notice}`.
- **The survey.** `the survey's figures are its respondents' (market professionals'), not market prices and not a UCT forecast. {credit}`.
- **Stale.** `UCT's last look for newer {what}, at {at}, did not go well ({why}): what is held is the last good read, and this read never looks again`.
- `unavailable`: nothing held (`nothing of the Fed watch is held on this server yet, and this read never asks the Board, the New York Fed or the news wire. That is not the same as no statement, no speech and no headline. Open the Fed watch panel (FED) in UCT, then ask again`); a failing read (`the Fed watch read failed; nothing is stated. That is not the same as no Fed news`).
- Data fields: `statement`, `speeches`, `headlines`, `next_meeting`, `rates`, `projections`, `survey`, `as_of` (null), `board_cite`, `left_out`. `coverage` counts the seven blocks
  against those held.

### 4.19 Terminal data wave 10: `stock.stats`, `stock.volumeFootprint`, `stock.factorExposure`, `stock.setupHistory`, `company.publicRecords`, `ownership.funds` (v1.16, terminal-data)

Six more thin kinds, the Agent half of the STAT, VFP, FCTX and SETH (one stock) terminal functions, of PUBR, and of the
OWN panel's "Funds (N-PORT)" block: one stock's statistics, its volume footprint and gaps, its factor exposure, the setups
that fired on it, one company's public records, and the registered funds that hold one stock. Each is an adapter over the
service its member route already reads (`api/services/uct_agent/marketdata/stock_stats_read.py`,
`volume_footprint_read.py`, `factor_exposure_read.py`, `setup_history_read.py`, `public_records_read.py`,
`fund_holders_read.py`; registered in `kinds.py` with `owner="terminal-data"`). No new connection, job, database, write or
route (§6), and no new environment variable. Each keeps its route's own field names, so the panel's own model reads the
data and the member's answer says what the panel says.

**Status: dark, not armed.** Like every kind, each is served only when it is listed in `UCT_AGENT_DATA_KINDS` (with
`UCT_AGENT_DATA=1`). All six are model-isolated, so each also needs the master switch `UCT_AGENT_ISOLATED=1` and its own
entry in `UCT_AGENT_ISOLATED_KINDS` (§4.4, ADR-005); until then it is refused for every purpose, and once armed it is
served for purpose `answer` only. This section describes what the code does when a kind is switched on. It does not switch
anything on. As written (2026-11-23), none of the six is in production's list.

| Kind | Canonical service (member route) | Params | Declared freshness | `as_of` | `provider_calls` | Model-isolated |
|---|---|---|---|---|---|---|
| `stock.stats` | the answer `api/services/stock_stats.py` holds for the stock, read through `stock_stats_held.held_stats` (`GET /api/research/stock-stats/{ticker}`) | `{symbol, rows}` | periodic · every read historical | the regular-session close of the newest session in the statistics (never the time of the read) | 0 | **yes** |
| `stock.volumeFootprint` | the answer `api/services/volume_footprint.py` holds, read through `volume_footprint_held.held_footprint` (`GET /api/research/volume-footprint/{ticker}`) | `{symbol, rows}` | periodic · every read historical | the newest session's close | 0 | **yes** |
| `stock.factorExposure` | the answer `api/services/factor_exposure.py` holds, read through `factor_exposure_held.held_exposure` (`GET /api/research/factor-exposure/{ticker}`) | `{symbol}` | periodic · every read historical | the newest session's close | 0 | **yes** |
| `stock.setupHistory` | the newest one-stock answer `api/services/setup_history.py` holds, with the universe lines the route attaches, read through `setup_history_held.held_signals` (`GET /api/research/setup-history/{ticker}`) | `{symbol, rows}` | periodic · every read historical | the newest session's close | 0 | **yes** |
| `company.publicRecords` | what `api/services/public_records.py` holds, section by section, read through the service's own read-only `public_records.held_records` (`GET /api/research/public-records/{ticker}`) | `{symbol, rows}` | periodic · every read periodic | null: each section carries its own read time | 0 | **yes** |
| `ownership.funds` | the held N-PORT index, read through the block's own read-only `fund_holders_nport.answer_for` (the `funds_nport` block of `GET /api/research/ownership/{sym}`) | `{symbol, rows}` | periodic · every read periodic | the end of the newest fund report period, as the start of that New York day | 0 | **yes** |

**No read of this section starts a build or a request.** (§5: a turn has 20 provider requests and a member waiting.) The
four price studies are worked out on the member's request when nothing is held for the session; PUBR's sections are built
by asking four agencies and the SEC; the N-PORT index by downloading the SEC's data sets. A turn must not start any of
that, so each adapter reads a read-only path and answers `unavailable`, with the reason, when nothing is held:

| Kind | What the member path can start | What the adapter reads instead |
|---|---|---|
| `stock.stats` | `stock_stats.get_stock_stats` works the stock out when nothing is held for the session (a read of its stored daily bars and of SPY's and its sector fund's closes) and asks MKTH for its answer (`market_history.get_market_history`, which starts MKTH's own background build when that is due) | `stock_stats_held.held_stats` (added with this version, a new file beside the service): the service's own hold (`stock_stats._cache`, under its own lock), else nothing. It never builds, never reads a price, never asks MKTH, and does not move the hold's least-recently-asked order |
| `stock.volumeFootprint` | `volume_footprint.get_volume_footprint` works the stock out when nothing is held (its bars and the earnings dates the earnings page holds), and looks at a held answer's earnings dates again when that is due | `volume_footprint_held.held_footprint` (added with this version): the service's own hold, else nothing; never a bar or an earnings read |
| `stock.factorExposure` | `factor_exposure.get_factor_exposure` first makes sure the session's fund set is held (it READS up to seven funds' stored closes and their alternatives) and then works the stock out | `factor_exposure_held.held_exposure` (added with this version): the service's own hold, else nothing; the fund set is never read |
| `stock.setupHistory` | `setup_history.get_stock` asks MKTH for its answer, starts the one-stock background build when nothing is held for the session, and reads the universe study through `get_study`, which starts the weekly study build when that is due | `setup_history_held.held_signals` (added with this version): the newest answer the service's keyed hold has for the stock (through its read-only `keys()` and `peek()`), with the universe lines attached by the service's own `universe_lines` from the study `setup_history.held_study` holds (read only); never a build |
| `company.publicRecords` | `public_records.get_public_records` starts one background build per section, and one for the company's names, on the first read of a company or when a held section is a day old | `public_records.held_records` (the service's own, read only): each section's hold through `peek()`, or `not_held` |
| `ownership.funds` | the index is built only by the scheduled run (`fund_holders_nport.run_scheduled`, daily at 00:50 New York time, two zip downloads from the SEC when a new quarter is posted) | `fund_holders_nport.answer_for` (the block's own request path): one read-only SQLite read of the held index; it never downloads, builds or waits |

Rails hold each adapter to what its member path serves and count builds, threads, requests and cache writes: with
nothing held the adapter starts none, and the member path's own reader is shown to do the work in the same state. A further
rail replaces every route reader, builder and price read of the four price studies (and MKTH's reader), the fund set's
reader, SETH's study and stock builders, PUBR's route reader, agency fetch and company-name reads, the N-PORT run, its
downloads and split read, the shared holds' `get`, `_start` and `_run`, and the cache's writer with functions that fail,
and runs every read of this section held and not held, with every price study due again. Each new reader is pinned against
its service: a rail drives the service itself over invented bars and reads its answer back through the reader (the same
object, its hold's order unmoved; SETH's universe lines equal the route's own).

**Isolation (ADR-005), the builder's default, from the licensing register.** No row of the register
(`docs/terminal-research/09-security-licensing-cost/licensing-register.md`) clears any of these six for a model provider:

- The four price studies (`stock.stats`, `stock.volumeFootprint`, `stock.factorExposure`, `stock.setupHistory`) are worked
  out from UCT's daily bar store, which holds the market-data vendor's end-of-day history (row T-04, member display of
  daily history, class **R**; row T-09, its storage, class **R**) and, before 2003-09-10, yfinance history (row T-71, the
  pre-2003 daily tail, class **X**). No row names these studies, and row T-14 (AI processing of the vendor's numbers, class
  **R**) names none of them. This is the rule `seasonality.stock` (§4.15) already follows, copied: the figures to the member,
  nothing to a model. The S&P 500's declines the statistics and the setup phases rest on come from MKTH's held answer over
  UCT's index store, which no row names either. The footprint's earnings marks rest on the report dates UCT's earnings page
  holds, a vendor's numbers whose AI row, row T-44, has "No AI clause" (class **U**).
- `company.publicRecords`: row T-100 (USAspending.gov, with the Dun & Bradstreet limitation on recipient names), row
  T-101 (ClinicalTrials.gov), row T-102 (openFDA) and row T-103 (LDA.gov) each clear the PUBR panel for member display and each says
  "Nothing else reads it (no AI lane, no export, no external publication)."
- `ownership.funds`: row T-104 (the SEC's Form N-PORT data sets, public domain as T-83) clears the OWN panel's block for
  member display and storage and says "Nothing else reads it yet (no AI lane, no export, no external publication)".

So all six are isolated and every capability is local-only (`turn.LOCAL_ONLY_ACTIONS`): `stock.riskProfile`,
`stock.volumeFootprint`, `stock.factorExposure`, `stock.setupHistory`, `stock.companyRecord`, `stock.ownershipReport`.
Where a register row leaves a question open (T-100: whether the D&B sentence on systematic access reaches a server's API
reads, and whether about 40 recipient names a company are "in bulk"), the narrower rule is kept: the member sees exactly
what the PUBR panel shows, bounded (at most 12 counted names and `rows` awards a section), and a model sees
nothing.

**The agencies' own words travel as data.** Each public-records section carries its agency's requirement in
`credit`, as the PUBR panel shows it: `contracts`: `Recipient names come in part from D&B Open Data (Dun & Bradstreet).`; `trials`: `Data from ClinicalTrials.gov; the titles, statuses, phases, conditions, dates and enrollment are shown as registered, and no text is changed.`; `fda`: `Data provided by the U.S. Food and Drug Administration.`; `lobbying`: `Senate Office of Public Records cannot vouch for the data or analyses derived from these data after the data have been retrieved from LDA.gov.`. ClinicalTrials.gov's processing date (`data_processed`),
openFDA's own notice (`notice`) and LDA.gov's access time (`read_at`) ride beside them. The N-PORT block carries its
source line (`source`). The member's answer prints these from the data; it never echoes an envelope note.

**Routing.** The six capabilities share one words-only group of their own, `stockStudies`, the 52nd of the 56 groups the
server keeps (`turn.MAX_GROUPS`; the cap is not changed). Its words are armed only while a capability is registered, so on a
dark server routing is byte-identical to the base.

**Each kind's notes.** Every note below is quoted verbatim from its adapter; a rail reads them back.

- **`stock.stats`** (source `uct-stock-stats`). `{symbol}'s statistics as UCT worked them out for the STAT panel, from the completed daily sessions its bar store holds ({first} to {through}, {sessions} sessions): volatility and range, beta and correlation against SPY and its sector fund, returns from one week to five years, its own declines of 20% or more, and how it fell against the S&P 500 in the index's corrections. Price returns (split-adjusted, not dividend-adjusted). A record of the past, not a forecast and not advice`; `` `as_of` is the close of the newest session in the statistics ({day}); it is never the time of the read. UCT worked them out at {at} (UCT's own time) from prices it already held ``; `{n} of the two benchmark comparisons are not stated, and that is not a beta of 0: {what}`; `the corrections summary is not stated: {why}. That is not the same as a stock that never fell with the index`; `{total} declines of 20% or more are held and the newest {shown} are returned: the list is cut from the OLD end`; `{n} sessions moved more than {pct}% in one close, which can be a split the history did not adjust: the figures that span them are marked to check`; `each correction's own row (its fall, back at its high first, the three months after) is not in this read, only the summary line: the STAT panel shows them`. The corrections block's own states: `computing`: `the market history was still working out the S&P 500's declines when UCT worked these out`; `not_held`: `the market history held no S&P 500 declines when UCT worked these out`; `unavailable`: `the market history could not be read when UCT worked these out`. A benchmark not stated: `not_held`: `no settled closes were held for the fund`; `unavailable`: `the fund's closes could not be read`; `fund`: `a fund has no sector fund of its own`; `no_sector`: `no sector is held for the stock`; `not_mapped`: `its sector has no sector fund in UCT's list`; `short`: `too few daily returns on days both traded`. `unavailable`: `{symbol}'s statistics are not held on this server yet, and this read never works them out. That is not the same as no statistics. Open STAT for {symbol} in UCT, then ask again`; `when UCT last worked out {symbol}'s statistics it held no settled daily prices for it, and this read never reads the store. That is not the same as no statistics. Open STAT for {symbol} in UCT, then ask again`; `the stock statistics read failed; nothing is stated. That is not the same as no statistics`.
- **Shared by the four price studies** (`stock_stats_read`). Stale: `UCT worked these out for the session of {session}; a newer session has closed since ({current}), and this read never works them out again. Open {code} for {symbol} in UCT, then ask again`; `the newest close UCT held for {symbol} ({through}) stops short of the session it was worked out for ({session}): the store had not caught up, or the stock did not trade`, the codes riding in `data.stale_for` (`earlier_session`, `closes_short`); and `the prices start before 2003-09-10: the bars before that date come from yfinance history (the market-data vendor's daily archive starts 2003-09-10)`.
- **`stock.volumeFootprint`** (source `uct-volume-footprint`). `{symbol}'s volume footprint as UCT worked it out for the VFP panel, from the completed daily sessions its bar store holds ({first} to {through}, {sessions} sessions; prices and volumes split-adjusted): its accumulation and distribution days over the last 25 and 50 sessions (a close at least 0.2% up or down on more volume than the session before) with the net, its up and down volume over 50 sessions, its pocket pivots of the last year, and its gaps of 3% or more with whether and when each filled. A record of the past, not a forecast and not advice`; `` `as_of` is the close of the newest session in the footprint ({day}); it is never the time of the read. UCT worked it out at {at} (UCT's own time) from bars it already held ``; `{total} pocket pivots are held for the last year and the newest {shown} are returned: the list is cut from the OLD end`; `{total} gaps of 3% or more are held and the newest {shown} are returned: the list is cut from the OLD end`; `{n} sessions in the widest window counted have no volume held (or the session before has none): they are counted as not judged, never as a quiet day`; `no session carries an earnings mark: {why}. That is not the same as no report`; `the biggest volume days of the year and the list of each accumulation and distribution day are not in this read: the VFP panel shows them`. The earnings block's own states: `not_held`: `UCT's earnings page has not been built for the stock on this server`; `no_dates`: `the earnings page UCT holds carries no report dates`. `unavailable`: `{symbol}'s volume footprint is not held on this server yet, and this read never works it out. That is not the same as no accumulation and no gaps. Open VFP for {symbol} in UCT, then ask again`; `when UCT last worked out {symbol}'s volume footprint it held no settled daily prices for it, and this read never reads the store. That is not the same as no footprint. Open VFP for {symbol} in UCT, then ask again`; `the volume footprint read failed; nothing is stated. That is not the same as no footprint`.
- **`stock.factorExposure`** (source `uct-factor-exposure`). `{symbol}'s factor exposure as UCT worked it out for the FCTX panel: a regression of its daily price returns on six fund spreads (the market, size, growth vs value, momentum, quality and low volatility) over its newest year of daily returns on days the stock and every fund traded ({start} to {end}, {returns} returns): each loading with its t-statistic, R-squared, the largest variance inflation factor, and the server's plain reading, built only from loadings whose t is above {bar}. How the stock traded over the window, not a forecast and not advice`; `` `as_of` is the close of the newest session in the regression ({day}); it is never the time of the read. UCT worked it out at {at} (UCT's own time) from prices it already held ``; `the newest window was not fitted ({why}), so no loading, R-squared or reading is stated, and that is not a loading of 0`; `the stock moves exactly with the factor funds (it is one of them, or built from them), so no t-statistic can be worked out and no reading is given`; `the largest variance inflation factor is {vif} ({factor}), above {limit}: the loadings are unstable (a small change in the data can move them a lot)`; `{n} factors are measured with their stated stand-in funds, since the first fund is not held with enough history: {what}`; `{n} factors are left out of the model, since neither of their funds is held with enough history: {what}. A factor left out has no loading, and that is not a loading of 0`; `the year-earlier window, the change in each loading since then and the funds' own checks are not in this read: the FCTX panel shows them`. A window not fitted: `short`: `fewer daily returns on days the stock and every fund traded than the fit needs`; `singular`: `the funds' returns are too close to one another to be told apart`. `unavailable`: `{symbol}'s factor exposure is not held on this server yet, and this read never works it out. That is not the same as no exposure. Open FCTX for {symbol} in UCT, then ask again`; `when UCT last worked out {symbol}'s factor exposure it held no settled daily prices for it, and this read never reads the store. That is not the same as no exposure. Open FCTX for {symbol} in UCT, then ask again`; `the factor exposure read failed; nothing is stated. That is not the same as no exposure`.
- **`stock.setupHistory`** (source `uct-setup-history`). `{symbol}'s setup signals as UCT worked them out for the SETH panel: every time each of the library's {setups} setups fired on it over the completed daily sessions its bar store holds ({first} to {through}), one signal per run, each with its return 5, 20 and 60 sessions on (from the next session's open) and the S&P 500's market phase that day; beside each setup and phase, how that setup did across UCT's stock universe in the same phase, from the weekly study. A record of the past, not a forecast and not advice`; `` `as_of` is the close of the newest session in the history ({day}); it is never the time of the read. UCT worked it out at {at} (UCT's own time) from prices it already held ``; `the market phase is assigned with hindsight (a decline is known to be a correction only after the fact): read a phase as how a setup did in what turned out to be a correction, never as something a trader could have known on the day`; `no setup of the library fired on {symbol} in the prices UCT holds ({first} to {through})`; `{total} signals are held for {symbol} and the newest {rows} of each setup are returned ({shown} in all): each setup's list is cut from the OLD end`; `the server keeps only the newest {kept} of {symbol}'s {total} signals, so the oldest are not in what UCT holds`; `the S&P 500's declines were not held when UCT worked this out, so no signal carries a market phase and each universe line is the setup's line over all days`; `the universe lines are not stated: {why}. That is not the same as a setup that never worked`; `{n} setups could not be run on {symbol}'s bars: {what}`. The universe block's states: `not_held`: `the weekly study of every setup across UCT's stock universe is not held on this server yet`; `computing`: `the weekly study of every setup was still being worked out`; `waiting`: `the weekly study of every setup had not been worked out yet`; `unavailable`: `the weekly study held could not be read as this library's`. `unavailable`: `{symbol}'s setup signals are not held on this server yet, and this read never works them out. That is not the same as no signal. Open SETH for {symbol} in UCT, then ask again`; `when UCT last worked out {symbol}'s setup signals it held no settled daily prices for it, and this read never reads the store. That is not the same as no signal. Open SETH for {symbol} in UCT, then ask again`; `the setup history read failed; nothing is stated. That is not the same as no signal`.
- **`company.publicRecords`** (source `public-records`). `{symbol}'s public records as UCT holds them for the PUBR panel, four government sources, each its own section with its own state, source and read time: federal contract obligations to the recipients whose names match the company's (USAspending.gov), the clinical trials it leads (ClinicalTrials.gov), its FDA drug approvals (openFDA, Drugs@FDA) and its lobbying reports (LDA.gov). A record counts only when its name matches one of the company's names. Records, not advice`; `` `as_of` is null: each section carries the time UCT read it (`read_at`), and an agency's own processing date where it gives one; never the time of this read ``; `{n} of the four sections are not held on this server yet ({what}), and this read never asks an agency. That is not the same as no record`; `{n} sections found no record matching the company's names ({what}): no record matched, which is not the same as no record existing (a subsidiary that reports under its own name is not matched)`; `{n} sections had no company name to search with ({what}), so nothing was searched`; `the company's names are not held yet, so the sections cannot say which names they searched with`; `{what}: {total} matched and the first {shown} are returned: the list is cut from the {end} end`; `UCT's last look at {what} did not go well: what is held is the answer it read before, and this read never looks again`. The sections, in words: `contracts`: `federal contracts`; `trials`: `clinical trials`; `fda`: `FDA approvals`; `lobbying`: `lobbying`. Each list and the end it is cut from: `contracts`: `contract awards to the matched names, newest first` (the OLD end); `trials`: `active trials it leads, by the soonest primary completion` (the FAR end); `fda`: `FDA approvals and new uses, newest first` (the OLD end). A read is `partial` while one to three sections are not held. `unavailable`: `{symbol}'s public records are not held on this server yet, and this read never asks an agency. That is not the same as no records. Open PUBR for {symbol} in UCT, then ask again`; `the public records read failed; nothing is stated. That is not the same as no records`.
- **`ownership.funds`** (source `sec-form-nport`). `the registered funds (mutual funds and ETFs) holding {symbol}, as UCT holds them from the SEC's quarterly Form N-PORT data sets ({quarter} data set): how many funds hold it, the changes since each fund's previous report (added, cut, unchanged, new, sold out), the largest holders by value with each one's change, and how much of the data set was matched to a ticker. A report says what a fund held on its period's last day, not what it did or when. Filings, not advice`; `` `as_of` is the end of the newest fund report period in the block ({day}); it is never the time of the read. Each fund reports for its own period ({start} to {end}), a fund files within 60 days after its quarter ends and the SEC posts these data sets once a quarter, so the newest report can be months old. UCT built the index at {built} (UCT's own time) ``; `` no fund in the block carries a report period, so `as_of` is null. UCT built the index at {built} (UCT's own time) ``; `no fund holding in the newest N-PORT data set ({quarter}) could be matched to {symbol}. That is not the same as no fund holding it`; `no fund's current report holds {symbol}; the funds returned held it at their previous report`; `the data set before it could not be read, so no change is stated: that is not a change of 0`; `{n} funds' changes are not comparable (a stock split may fall between their two reports and could not be checked): they are counted neither as added nor as cut`; `{total} funds hold it and the top {shown} by value are returned: the list is cut from the SMALL end`; `{total} funds sold out of it and the top {shown} by their previous value are returned: the list is cut from the SMALL end`; `across the data set, {pct}% of the funds' common-stock holdings by value were matched to a ticker; a fund whose holding could not be matched is not counted`; `UCT's last attempt to read a newer data set did not finish ({why}): the index held is the last one read, and this read never downloads`. A run that did not finish: `stopped`: `the SEC's website refused it, or it ran out of time`; `failed`: `the read failed`; `shape`: `the data set was not in the layout it reads`; `low_disk`: `the server had too little disk space`. `unavailable`: `the SEC's Form N-PORT data sets have not been read on this server yet, so the funds holding {symbol} are not stated. That is not the same as no fund holding it. This read never downloads them; the server reads them on its own schedule`; `the fund holdings index could not be read; nothing is stated. That is a gap in the read, not a finding`; `the fund holdings read failed; nothing is stated. That is not the same as no fund holding it`.

**Rules all six share.** A malformed request (no ticker, an out-of-range or non-integer `rows`) is refused before any read
and spends no budget. A missing number is null, never 0: a statistic the history is too short for keeps the service's
`short` block, a benchmark not stated keeps its state, a ratio with a missing volume, a loading of a factor left out, a
return the history cannot reach yet, a figure an agency or a filing did not give. Nothing held is never "none": a section
whose search matched none of the company's names says "no record matched", and a stock no fund holding could be matched to
is never "no fund holds it". What each kind leaves out is named in `data.left_out` where it has one and said in a note,
with the panel that shows it.

- Data fields: `stock.stats`: `symbol`, `session`, `data_through`, `first`, `sessions`, `read_at`, `source`, `basis`,
  `suspect_jump_pct`, `suspect_jumps`, `volatility`, `beta`, `returns`, `drawdowns`, `corrections`, `stale_for`, `left_out`.
  `stock.volumeFootprint`: `symbol`, `session`, `data_through`, `first`, `sessions`, `read_at`, `source`, `basis`,
  `suspect_jump_pct`, `earnings`, `accumulation`, `pivots` (with `last`), `gaps`, `stale_for`, `left_out`.
  `stock.factorExposure`: `symbol`, `session`, `data_through`, `read_from`, `sessions_read`, `read_at`, `source`, `basis`,
  `suspect_jump_pct`, `method`, `factors`, `common_returns`, `common_from`, `common_to`, `now`, `reading`, `stale_for`,
  `left_out`. `stock.setupHistory`: `symbol`, `session`, `data_through`, `first`, `sessions`, `read_at`, `source`,
  `horizons`, `phases`, `total`, `shown`, `signals`, `per_setup`, `library`, `setups`, `universe`, `one_signal_per_run`,
  `fill`, `stale_for`. `company.publicRecords`: `symbol`, `as_of` (null), `company`, `contracts`, `trials`, `fda`,
  `lobbying`. `ownership.funds`: `symbol`, `state`, `source`, `data_set`, `coverage`, `summary`, `holders`,
  `holders_total`, `holders_limit`, `sold_out`, `sold_out_total`, `check`. No CUSIP is stored or returned.

### 4.20 Terminal data wave 11: `groups.rank`, `groups.crowding`, `earnings.seasonBySector`, `estimates.revisionBreadth`, `options.ivRankLeaders`, `ipo.lockups`, `cot.byTrader` (v1.17, terminal-data)

Seven more thin kinds, the Agent half of the 2026-11-22 group and market data: GRPS RANK (every sector's or industry's
weekly rank) and GRPS CROWDING (positioning by group), ERNSC (an earnings season by sector), EEHSC (estimate revisions by
sector), OSCR RICH and OSCR CHEAP (the highest and lowest IV rank across UCT's own options log), IPO LOCKUP (estimated
lockup expiries), and the COT panel's "By trader type" view (the CFTC's finer reports). Each is an adapter over the service
its member route already reads (`api/services/uct_agent/marketdata/group_rank_read.py`, `group_crowding_read.py`,
`sector_earnings_read.py`, `revision_breadth_read.py`, `iv_rank_leaders_read.py`, `ipo_lockups_read.py`,
`cot_finer_read.py`; registered in `kinds.py` with `owner="terminal-data"`). No new connection, job, database, write or
route (§6), and no new environment variable. Each keeps its route's own field names, so the panel's own model reads the
data and the member's answer says what the panel says.

**Status: dark, not armed.** Like every kind, each is served only when it is listed in `UCT_AGENT_DATA_KINDS` (with
`UCT_AGENT_DATA=1`). All seven are model-isolated, so each also needs the master switch `UCT_AGENT_ISOLATED=1` and its own
entry in `UCT_AGENT_ISOLATED_KINDS` (§4.4, ADR-005); until then it is refused for every purpose, and once armed it is
served for purpose `answer` only. This section describes what the code does when a kind is switched on. It does not switch
anything on. As written (2026-11-23), none of the seven is in production's list.

| Kind | Canonical service (member route) | Params | Declared freshness | `as_of` | `provider_calls` | Model-isolated |
|---|---|---|---|---|---|---|
| `groups.rank` | the group figures `api/services/group_stats.py` holds, read through the route's own read-only `group_stats.get_group_stats` (`GET /api/research/group-stats?kind=…[&name=…]`) | `{kind, name, rows}` | periodic · every read historical | the regular-session close of the newest session the evening build read (never the time of the read) | 0 | **yes** |
| `groups.crowding` | the positioning held with the group figures (`api/services/group_positioning.py`), read through the route's own read-only `group_stats.get_group_positioning` (`…&part=positioning`) | `{kind, name, rows}` | periodic · every read periodic | null: each part carries its own date | 0 | **yes** |
| `earnings.seasonBySector` | the season table `api/services/sector_earnings.py` holds, read through `sector_earnings_held.held_season` (`GET /api/research/sector-earnings?season=…`) | `{season}` | periodic · every read periodic | the day of the newest earnings copy UCT held, as the start of that New York day | 0 | **yes** |
| `estimates.revisionBreadth` | the breadth `api/services/estimate_revisions.py` holds, read through `estimate_revisions_held.held_breadth` (`GET /api/research/estimate-history?metric=…&window=…`, behind ESTIMATE_HISTORY_ENABLED) | `{metric, window}` | periodic · every read periodic | the day of the store's newest snapshot, as the start of that New York day | 0 | **yes** |
| `options.ivRankLeaders` | the list `api/services/research/iv_rank_leaders.py` holds, read through the route's own read-only `iv_rank_leaders.get_leaders` (`GET /api/options-screener/iv-rank`, behind OPTIONS_SCREENER_ENABLED) | `{side, rows}` | periodic · every read historical | the regular-session close of the session the list read | 0 | **yes** |
| `ipo.lockups` | the list `api/services/ipo_lockups.py` holds, read through `ipo_lockups_held.held_lockups` (`GET /api/scans/ipo-lockups`) | `{rows}` | periodic · every read periodic | the listings scan's own time | 0 | **yes** |
| `cot.byTrader` | the CFTC's finer reports as `api/services/cot_finer.py` stores them, read through the routes' own read-only `cot_finer.market_answer` and `cot_finer.board_answer` (`GET /api/cot/{symbol}/breakdown`, `GET /api/cot/breakdown`) | `{market}` | periodic · every read periodic | the report's Tuesday, as the start of that New York day (the board: the oldest newest week across its markets) | 0 | **yes** |

**No read of this section starts a build or a request.** (§5: a turn has 20 provider requests and a member waiting.)
Three of the member routes answer through a hold that starts its one background build when the held answer is due, and
with nothing held waits on it; the other four routes' reads are already read-only. Each adapter reads a read-only path and
answers `unavailable`, with the reason, when nothing is held:

| Kind | What the member path can start | What the adapter reads instead |
|---|---|---|
| `groups.rank`, `groups.crowding` | nothing on the request: the group figures and the positioning are built by ONE evening build the scheduler starts (`group_stats.scheduled_refresh`, `refresh_if_due`), which reads every stock's closes and the three positioning stores | `group_stats.get_group_stats` and `group_stats.get_group_positioning` (the route's own reads, which never build and never read a store) |
| `earnings.seasonBySector` | `sector_earnings.get_season` answers through `held_build.HeldBuild.get()`, which starts the one read of every stock's held earnings copy when due | `sector_earnings_held.held_season` (added with this version, a new file beside the service): the route's own table shaped over `sector_earnings.peek()`, else nothing |
| `estimates.revisionBreadth` | `estimate_revisions.get_breadth` answers through `HeldBuild.get()`, which starts the one read of the estimate snapshot store when due | `estimate_revisions_held.held_breadth` (added with this version): the route's own answer shaped over `estimate_revisions.peek()`, else nothing |
| `options.ivRankLeaders` | nothing on the request: the list is built by the evening job (`iv_rank_leaders.run_scheduled`, and `catch_up` after a missed evening) | `iv_rank_leaders.get_leaders` (the route's own read, which never reads the log) |
| `ipo.lockups` | `ipo_lockups.get_lockups` answers through `HeldBuild.get()`, which starts the one build (the listings scan's held answer, the name cache, each row's closes) when due | `ipo_lockups_held.held_lockups` (added with this version): the service's hold through `peek()`, else nothing |
| `cot.byTrader` | nothing on the request: the files are read from the CFTC by the scheduled run (`cot_finer.run_scheduled`, twice a day) | `cot_finer.market_answer` and `cot_finer.board_answer` (the routes' own indexed reads, which never download, build or start a run) |

THE ROUTES' SWITCHES ARE RESPECTED EXACTLY: with ESTIMATE_HISTORY_ENABLED off, `estimates.revisionBreadth` is `unavailable`
(the EEHSC route answers 404), and with OPTIONS_SCREENER_ENABLED off, `options.ivRankLeaders` is `unavailable` (the OSCR
route answers 404); neither is ever an empty table.

Rails hold each adapter to what its member path serves and count builds, threads, requests and cache writes: with nothing
held the adapter starts none, and the member path's own reader (or the scheduler's entry) is shown to start the work in the
same state. A further rail replaces GRPS's build, job starter, refresh and price reads, the three positioning stores'
readers, ERNSC's and EEHSC's builds, copy read and route reads, the estimate store's writers, the IV list's build,
scheduler entries and log store, IPO LOCKUP's build, route read, close read and the listings scan, the COT reader's run,
download, store and plan and the legacy COT reader's refreshes, the shared holds' `get`, `_start` and `_run`, and the
cache's writer with functions that fail, and runs every read of this section held and not held, with every held answer
due again. Each new reader is pinned against its service: a rail drives the service itself over invented reads and checks
the reader gives the route's own answer, season by season and window by window.

**Isolation (ADR-005), the builder's default, from the licensing register.** No row of the register
(`docs/terminal-research/09-security-licensing-cost/licensing-register.md`) clears any of these seven for a model provider:

- `groups.rank` is worked out from UCT's daily bar store, which holds the market-data vendor's end-of-day history (row
  T-04, member display of daily history, class **R**; row T-09, its storage, class **R**) and, before 2003-09-10, yfinance
  history (row T-71, class **X**); row T-14 (AI processing of the vendor's numbers, class **R**) names none of it. The rule
  the price studies of §4.19 and `seasonality.stock` (§4.15) follow, copied.
- `groups.crowding`: the short interest is FINRA's through the vendor (row T-93, class **LA**, member display), its percent
  of float divides by the screener's float (row T-48); the insider purchases come from the SEC's Form 4 filings (row T-99)
  and the fund holdings from the SEC's N-PORT data sets (row T-104), and both rows say "Nothing else reads it yet (no AI
  lane, no export, no external publication)". The rule `short.list` and `ownership.funds` follow.
- `earnings.seasonBySector`: the actual and consensus figures are the earnings vendors' (row T-36, FMP's earnings history
  for member display, class **R**; row T-44, FMP's numbers into a model, "No AI clause"; row T-53, Finnhub's derived
  earnings rollups, class **R**; row T-54, Finnhub's fields into a model, class **R**), and the reactions are UCT's
  arithmetic on the bar store (rows T-04, T-09 and T-14). The rule `earnings.reactions` and `earnings.season` follow.
- `estimates.revisionBreadth`: the consensus estimates are FMP's (row T-34, member display, class **R**; row T-44, "No AI
  clause").
- `options.ivRankLeaders`: the implied volatilities come from the vendor's options chain UCT logs (row T-28, class **R**;
  row T-14). The rule `options.ivHistory` follows.
- `ipo.lockups`: the listings and their dates come from the vendor's reference data and the bar store (rows T-04, T-09 and
  T-14), the same set the IPO calendar's listings use (row T-52; its AI row, T-54, class **R**). The rule `calendar.ipos`
  follows.
- `cot.byTrader`: the CFTC's reports are public domain (row T-105, class **A**, "As T-82"), and the row names its use and
  no other: "Nothing else reads it yet (no AI lane, no export, no external publication)". The legacy report's AI lane (row
  T-82) runs behind its own grounding gate, which this kind is not, so the narrower rule is taken, as for `ownership.funds`
  (row T-104).

So all seven are isolated and every capability is local-only (`turn.LOCAL_ONLY_ACTIONS`): `stock.groupRank`,
`stock.groupOwnership`, `stock.sectorEarnings`, `stock.estimatesBreadth`, `stock.ivRankLeaders`, `stock.ipoUnlock`,
`stock.positionTypes`. Where a source has an open question, the narrower rule is kept: the member sees what the panel
shows, bounded, and a model sees nothing. The COT credit the panel carries travels as data (`credit`): `Source: CFTC Commitments of Traders (Traders in Financial Futures / Disaggregated), as of the Tuesday it covers, published the following Friday.`.

**Routing.** The seven capabilities share one words-only group of their own, `marketTables`, the 53rd of the 56 groups the
server keeps (`turn.MAX_GROUPS`; the cap is not changed). Its words are armed only while a capability is registered, so on a
dark server routing is byte-identical to the base.

**Each kind's notes.** Every note below is quoted verbatim from its adapter; a rail reads them back.

- **`groups.rank`** (source `uct-group-rank`). `every {kind}'s weekly rank as UCT worked it out for GRPS, from the stored daily closes of its stocks ({stocks} stocks in {groups} groups, the map GRPS groups by): its place by the median 6-month and 3-month price change of its stocks now, 4, 13 and 52 weekly points back with the places moved since, and its best and worst week of the year. A record of the past, not a forecast and not advice`; `` `as_of` is the close of the newest session the evening build read ({day}); it is never the time of the read. UCT worked it out at {at} (UCT's own time) from closes it already held ``; `` `as_of` is null: the evening build held found no session in the closes, so the figures carry no date ``; `UCT worked these out for the evening of {built_for}; a newer evening has begun since ({current}), and this read never works them out again. The server's next evening build adds it`; `{total} {many} are held and the first {shown} by their 6-month rank now are returned: the list is cut from the BOTTOM of the ranking (groups with no rank now come last)`; `a group needs at least {min} stocks with a change for a place: {n} {many} have fewer now, so they have no rank (never a rank of 0)`; `the movers are worked out over all {total} {many}: only a group ranked at both ends of a window counts, equal moves go by name, at most {limit} each way`; `the weekly rank is not stated: {why}. That is not the same as no rank`; `the evening build's closes stopped short of that evening, so the newest week may be missing; the server tries again`; `no {kind} named {name!r} is in the held table of {total} {many} (names are matched as GRPS matches them: case, spacing and punctuation do not count)`; `each group's weekly line, its fundamentals and its breadth are not in this read: the GRPS panel shows them`; `the group figures are not held on this server yet: {why}. This read never works them out. That is not the same as no rank`; `the group rank read failed; nothing is stated. That is not the same as no rank`.
- **`groups.crowding`** (source `uct-group-positioning`). `every {kind}'s positioning as UCT worked it out for GRPS CROWDING, from three stores this server holds, each read once by the evening build: FINRA's short interest report, the open-market purchases in the SEC Form 4 filings UCT reads, and the SEC's Form N-PORT fund holdings, rolled up by the map GRPS groups by ({groups} groups). Filings and reports, not advice`; `` `as_of` is null: each part carries its own date (short interest its FINRA settlement date, insider buying its filing window, funds their report periods). UCT worked it out at {at} (UCT's own time), and this read never works it out again ``; `UCT worked these out at the evening build for {built_for}; a newer evening has begun since ({current}), and this read never works them out again`; `{part} is not stated: {why}. That is not the same as none`; `insider buying is open-market purchases only, filed {start} to {end}: the server keeps no insider sales, so there is no sales total or net`; `the groups are ordered by the median percent of float, highest first (the builder's default order; a group with fewer than {min} members in the report has no figure and comes after them, by name)`; `{total} {many} are held and the first {shown} are returned: the list is cut from the LOW end`; `{total} members are held and the {shown} most shorted are returned: the list is cut from the least shorted end (a member with no percent of float last)`; `no {kind} named {name!r} is in the held table of {total} {many} (names are matched as GRPS matches them: case, spacing and punctuation do not count)`; `institutions (13F) are not in this read: the server keeps no store of the whole market's 13F holdings to roll up. Each group's rank, fundamentals and breadth are not in it either: the GRPS panel shows them`; `group positioning is not held on this server yet: {why}. This read never works it out. That is not the same as no crowding`; `the group positioning read failed; nothing is stated. That is not the same as no crowding`.
- **`earnings.seasonBySector`** (source `uct-sector-earnings`). `{label} earnings season ({which}) by sector as UCT added it up for ERNSC, from the earnings results it holds for {held} of the {universe} stocks in its universe, not every company that reports: per sector the EPS and revenue beat, in line and miss shares (a surprise within {in_line}% either way is in line), the median surprise and the median move from the close before the report to the close after. A record of results, not a forecast and not advice`; `` `as_of` is the day of the newest earnings copy UCT held ({newest}; the oldest is {oldest}); it is never the time of the read. UCT added them up at {at} (UCT's own time) ``; `` `as_of` is null: no earnings copy UCT held carries a read day, so the figures carry no date ``; `{n} of the held copies are more than {days} days old, so a recent report may not be counted yet`; `UCT added these up on {built}; a newer day has begun ({today}), so the counts still to report and past due may have moved, and this read never adds them up again`; `a share or a median needs {min} reporters: a sector with fewer gives its counts and no figure (never 0)`; `no stock UCT holds results for has reported in this season yet, and none is due: every count is 0`; `{n} of the held stocks have no sector on file: they are counted on their own row`; `{total} sectors are held and the first {shown} are returned: the list is cut from the end of the server's order`; `each sector's reporters, the stocks still to report and the ones whose result has not reached UCT are not in this read: the ERNSC panel shows them`; `earnings season by sector is not held on this server yet, and this read never adds it up. That is not the same as no reports. Open ERNSC in UCT, then ask again`; `the earnings season read failed; nothing is stated. That is not the same as no reports`.
- **`estimates.revisionBreadth`** (source `uct-estimate-revisions`). `estimate revisions by sector as UCT added them up for EEHSC, among the {n} stocks it tracks ({origins}), not the whole market: for each stock the next fiscal quarter's consensus {metric} estimate {window} days apart, a change of more than {tol}% either way a raise or a cut, anything within it held. Analysts' estimates, not a forecast of UCT's and not advice`; `` `as_of` is the day of the store's newest snapshot ({day}); it is never the time of the read. UCT added them up at {at} (UCT's own time) ``; `` `as_of` is null: the store holds no snapshot yet, so nothing has a date and nothing is counted ``; `a net figure needs {min} counted stocks: a sector with fewer gives its counts and no net (never 0)`; `{collecting} still collecting (snapshots too new to span the window), {gap} with a gap in their snapshots, {nc} with no comparable estimate: none of them is counted, and none is dropped`; `no tracked stock's snapshots span the {window}-day window yet (they began {began}), so nothing is counted`; `{n} of the tracked stocks have no sector on file: they are counted on their own row`; `{total} sectors are held and the first {shown} are returned: the list is cut from the end of the server's order`; `each sector's list of every stock with its state is not in this read, only its three largest raises and cuts: the EEHSC panel shows them`; `the estimate history is switched off on this server (its route answers nothing), so revision breadth is not read. That is not the same as no revisions`; `estimate revisions by sector are not held on this server yet, and this read never adds them up. That is not the same as no revisions. Open EEHSC in UCT, then ask again`; `the estimate revisions read failed; nothing is stated. That is not the same as no revisions`.
- **`options.ivRankLeaders`** (source `uct-options-log`). `the IV rank list UCT built from its own options log for OSCR RICH and OSCR CHEAP: each symbol's latest at-the-money implied volatility placed between its lowest and highest over its own logged sessions (up to {window}), from 0 to 100, with the IV percentile. A symbol needs {min} logged sessions to be ranked. An end-of-day snapshot and a record of the past, not a forecast and not advice`; `` `as_of` is the close of the session the list read ({day}, an end-of-day snapshot); it is never the time of the read. UCT built it at {at} (UCT's own time) from the log it already held ``; `` `as_of` is null: the held list names no session, so it carries no date ``; `{ranked} symbols are ranked; left out and counted: {below} with fewer than {min} logged sessions, {flat} whose ATM IV never moved (no rank), {stale} not in the latest session`; `{ranked} symbols are ranked and the {shown} {side} are returned: the list is cut from the middle of the ranking`; `{n} trading sessions since the log began were not logged (the newest {shown} are returned); a missed day is a gap, never filled in`; `the list read the session of {session}; the last scheduled build should have read {target}, and this read never builds it again`; `the last build could not read the options log, so this is the list before it`; `the option screener is switched off on this server (its routes answer nothing), so the IV rank list is not read. That is not the same as no rich or cheap options`; `the IV rank list is built each evening from UCT's own options log, and no evening has built it on this server yet{building}. This read never builds it. That is not the same as no rich or cheap options`; `the options log held no session at the last evening build, so no symbol is ranked. That is not the same as no rich or cheap options`; `the IV rank list read failed; nothing is stated. That is not the same as no rich or cheap options`.
- **`ipo.lockups`** (source `uct-ipo-lockups`). `the IPO lockups UCT worked out for IPO LOCKUP from the companies its last-year listings scan holds ({listings} listed, {dated} with a listing date): each one's lockup expiry ESTIMATED as its listing date plus {days} calendar days, rolled to the next trading session, between {start} and {end}. The prospectus sets the actual date: every row is an estimate, never a stated date, and not advice`; `` `as_of` is the time of the listings scan the list was worked out from ({at}); it is never the time of the read. The days to go are counted from {today} ``; `` `as_of` is the start of {today}, the day the list was worked out: the listings scan's own time was not given ``; `UCT worked this list out on {today}; a newer day has begun in New York ({now}), so each row's days to go is {late} days behind, and this read never works it out again`; `no estimated lockup expiry falls between {start} and {end}`; `{total} estimated expiries fall in the window and the {shown} soonest are returned: the list is cut from the FAR end`; `{n} listed stocks have no listing date, so no expiry can be estimated for them: they are left out`; `{n} rows have no change since listing (the site's closes cannot give one), said by its reason, never a change of 0`; `the last-year listings scan had not answered since the server started when the list was last worked out, so no lockup is stated. That is not the same as no lockups`; `the IPO lockup list is not held on this server yet, and this read never works it out. That is not the same as no lockups. Open IPO LOCKUP in UCT, then ask again`; `the IPO lockup read failed; nothing is stated. That is not the same as no lockups`.
- **`cot.byTrader`** (source `cftc-cot-finer`). `{what} by trader type as UCT stores it from the CFTC's {report} report (futures only): each class's long, short and spreading contracts and trader counts, and open interest, for the newest {weeks} weeks. Public data, not advice`; `every listed market's watched class (leveraged funds in Traders in Financial Futures, managed money in Disaggregated) as UCT stores it from the CFTC (futures only), its newest two weeks. Public data, not advice`; `` `as_of` is the report date, the Tuesday the positions describe ({day}); the CFTC published it the following Friday. It is never the time of the read ``; `` {n} of the {total} markets have an older newest week than {newest}: `as_of` is the oldest newest week, so the board never claims a newer week than every market has ``; `the newest stored report is {got}; the report expected by now is {want}, so this is not the latest week`; `only one week is stored for this market, so no week's change is stated (never a change of 0)`; `{n} listed markets have no record in the finer reports UCT holds: {codes}`; `the server's last look at the CFTC did not go well ({state}); these are the weeks it stored before`; `the 3-year range of each class is not in this read: the COT panel shows it`; `UCT's COT data does not cover {word!r} (the markets the legacy report keys), and this read never guesses one. That is not the same as no positioning`; `positioning by trader type is not stated: {why}. This read never downloads. That is not the same as no positions`; `the positioning by trader type read failed; nothing is stated. That is not the same as no positions`.
- **The words a note is filled with.** `groups.rank`'s rank part: `pending`: `the figures held were worked out before the weekly rank was added; it appears after the next evening build`; `unavailable`: `no stored closes could be read at the last evening build, so there is no weekly rank`; nothing held (shared by the two
  group kinds): `not_built`: `the group figures are worked out once each evening after the close, and the first one has not run on this server yet`; `computing`: `the first evening build of the group figures is running now`. `groups.crowding`'s parts: `not_held`: `the server had not read that store yet at the last evening build`; `not_built`: `the server had not built that index yet at the last evening build`; `unavailable`: `the source did not answer for it at the last evening build`; `failed`: `that store could not be read at the last evening build`; `pending`: `the figures held were worked out before positioning was added; it appears after the next evening build`. `earnings.seasonBySector`'s
  seasons: `current`: `the season that holds today`; `previous`: `the season before it`; `year_ago`: `the same season a year earlier`. `cot.byTrader`'s store: `not_built`: `no file has been read from the CFTC on this server yet`; `no_record`: `the CFTC files UCT holds carry no record of this market in the finer reports`; `unavailable`: `the stored reports could not be read`.

**Rules all seven share.** A malformed request (a kind, season, estimate, window or side the route does not take, an
out-of-range or non-integer `rows`, an over-long name or market word) is refused before any read and spends no budget. A
missing number is null, never 0: a group or a sector resting on fewer than five stocks has its counts and no figure, a
group with no rank now has no place, a change since listing the closes cannot give keeps the service's reason, a side the
CFTC printed none for is null. Nothing held is never "none". A list that is cut says so and from which end (the bottom of
a ranking, the low end of a crowding order, the middle of the IV ranking, the far end of the lockup window). Every lockup
row is marked estimated. What each kind leaves out is named in `data.left_out` where it has one and said in a note, with
the panel that shows it. The order of the crowding table (the median percent of float, highest first) and every bound
(`rows` defaults and maxima, five movers each way, at most 30 sectors) are the builder's default, not an owner ruling.

- Data fields: `groups.rank`: `kind`, `session`, `built_for`, `built_at`, `rank`, `universe`, `stale_for`, `left_out`, and
  for the table `groups`, `groups_total`, `ranked_now`, `movers`, or for one group `name`, `found`, `peers`, `members`,
  `group_rank`. `groups.crowding`: `kind`, `built_for`, `built_at`, `session`, `parts`, `min_members`, `top_n`,
  `institutions`, `stale_for`, `left_out`, and `groups`, `groups_total`, `with_figure`, or `name`, `found`, `peers`,
  `members`, `positioning`, `member_rows`, `member_total`. `earnings.seasonBySector`: `season`, `seasons`, `today`,
  `built_at`, `coverage`, `total`, `sectors`, `count`, `in_line_pct`, `in_line_abs`, `min_reporters`, `season_rule`,
  `stale_for`, `left_out`. `estimates.revisionBreadth`: `metric`, `window`, `asof`, `covers_from`, `built_at`, `tracked`,
  `tolerance_pct`, `slack_days`, `min_counted`, `top_n`, `total`, `sectors`, `count`, `left_out`.
  `options.ivRankLeaders`: `side`, `session`, `built_at`, `data_basis`, `logging_began`, `sessions_logged`,
  `rankable_sessions`, `legacy_sessions`, `unread_sessions`, `missing_sessions`, `missing_total`, `counts`, `high`, `low`,
  `rank_min_sessions`, `rank_window`, `max_per_side`, `next_run`, `last_run`, `stale_for`. `ipo.lockups`: `today`,
  `window`, `lockup_days`, `basis`, `basis_words`, `built_at`, `listings_as_of`, `counts`, `rows`, `stale_for`.
  `cot.byTrader`: one market `market`, `name`, `report`, `report_name`, `watch`, `classes`, `rows`, `records`,
  `concentration`, `credit`, `stale_for`, `left_out`; the board `market` (null), `watch`, `markets`, `no_record`, `newest`,
  `credit`, `stale_for`, `left_out`.

### 4.21 Terminal data wave 12: `estimates.history`, `analyst.ratings`, `company.segments`, `stock.failsToDeliver`, `company.deals`, and the first capability over `ratings` (v1.18, terminal-data)

Five more thin kinds, the Agent half of the single-stock panels a 2026-11-23 audit listed as unanswered: EEH (one stock's
estimate history), ANR (its analyst ratings and price targets), SEG (its revenue by segment and region), FTD (its SEC fails
to deliver) and one stock's MNA and IDXC (its deals and its index additions and removals); and RTG, whose server kind
`ratings` (§4.4) existed with no capability: `stock.uctRating` now reads it, and its adapter now reads only the held
rating (§4.4, v1.18). Each new kind is an adapter over the service its member route already reads
(`api/services/uct_agent/marketdata/estimate_history_read.py`, `analyst_ratings_read.py`, `revenue_segments_read.py`,
`ftd_read.py`, `company_deals_read.py`; registered in `kinds.py` with `owner="terminal-data"`). No new connection, job,
database, write or route (§6), and no new environment variable. Each keeps its route's own field names.

PEER gets no kind: its route (`GET /api/groups/peers`, `groups.resolve_peers`) works the peers out on the request (the
taxonomy ranked by today's moves from a vendor snapshot, an industry fallback, a model's fallback for a stock outside the
taxonomy) and holds no answer to read, so a held-only kind cannot be built without a new peer computation or a vendor
call; it is left out.

**Status: dark, not armed.** Like every kind, each is served only when it is listed in `UCT_AGENT_DATA_KINDS` (with
`UCT_AGENT_DATA=1`). All five are model-isolated, as `ratings` already is, so each also needs the master switch
`UCT_AGENT_ISOLATED=1` and its own entry in `UCT_AGENT_ISOLATED_KINDS` (§4.4, ADR-005); until then it is refused for every
purpose, and once armed it is served for purpose `answer` only. The six capabilities (`stock.uctRating`,
`stock.estimatesHistory`, `stock.consensusRating`, `stock.revenueSplit`, `stock.failsToDeliver`, `stock.companyDeals`) are
local-only (`turn.LOCAL_ONLY_ACTIONS`) and registered only while the server serves their kinds. This section describes
what the code does when a kind is switched on. It does not switch anything on. As written (2026-11-24), none of the six
is in production's list.

| Kind | Canonical service (member route) | Params | Declared freshness | `as_of` | `provider_calls` | Model-isolated |
|---|---|---|---|---|---|---|
| `estimates.history` | the snapshot store `api/services/estimate_history.py` keeps, read through `estimate_history_held.held_history` (`GET /api/research/estimate-history/{sym}`, behind ESTIMATE_HISTORY_ENABLED) | `{symbol}` | periodic · every read periodic | the day of the stock's newest snapshot, as the start of that New York day | 0 | **yes** |
| `analyst.ratings` | the record `api/services/analyst_grades.py` holds in the shared cache, read through `analyst_ratings_held.held_ratings` (`GET /api/research/analyst-ratings/{sym}`) | `{symbol, rows}` | periodic · every read periodic | the newest observation time the record's legs carry | 0 | **yes** |
| `company.segments` | the answers `api/services/revenue_segments.py` holds per stock and period, read through `revenue_segments_held.held_segments` (`GET /api/research/revenue-segments/{ticker}?period=…`) | `{symbol, rows}` | periodic · every read periodic | the newest fiscal period end among the splits returned | 0 | **yes** |
| `stock.failsToDeliver` | the store `api/services/ftd_dataset.py` ingests, read through `ftd_dataset_held.held_series` (`GET /api/research/ftd/{sym}`, behind FTD_DATASET_ENABLED) | `{symbol, rows}` | periodic · every read historical | the newest settlement date reported for the stock (none reported: the newest date the files cover) | 0 | **yes** |
| `company.deals` | the holds of `api/services/mergers.py` and `api/services/index_changes.py`, read through `company_deals_held.held_mergers` and `company_deals_held.held_index_changes` (`GET /api/research/mergers?sym=`, `GET /api/research/index-changes?sym=`) | `{symbol, rows}` | periodic · every read periodic | null: each part carries its own read time | 0 | **yes** |

Sources (`source`): `uct-estimate-history`, `uct-analyst-ratings`, `uct-revenue-segments`, `sec-fails-to-deliver`, `uct-company-deals`.

**No read of this section starts a build or a request.** (§5: a turn has 20 provider requests and a member waiting.)
Every member route here can cause work on the request; each adapter reads a held-only reader added with this version (a
new file beside its service; every service's own calls are unchanged) and answers `unavailable`, with the reason, when
nothing is held:

| Kind | What the member path can start | What the adapter reads instead |
|---|---|---|
| `ratings` | `research.ratings.get_ratings` builds the rating on a cache miss (three vendor reads) | `ratings_held.held_ratings`: the same cache entry, else nothing |
| `estimates.history` | `estimate_history.history` registers the stock in the daily snapshot job (a write) | `estimate_history_held.held_history`: the route's answer with registering off, the tracked origin and the store's newest day over a read-only connection; no store file, nothing |
| `analyst.ratings` | `analyst_grades.get_analyst_grades` asks the vendor four times on a cache miss | `analyst_ratings_held.held_ratings`: the same cache entry shaped as the route shapes it, else nothing |
| `company.segments` | `revenue_segments.get_segments` starts the hold's background build (two vendor reads) | `revenue_segments_held.held_segments`: the hold's `peek()`, per period |
| `stock.failsToDeliver` | `ftd_dataset.series` opens the store through a helper that creates it when missing | `ftd_dataset_held.held_series`: no store file, nothing; else the route's own answer |
| `company.deals` | `mergers.get_company` and `index_changes.get_changes` start their holds' background builds (a name search, the latest-deals pages, three index lists) | `company_deals_held.held_mergers` and `company_deals_held.held_index_changes`: the holds' `peek()`; with only the market's latest-deals list held, the deals in it naming the symbol, said as such |

Rails (`tests/test_uct_agent_data_terminal_wave12.py`) replace every builder, vendor leg, writer, job and hold `get` with
one that fails, read every kind held and not held, and show each member path doing that work in the same state.

**What each kind states.**
- `estimates.history`: for each upcoming quarter (at most four) the newest consensus EPS and revenue with low, high and
  analyst count, and each move over 7, 30 and 90 days by `estimate_revisions.classify`, EEHSC's own rule (raised, cut,
  held, or too new / a gap / not comparable with the service's reason; a move never 0). The tracked-population rule is
  said: a stock outside the population with no snapshot is `unavailable` with that reason, never "no estimates"; the
  fiscal year's consensus is not held. Tracked origins: `sp500`: the S&P 500 list UCT's daily job seeds; `viewed`: a member opened EEH for it.
- `analyst.ratings`: the counts by rating with the consensus word, the price target (high, low, median, consensus, the
  recent averages; a window with no target has no average), the upside to the consensus target (the median when none:
  the ANR panel's rule) from the newest completed close in UCT's bar store (not the panel's last trade; no close, no
  upside), and the newest rating actions, cut from the old end. No coverage on file is `ok` with every section null; an
  outage the composer holds is `unavailable`; a record built with a leg down is `partial`. Each `_meta` is reduced to its
  observation time (no vendor name). Upside reasons: `no_target`: the record gives no consensus or median target; `no_close`: UCT's bar store holds no completed close for it.
- `company.segments`: the newest fiscal year's and quarter's split by product and by region, each segment's revenue, the
  server's share, and its growth against the same segment a year earlier, worked out from held periods only (no such
  period or segment, or a figure of 0 or less there: no growth, never 0); the largest segments kept, the smallest cut. A
  period not held is said; a leg's own state is said: `none`: the vendor answered with no period it could read; `not_in_plan`: the site's plan with the vendor does not include it; `not_configured`: the vendor is not switched on for this server; `rate_limited`: the vendor turned the read away for too many requests; `failed`: the vendor's answer could not be read.
- `stock.failsToDeliver`: the newest settlement days' balances (shares, price, value; no price, no value), the change
  from the reported day before, the window's peak and the newest as a share of it, the window the ingested files cover and
  the SEC's twice-monthly lag; a balance, never summed across days. No row in the window is the service's own words for
  it, with the window.
- `company.deals`: the deals naming the stock (its role, both parties, the filing day and the SEC filing) and its index
  additions and removals (the index, the day, the stock it replaced or was replaced by, the reason), each part with its
  own state and read time. A part with no row says no record matched (never that none exist). How the deals were looked
  for: `ok`: the company's name was searched and the latest filings were looked through by symbol; `none`: the company's name was searched and the latest filings were looked through by symbol; `no_name`: the server holds no company name for it, so only the latest filings were looked through, by symbol; `not_in_plan`: the name search is not in the site's plan with the vendor, so only the latest filings were looked through; `not_configured`: the vendor is not switched on for this server, so only the latest filings were looked through; `rate_limited`: the name search was turned away for too many requests, so only the latest filings were looked through; `failed`: the name search could not be read, so only the latest filings were looked through; `not_run`: no name search has been run for it on this server, so only the deals in the market's latest filings were looked through, by symbol. An index list not read: `none`: the vendor's list answered with no row; `not_in_plan`: it is not in the site's plan with the vendor; `not_configured`: the vendor is not switched on for this server; `rate_limited`: it was turned away for too many requests; `failed`: it could not be read.

**Notes, verbatim** (the adapters' own constants; `{…}` is filled per read):

`estimates.history`:
- `NOTE_WHAT`: `{symbol}'s estimate history as UCT holds it for the EEH panel: its own daily snapshots of the analysts' consensus EPS and revenue estimate for each upcoming fiscal quarter (at most {periods}), {first} to {last}, {days} snapshot days. Analysts' estimates, not a forecast of UCT's and not advice`
- `NOTE_AS_OF`: ``as_of` is the day of {symbol}'s newest snapshot ({day}); it is never the time of the read, and this read never adds a snapshot`
- `NOTE_TRACKED`: `{symbol} is in the population UCT snapshots because {why} ({count} of at most {cap} stocks are tracked)`
- `NOTE_MOVES`: `each move is the newest snapshot against the newest one on or before {windows} days earlier (within {slack} days), EEHSC's own rule: a change of more than {tol}% either way is raised or cut, anything within it held; a move the history cannot give is said with its reason, never as 0`
- `NOTE_YEAR`: `the fiscal year's consensus is not held: UCT snapshots the quarterly estimates only`
- `NOTE_GAPS`: `{n} snapshot days failed to read for {symbol} (newest {newest}): they are gaps, never skipped silently`
- `NOTE_BEHIND`: `{symbol}'s newest snapshot ({last}) is older than the store's newest ({store}): the daily read has not answered for it since`
- `NOTE_NO_PERIODS`: `{reason}: no upcoming quarter is held, so no estimate is stated. That is not the same as no estimates`
- `NOTE_LEFT_OUT`: `every snapshot point of each quarter is not in this read, only the newest: the EEH panel shows them`
- `NOTE_NOT_TRACKED`: `{symbol} is not in the population UCT snapshots (the S&P 500 list and the stocks members opened EEH for, at most {cap}), so no estimate history is held for it. That is not the same as no estimates. Opening EEH for {symbol} in UCT adds it when there is room; its history begins with the next snapshot`
- `NOTE_COLLECTING`: `{symbol} is tracked but has no snapshot yet: the daily job adds one each weekday evening and its history begins with the first. That is not the same as no estimates`
- `NOTE_SWITCHED_OFF`: `the estimate history is switched off on this server (its route answers nothing), so it is not read. That is not the same as no estimates`
- `NOTE_NOT_HELD`: `no estimate history is held on this server yet, and this read never adds one. That is not the same as no estimates. Open EEH in UCT, then ask again`
- `NOTE_FAILED`: `the estimate history read failed; nothing is stated. That is not the same as no estimates`

`analyst.ratings`:
- `NOTE_WHAT`: `{symbol}'s analyst ratings as UCT holds them for the ANR panel: the count of analysts by rating with the consensus, the price target (high, low, median, consensus and the recent averages) and the most recent rating actions. Analysts' opinions, not UCT's, not a forecast and not advice`
- `NOTE_AS_OF`: ``as_of` is the newest time the vendor's legs say they observed the data ({at}); it is never the time of the read, and this read never asks the vendor`
- `NOTE_NO_TIME`: ``as_of` is null: no leg of the held record carries an observation time`
- `NOTE_UPSIDE`: `the upside is the {target} target against {symbol}'s close of {day} in UCT's bar store ({close}), not the last trade the ANR panel uses`
- `NOTE_NO_UPSIDE`: `no upside is stated: {why}. That is not an upside of 0`
- `NOTE_NO_COVERAGE`: `the vendor answered for every leg and has no analyst coverage on file for {symbol}: no consensus, no target and no rating action`
- `NOTE_OUTAGE`: `some of {symbol}'s analyst data could not be read when UCT last asked; what is stated is what answered, and a missing section is not the same as none`
- `NOTE_CUT`: `{total} recent rating actions are held and the newest {shown} are returned: the list is cut from the OLD end`
- `NOTE_LEFT_OUT`: `the monthly rating trend and the estimate revisions are not in this read: the ANR panel in UCT shows the revisions`
- `NOTE_FUND`: `{reason}, so no analyst rating is stated. That is not the same as no coverage`
- `NOTE_NOT_HELD`: `{symbol}'s analyst ratings are not held on this server yet, and this read never asks the vendor. That is not the same as no coverage. Open ANR for {symbol} in UCT, then ask again`
- `NOTE_FAILED`: `the analyst ratings read failed; nothing is stated. That is not the same as no coverage`

`company.segments`:
- `NOTE_WHAT`: `{symbol}'s revenue by segment as UCT holds it for the SEG panel: the newest fiscal year's and quarter's split by product and by region, each segment's revenue and share of the segments listed (which may not add up to the company's total revenue), and its growth against a year earlier. Company-reported figures, not advice`
- `NOTE_AS_OF`: ``as_of` is the newest fiscal period end among the splits returned ({day}); it is never the time of the read. UCT read them at {at} (UCT's own time)`
- `NOTE_NO_PERIOD`: ``as_of` is null: no split of the held answers has a period that could be read`
- `NOTE_GROWTH`: `growth is worked out by this read from the held periods: each segment against the same segment in the period a year earlier (the year before; for a quarter, the period that ended 350 to 380 days earlier); a segment without one has no growth stated, never 0`
- `NOTE_ONE_HELD`: `the {missing} split is not held on this server yet (only the {held} one is), and this read never builds it. Open SEG {word} for {symbol} in UCT, then ask again`
- `NOTE_LEG`: `the {period} {leg} split is not stated: {why}. That is not the same as no segments`
- `NOTE_CUT`: `{period} {leg} split: {total} segments are held and the largest {shown} are returned (the smallest are cut)`
- `NOTE_LEFT_OUT`: `the earlier periods side by side are not in this read, only the newest and its comparison: the SEG panel shows them`
- `NOTE_NOT_HELD`: `{symbol}'s revenue by segment is not held on this server yet, and this read never builds it. That is not the same as no segments. Open SEG for {symbol} in UCT, then ask again`
- `NOTE_FAILED`: `the revenue by segment read failed; nothing is stated. That is not the same as no segments`

`stock.failsToDeliver`:
- `NOTE_WHAT`: `{symbol}'s fails to deliver as UCT holds them for the FTD panel, from the SEC's fails-to-deliver files (NSCC's Continuous Net Settlement data) ingested for {start} to {through}: each figure is the aggregate balance of shares that failed to deliver on that settlement date, not the day's new fails, and balances are never summed across days. Not advice`
- `NOTE_AS_OF`: ``as_of` is the newest settlement date stated ({day}); it is never the time of the read, and this read never downloads a file`
- `NOTE_NO_DAY`: ``as_of` is null: neither a reported row nor the ingested files give a date`
- `NOTE_LAG`: `the SEC posts each half-month's file in the second half of the following period, so the newest figure is some weeks old`
- `NOTE_NONE`: `{reason}: none of the {files} ingested files has a row for it. That is not the same as no fails ever`
- `NOTE_MISMATCH`: `{n} of the ingested files did not reconcile with their own row count and are kept, marked: {names}`
- `NOTE_NO_PRICE`: `{n} of the rows returned carry no price, so they have no value (never 0)`
- `NOTE_CUT`: `{total} settlement days are reported and the newest {shown} are returned: the list is cut from the OLD end`
- `NOTE_NOT_INGESTED`: `no fails-to-deliver file has been ingested on this server yet, so nothing is stated for {symbol}. That is not the same as no fails`
- `NOTE_SWITCHED_OFF`: `the fails-to-deliver data set is switched off on this server (its route answers nothing), so it is not read. That is not the same as no fails`
- `NOTE_NOT_HELD`: `no fails-to-deliver store is held on this server yet, and this read never downloads one. That is not the same as no fails`
- `NOTE_FAILED`: `the fails-to-deliver read failed; nothing is stated. That is not the same as no fails`

`company.deals`:
- `NOTE_WHAT`: `{symbol}'s deals and index changes as UCT holds them for the MNA and IDXC panels: the announced mergers and acquisitions that name it, with each SEC filing, and its additions to and removals from the S&P 500, the Nasdaq 100 and the Dow 30. A record of announcements, not advice`
- `NOTE_AS_OF`: ``as_of` is null: each part carries its own read time (deals: {deals}; index changes: {changes}), and each row its own day; never the time of the read`
- `NOTE_SEARCH`: `deals: {how}`
- `NOTE_NO_DEAL`: `no deal in what UCT holds matched {symbol} ({how}). That is not the same as a company with no deals`
- `NOTE_OTHER`: `{n} more deals matched the name search but name a different company; they are not returned`
- `NOTE_NO_CHANGE`: `no index change in what UCT holds matched {symbol}. That is not the same as a stock never in an index`
- `NOTE_LEG`: `the {index} list is not stated: {why}`
- `NOTE_CUT`: `{part}: {total} are held and the newest {shown} are returned: the list is cut from the OLD end`
- `NOTE_PART_NOT_HELD`: `{part} for {symbol} are not held on this server yet, and this read never builds them. Open {code} for {symbol} in UCT, then ask again`
- `NOTE_NOT_HELD`: `{symbol}'s deals and index changes are not held on this server yet, and this read never builds them. That is not the same as none. Open MNA or IDXC for {symbol} in UCT, then ask again`
- `NOTE_FAILED`: `the deals and index changes read failed; nothing is stated. That is not the same as none`

**Model isolation, from the licensing register** (`docs/terminal-research/09-security-licensing-cost/licensing-register.md`),
the builder's default under "when in doubt, isolated": the estimates and the analyst record are the estimates vendor's
(row T-34, member display of analyst estimates, grades, price targets and consensus, "R"; row T-44, its numbers into a
model, "No AI clause"); the close beside the upside is the market-data vendor's stored history (row T-04, member display,
"R"; row T-14, its numbers into a model, "R"); the segments are stamped `data_class="segments"`, which no row names
(row T-33, statements and fundamentals for member display, and row T-44 are the nearest); the deals and index lists are
stamped `mergers` and `constituents`, which no row names for these lists (row T-39, index constituents for member display,
and row T-44 the nearest; the SEC filing a deal links to is public, row T-83); the fails to deliver are SEC data whose
nearest row, T-83 (EDGAR filings, "A"), names EDGAR and not these files; the one row that mentions this store, row T-104, reads it only as a CUSIP-to-symbol input to the N-PORT fund index; no row names a model lane for them. No row
clears any of these for a model provider; the narrower rule is kept. Every capability is local-only. These are the
builder's default; nobody decided otherwise and nobody was asked.

**Routing.** The six capabilities share ONE words-only routing group of their own, `stockResearch`, the 54th of the 56 the
server keeps (`turn.MAX_GROUPS`, unchanged). Its words are empty in `routing.js` and each capability's own are armed only
while it is registered, so on a dark server routing is byte-identical to the base.

### 4.22 Terminal data wave 13: `insider.market`, `market.history`, `econ.latest`, `market.liquidity`, `market.oil`, `market.analogs` (v1.19, terminal-data)

Six more thin kinds, the Agent half of market panels the Agent could not answer: INS with INS CLUSTER (the market's
insider buying), MKTH (the S&P 500's and the Nasdaq-100's corrections and bear markets), ECON (the economy board), LIQ
(liquidity), OIL (the EIA's weekly oil report) and ANLG (the breadth analogues, "days like today"). Each kind is an adapter
over what its member route already reads (`api/services/uct_agent/marketdata/insider_market_read.py`,
`market_history_read.py`, `econ_read.py` for the three econ kinds, `analogues_read.py`; registered in `kinds.py` with
`owner="terminal-data"`). No new connection, job, database, write or route (§6), and no new environment variable. Each keeps
its route's own field names; the three econ kinds return the econ routes' own row shape, and the member's answer works the
board, the net liquidity calculation and the build or draw out with the panels' own pure models.

Left out, and why: SENT gets no kind (its readings sit in the Breadth Monitor's shared-cache copy under keys a read could
only make by calling functions that load files, so a held-only read could not be shown to start no work; its economy rows
are answered by `econ.latest`); IDAY (the intraday update panel: AI-written member text, which stays on hold); NEWS, UNEWS
and WIRE (third-party text); TIDE (intraday Market Tide: live flow). ANLG's route is `GET /api/breadth-monitor/analogues`;
`/api/analogs` is the brain's setup analogs, a different answer, and is not read.

**Status: dark, not armed.** Like every kind, each is served only when it is listed in `UCT_AGENT_DATA_KINDS` (with
`UCT_AGENT_DATA=1`). All six are model-isolated, so each also needs the master switch `UCT_AGENT_ISOLATED=1` and its own
entry in `UCT_AGENT_ISOLATED_KINDS` (§4.4, ADR-005); until then it is refused for every purpose, and once armed it is served
for purpose `answer` only. The six capabilities (`stock.insiderBuying`, `stock.marketHistory`, `stock.economyBoard`,
`stock.liquidityBoard`, `stock.oilReport`, `stock.daysLikeToday`) are local-only (`turn.LOCAL_ONLY_ACTIONS`) and registered
only while the server serves their kinds. This section describes what the code does when a kind is switched on. It does
not switch anything on. As written (2026-11-24), none of the six is in production's list.

| Kind | Canonical service (member route) | Params | Declared freshness | `as_of` | `provider_calls` | Model-isolated |
|---|---|---|---|---|---|---|
| `insider.market` | the INS feed `api/services/insider.py` keeps in the shared cache, read through `insider_feed_held.held_market_buys` (`GET /api/insider/feed?scope=market`), and the cluster answer `api/services/insider_clusters_sec.py` holds, read through `insider_clusters_sec.held_answer` (`GET /api/insider/clusters`) | `{rows}` | periodic · every read periodic | null: each part carries its own date | 0 | **yes** |
| `market.history` | the answer `api/services/market_history.py` holds, read through `market_history.held_answer` (`GET /api/research/market-history`) | `{index, rows}` | periodic · every read historical | the regular close of the newest session the index's closes reach | 0 | **yes** |
| `econ.latest` | the econ serving cache (`api/services/econ/serving.py`), read through `econ_held.held_latest` (`GET /api/econ/latest`, behind ECON_ENABLED) | `{}` | periodic · every read periodic | the newest release time among the readings returned | 0 | **yes** |
| `market.liquidity` | the same cache, read through `econ_held.held_latest` and `econ_held.held_history` (`GET /api/econ/latest`, `GET /api/econ/series/{symbol}`, behind ECON_ENABLED) | `{}` | periodic · every read periodic | the newest release time among the readings returned | 0 | **yes** |
| `market.oil` | the same cache, read through `econ_held.held_latest` and `econ_held.held_history` (the same routes) | `{}` | periodic · every read periodic | the newest release time among the readings returned | 0 | **yes** |
| `market.analogs` | the answer `api/services/breadth_analogues.py` holds per `top_n`, read through `breadth_analogues_held.held_analogues` (`GET /api/breadth-monitor/analogues`) | `{rows}` | periodic · every read historical | the regular close of the reference session | 0 | **yes** |

Sources (`source`): `uct-insider-market`, `uct-market-history`, `uct-econ` (all three econ kinds), `uct-breadth-analogues`.

**No read of this section starts a build or a request.** (§5: a turn has 20 provider requests and a member waiting.)
Every member route here can cause work on the request; each adapter reads only what is already held and answers
`unavailable`, with the reason, when nothing is. Three read-only readers are added with this version, each a new file
beside its service (every service's own calls are unchanged); two kinds use a read-only reader the service already had:

| Kind | What the member path can start | What the adapter reads instead |
|---|---|---|
| `insider.market` | `insider.get_market_insider_buys` pages the vendor's newest Form 4 filings on a cache miss | `insider_feed_held.held_market_buys` (new): the same cache entry, else nothing; `insider_clusters_sec.held_answer` (existing): the held clusters, never the SEC |
| `market.history` | `market_history.get_market_history` starts the one background build when a rebuild is due, and waits for its first stage with nothing held | `market_history.held_answer` (existing): what the module holds, looked for on disk once |
| `econ.latest`, `market.liquidity`, `market.oil` | `econ.serving.latest` and `series` read the published files from the data bucket on a cold cache | `econ_held.held_latest` and `econ_held.held_history` (new): the serving cache's own entries, never a load |
| `market.analogs` | `breadth_analogues.find_analogues` reads 500 sessions of breadth history and runs the similarity search on a miss or an expired entry | `breadth_analogues_held.held_analogues` (new): the held entry with the most matches, its first rows (the search is the same up to its final cut) |

Rails (`tests/test_uct_agent_data_terminal_wave13.py`) replace every builder, vendor page, SEC transport, loader, search and
the shared cache writer with one that fails, read every kind held and not held, and show each member path doing that work
in the same state (the clusters route reads only what is held itself, so it has no contrast).

**What each kind states.**
- `insider.market`: the purchases (symbol, insider and role, shares, price, amount, trade and filing day; the route's own
  order, largest dollar amount first; a purchase with no price has no price and no amount, never $0, and the unpriced are
  counted; an empty held list is said as the service holds it) and the clusters (ticker, company, insiders and their roles,
  first and last buy, buys, filings, shares, the value of the priced buys, the close the list was built with; each
  insider's name is left out and said; the coverage of the filing days read is said when it is not complete). Each list is
  cut at `rows`: the purchases from the smallest end, the clusters from the oldest.
- `market.history`: for one index (SPX by default, or NDX), the summary (corrections, bear markets, the ones not recovered,
  the median depth and recovery) and each decline newest first: its kind, peak and low with their closes, depth, sessions
  down, the day the peak was regained and the sessions it took (none while it has not been), how far below the peak the
  newest close is while it has not, the index 1, 3, 6 and 12 months after the low (null, never 0, where the store does not
  reach), and its leaders (the first 5 of the service's 25 and the first 3 sector medians,
  or the leaders' own state: not drawn yet, too thin, still being worked out, failed). The survivorship note travels in
  the service's own words. Stale when the held answer was built before the newest session's evening.
- `econ.latest`: the ECON board's 26 series in its order, each row as the route gives it (`ok`, `no_data`, `not_found`)
  or `not_held` (this read's own state), with its newest three points, meta, currentness (the next release from the
  calendar) and the time the serving cache read it. A partial read is `partial`.
- `market.liquidity`: the LIQ panel's 8 series in its order, and for the three inputs of net liquidity and the two daily
  parts the held points within 790 or 70 days of each series' newest period (the panel reads from the first of the month
  25 or 2 months back). Net liquidity itself is UCT's calculation, worked out in the member's answer by the panel's own
  model; an input not held means no value, never 0.
- `market.oil`: the OIL panel's 9 series in its order with the held points within 790 days (crude stocks) or 430
  days (the rest) of each series' newest period; the build or draw is the econ service's own weekly change.
- `market.analogs`: the reference session and its measures, and the closest past sessions (each with its closeness, its
  distance, its measures then and the S&P 500's return 5, 10, 20 and 60 trading days later, an absent window null and
  listed as not yet, never 0), cut at `rows` from the least similar end; fewer held than asked is said; stale past the
  route's six hours, with its build time. A record of what followed, not a forecast.

**Notes, verbatim** (the adapters' own constants; `{…}` is filled per read):

`insider.market`:
- `NOTE_WHAT`: `the market's insider buying as UCT holds it for the INS panel: the latest open-market purchases from Form 4 filings across the market, and the INS CLUSTER view's stocks in which several insiders bought within a few days. A record of filings, not advice`
- `NOTE_AS_OF`: ``as_of` is null: each part carries its own date (purchases: the newest filing {buys}; clusters: the newest filing day read {clusters}); never the time of the read`
- `NOTE_BUYS`: `purchases: the vendor's newest Form 4 filings over the last {days} days, open-market purchases only, largest dollar amount first; the service keeps at most {cap}, so a full list may leave out the smallest`
- `NOTE_UNPRICED`: `{n} of the purchases returned state no price, so they have no dollar amount (never $0)`
- `NOTE_BUYS_EMPTY`: `the held purchases list is empty: the service holds an empty list both when no open-market purchase was found in the window and when the vendor's pages could not be read, and it does not say which. That is not the same as no insider buying`
- `NOTE_CUT`: `{part}: {total} are held and the first {shown} are returned: the list is cut from the {end} end`
- `NOTE_RULE`: `clusters: {n} or more different insiders buying on the open market within {days} business days, from the SEC's Form 4 filings; joint filers count as one insider. Built {at} (UCT's own time)`
- `NOTE_COVERAGE`: `clusters: the read of the filing days {start} to {end} is not complete ({read} of {listed} filings read), so a cluster may be missing`
- `NOTE_NO_CLUSTER`: `clusters: no stock in what UCT holds has a cluster. That is not the same as no insider buying`
- `NOTE_PART_NOT_HELD`: `{part} are not held on this server yet, and this read never asks for them. Open {code} in UCT, then ask again`
- `NOTE_NOT_HELD`: `the market's insider buying is not held on this server yet, and this read never asks the vendor or the SEC. That is not the same as no insider buying. Open INS in UCT, then ask again`
- `NOTE_FAILED`: `the insider buying read failed; nothing is stated. That is not the same as no insider buying`

`market.history`:
- `NOTE_WHAT`: `{name}'s corrections and bear markets as UCT holds them for the MKTH panel: every decline of {corr}% or more on closing prices ({bear}% or more is a bear market), newest first, with the rally after each low and the stocks that led it. A record of what the index did, not a forecast and not advice`
- `NOTE_DEFINITION`: `the definition, in the service's own words: {text}`
- `NOTE_AS_OF`: ``as_of` is the close of the newest session {name}'s closes reach ({day}); it is never the time of the read, and this read never builds. UCT built it at {at} (UCT's own time)`
- `NOTE_STALE`: `the held answer was built for the evening of {built}, before the newest session's evening ({due}); this read never builds it again`
- `NOTE_COMPUTING`: `the leaders are still being worked out on the server; each decline's leaders say so, and this read never waits`
- `NOTE_LEADERS_FAILED`: `the leaders could not be worked out on the server's last build; the declines stand without them`
- `NOTE_SURVIVORSHIP`: `leaders: {note}`
- `NOTE_CUT`: `{total} declines are held and the newest {shown} are returned: the list is cut from the OLD end`
- `NOTE_LEADERS_CUT`: `each decline's leaders are cut to the first {leaders} of up to {kept} and its sectors to the first {sectors}`
- `NOTE_INDEX`: `the index: {note}`
- `NOTE_HISTORY_START`: `the oldest decline's peak is the first close UCT holds ({day}), so its true peak may be earlier`
- `NOTE_INDEX_NOT_HELD`: `{detail} This read never builds it. That is not the same as no declines`
- `NOTE_NOT_HELD`: `market history is not held on this server yet, and this read never builds it. That is not the same as no declines. Open MKTH in UCT, then ask again`
- `NOTE_FAILED`: `the market history read failed; nothing is stated. That is not the same as no declines`

`econ.latest`, `market.liquidity`, `market.oil`:
- `NOTE_WHAT`: `{what} as UCT holds it for the {panel} panel: UCT's published economic series from the agencies' own releases, each with its newest readings, their periods and release times, and its next release from the release calendar. Official figures, not a forecast and not advice`
- `NOTE_AS_OF`: ``as_of` is the newest release time among the readings returned ({at}); it is never the time of the read, and this read never reads the econ store's files`
- `NOTE_NO_TIME`: ``as_of` is null: no reading returned carries a release time`
- `NOTE_SOME_NOT_HELD`: `{n} of the {total} series are not held in the server's economics cache yet, and this read never loads them: {names}. That is not the same as no figure`
- `NOTE_NOT_FOUND`: `{n} of the series are not among those this server publishes: {names}`
- `NOTE_HISTORY`: `the history returned is each series' points within {days} days of its newest period, from the same held series; a series not held has none`
- `NOTE_SWITCHED_OFF`: `the economic data is switched off on this server (its routes answer nothing), so it is not read. That is not the same as no figure`
- `NOTE_NOT_HELD`: `{what} is not held in the server's economics cache yet, and this read never loads it. That is not the same as no figure. Open {panel} in UCT, then ask again`
- `NOTE_FAILED`: `the read of {what} failed; nothing is stated. That is not the same as no figure`

`market.analogs`:
- `NOTE_RECORD`: `A record of what followed similar days, not a forecast.`
- `NOTE_WHAT`: `the past sessions whose breadth looked most like {day} in UCT's breadth history (16 weighted breadth measures over the last 500 sessions), as UCT holds them for the ANLG panel, each with what the S&P 500 did 5, 10, 20 and 60 trading days later. Not advice`
- `NOTE_AS_OF`: ``as_of` is the close of the reference session ({day}); it is never the time of the read, and this read never searches. UCT worked it out at {at} (UCT's own time)`
- `NOTE_NOT_YET`: `{n} of the returned forward returns are not yet: fewer trading days have passed since that session (never 0)`
- `NOTE_SAMPLE`: `{n} sessions is a small sample; every count here is counted from this list`
- `NOTE_FEWER`: `{held} matches are held and {asked} were asked for: only {held} are returned`
- `NOTE_CUT`: `{held} matches are held and the closest {shown} are returned: the list is cut from the LEAST similar end`
- `NOTE_EXPIRED`: `the held answer was worked out more than {hours} hours ago, longer than the route serves it before working it out again; this read never works it out`
- `NOTE_NO_MATCH`: `the held answer has no match for {day}: the reference session's measures were too few to compare`
- `NOTE_NOT_HELD`: `the breadth analogues are not held on this server yet, and this read never searches. That is not the same as no similar days. Open ANLG in UCT, then ask again`
- `NOTE_FAILED`: `the breadth analogues read failed; nothing is stated. That is not the same as no similar days`

**Model isolation, from the licensing register** (`docs/terminal-research/09-security-licensing-cost/licensing-register.md`),
the builder's default under "when in doubt, isolated": the purchases are the vendor's selection of Form 4 filings (row T-39,
insider trading for member display, "R"; row T-44, its numbers into a model, "No AI clause"); the clusters come from the
SEC's own filings (row T-83, public domain, "A"), and row T-99, which records the cluster store, says nothing else reads it
yet ("no AI lane"); the index closes behind MKTH come from Yahoo (row T-71 and row T-72, "X") and its stock closes from the
market-data vendor's stored history (row T-04 and row T-09, "R"), the episodes and leaders being UCT's analytics over them
(row T-11) and row T-14 (the vendor's numbers into a model) "R"; the econ series come from the primary agencies through
UCT's econ store, which no row names (the register's Economic Data note), the nearest row being row N-14 (economic events,
calendar and macro series, "R"), and FRED, which the store never uses, is RED with an LLM ban (rows T-59 and T-60); the
analogues are matched on the Breadth Monitor's row (row T-75, "X", an accepted risk the register records), UCT's breadth
analytics (row T-11) and retained derived history (row N-25, which names the breadth analogues), with sentiment inputs no
row names. No row clears any of these for a model provider; the narrower rule is kept. Every capability is local-only.
These are the builder's default; nobody decided otherwise and nobody was asked. A record of filings, of what an index did,
of official figures or of what followed similar days: not a forecast, and not advice.

**Routing.** The six capabilities share ONE words-only routing group of their own, `marketMacro`, the 55th of the 56 the
server keeps (`turn.MAX_GROUPS`, unchanged). Its words are empty in `routing.js` and each capability's own are armed only
while it is registered, so on a dark server routing is byte-identical to the base. Five name words join the typo lexicon
while the kinds are served ("insider", "buying", "economy", "liquidity", "oil"); a rail shows they change no correction of
any other capability's corpus phrasing.

## 8. Changing this contract

1. Open a PR that edits this file, with a version bump (v1.1 adds; v2.0 breaks). Message agent-lead.
2. Breaking changes need an ADR and every consumer's acknowledgement in their status file.
3. Consumers code against the contract and QA's fixtures, never against an unmerged producer branch.
4. The envelope's wire field `contract` tracks the envelope **shape** only. A version that changes semantics or documentation but no envelope field (v1.1) keeps `"MD-1.0"`.

## 9. Changelog

- **v1.19 addition (2026-11-24, terminal-data, data wave 13):** §4.22 documents six kinds added dark with this version: `insider.market`, `market.history`, `econ.latest`, `market.liquidity`, `market.oil`, `market.analogs` (the market's insider buying and insider clusters, the S&P 500's and the Nasdaq-100's corrections and bear markets, the economy board, liquidity, the EIA's weekly oil report and the breadth analogues: the Agent half of INS with INS CLUSTER, MKTH, ECON, LIQ, OIL and ANLG). All six are model-isolated (ADR-005; the builder's default under "when in doubt, isolated": no row of the licensing register clears any of them for a model provider; §4.22 quotes the rows each kind is decided from: T-39, T-44, T-83 and T-99 for the insider buying; T-71, T-72, T-04, T-09, T-11 and T-14 for the market history; N-14, T-59 and T-60 for the econ series; T-75, T-11, N-25 and T-14 for the analogues), and none builds, searches, pages a vendor, reads the SEC or reads the econ store's files: each reads only what its service already holds (`insider_feed_held.held_market_buys`, `insider_clusters_sec.held_answer`, `market_history.held_answer`, `econ_held.held_latest`, `econ_held.held_history`, `breadth_analogues_held.held_analogues`) and is `unavailable`, with the reason, otherwise (§5); the three econ kinds also answer `unavailable` while the econ routes' switch (ECON_ENABLED) is off. Three read-only readers are added with this version, each a new file beside its service; every service's own calls are unchanged. `as_of` is the data's own date (the index's newest close, the newest release time, the reference session's close), or null where each part carries its own (the insider buying); never the time of the read. SENT, IDAY, NEWS, UNEWS, WIRE and TIDE get no kind (§4.22 says why). Additive: no existing kind changes and no envelope field changes, so the wire `contract` stays `"MD-1.0"` (§8.4). **Not armed:** all six kinds of §4.22 are default OFF, and switching one on is the owner's step, not this document's. §8.1 status: the version bump and this entry are in the PR that adds the kinds. The message to agent-lead that §8.1 asks for is owed by a person: it has not been sent, and this version is not acknowledged by anyone as of this entry. Nothing in this entry or in §4.22 records an owner decision.
- **v1.18 addition (2026-11-24, terminal-data, data wave 12):** §4.21 documents five kinds added dark with this version: `estimates.history`, `analyst.ratings`, `company.segments`, `stock.failsToDeliver`, `company.deals` (one stock's estimate history, its analyst ratings and price targets, its revenue by segment and region, its SEC fails to deliver, and its deals and index changes: the Agent half of EEH, ANR, SEG, FTD and one stock's MNA and IDXC), and the first capability over the existing `ratings` kind (RTG). All five are model-isolated (ADR-005; the builder's default under "when in doubt, isolated": no row of the licensing register clears any of them for a model provider; §4.21 quotes the rows each kind is decided from: T-34 and T-44 for the estimates; T-34, T-44, T-04 and T-14 for the analyst record and its upside; T-33 and T-44 for the segments; T-83 (and T-104's mention of the store) for the fails to deliver; T-39, T-44 and T-83 for the deals and index changes), and none builds, registers a symbol, creates a store, downloads or asks a vendor: each reads only what its service already holds (`estimate_history_held.held_history`, `analyst_ratings_held.held_ratings`, `revenue_segments_held.held_segments`, `ftd_dataset_held.held_series`, `company_deals_held.held_mergers`, `company_deals_held.held_index_changes`) and is `unavailable`, with the reason, otherwise (§5); EEH and FTD also answer `unavailable` while their routes' switches (ESTIMATE_HISTORY_ENABLED, FTD_DATASET_ENABLED) are off. **One existing kind changes:** `ratings` (§4.4) now reads only the held rating through `ratings_held.held_ratings` and spends 0 provider calls (it called `get_ratings`, which can build, and counted 3); nothing held is now `unavailable`. That is a narrowing, made by the wave 12 builder so that its first capability adds no vendor read to a turn; no envelope field changes, so the wire `contract` stays `"MD-1.0"` (§8.4). Six read-only readers are added with this version, each a new file beside its service; every service's own calls are unchanged. `as_of` is the data's own date (the stock's newest snapshot, the newest observation time, the newest fiscal period end, the newest settlement date), or null where each part carries its own read time (the deals); never the time of the read. PEER gets no kind: its route works the peers out on the request and holds nothing (§4.21). **Not armed:** all five kinds of §4.21 and `ratings` are default OFF, and switching one on is the owner's step, not this document's. §8.1 status: the version bump and this entry are in the PR that adds the kinds. The message to agent-lead that §8.1 asks for is owed by a person: it has not been sent, and this version is not acknowledged by anyone as of this entry. Nothing in this entry or in §4.21 records an owner decision.
- **v1.17 addition (2026-11-23, terminal-data, data wave 11):** §4.20 documents seven kinds added dark with this version: `groups.rank`, `groups.crowding`, `earnings.seasonBySector`, `estimates.revisionBreadth`, `options.ivRankLeaders`, `ipo.lockups`, `cot.byTrader` (every sector's or industry's weekly rank and its crowding, an earnings season by sector, estimate revisions by sector, the highest and lowest IV rank, estimated IPO lockup expiries, and futures positioning by trader type: the Agent half of GRPS RANK, GRPS CROWDING, ERNSC, EEHSC, OSCR RICH / CHEAP, IPO LOCKUP and the COT panel's "By trader type" view). All seven are model-isolated (ADR-005; the builder's default under "when in doubt, isolated": no row of the licensing register clears any of them for a model provider; §4.20 quotes the rows each kind is decided from: T-04, T-09, T-71 and T-14 for the group rank, as the price studies; T-93, T-48, T-99 and T-104 for the crowding; T-36, T-44, T-53 and T-54 with T-04, T-09 and T-14 for the earnings season; T-34 and T-44 for the revisions; T-28 and T-14 for the IV rank; T-04, T-09, T-14, T-52 and T-54 for the lockups; T-105, with T-82 and T-104, for the COT by trader type), and none builds, starts a background build, downloads or asks a vendor or an agency: each reads only what its service already holds (`group_stats.get_group_stats`, `group_stats.get_group_positioning`, `sector_earnings_held.held_season`, `estimate_revisions_held.held_breadth`, `iv_rank_leaders.get_leaders`, `ipo_lockups_held.held_lockups`, `cot_finer.market_answer`, `cot_finer.board_answer`) and is `unavailable`, with the reason, otherwise (§5); the EEHSC and OSCR kinds also answer `unavailable` while their routes' switches (ESTIMATE_HISTORY_ENABLED, OPTIONS_SCREENER_ENABLED) are off. Three read-only readers are added with this version, each a new file beside its service; every service's own calls are unchanged. `as_of` is the data's own date (the newest session's close, the newest held copy's or snapshot's day, the listings scan's time, the report's Tuesday), or null where each part carries its own (the crowding); never the time of the read. Additive: no existing kind changes and no envelope field changes, so the wire `contract` stays `"MD-1.0"` (§8.4). **Not armed:** all seven kinds of §4.20 are default OFF, and switching one on is the owner's step, not this document's. §8.1 status: the version bump and this entry are in the PR that adds the kinds. The message to agent-lead that §8.1 asks for is owed by a person: it has not been sent, and this version is not acknowledged by anyone as of this entry. Nothing in this entry or in §4.20 records an owner decision.
- **v1.16 addition (2026-11-23, terminal-data, data wave 10):** §4.19 documents six kinds added dark with this version: `stock.stats`, `stock.volumeFootprint`, `stock.factorExposure`, `stock.setupHistory`, `company.publicRecords`, `ownership.funds` (one stock's statistics, its volume footprint and gaps, its factor exposure, the setups that fired on it, one company's public records, and the registered funds holding one stock: the Agent half of STAT, VFP, FCTX, SETH, PUBR and the OWN panel's N-PORT block). All six are model-isolated (ADR-005; the builder's default under "when in doubt, isolated": no row of the licensing register clears any of them for a model provider; §4.19 quotes the rows each kind is decided from: T-04, T-09, T-71 and T-14 for the four price studies, as `seasonality.stock` already is, with T-44 for the footprint's earnings marks; T-100, T-101, T-102 and T-103 for the public records; T-104 for the N-PORT funds), and none works anything out, starts a build, asks an agency or downloads: each reads only what its service already holds (`stock_stats_held.held_stats`, `volume_footprint_held.held_footprint`, `factor_exposure_held.held_exposure`, `setup_history_held.held_signals`, `public_records.held_records`, `fund_holders_nport.answer_for`) and is `unavailable` or `partial`, with the reason, otherwise (§5). Four read-only readers are added with this version, each a new file beside its service; every service's own calls are unchanged. `as_of` is the data's own date (the newest session's close, the newest fund report period), or null where each section carries its own read time (the public records); never the time of the read. Additive: no existing kind changes and no envelope field changes, so the wire `contract` stays `"MD-1.0"` (§8.4). **Not armed:** all six kinds of §4.19 are default OFF, and switching one on is the owner's step, not this document's. §8.1 status: the version bump and this entry are in the PR that adds the kinds. The message to agent-lead that §8.1 asks for is owed by a person: it has not been sent, and this version is not acknowledged by anyone as of this entry. Nothing in this entry or in §4.19 records an owner decision.
- **v1.15 addition (2026-11-21, terminal-data, data wave 9):** §4.18 documents three kinds added dark with this version: `rates.auctions`, `rates.realYields`, `fed.watch` (US Treasury auctions coming up and their recent results, the Treasury's real yields with the breakevens, and the Fed watch: the Agent half of the AUCT panel, the real-yield block of RATES and the FED panel). All three are model-isolated (ADR-005; the builder's default under "when in doubt, isolated": no row of the licensing register clears any of them for a model provider; §4.18 quotes the rows each kind is decided from: T-95 for the auction records and the real curve, which have no row of their own, and T-97, T-98, T-37, T-44 and T-92 for the Fed watch, whose headlines come from a news wire with no row in the register), and none starts a build or a request: each reads only what its service already holds (`treasury_auctions_held.held_auctions`, `treasury_real_yields_held.held_real`, `fed_watch_held.held_answer`) and is `unavailable` or `partial`, with the reason, otherwise (§5). Three read-only readers are added with this version, each a new file beside its service; every service's own calls are unchanged. The Fed watch's reader reads its rates only from what the economics store's serving cache holds, never from the store's published files, and its rates block reports its own state whatever `ECON_ENABLED` is. `rates.realYields` is a kind of its own, and `rates.treasury` (§4.15) is unchanged. `as_of` is the data's own date (the newest auction record, the real curve's day), or null where each block carries its own (the Fed watch); never the time of the read. Additive: no existing kind changes and no envelope field changes, so the wire `contract` stays `"MD-1.0"` (§8.4). **Not armed:** all three kinds of §4.18 are default OFF, and switching one on is the owner's step, not this document's. §8.1 status: the version bump and this entry are in the PR that adds the kinds. The message to agent-lead that §8.1 asks for is owed by a person: it has not been sent, and this version is not acknowledged by anyone as of this entry. Nothing in this entry or in §4.18 records an owner decision.
- **v1.14 addition (2026-11-21, terminal-data, data wave 8):** §4.17 documents three kinds added dark with this version: `stock.corporateActions`, `calendar.ipos`, `calendar.dividends` (one stock's splits and cash dividends, the IPO calendar, and the dividends and splits declared ahead for named stocks: the Agent half of the CACT, IPO and DVD panels). All three are model-isolated (ADR-005; the builder's default under "when in doubt, isolated": no row of the licensing register clears any of them for a model provider outright; §4.17 quotes the rows each kind is decided from: T-07 and T-14 for the corporate actions record and the dividend calendar, T-52, T-54 and T-44 for the IPO calendar), and none starts a build or a vendor request: each reads only what its service already holds (`corporate_actions_held.held_actions`, `ipo_calendar_held.held_ipos`, `dividends_calendar_held.held_events`) and is `unavailable` or `partial`, with the reason, otherwise (§5). Two read-only readers are added with this version, each a new file beside its service: `ipo_calendar_held.held_ipos` and `dividends_calendar_held.held_events`; every service's own calls are unchanged. `calendar.dividends` answers for the stocks named only and never reads a member's own lists. `as_of` is the data's own date (the newest event of the corporate actions record), or null where the data has none (the two forward calendars), with the time UCT read it beside it; never the time of the read. Three of the six panels that went live on 2026-11-20 get no kind, and §4.17 says why: `COT` is read already, `ANLG` is shown to admins only and whether the Agent may read it is not answered, and `MKTS` is live quotes that `quotes` and `rates.treasury` already read. Additive: no existing kind changes and no envelope field changes, so the wire `contract` stays `"MD-1.0"` (§8.4). **Not armed:** all three kinds of §4.17 are default OFF, and switching one on is the owner's step, not this document's. §8.1 status: the version bump and this entry are in the PR that adds the kinds. The message to agent-lead that §8.1 asks for is owed by a person: it has not been sent, and this version is not acknowledged by anyone as of this entry. Nothing in this entry or in §4.17 records an owner decision.
- **v1.13 addition (2026-11-20, terminal-data, data wave 7):** §4.16 documents six kinds added dark with this version: `market.regime`, `stock.setups`, `stock.eventsTimeline`, `uct20.list`, `options.ivHistory`, `dilution.watch` (UCT's market regime read, one stock's confirmed setups, one stock's dated events, the UCT 20 list, one stock's implied volatility by logged session, and one company's share-issuance filings: the Agent half of the REGM, TECH, EVTS, IVH and DILU panels and of the UCT 20 page). All six are model-isolated (ADR-005; the builder's default under "when in doubt, isolated": no row of the licensing register clears any of them for a model provider; §4.16 quotes the rows each kind is decided from: T-11, T-12 and T-14 for the regime read and the UCT 20 list, T-11 and T-14 for the setups, T-44 for the events timeline, T-28 and T-14 for the IV history, T-96 for the dilution watch), and none starts a compute, a build, a download or a vendor request: each reads only what its service or store already holds (`voice_regime_held.held_regime`, the verdict store's `get_confirmed`, `timeline(sym, held_only=True)`, `engine._leadership_as_pushed`, `LocalStore(get_store().root)`, `dilution_watch.held_watch`) and is `unavailable` or `partial`, with the reason, otherwise (§5). Three read-only accessors are added with this version: `voice_regime_held.held_regime` (a new file beside the classifier), `earnings_reaction_panel.held_earnings`, and the `held_only` form of `events_timeline.timeline`; each default call is unchanged. Fields left out of four of the reads (the UCT Exposure Rating and the VIX level; the judge's written reasons; the catalyst thesis and filing links; the UCT 20 model portfolio, its NAV and each name's entry, stop and targets) are the builder's default and are named in §4.16. `as_of` is the data's own date (the time the classification was computed, the newest bar judged, the newest event that is not in the future, the wire run's date, the newest logged session, the newest filing's day), never the time of the read. Additive: no existing kind changes and no envelope field changes, so the wire `contract` stays `"MD-1.0"` (§8.4). **Not armed:** all six kinds of §4.16 are default OFF, and switching one on is the owner's step, not this document's. §8.1 status: the version bump and this entry are in the PR that adds the kinds. The message to agent-lead that §8.1 asks for is owed by a person: it has not been sent, and this version is not acknowledged by anyone as of this entry. Nothing in this entry or in §4.16 records an owner decision.
- **v1.12 addition (2026-11-20, terminal-data, data wave 6):** §4.15 documents five kinds added dark with this version: `seasonality.stock`, `seasonality.board`, `options.tideHistory`, `options.oiChange`, `rates.treasury` (one stock and the index and sector funds by calendar month, Market Tide by finished session, one stock's open interest change, and US Treasury par yields: the Agent half of the SEAS, SEASB, TIDEH, OIC and RATES panels). All five are model-isolated (ADR-005: the licensing register has no row that names seasonality, Market Tide by day, the options log or the open interest change, and no row of it clears these figures for a model provider; §4.15 quotes the rows each kind is decided from: T-04, T-09 and T-71 for the two seasonality kinds, T-25 and T-26 for the tide, T-28 for the open interest change, T-95 for the Treasury yields, and T-14), and none starts a build, a fetch, a capture or a vendor request: each reads only what its service or store already holds (`bars_sqlite.get_bars_before`, `seasonality_board.held`, `tide_history.history`, `oi_change.held_change`, `treasury_yields.held_answer`) and is `unavailable` or `partial`, with the reason, otherwise (§5). Two read-only accessors are added to their services with this version: `seasonality_board.held` and `oi_change.held_change`. `as_of` is the data's own date (the newest bar, the newest stored session, the newer log file, the curve's date), never the day of the read. Additive: no existing kind changes and no envelope field changes, so the wire `contract` stays `"MD-1.0"` (§8.4). **Not armed:** all five kinds of §4.15 are default OFF, and switching one on is the owner's step, not this document's. §8.1 status: the version bump and this entry are in the PR that adds the kinds. The message to agent-lead that §8.1 asks for is owed by a person: it has not been sent, and this version is not acknowledged by anyone as of this entry. Nothing in this entry or in §4.15 records an owner decision.
- **v1.11 addition (2026-11-18, terminal-data, data wave 5):** §4.14 documents two kinds added dark with this version: `short.interest`, `short.list` (FINRA short interest and daily short volume, the Agent half of the SHINT and SHRTS panels). Both are model-isolated (ADR-005: FINRA's data, licensed to UCT through its market-data vendor for display to members, licensing register rows T-93 and T-94, and no row of that register clears it for a model provider), and neither starts a build, a check or a vendor request: each reads only what `api/services/short_data.py` already holds, through the service's read-only accessors `short_data.held_stock` and `short_data.held_market`, and is `unavailable` or `partial`, with the reason, otherwise (§5). One accessor changes with this version: `held_market` with no list held now hands back the service's standing `unavailable` / `failed` answer instead of only "not held". `as_of` is the report's settlement date, never the day of the read. Additive: no existing kind changes and no envelope field changes, so the wire `contract` stays `"MD-1.0"` (§8.4). **Not armed:** both kinds of §4.14 are default OFF, and switching one on is the owner's step, not this document's. §8.1 status: the version bump and this entry are in the PR that adds the kinds. The message to agent-lead that §8.1 asks for is owed by a person: it has not been sent, and this version is not acknowledged by anyone as of this entry. Nothing in this entry or in §4.14 records an owner decision.
- **v1.10 addition (2026-11-18, terminal-data, data wave 4):** §4.13 documents three kinds added dark with this version: `earnings.season`, `earnings.callThemes`, `group.drill`. All three are model-isolated (ADR-005: UCT's calendar with third-party results and estimates and UCT's own priced and past moves; phrases taken from third-party transcript text whose AI-processing right is unresolved; UCT's RS rank, confluence board and themes over derived changes), and none starts a build or spends a provider call: each reads only the answer its service already holds, through a read-only accessor added to that service with this version (`earnings_season.held_day`, `call_themes.held_themes`, `scan_period.period_groups_of`), and is `unavailable` or `partial`, with the reason, otherwise (§5). Two datasets of the same wave get no kind, and §4.13 says why: the UNVOL panel's unusual volume is already a `screen.run` scan (SC-1), and the MYH panel is the member's own Journal. `flow.summary` stays deferred (§4.4). Additive: no existing kind changes and no envelope field changes, so the wire `contract` stays `"MD-1.0"` (§8.4). **Not armed:** every kind of §4.13 is default OFF, and switching one on is the owner's step, not this document's. §8.1 status: the version bump and this entry are in the PR that adds the kinds. The message to agent-lead that §8.1 asks for is owed by a person: it has not been sent, and this version is not acknowledged by anyone as of this entry. Nothing in this entry or in §4.13 records an owner decision.
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
