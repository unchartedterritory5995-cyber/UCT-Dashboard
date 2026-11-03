# Wave 1 combined release manifest — UCT Agent

**Candidate:** `agent/int` @ `fded87e447` = `origin/master` `7b6b7a1b4f` + Wave 1 (zero behind master). Prepared 2026-11-03 by the integrator (session AUDIT). **Status: DEPLOYED 2026-11-03.** Owner GO received; PR #718 merged to master as `463a4bcba5` (final RC head 6342332731 = master ad571054dd + Wave 1); master deploy gate passed (both Agent suites inside the gate: server 2095 passed); promoted 04:21Z (`production` = 463a4bcba5); live on the web pod at **04:30:42Z** (uptime reset, bundle `assets/index-ePgCEn0Q.js`; `/api/health` ok; anonymous `/api/agent/config` → 401). **No flag changed; nothing activated; planner v2 off.** Phase 1 live testing is next; Wave 1 is 'technically deployed', not owner-accepted.

## 1. Included work (merge commits on agent/int, in order)

| Merge | PR | Package | Independent review | CI on PR head |
|---|---|---|---|---|
| 9b298d2c52 | #704 | W1-SEC: F-16 enforcement (#654 #657 #661 by merge) + F-23 half-day (#666) + lead test patch | round 1 found a server rank-key bypass (fixed 14750ed95e, mutation 39 red on old code); round 2 APPROVE | green (2b0c3d6f60) |
| 574e18cbc7 | #705 | W1-C: quote reads off `/api/live-prices` onto the gateway; fundamentals/earnings/news.company/themes wired; profile never degraded | APPROVE | green |
| 357126c17b | #706 | W1-C: index/commodity/crypto kinds, licence-driven (all decline today), resolver routes, freshness corpus regen, index.quote delayed | APPROVE after 2 changes | green |
| 115353ff60 | #708 | W1-C: server-persisted scan refinement state + F-16 public alternatives; flagship scan slice (scripted) | APPROVE (+ label cap hardening) | green |
| d3cad38a71 | #707 | W1-B: 7 time-anchored drawing tools; dated-close/range measures on `stock.dailyBars` | APPROVE after changes (capture root cause: typo corrector) | green |
| 799b5ec7ae | #711 | W1-B: `indicatorAlert` kind (create confirm / toggle / delete) over `useIndicatorAlerts.js` writers (hook unmodified); 26 chart settings KNOWN→eligible | APPROVE after changes (GUARDED mirror) | green |
| 53f6607acc | #715 | W1-B: `widget.setOption` (bounded numbers), `chart.replay`, flagship operator slice (scripted) | APPROVE after changes (number bounds) | green |
| bd5e95b4ee | #712 | W1-A: STEP-1 contract; `UCT_AGENT_EFFORT`; cumulative $21 eval ledger wired into all 5 eval tools; daily spend report; 31 ledger tests incl. the owner's six proofs | APPROVE after 2 changes (ledger path pin, chain settlement) + Linux path fix | green |
| a64ce73846 | #713 | W1-A: `run_turn_v2` tool-use loop behind `UCT_AGENT_PLANNER=v2` (default OFF); routes `/turn/step`, `/turn/resume` | APPROVE | green |
| 1451d0e0f9 | #714 | W1-A: browser step executor, v2 branch in `useAgent` (guarded), flagship v2 test (scripted); Undo-group fix | APPROVE after 1 change; conflict with W1-B/C resolved (one import hunk) | green (d381927643) |
| ce68db88a0 | #716 | agent-lead: count/list-of-stocks questions reach the Screener, never the web; SAT-1 + NL-1 parity captures re-blessed once | AUDIT APPROVE; agent-sc GO; agent-qa GO | (red on its own stale branch = capture; green after re-bless on agent/int) |
| 3356d5a4b2 … 537833390e | — | Agent CI: `agent-ci.yml` (server + 4 shards + union rail), `agent-ci-benchmark.yml`; deploy-gate rail amendment (owner-approved); duplicate-run skip | — | — |
| 8b9be22328 … | — | Program record: PROGRAM.md, BOARD.md, EVAL.md, STEP-1.md, LIVE-TESTING.md, OWNER-ACCEPTANCE.md | — | — |

Diffstat vs master (before the last master fold): 147 files, +11,874 / −755. Golden manifest: 121 → 133 capabilities (+12: 7 `drawing.add*`, `indicatorAlert.create/toggle/delete`, `chart.replay`, `widget.setOption`); plus server-gated `stock.themes` and the three asset kinds registered only when served.

## 2. Combined test results on the candidate

| Suite | Head | Result |
|---|---|---|
| Agent pytest (`tests/test_uct_agent*.py`, production dependency set, local venv) | ce68db88a0 | **2095 passed, 0 failed** |
| Agent vitest, 4 shards + union rail (CI run 41569637080) | ce68db88a0 | **162 files, 2688 passed, 0 failed**; union rail: every expected file ran (the union job itself was cancelled by the next push after printing its verdict) |
| Agent CI on the RC head (run 41570819301) | 2502eef7dd (= fded87e447 + docs) | **green**: server 2095 passed; browser 162 files, 2688 passed, 0 failed; union rail green |
| Independent QA (combined head) | ce68db88a0 | **GO** — 10/10 checks pass (`QA-W1-COMBINED.md`): dark-by-default 13/13 flags; 19/19 routes admin-gated; isolation/F-16 145 pytest + 207 vitest; no live-prices path; budgets unchanged; gate file unchanged; manifest +12/−0; flagship scripted proofs; 9 outside-Agent files all judged safe. Notes: N1 add PUT to the member-refused route enumeration (follow-up); N2 `narrative_cost_guard` Sonnet 5.5 cache-read estimate halves (caps unchanged; owner awareness); N3 `widgets/registry.js` +4/−4 min/max rows (safe) |

