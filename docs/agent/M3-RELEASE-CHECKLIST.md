# UCT Agent M3 — release checklist, real-model production acceptance, rollback

**Status (2026-10-10):** S4 accepted locally. S5 integration is being prepared LOCALLY. Nothing is pushed.
A separate owner authorization is required for: push/merge/deploy, any production mutation, and the
cleanup of acceptance fixtures. Contract: `docs/indicators/AGENT-M3-CONTRACT.md` §15–§16
(`uct.indicators.authoring/1`).

## Prerequisites (all must hold before any push)
1. Indicators S1–S3 (and the approved typed rename outcome) are integrated onto current master by
   the Indicators team, and the Agent branch is built on exactly that integration.
2. The joint suite (section A) passes on the integrated tree; every remaining red is shown to be on
   base or environmental.
3. The production baseline (section B) is re-captured on release day and matches.
4. The owner explicitly authorizes the release, then — separately — the production mutations.

## A. Local verification on the integrated tree
- `vitest run src/agent src/components/chart/builder src/components/chart/pane src/pages/charts/widgets/ChartWidget src/components/chart/engine/__tests__/controlDoorCensus.test.js`
- full `vitest run` (compare reds on a junction-linked base worktree)
- `pytest tests/test_uct_agent*.py` + the specialist's Python tests touched by the integration
- `eslint src/agent …` and `vite build`
- browser (isolated local backend, scripted models): `agent_m1.py`, `agent_m2.py`,
  `agent_protected.py`, `agent_batch6.py`, `agent_m3.py` (six lines), `agent_m3b.py` (several drafts +
  repaint acknowledgement + stale + expired + access off)
- hygiene: no C0 control bytes in changed files; `git diff --name-only <base>..HEAD` shows no
  Indicators-owned file changed by the Agent (only ChartWidget's two adapter lines).

## B. Production acceptance workspace — VERIFY before any mutation (read-only GETs)
Baseline captured 2026-10-10 ~08:15 EDT (scratchpad `s5_prod_baseline.md`):
- Layout 109 "Agent Indicators Acceptance" exists, owned by the admin account (38c023cf…), ONE
  unlinked chart `w-chart-1791592315546` with its OWN settings (not inheriting `chart_settings`).
- No global layout rows; every layout row is the admin's own.
- Main Trading = `chart_settings` pref sha `c683e423dc28f318`; Positions = watchlist (4 symbols) sha
  `f3e38ec5c7602d82`; live board, groups, dock, chart templates and user-definition list fingerprinted.
- Stores written by acceptance are keyed by the signed-in user (`user_definitions WHERE user_id=?`,
  layouts `user_id`, preferences per user); the Agent has no path that writes a global layout.
- Re-capture on the day: same values (except the active layout), then open 109, confirm
  `charts_active_template.id === 109`, observe 2 minutes with zero writes.

## C. Real-model acceptance matrix (admin tab, layout 109 only; real /api/agent/turn and real /converse)
Disposable fixtures only: every saved definition is named with the prefix `M3 Acceptance`.

| # | Member says | Expect (typed outcome → receipt) | Mutation |
|---|---|---|---|
| 1 | "Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA." | `applied` → "Updated … (draft — not saved)"; no preview; no save | draft only |
| 2 | "What would you recommend adding?" | `answer` → builder's reply + "No change was made to the draft."; revision unchanged; no Undo | none |
| 3 | "Okay, also require RSI to be above 50." | same draft (same lineage, next revision) → "Updated …" | draft only |
| 4 | "Actually, undo that last change." | fast-path Undo, no model call → "Undid the last change to …"; summary = step 1 | draft only |
| 5 | "Show me the preview." | "Showing … as a preview on Chart (SYM) — a preview only, not saved"; board pref unchanged | none persisted |
| 6 | "Save it as M3 Acceptance Bullish Trend and add it to my chart." | PROPOSAL with revision, summary (+ ack if any) → Apply → "Saved … confirmed by reading it back" → separate "Added … (saved)" | 1 definition + 1 instance on 109 |
| 7 | Undo the chart add | "Removed the … I added (saved)"; the saved definition stays | instance removed |
| 8 | Two drafts, then an unaddressed follow-up | "You have 2 indicator drafts open — which one do you mean?" + buttons; nothing sent | none |
| 9 | Pick one; continue | only that draft's revision moves | draft only |
| 10 | Repainting draft ("mark pivot highs …"), "save it as a new indicator" | PROPOSAL shows the specialist's ack sentence verbatim + revision → Apply → saved with ack | 1 definition |
| 11 | Stale Save: propose, change the draft, Apply | refused "The draft changed since I planned this"; nothing saved | none |
| 12 | Permission loss: propose, flip `uct.feature.createIndicator`=0, Apply | refused "Create Indicator isn't available…"; nothing saved | none |
| 13 | Reload the tab after #6 | definition + instance persist; draft gone; no stale Undo offered | none |
| 14 | Partial application: Save + add to a chart whose indicators can't be changed | "Saved …" then a separate refusal for that chart; Save NOT rolled back | 1 definition |
| 15 | Protected layout: open Main Trading, ask for the preview | refused by the protected-layout guard; a draft question still answers | none |
| 16 | Fingerprints after the run | Main Trading, Positions, other layouts unchanged; 109 back to its start effective indicators | — |

Cost guard: the real-model run is ~20 Agent turns + ~6 /converse turns; daily cap stays 3000.

## D. Release safety (unchanged by this release)
Agent admin-only · Indicators member cohort OFF · budgets/flags unchanged · no server config change ·
no Main Trading / Positions change · no force push or gate bypass · receipts only after authoritative
read-back. `UCT_AGENT_DAILY_CAP=3000` is the DEV value and must be reduced to the approved production
value before ANY member rollout (not changed in S5 preparation).

## E. Deployment and rollback
1. Record the production SHA + Railway `web` deployment id immediately before the push.
2. Indicators lands their integration first (their release), or one combined push of the
   integration branch, as agreed; gate + promote green; Railway `web` SUCCESS on the exact SHA;
   served bundle contains `indicator.saveDraft` and "which one do you mean?".
3. Rollback = `git revert` of the Agent M3 commits (client-only; no schema/server change) and a
   normal gated push; Indicators' interface may stay (it is inert without the Agent caps). Never a
   Railway-only rollback (they do not hold here). Acceptance definitions are soft-deleted only with
   owner authorization.
