---
id: GATE-A14-PORTFOLIO-HEAT-CP1
title: A14 Portfolio & Risk — CP1 scoped proposal (a real door on the already-shipped engine)
role: Narrow pre-implementation review packet, proposing A14's first member-facing checkpoint
  now that both of its owner-bound questions are answered (DEC-08, 2026-09-20; G1, 2026-09-20)
phase: 3.5 (pre-implementation, not implementation)
date: 2026-09-20
status: PROPOSED — not signed. Drafted the same session both blockers were cleared.
sources: OWNER_INPUTS.md G1 (the owner's live answer this session: "we no longer have a free and
  paid tier, only paid" — verified against app/src/constants/freePages.js, FREE_PAGES =
  ['/morning-wire'], and the router comments in api/routers/{calendar,engine_data,modelbook,
  scans}.py + api/top_flow_router.py that independently date the change to "the 2026-07-19 owner
  decision"), ARCHITECTURAL_DECISION_REGISTER.md DEC-08 (the owner's live answer, same session:
  "Yes, we need it daily" — a separate question, not this checkpoint's gate, recorded for
  completeness since both cleared the same day), COMPLETION_AUDIT.md's A14 row,
  10-roadmap/2026-09-12-a-series-bucket-sort.md line 357 (the original "owner-bound twice over"
  finding this proposal closes), plus this pass's own direct reads of
  api/services/portfolio_heat.py (all 204 lines), its four existing callers
  (api/services/journal_two/coach_chat_tools.py:1671, api/services/voice_tool_impls.py:1869,
  api/services/ai_search_personal.py, api/services/grade_watchlist.py), api/middleware/
  auth_middleware.py (require_paid, get_current_user), and api/routers/{ai_search,analyst,
  backtest}.py as the existing require_paid idiom this proposal follows rather than inventing a
  new one. No application code was modified to produce this packet.
---

# A14 Portfolio & Risk — CP1 (a real door on the already-shipped engine)

## APPROVAL — this block is filled in by the OWNER, not the author

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

No field above is filled in. This packet proposes exactly one checkpoint (section 2); nothing in
it authorizes writing product code beyond that scope.

---

## 1. Why now

A14 has had "no member door" since the program's own 2026-09-12 bucket-sort survey, which named
it **owner-bound twice over**: DEC-08 (build a corp-actions/portfolio-risk calendar at all?) and,
separately, a question that was never formally asked — who may see aggregate portfolio-risk
numbers. Both were answered directly by the owner in this same live session, 2026-09-20. DEC-08's
"yes" does not by itself unblock A14 (it unblocks a *different*, larger, not-yet-scoped piece of
work — a genuine corp-actions *event* calendar, which still has a real, separate provider gap:
D5's `reference_corp_actions.py` covers splits via Massive, but nothing anywhere covers M&A,
spin-offs, rights offerings, buybacks, or ticker-change events). G1's answer is what unblocks
*this* checkpoint specifically: there is no free tier to gate against, so a new aggregate-risk
page is simply an ordinary paid-member feature, the same as most of the app already is.

The reason this is worth doing now rather than waiting for the corp-actions calendar to catch up:
the hard computational work already exists and is unused by any member. `portfolio_heat.py`
computes real risk-heat against the 10% aggregate cap, notional exposure against the regime
ceiling, per-position risk, by-sector concentration flags, and broker-placeholder-stop detection
— all from a member's real open positions — and today it is reachable only through four
assistant-tool call sites (Compass chat, voice, AI Search, `grade_watchlist`'s internal reuse of
its helpers). A member can only see these numbers by asking an AI assistant to compute them on
the fly; there is no page.

## 2. Exact scope

**MUST BUILD** (the smallest change that gives a member a real, paid-gated door to numbers that
already exist):

