# AI cost protection — what bounds Anthropic spend, and what does not

Owner request 2026-10-11: about $50 of Anthropic API credit in two days, with no way to say
where it went. Scope: pay-as-you-go API spend by UCT's own services (website, UCT Agent,
Indicators AI, background jobs, tests). Not Claude Code / Claude Max usage.

## 1. The layers, and which ones are real guarantees

| Layer | What it is | Guarantee? |
|---|---|---|
| **Anthropic Console limits** (manual, owner) | Workspace / organisation spend limits and usage alerts set in the Anthropic Console | **The only hard guarantee.** Enforced by the provider whatever the code does. |
| `ai_spend` daily ceiling | `AI_SPEND_DAILY_CAP_USD`, durable per ET day in auth.db (`daily_counters`) | Application-level. Bounds every message call made by this codebase through the Anthropic SDK; fails OPEN on a database error. |
| `ai_spend` breaker / in-flight / batch caps | Per process | Application-level, per process. |
| Existing per-lane guards | catalyst `cost_guard` ($15/day), `narrative_cost_guard`, call-recap, theme, pattern-vision, concierge per-member, Agent daily turn cap | Application-level, per lane. Unchanged. |
| Test transport block | `tests/conftest.py` refuses real HTTP to model hosts | Tests only. |

⛔ **An application cap cannot protect against**: a bug that bypasses the SDK (raw HTTP to
api.anthropic.com), a key used outside this codebase (a script, another service, a leaked
key), the Message Batches API (billed when results are fetched), or a database error (fail-open).
Only the provider limit covers those.

## 2. Provider-level settings the owner must configure (manual)

These are not set by any code change and were not touched. Check the exact labels in the
Anthropic Console, which may differ from the wording here:

1. **Spend limit** on the workspace that holds the production key (Console → Settings → Limits /
   Workspaces). Set a monthly limit consistent with the intended daily budget (e.g. the
   production day ceiling × 30 plus headroom).
2. **Usage / spend notifications** at thresholds (e.g. 50% / 80% / 100% of the limit), sent to an
   address that is read.
3. **Separate keys (ideally separate workspaces) per surface**: production web, background
   workers, and development/testing. A development key with its own small limit makes the
   $10/day development ceiling a provider-enforced one, and makes usage attributable in the
   Console's usage report by key.
4. Review the Console **usage report by key and model** for 2026-10-09 → 2026-10-11 to attribute
   the $50. The app-level report (§4) starts counting only once this branch is deployed.

## 3. Application settings (all env, all optional)

| Variable | Default | Meaning |
|---|---|---|
| `AI_SPEND_DAILY_CAP_USD` | unset on Railway (record-only); **$10 off Railway** | Day ceiling across every feature. `off`/`none` disables; `0` refuses everything. |
| `AI_SPEND_BATCH_CAP_USD` | unset; **$2 when tests run with `ALLOW_LIVE_AI=1`** | Per-process ceiling (one test batch, one CLI run). |
| `AI_SPEND_FEATURE_MAX_PER_MIN` | 120 | Runaway breaker: calls per feature per 60 s before the feature is paused. |
| `AI_SPEND_BREAKER_COOLDOWN_S` | 300 | How long a tripped feature stays paused. |
| `AI_SPEND_MAX_IN_FLIGHT` | 32 | Concurrent model calls per process; refused, never queued. |
| `AI_SPEND_DISABLED` | unset | `1` refuses every model call (emergency stop). |
| `AI_SDK_MAX_RETRIES` | 2 (the SDK default, unchanged) | Retries on the shared client (`engine._get_anthropic_client`). |
| `ALLOW_LIVE_AI` | unset | Tests only: `1` lifts the transport block for one run, held to the batch cap. |

⚠️ **Production is unchanged until the owner sets `AI_SPEND_DAILY_CAP_USD` on Railway.** The
guard records spend there from deploy, but enforces no day ceiling until the value is chosen,
because a ceiling below normal traffic would switch member features off.

## 4. Seeing the spend

`ai_spend.report(day)` → `{day, total_usd, calls, daily_cap_usd, remaining_usd, enforcing,
features: [{feature, usd, calls}]}`, largest first. A feature is the module that made the call
(e.g. `api.services.definition_conversation`). Stored in auth.db `daily_usage_counters`
(scopes `ai_spend_usd`, `ai_spend_calls`), two ET days kept. Dollar figures are ESTIMATES from
`catalyst.cost_guard._PRICING`; an unknown model is priced at the dearest known rate.

## 5. Known cost drivers and open doors (from `api/services/ai_doors.py`, 2026-10-11)

- **The indicator builder conversation** (`definition_conversation`, the Agent's
  `indicator.draft`) runs `claude-opus-5` at up to 8,192 output tokens:
  ~$0.23 per call, ~$0.45 worst case (`definition_concierge.py:138`). Its per-member $0.75/day cap
  is listed as in-process in `ai_doors.py` (reset by every deploy) — to be confirmed.
- **UCT Agent turns**: `claude-haiku-4-5`; daily cap currently 3,000 turns/member (raised for
  development 2026-10-08; the default is 300).
- **Member doors with no dollar bound** (per `ai_doors.py`): `journal_two/pre_trade_verdict`
  (nothing), `api/routers/earnings.py` (nothing), `journal_two/coach` and `trade_review`
  (regenerate unbounded), voice chart vision / embeddings / summarizer and
  `trader_profile_auto` (per-IP rate limits only), `voice_deep_research` (Claude leg uncapped),
  `company_about` (cache only). All are now inside the `ai_spend` day ceiling once it is set.
- **Background jobs** spend every day regardless of traffic (catalyst lanes, call recaps,
  theme engine, pattern vision, wisdom extraction, briefings).

## 6. Tests can no longer spend by accident

`tests/conftest.py` refuses every real HTTP request to `api.anthropic.com`, `api.openai.com`
and `api.perplexity.ai` (httpx and requests). Mocked clients and `httpx.MockTransport` are
unaffected. A live run needs `ALLOW_LIVE_AI=1` and is held to the batch cap.
