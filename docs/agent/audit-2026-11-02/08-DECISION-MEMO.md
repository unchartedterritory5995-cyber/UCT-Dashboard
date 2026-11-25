# Deliverable 8 — Decision memo

**To:** the owner. **From:** independent audit, 2026-11-02. **Scope:** audit and plan only; nothing was changed in production.

## Recommended strategy

Keep the architecture. Replace the planner. Build in vertical packages owned end to end. Measure the real model every night. Ship weekly bundles that are turned on for admin the day they land. Lift the Agent out of `/charts` to the whole site in Wave 2.

## The three biggest changes

1. **A real-model evaluation loop with a standing budget.** The planner is the product and it has not been measured since 2026-10-08. Everything else in this memo is guesswork until the nightly scorecard exists. Tooling exists; it needs a key and $10/night.
2. **Planner upgrade: Sonnet 5.5 tool-use loop with the full catalog, Haiku 5.5 for cheap turns.** Removes the 60-action window and the regex router that cause "understands but doesn't execute", enables dependent multi-step execution, and is cost-neutral per step against today's Haiku 4.5.
3. **Process reshape: one integrator, three package builders, CI on the integration branch, Agent suites out of the serial master gate, admin activation as part of done.** This converts ~70 % coordination effort into product behavior and takes 16 minutes off every master push repo-wide.

## Stop doing

- Shipping release candidates flags-off with no activation step.
- Per-finding PRs and four sessions of one account reviewing each other on every PR (63 PRs in one day).
- Hand-extending deterministic matchers for phrasing classes (lowercase tickers, cashtags) ahead of measuring the model path.
- Running the full Agent vitest suite in the serial master gate for every workstream's push.
- Status logs as the record (742-line QA file; lead status still at "Sprint 0"). Findings become BOARD tasks.
- Horizontal contract-first workstreams (MD-1 → consumers later): 9 of 13 data kinds were built with no consumer.
- Treating session boundaries (Indicators / Charts / Agent) as organizational walls that need a handoff document per change.

## Continue doing

- The canonical-writer rule, read-back, receipts and exact Undo.
- Server-side sanitize and approval escalation; `require_admin_dark` until member rollout.
- MD-1 envelopes with `as_of` and freshness classes; ADR-005 isolation; F-16 (ratings/scores/flow never reach the model); the Massive display-only wording.
- Dark-by-default for members; flow-worker untouched; no new data pipelines; #516 on hold.
- UNATTENDED-DEVELOPMENT.md: stop remote mutators, verify remote state, no unattended releases.
- Suite lock, ownership checker (with the F-9 fix), no `npm ci` in shared worktrees.
- Held-out sets written by a session that never sees the code.

## Build first

Wave 1 (Deliverable 5): the planner upgrade and nightly eval; multi-step execution; time-anchored drawings, dated close, indicator alerts, remaining chart settings, widget options, replay; conversational scan refinement; the four unused company-data kinds wired; index/commodity/crypto kinds; flags on for admin. Two weeks aggressive, four conservative.

## Decisions that require your approval

| # | Decision | Why it is yours | Default if unanswered |
|---|---|---|---|
| 1 | Standing eval budget ($75 Wave 1; ≤ $10/night thereafter) on a separate eval key | money; the repo's tooling refuses to run without it | nothing is measured; the plan cannot be verified |
| 2 | Planner model change to `claude-sonnet-5-5` + `claude-haiku-5-5` | provider cost and behavior | stay on Haiku 4.5: the 60-action ceiling stays |
| 3 | Admin activation of `UCT_AGENT_DATA` (quote, quotes, instrument.resolve, bars.daily), `UCT_AGENT_SCAN`, `UCT_AGENT_NEWS`, `UCT_AGENT_STREAM` on promotion | production flags | the shipped work stays invisible |
| 4 | Repo-wide CI change: Agent suites out of the serial master gate into an Agent-branch workflow; add CI on `agent/int` | affects every workstream's push time | gate keeps growing (23 min median, 40-min timeout) |
| 5 | Ownership: Wave 1 builders may edit `chartSettingsDescriptors.js` ELIGIBLE rows and add an indicator-alert kind over `useIndicatorAlerts.js`, notifying the Indicators/Charts sessions | cross-session boundary | those two capabilities move to the Indicators train |
| 6 | Team shape: integrator + three builders + headless eval runner, replacing lead/md/sc/qa for Wave 1 | organization | current roles continue |
| 7 | App-level Agent host (Wave 2, P6): touches `App.jsx` and page components outside the Agent's paths | product-wide change | Agent remains `/charts`-only |
| 8 | Research disclosure (queries go to Perplexity) and https-only citations, before P4 | member-facing policy | P4 stays admin-only |
| 9 | Close #684 and #665 (content already merged via #692); merge or close F-16 PRs #654/#657/#661 and F-23 #666 | housekeeping with a security angle | F-16 enforcement stays unmerged |

## What I would do first if personally responsible

Day 1: get decisions 1–4. Run the existing 57-case benchmark and sealed-v3 on the current planner, so there is a baseline before anything changes. Reset `agent/int` to master, prune the worktree set, add `agent-ci.yml`.
Days 2–7: build the tool-use planner loop behind `UCT_AGENT_PLANNER=v2`, run it against the same sets nightly, and in parallel let two builders ship drawings, dated close, indicator alerts, settings, widget options and the data kinds, each activated for admin on merge.
Day 8–10: cut the Wave 1 RC with the planner on, score it, turn it on for admin, and sit with the owner for an hour of real use. Then plan Wave 2 from what the scorecard says, not from what a roadmap predicted.
