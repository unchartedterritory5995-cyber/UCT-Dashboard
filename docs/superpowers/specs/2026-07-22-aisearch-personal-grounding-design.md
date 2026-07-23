# AI Search — Personal-Data Grounding + Grounding Observability + Quality Pass

**Date:** 2026-07-22
**Status:** Design v2 (post 9-specialist review — 53 findings folded in) → implementation plan
**Surface:** AI Search widget (`/charts` + `/ai-search`), router `api/routers/ai_search.py`

## Why

AI Search cannot out-model ChatGPT/Perplexity/Google on general web search — under the
hood the general path *is* Perplexity. The defensible moat is the data those players
structurally cannot have: (1) UCT's proprietary live desk data (already grounded), and
(2) **the member's own positions, journal, watchlists, and risk state** (not yet used).
This spec adds the personal-data moat, the observability to see how much of the edge we
use, and a general answer-quality pass.

## Verdict-scope decision (v1: context, not an authored call)

The personal answer gives **position-aware CONTEXT + the fresh desk read** — "here's your
entry / heat / edge / earnings exposure alongside the live read" — and **does NOT author a
GO/HOLD/SKIP verdict** on the member's real money. Rationale: the firm already made the
decisive-verdict surface (Compass `grade_ticker`) *structural* and *report-card-exam-gated*
behind `COMPASS_MENTOR_MODE`; a free-form LLM verdict here would bypass that safety bar and
create brand/legal exposure. **Fast-follow (documented, not built now):** a *structural*
verdict computed from `portfolio_heat` + `grade_ticker` + `personal_edge` (model narrates,
never authors), shipped only after it clears the same report-card bar. The v1 synthesis
prompt is explicitly instructed to present the call as the member's to make.

## The privacy crux (load-bearing)

The entire grounded system prompt built by `_grounded_system(query)` **and the conversation
`history`** are sent to **Perplexity's external API** (`perplexity_search.web_search` /
`stream_search` → `_build_messages` turns each `{q,a}` history pair into user/assistant
messages POSTed externally). Personal data must never reach any Perplexity call — via the
system prompt **or via history**.

