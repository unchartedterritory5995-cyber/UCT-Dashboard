# `/converse` admin-only validation stage (2026-11-02)

**Owner decision, 2026-11-02:** support the staged rollout, but do not activate stage 1 or expand
member access yet. Prepare an admin-only validation stage first, and report the proposed member cohort
separately.

**This stage changes nothing.** Admins already reach `/converse` through the role check, independently
of the flag and the cohort (`rollout_gate.create_indicator_enabled_for` is only asked for non-admins).
`CREATE_INDICATOR_COHORT_ENABLED` stays unset, and the `create-indicator` cohort stays empty. The stage
is a structured way of using what admins already have, plus the exit criteria that must hold before
stage 1 is even proposed.

## Preconditions

1. The release candidate is on production. That is #670 (full names, Bollinger Bands, the
   unavailable-column wording) and #680 (the rename guard), plus whichever of #671 and the line-identity
   work is released by then. Until then the admin stage measures the old door.
2. The `indicators security suite` is green on master (agent-lead's #681).
3. The offline end-to-end harness passes on the release candidate. It runs the scripted model and costs
   $0 (`E2E-EVAL-DESIGN-2026-11-02.md`, `tools/converse_eval.py --offline`).

## What admins do (about 2 weeks; each admin, a few sessions)

Real use, on real charts, through the normal door. No synthetic accounts are needed: admin turns are
already labelled `access: admin` in telemetry.

| # | Scenario | Pass when |
|---|---|---|
| A1 | "Highlight when the 9 EMA crosses above the 20 EMA", then "make it the 10 and 30" | markers on the right bars; only the lengths changed |
| A2 | "RSI 28 with a 5-period average of the RSI", then "make the average 9" | two lines; only the average changed |
| A3 | "Background green when the 9 EMA is above the 20 EMA", then "make it blue" | shading on the right bars; only the colour changed |
| A4 | Full names: "Relative Strength Index 14", "Average True Range", "Bollinger Bands 20 2" | built, never refused as an unknown concept |
| A5 | A request it must refuse: "McGinley Dynamic", "colour by sector" | refused in plain words; no internal column name |
| A6 | Rename: "call it Momentum Pulse" on a two-line indicator | the indicator is renamed; no line label changes |
| A7 | Save, reload the page, edit again | draws immediately after reload; the edit applies to the saved version |
| A8 | Delete a line that an alert watches, add a new line with the same name (after line identity ships) | the alert is not re-attached to the new line |

Each admin writes one line per scenario into the validation log: date, scenario, PASS/FAIL, and the
conversation id from the panel. Member text is not needed.

## What is read (daily, by an admin)

`GET /api/indicator-telemetry/rollout-report?days=7` (admin-only). While the cohort is empty,
`everyone_incl_admins` IS the admin stage.

## Exit criteria (all must hold before the stage-1 cohort is proposed for approval)

| # | Measure | Threshold |
|---|---|---|
| E1 | A1–A8 | every scenario PASSES for at least 2 admins |
| E2 | `ok_rate` | ≥ 0.85 over at least 40 admin turns |
| E3 | `repair_rate` | ≤ 0.35 |
| E4 | `usd_per_turn_median` | recorded; this becomes the stage-1 cost baseline |
| E5 | `latency_ms_p95` | ≤ 20 s |
| E6 | `by_failure_class` | no `internal:error`; every refusal class seen has been read and judged correct |
| E7 | No open regression | no defect found in the stage still open |

## What ends the stage early

- Any `internal:error`, any wrong-bar marker or shading, or any unrequested change applied: stop, file
  it, fix it, and restart the stage clock.
- A cost surprise (any admin turn above $0.50) is investigated before continuing.

## What it does NOT do

- It adds no member.
- It changes no flag.
- It spends nothing outside the normal admin cap (`CONVERSE_ADMIN_CAP_DAILY`).
- The paid evaluation is separate and still needs approval.
