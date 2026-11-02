# Deliverable 1 — Executive diagnosis

Independent audit of UCT Agent, 2026-11-02, against `origin/master` `cfc35a3b3f`.
Read-only. No code changed, nothing merged, deployed, flagged, restarted or paid for.
Every number below is traceable to an appendix (A–G) with `file:line` or a command.

## 1. What we have actually built

**A sound, well-guarded website operator for one page, with the model as a thin planner on top.**

| Fact | Measured | Evidence |
|---|---|---|
| Registered capabilities | 121 (+2 server-gated quote/bars) over 23 target kinds; 97 writes, 26 queries; 82 with exact Undo | App. A |
| Every write goes through the feature's own writer with read-back | yes, no stubs found | App. A §3 |
| Pages where the Agent exists | **one**: `/charts` (`ChartsWorkspace.jsx:3759`); every capability declares `surfaces:['charts']` | App. C §0 |
| Weighted share of the website the Agent can operate today | **53 %** of all member features; **62 %** of the Charts page | App. C §4 |
| Server-side data kinds built (quote, bars, fundamentals, earnings, news, themes, breadth, ratings, screen.*) | 13; **2 reach a browser capability**; all default OFF | App. A §6, App. E |
| Indicator authoring from plain English (draft → preview → edit → save → add to chart) | wired end to end via `/converse` (Opus 5); alerts not armed | App. F §1.4 |
| News → Agent "ask about this headline" | code complete on master, flag `UCT_AGENT_NEWS` default OFF | App. F §2 |
| Research, historical analysis, personalization, multimodal | **not started** (RS-1 reserved only; `event_study.py` has zero callers; memory is session-only; no image input) | App. F §3–7 |
| Model | `claude-haiku-4-5`, structured JSON output, no tools, ≤ 2 calls/turn, 2048 max tokens | App. B §1.4, App. E |
| Real-model end-to-end evaluation of the planner | **last full run 2026-10-08: 46/57**; nothing systematic since; all three sealed sets never scored | App. B §5 |
| Source / tests / docs | 33k source lines, 42k test lines (~2,490 cases), 41k docs lines (79 % generated JSON) | App. D §2, §7 |
| Program age | 27 days (first commit 2026-10-06) | App. D §1 |

The architecture is good. The registry → canonical writer → read-back → receipt → Undo chain, the server-side envelope sanitizer, the approval escalation and the ADR-005 isolation rules are exactly what a trading assistant that *acts* on a member's workspace needs. None of it should be thrown away.

## 2. Why progress has felt slow

Six causes, in order of impact. The first three are engineering; the last three are process.

### 2.1 Everything is dark, so nothing is visible
All eight server flags default OFF and the panel itself needs a per-browser switch plus admin (App. E). Production values could not be read by this audit (denied), but session notes from 2026-11-02 record them OFF. Sprint 1 and Sprint 2 shipped 14k- and 36k-line release candidates to master **flags-off**. From the owner's chair the product did not change. That is a release-policy choice, not a code shortfall, but it is the single largest reason the last two weeks produced nothing observable.

