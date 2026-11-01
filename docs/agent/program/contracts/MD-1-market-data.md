# MD-1 — UCT market-data contract (v1.0)

- **Owner:** agent-md implements the kinds. agent-lead owns `gateway.py` and `envelope.py`, the framework every consumer relies on.
- **Consumers:** agent-sc, agent-rs, agent-qa, and later the D and G workstreams.
- **Status:** v1.0, accepted for Sprint 1.
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
| `quote`, `quotes` | `services/massive.py` snapshot (read-only call) | live | 60 s in session | **Not** the `/api/live-prices` route: its cache miss runs `watchlist_alert_service.run_alert_check()`. **Price reads must never trigger alerts.** Outside market hours, answer `historical` with a note. |
| `bars.daily` | `services/bars_fetch.py` | historical (completed sessions) | 1 session | Today's partial bar is not a completed daily bar |
| `bars.intraday` | `services/bars_fetch.py` | delayed or live, as the source reports | per source | Sprint 1 only if `bars_fetch` exposes a source time |
| `fundamentals` | `services/fmp_client.py` | periodic | 7 days | Use the service's `as_of` |
| `earnings` | `services/earnings_estimates.py` / engine | periodic | 1 day | |
| `news.company` | `services/news/` store | periodic | 1 hour | Item times as `as_of` per item; the envelope `as_of` is the newest item |
| `breadth.current` | `services/breadth_current.py` (MI-owned) | periodic | its own `stale` flag | Delegate; never copy breadth data. The V2 runner is the only producer. |
| `nhnl` | `services/nhnl_live.py` | periodic | 30 min in session | `asof` → `as_of` |
| `themes` | `services/theme_performance.py` | periodic | 1 day | `generated_at` → `as_of` |
| `volume.surge` | `services/volume_live.py` | periodic | 30 min in session | `asof` → `as_of` |
| `ratings` | `services/research/ratings.py` | periodic | 1 day | |

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
