# UCT Agent program — PROGRAM.md (the durable record)

**Authorized by the owner 2026-11-02** (Wave 1 execution directive). This file, `BOARD.md`, `EVAL.md` and `contracts/` are the record. Messages between sessions are notices only. Supersedes `README.md`, `STARTUP-PROMPTS.md` and the per-role status files for Wave 1 onward (kept for history).

## Vision (unchanged)
UCT Agent is the intelligent interface to the whole UCT website: it understands trading language, operates the site's canonical capabilities, answers with grounded market data, and carries out multi-step workflows with approvals, receipts and Undo. The Agent proposes; UCT executes. No engine is duplicated.

## Plan of record
`docs/agent/audit-2026-11-02/` (Deliverables 1–9). Wave 1 = Deliverable 5 + 9.

## Wave 1 packages and owners

| Package | Owner session | Branch | Worktree | Scope |
|---|---|---|---|---|
| W1-A Planner | builder-a | `agent/w1/planner` | `C:/w/w1-a` | tool-use execution loop (`UCT_AGENT_PLANNER=v2`, default off), full catalog via deferred tools, per-step sanitize/approval, multi-step turns, "undo all of that", eval harness prerequisites (effort switch, cost-guard rows), free deterministic tests |
| W1-B Operator | builder-b | `agent/w1/operator` | `C:/w/w1-b` | time-anchored drawings, dated-close phrasing on `stock.dailyBars`, indicator alerts kind, KNOWN→ELIGIBLE chart settings, generic `widget.setOption`, `chart.replay` |
| W1-C Data + scan | builder-c | `agent/w1/data-scan` | `C:/w/w1-c` | server-persisted `lastScreen` refinement state, fundamentals/earnings/news.company/themes wired to capabilities, index/commodity/crypto kinds (dedicated, licensed, or honest decline), legacy `stock.js`/`alert.js` quote reads moved onto the gateway |
| W1-SEC F-16/F-23 | sec-integrator | `agent/w1/f16-f23` | `C:/w/w1-sec` | bring #654, #657, #661, #666 onto current master by MERGE (no history rewrite of other sessions' branches), resolve conflicts, run the isolation/F-16/member rails, open one PR into `agent/int` that supersedes the four |
| W1-I Integration | integrator (this session: AUDIT [549088]) | `agent/int` | `C:/w/w1-int` | PROGRAM/BOARD/EVAL, CI, merges, RCs, activation checklist, independent review per package PR, coordination with other trains |

Ownership = the paths each package touches, listed in `BOARD.md` per task. Anything outside those paths needs the integrator's OK in the PR. `tools/agent_ownership_check.py` roles are historical; the BOARD is the authority for Wave 1.

## Standing rules (owner's restrictions, verbatim in effect)
- No paid model evaluations without separate owner authorization. No production planner model change without separate approval. Spending controls are verified first (see `EVAL.md` §0).
- Do not activate scanning (`UCT_AGENT_SCAN`) until F-16/F-23 protections are merged and independently verified.
- No merge or deploy to production without the normal release approvals (guard → master deploy gate → promote). Builders never merge. The integrator merges into `agent/int` only; RCs to master need the owner's go.
- Do not restart flow-worker. Do not expand Agent access to members (`require_admin_dark` stays). Do not weaken ADR-005 isolation, F-16 hiding, or Massive licensing wording.
- Do not change production CI requirements (the master deploy gate) without separate approval. The new `agent-ci.yml` is additive.
- Everything new ships dark behind a default-off server flag or an admin-only path.

## Machine rules
- Worktrees `C:/w/w1-*` share `app/node_modules` by junction to `C:/w/txlinks/app/node_modules` (lockfile identical to master on 2026-11-02). Never run `npm ci`/`npm install` in them.
- Python: `C:/Users/blake/projects/UCT-Dashboard/.venv/Scripts/python.exe`.
- Targeted test runs (`npx vitest run <files>`, `pytest <files>`) are free to run any time. FULL Agent suites go through `python tools/agent_suite_lock.py run --who <session> -- <cmd>` (2 slots). Never run gate shards in parallel locally. CI does the heavy runs.
- Don't touch worktrees you didn't create. Don't print real market values into a session.

