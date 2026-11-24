# UCT Agent: pause handoff, 2026-11-24

The owner ordered a **controlled pause**: they are away for several days and the dev PC is off. This is not a cancellation.

Written by the Agent Program Lead (PL) session at about 16:45Z on 2026-11-24. AUDIT keeps its own independent checkpoint (see section 9).

Contents:
1. Production and master state
2. What shipped in this cycle
3. Active workstreams, in priority order
4. Eval (NL-1 three-arm comparison)
5. Architecture: pending owner approval, nothing built
6. Open owner decisions
7. Process rules (unchanged; follow them on resume)
8. Restart steps
9. AUDIT
10. Local-only material (on the PC disk, not in git)

---

## 1. Production and master state

| Item | Value at pause |
|---|---|
| Production (`refs/heads/production`) | `6d50f4662b35cbcfb4b0c9146a6827885e8d48d4` (#2697 landed). Promoted automatically at about 12:07Z on 11-24. AUDIT prod-verified it at about 16:30Z. |
| Master | `eb25005921c0cb4666a0c0931474ea5c684d6306`, 14 commits ahead of production (#2698, #2699, #2700, #2701, #2703, from other teams) |
| Merge queue | empty |
| Paid eval lines | none open, no reservations |
| PL crons, watchers, chases | none (stopped at the pause) |

**Cloud automation keeps running while the PC is off.**
- `promote-production.yml` runs on GitHub. It promotes master's tip outside the rush windows:
  - on each master-gate completion;
  - on weekday crons at 13:50/14:50Z and 20:20/21:20Z;
  - on Wednesdays at 15:05/16:05Z.
- Master will therefore promote unless the owner holds it.
- #2698 (Terminal "agent data wave 13") changes Agent code: `app/src/agent/routing.js`, `capabilities/terminalDataWave13.js`, `terminalWaves.js` and the capabilityRegression baseline. AUDIT has no GO recorded for it. See section 6, item 1.
- Push-triggered check workflows ("Front door", "Web frontend reads") ran on the `pause/*` pushes. They only check and don't deploy; only master deploys.

## 2. What shipped in this cycle (all AUDIT-verified in production)

| PR | Merge | What it does |
|---|---|---|
| #2634 | 8d50b2813f | Indicator save safety: a refused save puts the chart back and says so. |
| #2664 | 74f1a25f4a | NL-1 preflight fix. No silent drop of one part of a multi-part request; the reply says "Not done: one part of your request (…) — reason". |
| #2692 | 8615de03c6 | "Side by side" keeps the existing chart and adds the new one beside it (owner ruling 11-23). It asks when the layout is full, when swap/replace words appear, or when neither ticker is shown. |
| #2697 | 6d50f4662b | G1/G2 target gate: one rail set for instant and model writes. Set words ("both/all/each/every") cover every chart; a click plus words naming another chart cannot write to the wrong chart. |

Production markers verified by AUDIT: #2664 = 1, #2692 = 1, #2697 = 3; AgentPanel control 5→5.

## 3. Active workstreams, in priority order

Preserved WIP branches were pushed for safety only: no PR, not reviewed, not to be merged as is.

### 3.1 P0.2 "fix that" redesign (top priority)
- **Branch:** `agent/pl/p0-ticker-ask-harness-v2` (local worktree `C:/w/pl-p0fix`). Pushed copy: `pause/2026-11-24/p0-fix-that-wip` at `efa9c1a3f2`. That commit is an empty pause marker; the work is in its parent, `adad7972f7`.
- **Goal** (owner 11-24): no accidental or implicit Undo; keep correct, add and explicit undo distinct; no needless asks.
- **Design so far:**
  - (a) A revert op from a model plan never runs silently. A revert that comes with another change gets a card: fixed UCT text, [Apply] / [Just Chart (B)] / [Cancel]. A revert-only plan gets a one-change card, [Apply] [Cancel].
  - (b) The old "licence grammar" is deleted. Only an explicit undo skips the card, and never when negated, hypothetical or asked as a question.
  - (c) All target rails run first.
- **History:**
  - Four AUDIT NO-GOs in this family, all because wording decided what may skip a check.
  - The last one, on 06ce165bbb, had two holes:
    - **X:** "put META back" licensed a revert on the wrong chart (NVDA);
    - **R:** declared verbs were matched as nouns ("the end date is wrong" exited replay).
- **WIP `adad7972f7` addresses them:**
  - **X:** a named revert licenses only revert ops on the chart it names; "undo that / my last change" only an exact match of the last turn's Undo set; anything else cards.
  - **R:** the no-card verb path is limited to drawing.remove/clear, with the verb acting on a drawing noun or a pronoun in its own clause. Every other kind cards.
  - **Drift:** the board snapshot checked at the pick now covers each carded op's target state.
  - Tests run so far: agentExplicitRevert 15/15, new correction rows 72/72, drawingRevertCard 76/76, widget/board/list 136/136.
- **Not done** (exact steps are in `C:\w\pl-p0fix-report.md` §11; scripts are backed up in `C:\w\pause-2026-11-24\scratchpad\p0fix\`):
  1. Revert-alone runs for X, R and drift.
  2. P0.3 as its own item. P0.3 is setupPanel({routingV2}) plus the routing assertion, touching 7 test files. It needs its own revert-alone run and an answer on whether P0.2 depends on it.
  3. **Decision needed:** the capreg corpus `chart.replay.exit` "leave replay mode" now cards. Its locked corpus entry needs a signed decision (AUDIT or owner). Either change the entry to "card + Apply", or give replay exit a no-card path.
  4. Merge origin/master, run the full suites through the lock, write §10, then T2 to AUDIT.
- **Escalation rule agreed with AUDIT:** if the resend still lets wording decide that a revert can skip the card, stop. Take the trade-off to the owner: "explicit undo only through the Undo stack, everything else gets a card".
- Three outcome tests were converted to "card, then Apply": collapse a section, flip the news widget tab, reset columns. The owner should see this cost.

### 3.2 "Here / this one" plus a named chart (abandoned patch, safe ask kept)
- **The case:** META clicked and "linear here, and log on MSFT" asks needlessly. This already happens in production and is safe: nothing changes before the answer.
- **The patch:** `pause/2026-11-24/g1g2-here-click-agree-abandoned` (`94e05620ff`) got an AUDIT NO-GO. A crossed plan (ops swapped between charts) was written silently, 20/20.
- **Decision:** stop patching (owner directive 6). The real fix is the architecture item in section 5: model-described per-step targets.

### 3.3 Grid load ("load SPY QQQ IWM DIA in a 2x2")
- **Investigation:** `pause/2026-11-24/grid-load-probe` (`754c2983c2`, probe test only), 904/904. Nothing is lost:
  - a re-symbol keeps indicators, panes and settings;
  - drawings are per symbol, hidden and not lost;
  - one Undo restores the board;
  - an add request never re-symbols (0 of 648 rows).
- **Follow-ups**, not started (report: `C:/w/pl-gridload-report.md`):
  - compareHideBase survives a grid re-symbol, hiding the new base (a small fix in Agent `commitGrid`);
  - "include SPY and QQQ too" has a correct addCharts plan rewritten to a reuse grid by `multiChart.js screenGridOnly`, then refused. This is architecture evidence.
  - A single add on a full board is refused instead of re-tiling.

### 3.4 Other follow-ups (not started)
- **sb05:** "swap this chart for NVDA, then put AMD side by side with it" asks needlessly. The side-by-side screen should judge swap/replace words per clause.
- **Pre-existing ticker-rail gap:** the model puts the second named chart's op on the first chart (AUDIT's R1/R2/R8/R14/R19 under a "spy" model).
- The other backlog items carry over from earlier reports: repairDropped re-aim residual, the 102 panel test files not using setupPanel, G4, the "unless" exclusion, xoDisable, persist-fix wording, and the Charts-team seams.

## 4. Eval (NL-1 three-arm comparison)

- **Arms:**
  - A = production on Haiku 4.5;
  - B = NL-1 on Haiku 4.5;
  - C = NL-1 on Sonnet 5.5.
- **Nothing is running, and no eval has started since 11-23.**
- **Ledger** (AUDIT read-only check, 11-24): $2.7805 spent of the $8 cap, $5.2195 left. Every row is settled; the last draw was 2026-11-23 22:02Z. Runner: `C:\w\eval-auto\run_eval.py` (ledgered). The eval key is DPAPI-protected: never read, print or move it.
- **11-23 result** (corrected scoring on the final board): A 65.9%, B 50.0%, C 57.5%.
  - McNemar: A vs B p=0.070, others not significant.
  - Silent drops: A 1, B 5, C 5. Wrong-chart writes: A 3, B 2, C 3.
  - NL-1 bugs found then (preflight drops) were fixed in #2664.
- **The re-run is ready and AUDIT-accepted**, apart from one pending condition:
  - **Harness:** `agent/pl/e2e-eval` (worktree `C:/w/pl-e2e`); pushed copy `pause/2026-11-24/e2e-eval-wip` at `1b56ec96ae`. Report: `C:\w\pl-e2e-report.md` §13–19.
  - **Scope e2e3s v3:** 58 cases / 82 turns, the same on every arm. Classes:
    - pane-multistep 10, ticker-correction 12, correction-branch 12, exclusion 9, followup-correction 18, targeting 6;
    - side-by-side 6 (new), crossed-target 3 (new), correction-vague 4 (new: bare "fix that", negated undo), correction-explicit 2 (new: "make both weekly" then "take meta back").
  - **Scorer fixes this cycle:** crossed plans are now a WRONG-CHART-WRITE; clarify alternatives are accepted.
  - **Caps:** rolling per arm, A $0.82 / B $0.87 / C $2.22 = $3.91. Expected spend $3.11; P(truncate) ≤ 2.5% per arm.
    - r1 carries the arm cap. r2/r3 are created after the previous round settles, at arm cap − settled spend, each verified by AUDIT from the ledger before it opens.
    - AUDIT's sealed line ($1.30: A .32 / B .30 / C .68) runs last.
    - Total $5.21 ≤ $5.2195.
  - **Pending:** the card-pick rule (the simulated member picks only from the card's fixed text; no match → Cancel = incomplete; a lying card → WRONG-CHART-WRITE). It's WIP at `app/src/agent/testing/e2eMember.js:50`, with 5 unit tests passing when run alone. The full self-check has NOT run with it; the last full green was 361/361 at 03c49668.
- **Order to run:**
  1. Finish the pick rule and get AUDIT's confirmation.
  2. P0.2 lands on master.
  3. Recapture r1 bodies for all arms on that ONE master head.
  4. Regenerate the lines; AUDIT reviews the lines, body counts and its sealed dry run.
  5. Run A, B and C with rolling caps, then sealed.
  6. Results go to the owner with the architecture proposal.
- **Owner decisions in force:**
  - The comparison and the sealed set are funded separately, inside the $8.
  - Full scope preferred, cut to fit; never exceed the budget.
  - No recurring spend.

## 5. Architecture: pending owner approval, nothing built

The owner rule: no structural change until the re-run evidence is presented and approved. The proposal to bring:
- **Request ledger:** each plan item quotes the words it covers; every item is executed, read back and reported as done, declined or failed. Silent drops become impossible by construction.
- **Model-directed routing:** one model call with the full compact catalog and full board context, no keyword-gated slices. Deterministic lanes only for exact control words and safety rails.
- **First-class corrections:** "fix that", "no, the other one" and "undo that, then…" bind to ledger items from earlier turns. Explicit undo goes through the Undo stack.
- **Model-described targets per step,** with code checking that each op's chart matches its quoted clause.

Evidence gathered this cycle (all point the same way):
1. Four P0.2 NO-GOs, every one from text deciding what may skip a check.
2. Three narrow deixis rules in the "here / click" family, the last of which allowed a silent crossed write.
3. Whole-message keyword screens over-ask: "swap" in sb05, "here" in e2-t05 and xt01–03.
4. A deterministic screen overrode a correct model plan: `screenGridOnly` on "include SPY and QQQ too".

## 6. Open owner decisions

1. **URGENT before the PC goes off:** hold or allow auto-promotion of master (it includes #2698 Agent code with no AUDIT GO) while AUDIT can't prod-verify. AUDIT recommends holding. Stopping it is an owner act, e.g. disabling the "promote to production" workflow until return.
2. `chart.replay.exit` locked corpus entry: card + Apply, or a no-card path (section 3.1).
3. If the P0.2 resend still relies on wording: accept "explicit undo only via the Undo stack, everything else cards". This means some one-click costs, for example closing a just-opened tab or leaving replay.
4. Approve or reject the architecture proposal once the eval evidence arrives.
5. Carried over: the Watchlists team ack, and #2480 / #2531 (Patrick's team).

## 7. Process rules (unchanged; follow them on resume)

- Never `--admin` or bypass gates. Never force-push, `git stash`, or rebase shared refs; merge commits only.
- No railway commands; no `gh auth` or credential commands unless the owner directs; never request elevation. Don't boot the backend or curl production. Never print real market values.
- **Agent PRs:**
  - AUDIT T2 GO (bundle + sha256, "gap clear?") comes first;
  - then push, PR, required checks green;
  - then ONE `gh pr merge <n> --merge`, one PR in the queue at a time;
  - then ledger line `<sha> <PR> <ts>` in `C:\w\agent-merges.log`, a #2495 comment, and AUDIT runs `agent_ci_evidence verify --pr N --merge-group <sha>`;
  - then AUDIT prod-verifies after promotion.
- **Windows (ET):**
  - no queueing 09:20–09:45 or 15:30–16:15, nor 05:00–06:05Z;
  - the queue cut-off is 09:00 ET;
  - production web is frozen 09:45–15:30.
- **Other rules:**
  - Repo slug: `northstar-quarry/UCT-Dashboard`.
  - Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with the Claude Code footer.
  - Paid model calls only through the ledgered runner, under the owner's authorization.
  - Never read `C:\w\aud-hold\` or `C:\w\aud-probes\`. Workers never see sealed cases.
  - Don't edit other teams' files (pages/, ChartsWorkspace, Watchlists, `docs/notebook/perf-budgets.json`) without coordination.
- **Heavy suites** go through the lock: `C:/w/aud-venv/Scripts/python.exe C:/w/pl-p2/tools/agent_suite_lock.py run --who <id> <cmd>`.
- **Workers:** at most 3 at a time, delegated with explicit briefs.

## 8. Restart steps

1. **Machine.**
   - Power on.
   - Open Claude Code in `C:\Users\blake`, for the PL. Memory loads from `C:\Users\blake\.claude\projects\C--Users-blake\memory\MEMORY.md`.
   - Open AUDIT in its own terminal: session "uct-dashboard-41", resumed from its checkpoint (section 9).
2. **Verify state** (read-only):
   ```
   cd C:/w/pl-rmtype && git fetch origin
   git rev-parse origin/master; git ls-remote origin refs/heads/production
   gh api graphql -f query='{repository(owner:"northstar-quarry",name:"UCT-Dashboard"){mergeQueue(branch:"master"){entries(first:10){nodes{pullRequest{number}}}}}}'
   git ls-remote origin 'refs/heads/pause/2026-11-24/*'
   ```
   - Compare against section 1.
   - If production moved while you were away, ask AUDIT to prod-verify everything new.
   - Re-read the ledger through AUDIT before any spend.
3. **Worktrees** are on disk at `C:/w/*`. Check that each local head matches its `pause/2026-11-24/*` copy:
   - pl-p0fix `efa9c1a3f2`
   - pl-e2e `1b56ec96ae`
   - pl-g1g2-here `94e05620ff`
   - pl-gridload `754c2983c2`

   If a worktree is lost, recreate it from the pause branch.
4. **Reconnect with AUDIT.** Use the ListAgents and SendMessage tools to find "uct-dashboard-41". The pipe address changes per session. Send the resume note, ask for its checkpoint summary, and confirm the eval ledger.
5. **Resume in this order:**
   1. P0.2 remaining steps (section 3.1);
   2. the eval pick rule (section 4);
   3. P0.2 T2, then the queue;
   4. the eval run sequence;
   5. the architecture proposal with the evidence;
   6. follow-ups.

## 9. AUDIT

- AUDIT's independent checkpoint is at `C:\UCT_Migration\uct-audit-checkpoint-2026-11-06\PAUSE-CHECKPOINT-2026-11-24.md`, committed in AUDIT's local repo as 4ddef71.
- It holds its findings, NO-GOs, unresolved objections, eval status and next verification tasks. Its sealed cases stay with AUDIT and are not referenced by content anywhere in this document.
- AUDIT's GO and verification log: `C:\w\chase-go.log`. Prod-verify log: `agent-prodverify.log`.

## 10. Local-only material (on the PC disk, not in git)

- **Running log:** `C:\w\OVERNIGHT-LOG-2026-11-23.md`. Merge ledger: `C:\w\agent-merges.log`.
- **Reports:**
  - `C:\w\pl-p0fix-report.md` (§8–11)
  - `C:\w\pl-e2e-report.md` (§10–19)
  - `C:\w\pl-g1g2-report.md`
  - `C:\w\pl-gridload-report.md`
  - `C:\w\pl-sbs-report.md`
  - `C:\w\pl-nl1pf-report.md`
  - `C:\w\UCT-AGENT-INTELLIGENCE-RELIABILITY-ASSESSMENT-2026-11-23.md`
- **Eval output:** `C:\w\pl-e2e-out3\` (line sets and trunc.py), `C:\w\pl-e2e-out\`.
- **Scratch backup:** `C:\w\pause-2026-11-24\scratchpad\`.
- **Older `agent/pl/*` worktrees:** committed locally, many with no remote. They're historical, from finished or superseded work, and not needed to resume. Remove them only on owner request.

## 11. RESUME UCT AGENT prompt (paste into a new Agent Lead session)

```
RESUME UCT AGENT. You are the UCT Agent Program Lead (PL). Development was paused 2026-11-24 by the owner.
1. Read docs/agent/PAUSE_HANDOFF_2026-11-24.md on branch agent/pl/pause-handoff-2026-11-24 (local copy: C:/w/pl-pause/docs/agent/), then your memory index.
2. Verify state read-only (handoff §8 step 2): master, production, merge queue, and pause/2026-11-24/* branch heads vs the local worktrees. Report any differences to me before acting.
3. Reconnect with AUDIT (session "uct-dashboard-41"; find it with ListAgents). Ask it to resume from its PAUSE-CHECKPOINT-2026-11-24 and to prod-verify anything promoted while we were away. Confirm the eval ledger ($2.7805 spent / $5.2195 left at pause) before any spend.
4. Resume in handoff §8 step 5 order: finish P0.2 "fix that", then the eval card-pick rule, then P0.2 T2 and the queue, then the 3-arm eval (rolling caps, sealed last), then the architecture proposal with the evidence. Follow every rule in §7. No architecture build without my approval, no recurring spend.
5. Give me a short status and the decisions you need from me (§6) before starting work.
```
