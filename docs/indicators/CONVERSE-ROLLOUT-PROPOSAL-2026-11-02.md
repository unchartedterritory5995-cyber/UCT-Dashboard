# `/converse` staged rollout: a proposal (2026-11-02)

**This is a proposal. Nothing in it is enabled.** The owner decided on 2026-11-02 not to open the full
plain-English builder (`POST /api/user-definitions/converse`) to every member yet. This file says what
a staged rollout would look like, so that the decision can be taken on a plan. No flag, cohort or member
changes until the owner approves each stage separately.

## What exists today (measured on `2cd4c3839c`)

**The gate.** `api/routers/user_definitions.py` (`/converse`) admits:
- an admin; or
- a member for whom `rollout_gate.create_indicator_enabled_for(user_id)` is true. That function checks
  the `CREATE_INDICATOR_COHORT_ENABLED` kill switch FIRST, on every call, and then membership of the
  admin-written `create-indicator` cohort.

**The store.** `api/services/rollout.py`, operated only through `tools/rollout_cohort.py`, which is
read-only unless `--apply`. There is no web UI, and there must not be a second store.

**The fallback.** Everyone else gets `/propose` (`ConciergeBox.jsx`):
- one formula column;
- no markers, no paints, no second output.

The fallback is unchanged by any stage below.

**The telemetry.** Every turn writes a `converse_turn` row (`api/services/indicator_telemetry.py`). It
holds the outcome, failure class, repair gate, attempts, calls, cost, tokens and latency, and no member
text. `rollout_report(days)` aggregates these rows:
- first-pass, repair and ok rates;
- cost per turn (mean and median) and the highest spend for one member on one day;
- latency p50 and p95;
- results by failure class;
- unsupported demand.

**Spend controls.**
- The per-member daily cap, `dc.spend_for` against `cap_usd`, is checked before every call, including
  the repair.
- The global member-spend guard, `cost_guard.may_member_spend`.

## Eligibility, by stage

| Stage | Who | Size | Entry condition |
|---|---|---|---|
| 0 | admins (today) | admins only | — |
| 1 | hand-picked active indicator users | 5–10 | QA gates G1–G4 green on the release candidate |
| 2 | paid members who saved ≥1 indicator in the last 30 days | ~10% of that group, seeded by `tools/rollout_cohort.py --apply` from a reviewed list | Stage 1 held 7 trading days with monitoring M1–M5 inside limits |
| 3 | all paid members | — | Stage 2 held 10 trading days inside limits, and an owner decision on the global spend ceiling |

A member is never added by self-service, and never through `user_preferences`, which members can write
for themselves. A cohort is an admin-written `user_tags` row.

## QA gates (before stage 1)

- **G1. Model-free rails green.** The corpus (`tests/test_plain_english_chart_door.py`), the
  conversation suites, and the rename guard (#680).
- **G2. Live-model evaluation inside its gates** (`E2E-EVAL-DESIGN-2026-11-02.md`). This is a paid run
  and needs separate approval.
- **G3. Browser end-to-end check of the three reference examples:** create, display, save, reload,
  edit.
- **G4. Rollback rehearsed in a sandbox.** Flag off, then confirm that a cohort member's next request
  gets the `/propose` box with no error page.

## Monitoring (each stage, read daily from `rollout_report(7)`)

| # | Signal | Limit that pauses the stage |
|---|---|---|
| M1 | `ok_rate` | below 0.85 |
| M2 | `repair_rate` | above 0.35 (a repair doubles the cost) |
| M3 | `usd_per_turn_median` / `usd_per_member_day_max` | above 1.5 × the stage-0 baseline, or any member at the per-member cap two days running |
| M4 | `latency_ms_p95` | above 20 s |
| M5 | `by_failure_class` | any `internal:error` row; any new refusal gate appearing 5+ times a day |

Two more signals are useful but are not in today's report:
- the save-after-turn rate (a `studio_action` with `created` after a `change`);
- the share of turns abandoned before a save.

Both can be added to `rollout_report` as additive keys.

## Rollback

1. **Fast lever.** Set `CREATE_INDICATOR_COHORT_ENABLED=0` on `web`. The flag is read per call, so
   cohort members fall back to `/propose` on their next request, and admins are unaffected.
   - ⚠️ `railway variables --set` restarts `web`. Confirm a new boot, and read the value inside the
     running process, not from `--kv`.
   - Then record the change in `docs/feature_flags.json` in the same push.
2. **Narrowing.** `tools/rollout_cohort.py` removes members. This is the lever when only stage 2 or 3
   is the problem.
3. **Slow lever.** Revert the code. It should never be needed for a rollout problem.

**Saved definitions are untouched by every lever.** A definition made through `/converse` is an
ordinary saved definition. It keeps drawing, alerting and scanning for a member who has fallen back to
`/propose`; that member just cannot edit it in words.

## Fallback behaviour a member sees

- **Not eligible, or flag off.** The one-line formula box, as today. No error, and no mention of a
  missing feature.
- **Over the per-member cap.** The existing member-safe refusal (`cost:user`). Nothing is applied.
- **Global spend guard tripped.** `cost:global`. Same as above.
- **Model unavailable.** `model:transport`. Same as above.
  - ⚠️ A known backlog item: credit and auth errors currently surface as `model:transport` too
    (memory `indicator-model-unavailable-gate`). Fix it before stage 2, so monitoring can tell an
    outage apart from a credit problem.

## Owner decisions needed

1. Approve stage 1 and its member list.
2. The per-member daily cap for cohort members: `CONVERSE_USER_CAP_DAILY`, which falls back to
   `CONCIERGE_USER_CAP_DAILY` (`definition_conversation.conversation_cap_usd`). There is no proposal
   to change it.
3. A global daily ceiling for `/converse` spend at stage 3.
4. Approval for the G2 paid evaluation.
