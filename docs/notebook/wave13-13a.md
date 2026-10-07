# Wave 13, lane 13A: plan vs execution grading

Branch `feat/notebook-w13a`, from `origin/feat/notebook-w12-landing` at `0c437e7c6d`, tip
`9e3d01c56e`. Spec: `docs/notebook/WAVE-13-PLAN.md` (final, `9d74dc3c15`): section 3 and
Appendix A.13A; ruling R4 (section 8) sets the constants, ruling P4 sets the target tolerance.
Flag `NOTEBOOK_PLAN_GRADING_ENABLED`, unset = OFF.

| file | what it is |
|---|---|
| `api/services/journal_two/plan_extract.py` | the ONE reader of plan levels (entry, stop, target, shares) in a note |
| `api/services/journal_two/plan_grading.py` | matching, the freeze, the four checks, the discipline record |
| `api/routers/notebook_plan_grades.py` | the routes |
| `app/src/pages/journal-2-0/components/trade/PlanGradeCard.jsx` | the grade card on the closed-trade page |
| `app/src/pages/journal-2-0/components/DisciplineRecord.jsx` (Insights section) | last 20 / last 60 |
| `app/src/pages/journal-2-0/lib/planReview.js` | the review-note door |
| `app/src/pages/journal-2-0/lib/planLevels.js` | the client's plan-level builders (`PLAN_ROLES`, pinned against `plan_extract.py`) |
| `tests/test_notebook_plan_extract.py` (51), `tests/test_notebook_plan_grading.py` (46) | backend rails |
| `app/src/pages/journal-2-0/a11y/planGrading.a11y.test.jsx` (5), `PlanGradeCard.test.jsx` (9), `DisciplineRecord` tests (4), `TradesTable.planGrade.test.jsx` (2), `planReview` tests (3) | frontend rails, per the shipping commit |

## 1. What shipped (member-facing)

- **Plan grade card** on the closed-trade page: four checks worded from the server's numbers —
  Entry (Kept / Missed), Stop (Honoured / Not honoured), Size (Kept / Undersized / Oversized —
  rendered as Kept / not-Kept), Target (Hit / Reached, not taken / Not reached / — / Unreadable).
  Labels: "judged by day" (a date-only entry), "plan edited after entry", "stop taken from the
  plan" (a broker placeholder-stop trade), "size counts every close" (a position closed in
  pieces). The card says "Frozen when it was first matched. Editing the plan does not change
  this grade." Re-link (and the member's own pick on a tie) and Write review note are the two
  actions (`api/services/journal_two/plan_grading.py:1-38`, `ca7424eb02`).
- **Discipline record** — an Insights section, offered only while the gate is on: last 20 and
  last 60 closed trades, with R3's sample wording (`plan_grading.py:555-579`).
- **Unplanned chip** on the Trade Journal's trades table: one status request per page
  (`GET /api/j2/plan-grades/status`); option rows are never asked about; nothing is filtered
  (`ca7424eb02`).
- **Review note**: one click writes a frozen grade table (worded by the same text module the
  card uses), a link to the plan note, and frozen entry/exit charts, through the member's own
  save path (`createNoteViaApi` + `settleNoteWrite`), tagged `plan-review` (`REVIEW_TAG`,
  `plan_grading.py:208-219`) so the matcher never reads a review note as the next trade's plan.
- **Setup chip**: when a broker trade has no setup and the matched plan names one, the card
  offers to write it through the page's own `PATCH /api/j2/trades/{id}` — this lane makes no
  trade write of its own (`plan_grading.py:670-671`).

## 2. The flag

