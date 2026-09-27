SANDBOX INTEGRITY: CLEAN -- 11 sandbox boots (9 switch boots + the rollback's tip control and its git-archive boot), every one CLEAN at pre-boot, +15 s, +120 s and shutdown, 62 db files hashed each time; C:\data-w10c :8213; logs in docs/notebook/evidence/wave10-10c/{switch-rehearsal,rollback}/

# Notebook switch and rollback rehearsal — 2026-09-26 (wave 10, lane 10C, ruling R-11)

**R-11:** *rehearsal = sandbox mechanism for every switch + production reach for every
per-request switch in ONE batched off-hours window (2 redeploys) + rollback Procedure A on a
sandbox, never a production revert.* This file is the sandbox half, measured, and the production
half, PRINTED for the controller. Lane 10C ran nothing against production.

| part | verdict | evidence (raw committed before this file) |
|---|---|---|
| Every switch, a restart per value | **PASS** on the fixed tool — 9 boots × 7 rows: 8 in the r1 re-run plus boot 4's clean retry (§1a); the first run (`dfa873f4c`) also passed, on the pre-fix tool | `evidence/wave10-10c/switch-rehearsal-r1/`, `evidence/wave10-10c/switch-rehearsal-r1-boot4/`; first run `evidence/wave10-10c/switch-rehearsal/` |
| The controller's check, run on every boot | **PASS** 9/9 (`VERIFY ON` ×8, `VERIFY OFF` ×1) | same file, key `verify` |
| Rollback on a sandbox from a `git archive` | **Procedure A as written: not executable at today's tip; the newest-wave rollback: PASS** | `6252d03bc`, `evidence/wave10-10c/rollback/` |
| Production window | **NOT RUN — the controller's**, commands below | — |

## 1a. The re-run on the fixed tool (fix round 1), and what it reads

The table below comes from the FIRST run (`dfa873f4c`). That run used the tool as it stood
before fix round 1; the version at `e6d411ab7` launches each boot through a per-boot launcher
so that the conftest bridges rail holds. The rehearsal was therefore run again on the fixed
tool (**r1**), and r1 is the run this file's PASS rests on:

- **r1, 9 boots** (`evidence/wave10-10c/switch-rehearsal-r1/switch-rehearsal-summary.md`):
  aggregate **INCONCLUSIVE**, by the tool's own rule that one boot not CLEAN makes the whole run
  INCONCLUSIVE.
  - 8 boots were CLEAN, with all 7 switch rows PASS and the verify check PASS on each.
  - Boot 4 (`only-NOTEBOOK_OFFLINE_DEFAULT_ON-off`) was NOT CLEAN. The shared-root integrity check
    saw `C:\data\auth.db` change between its pre-boot baseline (20:55:14) and +15 s (20:55:49):
    same size, different content.
  - The sandbox ran on `C:\data-w10c`, and its tripwire recorded nothing, so this sandbox's server
    did not write the file. Another process on the box wrote the live `auth.db` in that window, and
    the tool correctly refused to call the boot clean.
- **Boot 4 retried alone** (`evidence/wave10-10c/switch-rehearsal-r1-boot4/`): CLEAN at every
  checkpoint, all 7 switch rows PASS, VERIFY ON PASS.

**Reading:** every switch is PASS on the fixed tool across all nine configurations (r1's 8 CLEAN
boots plus boot 4's CLEAN retry), and the first run agrees with it row for row. The outside
write to the live `auth.db` at 20:55 is a box-hygiene item, not a switch result. It has not
recurred: the file's last write is 2026-09-26 20:55:29, checked at 2026-09-27 00:20 CT. A
read-only watcher now records the process list if it changes again.

## 1. Every switch, on a sandbox

`python tools/notebook_switch_rehearsal.py --run --data-dir 'C:\data-w10c' --port 8213`. Each
boot provisions a NEW paid member through the app's own doors (sign-up, comp, verify-email),
so the tour's "a member with no notes" condition is real every time, and one browser context
per boot, so an IndexedDB store from an earlier boot cannot be mistaken for this one's.

What each switch changes, and how it was read (every probe waits the same time whatever value
was expected, so an "absent" is never a shorter look than a "present"):

| switch | kind | rendered probe | door |
|---|---|---|---|
| `NOTEBOOK_OFFLINE_DEFAULT_ON` | kill switch (payload) | the editor opens `uct_notebook_<account>` in IndexedDB | — |
| `J2_SHARE_LINKS_ENABLED` | gate (payload) | the Share sheet's "Share link" section | `GET /api/j2/share/links` 200 / 404 |
| `NOTEBOOK_PUBLISH_ENABLED` | gate (payload) | the Share sheet's "Publish to the web" section | `GET /api/j2/publish` 200 / 404 |
| `NOTEBOOK_ONBOARDING_ENABLED` | gate (payload) | the tour ("Step 1 of 3") on a new member's first visit | `GET /api/j2/onboarding/sample-notebook` 200 / 404 |
| `NOTEBOOK_WRITING_HELP_ENABLED` | gate (payload) | the editor toolbar's "Writing help" | `POST …/writing-help/stream` 422 (gate open, refused before any model call) / 404 |
| `NOTEBOOK_PERSONAL_API_ENABLED` | ROUTE gate (no payload key) | Settings › Connections "Personal API" card | `GET /api/j2/personal/tokens` 200 / 404 |
| `NOTEBOOK_ASK_INSERT_ON` | gate (payload) | payload only — its surface needs an Ask answer (a model call) | — |

Observed (from the raw record):

| boot | values | tour | writing help | share § | publish § | offline store | Personal API card | doors (share, publish, sample, writing help, tokens) |
|---|---|---|---|---|---|---|---|---|
| production-values | all ON (offline unset) | yes | yes | yes | yes | yes | yes | 200 200 200 422 200 |
| all-off | all `0` | no | no | no | no | no | no | 404 404 404 404 404 |
| restored | all ON | yes | yes | yes | yes | yes | yes | 200 200 200 422 200 |
| only offline off | | yes | yes | yes | yes | **no** | yes | 200 200 200 422 200 |
| only share off | | yes | yes | **no** | yes | yes | yes | **404** 200 200 422 200 |
| only publish off | | yes | yes | yes | **no** | yes | yes | 200 **404** 200 422 200 |
| only onboarding off | | **no** | yes | yes | yes | yes | yes | 200 200 **404** 422 200 |
| only writing help off | | yes | **no** | yes | yes | yes | yes | 200 200 200 **404** 200 |
| only personal API off | | yes | yes | yes | yes | yes | **no** | 200 200 200 422 **404** |

⭐ **Each single-switch-off boot changed exactly its own surface and door, and nothing else** —
the property the isolation boots exist to prove (a share gate that also hid publishing would
have shown up in the "only share off" row). The auth payload agreed with every value on every
boot, and the verify check (below) passed on all nine.

**Not rehearsed by rendered behaviour, and why** (every Notebook gate the repo's own index
finds is either above or here; `tests/test_notebook_switch_rehearsal.py` fails on a new gate
with neither a probe nor a reason):

- `NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED` — no read-only surface: it acts only on an upload.
- `NOTEBOOK_TASK_REMINDERS_ENABLED` — kill switch read per scheduled run: its only evidence is a
  reminder members would not get.
- `COMPASS_NOTES_TOOL_ENABLED` — no read-only surface: it acts only inside a Compass chat turn.
- `NOTEBOOK_INBOUND_EMAIL_ENABLED`, `NOTEBOOK_SEMANTIC_SEARCH_ENABLED` (+ its mode
  `NOTEBOOK_SEMANTIC_PROVIDER`) — dark on external blockers.
- `NOTEBOOK_OFFLINE_READ_ON`, `NOTEBOOK_CONFLICT_UX_ON`, `NOTEBOOK_ATTACHMENTS_ON` — dark; the
  features are not built.
- `NOTEBOOK_DOOR_GUARD` — a MODE, never switched off. ⚠️ **Its intended value is the owner's
  question** (the plan's §Lane 10C asks it): the ledger measured `unknown-only` set on web on
  2026-09-24 and records no intent (`docs/feature_flags.json`, its note).

## 2. Rollback on a sandbox, from a `git archive` (Procedure A, `wave5-rollback.md`)

Full table and the rules it changes: **`docs/notebook/wave5-rollback.md`, "Measured at
production's tip, 2026-09-26"**. In one paragraph: every Notebook wave landed as a SQUASH, and
waves 6–9 are built on wave 5, so Procedure A's step 1 at today's tip (`origin/master`
`6e7785b52`) stops on **68 unmerged paths**, the guard's own two table files among them — it is
no longer an executable procedure. The rollback that IS executable reverts the newest wave's
squash (`1c4b0bf74`, wave 9): **0 conflicts, both schema tables byte-identical**, the guard rail
17 passed and the runbook's vitest list 20 files / 243 passed on that tree. A sandbox booted
from a `git archive` of it, on the tip's data, showed the reverted wave gone (the bogus-format
export 422 → 200) and the never-revert set intact (a level-2 note opens, its body PUT still
declares `X-UCT-Notebook-Schema: 2`, the stored body keeps the node and the new words) — the
same probe on the tip as the control.

## 3. The production window — the controller's, printed by the tool (verbatim)

⛔ Lane 10C ran none of this. `--check-record` builds the OFF and RESTORE commands from what
production HOLDS; the list below is the ledger's prediction on this branch (on master
`6e7785b52` the ledger also records `NOTEBOOK_PERSONAL_API_ENABLED` armed, and the record will
say so — the tool prints the ledger note as owed when the two disagree).

```
python tools/notebook_switch_rehearsal.py --print-production
```

```text
PRODUCTION WINDOW -- R-11, the controller's half. ONE off-hours window (weekend), two web
redeploys (82-119 s /api/* blip each, docs/runbooks/deploy-windows.md). Nothing here was run by lane
10C. Each step in its own call; read each result before the next (H15: a failing verify after the
RESTORE is answered by re-running the restore, then reporting -- never by diagnosing first).

0. RECORD (read-only; never restarts). ONLY the Notebook keys reach disk, and OUTSIDE the checkout:
     railway variables --service web --kv | python tools/notebook_switch_rehearsal.py --check-record - --save-record "$env:TEMP\notebook-switch-record-<UTC>.txt"
   The full --kv output (every secret on web) passes through the pipe into memory and nowhere
   else; the tool keeps the 10 Notebook keys by name (J2_SHARE_LINKS_ENABLED, NOTEBOOK_ASK_INSERT_ON, NOTEBOOK_ATTACHMENTS_ON, NOTEBOOK_CONFLICT_UX_ON, NOTEBOOK_OFFLINE_DEFAULT_ON, NOTEBOOK_OFFLINE_READ_ON, NOTEBOOK_ONBOARDING_ENABLED, NOTEBOOK_PERSONAL_API_ENABLED, NOTEBOOK_PUBLISH_ENABLED, NOTEBOOK_WRITING_HELP_ENABLED) and REFUSES a
   --save-record path inside the repository. It prints the exact OFF command and the exact RESTORE
   from what production HOLDS -- the record outranks the ledger. The ledger today predicts this OFF set:
     NOTEBOOK_OFFLINE_DEFAULT_ON, NOTEBOOK_ASK_INSERT_ON, NOTEBOOK_WRITING_HELP_ENABLED, J2_SHARE_LINKS_ENABLED, NOTEBOOK_PUBLISH_ENABLED, NOTEBOOK_ONBOARDING_ENABLED
   and NOTEBOOK_DOOR_GUARD (a MODE, never turned off here) is printed for the owner's intent question:
   the ledger measured `unknown-only` on web 2026-09-24 and records no intent (feature_flags.json).

1. OFF -- ONE command (repeated --set; `railway variables --help` first if the CLI version changed):
     railway variables --service web --set "NOTEBOOK_OFFLINE_DEFAULT_ON=0" --set "NOTEBOOK_ASK_INSERT_ON=0" --set "NOTEBOOK_WRITING_HELP_ENABLED=0" --set "J2_SHARE_LINKS_ENABLED=0" --set "NOTEBOOK_PUBLISH_ENABLED=0" --set "NOTEBOOK_ONBOARDING_ENABLED=0"
   Note the UTC time as SET_OFF_AT.

2. VERIFY OFF (GET-only as the smoke account; SMOKE_EMAIL / SMOKE_PASSWORD in the environment):
     python tools/notebook_switch_rehearsal.py --verify https://uctintelligence.com --expect off --set-at <SET_OFF_AT>
   PASS needs: a NEW BOOT (uptime < time since SET_OFF_AT), every payload key above false, and
   every GET door of a switched gate 404: /api/j2/share/links, /api/j2/publish, /api/j2/onboarding/sample-notebook, /api/j2/personal/tokens. No new boot within ~3 min:
     railway redeploy --service web --yes     then re-run step 2.

3. RESTORE -- exactly what `--check-record` printed: deletes FIRST (a delete stages, it does not
   redeploy), then ONE --set (its redeploy boots with both). Note the UTC time as SET_ON_AT.

4. VERIFY RESTORED:
     python tools/notebook_switch_rehearsal.py --verify https://uctintelligence.com --expect on --recorded "$env:TEMP\notebook-switch-record-<UTC>.txt" --set-at <SET_ON_AT>

5. LEDGER, same docs push: each key's note in docs/feature_flags.json gets
   "rehearsed OFF <SET_OFF_AT> .. restored <SET_ON_AT> (wave 10, R-11)".

6. DELETE THE RECORD (it names production's Notebook values; nothing else needs it):
     Remove-Item "$env:TEMP\notebook-switch-record-<UTC>.txt"

NOT switched in this window, each with its reason (the repo's gate index, never a typed list):
  COMPASS_NOTES_TOOL_ENABLED: no read-only surface: it acts only inside a Compass chat turn
  NOTEBOOK_ATTACHMENTS_ON: dark: the feature is NOT BUILT
  NOTEBOOK_CONFLICT_UX_ON: dark: the feature is NOT BUILT
  NOTEBOOK_DOOR_GUARD: a MODE, never switched off; its intended value is the owner's question
  NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED: no read-only surface: it acts only on an upload
  NOTEBOOK_INBOUND_EMAIL_ENABLED: dark (external blockers: DNS/MX, WAF, wrangler)
  NOTEBOOK_OFFLINE_READ_ON: dark: the feature is NOT BUILT
  NOTEBOOK_SEMANTIC_PROVIDER: a MODE, inert while semantic search is dark
  NOTEBOOK_SEMANTIC_SEARCH_ENABLED: dark (waits for OpenAI's written ZDR, R-20)
  NOTEBOOK_TASK_REMINDERS_ENABLED: kill switch read per scheduled run: its only evidence is a reminder members would not get
```

With master's ledger (`6e7785b52`: the personal API armed on web), `--check-record` on a
record holding what that ledger says prints the seven-key OFF command below. ⚠️ That input was a
SAMPLE record written in scratch to exercise `--check-record`, not production's record; the
window's step 0 reads the real one (the record decides):

```sh
railway variables --service web --set "NOTEBOOK_OFFLINE_DEFAULT_ON=0" --set "NOTEBOOK_ASK_INSERT_ON=0" --set "NOTEBOOK_WRITING_HELP_ENABLED=0" --set "J2_SHARE_LINKS_ENABLED=0" --set "NOTEBOOK_PUBLISH_ENABLED=0" --set "NOTEBOOK_ONBOARDING_ENABLED=0" --set "NOTEBOOK_PERSONAL_API_ENABLED=0"
```

and, if `NOTEBOOK_OFFLINE_DEFAULT_ON` is unset in the record (the kill switch's shipped state),
the restore is `railway variable delete NOTEBOOK_OFFLINE_DEFAULT_ON --service web` FIRST, then
one `--set` restoring every recorded `1`. ⚠️ Members see it: for the window's minutes a member
loads a Notebook with no Share button, no tour, no writing help, no Personal API card and the
offline layer off (26 production users as measured 2026-09-12, CLAUDE.md "HOW MANY USERS ARE
IN PRODUCTION"; a weekend window, per the plan's Lane 10C risk line).

## 4. Findings recorded here

- **F-8 closed on the route members use**: `NotebookFlagGate` now mounts on the v5 Notebook
  surface (`8698d7cbf`), so `notebook_config_served` fires there and K-1's rate is measurable.
- **The tour card stacks on the "Meet Compass" card** at the bottom right on a new member's
  first visit (`production-values-home.png`): two first-run cards at once. Cosmetic; a first-run
  sequencing question for whoever owns first-run hints.
- **Procedure A is stale at today's tip** (section 2) — the runbook now says so at its top.