### Locked privacy invariants (each gets a regression test)
1. **No personal data in any Perplexity payload — including history.** On the personal
   branch, the Perplexity leg receives **only the current user-authored query and NO
   history** (a prior personal answer contains positions/P&L and would otherwise ship to
   Perplexity as an assistant message — the #1 review finding, caught 4×). Full history is
   given *only* to the internal Anthropic synthesis. Test: seed history with a synthetic
   personal answer containing position/P&L strings, assert none appear in the captured
   Perplexity `messages` — structurally (the personal block/history is never reachable from
   the Perplexity call), for both a personal and a non-personal follow-up.
2. **Personal answers never logged / never brain-indexed — keyed on the BRANCH, not on the
   `first_person` regex.** The `first_person` classifier does *not* reliably match personal
   queries (e.g. "am I overexposed" is a false negative), so it cannot be the guard. The
   router decides `is_personal` once at branch entry and threads an explicit `personal=True`
   flag; the single `_log_answer` call site skips when `personal` is set, covering **every**
   personal-branch exit including the synthesis→public-draft fallback. Brain ingest
   (`ai_search_memory._eligible_rows`) additionally excludes the explicit personal flag, not
   just `first_person=0`. Test via a `log()` spy on both endpoints (incl. the streaming
   `finally`), using a personal query the `first_person` regex does NOT match.
3. **Never cached under a shared/query key.** The synthesized personal answer is never
   written to any shared or query-keyed cache (the Perplexity/router caches key on
   query+salt, not user — a collision would serve user A's positions to user B). Any
   per-answer memoization must be keyed by `(user_id, account_id)`. Test: two users, identical
   personal query, no cache collision.
4. **Never published to community.** No endpoint persists or publishes personal-answer
   *content* to any shared surface. Server-side: the `kind:'ai'` community card path must
   refuse personal answers (not just client suppression). Share/Save of a personal answer is
   local-only. Backend test, not just frontend.
5. **Authorization.** The personal branch fires only for the authenticated request user,
   reads only that `user_id`'s data, and resolves **one** `account_id` from that user's own
   accounts (see Detection/Account). Server-side paid gate (below).
6. **Detection-miss query text.** On a detection miss a personal-ish query still flows the
   normal path and its text is logged (answer excluded from the brain via `first_person=0`).
   Policy: when `first_person_flag(query)==1`, skip persisting the raw query text regardless
   of branch, so a personal query never lands verbatim in the log.

## Detection — purpose-built `is_personal(query, user)` (do NOT reuse the PII regex)

The `first_person` PII classifier and the strong-ticker-cue extractor both mis-fit intent
(they miss "am I overexposed / how's my book / room to add" and false-fire on "is TSLA
extended"). Build a small dedicated detector:
- **Positive triggers:** first-person *ownership/portfolio* phrasing — `my (position|shares|
  book|portfolio|stop|risk|heat)`, `should I (add|trim|hold|sell|buy)`, `am I
  (overexposed|too concentrated|too heavy)`, `how (am I|'s my) (doing|day|week|book|risk|
  heat)`, `room to add`, `nearest (its )?stop` — plus a held/watched-ticker signal where a
  ticker is named (lowercase-normalize before ticker extraction; today's extractor is
  uppercase-only).
- **Gate order (cheap → expensive):** paid check → regex intent → `has_data(user_id)` DB
  probe (memoized per-user ~120s to avoid hitting the auth.db contention surface on every
  candidate query).
- **Semantics pinned:** personal iff `intent_matched AND paid AND has_data`. Asymmetric —
  **when unsure, non-personal** (never route a generic market question into the 2× path).
- Negative tests: "is TSLA extended here?", "thoughts on NVDA", "should I worry about the
  Fed" → non-personal. Positive: "am I overexposed", lowercase "should i add to nvda",
  "how's my week" → personal.

## Account resolution — read-only, one account, never `None`

`trader_memory.get_default_account_id` **writes** (calls `get_or_migrate_default_account` →
creates+migrates) — do NOT use it on the request path (violates "pure read"; can drop a
migration txn on the loop). Use read-only `accounts.list_accounts(user_id)`:
- Zero accounts → personal branch declines, falls back to the public path.
- Named-ticker "do I hold X" questions → prefer the account that actually holds X; else the
  first account (created_at ASC). State which account the answer reflects.
- Pass the **same** resolved `account_id` to `list_open_positions`, `portfolio_heat`, AND
  `personal_edge` — never `None` (None unions all accounts against a single-account
  denominator = nonsense heat). If a queried ticker is held in a *different* account than the
  resolved one, say so rather than asserting "no position."

## Architecture — additive async branch

Non-personal queries keep **today's exact behavior**. The personal branch (async, on the
event loop — no executor for the LLM calls):

```
query
  ├─ is_personal? ── no ──▶ [existing path, unchanged]
  │      │ yes  → emit SSE meta {personal:true} immediately (widget shows a
  │      │        position-aware waiting state, not dead-air)
  │      ▼
  │  needs_web = query has a research/news component (not pure self-state)?
  │      ├─ no  (e.g. "am I overexposed", "how's my book"):  draft = ""   (skip Perplexity — one hop, streams instantly, half cost)
  │      └─ yes (e.g. "should I add to NVDA given the news"): draft = await stream_search(PUBLIC system, query, history=None)  ← current query ONLY
  │  personal_block = ai_search_personal.assemble(user_id, account_id, query, tickers)   (all reads best-effort)
  │  stream: AsyncAnthropic synthesis over (draft + personal_block + live desk + full history)
  ▼
answer  (streamed Anthropic tokens; on any failure → emit the public draft as `final` in-band)
```

- **Streaming mechanism (was unimplementable):** use `anthropic.AsyncAnthropic().messages.
  stream()` natively on the event loop (SDK 0.83.0 has it) — same shape as the async httpx
  Perplexity path, **no `run_in_executor`, no thread→queue bridge, no loop-blocking.** The
  "one `_get_anthropic_client()` call via run_in_executor" language is dropped (that helper
  is sync-only).
- **Web draft on the async path:** use async `stream_search` collected to its final (never
  blocking `requests`-based `web_search` on the loop). Cap the draft `max_tokens`/timeout
  tightly — it's synthesis *input*, not the shown answer.
- **Pure-self-state queries skip Perplexity entirely** — no web bill, no dead-air, streams
  the synthesis immediately.

## Pre-requisite bug fix (LIVE prod bug, independent of this feature)

`portfolio_heat` and `voice_position_sizing._current_portfolio_risk` read snake_case
(`entry_price`/`stop_price`), but `list_open_positions` returns camelCase
(`entryPrice`/`stopPrice`) → `float(None)` throws → **every position is skipped** → heat/
notional report **0% and full room-to-add for everyone** on the real prod path. Unit tests
pass only because they inject snake_case dicts. Fix both readers to the camelCase shape
(`entryPrice`/`stopPrice`/`shares`/`symbol`/`side`), and add a regression test that feeds
**real `list_open_positions` output**, asserting non-zero heat + a surfaced placeholder stop.

## Feature A — `api/services/ai_search_personal.py`

Thin adapter over Compass. Pure read (read-only account resolver only). Every sub-read is
independently try/except'd; a failure drops that slice, never the answer. Whole block char-
capped (mirror `_CTX_BUDGET`≈2600) with truncation priority: query-named positions → heat
summary → edge → watchlist symbols (symbol-count capped) last.

- **Open positions + live P&L** — `list_open_positions(user_id, account_id=account_id)`
  (account_id is **keyword-only**; positional binds to `conn` and throws → silent empty
  slice). Live price from the shared `live_prices` cache **best-effort, blank-on-miss, no
  per-symbol fetch**; for broker rows use `brokerPrice` from the row; handle Long/Short
  sign. Honor `entryEstimated`: drop/label "days held" (placeholder entry_date) and mark
  return% "est. from broker cost basis." Placeholder stop (`stop==entry`) → blank stop.
- **Exposure / concentration** — `portfolio_heat(user_id, account_id)` (after the bug fix).
  If the account size is the `$50k` default (unknown), **omit or explicitly label** the
  percentage metrics — never present a heat/room % against a guessed denominator.
- **Per-setup edge** — `personal_edge.edge_for_setups(user_id, account_id)`; preserve
  thin-sample uncertainty.
- **Watchlists + flagged** — `watchlist_service.list_user_watchlists(user_id)` +
  `get_or_create_flagged_list(user_id)`; symbols only, count-capped.
- **Earnings on held names** *(new, best-effort)* — cross held symbols × the existing
  earnings feed (`_ctx_earnings` / fundamentals `next_earnings`): "N of your positions report
  this week: SYM Thu AMC…".
- **Day/week realized P&L** *(new, best-effort)* — compact realized+unrealized slice from J2
  closed trades via the aggregates tool with a day/week window.
- **Optional single-ticker context** — when the query names exactly one held ticker,
  best-effort `grade_ticker.grade_ticker(sym)` included only if `ok`; used as *context*
  (grade/levels/win-rate), **not** an authored verdict.

### Synthesis (`synthesize(...)`, streamed via AsyncAnthropic)
- System prompt = house-desk persona + **the SCOPE / ILLEGAL-MANIPULATION / DATA-LIMITS
  safety blocks verbatim** (shared as a named constant with `_WIDGET_SYSTEM` so both stay in
  sync — the personal branch must not be a lower-guardrail path) + **freshness firewall**
  ("PERSONAL CONTEXT/prior research may be dated; LIVE DESK figures + the web draft's fresh
  facts are authoritative") + **context directive** (present position-aware facts + the fresh
  read; **do not author a GO/HOLD/SKIP** — state it's the member's call) + **never invent** a
  fill/stop/P&L/level not in the block; for a placeholder-stop position state "no stop set —
  risk undefined" and do not propose a numeric stop/risk (this rule wins over "give concrete
  risk").
- Live price is a **single source of truth**: compute current-return% at synthesis time from
  entry × the same authoritative live desk quote, or keep only static facts (entry/size%/
  stop/days-held) in the "may be dated" block and let synthesis derive P&L from the live
  quote — never two conflicting live reads.
- Model: pin a concrete tested id via `AI_SEARCH_SYNTH_MODEL`; `thinking={"type":"disabled"}`;
  **no `temperature`** (Sonnet-tier 400s on temperature); explicit `timeout`; `max_tokens`
  ~700–900.
- **Cost cap = per-user + atomic reserve.** Mirror `_reserve` (check-AND-increment under one
  lock *before* the call, refund the delta after real usage) — not the dossier's record-
  after-return (racy on the request path). Per-user sub-cap so one member can't starve the
  global budget; over cap → skip synthesis, emit the public draft, and surface a "general
  answer (personalization paused)" indicator so the degrade isn't invisible.
- **Fallback in-band:** on synthesis error/timeout emit the already-fetched public draft as
  the stream `final` (do NOT return null → the widget's single-shot fallback would re-run the
  whole 2× branch).

## Feature B — grounding observability (measure differentiation, not ambient coverage)

"Any non-web source fired" saturates ~100% (regime injects on nearly every query) and can't
see the personal moat (personal isn't logged). Instead:
- **Tiered signal** per non-personal answer (de-identified log): `web-only` / `desk-grounded`
  (a *ticker-specific/intent-driven* proprietary source fired — quote/flow/tape/patterns/
  movers/breadth/earnings/uct20/candidates/memory; **regime and recency excluded as
  ambient**) — plus the existing save/share/copy/helpful signals already captured.
- **Value view:** signal-rate + repeat-engagement on `desk-grounded` vs `web-only` answers —
  does grounding actually change behavior, not just get attached.
- **Personal lane:** a **content-free** personal-invocation counter (no query/answer text),
  rendered as its own rate with an explicit denominator (`personal invocations / total
  requests`), plus the degrade-to-draft count — never mixed into the log-derived per-source
  bars (different denominators). Admin `AiSearchInsightsPanel` gets a "Grounding coverage"
  lane stating the denominator plainly.

## Feature C — general answer quality
- **C1 (now):** refine `_WIDGET_SYSTEM` — sharper house voice, decision-shape (lead line =
  the read; then levels/risk/regime-fit; tickers on names), tighter "no essay." Keep the
  SCOPE / DATA-LIMITS / ILLEGAL / FORMATTING blocks **verbatim** (safety-load-bearing) and
  factor them into the shared constant Feature A also uses.
- **C2 (documented fast-follow):** the structural verdict pass (see Verdict-scope decision).

## Flags / env
- `AI_SEARCH_PERSONAL_ENABLED` (default **0** — dark until verified in prod).
- `AI_SEARCH_SYNTH_MODEL` (concrete Sonnet-tier id), `AI_SEARCH_SYNTH_MAX_TOKENS` (~800),
  `AI_SEARCH_SYNTH_TIMEOUT`, `AI_SEARCH_SYNTH_PERUSER_CAP` (per-user/day),
  `AI_SEARCH_SYNTH_COST_HARD` (global backstop, raised from $3 to a launch-realistic level).
- Reuses `AI_SEARCH_DAILY_LIMIT` / `_GLOBAL_DAILY_LIMIT`.

## Frontend
- Stream `meta` event carries `personal:true`; `tryStream` renders a position-aware waiting
  state (analogous to the `deep` state) with a longer-wait expectation — no dead-air.
- Stream `final` + single-shot response carry `personal:true`; `applyFinal` stamps it on the
  thread entry.
- `Exchange` renders `ShareToFloor` only when `!entry.personal` (Copy / local-Save stay).
  The retention disclaimer is gated/altered on `entry.personal` (it's false for un-logged
  personal turns).
- Admin panel renders the redesigned coverage lane.

## Failure isolation (every layer degrades, never breaks)
Not paid / no J2 data / detection off / flag off → existing path. Any personal sub-read
throws → slice dropped. Synthesis over cap / error / timeout → in-band public draft. Zero
accounts → decline to public path.

## Testing
**Backend** — privacy invariants #1 (history leak, multi-turn), #2 (branch-keyed no-log via
`log()` spy on both endpoints incl. streaming `finally`; personal query the `first_person`
regex misses), #3 (no shared/query-keyed cache; two-user no-collision), #4 (server refuses to
publish personal content), #5 (auth: user A never reads B; paid gate via server-resolved plan
passes a real `pro` user, rejects free/unauth — never trust a client flag), #6 (query-text
skip when `first_person_flag`). Detection matrix (the false-positive/negative sets above).
Account resolution (read-only, one account, multi-account no-blend, zero-accounts declines).
Assembly (non-empty positions slice via correct kw-arg; broker `entryEstimated`/placeholder
stop; cold live-price → blank not error; default-$50k account → % omitted/labeled). Synthesis
(safety blocks present + manipulation ask still refused; no authored verdict; placeholder-stop
→ "risk undefined"; no `temperature`; cost-cap skip → public draft; timeout → in-band draft).
`portfolio_heat` camelCase bug fix (real `list_open_positions` shape → non-zero heat).
Event-loop: synthesis streams via AsyncAnthropic with no blocking call on the loop.
**Frontend** — personal waiting state; `ShareToFloor` absent for a personal entry; disclaimer
gated on `personal`; coverage lane from mocked insights.

