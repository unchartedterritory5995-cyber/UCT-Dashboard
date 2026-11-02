# `/converse` stage 1: proposed member cohort (2026-11-02)

**For owner approval. Not activated.** The owner asked for this to be reported separately from the
admin validation stage (`CONVERSE-ADMIN-VALIDATION-STAGE-2026-11-02.md`). Stage 1 is not proposed for
activation until that stage's exit criteria hold.

## Who

**5–10 paid members.** Each must meet ALL of:
1. a paid plan (the door's existing `require_paid`);
2. at least 1 saved indicator in the last 30 days, so they already build indicators and can judge the
   result;
3. at least 5 active days in the last 30, so they will actually use it during the stage;
4. no open support ticket about charts or indicators;
5. preferably, a mix of member types: at least one who uses Pine imports, one who builds by hand, and
   one who mainly uses built-in indicators.

**Excluded:** the synthetic accounts (`smoke@`, `bench@`) and any account in `ADMIN_EMAILS`. Admins
already have access.

## How the names are produced (no production read is made by this session)

A production read is the owner's step. This session does not read production data.
1. An admin runs a read-only query (or an admin page) against production `auth.db` and
   `user_definitions.db` with the criteria above. It returns user ids and counts, with no member text.
2. The owner reviews and approves the list by user id.
3. The cohort is written only with the operator door, a dry run first:
   `python tools/rollout_cohort.py add --cohort create-indicator --user <id> ...` (prints a DRY RUN),
   then the same command with `--apply`.
4. `CREATE_INDICATOR_COHORT_ENABLED=1` on `web` is a separate, later owner decision. With the flag
   unset, cohort membership has no effect (the kill switch is read first).

## What the members get, and what they are told

- **They get:** the full plain-English builder (markers, paints, more than one line), instead of the
  one-line formula box.
- **They are told** in a short note from the owner: it is early, it may refuse or misunderstand, and
  their saved indicators are ordinary indicators either way.
- **There is no in-product "beta" UI.** None exists, and none is proposed.

## Monitoring and rollback

The same as the staged rollout proposal (`CONVERSE-ROLLOUT-PROPOSAL-2026-11-02.md`, M1–M5):
- the `cohort_members` block of the rollout report;
- the per-member daily cap unchanged;
- rollback by unsetting the flag, which is read per call. Members fall back to the formula box, and
  every saved indicator keeps working.

## Owner decisions

1. Approve the criteria above, or change them.
2. Approve the list of user ids once it is produced.
3. Separately, and later, approve the flag.
