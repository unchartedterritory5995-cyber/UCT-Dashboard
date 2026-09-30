---
id: MVP-PREREG-1
title: Terminal-Next MVP trial - pre-registration (Ravi)
supersedes: mvp.md section 6.1 (draft, 2026-09-26) and the 2026-09-27 "subject deferred to beta" ruling
status: REGISTERED 2026-09-30 00:45 ET - Phase A not yet started
date: 2026-09-30
---

# Terminal-Next MVP trial - pre-registration

⛔ **This file is the dated artifact CARD 22 requires before day 1** (`mvp.md` §6). It supersedes
§6.1's draft, which is VOID as a pre-registration because its subject changed. Nothing below may be
edited after Phase A's first recorded morning. A change after that point needs a NEW dated file,
and a re-cut bar must **quote the reading that failed** (§6.3's anti-waiver clause).

## The registration

| field | value |
|---|---|
| **Workflow** | `JTBD-M02`: a breadth cell or heatmap tile contradicts the tape → drill to the constituent names → inspect one name's daily/weekly chart. Confirmed by the owner 2026-09-30 ("workflow as stated"). |
| **Incumbent** | **Finviz**: `finviz.com` / `elite.finviz.com` opened for that chart inspection. (The in-drill Finviz PNG tabs no longer exist: `chart.ashx` has zero occurrences in `app/src` — measured 2026-09-26, `mvp.md` §4.1.) TradingView use is **recorded, not counted** against the bar. |
| **Subject** | **Ravi** — owner ruling 2026-09-30, replacing the 2026-09-27 "named at beta" deferral. Existing admin, so the trial needs no cohort build (rung S1). ⚠️ Recorded plainly: Ravi is a partner who co-edits other surfaces (Options Flow, Schwab/live-flow routers); he did **not** build the drill chart under test, which is the non-builder property CARD 22 requires. |
| **Adjudicator** | **Patrick (owner)** — a named non-subject, applying the failure sentence below verbatim and answering PASS / FAIL / INCONCLUSIVE. |
| **Recorder** | Whoever did the work — Ravi records his own occasions in the log below. |
| **Span** | **Phase A (baseline):** each trading morning, before looking, Ravi declares that day **eligible or not** (see Eligibility); on eligible days he records every occasion of the workflow and which tool he inspected the chart in. **Phase A runs 5 trading days or until 10 occasions, whichever is later.** **Phase B (trial):** K of N eligible occasions, **K and N set from Phase A's measured rate** in a successor file dated before Phase B's first morning. ⛔ Not set here: CARD 22 §3 requires a measured denominator. |
| **Withdrawal block** | During Phase B the drill chart is switched **off, unannounced, for one full session** (a withdrawal switch scoped to the trial, built before Phase B — it must never touch members). If nobody asks for it back before the close, it was **tolerated, not preferred**. This is also the kill-switch rehearsal (NOW gate clause 4). |
| **Eligibility** | Declared **that morning**, never retrospectively. A day is eligible if Ravi worked a session in which a breadth number contradicted the tape. ⛔ **"Our chart rendered correctly" is NEVER an eligibility condition** (§6.2): a morning our chart is blank, slow or wrong is eligible, and a Finviz inspection that morning is a failed occasion. More than a third of occasions ineligible ⇒ **INCONCLUSIVE**. |
| **Per-person verdicts** | Published unaggregated. |
| **OI-02** | The verdict must state whether it survives OI-02 being answered. |

## The failure sentence (verbatim from `mvp.md` §6.3, fixed now)

> **This trial FAILS if, on more than N − K of the N eligible occasions recorded in Phase B, the
> subject used a Finviz chart or opened finviz.com for `JTBD-M02`'s inspection step.**
>
> **It is INCONCLUSIVE, and not a FAIL, if** more than a third of the span's occasions were declared
> ineligible; **or** no non-subject adjudicator existed; **or** no non-builder subject existed;
> **or** Phase A produced an N too small to carry a rate.
>
> **It FAILS the thesis, separately, if** the withdrawal block passes with nobody asking for the
> surface back.
>
> **On any of these outcomes, "Terminal-Next displaced Finviz for chart inspection" is not written
> in any artifact, deck, release note or wire.**

## Phase A log

One row per trading morning (declared before looking), then one row per occasion. Append only —
never edit a past row.

| date (ET) | declared eligible? (before looking) | occasion time | the breadth cell / tile | name inspected | chart used: UCT drill / Finviz / TradingView / other | note |
|---|---|---|---|---|---|---|
| | | | | | | |

## The withdrawal switch — built 2026-09-30, how to run it

Built so it can **never touch a member**: the drill chart is hidden only for a user **tagged into
the `terminal-next` cohort** while `TERMINAL_NEXT_ENABLED` is off, and the check runs for admins
only (`rollout_gate.withdrawn_cohorts`, `cohorts_withdrawn` on the auth payload; the drill shows the
list full width; the member's saved board is never changed). Rails:
`tests/test_terminal_next_withdrawal.py`, `BreadthDrillModal.withdrawal.test.jsx`, and the
kill-switch rail, which now acknowledges this as Terminal-Next's first frontend gate by name.

**Before Phase B's first morning** (no visible change for anyone):
1. Owner, in the web pod: `python tools/rollout_cohort.py add --cohort terminal-next --user <Ravi's user id>`
   — read the printed diff (one id), then re-run with `--apply`.
2. `railway variables --service web --set "TERMINAL_NEXT_ENABLED=1"` — Ravi is now in the ON state,
   and the drill looks exactly as it always has.

**The withdrawal block, one full session, unannounced:**
3. `railway variables --service web --set "TERMINAL_NEXT_ENABLED=0"` before the open → Ravi's drill
   shows the names without the chart (NOW-gate clause 4: the OFF state observed killing a surface —
   confirm on his payload: `cohorts_withdrawn` = `["terminal-next"]`).
4. Record whether he asks for it back before the close. Then set it back to `1`.
