# RESUME.md — exact state to resume from (written 2026-11-03 ≈07:00Z, owner's usage limit approaching)

**Standing instruction at stop time (owner):** do not merge, deploy, activate features, or change approval boundaries. Everything below is saved to branches; nothing is merged beyond what this file says.

## STOP 2 — weekly usage limit (2026-11-03, resets 12pm America/New_York). Read this section first.

All agents were cut off mid-task. Partial work is committed as labelled `WIP:` commits and pushed. Nothing merged, deployed or activated; the merge/deploy freeze stands. Owner decisions in force: D1 Wisdom vocabulary additive (restricted, maintainer review), D2 keep the $0.25 planner cap (efficient planner work authorized). Reviews completed (full texts in the session scratchpad; summaries below are authoritative):

| Item | Branch @ head | State | Next step |
|---|---|---|---|
| Wave 1.1 #725 | agent/w11/args @ d338b2fe64 | READY; review: APPROVE, nothing blocking; full pytest 2222 / vitest 2706 | apply hardening NB-1 (keep explicit "none"), NB-2 (filters:[] only for refinements), NB-3 (protectionRefusal on normalized ops), NB-5 (nonsense detector skips $-prefixed/all-caps tickers); record the inverted NL-1 rail test_legacy_never_coerces |
| Wave 1.1 #727 | agent/w11/routing-f16 @ d53315d2ec (WIP: BLOCKING-1 in progress) | review: 2 BLOCKING | BLOCKING-1 narrow false_capability_claim() to indicator alerts + layout rename, verb-object form, serve the model's reply on repeat; add the six honest-limit probes as negative tests. BLOCKING-2 rs patterns `(?![\s-]line)`, "composite" needs "uct" or a rating word; regenerate scanHidden.js. Owner question: is the A/D line public? |
| Wave 1.1 candidate | agent/rc/w11 (not yet created) | — | create from agent/int, sync master, merge #725 then #727, REGENERATE section_b_requests.json, re-bless SAT-1 / golden / NL-1 parity / cost + fastpath baselines once, full suites, draft PR to master "DO NOT MERGE without owner GO"; conditions 1 and 4 already MET per review; condition 2 needs a final-head review |
| Wave 2 #726 research | agent/w2/market @ 73e97cce3c | review: 2 BLOCKING (B1 web cache keyed by user+turn only → wrong company's commentary; B2 month regex `(?:jan..dec)[a-z]*` matches "declined/market/margin" so figures bypass the gate) + non-blocking list | Builder B had started fixing in rs1.py (check agent/w2/market-b3 @ f634cbfb9b for where the edits landed; fixes belong on agent/w2/market, then merge forward) |
| Wave 2 #734 / W2-B3 | agent/w2/market-b2 @ 7011ee283b; agent/w2/market-b3 @ f634cbfb9b | W2-B3 chart.describeSetup in progress; measurables must equal contract KN-1 v1 (close_vs_sma20, close_vs_sma50, pct_from_52w_high, range_pct_10, rel_volume_50d, sma50_above_sma200, sma50_rising, sma200_rising) | finish, tests ≥ 8, full suites; run never-run full suites on #734 |
| Wave 2 #731/#732/#733 planner | agent/w2/a2-v2-readiness @ 81c369051f | W2-A2 in progress + D2 cost work (domain-tools-first, deferred capability tools, Haiku 5.5 measurement, PLANNER-V2-COST.md) | finish to ≥ 36/39 acceptance; flagship under $0.25 worst case on Haiku 4.5 or report tradeoffs |
| Wave 2 #728 / W2-C2 | agent/w2/webops @ 3dd1224244 (ready); agent/w2/webops-c2 @ 90ce868272 | W2-C2 Explain/Show/Do on pages in progress | finish agentGuidePages tests; full suites; draft PR stacked on #728 |
| Wave 3 #724 | agent/w3/coach @ 4a3250519f | review: 2 BLOCKING (C1 coach turns unguarded under planner v2 → keep coach on v1 or guard v2; C2 "Educational, not advice" footer satisfies the hedge check → strip footer, drop "educational" from hedges) + guard bypasses + alias cleanup (drop flag, breakdown, false breakout, gap up, gap and go, bare generic aliases) | fix on agent/w3/coach, merge forward into coach-journal (#729), coach-workflow (#730 @ 8ee220c309), coach-vocab (VOCABULARY-MAP.md); full suites |
| Trading Brain #735 | agent/kn/knowledge-poc @ 3852446f29 (+docs) | builder's full suites: server 2183 / browser 2655 + 1 timeout flake (qa/modelIsolation "no module reads an isolated kind" near its 15 s budget under load — raise that test's timeout on the RC); independent review NOT finished (cut off twice) | rerun the review against the nine points (brief in this session's history; review file target scratchpad/review-735.md) |
| Wisdom vocab expansion | wisdom/vocab-brain-expansion @ 0aae699f8b (WIP: new test file) | mapping in progress | finish BRAIN-MAPPING-2026-11-03.md (48 rows classified), additive JSON, unchanged-behaviour tests, draft PR for Wisdom maintainer review |

