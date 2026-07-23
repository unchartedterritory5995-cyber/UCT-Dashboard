# AI Search — Personal-Data Grounding + Grounding Observability + Quality Pass

**Date:** 2026-07-22
**Status:** Design → pending 9-specialist review → implementation plan
**Surface:** AI Search widget (`/charts` + `/ai-search`), router `api/routers/ai_search.py`

## Why

AI Search cannot out-model ChatGPT/Perplexity/Google on general web search — under the
hood the general path *is* Perplexity. The defensible moat is the data those players
structurally cannot have: (1) UCT's proprietary live desk data (already grounded), and
(2) **the member's own positions, journal, watchlists, and risk state** (not yet used).
This spec adds the personal-data moat, plus the observability to see how much of the
proprietary edge we actually use, plus a general answer-quality pass.

Three features, one coherent change:

- **A. Personal-data grounding** — position/exposure/edge-aware answers for the member.
- **B. Grounding observability** — % of queries hitting proprietary grounding, by source.
- **C. Answer-quality pass** — house-voice + decision-shape prompt refinement; the
  synthesis machinery A introduces is reusable for a later non-personal verdict pass.

## The privacy crux (load-bearing)

The entire grounded system prompt built by `_grounded_system(query)` is sent to
**Perplexity's external API** as the `system` message (`perplexity_search.web_search` /
`stream_search` → `_build_messages` → `{"role":"system"}`). Therefore **personal data
must never be injected into `_grounded_system` or any Perplexity call.** Personal data
only ever reaches an internal Anthropic synthesis step under our control.

### Locked privacy invariants (each gets a regression test)
1. **No personal data in any Perplexity payload.** The Perplexity `system`/`messages`
   for a personal query are byte-identical to what a non-personal query with the same
   public grounding would send.
2. **No personal answer in the learning log or house-brain.** Personal answers are
   `first_person` and are *never* written to `ai_search_log` (which feeds the
   de-identified community brain). The existing brain ingest already gates
   `first_person=0`; we additionally do not log personal-branch answers at all.
3. **Authorization.** The personal branch fires only for the authenticated request user,
   reads only that `user_id`'s J2 data, and resolves `account_id` from that user's own
   accounts. User A can never surface User B's data.
4. **Gating.** Personal branch requires authenticated **and** paid **and** the user has a
   J2 account with data. Otherwise it silently falls back to today's path.

## Architecture — an additive branch, not a hot-path rewrite

Non-personal queries keep **today's exact behavior** (Perplexity direct / SSE stream).
A new personal branch is added:

```
query
  │
  ├─ is_personal(query, user)? ── no ──▶ [existing path, unchanged]
  │        │ yes
  │        ▼
  │   1. PUBLIC grounded system  = _grounded_system(query)   (NO personal data)
  │   2. Perplexity draft        = web_search/stream_search(public system, query, history)
  │   3. personal context block  = ai_search_personal.assemble(user_id, account_id, query, tickers)
  │   4. Anthropic synthesis      = fuse(draft + personal block + live desk figures)
  │                                 → stream final answer to the widget
  ▼
answer
```

Step 2 still benefits from all existing proprietary desk grounding (price/regime/
catalyst/flow/tape) — that is public-to-us, non-personal, and already privacy-safe.
Step 3/4 add the private layer internally.

### Detection — `is_personal(query, user)`
Reuse existing signals, do not invent a new classifier:
- `ai_search_log`'s `first_person` classifier (already used for the log).
- The router's existing position-cue ticker extractor (the `_TICKER` "strong position
  cue" logic ~L274–299) — e.g. "my NVDA", "should I add", "am I overexposed".
- Gate: `user` present + `useIsPaid`-equivalent server check + `ai_search_personal.has_data(user_id)`
  (a cheap "does this user have any open position, watchlist, or closed trade" probe).
- If any gate fails → not personal → existing path. Asymmetric: when unsure, treat as
  **non-personal** (never risk sending personal data down a path that doesn't need it).

### Feature A — `api/services/ai_search_personal.py` (thin adapter over Compass)
Assembles a compact, token-bounded **PERSONAL CONTEXT** block. Pure read; never writes.
Every sub-read is best-effort and independently try/except'd — a failure drops that
slice, never the answer.

- **Open positions + live P&L** — `journal_two.positions.list_open_positions(user_id,
  account_id)`; overlay live price from the shared live-price cache (never a per-symbol
  fetch on the request path). Fields: sym, entry, size %, stop (blank if broker
  placeholder `stop==entry`), current return %, days held.
- **Exposure / concentration** — `portfolio_heat.portfolio_heat(user_id, account_id)`:
  risk-heat vs the 10% aggregate cap, notional vs regime ceiling, by-sector
  concentration. Surfaces broker placeholder-stop caveat (per portfolio_heat's own
  safety rule).
- **Per-setup edge** — `personal_edge.edge_for_setups(user_id, account_id)`: expectancy
  (avg_r / total_r) by setup, with thin-sample uncertainty preserved.
- **Watchlists + flagged** — `watchlist_service.list_user_watchlists(user_id)` +
  `get_or_create_flagged_list(user_id)`; symbols only (compact).
- **Optional per-ticker verdict** — when the query names exactly one ticker,
  best-effort `grade_ticker.grade_ticker(sym)`; included only if it returns `ok`
  (it needs the brain pack; absence is fine, synthesis still produces the verdict).

Account resolution: the user's default/active J2 account (first account if one, the
account flagged default otherwise). If the user has multiple accounts and the query is
ambiguous, use the default and state which account the answer reflects.