`NOTEBOOK_PLAN_GRADING_ENABLED` (`plan_grading.py:53,99-101`), unset = OFF, read per call through
`api.services.notebook_flags.flag_on`. Registered on every roster the earlier lanes used:
`NOTEBOOK_FLAGS` in `api/routers/auth.py:182` ("enablement — unset means OFF (plan grading, lane
13A)"), the client fallback `notebook_plan_grading_enabled: false` in
`app/src/pages/journal-2-0/lib/offline/notebookFlags.js:55`, `tests/test_notebook_flags.py:45`,
and `docs/feature_flags.json:1281-1288` (dark; the note there is the fullest statement of the
lane's scope and is quoted, not paraphrased, in the ledger entry itself).

## 3. Routes

Router-level gate: an off flag answers 404 for every route "before the session or the body is
read" (`api/routers/notebook_plan_grades.py:36-46`). The body is read inside the dependency
chain, never as a FastAPI body parameter, so a malformed body cannot answer 422 ahead of the gate.

| method | path | answers |
|---|---|---|
| GET | `/api/j2/plan-grades/trades/{trade_id}` | the trade's plan + four checks (may FREEZE a plan on first read — a write to `j2_trade_plan_links` only, idempotent via `INSERT OR IGNORE`) |
| POST | `/api/j2/plan-grades/trades/{trade_id}/relink` | Re-link: a note, a verdict, or no plan |
| GET | `/api/j2/plan-grades/status?ids=a,b,...` | planned / unplanned per trade, `<= 200` ids |
| GET | `/api/j2/plan-grades/discipline?accountId=` | the last 20 and 60 closed trades |

Every read and write is keyed on the session member's id; another member's trade id answers 404
(same pattern as the gallery router this file's own docstring points at, `notebook_plan_grades.py:12`).

## 4. The table `j2_trade_plan_links` (the single authority it owns)

```
j2_trade_plan_links (
  user_id, trade_ref, symbol,
  source_kind, match_tier,
  note_id, verdict_id, version_id, plan_as_of,
  plan_json, flags_json,
  matched_at, relinked_at, relink_count, previous_json,
  PRIMARY KEY (user_id, trade_ref)
)
```
(`api/services/journal_two/db.py:2001-2008`, comment block at `:1991-2000`.)

- **Keyed on `trade_ref`** (`ext:<external_id>` for a broker trade, `id:<row id>` for a manual
  one, `trade_refs.py`) — **never `j2_trades.id`**, because a broker purge and reinsert reissues
  that id and a grade keyed on it would silently fall off its trade
  (`plan_grading.py:29-30`, test `test_STABLE_KEYS_a_broker_purge_and_reinsert_keeps_the_frozen_plan`).
- **The freeze.** `INSERT OR IGNORE`, never `REPLACE`, so a second matcher (another tab, a later
  request after the note changed) can never overwrite the plan that was frozen
  (`plan_grading.py:363-373`). Only Re-link replaces a frozen row, and the replaced row is kept
  in `previous_json` (capped at the last 20, `plan_grading.py:430-449`).
- **Purged with the account**: `j2_trade_plan_links` is in `account_purge._DIRECT_USER_TABLES`
  (`api/services/journal_two/account_purge.py:102`). No address-space row is needed — the table
  has no name column, so `address_space.saved_object_tables` never counts it (same shape as
  `j2_chart_fingerprints` in lane 13I-1).
- **`plan_extract.py` is the one reader of plan levels** everywhere in this feature (and is
  documented in-file as the shared authority 13D's level index and 13H's chart roles are meant
  to build on): chart-role annotations (13H) > trade-plan canvas levels > Entry/Stop/Target/Shares
  number properties > labelled text / the setup-plan numbers table, plus the Compass verdict row
  as a fifth, row-shaped source (`plan_extract.py:1-60`). A role named twice with different
  values in one shape reads `unreadable`, never averaged or silently picked; a target with
  several scale-out values resolves to the nearest one when they are all on the same side of
  entry (`plan_extract.py:27-32`, `_resolve` at `:188-200`).

## 5. Matching, as-of-entry, and the four checks

- **Matching tiers**, first tier with a candidate wins: an explicit note link
  (`note_trade_links.notes_linked_to_trade`) → a Compass verdict (the one the trade was entered
  against, else the latest in the 30-day window) → a note on the ticker written within 30 days
  before entry (`plan_grading.py:293-320`). Two candidates in the winning tier is a tie — the
  member picks (`STATUS_NEEDS_PICK`); none is `STATUS_UNPLANNED`, flagged and never frozen so a
  plan linked later still matches (`db.py:1997-1998`).
- **As-of-entry**: a note is read as it stood at the cutoff — its current row if unchanged since,
  else the latest `j2_note_versions` row at or before the cutoff, else the current row labelled
  `edited_after_entry` (`plan_grading.py:160-203`). A date-only entry is judged by its ET day,
  cutoff at end of day, and flagged `date_only` (`entry_moment`, `plan_grading.py:123-143`).
- **The four checks** (`grade_checks`, `plan_grading.py:476-550`), the R unit is `|entry − stop|`
  from the **plan**, so a broker trade with a placeholder stop is still graded on the plan's
  stop:
  - **Entry**: kept when `|fill − planned| <= max(0.25·R, 0.005·planned entry)` (R4).
  - **Stop**: honoured when the exit is at or better than `stop − sign·0.25·R` (R4's slippage
    line).
  - **Size**: kept within ±10% of planned shares (R4); a position closed in pieces sums the
    shares across every `j2_trades` row sharing the same entry (`_entered_shares`,
    `plan_grading.py:592-601`), labelled `size_from_closes`.
  - **Target**: the ruling (P4) is `TARGET_SHORTFALL_R = 0.25` — "the target counts as hit
    within this much of it" (`WAVE-13-PLAN.md`:525-526, "the planner's value; R4 did not set
    it"). The shipped states are **not** a binary hit/early-exit: `grade_checks` computes
    `hit_line = target − sign·0.25·R` and returns `"hit"` when the exit cleared that line; else,
    if the stored MFE (`j2_trade_excursions.mfe_price`) cleared the *unshortened* target, it
    returns `"reached_not_taken"`; else `"not_reached"`; with no MFE on record it returns
    `"unknown"` (`plan_grading.py:529-546`). There is no state literally named "early exit" in
    the code — `"not_reached"` is the closest the shipped behaviour comes to that idea, and
    `"reached_not_taken"` covers an exit that came before the target was hit but after price
    touched it. Cite `plan_grading.py:529-546` for the exact logic rather than a paraphrase.
  - A missing input reads `{"state": "none"}` (a dash in the UI) or `{"state": "unreadable"}`
    when the underlying plan role was unreadable — unreadable always beats absent (`_missing`,
    `plan_grading.py:466-473`). Constants are pinned in one block
    (`plan_grading.CONSTANTS`, `:56-75`) and tested value-by-value.
- **Discipline record** (`discipline_record`, `plan_grading.py:740-780`): every closed item,
  equity and options, newest first, no filter on source or exclusion flag — "the record counts
  what the broker sent" (`:723-724`). Options are counted in `trades`/`options` but never graded.
  R3 sample wording (`sample_band`/`rate_stat`, `:555-579`): n<10 "too few to judge", 10-24
  "thin sample" with a Wilson 95% range, 25+ normal.

## 6. Decisions (the lane's own)

1. The target's tolerance is the planner's own value (P4), not re-derived from R4, and is pinned
   as a single named constant (`TARGET_SHORTFALL_R`) rather than folded into the entry/stop
   tolerance so a future re-ruling touches one line.
2. The R unit for every check is the **plan's** `|entry − stop|`, never the trade's own fill
   spread — a broker trade with a placeholder stop (`stop == entry`) would otherwise divide by
   zero or grade against a stop nobody set; `stop_from_plan` labels that case.
3. Freeze-at-first-match with `INSERT OR IGNORE` and a kept `previous_json` on Re-link means a
   grade is reproducible from the frozen row alone — re-running the matcher on a later day never
   changes what a member already saw, even if the note, a later nightly, or a formula change
   moved underneath it.
4. `trade_ref`, never `j2_trades.id`, is the stable key specifically because of the broker-purge
   class of bug this repo has hit before (`lesson_a_second_authority_over_one_value`-adjacent):
   mutation K1 below is the proof this matters, not a hypothetical.
5. A plan-review note is tagged and excluded from the unlinked-note tier (never from an explicit
   link) so a member who writes a review and then explicitly links it back is not blocked, but
   the matcher never accidentally treats a review of trade N as the plan for trade N+1.

## 7. Verification — cited exactly

### Tests (backend, at the shipping commit `ca7424eb02`'s own citation)
`tests/test_notebook_plan_extract.py` (51) and `tests/test_notebook_plan_grading.py` (46), per
the commit message of `5e95abac23`. Not independently re-run in this pass; cited as the commit's
own claim, not re-measured.

### Mutation proof — re-checked against the raw file

Final record: `docs/notebook/evidence/wave13-13a/mutation-58c60ce741.txt`.

**19 of 19 mutations KILLED, matches the "19/19" cited in commit `a78cee85cf`'s message exactly.**
Counted directly from the raw file's per-mutation entries: `C1`, `C2` (the two R4 constants),
`B1`–`B5` (five tolerance-boundary mutations: entry-on-the-line, stop-slippage-on-the-line twice,
size-on-the-line, target-shortfall-dropped), `F1`–`F3` (freeze: `OR REPLACE` instead of `OR
IGNORE`, the frozen link ignored, the note read live instead of as-of-entry), `K1` (the stable
key), `M1`–`M2` (the mirror: status answer and discipline record leaving broker trades out),
`G1`–`G2` (both gate defaults flipped on), `R1` (R3's "too few" boundary), `X1`–`X2` (the reader's
conflict rule, a plan-review note read as the next trade's plan), `U1` (the client's Unplanned
chip). All eighteen backend mutations restore-verified against the committed blob
(`restored sha ... == committed blob (LF-normalised): True`); the frontend mutation `U1` restores
via vitest's own re-run. `VERDICT: PASS - every mutation killed, every restore verified against
the committed blob` is the file's own last line.

⚠️ **This was not the first run.** The prior record,
`docs/notebook/evidence/wave13-13a/mutation-35dfdb9e34.txt` (committed in `58c60ce741`'s own
parent), shows `K1` **survived** at that point: after a purge+reinsert the re-run matcher
re-derived the same plan from the note's pre-entry version, so the rail could not tell a kept
link from a rebuilt one (commit message of `58c60ce741`). The rail was strengthened (re-link to a
second plan before the purge, assert that choice survives it) and K1 is killed in the final file.
Both records are committed; the FAIL record was kept as written (R-RAW), not overwritten.

### Walk — re-checked against the raw file, and the sandbox-integrity caveat is real

Three walks were run as the lane iterated on a touch-tap-target fix. The **final** one, at tip
`a267f70c6f` (the 44px fix), is `docs/notebook/evidence/wave13-13a/walk-a267f70c6f/walk.json`:

**10 of 10 steps PASS** (`P0_gate_and_identity` through `P9_no_page_errors`) — matches "walk
10/10". Specifically: P0 gate+identity, P1 create a plan note by keyboard, P2 log a matching
trade, P3 see the grade at 1200px, P4 edit the plan afterwards and confirm the grade is
unchanged, P5 an unplanned trade is flagged (chip + trade page), P6 the discipline record at
1200px, P7 keyboard-only Re-link (51 tabs to reach the button), P8 the grade card at 390px (the
44px-floor fix this walk exists to verify: `"btn": {"h": 44, ...}`), P9 zero unforced page
errors.

⚠️ **The sandbox-integrity line is NOT clean on this walk, and the finish-line criterion in
`w13-resume-common.md` ("walk ... PASS (integrity CLEAN)") is not fully met by it.** The walk's
own `first_line`: *"SANDBOX INTEGRITY: INCOMPLETE -- pre-boot (baseline) CLEAN, post-boot (+15s)
CLEAN, post-prewarm (+120s) CLEAN; 62 db files hashed; no checkpoint 'shutdown'"* — the run never
reached a shutdown checkpoint (`"stop": "FORCED after 120 s without a graceful exit"`). Every
step the walk measured passed, and the three checkpoints it did reach were CLEAN against
`C:\data` (no shared-root write); what is missing is the fourth (shutdown) checkpoint, because
the sandbox process was force-stopped rather than shut down gracefully. The **second** walk, at
`a78cee85cf` (`walk-a78cee85cf/walk.integrity.md`), has the same gap (3 checkpoints, no
shutdown). Only the **first** walk at `58c60ce741` was similarly 3-checkpoint. None of the three
13A walks shows a clean 4-checkpoint integrity record with a shutdown row — this is stated rather
than hidden, per this doc's own citation rule.

## 8. Open items

- The sandbox-integrity "shutdown" checkpoint was never reached on any of the three 13A walks
  (see §7). Not a product defect — every measured step passed and pre/post-boot/post-prewarm were
  clean — but it means the walk tooling's own finish-line bar (a graceful shutdown checkpoint) is
  unmet. Not fixed in this lane.
- Options are counted in the discipline record's `trades`/`options` totals but never graded
  ("not graded in v1", per Appendix A.13A's own scope line) — this is a stated exclusion, not a
  gap.
- `member_interest._position_syms` (outside this lane, named here because 13C-1's fix touches
  the same symptom class on a sibling feature) is not this lane's code and was not touched here.