## Files
| Path | Change |
|------|--------|
| `api/services/ai_search_personal.py` | **new** — assembler + AsyncAnthropic synthesize() |
| `api/routers/ai_search.py` | personal branch, purpose-built detection, async streaming synthesis, per-user atomic synth reserve, branch-keyed log-skip, `personal` meta/final flag |
| `api/services/portfolio_heat.py`, `api/services/voice_position_sizing.py` | **bug fix** — read camelCase position keys |
| `api/services/ai_search_log.py` | tiered signal (ambient excluded), content-free personal counter, redesigned insights coverage; query-text skip on `first_person` |
| `api/services/ai_search_memory.py` | ingest excludes explicit personal flag (not just first_person) |
| `api/services/community_cards.py` | server refuses `kind:'ai'` personal content |
| `app/src/.../AiSearchWidget.jsx` | `personal` flag threading, waiting state, share suppression, disclaimer gate |
| `app/src/.../AiSearchInsightsPanel.jsx` | redesigned coverage lane |
| `tests/...` | the suite above |

## Out of scope (YAGNI)
- Authored/structural GO-HOLD-SKIP verdict (C2 fast-follow, exam-gated).
- Server-synced saved answers; per-position deep review (Compass territory).
- Multi-account disambiguation UI (state which account; picker later if asked).
- Any change to the de-identified community learning log's privacy model.
