# Notebook — the 30-day reliability soak (Phase 7, standard #3)

**What this is:** the plan and the instruments for the soak. **What it is not:** a result.
The plan's bar is *"30-day reliability soak with real members: zero data loss, gates KEEP"*
(`NOTEBOOK-10-OF-10-PLAN.md:129`) and standard #3's *"Zero data-loss incidents over a 30-day
window with real members"* (`:25`). Nothing here reports a soak verdict; the soak is thirty
calendar days of real use after waves 5–8 are live, and its verdict is what `tools/nb_soak.py`
prints at the end of them.

Rulings in force (wave 9, `wave9-rulings.md`): **D-9C1** exposure floor · **D-9C2** reuse the
local observer + one admin read, no server job, no table, no flag · **D-9C3** page on integrity
and heartbeat only, never on speed · **D-9C4** exposure = distinct notes edited per day, no new
write path · **D-9C5** KEEP on a soak-only log, or a non-KEEP ruled in writing · **D-9C7** study
participants join the cohort with consent.

⛔ **Today the organic population is 0** (the live Q1 log, rows 2026-09-25 15:00–19:00 ET:
`organic 0 · synthetic 1 · rig/owner 1`). A soak that opens with no cohort is **INCONCLUSIVE
from day one** and stays so until the floor in §6 is met — "zero data loss" over nobody is not
evidence, and `nb_soak.py` never prints PASS by default.

---

## 1. Preconditions — each with the check that proves it

Nothing starts until every row reads true. "Proven" means the check was run and its output
recorded in the soak's opening entry (§2), never inferred from a ledger or a memory.

