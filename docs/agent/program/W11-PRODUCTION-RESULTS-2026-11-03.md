# Wave 1.1: production deployment and live results (2026-11-03)

**Deployed:** PR #747 was merged to master as `4ea661a8d8` (candidate head 8f61f8dd67 = reviewed b3ed064223 plus master syncs, which are byte-identical to master's own changes). The master deploy gate passed, `production` = `4ea661a8d8` (promote run 41732106142), and the web pod restarted at about 22:49Z. The live bundle is `assets/index-C5u5Ek0-.js`.

**The master gate was red before the merge.** Run on 5d95103c8a, it failed in `test_uct_agent_scan_screen.py::test_zero_matches…`. The cause was a time bomb in the test: the fixture is dated 2026-10-30 and the test read the wall clock, so it failed once the 11-03 close passed. That was fixed test-only by PR #753 (independently reviewed), merged as d8d4f0937d, and the gate went green.

## Production checks
| Check | Result |
|---|---|
| `/api/health` | ok, uptime reset after promote |
| Anonymous `/api/agent/config` | 401 |
| Admin config | stream, nl1, news, data and scan true; planner v1; the same 11 data kinds; no knowledge or coach |
| Railway web variables (read-only, before and after) | unchanged: no UCT_AGENT_PLANNER, KNOWLEDGE or COACH; DATA_KINDS hash unchanged |
| Planner v2 step route | answers "No step is waiting for that turn" (404); planner is v1 |
| Budget | $5 cap unchanged; the live rerun cost $0.14 over 8 settled calls |

## Live rerun of this morning's failures (test layout `W1 Test — 2026-11-03`, new chat)
| Finding | Prompt | Result |
|---|---|---|
| LT-3 | turn the gradient off on this chart | PASS: "Nothing to change — Gradient background is already solid." Args now understood |
| LT-3 | sort them by 3 month performance (after a screen) | PASS: sorted by 3-month change |
| LT-4 | mark when the 9 ema crosses above the 20 on this chart | PASS for routing: a clarify offers "Add an indicator alert", with no false limitation. **New LT-13:** the create step then refused safely ("There's no indicator 'EMA 9'…") because the model named the indicator rather than its id; nothing changed |
| LT-8 | now only the ones with rs rank over 90 | PASS: F-16 refusal with the public alternative |
| LT-9 | rename Main Trading to x | PASS: protected-layout sentence |
| LT-10 | asdf qwer | PASS: clarify with 5 choices |
| LT-11 | show me my strongest stocks | PASS: refusal plus the public alternative (3-month change) |
| LT-12 | when does nvda report / when does amd report | Card PASS: it says "Next report date: not available in UCT's earnings data". **SERIOUS LT-14:** the model's own reply line INVENTS a next date ("January 2027") and beat/miss results that the card contradicts ("no comparable estimate"). Reproduced on 2 tickers |
| LT-1 | add a daily chart of amd to this board | PASS: chart added |
| Undo | undo that | PASS: "Undid: Added a Chart"; test layout back to one chart |

Side effect: my first message ("turn the gradient off on this chart") went into the owner's existing 12:05 AM conversation, because the new-chat click missed. Every later turn used a new chat. The owner's active layout (Gate C Accept 1018) was restored at the end.

## Decision
LT-14 is a financial-accuracy failure in the model's reply text. The deterministic card is correct, the Agent is admin-only, and production health is not degraded. So there was **no rollback**: a rollback would restore LT-1/3/4/8/9/10/11. Instead:
- A deterministic hotfix ("data answers never carry model-invented facts in the reply line") is being built with an independent review.
- Release train 2 (#754) is HELD until the hotfix is live, because it adds live describeSetup / dailyBars answers with the same model-prose exposure.

## LT-14 hotfix: live
PR #755 (independently reviewed: APPROVE) was merged to master as fa5b9751d9, the gate passed, and production = fa5b9751d9; the pod restarted at 23:52Z. The live re-check in a new chat: "when does nvda report" and "when does amd report" now show only the earnings card, with no model-written date or beat/miss line. **LT-14 is resolved.** The rule: a plan made only of data reads (turn.DATA_READ_ACTIONS) is served with an empty model reply, so the card leads. Write plans, clarifies, refusals and grounded research answers keep their text.

## Release train 2
PR #754 (integration review APPROVE; sync delta review APPROVE; agent ci green on 4107befe3f) was merged to master as 3d3d444d4f after the hotfix was verified live.

## Release train 2: live (2026-11-04 00:36Z)
PR #754 was merged as master 3d3d444d4f. The gate passed in 35 min, which is close to its 40-min limit. `production` = 3d3d444d4f, and the pod restarted at 00:36Z.

Production checks:
- health is ok; anonymous config gets 401; planner v1; the same 11 kinds;
- no knowledge kinds; research.company and history.eventStudy are absent;
- `coach: false`, and /api/agent/coach/concepts returns 404;
- the Railway Agent variables equal the pre-release baseline (no KNOWLEDGE, COACH or PLANNER; the DATA_KINDS hash is unchanged).

Live features:
- "describe the setup on this chart": a clarify asks "Which chart?" with 4 choices. Picking NVDA gives the deterministic setup card with dated measurables and "Descriptive, not a recommendation", and no model reply line. PASS.
- "nvda pullbacks": a dated pullback table (depth, sessions to low, recovered). PASS.
- New minor finding LT-15: "describe the setup on nvda" (a symbol, not a chart) replied "Checking NVDA's daily setup now." and no card followed. A talk reply announced work that never ran.

Budget: $0.22 of $5 today (13 calls).

In flight, not merged:
- #758, W2 follow-ups: webops hygiene, research separation, LT-13 indicator references (LT-13 now gives an honest "the alert catalog has no MA cross" refusal).
- #757, coach pre-activation: #751 B-1 fix, guard recall 50%→60% on a held-out set, citation-based definition check, naming exclusion.
- agent/kn/grounded-reply: Brain grounded response.
- #751: mention-refine, waiting for #757's B-1 fix.