- **One new read-only route**, `GET /api/portfolio/heat`, calling `portfolio_heat.portfolio_heat(user_id, account_id=account_id, account_size=account_size)` exactly as `voice_tool_impls.py:1869`
  and `coach_chat_tools.py:1671` already do — no new parameters invented, no change to the
  function's signature or return shape. Gated with `require_paid` (`api/middleware/
  auth_middleware.py`), matching the existing idiom in `ai_search.py`/`analyst.py`/`backtest.py`
  rather than a new auth pattern.
- **One new page**, rendering the response's own fields as they already exist: `risk_heat_pct`
  against `caps.aggregate_pct`, `notional_exposure_pct`, the `per_position` table (symbol, side,
  distance to stop, risk %, placeholder-stop flag — surfaced, never hidden, matching
  `portfolio_heat.py`'s own comment that dropping a placeholder-stop position would under-report
  heat), `by_sector`/`concentration_flags`, and `room_to_add_pct`. No new computation, no new
  field invented — this checkpoint is a renderer, not a second implementation.
- **A nav entry**, added the same way any other paid page is added (`NavBar.jsx`/`MoreSheet.jsx`
  — not in `FREE_PAGES`, per G1's answer).

**SHOULD BUILD:** none. Matches the house convention this program has now used three times (S5
CP1, S6 CP1, A12 CP1) for a first checkpoint: a rail or a thin door, never a feature bundle, when
no PRD exists yet for the surface.

**DEFER (named, not silently dropped):**

- **Any corp-actions *event* data** (splits, dividends, M&A, spin-offs, etc.) on this page.
  `portfolio_heat.py` needs none of it and has no provider gap of its own — DEC-08's corp-actions
  calendar is real, separate work, gated on F-09's still-open class-G provider question (no
  source anywhere for M&A/spin-off/rights/buyback/ticker-change events), not part of this
  checkpoint.
- **Any change to `portfolio_heat.py` itself.** This checkpoint reads it, never edits it. The
  4 existing assistant-tool callers are unaffected.
- **A dedicated A14 PRD/spec.** Real, and not invented here — the same posture A12 CP1 already
  took for the same reason (writing one on the spot pre-decides questions nobody has actually
  scoped).
- **Historical/trend views of portfolio heat over time.** `portfolio_heat()` is a point-in-time
  read; a history view would need a new store and is out of scope.

## 3. Current state → target state

**CURRENT STATE**, confirmed this pass:

| Component | State |
|---|---|
| `portfolio_heat.portfolio_heat()` | Built, 204 lines, pure function over `positions_fn`/`regime_fn`/`cap_fn` injection points (already testable). Confirmed unchanged from the citations in OWNER_INPUTS.md G1. |
| Page routes matching `portfolio\|risk\|heat` | **0 of 91** (re-confirmed this pass via the app's route table). |
| Existing callers | 4, all assistant-tool call sites, none a page: `coach_chat_tools.py:1671`, `voice_tool_impls.py:1869`, `ai_search_personal.py`, `grade_watchlist.py` (reuses internal helpers for a different purpose, not a duplicate reader of the aggregate fact). |
| `require_paid` | Already used by `ai_search.py`, `analyst.py`, `backtest.py` — an established idiom, not a new one. |
| `FREE_PAGES` | `['/morning-wire']` — confirmed this pass. A new page is paid-gated by simply not adding it here. |

**TARGET STATE**: a logged-in paid member can open a page and see the same numbers
`portfolio_heat()` already computes for the assistant tools — nothing computed differently,
nothing new stored, nothing free.

**THE GAP**: exactly the MUST-BUILD list in section 2 — one route, one page, one nav entry.

## 4. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Placeholder-stop positions read as confident risk numbers | Under-reports heat, could green-light an over-cap add in a member's own head | `portfolio_heat()` already excludes placeholder-stop positions from `real_risk` and flags them separately (`placeholder_stops`) — this checkpoint must render that flag, not hide it, exactly as the function's own design intends |
| A member with no positions or no account size set sees a confusing blank/zero page | Bad first impression, not a data-correctness risk | `account_size_is_default` is already returned — the page states plainly when it is using a default rather than the member's real account size |
| Scope creep into corp-actions display | Re-opens DEC-08's un-scoped, provider-gapped work inside a small checkpoint | Named explicitly in section 2 DEFER; a reviewer can check the diff touches no corp-actions file |

## 5. Test & acceptance plan

| Test | Proves |
|---|---|
| `test_portfolio_heat_route_requires_paid` | An unpaid/unauthenticated request is rejected, matching `ai_search.py`'s own `require_paid` test pattern |
| `test_portfolio_heat_route_matches_the_function_output` | The route's JSON response is a pass-through of `portfolio_heat()`'s own return dict — no field renamed, added, or dropped in transit |
| `test_placeholder_stop_positions_render_flagged_not_hidden` | A seeded placeholder-stop position appears in the response with `placeholder_stop: true` and a null `risk_pct`, matching the function's own documented behavior |
| `test_page_is_not_in_free_pages` | `FREE_PAGES` does not include the new route — a structural, falsifiable assertion against `freePages.js` itself |

## 6. Owner-bound questions

None. Both blockers this checkpoint depends on (DEC-08, G1) were answered directly by the owner
in the same session that produced this proposal.