Scripted-model proofs (NOT live-model results): `agentFlagshipOperator`, `agentFlagshipScan`, `agentFlagshipV2`, `test_uct_agent_scan_flagship.py`.

## 3. Security results

- F-16: 35-field hidden set (superset of the ruling's 26) enforced server-side in filter/other/logic/arith/sort/rank (both `key` and `column`)/columns/named views/saved screens; client catalog, prompt and glossary carry none; isolation-audit cells 23/24 PROVEN; mutation checks: un-hide → 10 red; old rank validate → 39 red.
- F-23: `marketdata/sessions.py` last completed session honours half-day closes for bars.daily/ratings/themes (residual: screener staleness note still 16:00 rule, pre-existing).
- ADR-005: unchanged; new kinds not isolated (vendor quotes); step results value-free for isolated kinds in v2.
- Access: every `/api/agent/*` route `require_admin_dark`; G4 rail (403 before any provider call) extended to the new routes.
- Side effects: no Agent path calls `/api/live-prices` (rail `qa/noLivePrices.test.js`); flow untouched.
- Budgets: `budget.py` / `limits.py` unchanged (0 lines); eval ledger not importable from `api/`.
- Licensing: index/commodity/crypto served only from A/LA licence rows — none in force, so every such read is an honest decline.
- Gate: `master-deploy-gate.yml` unchanged; its Agent steps mandatory; amended rail allows only the two `promotion-gate: no` workflows by name.

## 4. Proposed feature flags on promotion (admin-only; owner sets them)

| Step | Flag | Precondition | Proposed |
|---|---|---|---|
| 1 | `UCT_AGENT_STREAM=1` | production flags verified (owner's read-only command) | yes |
| 2 | `UCT_AGENT_DATA=1`, `UCT_AGENT_DATA_KINDS=quote,quotes,instrument.resolve` | QA GO #672/#697 | yes |
| 3 | `+bars.daily` in `UCT_AGENT_DATA_KINDS` | F-23 on master (this RC) + production verification | after Phase 1 verification |
| 4 | `UCT_AGENT_NEWS=1` | #692 QA verdict or the owner's own smoke | yes, after the smoke |
| 5 | `UCT_AGENT_SCAN=1` (already ON in production by the owner's interim choice) | F-16 enforcement on master (this RC) + isolation rails green in the gate + production verification | keep ON; verify first |
| 6 | `UCT_AGENT_DATA_KINDS` + `screen.run,screen.saved,screen.count` | same as 5 | as today |
| 7 | `UCT_AGENT_PLANNER` | **stays unset (v1)** pending real-model evaluation and separate approval | no |
| 8 | `UCT_AGENT_ISOLATED`, `UCT_AGENT_NL1`, `AGENT_BREADTH_CURRENT`, `UCT_AGENT_EFFORT` | — | stay unset |

Member access unchanged (`require_admin_dark`). No new data kind beyond those listed is served until its name is in `UCT_AGENT_DATA_KINDS`.

## 5. Rollback plan

- Code: revert PR prepared as the inverse of the RC merge commit (`git revert -m 1 <merge>`), one push, one gate run, promote. Nothing in the RC migrates data irreversibly: the one new table (`agent_conversation_state`) is additive and ignored by the previous code.
- Flags: set the step-1/2/4 flags back to unset; scans back to the owner's prior setting. Each is a single Railway variable change; no restart of flow-worker in any case.
- Promotion: the master deploy gate decides promotion as today; a red gate holds production at the previous commit.

## 6. Post-deployment (mandatory, owner's rule)

1. Phase 1 — `LIVE-TESTING.md`: pre-flight (deployed SHA = RC merge SHA via live bundle + Railway; admin-only 403 probe; `/api/agent/config` flags; isolation probe), then the blocks A–J with live-model results recorded separately from deterministic ones, cost from `/api/agent/budget`, disposable test objects only, cleanup with fingerprints.
2. Phase 2 — `OWNER-ACCEPTANCE.md`: 38 prompts, five levels, scorecard. Wave 1 = "technically deployed" after Phase 1; "owner-accepted" only after the owner's session; serious execution / financial-accuracy / permission / Undo failures block acceptance.

## 7. Recommendation

**GO** (unconditional: the Agent CI run on the RC head is green, §2). Rationale: every package was independently reviewed (two real findings caught and fixed: the F-16 rank-key bypass and the eval-ledger path override), the combined pytest and the four-shard vitest are green with zero failures on the same content, QA's ten checks pass, the master deploy gate is unchanged and will run both Agent suites itself on the push, nothing is activated by the deploy (every flag default-off, planner v2 off), and the rollback is one revert plus flag resets. Known non-blocking residuals are listed in BOARD.md (AVWAP holiday anchor; SC-2 `remove`; PUT 403 enumeration; screener-staleness 16:00 rule).

**Merge and promote only on the owner's explicit GO.** After promotion: Phase 1 live testing, then flags per §4, then Phase 2 owner acceptance.