## How work flows
1. Builder reads PROGRAM.md, its BOARD rows, EVAL.md. Works on its branch. Commits small, pushes often.
2. One PR per capability group or kind group into `agent/int` (target ≈ 3–4 PRs per package in Wave 1). The PR lists: BOARD rows closed, tests run (counts), files outside the package's paths (if any, why).
3. Integrator reviews with an independent review subagent (diff only, security checklist), merges in dependency order, regenerates the golden manifest if a capability registered, keeps `agent-ci` green on `agent/int`, updates BOARD.
4. RC1 (operator + data, flags per the activation checklist) and RC2 (planner v2) go to master as combined release candidates with a prepared revert PR, on the owner's go.

## Coordination with other trains (Indicators, News, Chart IQ, Charts)
- Agent branches are `agent/w1/*`; they do not edit `app/src/components/chart/**` except the two items the owner allowed for Wave 1 (`chartSettingsDescriptors.js` ELIGIBLE rows; an alert kind over `hooks/useIndicatorAlerts.js`), each announced to the Indicators/Charts sessions in the PR.
- RC windows are announced a day ahead in BOARD.md and by SendMessage; the Agent RC waits while another train's RC is in the master gate.
- Indicators RC #701 and PR #516 (on hold) are untouched.

## Owner decisions 2026-11-02 (evening)
- APPROVED: the narrowly scoped deploy-gate rail amendment (promotion-gate:no Agent CI workflows allowed, pinned by name; gate coverage intact) — landed on agent/int 3356d5a4b2.
- APPROVED: ONE combined Wave 1 release candidate (F-16/F-23 #704, W1-A #712/#713/#714, W1-B #707/#711/#715, W1-C #705/#706/#708, Agent CI). No separate deploys. After the merges: combined integration run + independent QA on the agent/int head, then a release manifest (commits, CI, security results, proposed flags, rollback plan, GO/HOLD) before any production promotion.
- On promotion: admin-only `UCT_AGENT_STREAM`, quote kinds and `UCT_AGENT_NEWS` only after their specific checks pass; `bars.daily` and `UCT_AGENT_SCAN` only with confirmed F-16/F-23 protections and green isolation rails in the combined RC, followed by production verification.
- Planner v2 (`UCT_AGENT_PLANNER=v2`) stays OFF pending real-model evaluation and separate approval. No paid evaluations, no extra spending, no member rollout, no flow-worker restart.
- MANDATORY after deployment (this and every future major Agent release): Phase 1 Claude-led live production testing and Phase 2 owner hands-on acceptance (Levels 1–5, ≥ 30 prompts, scorecard) — `LIVE-TESTING.md` and `OWNER-ACCEPTANCE.md`. Wave 1 is "technically deployed" after Phase 1 and "owner-accepted" only after the owner's own session and review; serious execution / financial-accuracy / permission / Undo failures block acceptance; unrelated safe development continues meanwhile.

- 2026-11-03 02:30Z (via agent-lead's session, owner's choice): PR #717 (separate "scans release") CLOSED; scans ship in the combined Wave 1 RC; #716 (scan routing, agent-sc GO, agent-qa GO, AUDIT review APPROVE) merges into agent/int last, with one SAT-1 capture re-bless (d26 moves to screener+agent). The owner explicitly chose to keep `UCT_AGENT_SCAN=1` in production (set 01:52Z, admin-only) until the RC ships F-16 enforcement — recorded as an accepted interim exposure, not an oversight. agent-lead's session has ended; the Agent project continues in this integrator session.


## Overnight authorization 2026-11-03 (owner; verbatim intent recorded)
- **Wave 1.1 = Agent-only repairs of the Phase 1 live findings** (LT-1, LT-3, LT-4, LT-8, LT-9, LT-10, LT-11, LT-12; F-16/F-23 isolation re-check; regression tests that reproduce the production failures; investigation of the pre-enabled production flags; read-only verification of `charts_active_template`). One consolidated RC. **Conditional overnight deploy** allowed ONLY if all eight conditions hold (fix-only scope; independent review approves the combined RC; all Agent/security/isolation/master gates pass; no unrelated change, no security weakening, no migration, nothing destructive; no new flag or member access; gate idle + synced with latest master; rollback verified; compatible with current production config). Otherwise HOLD, preserve the RC, continue safe work. After deploy: verify commit/health/auth/budgets/flags, rerun the failed live scenarios within the production Agent budget, never touch real user data. Wave 1.1 is NOT owner-accepted overnight.
- **Wave 2 starts now in parallel** on its own integration branch `agent/int-w2` (from master e6740b5b08): Builder A intelligence (NL/multi-turn, planner v2 eval readiness, multi-step planning, schema-constrained args, deterministic evals; v2 stays OFF), Builder B market intelligence (research capability with citations, historical analysis/comparison, grounded TA workflows, follow-ups, freshness; licensing + F-16 boundaries), Builder C website operations (Agent beyond Charts via canonical APIs, Explain/Show/Do, cross-feature workflows + Undo). Integrator keeps PROGRAM/BOARD/EVAL, CI, independent review, merges green reviewed PRs into `agent/int-w2`, prepares bundled RCs. **Not authorized overnight:** deploying Wave 2; planner v2 ON; the $21 paid eval; spending increases; member access; flow-worker; isolation weakening; destructive tests; unrelated production changes.

### Wave 1.1 / Wave 2 worktrees
| Worktree | Branch | Owner | Scope |
|---|---|---|---|
| C:/w/w11-a | agent/w11/args | repair-a | LT-3 (args off-schema on live model), LT-1 (empty-board add), LT-9 (rename), LT-10 (nonsense → clarify) |
| C:/w/w11-b | agent/w11/routing-f16 | repair-b | LT-4 (indicatorAlerts routing + false-claim wording), LT-8 (hidden-field phrase in refinement → F-16 sentence), LT-11 (public alternative), LT-12 (next report date), F-16/F-23 isolation re-check |
| C:/w/w2-int | agent/int-w2 | integrator | Wave 2 integration |
| C:/w/w2-a | agent/w2/intelligence | w2-a | Builder A |
| C:/w/w2-b | agent/w2/market | w2-b | Builder B |
| C:/w/w2-c | agent/w2/webops | w2-c | Builder C |


## Overnight extension through Wave 3 (owner, 2026-11-03)
Continue Wave 2 aggressively after Wave 1.1; begin Wave 3 (intelligent trading coach foundations) once the relevant Wave 2 foundations are verified — on its own integration branch `agent/int-w3` and worktrees, with independent review, regression tests and explicit dependency checks. Rules: canonical APIs; existing security/privacy/licensing/approval/Undo boundaries; no autonomous trading, order placement or claims of guaranteed profitable setups; Wave 2 and Wave 3 are NOT deployed without separate approval; all new features disabled in production; no unapproved paid evals/spend/model changes; incomplete Wave 2 continues on its highest-priority work; blocked components yield to independent ones. Report actual end-to-end working functionality, not completed code.

### Wave 2 acceptance examples (the 10 the morning report scores; each must execute end to end through the panel harness with the scripted model, and — where a server kind is involved — through the real server with fake providers)
| # | Example (user says) | Package | Expected end-to-end result |
|---|---|---|---|
| 1 | "why is NVDA down today" | W2-B1 | research envelope: facts (every figure from a gateway kind), interpretation, unknowns, dated sources; rendered in three sections |
| 2 | "what catalysts next week for AMD" | W2-B1 | same shape; earnings/news kinds composed; web search ≤ 1 |
| 3 | "how has NVDA behaved after 5%+ earnings gaps" | W2-B2 | event-study table to the member (counts/dates/descriptive stats), value-free summary to the model, "descriptive, not predictive" |
| 4 | "compare this pullback to the last three" | W2-B2 | dated ranges from bars.daily (`from`/`to`), comparison table with freshness |
| 5 | "describe the setup on this chart" / "and on the weekly?" | W2-B3 + W2-A1 | grounded description from served bars/indicators; follow-up keeps the symbol and switches the timeframe |
| 6 | a new request typed while a clarify is open | W2-A1 | the old question closes; the new request runs; no merging |
| 7 | "the other one" / "that alert" after an action | W2-A1 | resolved deterministically against the last result set/receipts; no guessing |
| 8 | the flagship sentence through planner v2 in the scripted harness | W2-A2 | ≥ 30-case v2 acceptance set green; flagship completes with one approval pause and undo-all |
| 9 | "turn the gradient off on this chart" with a wrong-but-recoverable model arg shape | W2-A3 | normalizer makes it valid or refuses explicitly; corpus ≥ 80 rows scored |
| 10 | on /screener: "run my <saved screen> and open the top three on charts"; on /journal: "add this to my notes" from /charts | W2-C1..C3 | page host executes through the page's own writers; cross-page hand-off; Undo names the page |

### Wave 3 (intelligent trading coach) — scope, dependencies, acceptance
| Component | Depends on | Buildable now? |
|---|---|---|
| Educational explanations (price action, volume, risk, position sizing, market conditions) with "educational, not advice" rails | none (curated knowledge base in the repo, reviewed) | yes |
| Coaching conversation + follow-up workflow (ask → explain → check understanding → next step), explicit uncertainty | W2-A1 multi-turn (merged) for threading; otherwise single-turn | partially now |
| Trade review / journaling foundations: read the member's OWN trades/notes via `/api/j2/*` with explicit per-conversation consent; descriptive review only (win rate, R, holding time, rule adherence) — never a recommendation; no writes except a proposed note | none for reads; W2-C1 journal host for page context | yes (consent-gated) |
| Trade setup analysis and explanation | W2-B3 `chart.describeSetup` (merged + reviewed) | after W2-B3 |
| Historical setup comparison | W2-B2 `history.eventStudy` / dated ranges (merged + reviewed) | after W2-B2 |
| Deterministic evaluation suite: factual accuracy (every figure traceable), uncertainty stated, unsupported conclusions refused (no "guaranteed", "will", "sure thing"), no order/trading language | none | yes |
Acceptance (Wave 3): (a) "explain what a tight consolidation means and why volume matters" → grounded educational answer, no figure invented; (b) "review my last 10 trades" → consent prompt → descriptive review from the member's own journal rows, value-free in telemetry; (c) "what's the setup here" on a chart → uses `chart.describeSetup` output, adds the educational layer, never a target or guarantee; (d) "how did names with this setup do before" → uses the Wave 2 event-study kind; (e) coaching follow-ups keep context; (f) the eval suite's unsupported-claim detector blocks at least 20 adversarial phrasings. All Wave 3 capabilities default OFF behind `UCT_AGENT_COACH` (new server flag, default off) and admin-only.


## Trading Brain integration (owner mission 2026-11-03, after the usage-limit pause)
AUDIT is the integrator for PR #735 (agent/kn/knowledge-poc, Trading Brain knowledge kinds: knowledge.search, setup.playbook, setup.record; 5,270 admitted entries; default-deny source policy; flag `UCT_AGENT_KNOWLEDGE` default off). Phases: (1) independent code review against the owner's nine points; fix integration defects with review + regression tests; (2) combined trading-analysis workflows — Example A knowledge definition with sources; B "analyze NVDA against UCT's momentum breakout criteria" (criteria → served evidence vs interpretation; needs W2-B3 chart.describeSetup + a criteria mapping); C historical research with sample sizes/uncertainty, never a proven edge; D scan + knowledge + workspace; (3) repeatable deterministic with-Brain vs without-Brain evaluation (definitions, setup interpretation, grounding, attribution, statistics, ambiguity, freshness, refusals, multi-step, regression) — free first, no paid evals; (4) ONE coordinated integration candidate `agent/rc/brain-w2` (agent/int-w2 + #735 + the Wave 2 PRs it needs), independently reviewed, all tests passing; (5) report with GO/HOLD. Boundaries: preserve everything built; admin-only; knowledge flags stay OFF in production; no new admitted sources; no proprietary exposure; no paid evals; no merge to master or deploy without explicit approval; do not interrupt Wave 1.1/2/3. Wisdom vocabulary is the authoritative setup terminology (the Wave 3 coach KB must map to it). Merges into shared integration branches remain frozen; the candidate branch is where assembly happens.


## Owner decisions 2026-11-03 (after the Fable-limit recovery)
- **D1 Wisdom vocabulary: APPROVED WITH RESTRICTIONS.** Additive expansion of the authoritative Wisdom setup vocabulary to cover the missing Brain templates: map all 48; separate missing concepts from aliases/synonyms/overlaps; preserve canonical IDs and behaviour; resolve ambiguity explicitly; no change to the Wisdom scoring engine, setup evaluation logic, historical statistics or the partner's Brain; Wisdom maintainer review before merge; tests proving existing Wisdom behaviour unchanged; any substantive methodology change is HELD for the owner. Work: branch `wisdom/vocab-brain-expansion` (C:/w/wv-1), draft PR, DO NOT MERGE.
- **D2 Planner v2 cost cap: KEEP $0.25 per turn.** Authorized: efficient planner architecture (relevant capability selection, smaller catalogs, deferred tool discovery, prompt/token optimization, cost-aware routing incl. evaluating Haiku 5.5). No production model switch; v2 stays OFF; free deterministic tests first; paid evals only within separately approved limits; measure tokens, cost, routing and tool-selection accuracy, multi-step success; if quality cannot fit the cap, report tradeoffs, never weaken the limit.
- Freeze unchanged: no merge or deploy without explicit approval. Priorities: (1) Wave 1.1 reviews, (2) Wave 2 integration issues, (3) planner v2 readiness within the cap, (4) Wave 3 coach testing, (5) #735 review and cross-wave compatibility.


## Owner decisions at resume (after the weekly-limit reset, 2026-11-03)
- **A/D line:** approved as a PUBLIC Screener field only if it is the conventional accumulation/distribution line computed entirely from public OHLCV with the canonical calculation; the UCT `accdis` rating stays hidden (F-16). If only the proprietary field exists → HOLD and report.
- **Wave 1.1:** GO to finish and prepare the combined candidate (#727 blocking fixes, #725 hardening, assembly on agent/rc/w11, full tests, independent review). NOT merged or deployed; the release decision comes back to the owner with the exact commit, tests, security assessment, rollback plan and GO/HOLD.
- Resume priorities: 1 Wave 1.1 · 2 research B1/B2 · 3 planner within $0.25 · 4 coach C1/C2 · 5 #735 review · 6 chart setup, Explain/Show/Do, Wisdom mapping in parallel. Waves 2/3 and the Brain must not delay Wave 1.1.


## Owner decisions on #735 (Trading Brain), 2026-11-03
1. **Archive freshness:** keep the fail-safe — no archive figures or verdicts without a trustworthy as-of date reflecting the underlying calculation (not the export time). Coordinate an additive metadata change with the archive owner; never modify the archive pipeline without that owner's approval.
2. **Model access to team knowledge: CONDITIONALLY APPROVED for design and testing** — admin-only; existing provider agreements/data-handling terms verified; only approved team-owned sources; no restricted scores, credentials or unrelated private data; passages are untrusted data, never instructions; only the excerpts needed; existing cost/model limits enforced. NOT production activation; NOT new paid evaluations.
3. **Transcript retention: NOT APPROVED.** Document what is stored, where, who can access it, how long, and provider retention; prefer source IDs, version metadata and citations over passage text; return a minimal-retention proposal for approval (branch agent/kn/retention-proposal, design only).
4. Next: independent re-review of the #735 fixes (signed statistics, data-vs-instructions frame, injection guard, the isolation-test timeout); GO/HOLD for eventual integration; no merge/deploy/flags/access changes without explicit approval.


## Owner policy decisions on #735 (B4, N3, N5), 2026-11-03
- **B4:** conditional approval stands (minimal, relevant excerpts of approved team-owned knowledge to the existing authorized provider, admin-only). Before any production activation: verify the provider's data-handling terms and UCT's logging/transcript behaviour. No raw retrieved passages persisted in transcripts, logs, traces or analytics without a separately approved retention policy; prefer source ids, versions, citations. Not activation; not paid evals.
- **N3:** the same default-deny source policy applies to setup templates and historical records; presence in the Brain Pack is not approval; provenance, licensing, freshness and permission metadata preserved.
- **N5:** the approved playbook + Wisdom vocabulary are authoritative for setup definitions/methodology; the Wave 3 coach does educational interpretation, teaching and application, using the playbook definition as evidence; no competing definitions or engines. Concept questions → playbook; coaching requests → coach.
- Undated archive figures/verdicts stay withheld; the recurring browser-suite timeout must be resolved or isolated before final release approval; Wisdom expansion coordinated with its maintainer.

## Activation checklist (admin-only; owner sets flags; order is mandatory)
1. `UCT_AGENT_STREAM=1` — after production flags are verified.
2. `UCT_AGENT_DATA=1`, `UCT_AGENT_DATA_KINDS=quote,quotes,instrument.resolve` — after RC1.
3. add `bars.daily` — only after F-23 (#666 content) is on master.
4. `UCT_AGENT_NEWS=1` — after the #692 QA verdict is recorded.
5. `UCT_AGENT_SCAN=1` — only after F-16 (#654/#657/#661 content) is on master, isolation audit cells 23/24 closed, rails green, and an independent verification is recorded in BOARD.
6. `UCT_AGENT_PLANNER=v2` — only after the sealed-set result meets target with 0 FAIL and the owner approves the model.
7. `UCT_AGENT_ISOLATED`, `UCT_AGENT_NL1`, `AGENT_BREADTH_CURRENT` — stay OFF in Wave 1.

## Owner decisions — Brain statistics, templates, retention (2026-11-03, later)
- Wave 1.1 stays separate from Brain integration; no merge/deploy until the owner approves the final candidate. Return order: Wave 1.1 release package, then Brain readiness assessment, then retention impact analysis.
- Archive owner: the partner/ledger maintainer is the PROPOSED owner of archive calculation-date metadata, pending confirmation. Coordinate an additive interface contract; never modify the partner repository without authorization.
- Brain statistics: CONDITIONALLY APPROVED for internally generated, authorized aggregate setup/trigger statistics with reliable provenance, calculation dates, sample sizes, methodology and appropriate uncertainty. Never expose raw restricted records, proprietary scores, stale statistics or unsupported edge claims; anything failing these stays withheld.
- Third-party templates: no blanket exception. Independently authored, team-owned explanations of general concepts may be considered after provenance + rights review. Uncleared templates stay blocked.
- Retention: the current behavior (raw excerpts stored indefinitely, replayed to the model, kept after account deletion) is NOT approved for Brain activation. Review #748; prepare an implementation plan for citation-based storage + proposed 30-day transcript retention. Before any destructive retention change, document the effect on existing Agent conversations, history replay, user deletion, logs, snapshots, backups and existing retention obligations. Verify actual provider retention (do not assume ZDR). Raw Brain knowledge must never reach web research providers; combined web research + knowledge retrieval only if separation is demonstrably enforced. Clarify whether indefinite transcripts affect all Agent conversations or only the Brain path.
- Do not activate Brain or authorize paid evaluation. Merge/deploy freeze stands.

## Owner release authorization (2026-11-03)
1. Wave 1.1: GO for merge and deployment. Order: sync with master → confirm diff = approved scope → required CI green → merge via normal protected-branch process → deploy through the existing production gate → post-deploy smoke + regression against production → confirm admin-only, budgets, model settings, flags unchanged. STOP and report if CI fails, the diff has unreviewed changes, the gate is unhealthy, or smoke fails; use the verified rollback if production health is compromised.
2. Trading Brain #735: CONDITIONAL GO for DARK merge, only after Wave 1.1 is deployed and verified healthy, subject to final compatibility + CI. All Brain knowledge flags OFF; no model access to Brain knowledge, no new source exposure, no knowledge workflow activation. HOLD and ask if the dark merge needs unrelated changes or introduces user-visible behavior.
3. Brain activation: HOLD until (a) third-party setup commentary excluded unless independently established as original, authorized team-owned analysis; (b) Brain/ledger maintainer confirms calculation dates reflect data freshness, not import time; (c) transcript retention, provider handling and account-deletion behavior verified and separately approved. No blanket third-party source authorization.
4. Wave 3 coach: HOLD — finish full suites + independent re-review; no merge/activation until its release package is approved.
5. Continue Wave 2 and Wave 3 on integration branches. Keep the $0.25 per-turn cap, daily budget, admin-only, canonical Indicators/Wisdom boundaries, security restrictions. No paid evals, planner v2, or production model-routing change without separate approval.

## Owner decision: Brain response handling before activation (2026-11-03, late)
APPROVED: fix the Brain response handling before activation. The current planner must not present setup definitions or methodology generated before reading the approved knowledge source. Smallest safe shared-Agent fix:
(1) suppress unsupported pre-retrieval wording for Brain lookups;
(2) present only authorized, grounded knowledge content and citations when v1 can't safely generate a post-retrieval response;
(3) clearly state when no approved definition or evidence exists;
(4) preserve v2's retrieve-first behaviour;
(5) never expose restricted passages, proprietary statistics or unapproved sources;
(6) regression suites plus independent review for the shared-file change.
The goal is no fabricated UCT methodology, without permanently reducing the Agent to raw excerpts.
Both Brain production settings stay OFF (UCT_AGENT_KNOWLEDGE unset; knowledge kinds not in UCT_AGENT_DATA_KINDS).
#751: finish independent review, bring it up to date with master, rerun full suites, then request a merge decision.
Confirm the deployed master commit and both disabled Brain settings in production.
Continue Wave 2/3; this follow-up must not block unrelated validated releases.
No Brain activation and no new retention behaviour is authorized.

## Owner post-release decisions (2026-11-04)
1. Deploy gate: APPROVED to raise the master deploy gate timeout from 40 to 60 min, preserving every CI, health and rollback check. Do not bypass failures, and a timeout increase never substitutes for investigating a stalled deploy. Investigate the ~35-min run and find safe time reductions.
2. Coach safety: use independently authored held-out tests. Provisional activation bar:
   - ≥95% recall on clearly actionable or personalized trading-advice requests;
   - 100% detection on a predefined critical-risk set;
   - no known critical bypasses;
   - acceptable false positives on ordinary educational questions;
   - independent review of failures and corrections.
   The coach is NOT activated at 60%. If the regex guard can't meet the bar, investigate a second-stage classifier (cost and latency) before proposing activation. The coach stays dark until separately approved.
3. MA crossover alerts: APPROVED FOR DEVELOPMENT in UCT's canonical alert engine and catalog, not an Agent-only path. Scope:
   - EMA/SMA with configurable periods;
   - cross above and below;
   - symbol and timeframe;
   - completed-candle confirmation by default;
   - dedup and notification behaviour;
   - canonical Agent capability registration.
   Preserve alert permissions and notification settings. Independent review and full tests before any production deploy.
4. Trading Brain activation: HOLD. Verify the actual Anthropic and Perplexity retention terms and configuration (never assume ZDR). Inventory Railway transcript storage, logs, snapshots, backups and Sentry. Finish the grounded-response fix, source rights, calculation dates and transcript retention before requesting activation.
5. Follow-ups:
   - fix LT-15 ("describe the setup on NVDA" → "Checking…" and then no result);
   - continue the #757 and #758 reviews;
   - prioritize releasing the next validated user-visible capabilities.
   Keep admin-only, model settings, the $0.25/turn cap, the $5/day cap and proprietary protections. Separate approval is needed for new feature activations or production releases outside the authorized changes. Provide the next RC plus a readiness report.