### Feature A — synthesis step
`ai_search_personal.synthesize(query, public_draft, personal_block, live_desk, history)`:
- One `_get_anthropic_client()` call, `AI_SEARCH_SYNTH_MODEL` (default a Sonnet tier),
  **`thinking={"type":"disabled"}`**, explicit `timeout`, streamed.
- System prompt = the house-desk persona + **freshness firewall**: "PERSONAL CONTEXT and
  PRIOR RESEARCH may be dated; LIVE DESK figures and the web draft's fresh facts are
  authoritative — never override a live number with a stale personal one." Decision-shape
  directive: position-aware read → is-this-a-GO/HOLD/SKIP-for-*you* given your exposure,
  entry, and edge → concrete levels + risk. Never invent a fill, a stop, or a P&L not in
  the personal block.
- Own daily cost cap (`AI_SEARCH_SYNTH_COST_HARD`, default $3/ET-day, dossier pattern);
  over cap → skip synthesis, return the public draft (graceful degrade).
- Streaming: for personal queries the SSE endpoint streams the **Anthropic** synthesis
  tokens (not Perplexity's). The Perplexity draft for step 2 is fetched non-streamed
  (or its final collected) first, then synthesis streams. Single-shot endpoint returns
  the synthesized final. Any synthesis failure → fall back to the public draft answer.

### Feature B — grounding observability
`_uct_context`/`_grounded_system` already return a grounding `meta` dict naming which
sources fired. Extend the capture:
- Record, per answer (de-identified, existing log), a `grounded_sources` set
  (price/regime/movers/breadth/earnings/catalyst/tape/uct20/candidates/memory/**personal**)
  and a boolean `proprietary_hit` (any non-web source fired).
- `ai_search_log.insights(days)` computes **% of queries with `proprietary_hit`** and a
  per-source hit breakdown.
- `AiSearchInsightsPanel.jsx` (admin) renders a "Grounding coverage" lane: overall %,
  and a ranked per-source bar/list. No new PII; `personal` is counted as a source but no
  personal content is stored (the log already excludes personal answers — the *count* of
  personal-branch invocations can be tracked via a separate counter that stores no
  question/answer text).

### Feature C — general answer quality
- **C1 (now):** refine `_WIDGET_SYSTEM` — sharper house voice, explicit decision-shape
  (lead line = the call; then levels/risk/regime-fit; names get tickers), tighter
  "no essay" guidance. Keep the existing SCOPE / DATA-LIMITS / ILLEGAL / FORMATTING
  blocks verbatim (those are safety-load-bearing).
- **C2 (documented fast-follow, not built now):** a flag that lets the same
  `synthesize()` machinery run for high-value **non-personal** verdict queries ("is X a
  buy") to apply methodology + decision-shape over the Perplexity draft. Deferred to keep
  cost/latency contained and measured first via Feature B.

## Flags / env
- `AI_SEARCH_PERSONAL_ENABLED` (default **0** — dark until verified in prod).
- `AI_SEARCH_SYNTH_MODEL` (default Sonnet tier), `AI_SEARCH_SYNTH_COST_HARD` ($3/day).
- Reuses existing `AI_SEARCH_DAILY_LIMIT` / `_GLOBAL_DAILY_LIMIT` caps (personal queries
  count once, like any query).

## Failure isolation (every layer degrades, never breaks)
- Not paid / no J2 data / detection off → existing path.
- Any personal sub-read throws → that slice dropped, others still used.
- Synthesis over cost cap or errors/timeouts → return the public Perplexity draft.
- Flag off → the branch is never entered.

## Testing
**Backend**
- Privacy invariant #1: capture the exact `messages` handed to `perplexity_search` for a
  personal query; assert no position/P&L/journal string appears; assert byte-equality
  with the same query's public-only grounding.
- Privacy invariant #2: a personal-branch answer is never passed to `ai_search_log.log()`.
- Authorization: personal assembly for user A never reads user B's rows; account
  resolution stays within the user's accounts.
- Detection: first-person + held-ticker → personal; generic "what is a VCP" → not;
  unsure → not personal (asymmetric).
- Assembly: empty positions / no account / broker placeholder stop / thin edge sample /
  multi-account default resolution.
- Synthesis: cost-cap skip returns public draft; timeout/exception falls back; freshness
  firewall present in the system prompt.
- Feature B: `insights()` computes proprietary_hit % and per-source breakdown; personal
  invocations counted without storing content.
- Event-loop safety: the personal branch's blocking reads + Anthropic call run via
  `run_in_executor` on the streaming path (never on the shared loop — the 524 surface).

**Frontend**
- Widget streams the synthesized answer (same rendering as today); personal answer still
  offers Copy but **Save/Share** of a personal answer is allowed only locally (no
  community share of position data — assert ShareToFloor is suppressed/omitted for
  personal answers).
- Admin panel renders the grounding-coverage lane from mocked insights.

## Files
| Path | Change |
|------|--------|
| `api/services/ai_search_personal.py` | **new** — Compass adapter + synthesize() |
| `api/routers/ai_search.py` | personal branch, detection, streaming synthesis, meta capture |
| `api/services/ai_search_log.py` | `grounded_sources` + `proprietary_hit`; personal-count without content; insights coverage |
| `app/src/pages/.../AiSearchInsightsPanel.jsx` | grounding-coverage lane |
| `app/src/components/.../AiSearchWidget.jsx` | suppress community-share on personal answers |
| `tests/...` | privacy invariants, auth, detection, assembly, synthesis, coverage |

## Out of scope (YAGNI)
- Non-personal verdict synthesis (C2 — documented fast-follow only).
- Server-synced saved answers, per-position deep review (Compass territory).
- Multi-account disambiguation UI (default account + state which; picker later if asked).
- Any change to the de-identified community learning log's privacy model.