| # | precondition | the check that proves it | who |
|---|---|---|---|
| P1 | Waves 5–8 merged and deployed | `git merge-base --is-ancestor <wave-8 merge sha> origin/production` exits 0, and the deploy list shows that `web` deploy `SUCCESS` (CLAUDE.md "verify the deploy by its own record's STATUS") | owner merges; controller verifies |
| P2 | The D2 record is committed — the 2026-09-20 REVERT verdict and its log, with D2's KEEP ruling (`NOTEBOOK-10-OF-10-PLAN.md:151`) | `git ls-files` lists it. ⚠️ Absent on this lane's base (`324a5135a`: `git ls-files \| grep -i verdict` finds no such record) | controller, before the soak opens |
| P3 | Flag states recorded **from the running process**, never from `docs/feature_flags.json` | as the rig: `GET /api/auth/me` — every `notebook_*` key is derived per request in `_access_payload` (`api/routers/auth.py`, `_notebook_flags`), so the payload IS the running process's answer. Record every `notebook_*` key and value | controller |
| P4 | C5 deployed: `GET /api/admin/notebook-soak` answers | `api/main.py` mounts `api/routers/notebook_soak.py` (the controller's step); then one sampler run writes a sidecar line with `figures`, not `"skipped": "HTTP 404"` | controller |
| P5 | The out-of-repo copies refreshed and **their sha256 equal to the repo's** | `python nb_soak.py --dry-run --repo <checkout> --copies C:\Users\Patrick\uct-q1-observe` → the "Running copies vs the repo" section reads `equal` for `nb_observe.py`, `nb_gate.py`, `window_check.py`, `nb_soak.py`. ⚠️ Today `window_check.py` DIFFERS (copy `09714ff93967…`, repo `76c0a9a5cb7f…`), and `nb_observe.py` will differ from the moment this lane merges (it gains the sidecar). `tests/test_nb_observe.py::test_the_deployed_copy_matches_the_repo…` is red until then, by design | controller refreshes after merge, **owner approves** |
| P6 | The soak's OWN files are set in the scheduled jobs' environment | `UCT-WaveQ1-Observe` (`nb_observe.cmd`): `NB_OBSERVE_LOG`, `NB_SOAK_SAMPLES`, `NB_SOAK_START`. `UCT-WaveQ1-Gate`: `NB_OBSERVE_LOG` (the soak log), `NB_GATE_VERDICT`. The daily `nb_soak.py` job: every variable in §3. Read each back from the task's action, not from memory | controller, owner-approved |
| P7 | Task Scheduler jobs verified | `schtasks /Query /TN "UCT-WaveQ1-Observe" /FO LIST /V` — `Last Run Time` within 2 h, `Last Result` `0` (`wave-q1-sunday-gate.md` §0). Same for `UCT-WaveQ1-Gate` (Sunday 17:05 CT), `UCT-WaveQ1-Canary` and the new daily `nb_soak` job | controller |
| P8 | The rig is signed in | `window_check.py` stamps a check row (a signed-out rig writes a standing `### ⛔ SIGN-IN REQUIRED` row instead, `window_check.py` `stamp_signin_required`); the soak's first sidecar line has `figures` | owner signs in by hand (`window_check.py --park`); never a credentials file |
| P9 | The cohort consented and is above the floor's identity count | ≥ 5 organic accounts invited, each with the study consent (`docs/notebook/user-study/consent.md`, D-9C7) or an invitation that says the same about telemetry; the first cumulative read (`cumulative.identities_editing.organic` in the sidecar) reports ≥ 1 before day 7 | owner |

⚠️ **Wave 8 is not in this lane's base (`324a5135a`).** Its onboarding gate
(`NOTEBOOK_ONBOARDING_ENABLED`), sample notebook and publish/share changes are PLANNED
(`wave8-dispatch-plan.md`) and were not read here. The soak's signals read none of them —
but see §11 for what to re-check when they land.

## 2. The window

- **Start** = a recorded UTC timestamp and the production SHA at that minute, written into the
  soak's opening entry AND into the jobs' environment as `NB_SOAK_START` (ISO UTC) and
  `NB_SOAK_START_SHA`. The dashboard prints both; a missing SHA prints `NOT RECORDED`.
- **Length** = 30 calendar days **plus every unobserved interval**. `nb_soak.py`
  (`unobserved_intervals`) lists each one and moves the end out by its length:
  - a `**SKIPPED**` row in the soak log (the 2 h it would have covered);
  - a heartbeat gap — no row for longer than 2 h 20 min (`GAP_TOLERANCE`), including a trailing
    gap up to now;
  - a standing `SIGN-IN REQUIRED` row in THE WINDOW-WATCH LOG (from first seen to now);
  - any interval **no successful soak read covers** (C5 not deployed, failing, or 401 on a
    signed-out rig). ⭐ A single failed read the NEXT read recovers is NOT unobserved: the
    sampler's intervals tile (`nb_observe.next_soak_since`), so no server event is lost.
- **Today organic = 0**, so a soak opened now reads INCONCLUSIVE from its first day.

## 3. The instruments, and the files they read and write

| instrument | runs | reads | writes | environment |
|---|---|---|---|---|
| `nb_observe.py` (copy in `C:\Users\Patrick\uct-q1-observe`) | every 2 h, `UCT-WaveQ1-Observe` | production, through the rig's signed-in page | one Q1 row → `NB_OBSERVE_LOG`; one JSON line → `NB_SOAK_SAMPLES` | `NB_OBSERVE_LOG`, `NB_SOAK_SAMPLES` (default `soak-samples.jsonl` beside the log), `NB_SOAK_START`, `UCT_Q1_RIG_PROFILE` |
| `GET /api/admin/notebook-soak` (`api/routers/notebook_soak.py` → `api/services/journal_two/notebook_soak.py`) | per sampler run | `activity_log`, `users`, `j2_notes` (auth.db); the client-error store | nothing — aggregates only, admin only | — |
| `nb_gate.py` | Sunday 17:05 CT, `UCT-WaveQ1-Gate` | the SOAK log | `NB_GATE_VERDICT` (overwritten each run) | `NB_OBSERVE_LOG`, `NB_GATE_VERDICT`, `NB_RESUME_DOC` |
| `window_check.py` (the mini-canary) | Sunday 15:00 CT, `UCT-WaveQ1-Canary` — ⚠️ weekly today; a daily run is recommended during the soak (trigger 3 is canary-only) | production, rig profile | a check row under `## 📋 THE WINDOW-WATCH LOG` in its resume doc | `UCT_Q1_RIG_PROFILE` |
| `authdb_restore_drill.py` | weekly, by the owner (R2 credentials) | the newest `auth.db` backup in R2 | `--report <NB_SOAK_DRILLS>\drill-<date>.md` | `DATA_SYNC_*` |
| `nb_soak.py` (copy beside the others) | daily (a new task) | everything above, plus `NB_SOAK_RULED`, `NB_SOAK_INCIDENTS`, the repo checkout | `soak-dashboard.md` + `soak-alert-state.json` beside the log; archives the gate's verdict into `NB_SOAK_VERDICTS` | `NB_OBSERVE_LOG`, `NB_SOAK_SAMPLES`, `NB_SOAK_VERDICTS`, `NB_GATE_VERDICT`, `NB_RESUME_DOC`, `NB_SOAK_DRILLS`, `NB_SOAK_RULED`, `NB_SOAK_INCIDENTS`, `NB_SOAK_REPO`, `NB_SOAK_START`, `NB_SOAK_START_SHA`, `NB_SOAK_DISCORD_WEBHOOK` |

⛔ **The soak runs on its OWN observation log** (D-9C5). `nb_gate.py` reads the whole log with no
window (`parsed_rows`), so the Q1 log — whose 2026-09-13 19:00 ET row holds it at REVERT — would
make KEEP unreachable. Point `NB_OBSERVE_LOG` at a new file for both the sampler and the gate.

⛔ **The Q1 table does not change.** The soak's figures ride the sidecar, one JSON line per run;
`nb_gate.py` names every header cell through `_COLUMNS` and an unknown cell turns the verdict
INCOMPLETE. `tests/test_nb_observe.py` pins HEADER and `row()` by sha256.

## 4. The signals

| signal | instrument | file / endpoint | population | paged or reported |
|---|---|---|---|---|
| un-attributed fork | `nb_soak.signals` over the sidecar (per ET day, the LARGER of `events.conflict_forked` and `conflicted_copies.offline_layer` — one fork writes both) + the Q1 `sync-conflict notes` column rising (trigger 2) | `NB_SOAK_SAMPLES`, `NB_OBSERVE_LOG` | organic (sidecar); the rig account (trigger 2) | **paged** until a `- FORK <day>: ATTRIBUTED` ruling names the day |
| blocked-baseline events | sidecar `events.notebook_blocked_no_baseline` | `NB_SOAK_SAMPLES` | every population (same bundle) | **paged** |
| `save_failed` by reason | sidecar `events.save_failed.<pop>.by_reason` | `NB_SOAK_SAMPLES` | all, by population | reported |
| `conflict_forked` by door | sidecar `events.conflict_forked.<pop>.by_door` | `NB_SOAK_SAMPLES` | all, by population | reported (organic ones feed the fork signal) |
| conflicted copies, by writer | sidecar `conflicted_copies.offline_layer` / `.connector` (a lower bound) | `NB_SOAK_SAMPLES` | all | offline organic → fork signal; connector reported |
| Notebook-page client errors | sidecar `client_errors.by_population` (`client_errors.count_by_user_for_page`, page under `/journal/notebook`) | `NB_SOAK_SAMPLES` | organic paged; others + anonymous reported | **paged** for organic |
| outbox stuck > 5 min | the mini-canary's settle step (`outbox **N**`) — ⛔ **never the sampler**, which runs opted out and whose outbox is structurally 0 (`wave-q1-sunday-gate.md` trigger 3) | `NB_RESUME_DOC` | the rig | **paged** until a `- CANARY <day>: RULED` ruling |
| a mini-canary NEW FINDING | `window_check.py` row head | `NB_RESUME_DOC` | the rig | **paged** |
| member-reported loss | a support ticket or feedback → an incident file (§5) | `NB_SOAK_INCIDENTS` | organic | **paged** while CONFIRMED or UNRESOLVED |
| heartbeat: the scheduled task | `schtasks` (`nb_soak.scheduled_task`) | Task Scheduler | — | **paged** on a non-zero `Last Result` |
| heartbeat: the rig signed in | a standing SIGN-IN REQUIRED row | `NB_RESUME_DOC` | — | **paged** |
| heartbeat: C5 reachable | the newest sidecar line `skipped` for > 2 h 20 min | `NB_SOAK_SAMPLES` | — | **paged** |
| heartbeat: rows arriving | a gap in the soak log's rows | `NB_OBSERVE_LOG` | — | **paged** |
| field speed — `note_open_ms`, `search_used.ms`, `ask_used.ms` p50/p95 | the sidecar's cumulative read (else the latest interval) vs `docs/notebook/perf-budgets.json` (`editor.open_p95_ms_max` 300, `search.p95_ms_max` 100; Ask has no budget) | `NB_SOAK_SAMPLES`, the repo checkout | organic | **reported, NEVER paged** (D-9C3), labelled *field: network + device* |
| exposure — organic note-edit-days, active days, identities | sidecar `exposure` (per-day maximum across samples) + `cumulative.identities_editing` | `NB_SOAK_SAMPLES` | organic | reported; decides the floor |
| DRIFT — a running copy ≠ the repo | `nb_soak.drift_line` (content, CR-normalised; both raw sha256 printed) | the copies dir, `NB_SOAK_REPO` | — | **paged** |

## 5. Data loss, operationally

**Data loss** is words, a captured object (chart, widget, fact, excerpt) or an attachment that the
editor showed as **saved or queued**, and that is **absent afterwards from every server copy,
version and conflicted copy** of the note.

Every member report becomes ONE incident file in `NB_SOAK_INCIDENTS`, whatever it turns out to
be. Its triage class is one of four, on a `class:` line (`nb_soak.parse_incident`):

| class | meaning | counts for the verdict as |
|---|---|---|
| `CONFIRMED LOSS` | absent from every copy, version and conflicted copy | **loss → FAIL** |
| `RECOVERED` | found in a version or a conflicted copy | not loss |
| `NOT LOSS` | the member misread, or it was never saved or queued | not loss |
| `UNRESOLVED` | not yet triaged — **and a file with no `class:` line reads as this** | **loss → FAIL** until triaged |

```
# <one line: what the member reported>
opened: 2026-10-14
class: UNRESOLVED
```

## 6. The verdict

Printed by `tools/nb_soak.py` (`verdict`) on every run, with every reason named.

- **PASS** only if ALL of:
  - the **exposure floor (D-9C1)** is met — **≥ 5 organic identities, ≥ 100 organic
    note-edit-days, activity on ≥ 20 days**. Note-edit-days is the sum over ET days of the
    distinct notes edited that day; each day's figure is the largest any two-hour read reported
    (`j2_notes.updated_at` keeps only a note's last edit, so every read is a lower bound and the
    maximum is the best one). Identities come from the cumulative read and are exact;
  - the window is complete (30 days + every unobserved interval);
  - **zero CONFIRMED or UNRESOLVED loss** (§5);
  - **every Sunday verdict in the window is KEEP, or a non-KEEP the owner has ruled FOREIGN in
    writing** (D-9C5). ⚠️ A `KEEP — no independent member exposure` reads **INCONCLUSIVE** here
    (`nb_gate.py` prints it over zero members); a missing Sunday verdict is named;
  - **every 7-day block has a restore drill that exited 0** (`authdb_restore_drill.py`, exit
    codes 0 PASS · 1 FAIL · 2 INCONCLUSIVE; only a PASS writes a PASS report);
  - **no un-attributed fork**, no unsettled canary queue and no canary NEW FINDING without a ruling.
- **FAIL** on any CONFIRMED or UNRESOLVED loss, or a REVERT Sunday verdict nobody has ruled on.
- **INCONCLUSIVE** otherwise — every reason named on the dashboard.

## 7. Paging policy (D-9C3)

`nb_soak.py` sends an alert **only** for a data-integrity signal, a heartbeat gap, DRIFT, or a
verdict change — never for speed. Each alert goes out **once per signal per ET day**
(`soak-alert-state.json` beside the log; a send that failed is not recorded as sent).
Delivery: the LOCAL environment variable `NB_SOAK_DISCORD_WEBHOOK` (never committed; the owner
sets it). Blank ⇒ a desktop balloon through `window_check.notify`, and the dashboard says
**"alerts: desktop only"**. ⚠️ Why speed never pages: paging on field latency trains the owner to
ignore the channel — the same shape as 8 of 56 CI runs going red on runner noise
(`perf-budgets.md`).

## 8. The owner's weekly checklist (Sunday evening, ~10 minutes)

1. `schtasks /Query /TN "UCT-WaveQ1-Observe" /FO LIST /V` — Last Run within 2 h, Last Result 0.
   ⛔ A log with no rows looks exactly like a quiet week (`wave-q1-sunday-gate.md` §0).
2. Open `soak-dashboard.md`. Read the VERDICT line and **every** reason under it.
3. Read the Sunday verdict the gate wrote at 17:05 CT (`NB_GATE_VERDICT`). If it is not KEEP,
   rule on it in writing in `NB_SOAK_RULED` — `- VERDICT <date>: FOREIGN — <why>` — or treat it
   as an incident (§9).
4. Run the restore drill with a report into the drills directory:
   `python tools\authdb_restore_drill.py --report <NB_SOAK_DRILLS>\drill-<date>.md`
   (exit 0 PASS · 1 FAIL · 2 INCONCLUSIVE — only exit 0 closes the week).
5. Rule on every fork the dashboard lists: `- FORK <date>: ATTRIBUTED — <two tabs / a canary /
   a connector>`, or open an incident.
6. Rig sign-in: if the dashboard shows SIGN-IN REQUIRED, `python tools\window_check.py --park`
   and sign in by hand (never a credentials file; the cookie lasts 30 days, so expect one
   re-sign-in during the soak).
7. Triage every open incident to one of the four classes.
8. Check the DRIFT section reads `equal` for all four copies.

## 9. Incident procedure — H15: roll back FIRST, then triage

When a member reports loss, or an integrity alert fires that the owner cannot attribute on sight:

1. **`railway variable --set NOTEBOOK_DOOR_GUARD=full --service web`** — the first lever
   (CLAUDE.md "FLAG-FIRST ROLLBACK"). ⚠️ `--set` redeploys; verify **in the running process**:
   `GET /api/auth/me` returns `notebook_door_guard: "full"` (the payload is derived per request,
   so it IS the process's answer) — never `--kv`.
2. **`NOTEBOOK_OFFLINE_DEFAULT_ON=0`** on `web` — the kill switch, second, because it stops the
   whole offline wave. Verify `notebook_offline_default_on: false` on `/api/auth/me` from the
   rig, and remember it reaches a member on their next authenticated request or reload, not a
   tab mid-session.
3. **Revert the merge** — last, and it is a merge, so `git revert -m 1 <sha>`; verify the `web`
   deploy record reads SUCCESS and the pod serves the reverted SHA.
4. **Only then** triage: open the incident file (§5), class `UNRESOLVED` until the evidence
   says otherwise. ⛔ Never delete member data to "clean up" (a kill switch is never a delete).
5. Every lever pulled is an **unobserved-or-degraded** fact for the soak: note it in
   `NB_SOAK_RULED` so the closing entry can say what ran with which lever.

## 10. Closing — R-RAW: commit the evidence BEFORE interpreting it

When `nb_soak.py` reports the window complete:

1. Copy, unchanged, into `docs/notebook/evidence/soak-<start date>/`: the soak observation log,
   the sidecar (`soak-samples.jsonl`), every archived Sunday verdict, every
   `soak-dashboard.md` you kept, every drill report, the rulings file, every incident file, and
   the final `nb_soak.py` stdout line.
2. **Commit that directory before writing a word of interpretation** (CLAUDE.md R-RAW). A run
   with no raw artifact on disk is INCONCLUSIVE regardless of what a console showed.
3. Then write the verdict entry: the word, the reasons, the floor figures, the unobserved total,
   the SHA range the soak ran across, and every lever pulled.

## 11. Named gaps (stated, not hidden)

- **Wave 8 surfaces are not in this lane's base.** When wave 8 lands, before the soak opens:
  re-read `_NOTEBOOK_PROP_SCHEMAS` (`api/routers/journal_two.py`) — if wave 8 adds a write door
  (publish, share, sample import), a new `conflict_forked.door` value would read as `other` in the
  soak read until the schema names it; and check that no new `sync-conflict` writer appeared.
  The study kit's onboarding/sample/share rows are wave 8's too.
- **No save-success event exists** (the allow-list in `journal_two.py`). The denominator is
  distinct notes edited per day (D-9C4), from rows that already exist; a save-success RATE is not
  claimed.
- **The client-error store keeps 14 days** (`client_errors.RETENTION_DAYS`); the 2-hourly sidecar
  persists each interval's count, so the soak does not depend on it. A read reaching further back
  says `window_exceeds_retention`.
- **The beacon cannot tell the offline layer from the rest of the page.** "Offline-layer client
  errors" are read as every Notebook-page error (page under `/journal/notebook`); each organic one
  is paged and triaged by hand.
- **Connector conflicted copies are a lower bound**: a connector sibling's `created_at` is the
  provider's own createdAt when supplied (`note_connectors/engine.py`).
- **A note's LAST edit only** (`j2_notes.updated_at`): the per-day exposure is a lower bound;
  identities are exact only through the cumulative read (`NB_SOAK_START`).
- **Telemetry mixes populations at the source**; the soak read splits them by full email
  (`notebook_populations.py`, pinned against `nb_observe.py` by an AST rail).
- **`config_served` cannot fire on the default Journal shell** — found by the sandbox browser
  check (run 3, `docs/notebook/evidence/wave9-9c-646e87341/run3/`): 16 Notebook visits by three
  identities left ZERO `j2:notebook_config_served` rows, and the observer's own config-served
  read printed `0/0 — no member reported`. From source: the event is sent only by
  `NotebookFlagGate.jsx`, which only `JournalTwoRoot.jsx` (the legacy v8 shell) mounts; the v5
  shell's `/journal/notebook` renders `NotebookSurface.jsx` → `NotebookTab` with no gate, and
  `shellFlag.js` sends 100% of browsers to v5. Until the Notebook owner mounts the gate on the
  v5 route, the soak's `config_served` figure (reported, never a verdict input) reads `0/0` for
  every population, and so does K-1's precondition.
- **The Q1 log stays at REVERT** (its 2026-09-13 19:00 ET row). That is why the soak has its own
  log; the D2 record (P2) is what rules on the old window.

## 12. File formats the owner writes

**Rulings** (`NB_SOAK_RULED`, markdown; one ruling per line, `nb_soak.parse_rulings`):

```
- VERDICT 2026-10-18: FOREIGN — the only red row is a barspack 401, not a Notebook request
- FORK 2026-10-14: ATTRIBUTED — the member had the note open on two devices
- CANARY 2026-10-16: RULED — the canary ran through a deploy swap; re-ran green at 16:40
```

**Incidents** (`NB_SOAK_INCIDENTS`, one file each): see §5.