### 2.2 The model path is the product, and it has never been measured
The team's own diagnostic (PR #662) says it plainly: the deterministic layers claim almost nothing (fast path 0/31 discovery questions; 41 % of ideal-fast cases on held-out phrasing), so nearly every real request depends on the model planning from a routed manifest. Yet:
- the planner's intent accuracy is listed as **"NOT MEASURED"** in every eval doc (App. B §5);
- paid evaluations were proposed at least four times (NL1-TRIAL, PHASE2, LATENCY, #662) and never authorized; the sealed held-out sets (heldout-v2, sealed-v3) have never been opened;
- the only full real-model benchmark is 25 days old.

Without a real-model scorecard, every session optimized what it *could* measure for free: deterministic ticker resolution. That is why the last two weeks went to lowercase tickers, cashtags, ETF wording and half-day sessions (App. D §9), and why QA's status file is 742 lines long.

### 2.3 A previous-generation small model behind a 60-action window
`claude-haiku-4-5` is the most expensive Haiku ($1/$5 per MTok), has a 4,096-token prompt-cache minimum that the docs say defeats caching at these sizes, and is driven through a structured-output JSON envelope rather than tool use. Because the catalog (121) exceeds the server's 60-action limit, a regex router picks which groups the model is allowed to see; a miss costs a second call or the refusal *"That touches too many parts of UCT for one request."* Measured routing miss: 20–22 % (App. B §2). This is the mechanical cause of "understands but does not execute": the model literally was not offered the action.

### 2.4 Process overhead that scales with findings, not with features
- 130 Agent PRs in 24 days; **63 created on 2026-11-02 alone**; median PR 288 lines, median 0.3 h to self-merge. Four "roles" are four sessions of one account reviewing each other (App. D §3).
- 28 numbered findings tracked across 984 lines of status files; the lead's own status still says "Sprint 0 in flight".
- Agent PRs into master take 10x longer than the repo norm (2.0 h vs 0.2 h median) and carry RC bundles of 14k–38k lines.
- 142 agent branches, 199 worktrees on one machine, node_modules shared by symlink, a two-slot suite lock.

### 2.5 The master deploy gate is now 70 % Agent tests, serialized for the whole repo
The gate runs the full Agent vitest suite (16–18 min) on **every push to master from every workstream**, one at a time; median gate time rose from 15 to 23 min in nine days and the timeout was raised to 40 min on 11-02 (App. D §5). Meanwhile `agent/int`, the integration branch, has **no CI at all**: Agent breakage is invisible until an RC reaches master.

### 2.6 Ownership walls between sessions of the same person
Indicators owns everything indicator-shaped (indicator alerts "explicitly out of scope", `alert.js:17`; settings eligibility deferred because of `chartSettingsDescriptors.js` ownership; "#516 stays on hold"); Charts owns the host; the Agent may not edit either. These boundaries made sense to keep concurrent sessions from colliding, but each one turned a one-hour change into a contract document, a handoff and a wait.

## 3. What the biggest bottlenecks actually are

1. **No real-model feedback loop** (2.2). Cost to fix: a standing ~$25/week budget and one harness run (tooling already exists: `tools/agent_live_batch.py`, `agent_eval_run.py`).
2. **Model/catalog ceiling** (2.3). Cost to fix: 1–2 sessions to move the planner to Sonnet 5.5 (or Haiku 5.5 for cheap turns) with tool use and the full catalog via deferred tools; roughly cost-neutral per turn.
3. **Flags-off releases with no activation path** (2.1). Cost to fix: a policy — admin activation is part of "done".
4. **CI shape** (2.5): Agent suite out of the serial master gate, into a PR check on Agent branches plus a 3-minute smoke in the gate.
5. **Work decomposition** (2.4, 2.6): vertical packages owned end to end, not horizontal layers with contracts between them.

## 4. Is the architecture fundamentally sound?

**Yes.** Keep: registry + canonical writers, receipts/Undo, server sanitizer and approval escalation, MD-1 envelopes with `as_of`/freshness, ADR-005 isolation, flags-dark-for-members, the unattended-development rules.

**Change**: the planner (model, catalog exposure, single-plan-per-turn), the single-surface host, the absence of a durable member-preference store, and the absence of research/historical services. These are extensions and one targeted replacement (the planner call), not a rewrite. Deliverable 3 details each.

## 5. What should change immediately

1. Authorize a standing real-model evaluation budget and run the existing 57-case benchmark plus the sealed sets this week. Nothing else can be judged until this exists.
2. Switch the planner to a tool-use loop on `claude-sonnet-5-5` with the full catalog (deferred tools), keep Haiku 5.5 for cheap classification. Measure with (1).
3. Turn `UCT_AGENT_DATA` (quote, bars.daily, instrument.resolve), `UCT_AGENT_SCAN` and `UCT_AGENT_NEWS` on for admin. The code and QA verdicts for these exist (#672 GO, #692).
4. Stop per-finding PRs and per-PR cross-session review; one PR per package increment, one integrator.
5. Move the Agent vitest suite out of the serial master gate into a PR workflow on `agent/**` branches; keep a 3-minute smoke subset in the gate. Add CI on `agent/int`.
6. Collapse the four role sessions into one integrator plus package builders with their own worktrees (Deliverable 6).

## 6. Direct answers to the owner's four questions

**Why can't we define a larger objective and let agents work for days?** You can, once three preconditions exist, and they are cheap: a real-model eval that the agents optimize against (else they optimize ticker regexes), CI on the integration branch (else three days of work breaks silently), and pre-authorized decisions (budget, flags, model) so a run does not stop at an owner gate every few hours. The unattended-development rules already in the repo are compatible with this.

**Why weeks on a few abilities when the website already exists?** Because the abilities were built as horizontal layers (gateway, contract, fixtures, rails, QA verdict, RC) rather than vertical slices, and each layer was shipped dark. The Charts page is already 62 % covered; the missing 47 % of the site is mostly "no host on that page", which is one generic change, not 40 features.

**How much delay is missing code versus coordination?** Roughly: the last two weeks were ~70 % coordination/measurement artifacts (contracts, fixtures, rails, verdicts, status, RC bundling) and ~30 % product behavior (App. D §9 keyword census; 48 of 193 commits are docs/status/verdict). The code that exists is good; the missing code (research, historical, multi-page host, preference memory, planner upgrade) is a few thousand lines, not tens of thousands.

**Could we deliver a substantially more capable Agent in days or weeks?** Weeks, yes. Deliverable 5 specifies a first wave that, in the aggressive scenario, makes the Agent execute multi-step trading requests end to end on admin accounts in two weeks. Days is not credible for anything the owner would call "substantially more capable", because the planner upgrade needs an evaluation loop before it can be trusted, and that loop does not exist yet.
