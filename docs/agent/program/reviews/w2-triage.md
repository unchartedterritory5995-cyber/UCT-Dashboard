# W2 release triage (2026-11-03, read-only)
| PR | head | base / stack | commits off master | review | gate | v2 / budget / isolation | conflicts vs rc/w11 b22bb85a36 |
|---|---|---|---|---|---|---|---|
| 726 research.company | 27e228693e | int-w2; root of market stack | 3 (19 files) | review-726-724.md at 73e97cce3c: APPROVE w/ changes, 2 blockers (headline text not figure-gated; research text replayed unwrapped via turn.history_messages/outcome_for_model, research.ask not in LOCAL_ONLY_ACTIONS). Fix claimed; delta 73e97cce3c..27e228693e NOT re-reviewed by me | UCT_AGENT_DATA=1 + kind in UCT_AGENT_DATA_KINDS (fail-closed, default off) | none; no new provider | section_b_requests.json, routing.js, BOARD.md |
| 734 market-b2 | 6e90cd1d9d | int-w2, draft; on 726 | 7 (+4) | none found | same kinds gate | touches app/src/agent/__fixtures__/program/isolation.json (ADR-005 fixture) | same 3 |
| 746 describeSetup | 8dfea43eb1 | int-w2, draft; on 734 | 11 (+4) | none found | UCT_AGENT_DATA_KINDS | isolation.json fixture | section_b, routing.js |
| 731/732/733 planner v2 | a1 145eb337e3 / a3 cc2818c97d / a2 067e7fc709 | int-w2; a2 on a1+a3 | 14 total | none found | UCT_AGENT_PLANNER (v2) + UCT_AGENT_V2_TOOLS, require_admin_dark | v2 by definition; touches turn.py, turn_v2.py, args.py, routers/uct_agent.py (shared v1 path); TURN_USD kept 0.25, model haiku-4-5 referenced; cost tools (dry-run, paid eval gated) | turn.py, turn_v2.py, tests/test_uct_agent_nl1.py |
| 728 webops | 33f7ed0a2d | int-w2; root | 5 (49 files) | none found (Breadth hook-order fix inside) | admin role + per-browser switch (agentFlag), server routes admin-only | none | section_b_requests.json only |
| 741 webops-c2 | a3069a35a0 | int-w2, draft; on 728 | 8 (+3) | none found | same + require_admin_dark | none | section_b_requests.json; vs 746: app/src/agent/builtins.js |
Full-suite counts: none recorded in the reviews I found (726 review ran no suite).

## Recommendation
- Delta review then merge dark (after rc/w11 lands, rebase to fix section_b_requests.json/routing.js/BOARD.md): **#726** (review 73e97cce3c..27e228693e for the 2 blockers).
- Full independent review first: **#728 then #741** (49-58 files, app-level host on every page, Breadth hook fix); **#734, #746** (unreviewed, and they change the isolation fixture).
- HOLD: **#731/#732/#733**: planner v2 must stay off, and they change the shared turn.py/args.py/router used by v1, with 3 conflicts against rc/w11.
- Order: rc/w11 -> 726 -> 734 -> 746; 728 -> 741 (fix builtins.js against 746); v2 stack last.
