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

## Activation checklist (admin-only; owner sets flags; order is mandatory)
1. `UCT_AGENT_STREAM=1` — after production flags are verified.
2. `UCT_AGENT_DATA=1`, `UCT_AGENT_DATA_KINDS=quote,quotes,instrument.resolve` — after RC1.
3. add `bars.daily` — only after F-23 (#666 content) is on master.
4. `UCT_AGENT_NEWS=1` — after the #692 QA verdict is recorded.
5. `UCT_AGENT_SCAN=1` — only after F-16 (#654/#657/#661 content) is on master, isolation audit cells 23/24 closed, rails green, and an independent verification is recorded in BOARD.
6. `UCT_AGENT_PLANNER=v2` — only after the sealed-set result meets target with 0 FAIL and the owner approves the model.
7. `UCT_AGENT_ISOLATED`, `UCT_AGENT_NL1`, `AGENT_BREADTH_CURRENT` — stay OFF in Wave 1.

## Wave 3 — intelligent trading coach (owner-authorized 2026-11-03, builder w3-a, branch `agent/w3/coach` → base `agent/int-w3`)

**Scope.** The Agent as an educational trading coach: explains trading concepts from a curated knowledge base
(`docs/agent/coach/concepts/*.md`, ≥ 12 concepts) with ONE grounded observation from the open chart; a deterministic
evaluation suite (`api/services/uct_agent/coach/guard.py` + browser mirror) applied to every coach reply server-side;
trade-review foundations over the member's OWN journal (consent-gated, descriptive stats only, a PROPOSED note the
member approves); a single-turn coaching workflow (explain → what to check → one question back, `coach.next` quick
replies). W3-5 (`chart.describeSetup`) and W3-6 (`history.eventStudy`) are BLOCKED on Wave 2: their contract is
`contracts/COACH-1.md`; nothing of them is built.

**Dependencies.** Wave 1 (on `agent/int-w3`): conversation state (`store.STATE_KEYS`, W1-C), the MD-1 `bars.daily`
kind for the observation, the j2 journal routes as read-only consumers. Wave 2 for W3-5/W3-6 only.

**Hard rules (verbatim in effect).** Every new capability default OFF behind the NEW server flag `UCT_AGENT_COACH`
(reported by `/api/agent/config` as `coach`) and admin-only. No autonomous trading, order placement, price targets, or
any guaranteed / will / sure claim. Every figure in a coach answer comes from an envelope or the member's own journal
rows (never invented); "Educational, not advice" on every coach answer. The member's journal is read ONLY after an
explicit per-conversation consent (`coach.consent` → state key `coachConsent`, with a clear revoke); journal writes
are limited to a PROPOSED note; telemetry is value-free (ADR-005 style: codes, counts, dates).

**Acceptance.** Rails green: the concept base parses with the four sections and passes its own guard; the shared
adversarial fixture (≥ 20 violating, ≥ 10 clean phrasings) trips exactly its codes on BOTH implementations; a coach
turn's violating reply is replaced server-side and logged value-free; a coach answer never carries a figure absent
from its inputs; the golden manifest is unchanged on a dark server; nothing under `coach/` calls a j2 write except
`journal.proposeNote` → `POST /api/j2/notes`. PRs: W3-1+W3-2, then W3-3, then W3-4, each with full Agent suites via the
lock. Activation (flag on, admin-only) is a separate owner decision after Phase 1 live testing.