Resume order (owner's priorities): 1) #727 blocking fixes + #725 hardening → assemble agent/rc/w11 → final review; 2) #726 B1/B2 and W2 suites; 3) planner within the cap; 4) coach C1/C2 + suites; 5) #735 review; Wisdom mapping in parallel. To continue a cut-off agent with its context, message it after the reset; otherwise start a fresh agent with this table as its brief.

## Production
- master `463a4bcba5` (Wave 1 combined release, PR #718) promoted and live 2026-11-03 04:30:42Z (bundle `index-ePgCEn0Q.js`); later master commits by other sessions (#720, #721, #709 and more; master head at stop ≈ `e6740b5b08`) were promoted on top by their own gates — they contain Wave 1 and touch no Agent file.
- Production flags (read 04:45Z, unchanged since by this program): `UCT_AGENT_STREAM=1`, `UCT_AGENT_DATA=1` with all 11 kinds, `UCT_AGENT_NEWS=1`, `UCT_AGENT_NL1=1`, `UCT_AGENT_SCAN=1`, `AGENT_BREADTH_CURRENT=1`, `UCT_AGENT_DAILY_CAP=3000`; `UCT_AGENT_PLANNER` unset (v2 OFF); `UCT_AGENT_ISOLATED` unset. See FLAGS-INVESTIGATION-2026-11-03.md.
- Phase 1 live test done (LIVE-TESTING-RESULTS-2026-11-03.md): technically deployed, NOT owner-accepted; findings LT-1..LT-12. Disposable layout `W1 Test — 2026-11-03` still exists (owner may delete after Phase 2); owner's UCT Default restored.
- Spend: production Agent ledger ≈ $0.64 for the Phase 1 run (41 model calls). No eval key exists; no paid evaluation has ever run; $0 of the $21 eval budget used.

## Branches and worktrees (all pushed unless marked)
| Branch | Worktree | Base | Purpose | State at stop |
|---|---|---|---|---|
| `agent/int` | C:/w/w1-int | master `e6740b5b08` + program docs | Wave 1 integration / Wave 1.1 RC target | synced with master (10b79c28e6 merge); docs through `06ba3eefcf`+; **no Wave 1.1 code merged** |
| `agent/w11/args` | C:/w/w11-a | agent/int | Wave 1.1 repair-a: LT-3 args tolerance, LT-1 empty-board add, LT-9 rename, LT-10 nonsense | see "Builder reports" below |
| `agent/w11/routing-f16` | C:/w/w11-b | agent/int | Wave 1.1 repair-b: LT-4 routing + no false claims, LT-8/LT-11 hidden phrases + alternative, LT-12 next report | see below |
| `agent/int-w2` | C:/w/w2-int | master `e6740b5b08` | Wave 2 integration (NOT deployed) | no merges yet |
| `agent/w2/intelligence` | C:/w/w2-a | agent/int-w2 | Builder A: multi-turn, v2 eval readiness, args normalizer corpus | see below |
| `agent/w2/market` | C:/w/w2-b | agent/int-w2 | Builder B: research kind/capability, historical analysis, describeSetup | see below |
| `agent/w2/webops` | C:/w/w2-c | agent/int-w2 | Builder C: AgentProvider + page hosts, guide on pages, cross-page workflows | see below |
| `agent/int-w3` | — | agent/int-w2 | Wave 3 integration (NOT deployed) | no merges yet |
| `agent/w3/coach` | C:/w/w3-a | agent/int-w3 | Wave 3 coach: concepts KB + coach.explain, guard suite, consent-gated trade review, coaching workflow, COACH-1 contract | see below |
| `docs/agent-acceleration-audit-2026-11-02` | C:/w/aaudit | master | the audit (Deliverables 1–9, appendices A–H), draft PR #702 | docs only |
| `ci/agent-shard-benchmark` | — | agent/int | shard benchmark trigger branch | measured; keep |
Worktrees share `app/node_modules` by junction to `C:/w/txlinks/app/node_modules` (lockfile identical to master at stop). Python venv: `C:/Users/blake/projects/UCT-Dashboard/.venv`.

## Builder reports at stop
_(filled from each builder's wrap-up message)_
### w2-a (Agent intelligence) — stacked branches a1 → a3 → a2; `agent/w2/intelligence` = stack head b092cf1fcd; base agent/int-w2
- #731 agent/w2/a1-multiturn @ 145eb337e3 — W2-A1 DONE: openQuestion.js (answer | new | cancel; referents), useAgent open-question state, turn.py <open_question> block + rule, 'question-closed' kind; routers/uct_agent.py gains two optional fields (the one file outside the package). agentMultiTurn 56/56, open_question 23/23, full Agent pytest 2182 passed; full vitest re-run was running at wrap-up (scratchpad a1-vitest.log) — NOT CONFIRMED.
- #732 agent/w2/a3-args @ 4043dc1cce — W2-A3 DONE (stacked): api/services/uct_agent/args.py normalize_args/example_args/ArgsRefused hooked into expand_compact_ops + turn_v2 steps; "e.g. args {…}" per catalog line; corpus tests/fixtures/agent_args_corpus.json 155 rows (23 from the live LT-3 failures) scored 155/155; targeted 421 passed; full pytest was running (a3-pytest.log) — NOT CONFIRMED. **Must be reconciled with repair-a's targeted LT-3 tolerance (#725) at integration — two normalizers for the same purpose; keep one.**
- #733 agent/w2/a2-v2-readiness @ b092cf1fcd — W2-A2 WIP (stacked): v2-acceptance.json 38 cases + runner (23/39 pass), tools/agent_v2_cost_dryrun.py (no key/run). **FINDING for the owner:** one full-catalog v2 round's worst-case reservation ≈ $0.22 on Haiku 4.5 vs the $0.25 per-turn cap → v2 could stop after round 1; dry-run worst $0.90 per 4-round turn, $26.95 per set worst / $2.21 expected. Nothing changed; decision needed (raise UCT_AGENT_TURN_USD for v2 tests, or shrink the catalog prompt, or use Haiku 5.5 — all require approval).
- Resume (A2): alias→created-ref mapping in steps.js, runner fixes, rails for tool-search/rounds/$/pause in turn_v2 usage, one cost-test assertion; then full suites; un-draft. Merge order into agent/int-w2: #731 → #732 → #733.

### w2-b (market intelligence) — base agent/int-w2
- agent/w2/market @ 73e97cce3c → PR #726 (ready, complete) — W2-B1 Research RS-1 v1: `research.company` kind (api/services/uct_agent/research/rs1.py) composing served quote/news.company/earnings/fundamentals(+themes), ONE web call per turn via turn._research under Meter.research, figure gate (facts with unreturned figures refused; web sentences stripped), least-fresh class, value-free log; `research.ask` capability (fast path for the 3 default questions), `research` view in present.js/AgentResult, server-gated registration; contracts/RS-1-research.md; MD-1 §4.8 v1.6; licensing row (perplexity, research) = R. Full suites: pytest 2115 passed, vitest 2696 passed/6 skipped (captures regenerated).
- agent/w2/market-b2 @ 7011ee283b → DRAFT PR #734 (stacked) — W2-B2 Historical analysis: bars.daily `from`; stock.dailyBars offHigh/pullbacks/range; `history.eventStudy` kind over the existing market_intel/event_study.py (technical series only; breadth refused pre-read), `history.afterEvent` capability LOCAL_ONLY with value-free replay (history_note.py); isolation.json + breadth mirror pins updated; H42 held-out fixture. Targeted suites green (23+15+112 pytest; 373+50+5 vitest). FULL suites NOT run on this head.
- W2-B3 chart.describeSetup NOT STARTED (design in #734's body).
- Files outside Agent paths: provider_licensing_class.py (1 row), market_intel/series_adapters.py (+gap_pct), price_reads.py (+daily_open_close) — wiring only.
- All kinds default OFF (UCT_AGENT_DATA_KINDS fail-closed): research.company, history.eventStudy. No new connection/scheduler/DB/engine.
- Resume: full suites on 7011ee283b under the lock; `gh pr ready 734`; independent review (figure gate, isolation of the event-study path, licensing wording); merge order into agent/int-w2: #726 → #734; then W2-B3 on agent/w2/market-b3 from 7011ee283b.

### w3-a (Wave 3 coach) — three stacked branches, base agent/int-w3; flag UCT_AGENT_COACH default OFF, admin-only
- agent/w3/coach @ 4a3250519f → PR #724 (ready, NOT draft; agent-ci green): W3-1 coach.explain over 13 reviewed concepts (docs/agent/coach/concepts) + one grounded observation from bars.daily; W3-2 guard (unsupported/order/figure/uncertainty) applied to every coach reply, 32 violating / 12 clean fixture, mutation note. Full suites: pytest 2180, vitest 2640/6 skipped.
- agent/w3/coach-journal @ aadadf7b3e → DRAFT PR #729 (stacked): W3-3 coach.consent (conversation state `coachConsent`, owner-scoped), journal.reviewTrades (consent-gated, descriptive stats, model sees only a sanitized view), journal.proposeNote (always proposed). Targeted tests green; FULL suites NOT run.
- agent/w3/coach-workflow @ a45050c296 → DRAFT PR #730 "WIP" (stacked): W3-4 next-step quick replies + structured-block rails; 1 of 8 pytest assertions red (test-only expectation order). FULL suites NOT run.
- W3-5/W3-6 blocked on Wave 2; contract docs/agent/program/contracts/COACH-1.md written.
- Outside package paths: tests/test_uct_agent_contract.py (_GROUP_OF +coach/journal). Golden unchanged (gated registration). Pre-existing unrelated red on base: src/noRegexLookbehind.test.js.
- Resume: fix the one expectation in tests/test_uct_agent_coach_workflow.py; full suites on aadadf7b3e and the fixed head; counts into #729/#730; independent review (consent gating, value-free telemetry, no j2 writes except proposeNote); merge order into agent/int-w3: #724 → #729 → #730 — only with the owner's go.

### w2-c (website operations) — agent/w2/webops @ 4c89b53ba2 — DRAFT PR #728 (base agent/int-w2)
- W2-C1 DONE (state pr): AgentProvider in App.jsx (admin + switch; dark otherwise) owns the panel on non-charts pages; page hosts for /screener (read + screener.openSaved via the page's own door, exact Undo), /breadth (read-only), /calendar (calendar.nextReport, calendar.day), /journal (journal.listNotes, journal.createNote via noteCreation.createNoteViaApi; Undo = trash); queries now surfaces ['*']; dock button on the four pages; /charts keeps its own host (one hook call). Golden +2 topic enum values only.
- W2-C2 NOT STARTED (design in the PR body / BOARD W2-C section); W2-C3 NOT STARTED (design recorded).
- Tests: new page tests (30); targeted batch 1359 passed; full Agent vitest first run 2715 passed / 3 failed → the 3 rails fixed (219/219 targeted); full pytest 2095 passed; a second full run was queued behind the suite lock (logs full-vitest-c1b.log / full-pytest-c1b.log in the session scratchpad) — NOT CONFIRMED.
- Files outside app/src/agent (minimal, listed in PR): App.jsx, ChartsWorkspace.jsx (import + hook), ScannerShell.jsx, FocusScreener.jsx, FocusTopBar.jsx, Breadth.jsx, Calendar.jsx, CalendarHeader.jsx, JournalLayout.jsx.
- Resume: full vitest+pytest in C:/w/w2-c under the lock; counts into #728; independent review (focus: page writers canonical, no DOM control, Undo exact, charts behaviour byte-identical); then W2-C2 on a stacked branch agent/w2/webops-c2, then W2-C3.

### repair-b — agent/w11/routing-f16 @ b923e69f8c — DRAFT PR #727 (base agent/int)
- R-04 DONE (indicatorAlerts routing trigger words; prompt rule "never a false limitation"; false_capability_claim() → one server repair round, else clarify; need_groups reroute when the family is in an unsent group), R-05 DONE (hidden.py HIDDEN_PHRASES 30 patterns + generated scanHidden.js mirror; refusal_for_text = F-16 sentence + public alternative on refinements AND new screens; fast path claims hidden-phrase requests with 0 calls; no rs_line_trend substitution), R-06 DONE (earnings lead line "next report: <date>"; F-16/F-23 rails green).
- Tests: new 76 pytest + 85 vitest; full Agent vitest via lock 155 files passed / 5 skipped; full Agent pytest run 1: 2183 passed / 1 failed (cost baseline, regenerated since); run 2 was still running at wrap-up (log in the session scratchpad: pytest_full2.log) — NOT CONFIRMED.
- Measurements regenerated: fast-path corpus, cost baseline (64→62 calls), SAT-1 capture, NL-1 parity. All files inside Agent paths.
- Resume: re-run `python tools/agent_suite_lock.py run --who repair-b -- python -m pytest tests/test_uct_agent*.py tests/test_agent_eval*.py -q` in C:/w/w11-b; independent review; `gh pr ready 727`. Live re-verification of LT-4 only possible after a deploy (R-08).
- Integration note: #725 and #727 both touch turn.py, routing.js, screener.js and the SAT capture — expect a merge to resolve; merge #725 first, then #727 (re-bless the SAT capture once on agent/int).

### repair-a — agent/w11/args @ 74a9b21cf4 — DRAFT PR #725 (base agent/int)
- R-01 DONE (args tolerance: per-capability argAliases/coerce/defaults/shape; turn.normalize_args on compact/strict/v2 paths; registry normalizeArgs; catalog prints SHAPE lines; bgMode row made ELIGIBLE so "turn the gradient off" is a 0-call fast path; chart.replay exit words; screener refinement sort shapes; widget.addCharts shapes), R-02 DONE (empty-board add → one new chart, fast path), R-03 DONE (protected rename refused by name, 0 calls; nonsense → deterministic clarify with 5 choices; 5xx keeps FAILED).
- Tests: FULL Agent pytest 2222 passed (125 new, incl. tests/test_uct_agent_args_live_shapes.py); targeted vitest 354 passed (new agentW11RepairA.test.jsx); FULL vitest src/agent NOT CONFIRMED (was running at wrap-up).
- Outside the expected set: app/src/components/chart/chartSettingsDescriptors.js (one bgMode ELIGIBLE row), docs/agent/CAPABILITY-CONTRACT.md.
- Resume: `cd C:/w/w11-a/app && python ../tools/agent_suite_lock.py run --who repair-a -- npx vitest run src/agent/`; fix failures; independent review; then `gh pr ready 725`. Live-model shapes were reconstructed from schemas (no production logs) — the live rerun after deploy is the real check.


## Open PRs at stop
- #702 docs audit (draft, master) — leave.
- #723 (peer session, docs only): Brain Pack → Agent integration proposal; owner decisions D1–D6 pending.
- #735 (peer session blake-d8, DRAFT, agent/kn/knowledge-poc @ f80c3c5de9 → agent/int-w2): Trading Brain knowledge kinds (knowledge.search / setup.playbook / setup.record) behind `UCT_AGENT_KNOWLEDGE` (default off; dark; enabled_kinds drops them while off — check that gateway change at reconciliation); six additive hooks landed; full suites server 2156 / browser 2653, 0 failed; two review rounds; resume note docs/agent/program/RESUME-KN.md on that branch. Owner-authorized overnight; merge only with the rest when merges reopen.
- Wave 1.1 / Wave 2 / Wave 3 draft PRs: listed in the builder reports.

## Running / unfinished tests at stop
- Each builder's full Agent suite run through `tools/agent_suite_lock.py` may have been cut short by the wrap-up; the PR bodies say which suites completed. CI (`agent ci`) runs on every pushed `agent/**` branch; check `gh run list --workflow "agent ci" --branch <branch>` for the head's result before trusting local claims.

## Next steps to resume (in order)
1. `git fetch origin`; read BOARD.md (states) and this file; check `gh pr list --state open --base agent/int`, `--base agent/int-w2`, `--base agent/int-w3`.
2. Wave 1.1: for #(repair-a) and #(repair-b): run the independent review (diff only, security checklist as in QA-W1-COMBINED.md), fix findings, get agent-ci green on the heads, merge into `agent/int` in order a → b, re-sync master, run the combined suites, fill RELEASE-W11-CHECKLIST.md, then open the RC PR to master — **merge/deploy only with the owner's explicit GO** (the conditional overnight authorization lapsed when the owner asked for no merges).
3. After a Wave 1.1 deploy: rerun the failed live scenarios (LIVE-TESTING.md block list; the turn log's X rows) on the disposable layout; record in a new LIVE-TESTING-RESULTS-<date>.md; read `charts_active_template` (read-only) for R-07.
4. Phase 2 owner acceptance session (OWNER-ACCEPTANCE.md, 38 prompts) — the owner tests personally.
5. Wave 2: review + merge each builder PR into `agent/int-w2` on green CI; score the 10 acceptance examples in PROGRAM.md end to end; reconcile W2-A3 (general args normalizer) with repair-a's targeted tolerance when `agent/int` and `agent/int-w2` are reconciled (sync `agent/int-w2` from master after Wave 1.1 ships).
6. Wave 3: review + merge coach PRs into `agent/int-w3`; W3-5/W3-6 unblock only after W2-B2/B3 are merged and reviewed; sync `agent/int-w3` from `agent/int-w2`.
7. Owner decisions outstanding: eval key + Console workspace limit + cap file (for any paid eval); `UCT_AGENT_NL1=1` in production (confirm or unset); `UCT_AGENT_DAILY_CAP=3000` (lower before member rollout); #723 D1–D6; Wave 2/3 deploy approvals (none given).
