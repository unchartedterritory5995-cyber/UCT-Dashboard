# UCT Agent — why it seems to understand but does not execute (diagnostic, 2026-11-02)

Read-only. No paid calls, no production data. Sources: the code on `agent/int`, recorded production acceptance
runs (Phase 2 2026-10-29, Gate C 2026-10-18), QA's audits and held-out sets (#662), agent-sc's scanner review,
agent-md's market-data review (`contracts/MD-1-failure-review.md`), and the free readiness measurement
(`agentNlReadiness.test.js`). M = measured, I = inferred.

## 1. The short answer

1. **Almost nothing is understood deterministically; the model carries every real request.** The fast path
   claims 0/31 discovery questions (M). So "understood but did nothing" is mostly what the model was **shown**
   and what the tools could **express**, not the model failing to read English.
2. **The model is often not shown the tool it needs on the first call** (routing by word lists), or is shown
   fields without labels (M: 14/31 discovery questions before #626; 2/21 in the readiness set today).
3. **Some tools cannot express the follow-up the member asked for** — removing a screen filter, switching the
   universe, a specific past date (M, by code).
4. **Where a deterministic layer *does* decide alone, it can be confidently wrong** — the quote matcher gave 7/44
   and 17/54 wrong answers on blind sets (M). Fixed in #664, pending QA.
5. **Several "didn't do it" answers are correct by design** — dark tools (flags off), F-16 hidden fields, one scan
   per message, unknown symbols. They need better wording, not removal.
6. **The planner has never been measured on these questions.** Whether the remaining gap is exposure (above) or
   model quality (Haiku 4.5) is unknown until a capped evaluation runs.

## 2. Representative failures by the owner's seven classes

| # | Class | Asked | Understood / selected | Where it stopped | Expected? | Smallest safe improvement |
|---|---|---|---|---|---|---|
| 1 | Interpretation | "price of gold", "btc price", "how's the s&p doing", "nvdia price" | Quote matcher read GOLD / BTC / S,P / NVDIA as tickers (0 model calls) | Executed a wrong answer | **No** (M) | Instrument resolution against the canonical ticker index; ask or defer when unsure — **#664** |
| 2 | Interpretation | "nvda price history", "nvda close on friday" | Read as a current quote | Wrong answer | **No** (M) | Temporal intent veto — **#664** |
| 3 | Routing | "RSI over 70", "unusual volume in semis", "earnings in the next 5 days" (14/31) | Screen intent; screener tool not sent | Model spends its last call asking for tools, or answers in words | **No** (M) | Always send the screener group for screen-shaped text, or NL-1 selection (#626 patched the 14, class remains) |
| 4 | Routing | "Maybe ones with good volume that are still above their 20-day" | Follow-up refine; screener not sent on legacy routing | Same as 3 | **No** (M, readiness) | Same as 3; pin the screener group while a screen is the conversation's subject |
| 5 | Routing | "what's ripping this month", "oversold large caps" | Fields sent as bare keys (no labels/units) | Risk of wrong field | **No** (M) | Always send the labelled catalog (#628 patched; class remains) |
| 6 | Missing capability | "now just tech" after a semis screen | Refine adds a sector filter, keeps the industry filter | **Silently** semis ∩ tech | **No** (M, code) | Universe fields replace on refine (proposal, ~20 lines) |
| 7 | Missing capability | "drop the price limit" | No `remove` in screener.run | Model must rebuild the screen from label text, often fails | **No** (M, code) | `remove: [keys]` + wire filters in context (proposal) |
| 8 | Missing capability | "how did NVDA close on Friday" | Bars exist but `stock.dailyBars` takes no date | Model or clarify | Partly | Expose bars.daily's existing `to` (agent-md) |
| 9 | Argument extraction | "names trading over $50M a day" | Hint said latest session; meaning is 30-day average | Executed the wrong field silently | **No** (M) | Fixed — #646 |
| 10 | Argument extraction | "price of apple and microsoft" | Partial symbol list [APPLE] | Wrong answer | **No** (M) | All-or-nothing compounds — #664 |
| 11 | Argument validation | "volume picking up" | Model may pick `vol_ratio` (full session) instead of `rvol_live` (by now) | Plausible wrong field | Risk (I) | One-line definitions for ~20 ambiguous fields in context (the catalog has a `description` attribute; 2/152 use it) |
| 12 | Permission | "show me my strongest stocks", "rank them by RS" | Rating-based screen | Local refusal (F-16) | **Yes** — owner ruling | Offer public alternatives in the refusal, no UCT formula (needs owner's "strength" ruling) |
| 13 | Permission | "screen X and separately screen Y" | Both planned | Second refused: one scan per turn | **Yes** — contract | Wording: "I ran the first; ask again for the second" |
| 14 | Execution / API | Price questions while the gateway is dark | `stock.profile` via `/api/live-prices` | Works; but that route can trigger alert checks | Known | Retire once `stock.quote` is activated |
| 15 | Execution / API | Flags on, `screen.run` not listed in data_kinds | Client took the gateway path | Server refused instead of screening | **No** | Fixed — #639 |
| 16 | Execution / API | Lowercase grid "open daily charts for aapl msft nvda…" (prod 2026-10-29) | Grid reader skipped lowercase → model → reply failed shape check | "UCT Agent returned something unreadable" | **No** | Fixed — #511 |
| 17 | State / stale | "show me my strongest stocks" while the catalog was loading | Fell to the paid planner with `fields: "loading"` | Wrong path | **No** | Fixed — #601 (F-SAT-3) |
| 18 | State / UI | "add the 50" on a chart that already has SMA 50 (Gate C S18) | Added a duplicate silently | Executed, unhelpful | **No** | Say it is already there, or ask |
| 19 | State / UI | "pull up amzon" (Gate C S22) | Correct refusal | No "Did you mean AMZN?" | Partly | Suggest the single clear candidate (the ticker index now supports it, #664) |
| 20 | State / UI | Model describes an action but plans no op | — | NOTHING_DONE guard (honest) | Correct guard; rate unknown | Measure the rate in the capped evaluation; name the described action in the reply |

## 3. Legitimate refusals to keep

Dark tools until activation; isolated kinds (breadth, ratings); F-16 hidden fields; one scan per message; read
budgets; unknown or non-equity instruments; cold symbol index; irreversible actions needing approval; stale-board
refusals at "do it". These protect members — the improvement is clearer wording, not fewer refusals.

## 4. What this means

The Agent's architecture is sound. The visible failures cluster in four places: **what the model is shown**
(routing, labels, definitions), **what the tools can express** (refine semantics, dates), **deterministic layers
that decide alone** (now being fixed for quotes), and **refusal wording**. None needs a new execution system or
new phrase lists. The one thing no code review can answer is how well the planner itself performs; that needs
the capped evaluation the owner has not yet authorized.
